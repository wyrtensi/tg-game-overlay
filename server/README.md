# tg-game-overlay relay server

A small self-hosted WebSocket relay that can replace Telegram as the transport
for tg-game-overlay. It forwards end-to-end encrypted chat messages between the
overlays that share a room, keeps a short history so a reconnecting overlay
catches up, and hosts a shared sticker catalog.

## Security model

- Clients prove they know `ACCESS_KEY` with an HMAC challenge. The key is never
  sent over the wire. The optional `ADMIN_KEY` works the same way and only
  unlocks sticker upload.
- Message contents, author names and message types are encrypted on the clients
  with a key derived from the room name and room password. The server only
  sees a room id (a hash), message sizes, timestamps and client IP addresses.
- There is no TLS unless you put a TLS reverse proxy in front. Contents stay
  protected by the end-to-end encryption, but the room id, sizes and timing are
  visible on the network.
- The sticker catalog is protected by the access key only, not encrypted.

Full wire protocol, crypto and limits: [PROTOCOL.md](PROTOCOL.md).

## Quick start (Docker Compose)

```sh
cd server
cp .env.example .env

# generate one key for each line and paste them into .env
openssl rand -base64 32   # ACCESS_KEY (share with your friends)
openssl rand -base64 32   # ADMIN_KEY  (keep for yourself)

docker compose up -d
curl http://localhost:8790/health      # prints: ok
```

Both keys must be at least 16 characters; the server refuses to start with a
missing or short `ACCESS_KEY`. Leave `ADMIN_KEY` empty to disable sticker
upload. Keys can also be supplied as files with `ACCESS_KEY_FILE` and
`ADMIN_KEY_FILE` (for Docker secrets). Keys are never logged.

In the overlay, set the server address to `ws://your-server:8790/ws` and enter
the access key, then choose a room name and password. Everyone who uses the
same room name and password shares one chat.

### Choosing a port

The default is 8790. Set `RELAY_PORT` in `.env` to publish a different host
port. Ports 80 and 443 are often taken by a reverse proxy already and are not
needed: the overlay connects to whatever port you choose. If you do run a TLS
reverse proxy in front, use `wss://your-domain/ws`, forward WebSocket upgrades
on `/ws`, and set `TRUST_PROXY=1` in `.env` so the per-IP connection limit uses
the `X-Forwarded-For` header (only enable it behind a proxy that sets it).

### Configuration

| Variable | Default | Meaning |
|---|---|---|
| `ACCESS_KEY` / `ACCESS_KEY_FILE` | required | Shared key for clients, 16+ characters |
| `ADMIN_KEY` / `ADMIN_KEY_FILE` | none | Key for sticker upload, 16+ characters |
| `PORT` | `8790` | Port inside the container |
| `HOST` | `0.0.0.0` | Bind address |
| `DATA_DIR` | `/data` | Rooms and stickers are stored here |
| `TRUST_PROXY` | off | Take the client IP from `X-Forwarded-For` |

If both `X` and `X_FILE` are set, `X` wins.

## Uploading stickers

The script runs on your own machine and needs Node 24 and the dependency
installed once:

```sh
cd server
npm ci
node scripts/upload-stickers.mjs \
  --url ws://your-server:8790/ws \
  --admin-key-file ./admin.key \
  --pack "My stickers" \
  ./exported-stickers
```

- The key can also come from the `ADMIN_KEY` environment variable. It is never
  printed.
- Only `*.tgs`, `*.webp` and `*.webm` files directly in the folder are
  uploaded; `*_thumb.jpg` and everything else is skipped. Files with identical
  content are sent once.
- `--export path/to/result.json` reads a Telegram Desktop chat export only to
  map sticker file names to emoji. Nothing else from that file is used,
  uploaded or printed.
- `--dry-run` scans the folder and reports what would be sent without
  connecting.
- Running the script again is safe: stickers already on the server are
  reported as "already present".

## Backups

Everything lives in the `relay-data` volume (`rooms/` and `stickers/`). Room
files are only a short rolling history, so the stickers are what is worth
saving:

```sh
docker run --rm -v relay-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/relay-data.tar.gz -C /data .
```

The compose project name prefixes the volume name (for example
`server_relay-data`); check with `docker volume ls`. To restore, extract the
archive into an empty volume the same way.

## Resource footprint

Idle, the container uses about 20 MiB of RAM and no measurable CPU. The image
is about 63 MB compressed. Compose limits it to 128 MiB and half a CPU. Only
rooms with an open connection are kept in memory. Each room keeps at most 300
messages, 7 days of history and 8 MB of message data, written to disk as one
small file per room.

## Updating

```sh
docker compose pull && docker compose up -d
```

Data in the volume is kept. If you build the image yourself, uncomment
`build: .` in `docker-compose.yml` and run `docker compose up -d --build`.

## Development

```sh
npm ci
npm test
```

Tests use the built-in `node:test` runner and need no network or Docker.
