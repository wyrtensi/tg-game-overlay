import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authProof } from "./crypto";
import { normalizeServerUrl, RelayConnection, type ConnectionStatus, type SocketLike, type StoredMessage } from "./connection";

class FakeSocket implements SocketLike {
  readyState = 0;
  onopen: SocketLike["onopen"] = null;
  onmessage: SocketLike["onmessage"] = null;
  onclose: SocketLike["onclose"] = null;
  onerror: SocketLike["onerror"] = null;
  sent: Record<string, unknown>[] = [];
  closed = false;

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
  }

  open(): void {
    this.readyState = 1;
  }

  receive(frame: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  drop(): void {
    this.readyState = 3;
    this.onclose?.({ code: 1006 });
  }
}

const ROOM = "a".repeat(64);
const KEY = "access-key-0123456789";

function setup() {
  const sockets: FakeSocket[] = [];
  const statuses: ConnectionStatus[] = [];
  const messages: StoredMessage[] = [];
  const connection = new RelayConnection({
    url: "ws://relay.test:8790/ws",
    accessKey: KEY,
    roomId: ROOM,
    onStatus: (status) => statuses.push(status),
    onMessage: (message) => messages.push(message),
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    random: () => 0.5,
  });
  return { sockets, statuses, messages, connection };
}

async function handshake(socket: FakeSocket, history: StoredMessage[] = [], seq = 0): Promise<void> {
  socket.open();
  socket.receive({ type: "challenge", v: 1, nonce: "bm9uY2U=" });
  await vi.waitFor(() => expect(socket.sent.some((frame) => frame.type === "auth")).toBe(true));
  socket.receive({ type: "ready", seq, history });
}

describe("normalizeServerUrl", () => {
  it("adds the scheme and the /ws path", () => {
    expect(normalizeServerUrl("203.0.113.10:8790")).toBe("ws://203.0.113.10:8790/ws");
    expect(normalizeServerUrl("ws://example.test:8790")).toBe("ws://example.test:8790/ws");
    expect(normalizeServerUrl("https://example.test/relay/ws")).toBe("wss://example.test/relay/ws");
  });

  it("rejects junk", () => {
    expect(normalizeServerUrl("")).toBeNull();
    expect(normalizeServerUrl("ftp://x")).toBeNull();
    expect(normalizeServerUrl("ws://")).toBeNull();
  });
});

describe("RelayConnection", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("answers the challenge with an HMAC proof and delivers history", async () => {
    const { sockets, statuses, messages, connection } = setup();
    connection.start();
    await handshake(sockets[0], [{ seq: 1, at: 10, data: "AAAA" }], 1);
    const auth = sockets[0].sent.find((frame) => frame.type === "auth");
    expect(auth).toMatchObject({ role: "client", room: ROOM, since: null, proof: await authProof(KEY, "bm9uY2U=") });
    expect(JSON.stringify(auth)).not.toContain(KEY);
    expect(messages).toEqual([{ seq: 1, at: 10, data: "AAAA" }]);
    expect(statuses[statuses.length - 1]).toEqual({ state: "connected" });
    expect(connection.connected).toBe(true);
  });

  it("resolves a send only when the echo with its cid arrives", async () => {
    const { sockets, connection } = setup();
    connection.start();
    await handshake(sockets[0]);
    const pending = connection.send("Q0lQSEVS");
    const frame = sockets[0].sent.find((item) => item.type === "send");
    expect(frame).toMatchObject({ data: "Q0lQSEVS" });
    sockets[0].receive({ type: "msg", seq: 2, at: 20, data: "Q0lQSEVS", cid: frame?.cid });
    await expect(pending).resolves.toMatchObject({ seq: 2 });
  });

  it("rejects a send that the server refuses or never echoes", async () => {
    const { sockets, connection } = setup();
    connection.start();
    await handshake(sockets[0]);
    const refused = connection.send("AAAA");
    const cid = sockets[0].sent.find((item) => item.type === "send")?.cid;
    sockets[0].receive({ type: "error", code: "rate_limited", cid });
    await expect(refused).rejects.toThrow("Слишком часто");

    const silent = connection.send("BBBB");
    const assertion = expect(silent).rejects.toThrow("не подтвердил");
    await vi.advanceTimersByTimeAsync(15_001);
    await assertion;
  });

  it("reconnects with the last seq and fails in-flight sends", async () => {
    const { sockets, statuses, connection } = setup();
    connection.start();
    await handshake(sockets[0], [{ seq: 5, at: 1, data: "AAAA" }], 5);
    const inFlight = connection.send("BBBB");
    sockets[0].drop();
    await expect(inFlight).rejects.toThrow("потеряна");
    expect(statuses[statuses.length - 1]).toMatchObject({ state: "reconnecting", reconnectAttempt: 1, waitSeconds: 1 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets).toHaveLength(2);
    await handshake(sockets[1], [], 5);
    expect(sockets[1].sent.find((frame) => frame.type === "auth")).toMatchObject({ since: 5 });
  });

  it("stops retrying after a wrong access key", async () => {
    const { sockets, statuses, connection } = setup();
    connection.start();
    sockets[0].open();
    sockets[0].receive({ type: "error", code: "auth_failed" });
    expect(statuses[statuses.length - 1]).toEqual({ state: "error", error: "Неверный ключ доступа к серверу" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(1);
  });

  it("lets a manual retry try again after a wrong access key", async () => {
    const { sockets, connection } = setup();
    connection.start();
    sockets[0].open();
    sockets[0].receive({ type: "error", code: "auth_failed" });
    connection.retryNow();
    expect(sockets).toHaveLength(2);
  });

  it("drops the socket when a send is never echoed, so the link is rebuilt", async () => {
    const { sockets, connection } = setup();
    connection.start();
    await handshake(sockets[0]);
    const silent = connection.send("AAAA");
    const assertion = expect(silent).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(15_001);
    await assertion;
    expect(sockets[0].closed).toBe(true);
  });

  it("matches sticker answers and errors by id", async () => {
    const { sockets, connection } = setup();
    connection.start();
    await handshake(sockets[0]);
    const id = "b".repeat(64);
    const first = connection.sticker(id);
    const again = connection.sticker(id);
    expect(sockets[0].sent.filter((frame) => frame.type === "sticker_get")).toHaveLength(1);
    sockets[0].receive({ type: "sticker", id, kind: "webp", b64: "AAAA" });
    await expect(first).resolves.toEqual({ id, kind: "webp", b64: "AAAA" });
    await expect(again).resolves.toEqual({ id, kind: "webp", b64: "AAAA" });

    const missing = connection.sticker("c".repeat(64));
    sockets[0].receive({ type: "error", code: "not_found", id: "c".repeat(64) });
    await expect(missing).rejects.toThrow("Не найдено");
  });

  it("loads the sticker index", async () => {
    const { sockets, connection } = setup();
    connection.start();
    await handshake(sockets[0]);
    const index = connection.stickerIndex();
    sockets[0].receive({ type: "stickers_index", version: "v1", packs: [{ id: "p", title: "P", stickers: [] }] });
    await expect(index).resolves.toEqual({ version: "v1", packs: [{ id: "p", title: "P", stickers: [] }] });
  });
});
