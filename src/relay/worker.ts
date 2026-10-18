// The relay transport: the same tg:* event surface as the Telegram worker
// (CONTRACT.md), backed by an end-to-end encrypted room on a self-hosted
// relay server (server/PROTOCOL.md). Only one transport is active at a time;
// while Telegram is selected this worker stays silent.

import {
  base64ToBytes,
  bytesToBase64,
  decryptEnvelope,
  deriveRoomKeys,
  encryptEnvelope,
  sha256Hex,
  type Envelope,
  type RelayStickerKind,
  type RoomKeys,
} from "./crypto";
import {
  normalizeServerUrl,
  RelayConnection,
  type ConnectionStatus,
  type RelayConnectionOptions,
  type StickerIndex,
  type StoredMessage,
} from "./connection";
import { stickerDataUrl, stickerMimeType, type StickerStore } from "./sticker-store";
import { MAX_TGS_BYTES } from "../core/media-limits";
import type { SendKind, SendResult } from "../telegram/send-result";
import type {
  DirectionEvent,
  OverlayMessage,
  PhraseEvent,
  SendFileEvent,
  SendStickerEvent,
  SendTextEvent,
  StickerPack,
  TgStatus,
} from "../telegram/types";
import { resolveLanguage, setLocale, t } from "../i18n";

/** Raw image bytes that stay under the server's 1 500 000-character message cap after padding and two base64 passes. */
export const MAX_RELAY_IMAGE_BYTES = 800 * 1024;
const HISTORY_REPLAY = 20;
const MAX_TRACKED_IDS = 5000;
const STICKER_FETCH_CONCURRENCY = 4;
const DEFAULT_AUTHOR = "Игрок";

export interface RelaySettings {
  url: string;
  room: string;
  displayName: string;
}

export interface RelayWorkerConfig {
  transport?: "telegram" | "relay";
  relay?: RelaySettings | null;
  language?: string;
}

export interface RelayCredentials {
  accessKey: string | null;
  password: string | null;
}

export interface RelayWorkerDeps {
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  listen: <T>(event: string, handler: (payload: T) => void) => Promise<unknown>;
  store: StickerStore;
  senderId: string;
  createConnection?: (options: RelayConnectionOptions) => RelayConnectionLike;
  deriveKeys?: (room: string, password: string) => Promise<RoomKeys>;
  newId?: () => string;
  now?: () => number;
}

export type RelayConnectionLike = Pick<
  RelayConnection,
  "start" | "stop" | "retryNow" | "send" | "stickerIndex" | "sticker" | "connected" | "recovering"
>;

interface Session {
  key: string;
  keys: RoomKeys;
  connection: RelayConnectionLike;
}

export function settingsKey(settings: RelaySettings | null | undefined, credentials: RelayCredentials): string | null {
  const url = normalizeServerUrl(settings?.url ?? "");
  const room = settings?.room.trim() ?? "";
  if (!url || !room || !credentials.accessKey || !credentials.password) return null;
  return JSON.stringify([url, room.normalize("NFC").toLowerCase(), credentials.accessKey, credentials.password]);
}

export class RelayWorker {
  private active = false;
  private settings: RelaySettings | null = null;
  private credentials: RelayCredentials = { accessKey: null, password: null };
  private session: Session | null = null;
  /** Settings key being connected while the room key is still derived. */
  private pendingKey: string | null = null;
  /** Incoming messages are handled strictly in arrival order. */
  private incoming: Promise<void> = Promise.resolve();
  private generation = 0;
  private readonly seenIds = new Set<string>();
  private history: Envelope[] = [];
  private historyAt = new Map<string, number>();
  private stickerIndex: StickerIndex | null = null;
  private stickerKinds = new Map<string, RelayStickerKind>();

  constructor(private readonly deps: RelayWorkerDeps) {}

