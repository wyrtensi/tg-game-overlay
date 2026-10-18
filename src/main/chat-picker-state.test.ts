import { describe, expect, test } from "vitest";
import { chatPickerMessage } from "./chat-picker-state";

describe("chatPickerMessage", () => {
  test("explains that the Telegram chat list is loading", () => {
    expect(chatPickerMessage({ state: "loading" }, 0)).toBe("Загружаем чаты из Telegram…");
  });

  test("shows the Telegram error instead of treating it as an empty list", () => {
    expect(chatPickerMessage({ state: "error", error: "Network down" }, 0)).toBe(
      "Не удалось загрузить чаты: Network down",
    );
  });
});
