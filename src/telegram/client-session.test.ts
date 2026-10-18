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
  requireReauthentication: (expected?: unknown) => Promise<void>;
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
});
