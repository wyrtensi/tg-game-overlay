import { describe, expect, test } from "vitest";
import { phraseWheelItems, wheelOrigin } from "./phrase-wheel";

describe("phraseWheelItems", () => {
  test("puts the first phrase above the centre and continues clockwise", () => {
    const items = phraseWheelItems(["Вперёд", "Вправо", "Назад", "Влево"], 0, 100);

    expect(items[0]).toMatchObject({ phrase: "Вперёд", x: 0, y: -100, selected: true });
    expect(items[1]).toMatchObject({ phrase: "Вправо", x: 100, y: 0, selected: false });
  });

  test("does not need visible sectors to express a neutral selection", () => {
    const items = phraseWheelItems(["Одна", "Две"], null, 80);

    expect(items.every((item) => !item.selected)).toBe(true);
  });

  test("keeps the wheel centre at the press point while avoiding the screen edge", () => {
    expect(wheelOrigin({ x: 4, y: 700 }, { width: 1280, height: 720 })).toEqual({ x: 96, y: 624 });
    expect(wheelOrigin({ x: 640, y: 360 }, { width: 1280, height: 720 })).toEqual({ x: 640, y: 360 });
  });
});
