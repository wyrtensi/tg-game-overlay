# Contract between the Rust backend and the two web UIs

Prototype step 1 of the project "Telegram-chat over games": overlay window, click-through,
hotkey, tray, hide with the game. No Telegram yet - the feed is fed by a demo generator.

## Windows

| Label | File | Purpose |
|---|---|---|
| `main` | `index.html` | Normal window: profiles, hotkey, feed settings, Telegram login |
| `overlay` | `overlay.html` | Transparent window sized to the game window rect |
| `telegram` | `telegram.html` | Hidden worker: the only place the MTProto client runs |
| `relay` | `relay.html` | Hidden worker for the self-hosted relay transport (`server/PROTOCOL.md`) |

Pages never talk to each other directly; Rust is the bus.

Both workers start with the app and listen to the same `tg:*` events. `Config.transport`
selects the one that speaks for the chat; the other one ignores every event and stays
disconnected. As a safety net Rust drops `tg_status`, `push_message`, `tg_dialogs`,
`tg_stickers`, `tg_send_result`, `tg_direction`, `tg_phrase` and `reset_overlay_feed`
calls that come from the inactive worker window.

The overlay window always covers the whole game window. Zones are CSS boxes inside it,
expressed as fractions of the window (see `src/core/zones.ts`).

## Events emitted by Rust (listen with `@tauri-apps/api/event`)

| Event | Payload | Meaning |
|---|---|---|
| `overlay:state` | `{ kind: "off" \| "hidden" \| "inactive" \| "active", gameExe: string \| null }` | Current state machine state |
| `overlay:zones` | `{ inactive: Zone, active: Zone, ttlMs: number, opacity: number, fontScale: number, textColor: string, authorColor: string, shadow: number, fadeMs: number, stickerAnimationSeconds: number, showAuthor: boolean, showMessageTime: boolean, directionDisplayMs: number }` | Layout and feed settings for the current game |
| `overlay:message` | `{ id: string, author: string, text: string, at: number, outgoing?: boolean, media?: OverlayMedia }` | New chat message |
| `overlay:direction_pending` | `{ requestId: string, direction: "up" \| "down" \| "left" \| "right", at: number }` | Local direction waiting for Telegram confirmation |
| `overlay:direction` | `{ messageId: string, author: string, direction: "up" \| "down" \| "left" \| "right", at: number, outgoing: boolean }` | Dedicated graphical direction signal; it is never a feed bubble |
| `overlay:phrase_wheel` | `{ active: boolean, phrases: string[], selectedIndex: number \| null, originX: number \| null, originY: number \| null, cancelRadiusPx: number \| null }` | Floating phrase labels around a neutral centre; the centre indicates the configured cancel radius, and releasing there closes the wheel without sending |
| `overlay:phrase` | `{ messageId: string, author: string, phrase: string, at: number, outgoing: boolean }` | Dedicated phrase signal; it is never a feed bubble |
| `overlay:reset` | `{}` | Selected chat or forum topic changed; clear all feed and in-flight media state |
| `overlay:markup` | `{ active: boolean }` | Markup mode on/off |
| `config:changed` | `Config` (see below) | Settings changed, main window should re-render |
| `tg:status` | `{ state: "offline" \| "connecting" \| "reconnecting" \| "code" \| "password" \| "connected" \| "reauth_required" \| "error", phone?, error?, waitSeconds?, reconnectAttempt? }` | Worker reports where the login or connection stands |
| `tg:login` | `{ step: "phone" \| "code" \| "password" \| "logout", value?: string }` | The user submitted a login step in the settings window |
| `tg:reconnect_now` | `{}` | Settings asks the worker to skip the current reconnect delay |
| `tg:dialogs_request` | `{ query: string \| null }` | Settings window asks the worker for the chat list |
| `tg:dialogs` | `{ dialogs: ChatRef[], error?: string }` | Worker answers with chats or a load error |
| `tg:history_request` | `{}` | Overlay requests a history backfill after its message listener is ready |
| `tg:send` | `{ requestId: string, text: string }` | Overlay sent a line; the worker delivers it to Telegram |
| `tg:direction` | `{ requestId: string, direction: "up" \| "down" \| "left" \| "right", at: number }` | Native passive key observer requests an editable Telegram direction message |
| `tg:send_sticker` | `{ requestId: string, fileId: string }` | Same for a sticker |
| `tg:stickers_request` | `{ refresh: boolean }` | The overlay wants cached packs or a forced refresh |
| `tg:stickers` | `{ packs: StickerPack[], phase: "metadata" \| "previews" \| "complete", error?: string }` | Worker streams metadata and progressively hydrated previews |
| `tg:send_file` | `{ requestId: string, dataUrl: string, caption: string \| null }` | A pasted image to deliver |
| `overlay:send_result` | `{ requestId, kind, ok, error?, messageId? }` | Correlated final result of a Telegram send |
| `overlay:paused` | `{ paused: boolean }` | Paused from the tray |
| `relay:settings_changed` | `{}` | Relay address, room or secrets were saved; the relay worker reloads and reconnects |