  async start(): Promise<void> {
    const { listen } = this.deps;
    await Promise.all([
      listen<RelayWorkerConfig>("config:changed", (config) => void this.applyConfig(config, "config")),
      listen("relay:settings_changed", () => void this.reloadEverything()),
      listen("tg:history_request", () => void this.replayHistory()),
      listen("tg:reconnect_now", () => this.whenActive(() => this.session?.connection.retryNow())),
      listen<{ query: string | null }>("tg:dialogs_request", (req) => this.whenActive(() => {
        void this.deps.invoke("tg_dialogs", { dialogs: [], error: null, query: req.query ?? null });
      })),
      listen<SendTextEvent>("tg:send", (evt) => this.whenActive(() => void this.onSendText(evt))),
      listen<SendStickerEvent>("tg:send_sticker", (evt) => this.whenActive(() => void this.onSendSticker(evt))),
      listen<SendFileEvent>("tg:send_file", (evt) => this.whenActive(() => void this.onSendFile(evt))),
      listen<DirectionEvent>("tg:direction", (evt) => this.whenActive(() => void this.onDirection(evt))),
      listen<PhraseEvent>("tg:phrase", (evt) => this.whenActive(() => void this.onPhrase(evt))),
      listen<{ refresh?: boolean }>("tg:stickers_request", (evt) => this.whenActive(() => void this.onStickersRequest(evt.refresh === true))),
    ]);
    await this.reloadEverything();
  }

  stop(): void {
    this.closeSession();
  }

  private whenActive(action: () => void): void {
    if (this.active) action();
  }

  private async reloadEverything(): Promise<void> {
    this.credentials = await this.deps.invoke<RelayCredentials>("relay_credentials");
    const config = await this.deps.invoke<RelayWorkerConfig>("get_config");
    await this.applyConfig(config, "settings");
  }

  /**
   * `config:changed` only switches the transport on or off. set_relay_settings
   * saves the config (config:changed, while this worker still holds the old
   * secrets) and then emits relay:settings_changed, which reloads the secrets
   * and is the one place that reconnects - otherwise a single save would run
   * the key derivation twice and reset the feed twice.
   */
  private async applyConfig(config: RelayWorkerConfig, source: "config" | "settings"): Promise<void> {
    const wasActive = this.active;
    setLocale(resolveLanguage(config.language, typeof navigator === "undefined" ? [] : navigator.languages ?? []));
    this.active = config.transport === "relay";
    this.settings = config.relay ?? null;
    if (!this.active) {
      if (wasActive) this.closeSession();
      return;
    }
    if (source === "config" && wasActive) return;
    const key = settingsKey(this.settings, this.credentials);
    // A save that keeps the room (say, a new display name) keeps the session.
    if (wasActive && key !== null && key === (this.session?.key ?? this.pendingKey)) return;
    await this.openSession(key);
  }

  private closeSession(): void {
    this.generation += 1;
    this.pendingKey = null;
    const session = this.session;
    this.session = null;
    session?.connection.stop();
    this.resetRoomState();
  }

  private resetRoomState(): void {
    this.seenIds.clear();
    this.history = [];
    this.historyAt.clear();
    this.stickerIndex = null;
    this.stickerKinds.clear();
  }

  private async openSession(key: string | null): Promise<void> {
    const previous = this.session;
    this.closeSession();
    const generation = this.generation;
    if (previous) await this.deps.invoke("reset_overlay_feed");
    if (!key || !this.settings) {
      await this.reportStatus({ state: "offline", error: "Заполните адрес сервера, ключ доступа, комнату и пароль" });
      return;
    }
    const url = normalizeServerUrl(this.settings.url) as string;
    this.pendingKey = key;
    await this.reportStatus({ state: "connecting" });
    let keys: RoomKeys;
    try {
      keys = await (this.deps.deriveKeys ?? deriveRoomKeys)(this.settings.room, this.credentials.password as string);
    } catch (err) {
      await this.reportStatus({ state: "error", error: err instanceof Error ? err.message : "Не удалось вывести ключ комнаты" });
      return;
    }
    if (generation !== this.generation || !this.active) return;
    this.pendingKey = null;
    const create = this.deps.createConnection ?? ((options) => new RelayConnection(options));
    const connection = create({
      url,
      accessKey: this.credentials.accessKey as string,
      roomId: keys.roomId,
      onStatus: (status) => {
        if (generation === this.generation) void this.onConnectionStatus(status);
      },
      onMessage: (message, fromHistory) => {
        if (generation !== this.generation) return;
        this.incoming = this.incoming
          .then(() => this.onStoredMessage(keys, message, fromHistory, generation))
          .catch((err) => console.error("[relay] failed to show a message", err));
      },
    });
    this.session = { key, keys, connection };
    connection.start();
  }

