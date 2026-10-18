import { describe, expect, test } from "vitest";
import { mediaFailureLabel } from "./media-state";

describe("mediaFailureLabel", () => {
  test("names an unreadable animated sticker", () => {
    expect(mediaFailureLabel("tgs")).toBe("Стикер не удалось показать");
  });

  test("names an unreadable GIF", () => {
    expect(mediaFailureLabel("gif")).toBe("GIF не удалось показать");
  });

  test("names an unreadable photo", () => {
    expect(mediaFailureLabel("photo")).toBe("Фото не удалось показать");
  });
});
