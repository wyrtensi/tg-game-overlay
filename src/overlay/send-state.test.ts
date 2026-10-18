import { describe, expect, test } from "vitest";
import { applySendResult, beginSend, DUPLICATE_SEND_WINDOW_MS, isDuplicateSend } from "./send-state";

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

describe("isDuplicateSend", () => {
  const pending = [{ kind: "text" as const, text: "gg", startedAt: 1000 }];

  test("blocks the same text while it is still on its way", () => {
    expect(isDuplicateSend(pending, { kind: "text", text: "gg" }, 1500)).toBe(true);
  });

  test("lets other text, an attachment or a stale send through", () => {
    expect(isDuplicateSend(pending, { kind: "text", text: "go" }, 1500)).toBe(false);
    expect(isDuplicateSend(pending, { kind: "file", text: "gg", attachment: "data:image/png;base64,AA==" }, 1500)).toBe(false);
    expect(isDuplicateSend(pending, { kind: "text", text: "gg" }, 1000 + DUPLICATE_SEND_WINDOW_MS)).toBe(false);
  });

  test("tells two different images with the same caption apart", () => {
    const files = [{ kind: "file" as const, text: "", attachment: "data:a", startedAt: 0 }];
    expect(isDuplicateSend(files, { kind: "file", text: "", attachment: "data:a" }, 10)).toBe(true);
    expect(isDuplicateSend(files, { kind: "file", text: "", attachment: "data:b" }, 10)).toBe(false);
  });
});
