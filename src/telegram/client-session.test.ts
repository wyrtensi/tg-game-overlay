import { beforeEach, describe, expect, test, vi } from "vitest";

const calls: { command: string; args?: Record<string, unknown> }[] = [];

vi.mock("./tauri", () => ({
  safeInvoke: async (command: string, args?: Record<string, unknown>) => {
    calls.push({ command, args });
    return command === "tg_session" ? "saved-session" : undefined;
  },
  safeListen: async () => () => {},
  hasTauri: () => true,
}));

const { TelegramWorker } = await import("./client");

interface Subject {
  apiId: number;
  apiHash: string;
  active: boolean;
  client: unknown;
  connectSavedSession: () => Promise<void>;
  connectWithSession: (session: string) => Promise<void>;
  reconnectNow: () => Promise<{ kind: string }>;
  requireReauthentication: (expected?: unknown) => Promise<void>;
  newClient: (session: string) => unknown;
  logout: () => Promise<void>;
  reconnectLoop: { stop: () => void };
}

/** A GramJS client stand-in whose authorization probe fails with `error`. */
function failingClient(error: unknown) {
  return {
    connected: true,
    connect: async () => {},
    disconnect: async () => {},
    invoke: async () => { throw error; },
    // What GramJS 2.26 answers for any failed probe, whatever the reason.
    checkAuthorization: async () => false,
  };
}

describe("TelegramWorker keeps the saved session", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  test("does not touch the session while no API keys are configured", async () => {
    const subject = new TelegramWorker() as unknown as Subject;
    subject.apiId = 0;
    subject.apiHash = "";

    await subject.connectSavedSession();

    expect(calls.map((call) => call.command)).toEqual(["tg_status"]);
    expect(calls[0].args).toEqual({ status: { state: "offline" } });
  });

  test("a verdict about a replaced client does not clear the session", async () => {
    const subject = new TelegramWorker() as unknown as Subject;
    subject.client = { disconnect: async () => {} };

    await subject.requireReauthentication({ stale: true });

    expect(calls.some((call) => call.command === "tg_clear_session")).toBe(false);
  });

  test("an idle worker (relay selected) never clears the session", async () => {
    const subject = new TelegramWorker() as unknown as Subject;
    const client = { disconnect: async () => {} };
    subject.client = client;
    subject.active = false;

    await subject.requireReauthentication(client);

    expect(calls.some((call) => call.command === "tg_clear_session")).toBe(false);
  });

  test.each([
    ["a wrong api_hash", { errorMessage: "API_ID_INVALID" }],
    ["a flood wait", { errorMessage: "FLOOD_WAIT_30", seconds: 30 }],
    ["a server error", { errorMessage: "INTERNAL_SERVER_ERROR" }],
    ["a timeout", new Error("TIMEOUT")],
  ])("%s right after connect keeps the saved session", async (_name, error) => {
    const subject = new TelegramWorker() as unknown as Subject;
    subject.newClient = () => failingClient(error);

    await subject.connectWithSession("saved-session");
    subject.reconnectLoop.stop();

    expect(calls.some((call) => call.command === "tg_clear_session")).toBe(false);
  });

  test("a wrong api_hash is reported instead of retried", async () => {
    const subject = new TelegramWorker() as unknown as Subject;
    subject.newClient = () => failingClient({ errorMessage: "API_ID_INVALID" });

    await subject.connectWithSession("saved-session");

    expect(subject.client).toBeNull();
    expect(calls[calls.length - 1]?.args).toMatchObject({ status: { state: "error" } });
  });

  test("a revoked session is cleared", async () => {
    const subject = new TelegramWorker() as unknown as Subject;
    subject.newClient = () => failingClient({ errorMessage: "AUTH_KEY_UNREGISTERED" });

    await subject.connectWithSession("saved-session");

    expect(calls.some((call) => call.command === "tg_clear_session")).toBe(true);
  });

  test("a reconnect attempt asks for login only for session authorization errors", async () => {
    const subject = new TelegramWorker() as unknown as Subject;
    subject.client = failingClient({ errorMessage: "FLOOD_WAIT_5", seconds: 5 });
    expect(await subject.reconnectNow()).toEqual({ kind: "retry", floodWaitSeconds: 5 });

    subject.client = failingClient({ errorMessage: "SESSION_REVOKED" });
    expect(await subject.reconnectNow()).toEqual({ kind: "reauth_required" });
  });

  test("logging out clears the overlay feed and sticker picker of the old account", async () => {
    const subject = new TelegramWorker() as unknown as Subject;

    await subject.logout();

    expect(calls.map((call) => call.command)).toEqual(["reset_overlay_feed", "tg_status"]);
  });
});
