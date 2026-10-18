import { describe, expect, test } from "vitest";
import { DirectionDispatcher } from "./direction-dispatcher";

describe("DirectionDispatcher", () => {
  test("creates one message then edits it for a direction received before the send resolves", async () => {
    let releaseFirstSend: (() => void) | undefined;
    let signalFirstSend: (() => void) | undefined;
    const firstSend = new Promise<void>((resolve) => { releaseFirstSend = resolve; });
    const firstSendStarted = new Promise<void>((resolve) => { signalFirstSend = resolve; });
    const sent: string[] = [];
    const edited: Array<{ id: number; emoji: string }> = [];
    const stored: number[] = [];
    const dispatcher = new DirectionDispatcher();
    const transport = {
      getMessageId: async () => stored[stored.length - 1],
      setMessageId: async (id: number) => { stored.push(id); },
      edit: async (id: number, emoji: string) => { edited.push({ id, emoji }); return { id }; },
      send: async (emoji: string) => {
        sent.push(emoji);
        signalFirstSend?.();
        await firstSend;
        return { id: 77 };
      },
      errorCode: () => "UNKNOWN",
    };

    const first = dispatcher.dispatch("up", transport);
    const second = dispatcher.dispatch("left", transport);
    await firstSendStarted;
    expect(sent).toEqual(["⬆️"]);

    releaseFirstSend?.();
    await Promise.all([first, second]);

    expect(sent).toEqual(["⬆️"]);
    expect(edited).toEqual([{ id: 77, emoji: "⬅️" }]);
    expect(stored).toEqual([77, 77]);
  });
});