`Zone` is `{ x: number, y: number, width: number, height: number }`, all `0..1`.

## Commands exposed by Rust (`invoke`)

| Command | Args | Returns |
|---|---|---|
| `get_config` | - | `Config` |
| `sync_overlay` | - | `void` (sends current state and requests chat history) |
| `tg_worker_ready` | - | `void` (worker confirms that event listeners are installed) |
| `set_hotkey` | `{ hotkey: string }` | `Config` (throws a string on a rejected combination) |
| `set_markup_hotkey` | `{ hotkey: string }` | `Config` (same, for the markup hotkey) |
| `set_direction_settings` | `{ settings: DirectionSettings }` | `Config` |
| `set_phrase_wheel_settings` | `{ settings: PhraseWheelSettings }` | `Config` |
| `set_feed_settings` | `{ settings: FeedSettings }` | `Config` |
| `set_flags` | `{ autostart: boolean, demoFeed: boolean }` | `Config` |
| `upsert_profile` | `{ profile: Profile }` | `Config` |
| `remove_profile` | `{ exe: string }` | `Config` |
| `add_current_app` | - | `Config` (legacy: adds the last foreground app as a profile) |
| `add_profile_by_exe` | `{ value: string }` | `Config` (adds an `.exe` name or full executable path as a profile) |
| `list_profile_candidates` | - | `{ exe: string, title: string }[]` (visible running windows available for a profile) |
| `save_zones` | `{ exe: string, inactive: Zone, active: Zone }` | `Config` |
| `send_message` | `{ requestId: string, text: string }` | `void` (prototype: echoes the text back as a message) |
| `dismiss` | - | `void` (Esc or a sent message: back to inactive, focus to the game) |
| `toggle_markup` | `{ on: boolean }` | `void` |
| `open_main_window` | - | `void` |
| `set_chat` | `{ chat: ChatRef \| null }` | `Config` (the single mirrored chat) |
| `send_sticker` | `{ requestId: string, fileId: string }` | `void` |
| `send_file` | `{ requestId: string, dataUrl: string, caption?: string }` | `void` |
| `tg_send_result` | `{ result: SendResult }` | `void` (relays `overlay:send_result`) |
| `tg_direction` | `{ payload: DirectionSignal }` | `void` (relays `overlay:direction`) |
| `tg_phrase` | `{ payload: PhraseSignal }` | `void` (relays `overlay:phrase`) |
| `get_direction_message_id` | `{ accountId: string, chatKey: string }` | `number \| null` |
| `set_direction_message_id` | `{ accountId: string, chatKey: string, messageId: number }` | `void` |
| `tg_api_keys` | - | `{ apiId: number, apiHash: string }` (built in, or the user's own) |
| `tg_builtin_keys_available` | - | `boolean` (false in public builds: users must bring their own keys) |
| `set_transport` | `{ transport: "telegram" \| "relay" }` | `Config` (resets status to offline and clears the feed) |
| `set_relay_settings` | `{ settings: RelaySettings, accessKey: string \| null, password: string \| null }` | `Config`; `null` keeps a stored secret, `""` forgets it; emits `relay:settings_changed` |
| `relay_secret_state` | - | `{ hasAccessKey: boolean, hasPassword: boolean }` |
| `relay_credentials` | - | `{ accessKey: string \| null, password: string \| null }`, only for the `relay` window |
| `tg_save_api_keys` | `{ apiId: number, apiHash: string }` | `Config` |
| `tg_save_session` | `{ session: string }` | `void` (stored with DPAPI, never in the config file) |
| `tg_session` | - | `string \| null` |
| `tg_clear_session` | - | `void` (removes only the saved session after it was revoked) |
| `tg_logout` | - | `void` |
| `tg_login_step` | `{ step, value }` | `void` (emits `tg:login`) |
| `tg_reconnect_now` | - | `void` (emits `tg:reconnect_now`) |
| `tg_status` | `{ status }` | `void` (emits `tg:status`; flips the demo feed off when connected) |
| `tg_current_status` | - | latest `TgStatus` reported by the worker |
| `tg_request_dialogs` | `{ query?: string }` | `void` (emits `tg:dialogs_request`) |
| `tg_dialogs` | `{ dialogs, error? }` | `void` (emits `tg:dialogs`, including a load error when present) |
| `tg_request_stickers` | `{ refresh?: boolean }` | `void` (emits `tg:stickers_request`) |
| `tg_stickers` | `{ payload }` | `void` (emits `tg:stickers`) |
| `push_message` | `{ message: OverlayMessage }` | `void` (emits `overlay:message`) |
| `reset_overlay_feed` | - | `void` (emits `overlay:reset`) |

```ts
type ProfileMode = "show" | "hidden" | "blocked";

interface Profile {
  exe: string;          // lower case executable name, e.g. "dota2.exe"
  title: string;        // human readable name
  mode: ProfileMode;
  inactive: Zone;
  active: Zone;
}

interface FeedSettings {
  ttlMs: number;
  opacity: number;      // 0..1 backdrop opacity behind a chat line
  fontScale: number;    // 1 = base size
  textColor?: string;   // "#rrggbb"
  authorColor?: string; // "#rrggbb"
  messageLayout?: "compact" | "dialogue";
  showAuthor?: boolean;
  showMessageTime?: boolean; // local time in HH:mm, enabled by default
  incomingBubbleColor?: string; // "#rrggbb"
  outgoingBubbleColor?: string; // "#rrggbb"
  shadow?: number;      // 0..1 text shadow strength
  fadeMs?: number;      // fade-out duration at the end of a line's life
  stickerAnimationSeconds?: number; // 0 = disabled, otherwise 1..60
}

interface DirectionSettings {
  enabled: boolean;
  upKey: string;
  downKey: string;
  leftKey: string;
  rightKey: string;
  displayMs: number;
}

interface PhraseWheelSettings {
  enabled: boolean;
  hotkey: string;
  deadZonePx: number; // 16..160
  phrases: string[];  // 2..8 non-empty phrases, each up to 160 characters
}

interface ChatRef {
  kind: "user" | "chat" | "channel";
  id: string;
  accessHash?: string;
  title: string;
  username?: string;
  isBot?: boolean;
  topicId?: number;
}

interface OverlayMessage {
  id: string;
  author: string;
  text: string;
  at: number;
  outgoing?: boolean;
  media?: {
    kind: "photo" | "webp" | "tgs" | "webm" | "gif";
    mimeType: string;   // original Telegram MIME, e.g. "image/gif"
    dataUrl: string;
    width?: number;
    height?: number;
  };
}

interface StickerPack {
  id: string;
  title: string;
  stickers: {
    fileId: string;
    emoji?: string;
    kind: "webp" | "tgs" | "webm";
    /** Small preview, ready to draw when Telegram supplied one. */
    dataUrl?: string;
  }[];
}

interface Config {
  hotkey: string;       // e.g. "T" or "Ctrl+Shift+T"
  markupHotkey: string;
  ttlMs: number;
  opacity: number;      // 0..1 backdrop opacity behind a chat line
  fontScale: number;    // 1 = base size
  textColor: string;
  authorColor: string;
  shadow: number;
  fadeMs: number;
  stickerAnimationSeconds: number;
  showMessageTime: boolean;
  autostart: boolean;
  demoFeed: boolean;    // fake messages while Telegram is not connected
  apiId?: number;       // only when the user brings their own keys
  transport: "telegram" | "relay";
  relay: RelaySettings; // { url, room, displayName }; secrets live in DPAPI storage
  chat?: ChatRef | null;
  directionSignals: DirectionSettings;
  phraseWheel: PhraseWheelSettings;
  profiles: Profile[];
}
```

## Overlay UI rules

- Passive (`inactive`): only messages younger than `ttlMs`, fading out over the last 2 s.
  The window ignores the mouse, so nothing there may rely on hover.
- Active: input field focused without a click, scrollback of the whole history,
  expiry paused, unread cleared.
- Hidden / off: render nothing.
- Keyboard in active mode: Enter sends, Shift+Enter newline, Esc calls `dismiss`,
  PageUp/PageDown scroll the history.
- A small "N new" pill when messages arrived while hidden.
- Readability over any game: text shadow plus a translucent backdrop behind the feed.
- `Добавить игру` adds entered `.exe` text; with an empty field it opens a native `.exe` chooser. The visible-window list refreshes on focus and every three seconds while settings are visible.
- Photos and supported media are accepted through 8 MiB. PNG, JPEG, WebP and original GIF files can be selected with the attachment button; clipboard images remain supported. TGS and WebM stickers play once for `stickerAnimationSeconds` (default 10) and pause while the overlay is hidden, off, or in markup mode.
