import { describe, expect, it, vi } from "vitest";
import { bytesToBase64, deriveRoomKeys, encryptEnvelope, sha256Hex, type Envelope, type RoomKeys } from "./crypto";
import type { RelayConnectionOptions, StickerFile, StoredMessage } from "./connection";
import { MemoryStickerStore } from "./sticker-store";
import { MAX_RELAY_IMAGE_BYTES, RelayWorker, settingsKey, type RelayConnectionLike, type RelayWorkerConfig } from "./worker";

const SETTINGS = { url: "203.0.113.10:8790", room: "Squad", displayName: "Alex" };
const CREDS = { accessKey: "access-key-0123456789", password: "secret" };

class FakeConnection implements RelayConnectionLike {
  connected = false;
  recovering = false;
  started = false;
  stopped = false;
  sent: string[] = [];
  stickers = new Map<string, StickerFile>();
  seq = 0;

  constructor(readonly options: RelayConnectionOptions) {}

  start(): void {
    this.started = true;
  }

  stop(): void {
    this.stopped = true;
  }

  retryNow(): void {}

  async send(data: string): Promise<StoredMessage> {
    this.sent.push(data);
    const stored = { seq: (this.seq += 1), at: 1000 + this.seq, data };
    this.options.onMessage(stored, false);
    return stored;
  }

  async stickerIndex() {
    return { version: "v", packs: [{ id: "p", title: "Pack", stickers: [...this.stickers.values()].map((s) => ({ id: s.id, kind: s.kind, size: 1 })) }] };
  }

  async sticker(id: string): Promise<StickerFile> {
    const file = this.stickers.get(id);
    if (!file) throw new Error("missing");
    return file;
  }

  goOnline(history: StoredMessage[] = []): void {
    this.connected = true;
    for (const item of history) this.options.onMessage(item, true);
    this.options.onStatus({ state: "connected" });
  }
}

async function setup(config: RelayWorkerConfig = { transport: "relay", relay: SETTINGS }) {
  const listeners = new Map<string, (payload: unknown) => void>();
  const calls: { command: string; args?: Record<string, unknown> }[] = [];
  let currentConfig = config;
  const connections: FakeConnection[] = [];
  let keys: RoomKeys | null = null;
  const store = new MemoryStickerStore();
  let counter = 0;
  const worker = new RelayWorker({
    invoke: async <T,>(command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args });
      if (command === "relay_credentials") return CREDS as T;
      if (command === "get_config") return currentConfig as T;
      return undefined as T;
    },
    listen: async (event, handler) => {
      listeners.set(event, handler as (payload: unknown) => void);
    },
    store,
    senderId: "me",
    deriveKeys: async (room, password) => (keys = await deriveRoomKeys(room, password, 1000)),
    createConnection: (options) => {
      const connection = new FakeConnection(options);
      connections.push(connection);
      return connection;
    },
    newId: () => `id-${(counter += 1)}`,
    now: () => 5,
  });
  await worker.start();
  const emit = (event: string, payload: unknown = {}) => listeners.get(event)?.(payload);
  const setConfig = (next: RelayWorkerConfig) => {
    currentConfig = next;
    emit("config:changed", next);
  };
  return { worker, calls, connections, store, emit, setConfig, keys: () => keys as RoomKeys };
}