  private async onConnectionStatus(status: ConnectionStatus): Promise<void> {
    await this.reportStatus(status as TgStatus);
  }

  private async reportStatus(status: TgStatus): Promise<void> {
    if (!this.active) return;
    await this.deps.invoke("tg_status", { status });
  }

  // ---- incoming ------------------------------------------------------------

  private markSeen(id: string): boolean {
    if (this.seenIds.has(id)) return true;
    this.seenIds.add(id);
    if (this.seenIds.size > MAX_TRACKED_IDS) {
      const oldest = this.seenIds.values().next().value;
      if (oldest !== undefined) this.seenIds.delete(oldest);
    }
    return false;
  }

  private async onStoredMessage(keys: RoomKeys, stored: StoredMessage, fromHistory: boolean, generation: number): Promise<void> {
    const envelope = await decryptEnvelope(keys, stored.data);
    if (!envelope || generation !== this.generation) return;
    if (this.markSeen(envelope.id)) return;
    // Signals only make sense live: a backlog of arrows would flash all at once.
    if (fromHistory && (envelope.t === "direction" || envelope.t === "phrase")) return;
    if (envelope.t !== "direction" && envelope.t !== "phrase") {
      this.history.push(envelope);
      this.historyAt.set(envelope.id, stored.at);
      if (this.history.length > HISTORY_REPLAY) {
        const dropped = this.history.shift();
        if (dropped) this.historyAt.delete(dropped.id);
      }
    }
    await this.present(envelope, stored.at, generation);
  }

  private async replayHistory(): Promise<void> {
    if (!this.active || !this.session) return;
    const generation = this.generation;
    for (const envelope of [...this.history]) {
      if (generation !== this.generation) return;
      await this.present(envelope, this.historyAt.get(envelope.id) ?? envelope.at, generation);
    }
  }

  private async present(envelope: Envelope, at: number, generation: number): Promise<void> {
    const author = envelope.author.trim().slice(0, 64) || t(DEFAULT_AUTHOR);
    const outgoing = envelope.sid === this.deps.senderId;
    const base: OverlayMessage = { id: envelope.id, author, text: "", at, ...(outgoing ? { outgoing: true } : {}) };
    switch (envelope.t) {
      case "text":
        await this.deps.invoke("push_message", { message: { ...base, text: envelope.text ?? "" } });
        return;
      case "image": {
        const image = envelope.image!;
        await this.deps.invoke("push_message", {
          message: {
            ...base,
            text: envelope.text ?? "",
            media: {
              kind: image.mime === "image/gif" ? "gif" : "photo",
              mimeType: image.mime,
              dataUrl: `data:${image.mime};base64,${image.b64}`,
              width: image.width,
              height: image.height,
            },
          },
        });
        return;
      }
      case "sticker": {
        const sticker = envelope.sticker!;
        this.stickerKinds.set(sticker.id, sticker.kind);
        const cached = await this.loadSticker(sticker.id, sticker.kind, false);
        if (generation !== this.generation) return;
        if (cached) {
          await this.pushSticker(base, sticker.kind, cached);
          return;
        }
        await this.deps.invoke("push_message", { message: { ...base, text: "[стикер]" } });
        const fetched = await this.loadSticker(sticker.id, sticker.kind, true);
        if (fetched && generation === this.generation) await this.pushSticker(base, sticker.kind, fetched);
        return;
      }
      case "direction":
        await this.deps.invoke("tg_direction", {
          payload: { messageId: envelope.id, author, direction: envelope.direction, at: Date.now(), outgoing },
        });
        return;
      case "phrase":
        await this.deps.invoke("tg_phrase", {
          payload: { messageId: envelope.id, author, phrase: envelope.phrase ?? "", at: Date.now(), outgoing },
        });
        return;
    }
  }

  private async pushSticker(base: OverlayMessage, kind: RelayStickerKind, b64: string): Promise<void> {
    await this.deps.invoke("push_message", {
      message: {
        ...base,
        text: "[стикер]",
        media: { kind, mimeType: stickerMimeType(kind), dataUrl: stickerDataUrl({ kind, b64 }) },
      },
    });
  }

