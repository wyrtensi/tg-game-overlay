import { describe, expect, test } from "vitest";
import { applySendResult, beginSend } from "./send-state";

describe("send state", () => {
  test("turns a matching failed request into an error", () => {
    const pending = beginSend("sticker", "req-1");

    expect(
      applySendResult(pending, {
        requestId: "req-1",
        kind: "sticker",
        ok: false,
        error: "Ошибка",
      }),
    ).toEqual({
      requestId: "req-1",
      kind: "sticker",
      status: "error",
      error: "Ошибка",
    });
  });

  test("ignores a result for another request", () => {
    const pending = beginSend("file", "req-1");

    expect(
      applySendResult(pending, {
        requestId: "req-2",
        kind: "file",
        ok: true,
      }),
    ).toBe(pending);
  });

  test("marks a matching confirmed request as sent", () => {
    expect(
      applySendResult(beginSend("text", "req-1"), {
        requestId: "req-1",
        kind: "text",
        ok: true,
        messageId: "9",
      }),
    ).toMatchObject({ status: "sent", messageId: "9" });
  });
});