function pushed(calls: { command: string; args?: Record<string, unknown> }[]) {
  return calls.filter((call) => call.command === "push_message").map((call) => call.args?.message as Record<string, unknown>);
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("settingsKey", () => {
  it("needs every field", () => {
    expect(settingsKey(SETTINGS, CREDS)).not.toBeNull();
    expect(settingsKey({ ...SETTINGS, url: "" }, CREDS)).toBeNull();
    expect(settingsKey(SETTINGS, { ...CREDS, password: null })).toBeNull();
  });
});

describe("RelayWorker", () => {
  it("stays silent while Telegram is the transport", async () => {
    const { calls, connections, emit } = await setup({ transport: "telegram", relay: SETTINGS });
    emit("tg:send", { requestId: "r1", text: "hi" });
    await flush();
    expect(connections).toHaveLength(0);
    expect(calls.some((call) => call.command === "tg_status" || call.command === "tg_send_result")).toBe(false);
  });

  it("connects to the derived room and reports status", async () => {
    const { calls, connections, keys } = await setup();
    expect(connections).toHaveLength(1);
    expect(connections[0].options.roomId).toBe(keys().roomId);
    expect(connections[0].options.url).toBe("ws://203.0.113.10:8790/ws");
    connections[0].goOnline();
    await flush();
    expect(calls.filter((call) => call.command === "tg_status").map((call) => call.args?.status)).toEqual([
      { state: "connecting" },
      { state: "connected" },
    ]);
  });

  it("shows history messages, marks its own and skips stale signals", async () => {
    const { calls, connections, keys } = await setup();
    const encrypt = (envelope: Envelope) => encryptEnvelope(keys(), envelope);
    connections[0].goOnline([
      { seq: 1, at: 100, data: await encrypt({ v: 1, id: "a", author: "Sam", at: 1, t: "text", text: "hello" }) },
      { seq: 2, at: 101, data: await encrypt({ v: 1, id: "b", author: "Alex", sid: "me", at: 2, t: "text", text: "mine" }) },
      { seq: 3, at: 102, data: await encrypt({ v: 1, id: "c", author: "Sam", at: 3, t: "direction", direction: "up" }) },
      { seq: 4, at: 103, data: "garbage" },
    ]);
    await vi.waitFor(() => expect(pushed(calls)).toHaveLength(2));
    expect(pushed(calls)).toEqual([
      { id: "a", author: "Sam", text: "hello", at: 100 },
      { id: "b", author: "Alex", text: "mine", at: 101, outgoing: true },
    ]);
    expect(calls.some((call) => call.command === "tg_direction")).toBe(false);
  });

  it("keeps arrival order even when a sticker needs a cache lookup", async () => {
    const { calls, connections, keys } = await setup();
    const encrypt = (envelope: Envelope) => encryptEnvelope(keys(), envelope);
    connections[0].goOnline([
      { seq: 1, at: 100, data: await encrypt({ v: 1, id: "s", author: "Sam", at: 1, t: "sticker", sticker: { id: "a".repeat(64), kind: "webp" } }) },
      { seq: 2, at: 101, data: await encrypt({ v: 1, id: "t", author: "Sam", at: 2, t: "text", text: "after" }) },
    ]);
    await vi.waitFor(() => expect(pushed(calls).length).toBeGreaterThanOrEqual(2));
    expect(pushed(calls).map((message) => message.id).slice(0, 2)).toEqual(["s", "t"]);
  });

  it("sends an encrypted text and confirms it after the echo", async () => {
    const { calls, connections, emit } = await setup();
    connections[0].goOnline();
    emit("tg:send", { requestId: "r1", text: "привет" });
    await vi.waitFor(() => expect(calls.some((call) => call.command === "tg_send_result")).toBe(true));
    expect(atob(connections[0].sent[0])).not.toContain("привет");
    expect(pushed(calls)).toEqual([{ id: "id-1", author: "Alex", text: "привет", at: 1001, outgoing: true }]);
    expect(calls.find((call) => call.command === "tg_send_result")?.args?.result).toEqual({
      requestId: "r1", kind: "text", ok: true, messageId: "id-1",
    });
  });

  it("relays live directions as signals", async () => {
    const { calls, connections, emit } = await setup();
    connections[0].goOnline();
    emit("tg:direction", { requestId: "d1", direction: "left", at: 1 });
    await vi.waitFor(() => expect(calls.some((call) => call.command === "tg_direction")).toBe(true));
    expect(calls.find((call) => call.command === "tg_direction")?.args?.payload).toMatchObject({
      messageId: "id-1", author: "Alex", direction: "left", outgoing: true,
    });
  });

  it("reports a failed send while offline", async () => {
    const { calls, emit } = await setup();
    emit("tg:send", { requestId: "r1", text: "hi" });
    await vi.waitFor(() => expect(calls.some((call) => call.command === "tg_send_result")).toBe(true));
    expect(calls.find((call) => call.command === "tg_send_result")?.args?.result).toMatchObject({ ok: false });
  });

  it("downloads stickers once, verifies them and serves the cache afterwards", async () => {
    const { calls, connections, emit, store } = await setup();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const id = await sha256Hex(bytes);
    connections[0].stickers.set(id, { id, kind: "webp", b64: bytesToBase64(bytes) });
    const bogus = "f".repeat(64);
    connections[0].stickers.set(bogus, { id: bogus, kind: "webp", b64: bytesToBase64(bytes) });
    connections[0].goOnline();
    emit("tg:stickers_request", { refresh: false });
    await vi.waitFor(() => {
      const last = calls.filter((call) => call.command === "tg_stickers").slice(-1)[0];
      expect((last?.args?.payload as { phase: string }).phase).toBe("complete");
    });
    expect(store.entries.has(id)).toBe(true);
    expect(store.entries.has(bogus)).toBe(false);

    emit("tg:send_sticker", { requestId: "s1", fileId: id });
    await vi.waitFor(() => expect(pushed(calls).some((message) => message.media)).toBe(true));
    expect(pushed(calls).find((message) => message.media)?.media).toMatchObject({ kind: "webp", mimeType: "image/webp" });
  });

  it("refuses TGS stickers over 64 KiB, from the server and from the cache", async () => {
    const { calls, connections, keys, store } = await setup();
    const encrypt = (envelope: Envelope) => encryptEnvelope(keys(), envelope);
    const big = new Uint8Array(64 * 1024 + 1);
    const bigId = await sha256Hex(big);
    connections[0].stickers.set(bigId, { id: bigId, kind: "tgs", b64: bytesToBase64(big) });
    const cachedId = "c".repeat(64);
    store.entries.set(cachedId, { id: cachedId, kind: "tgs", b64: bytesToBase64(big), lastUsedAt: 0 });
    const small = new Uint8Array(64 * 1024);
    const smallId = await sha256Hex(small);
    connections[0].stickers.set(smallId, { id: smallId, kind: "tgs", b64: bytesToBase64(small) });
    connections[0].goOnline();
    for (const [index, id] of [bigId, cachedId, smallId].entries()) {
      connections[0].options.onMessage({
        seq: index + 1,
        at: 100 + index,
        data: await encrypt({ v: 1, id: `s${index}`, author: "Sam", at: 1, t: "sticker", sticker: { id, kind: "tgs" } }),
      }, false);
    }
    await vi.waitFor(() => expect(pushed(calls).some((message) => message.id === "s2" && message.media)).toBe(true));
    expect(pushed(calls).filter((message) => message.media).map((message) => message.id)).toEqual(["s2"]);
    expect(store.entries.has(bigId)).toBe(false);
  });

  it("refuses images over the relay limit", async () => {
    const { calls, connections, emit } = await setup();
    connections[0].goOnline();
    const big = "A".repeat(Math.ceil((MAX_RELAY_IMAGE_BYTES + 10) * 4 / 3));
    emit("tg:send_file", { requestId: "f1", dataUrl: `data:image/png;base64,${big}` });
    await vi.waitFor(() => expect(calls.some((call) => call.command === "tg_send_result")).toBe(true));
    expect(connections[0].sent).toHaveLength(0);
  });

  it("reconnects once per relay settings save, with the reloaded secrets", async () => {
    const { calls, connections, emit, setConfig } = await setup();
    const moved = { ...SETTINGS, url: "203.0.113.20:8790" };
    // set_relay_settings: config:changed first (old secrets still loaded), then relay:settings_changed.
    setConfig({ transport: "relay", relay: moved });
    await flush();
    expect(calls.some((call) => call.command === "reset_overlay_feed")).toBe(false);
    emit("relay:settings_changed");
    await vi.waitFor(() => expect(connections).toHaveLength(2));
    await flush();
    expect(connections).toHaveLength(2);
    expect(connections[1].options.url).toBe("ws://203.0.113.20:8790/ws");
    expect(calls.filter((call) => call.command === "reset_overlay_feed")).toHaveLength(1);
  });

  it("keeps the session when a save does not change the room", async () => {
    const { connections, emit, setConfig } = await setup();
    setConfig({ transport: "relay", relay: { ...SETTINGS, displayName: "Sam" } });
    emit("relay:settings_changed");
    await flush();
    await flush();
    expect(connections).toHaveLength(1);
    expect(connections[0].stopped).toBe(false);
  });

  it("connects when the transport switches to the relay", async () => {
    const { connections, setConfig } = await setup({ transport: "telegram", relay: SETTINGS });
    setConfig({ transport: "relay", relay: SETTINGS });
    await vi.waitFor(() => expect(connections).toHaveLength(1));
  });

  it("disconnects when the transport switches back to Telegram", async () => {
    const { connections, setConfig } = await setup();
    setConfig({ transport: "telegram", relay: SETTINGS });
    await flush();
    expect(connections[0].stopped).toBe(true);
  });
});
