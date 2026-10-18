import { expect, test } from "vitest";
import { formatStickerAnimationSeconds } from "./sticker-animation";

test("formats the default and disabled sticker animation labels", () => {
  expect(formatStickerAnimationSeconds(10)).toBe("10 с");
  expect(formatStickerAnimationSeconds(0)).toBe("Без анимации");
});
