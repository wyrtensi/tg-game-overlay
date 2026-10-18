import { describe, expect, test } from "vitest";
import {
  DEFAULT_PHRASE_WHEEL_SETTINGS,
  normalizePhraseWheelSettings,
  normalizePhrases,
  validatePhrase,
} from "./phrase-wheel-settings";

describe("phrase wheel settings", () => {
  test("defaults to a disabled Dota-style wheel", () => {
    expect(DEFAULT_PHRASE_WHEEL_SETTINGS).toEqual({
      enabled: false,
      hotkey: "Ctrl+Space",
      deadZonePx: 42,
      phrases: ["Вперёд", "Назад", "Нужна помощь", "Подожди"],
    });
  });

  test("trims outer whitespace and drops empty phrases", () => {
    expect(normalizePhrases(["", " A ", "Б"])).toEqual(["A", "Б"]);
  });

  test("rejects phrases over 160 characters", () => {
    expect(validatePhrase("а".repeat(161))).toContain("160");
  });

  test("clamps the central dead zone to a usable range", () => {
    expect(normalizePhraseWheelSettings({ ...DEFAULT_PHRASE_WHEEL_SETTINGS, deadZonePx: 1 }).deadZonePx).toBe(16);
    expect(normalizePhraseWheelSettings({ ...DEFAULT_PHRASE_WHEEL_SETTINGS, deadZonePx: 999 }).deadZonePx).toBe(160);
  });
});
