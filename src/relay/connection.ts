// WebSocket client for the relay server (server/PROTOCOL.md): challenge auth,
// reconnect with backoff, correlated sends and sticker catalog requests.

import { authProof } from "./crypto";

export interface StoredMessage {
  seq: number;
  at: number;
  data: string;
  cid?: string;
}

export interface StickerIndexEntry {
  id: string;
  kind: "tgs" | "webp" | "webm";
  emoji?: string;
  size: number;
}

export interface StickerIndex {
  version: string;
  packs: { id: string; title: string; stickers: StickerIndexEntry[] }[];
}

export interface StickerFile {
  id: string;
  kind: "tgs" | "webp" | "webm";
  b64: string;
}

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "error" | "offline";

export interface ConnectionStatus {
  state: ConnectionState;
  error?: string;
  reconnectAttempt?: number;
  waitSeconds?: number;
}

/** The subset of the browser WebSocket this client uses; tests pass a fake. */
export interface SocketLike {
  readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface RelayConnectionOptions {
  url: string;
  accessKey: string;
  roomId: string;
  onStatus: (status: ConnectionStatus) => void;
  /** Every stored message, oldest first; `fromHistory` marks the handshake backlog. */
  onMessage: (message: StoredMessage, fromHistory: boolean) => void;
  createSocket?: (url: string) => SocketLike;
  sendTimeoutMs?: number;
  requestTimeoutMs?: number;
  random?: () => number;
}

const OPEN = 1;
const MAX_BACKOFF_MS = 30_000;

interface Pending<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class RelayError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

const ERROR_TEXT: Record<string, string> = {
  auth_failed: "Неверный ключ доступа к серверу",
  bad_request: "Сервер отклонил запрос",
  too_large: "Слишком большое сообщение для сервера",
  rate_limited: "Слишком часто, подождите немного",
  not_found: "Не найдено на сервере",
  forbidden: "Нет прав на это действие",
  busy: "Сервер перегружен, повторим позже",
};

export function relayErrorText(code: string, fallback?: string): string {
  return ERROR_TEXT[code] ?? fallback ?? `Ошибка сервера: ${code}`;
}

/** Accepts "host:port", "ws://host:port" or "ws://host:port/ws" and returns the WebSocket endpoint. */
export function normalizeServerUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const withScheme = /^[a-z]+:\/\//i.test(value) ? value : `ws://${value}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol === "https:") url.protocol = "wss:";
  if (url.protocol !== "ws:" && url.protocol !== "wss:") return null;
  if (!url.hostname) return null;
  if (url.pathname === "/" || url.pathname === "") url.pathname = "/ws";
  url.hash = "";
  url.search = "";
  return url.toString();
}

export class RelayConnection {
  private socket: SocketLike | null = null;
  private stopped = true;
  private authenticated = false;
  private lastSeq: number | null = null;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly sends = new Map<string, Pending<StoredMessage>>();
  private readonly stickerRequests = new Map<string, { promise: Promise<StickerFile>; pending: Pending<StickerFile> }>();
  private indexRequest: { promise: Promise<StickerIndex>; pending: Pending<StickerIndex> } | null = null;
  private cidCounter = 0;
  /** Set after a wrong access key: automatic retries stop, a manual retry may resume. */
  private authFailed = false;
  /** Server-side reason for the last drop, shown with the next reconnect status. */
  private dropReason: string | null = null;

  constructor(private readonly options: RelayConnectionOptions) {}

  get connected(): boolean {
    return this.authenticated && this.socket?.readyState === OPEN;
  }

  get recovering(): boolean {
    return !this.stopped && !this.authenticated;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempt = 0;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    this.clearReconnect();
    const socket = this.socket;
    this.socket = null;
    this.authenticated = false;
    if (socket) {
      socket.onclose = null;
      socket.close(1000, "stop");
    }
    this.failPending("Связь с сервером закрыта");
    this.options.onStatus({ state: "offline" });
  }

  /** Skips the remaining backoff delay, or tries again after a rejected access key. */
  retryNow(): void {
    if (this.authFailed) {
      this.authFailed = false;
      this.stopped = false;
      this.attempt = 0;
      this.open();
      return;
    }
    if (this.stopped || this.socket) return;
    this.clearReconnect();
    this.open();
  }

