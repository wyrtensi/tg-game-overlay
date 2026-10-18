import { describe, expect, test } from "vitest";
import { pickerEmptyMessage, pickerProgressMessage } from "./sticker-picker-state";

describe("pickerEmptyMessage", () => {
  test("describes an empty completed picker instead of loading", () => {
    expect(pickerEmptyMessage({ status: "ready", packs: [] })).toBe("Стикеров пока нет");
  });

  test("keeps the retry-worthy error visible", () => {
    expect(pickerEmptyMessage({ status: "error", message: "Сеть недоступна" })).toBe("Сеть недоступна");
  });
});

test("shows preview progress without replacing already available packs", () => {
  expect(pickerProgressMessage({ status: "ready", packs: [{ id: "1", title: "Cats", stickers: [] }], phase: "previews" }))
    .toBe("Загружаем превью стикеров…");
});
