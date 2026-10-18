import { describe, expect, test } from "vitest";
import { TelegramWorker } from "./client";

describe("TelegramWorker history request", () => {
  test("does not request topic replies when the selected chat has a null topic", async () => {
    const worker = new TelegramWorker();
    const calls: unknown[] = [];
    const subject = worker as unknown as {
      chat: { kind: "user"; id: string; accessHash: string; title: string; topicId: null };
      client: { getMessages: (_peer: unknown, options: unknown) => Promise<never[]> };
      pushHistory: () => Promise<void>;
    };
    subject.chat = { kind: "user", id: "123", accessHash: "456", title: "Bot", topicId: null };
    subject.client = {
      getMessages: async (_peer, options) => {
        calls.push(options);
        return [];
      },
    };

    await subject.pushHistory();

    expect(calls).toEqual([{ limit: 20 }]);
  });
});
