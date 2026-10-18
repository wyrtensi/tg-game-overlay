// Two relay workers talk through a real relay server (server/src) over real
// WebSockets: the full path from a tg:* event to the other overlay.
import { afterEach, describe, expect, it, vi } from "vitest";
import { authProof, bytesToBase64, deriveRoomKeys, sha256Hex } from "./crypto";
import { MemoryStickerStore } from "./sticker-store";
import { RelayWorker, type RelayWorkerConfig } from "./worker";
// @ts-expect-error plain JavaScript test helper from the server package
import { ACCESS_KEY, ADMIN_KEY, Client, startRelay } from "../../server/test/helpers.js";

interface Relay {
  url: string;
  stop(): Promise<void>;
  cleanup(): void;
}

const running: { relay: Relay; workers: RelayWorker[] }[] = [];

afterEach(async () => {
  for (const item of running.splice(0)) {
    for (const worker of item.workers) worker.stop();
    await item.relay.stop();
    item.relay.cleanup();
  }
});

function makeWorker(url: string, name: string, room = "Squad", password = "pass") {
  const listeners = new Map<string, (payload: unknown) => void>();
  const calls: { command: string; args?: Record<string, unknown> }[] = [];
  const config: RelayWorkerConfig = { transport: "relay", relay: { url, room, displayName: name } };
  const worker = new RelayWorker({
    invoke: async <T,>(command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args });
      if (command === "relay_credentials") return { accessKey: ACCESS_KEY, password } as T;
      if (command === "get_config") return config as T;
      return undefined as T;
    },
    listen: async (event, handler) => {
      listeners.set(event, handler as (payload: unknown) => void);
    },
    store: new MemoryStickerStore(),
    senderId: `sid-${name}`,
    deriveKeys: (roomName, roomPassword) => deriveRoomKeys(roomName, roomPassword, 1000),
  });
  const emit = (event: string, payload: unknown) => listeners.get(event)?.(payload);
  const statuses = () => calls.filter((call) => call.command === "tg_status").map((call) => (call.args?.status as { state: string }).state);
  const messages = () => calls.filter((call) => call.command === "push_message").map((call) => call.args?.message as Record<string, unknown>);
  return { worker, emit, calls, statuses, messages };
}

describe("relay end to end", () => {
  it("delivers encrypted text and stickers between two overlays in one room", async () => {
    const relay: Relay = await startRelay();
    const alex = makeWorker(relay.url, "Alex");
    const sam = makeWorker(relay.url, "Sam");
    const stranger = makeWorker(relay.url, "Eve", "Squad", "wrong");
    running.push({ relay, workers: [alex.worker, sam.worker, stranger.worker] });

    // The owner uploads one sticker with the admin key.
    const bytes = new TextEncoder().encode("RIFF....WEBPVP8 fake sticker");
    const stickerId = await sha256Hex(bytes);
    const admin = new Client(relay.url);
    const challenge = await admin.next("challenge");
    admin.send({ type: "auth", role: "admin", proof: await authProof(ADMIN_KEY, challenge.nonce, "admin") });
    await admin.next("ready");
    admin.send({ type: "sticker_put", pack: "Friends", kind: "webp", emoji: "😂", b64: bytesToBase64(bytes) });
    expect(await admin.next("sticker_put")).toMatchObject({ id: stickerId, created: true });
    admin.ws.close();

    await Promise.all([alex.worker.start(), sam.worker.start(), stranger.worker.start()]);
    await vi.waitFor(() => {
      expect(alex.statuses()).toContain("connected");
      expect(sam.statuses()).toContain("connected");
      expect(stranger.statuses()).toContain("connected");
    }, { timeout: 5000 });

    alex.emit("tg:send", { requestId: "r1", text: "enemy on the left" });
    await vi.waitFor(() => expect(sam.messages().some((m) => m.text === "enemy on the left")).toBe(true), { timeout: 5000 });
    expect(sam.messages().find((m) => m.text === "enemy on the left")).toMatchObject({ author: "Alex" });
    expect(sam.messages().find((m) => m.text === "enemy on the left")?.outgoing).toBeUndefined();
    await vi.waitFor(() => expect(alex.calls.some((call) => call.command === "tg_send_result")).toBe(true));
    expect(alex.messages().find((m) => m.text === "enemy on the left")).toMatchObject({ outgoing: true });

    // Sam opens the picker (downloads and verifies the sticker), then sends it.
    sam.emit("tg:stickers_request", { refresh: false });
    await vi.waitFor(() => {
      const last = sam.calls.filter((call) => call.command === "tg_stickers").slice(-1)[0];
      expect((last?.args?.payload as { phase: string } | undefined)?.phase).toBe("complete");
    }, { timeout: 5000 });
    sam.emit("tg:send_sticker", { requestId: "s1", fileId: stickerId });
    await vi.waitFor(() => expect(alex.messages().some((m) => m.media)).toBe(true), { timeout: 5000 });
    expect(alex.messages().find((m) => m.media)?.media).toMatchObject({ kind: "webp", mimeType: "image/webp" });

    // A wrong room password lands in a different room: nothing leaks across.
    expect(stranger.messages()).toEqual([]);
  }, 20_000);
});
