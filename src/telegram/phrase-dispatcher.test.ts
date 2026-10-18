import { describe, expect, test } from "vitest";
import { PhraseDispatcher, phraseFromText, phraseVariant } from "./phrase-dispatcher";

describe("PhraseDispatcher", () => {
  test("creates one phrase message and edits it for the next selection", async () => {
    const dispatcher = new PhraseDispatcher();
    const sent: string[] = [];
    const edited: Array<{ id: number; text: string }> = [];
    let messageId: number | undefined;
    const transport = {
      getMessageId: async () => messageId,
      setMessageId: async (id: number) => { messageId = id; },
      edit: async (id: number, text: string) => { edited.push({ id, text }); return { id }; },
      send: async (text: string) => { sent.push(text); return { id: 91 }; },
      errorCode: () => "UNKNOWN",
    };

    await dispatcher.dispatch("Нужна помощь", transport);
    await dispatcher.dispatch("Вперёд", transport);

    expect(sent).toEqual(["Нужна помощь"]);
    expect(edited).toEqual([{ id: 91, text: "Вперёд" }]);
  });

  test("repeats the current phrase through an invisible variant", async () => {
    const dispatcher = new PhraseDispatcher();
    let shown = "Вперёд";
    const edits: string[] = [];
    const transport = {
      getMessageId: async () => 91,
      setMessageId: async () => {},
      edit: async (id: number, text: string) => {
        if (text === shown) throw new Error("MESSAGE_NOT_MODIFIED");
        edits.push(text);
        shown = text;
        return { id };
      },
      send: async () => ({ id: 92 }),
      errorCode: (error: unknown) => error instanceof Error ? error.message : "UNKNOWN",
    };

    await dispatcher.dispatch("Вперёд", transport);
    await dispatcher.dispatch("Вперёд", transport);

    expect(edits).toEqual([phraseVariant("Вперёд"), "Вперёд"]);
    expect(edits.map(phraseFromText)).toEqual(["Вперёд", "Вперёд"]);
  });

  test("treats an unchanged phrase edit as a successful update", async () => {
    const dispatcher = new PhraseDispatcher();
    const result = await dispatcher.dispatch("Вперёд", {
      getMessageId: async () => 91,
      setMessageId: async () => {},
      edit: async () => { throw new Error("MESSAGE_NOT_MODIFIED"); },
      send: async () => ({ id: 92 }),
      errorCode: (error) => error instanceof Error ? error.message : "UNKNOWN",
    });

    expect(result).toEqual({ messageId: 91, created: false });
  });
});
