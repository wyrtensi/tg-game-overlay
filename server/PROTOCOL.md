# Relay protocol v1

The relay server is an optional alternative to Telegram: a small self-hosted
WebSocket service that forwards end-to-end encrypted chat messages between the
overlays in one room and hosts a shared sticker catalog.

The server never sees message contents, author names or message types. It sees
the room id (a hash derived from the room name and password), message sizes,
timestamps and client IP addresses.

## Secrets

| Secret | Who knows it | Purpose |
|---|---|---|
| `ACCESS_KEY` | server owner and invited friends | Lets a client use the server at all. Never sent over the wire; proven with an HMAC challenge. |
| `ADMIN_KEY` | server owner only | Lets the upload script add stickers. Same challenge scheme. |
| room name + room password | members of one room | Derive the room id and the message encryption key on the client. Never sent to the server. |

Both server keys are read from the environment (`ACCESS_KEY`, `ADMIN_KEY`) or
from files (`ACCESS_KEY_FILE`, `ADMIN_KEY_FILE`). The server refuses to start
when `ACCESS_KEY` is missing or shorter than 16 characters. `ADMIN_KEY` is
optional; without it sticker upload is disabled.

## Client-side key derivation

All primitives are available in WebCrypto and in Node's `crypto.webcrypto`.

```
roomNorm  = NFC(trim(roomName)).toLowerCase()
salt      = SHA-256(utf8("tgo-relay-v1|salt|" + roomNorm))
master    = PBKDF2-HMAC-SHA256(utf8(password), salt, 600000 iterations, 256 bits)
roomId    = hex(HKDF-SHA256(master, salt = empty, info = "tgo-relay-v1|room-id", 256 bits))
encKey    = HKDF-SHA256(master, salt = empty, info = "tgo-relay-v1|enc", 256 bits) as AES-256-GCM key
```

`roomId` is 64 lowercase hex characters. Two clients with the same room name
and password land in the same room and can read each other; a wrong password
lands in a different (empty) room.

## Message envelope

A message is a JSON object, UTF-8 encoded, padded and encrypted:

```
plain   = utf8(JSON.stringify(envelope))
padded  = plain + 0x00 bytes up to the next multiple of 256 bytes (at least one 0x00)
iv      = 12 random bytes
ct      = AES-256-GCM(encKey, iv, padded, additionalData = utf8("tgo-relay-v1|msg|" + roomId))
data    = base64(iv || ct)
```

The receiver decrypts, strips trailing `0x00` bytes and parses JSON. Anything
that fails to decrypt or parse is dropped silently.

Envelope (the server never sees it):

```ts
interface Envelope {
  v: 1;
  id: string;              // random UUID, used for de-duplication
  author: string;          // display name chosen by the sender
  sid?: string;            // random per-install sender id, lets a client mark its own messages after a restart
  at: number;              // sender clock, ms since epoch
  t: "text" | "sticker" | "image" | "direction" | "phrase";
  text?: string;           // t = "text"; also an optional caption for t = "image"
  sticker?: { id: string; kind: "tgs" | "webp" | "webm" }; // id = sticker sha256 hex
  image?: { mime: string; b64: string; width?: number; height?: number };
  direction?: "up" | "down" | "left" | "right";
  phrase?: string;
}
```

## Transport

One WebSocket endpoint: `ws://<host>:<port>/ws`. All frames are JSON text.
Binary data inside frames is base64. The server limits a frame to 2 MiB.
`GET /health` returns `200 ok` for container health checks; nothing else is
served over plain HTTP.

### Handshake

```
S -> C  { "type": "challenge", "v": 1, "nonce": "<base64, 32 bytes>" }
C -> S  { "type": "auth", "role": "client", "proof": "<base64 HMAC>", "room": "<roomId>", "since": <seq|null> }
S -> C  { "type": "ready", "seq": <latest seq>, "history": [Stored, ...] }
```

`proof = HMAC-SHA256(key = utf8(ACCESS_KEY), msg = utf8("tgo-relay-v1|auth|client|" + nonce))`,
compared in constant time. For the upload script `role` is `"admin"`, the key
is `ADMIN_KEY`, the message uses `|admin|` instead of `|client|`, and `room` is
omitted.

`history` holds the stored messages of the room with `seq > since` (all of
them when `since` is null), oldest first. A connection that sends anything
before a valid `auth`, or does not authenticate within 10 seconds, is closed.
After a failed auth the server answers `{ "type": "error", "code": "auth_failed" }`
and closes; it waits 1 second before answering to slow down guessing.

### Messages

```
C -> S  { "type": "send", "cid": "<client correlation id>", "data": "<base64>" }
S -> C  { "type": "msg", "seq": 17, "at": <server ms>, "data": "<base64>", "cid": "<only for the sender>" }
```

