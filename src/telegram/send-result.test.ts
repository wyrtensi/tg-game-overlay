import { describe, expect, test } from "vitest";
import { sendErrorMessage, type SendResult } from "./send-result";

describe("sendErrorMessage", () => {
  test("keeps a useful Telegram error message", () => {
    expect(sendErrorMessage(new Error("CHAT_WRITE_FORBIDDEN"))).toBe("CHAT_WRITE_FORBIDDEN");
  });

  test("uses a readable fallback for non-error values", () => {
    expect(sendErrorMessage(null)).toBe("Telegram не подтвердил отправку");
  });
});

test("SendResult accepts a confirmed Telegram message id", () => {
  const result: SendResult = {
    requestId: "req-1",
    kind: "sticker",
    ok: true,
    messageId: "42",
  };

  expect(result.messageId).toBe("42");
});