  send(data: string): Promise<StoredMessage> {
    if (!this.connected) return Promise.reject(new Error("Сервер не подключён"));
    const cid = `c${Date.now().toString(36)}${(this.cidCounter += 1).toString(36)}`;
    return new Promise<StoredMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.sends.delete(cid);
        reject(new Error("Сервер не подтвердил отправку"));
        // No echo usually means a silently dead link: reconnect and resync via `since`.
        this.socket?.close(4000, "send timeout");
      }, this.options.sendTimeoutMs ?? 15_000);
      this.sends.set(cid, { resolve, reject, timer });
      this.write({ type: "send", cid, data });
    });
  }

  stickerIndex(): Promise<StickerIndex> {
    if (!this.connected) return Promise.reject(new Error("Сервер не подключён"));
    if (this.indexRequest) return this.indexRequest.promise;
    let pending!: Pending<StickerIndex>;
    const promise = new Promise<StickerIndex>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.indexRequest = null;
        reject(new Error("Сервер не прислал список стикеров"));
      }, this.options.requestTimeoutMs ?? 20_000);
      pending = { resolve, reject, timer };
    });
    this.indexRequest = { promise, pending };
    this.write({ type: "stickers_index" });
    return promise;
  }

  sticker(id: string): Promise<StickerFile> {
    if (!this.connected) return Promise.reject(new Error("Сервер не подключён"));
    const existing = this.stickerRequests.get(id);
    if (existing) return existing.promise;
    let pending!: Pending<StickerFile>;
    const promise = new Promise<StickerFile>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.stickerRequests.delete(id);
        reject(new Error("Сервер не прислал стикер"));
      }, this.options.requestTimeoutMs ?? 20_000);
      pending = { resolve, reject, timer };
    });
    this.stickerRequests.set(id, { promise, pending });
    this.write({ type: "sticker_get", id });
    return promise;
  }

  private open(): void {
    if (this.stopped) return;
    this.options.onStatus(this.attempt === 0 ? { state: "connecting" } : { state: "reconnecting", reconnectAttempt: this.attempt });
    let socket: SocketLike;
    try {
      socket = (this.options.createSocket ?? ((url) => new WebSocket(url) as unknown as SocketLike))(this.options.url);
    } catch (err) {
      this.scheduleReconnect(err instanceof Error ? err.message : "Не удалось открыть соединение");
      return;
    }
    this.socket = socket;
    this.authenticated = false;
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      void this.onFrame(socket, event.data);
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      const wasAuthenticated = this.authenticated;
      this.authenticated = false;
      this.failPending("Связь с сервером потеряна, сообщение не отправлено");
      if (wasAuthenticated) this.attempt = 0;
      this.scheduleReconnect();
    };
    socket.onerror = () => {
      // onclose follows and owns the reconnect.
    };
  }

  private async onFrame(socket: SocketLike, raw: unknown): Promise<void> {
    if (typeof raw !== "string") return;
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    switch (frame.type) {
      case "challenge": {
        if (typeof frame.nonce !== "string") return;
        const proof = await authProof(this.options.accessKey, frame.nonce);
        if (this.socket !== socket) return;
        this.write({ type: "auth", role: "client", proof, room: this.options.roomId, since: this.lastSeq });
        return;
      }
      case "ready": {
        this.authenticated = true;
        this.attempt = 0;
        // A server that lost its data restarts numbering; follow it down.
        if (typeof frame.seq === "number" && this.lastSeq !== null && frame.seq < this.lastSeq) this.lastSeq = null;
        const history = Array.isArray(frame.history) ? frame.history : [];
        for (const item of history) this.deliver(item, true);
        if (typeof frame.seq === "number" && this.lastSeq === null) this.lastSeq = frame.seq;
        this.options.onStatus({ state: "connected" });
        return;
      }
      case "msg": {
        const stored = this.deliver(frame, false);
        if (stored && typeof frame.cid === "string") {
          const pending = this.sends.get(frame.cid);
          if (pending) {
            this.sends.delete(frame.cid);
            clearTimeout(pending.timer);
            pending.resolve(stored);
          }
        }
        return;
      }
      case "stickers_index": {
        const request = this.indexRequest;
        this.indexRequest = null;
        if (!request) return;
        clearTimeout(request.pending.timer);
        request.pending.resolve({
          version: typeof frame.version === "string" ? frame.version : "",
          packs: Array.isArray(frame.packs) ? (frame.packs as StickerIndex["packs"]) : [],
        });
        return;
      }
      case "sticker": {
        if (typeof frame.id !== "string") return;
        const request = this.stickerRequests.get(frame.id);
        if (!request) return;
        this.stickerRequests.delete(frame.id);
        clearTimeout(request.pending.timer);
        request.pending.resolve({ id: frame.id, kind: frame.kind as StickerFile["kind"], b64: String(frame.b64 ?? "") });
        return;
      }
      case "error":
        this.onError(frame);
        return;
      default:
        return;
    }
  }

  private onError(frame: Record<string, unknown>): void {
    const code = typeof frame.code === "string" ? frame.code : "unknown";
    const error = new RelayError(code, relayErrorText(code, typeof frame.message === "string" ? frame.message : undefined));
    if (code === "busy") {
      this.dropReason = error.message;
      return;
    }
    if (code === "auth_failed") {
      // A wrong key does not fix itself: stop instead of hammering the server.
      this.authFailed = true;
      this.stopped = true;
      this.clearReconnect();
      const socket = this.socket;
      this.socket = null;
      this.authenticated = false;
      if (socket) {
        socket.onclose = null;
        socket.close(1000, "auth_failed");
      }
      this.failPending(error.message);
      this.options.onStatus({ state: "error", error: error.message });
      return;
    }
    if (typeof frame.cid === "string") {
      const pending = this.sends.get(frame.cid);
      if (pending) {
        this.sends.delete(frame.cid);
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      return;
    }
    if (typeof frame.id === "string") {
      const request = this.stickerRequests.get(frame.id);
      if (request) {
        this.stickerRequests.delete(frame.id);
        clearTimeout(request.pending.timer);
        request.pending.reject(error);
      }
      return;
    }
    if (frame.request === "stickers_index" && this.indexRequest) {
      const request = this.indexRequest;
      this.indexRequest = null;
      clearTimeout(request.pending.timer);
      request.pending.reject(error);
    }
  }

  private deliver(item: unknown, fromHistory: boolean): StoredMessage | null {
    if (!item || typeof item !== "object") return null;
    const frame = item as Record<string, unknown>;
    if (typeof frame.seq !== "number" || typeof frame.at !== "number" || typeof frame.data !== "string") return null;
    const stored: StoredMessage = { seq: frame.seq, at: frame.at, data: frame.data };
    if (typeof frame.cid === "string") stored.cid = frame.cid;
    if (this.lastSeq === null || stored.seq > this.lastSeq) this.lastSeq = stored.seq;
    this.options.onMessage(stored, fromHistory);
    return stored;
  }

  private write(frame: Record<string, unknown>): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== OPEN) return;
    socket.send(JSON.stringify(frame));
  }

  private scheduleReconnect(error?: string): void {
    if (this.stopped) return;
    this.clearReconnect();
    this.attempt += 1;
    const base = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (this.attempt - 1));
    const delay = Math.round(base * (0.75 + (this.options.random ?? Math.random)() * 0.5));
    const reason = error ?? this.dropReason;
    this.dropReason = null;
    this.options.onStatus({
      state: "reconnecting",
      reconnectAttempt: this.attempt,
      waitSeconds: Math.ceil(delay / 1000),
      ...(reason ? { error: reason } : {}),
    });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private failPending(message: string): void {
    for (const [cid, pending] of this.sends) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
      this.sends.delete(cid);
    }
    for (const [id, request] of this.stickerRequests) {
      clearTimeout(request.pending.timer);
      request.pending.reject(new Error(message));
      this.stickerRequests.delete(id);
    }
    if (this.indexRequest) {
      clearTimeout(this.indexRequest.pending.timer);
      this.indexRequest.pending.reject(new Error(message));
      this.indexRequest = null;
    }
  }
}