  /** Cache first; with `fetch` the server is asked and the bytes are verified before caching. */
  private async loadSticker(id: string, kind: RelayStickerKind, fetch: boolean): Promise<string | null> {
    try {
      const cached = await this.deps.store.get(id);
      if (cached) return acceptableSticker(kind, cached.kind, cached.b64) ? cached.b64 : null;
    } catch (err) {
      console.error("[relay] sticker cache read failed", err);
    }
    if (!fetch || !this.session?.connection.connected) return null;
    try {
      const file = await this.session.connection.sticker(id);
      if (!acceptableSticker(kind, file.kind, file.b64)) {
        console.error("[relay] TGS sticker over 64 KiB, ignoring", id);
        return null;
      }
      if (await sha256Hex(base64ToBytes(file.b64)) !== id) {
        console.error("[relay] sticker hash mismatch, ignoring", id);
        return null;
      }
      try {
        await this.deps.store.put({ id, kind: file.kind ?? kind, b64: file.b64, lastUsedAt: this.now() });
      } catch (err) {
        console.error("[relay] sticker cache write failed", err);
      }
      return file.b64;
    } catch (err) {
      console.error("[relay] sticker download failed", err);
      return null;
    }
  }

  // ---- outgoing ------------------------------------------------------------

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  private envelope(fields: Pick<Envelope, "t"> & Partial<Envelope>): Envelope {
    return {
      v: 1,
      id: (this.deps.newId ?? (() => crypto.randomUUID()))(),
      author: this.settings?.displayName.trim().slice(0, 64) || t(DEFAULT_AUTHOR),
      sid: this.deps.senderId,
      at: this.now(),
      ...fields,
    };
  }

  private async reportResult(result: SendResult): Promise<void> {
    await this.deps.invoke("tg_send_result", { result });
  }

  private async deliver(requestId: string, kind: SendKind, envelope: Envelope): Promise<void> {
    const session = this.session;
    if (!session?.connection.connected) {
      await this.reportResult({
        requestId,
        kind,
        ok: false,
        error: session?.connection.recovering
          ? "Сообщение не отправлено, связь восстанавливается"
          : "Сервер не подключён",
      });
      return;
    }
    try {
      const data = await encryptEnvelope(session.keys, envelope);
      await session.connection.send(data);
      await this.reportResult({ requestId, kind, ok: true, messageId: envelope.id });
    } catch (err) {
      await this.reportResult({
        requestId,
        kind,
        ok: false,
        error: err instanceof Error && err.message ? err.message : "Сервер не подтвердил отправку",
      });
    }
  }

  private async onSendText(evt: SendTextEvent): Promise<void> {
    await this.deliver(evt.requestId, "text", this.envelope({ t: "text", text: evt.text }));
  }

  private async onDirection(evt: DirectionEvent): Promise<void> {
    await this.deliver(evt.requestId, "direction", this.envelope({ t: "direction", direction: evt.direction }));
  }

  private async onPhrase(evt: PhraseEvent): Promise<void> {
    await this.deliver(evt.requestId, "phrase", this.envelope({ t: "phrase", phrase: evt.phrase }));
  }

  private async onSendSticker(evt: SendStickerEvent): Promise<void> {
    const kind = this.stickerKinds.get(evt.fileId);
    if (!kind) {
      await this.reportResult({ requestId: evt.requestId, kind: "sticker", ok: false, error: "Стикер ещё не готов к отправке" });
      return;
    }
    await this.deliver(evt.requestId, "sticker", this.envelope({ t: "sticker", sticker: { id: evt.fileId, kind } }));
  }

  private async onSendFile(evt: SendFileEvent): Promise<void> {
    const match = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/is.exec(evt.dataUrl);
    if (!match) {
      await this.reportResult({ requestId: evt.requestId, kind: "file", ok: false, error: "Можно отправить только картинку" });
      return;
    }
    const [, mime, b64] = match;
    const bytes = Math.floor((b64.length * 3) / 4);
    if (bytes > MAX_RELAY_IMAGE_BYTES) {
      await this.reportResult({ requestId: evt.requestId, kind: "file", ok: false, error: "Картинка больше 800 КБ — свой сервер такие не пропускает" });
      return;
    }
    await this.deliver(evt.requestId, "file", this.envelope({
      t: "image",
      image: { mime: mime.toLowerCase(), b64 },
      ...(evt.caption ? { text: evt.caption } : {}),
    }));
  }

