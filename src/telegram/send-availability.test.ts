import { describe, expect, test } from "vitest";
import { unavailableSendResult } from "./send-availability";

describe("unavailableSendResult", () => {
  test.each(["text", "sticker", "file", "direction"] as const)("rejects %s while reconnecting", (kind) => {
    expect(unavailableSendResult("request-1", kind, { clientConnected: false, chatSelected: true, reconnecting: true }))
      .toEqual({ requestId: "request-1", kind, ok: false, error: "Сообщение не отправлено, связь восстанавливается" });
  });

  test("keeps the existing hint when no chat is selected", () => {
    expect(unavailableSendResult("request-1", "text", { clientConnected: true, chatSelected: false, reconnecting: false }))
      .toEqual({ requestId: "request-1", kind: "text", ok: false, error: "Telegram не подключён или чат не выбран" });
  });

  test("allows sends only when client and chat are ready", () => {
    expect(unavailableSendResult("request-1", "text", { clientConnected: true, chatSelected: true, reconnecting: false })).toBeNull();
  });
});