The server assigns a per-room increasing `seq` and a server timestamp, stores
the message and broadcasts it to every connection in the room, the sender
included (the sender's copy carries its `cid`, so the client can resolve its
pending send). `Stored` has the same shape as `msg` without `type` and `cid`.

Each room keeps the last 300 messages, at most 2 000 000 base64 characters in total,
and drops messages older than 7 days.
Rooms are persisted to the data volume (debounced writes, plus on shutdown), so
a restart keeps history. A room with no messages and no connections is
forgotten; when it comes back, its numbering restarts from the current time in
milliseconds, so it never goes below a `since` a client still remembers.

### Stickers

The catalog is shared by everyone who holds `ACCESS_KEY`. Sticker files are
content-addressed by the SHA-256 of their bytes.

```
C -> S  { "type": "stickers_index" }
S -> C  { "type": "stickers_index", "version": "<hash of the index>", "packs": [Pack, ...] }

C -> S  { "type": "sticker_get", "id": "<sha256 hex>" }
S -> C  { "type": "sticker", "id": "<sha256 hex>", "kind": "tgs", "b64": "<base64>" }
```

```ts
interface Pack { id: string; title: string; stickers: { id: string; kind: "tgs" | "webp" | "webm"; emoji?: string; size: number }[] }
```

Clients cache files by id and verify the SHA-256 before use, so a cached file
never needs to be fetched again.

Admin only:

```
C -> S  { "type": "sticker_put", "pack": "<pack title>", "kind": "tgs", "emoji": "😂", "b64": "<base64>" }
S -> C  { "type": "sticker_put", "id": "<sha256 hex>", "created": true }
C -> S  { "type": "sticker_delete", "id": "<sha256 hex>" }
S -> C  { "type": "sticker_delete", "id": "<sha256 hex>", "deleted": true }
```

Uploading the same bytes twice is a no-op (`created: false`). A `tgs` sticker must be
gzip of at most 64 KiB that inflates to at most 4 MiB, otherwise `too_large` or
`bad_request`; clients enforce the same limits before rendering. The pack id is a
slug of the pack title.

### Errors and limits

`{ "type": "error", "code": "<code>", "cid"?: "<cid>", "id"?: "<id>", "request"?: "<type>", "message"?: "<text>" }` with codes
`auth_failed`, `bad_request`, `too_large`, `rate_limited`, `not_found`, `forbidden`, `busy`.

Errors carry a correlation field so the client can match a failure to its
pending request: an error answering `send` carries the `cid`; an error
answering `sticker_get` carries the requested `id`; an
error answering `stickers_index` carries `"request": "stickers_index"`.

- Per connection: at most 30 `send` frames and 300 `sticker_get` frames per 10 seconds, then `rate_limited`.
  `sticker_get` frames are answered one at a time, in order.
- A stored message holds at most 1 500 000 base64 characters of `data` (`too_large`);
  a client should keep raw images under about 800 KB.
- At most 16 connections per IP address and 512 in total, of which at most 64 may
  still be in the handshake. Before it authenticates a socket may send at most
  16 KiB; a bigger frame is cut off.
- At most 32 rooms are held in memory and 500 are kept on disk; joining a new
  room beyond that fails with `busy` and the socket is closed.
- The server pings every 25 seconds and drops a connection that missed two pongs.

## Client behaviour

- Reconnect with exponential backoff (1 s doubling up to 30 s, with jitter) and
  pass the last seen `seq` as `since`, so nothing is shown twice.
- De-duplicate by envelope `id` as well, because the same message can arrive in
  `history` and as `msg` around a reconnect.
- A send is confirmed only by the echoed `msg` carrying its `cid`; a send that is
  not echoed within 15 seconds is reported as failed and never resent
  automatically.

## Known limits

- There is no TLS unless the operator puts a TLS proxy in front. Contents stay
  protected by the end-to-end encryption and the access key is never sent, but
  the room id, sizes and timing are visible on the network.
- Everyone in a room shares one key, so any member can post under any display
  name. Rooms are meant for friends.
- The room id is derived from the room name and password, and it is visible on
  the network without TLS. Someone who knows the room name can test password
  guesses offline (each guess costs 600 000 PBKDF2 rounds), so use a long,
  random room password.
- Without TLS, someone on the network path can capture ciphertext and replay
  it later. Clients drop envelopes they have already seen in this session and
  ignore live direction and phrase signals whose sender time is more than a few
  minutes off, but a replayed old text message after a restart would show again.
- The sticker catalog is not end-to-end encrypted or signed; it is protected
  only by the access key. Clients verify each file against its SHA-256 id and
  render animated stickers with a Lottie player that has no expression engine,
  so a hostile catalog can show a bad picture but cannot run code.