  // ---- sticker picker ------------------------------------------------------

  private async publishStickers(packs: StickerPack[], phase: "metadata" | "previews" | "complete", error?: string): Promise<void> {
    await this.deps.invoke("tg_stickers", { payload: { packs, phase, ...(error ? { error } : {}) } });
  }

  private async onStickersRequest(refresh: boolean): Promise<void> {
    const session = this.session;
    if (!session?.connection.connected) {
      await this.publishStickers([], "complete", "Подключитесь к серверу и повторите");
      return;
    }
    const generation = this.generation;
    let index: StickerIndex;
    try {
      index = this.stickerIndex && !refresh ? this.stickerIndex : await session.connection.stickerIndex();
    } catch (err) {
      console.error("[relay] sticker index failed", err);
      await this.publishStickers([], "complete", "Не удалось загрузить стикеры");
      return;
    }
    if (generation !== this.generation) return;
    this.stickerIndex = index;

    let packs: StickerPack[] = index.packs.map((pack) => ({
      id: pack.id,
      title: pack.title,
      stickers: pack.stickers.map((sticker) => {
        this.stickerKinds.set(sticker.id, sticker.kind);
        return { fileId: sticker.id, emoji: sticker.emoji, kind: sticker.kind, documentReady: true };
      }),
    }));

    const all = index.packs.flatMap((pack) => pack.stickers);
    const previews = new Map<string, string>();
    for (const sticker of all) {
      const b64 = await this.loadSticker(sticker.id, sticker.kind, false);
      if (b64) previews.set(sticker.id, stickerDataUrl({ kind: sticker.kind, b64 }));
    }
    const withPreviews = () => packs.map((pack) => ({
      ...pack,
      stickers: pack.stickers.map((sticker) => {
        const dataUrl = previews.get(sticker.fileId);
        return dataUrl ? { ...sticker, dataUrl } : sticker;
      }),
    }));
    packs = withPreviews();
    await this.publishStickers(packs, "metadata");

    const missing = all.filter((sticker) => !previews.has(sticker.id));
    for (let offset = 0; offset < missing.length; offset += STICKER_FETCH_CONCURRENCY * 4) {
      const batch = missing.slice(offset, offset + STICKER_FETCH_CONCURRENCY * 4);
      await runLimited(batch, STICKER_FETCH_CONCURRENCY, async (sticker) => {
        const b64 = await this.loadSticker(sticker.id, sticker.kind, true);
        if (b64) previews.set(sticker.id, stickerDataUrl({ kind: sticker.kind, b64 }));
      });
      if (generation !== this.generation) return;
      packs = withPreviews();
      await this.publishStickers(packs, "previews");
    }
    await this.publishStickers(withPreviews(), "complete");
  }
}

/**
 * A TGS sticker is gzipped JSON the overlay inflates; like Telegram, refuse
 * one over 64 KiB, whichever side (the envelope or the file) calls it TGS.
 */
function acceptableSticker(kind: RelayStickerKind, fileKind: RelayStickerKind | undefined, b64: string): boolean {
  if (kind !== "tgs" && fileKind !== "tgs") return true;
  return base64ByteLength(b64) <= MAX_TGS_BYTES;
}

function base64ByteLength(b64: string): number {
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

async function runLimited<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await task(item);
    }
  });
  await Promise.all(runners);
}

/** A random id that survives restarts, so this install recognises its own messages in history. */
export function persistentSenderId(storage: Pick<Storage, "getItem" | "setItem"> | null): string {
  const key = "tgo-relay-sender-id";
  try {
    const existing = storage?.getItem(key);
    if (existing) return existing;
    const created = bytesToBase64(crypto.getRandomValues(new Uint8Array(12)));
    storage?.setItem(key, created);
    return created;
  } catch {
    return bytesToBase64(crypto.getRandomValues(new Uint8Array(12)));
  }
}
