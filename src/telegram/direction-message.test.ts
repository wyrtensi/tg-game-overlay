import { describe, expect, test } from "vitest";
import {
  alternateDirectionText,
  directionEmoji,
  directionFallback,
  directionFromText,
  sendOrEditDirection,
  telegramErrorCode,
} from "./direction-message";

describe("direction messages", () => {
  test("maps each direction to a readable Telegram arrow", () => {
    expect(directionEmoji("up")).toBe("⬆️");
    expect(directionEmoji("down")).toBe("⬇️");
    expect(directionEmoji("left")).toBe("⬅️");
    expect(directionEmoji("right")).toBe("➡️");
  });

  test("recognizes only exact arrow messages", () => {
    expect(directionFromText("➡️")).toBe("right");
    expect(directionFromText("⬆")).toBe("up");
    expect(directionFromText("go ➡️")).toBeNull();
    expect(directionFromText("hello")).toBeNull();
  });

  test("recreates a deleted or uneditable direction message", () => {
    expect(directionFallback("MESSAGE_ID_INVALID")).toBe("send-new");
    expect(directionFallback("MESSAGE_EDIT_TIME_EXPIRED")).toBe("send-new");
    expect(directionFallback("MESSAGE_NOT_MODIFIED")).toBe("keep-existing");
  });

  test("extracts Telegram RPC codes before deciding on a fallback", () => {
    expect(telegramErrorCode({ errorMessage: "MESSAGE_ID_INVALID" })).toBe("MESSAGE_ID_INVALID");
    expect(telegramErrorCode(new Error("RPCError: 400: MESSAGE_EDIT_TIME_EXPIRED"))).toBe("MESSAGE_EDIT_TIME_EXPIRED");
  });

  test("edits the cached message before creating another one", async () => {
    const result = await sendOrEditDirection({ direction: "left", messageId: 42 }, {
      edit: async (messageId, emoji) => ({ id: messageId, emoji }),
      send: async (emoji) => ({ id: 99, emoji }),
      errorCode: () => "UNKNOWN",
    });

    expect(result).toEqual({ messageId: 42, created: false });
  });

  test("creates a replacement only after a stale-message edit failure", async () => {
    const result = await sendOrEditDirection({ direction: "right", messageId: 42 }, {
      edit: async () => { throw new Error("MESSAGE_ID_INVALID"); },
      send: async (emoji) => ({ id: 99, emoji }),
      errorCode: (error) => error instanceof Error ? error.message : "UNKNOWN",
    });

    expect(result).toEqual({ messageId: 99, created: true });
  });

  test("repeats the current arrow through its invisible variant, so others see it again", async () => {
    const edits: string[] = [];
    let shown = "➡️";
    const result = await sendOrEditDirection({ direction: "right", messageId: 42 }, {
      edit: async (id, emoji) => {
        if (emoji === shown) throw new Error("MESSAGE_NOT_MODIFIED");
        edits.push(emoji);
        shown = emoji;
        return { id };
      },
      send: async () => ({ id: 99 }),
      errorCode: (error) => error instanceof Error ? error.message : "UNKNOWN",
    });

    expect(result).toEqual({ messageId: 42, created: false });
    expect(edits).toEqual(["➡"]);
    expect(directionFromText(edits[0])).toBe("right");
    expect(alternateDirectionText("➡")).toBe("➡️");
  });

  test("keeps the cached message when Telegram says the arrow is already current", async () => {
    const result = await sendOrEditDirection({ direction: "right", messageId: 42 }, {
      edit: async () => { throw new Error("MESSAGE_NOT_MODIFIED"); },
      send: async () => ({ id: 99 }),
      errorCode: (error) => error instanceof Error ? error.message : "UNKNOWN",
    });

    expect(result).toEqual({ messageId: 42, created: false });
  });
});
