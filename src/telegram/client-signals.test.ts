import { beforeEach, describe, expect, test, vi } from "vitest";

const calls: { command: string; args?: Record<string, unknown> }[] = [];

vi.mock("./tauri", () => ({
  safeInvoke: async (command: string, args?: Record<string, unknown>) => {
    calls.push({ command, args });
    return undefined;
  },
  safeListen: async () => () => {},
  hasTauri: () => true,
}));

const { TelegramWorker } = await import("./client");

interface FakeMessage {
  id: number;
  message: string;
  date: number;
  out: boolean;
  editDate?: number;
  sender: { firstName: string };
  photo?: { className: "Photo"; id: { toString(): string }; sizes: never[] };
}

interface Subject {
  chat: unknown;
  client: unknown;
  phraseMessageIds: Set<string>;
  pushedIds: Map<string, number>;
  pushHistory: (generation?: number, background?: boolean) => Promise<void>;
  pushMessage: (message: FakeMessage, generation?: number, source?: string) => Promise<void>;
}

function message(id: number, text: string, extra: Partial<FakeMessage> = {}): FakeMessage {
  return { id, message: text, date: 1_700_000_000 + id, out: false, sender: { firstName: "Ada" }, ...extra };
}

function setup(history: FakeMessage[]) {
  const downloads: unknown[] = [];
  const subject = new TelegramWorker() as unknown as Subject;
  subject.chat = { kind: "user", id: "123", accessHash: "456", title: "Ada" };
  subject.client = {
    connected: true,
    // Telegram answers newest first.
    getMessages: async () => [...history].reverse(),
    downloadMedia: async (item: unknown) => {
      downloads.push(item);
      return new Uint8Array([1, 2, 3]);
    },
  };
  return { subject, downloads };
}

const commands = (name: string) => calls.filter((call) => call.command === name);
const pushed = () => commands("push_message").map((call) => call.args?.message as { id: string; media?: unknown });

describe("TelegramWorker signals", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  test("history and backfill never replay a direction or a phrase", async () => {
    const { subject } = setup([message(1, "⬆️"), message(2, "Вперёд"), message(3, "hello")]);
    subject.phraseMessageIds.add("2");

    await subject.pushHistory();
    await subject.pushHistory(undefined, true);

    expect(commands("tg_direction")).toEqual([]);
    expect(commands("tg_phrase")).toEqual([]);
    expect(pushed().map((item) => item.id)).toEqual(["3"]);
  });

  test("a live direction or phrase is still shown", async () => {
    const { subject } = setup([]);
    subject.phraseMessageIds.add("2");

    await subject.pushMessage(message(1, "➡️"));
    await subject.pushMessage(message(2, "Вперёд"), undefined, "edit");

    expect(commands("tg_direction").map((call) => (call.args?.payload as { direction: string }).direction)).toEqual(["right"]);
    expect(commands("tg_phrase").map((call) => (call.args?.payload as { phrase: string }).phrase)).toEqual(["Вперёд"]);
  });
});

describe("TelegramWorker history re-push", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  const photo = { className: "Photo" as const, id: { toString: () => "77" }, sizes: [] as never[] };

  test("a backfill pushes only new or edited messages", async () => {
    const history = [message(1, "hello"), message(2, "", { photo })];
    const { subject, downloads } = setup(history);
    await subject.pushHistory();
    await vi.waitFor(() => expect(pushed().some((item) => item.media)).toBe(true));
    calls.length = 0;

    await subject.pushHistory(undefined, true);
    expect(pushed()).toEqual([]);

    history[0] = message(1, "hello, edited", { editDate: 1_700_000_100 });
    await subject.pushHistory(undefined, true);
    expect(pushed().map((item) => item.id)).toEqual(["1"]);
    expect(downloads).toHaveLength(1);
  });

  test("a reloaded overlay gets the media again without a second download", async () => {
    const { subject, downloads } = setup([message(2, "", { photo })]);
    await subject.pushHistory();
    await vi.waitFor(() => expect(pushed().some((item) => item.media)).toBe(true));
    calls.length = 0;

    // What tg:history_request does before asking for history again.
    subject.pushedIds.clear();
    await subject.pushHistory();

    expect(downloads).toHaveLength(1);
    expect(pushed()).toHaveLength(1);
    expect(pushed()[0].media).toMatchObject({ kind: "photo", dataUrl: "data:image/jpeg;base64,AQID" });
  });
});
