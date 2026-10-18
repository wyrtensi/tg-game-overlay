import { describe, expect, test } from "vitest";
import { DEFAULT_DIRECTION_SETTINGS, normalizeDirectionSettings, validateDirectionSettings } from "./direction-settings";

describe("direction settings", () => {
  test("defaults to disabled arrow-key signals", () => {
    expect(DEFAULT_DIRECTION_SETTINGS).toEqual({
      enabled: false,
      upKey: "ArrowUp",
      downKey: "ArrowDown",
      leftKey: "ArrowLeft",
      rightKey: "ArrowRight",
      displayMs: 2500,
    });
  });

  test("rejects duplicate direction keys", () => {
    expect(validateDirectionSettings({ ...DEFAULT_DIRECTION_SETTINGS, downKey: "ArrowUp" })).toContain("повторяется");
  });

  test("clamps the visible signal duration", () => {
    expect(normalizeDirectionSettings({ ...DEFAULT_DIRECTION_SETTINGS, displayMs: 99 }).displayMs).toBe(500);
    expect(normalizeDirectionSettings({ ...DEFAULT_DIRECTION_SETTINGS, displayMs: 99_999 }).displayMs).toBe(10_000);
  });
});
