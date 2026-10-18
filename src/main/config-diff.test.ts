import { describe, expect, test } from "vitest";
import { configsEqual, feedSettingsEqual, profilesEqual } from "./config-diff";
import type { Config, Profile } from "./types";
import { DEFAULT_DIRECTION_SETTINGS } from "./direction-settings";
import { DEFAULT_PHRASE_WHEEL_SETTINGS } from "./phrase-wheel-settings";

const zone = { x: 0, y: 0.7, width: 0.3, height: 0.3 };

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    exe: "dota2.exe",
    title: "Dota 2",
    mode: "show",
    inactive: zone,
    active: zone,
    ...overrides,
  };
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    hotkey: "Ctrl+Shift+T",
    markupHotkey: "Ctrl+Shift+M",
    ttlMs: 10000,
    opacity: 0.85,
    fontScale: 1,
    textColor: "#f2f2f2",
    authorColor: "#7fb2ff",
    shadow: 0.85,
    fadeMs: 1200,
    stickerAnimationSeconds: 10,
    messageLayout: "compact",
    showAuthor: true,
    showMessageTime: true,
    incomingBubbleColor: "#1c222c",
    outgoingBubbleColor: "#1e5d92",
    directionSignals: DEFAULT_DIRECTION_SETTINGS,
    phraseWheel: DEFAULT_PHRASE_WHEEL_SETTINGS,
    autostart: false,
    demoFeed: true,
    profiles: [makeProfile()],
    ...overrides,
  };
}

describe("feedSettingsEqual", () => {
  test("true for identical settings", () => {
    expect(feedSettingsEqual({ ttlMs: 10000, opacity: 0.5, fontScale: 1 }, { ttlMs: 10000, opacity: 0.5, fontScale: 1 })).toBe(true);
  });

  test("false when one field differs", () => {
    expect(feedSettingsEqual({ ttlMs: 10000, opacity: 0.5, fontScale: 1 }, { ttlMs: 9000, opacity: 0.5, fontScale: 1 })).toBe(false);
  });

  test("false when the text colour differs", () => {
    const a = { ttlMs: 10000, opacity: 0.5, fontScale: 1, textColor: "#ffffff" };
    const b = { ttlMs: 10000, opacity: 0.5, fontScale: 1, textColor: "#000000" };

    expect(feedSettingsEqual(a, b)).toBe(false);
  });

  test("false when the author colour differs", () => {
    const a = { ttlMs: 10000, opacity: 0.5, fontScale: 1, authorColor: "#ffffff" };
    const b = { ttlMs: 10000, opacity: 0.5, fontScale: 1, authorColor: "#000000" };

    expect(feedSettingsEqual(a, b)).toBe(false);
  });

  test("false when the shadow strength differs", () => {
    const a = { ttlMs: 10000, opacity: 0.5, fontScale: 1, shadow: 0.2 };
    const b = { ttlMs: 10000, opacity: 0.5, fontScale: 1, shadow: 0.8 };

    expect(feedSettingsEqual(a, b)).toBe(false);
  });

  test("false when the fade duration differs", () => {
    const a = { ttlMs: 10000, opacity: 0.5, fontScale: 1, fadeMs: 500 };
    const b = { ttlMs: 10000, opacity: 0.5, fontScale: 1, fadeMs: 1500 };

    expect(feedSettingsEqual(a, b)).toBe(false);
  });

  test("false when a dialogue appearance setting differs", () => {
    const a = { ttlMs: 10000, opacity: 0.5, fontScale: 1, messageLayout: "compact" as const };
    const b = { ttlMs: 10000, opacity: 0.5, fontScale: 1, messageLayout: "dialogue" as const };

    expect(feedSettingsEqual(a, b)).toBe(false);
  });

  test("true when both sides omit the optional appearance fields", () => {
    expect(feedSettingsEqual({ ttlMs: 10000, opacity: 0.5, fontScale: 1 }, { ttlMs: 10000, opacity: 0.5, fontScale: 1 })).toBe(true);
  });
});

describe("profilesEqual", () => {
  test("true for identical profile lists", () => {
    expect(profilesEqual([makeProfile()], [makeProfile()])).toBe(true);
  });

  test("false when lengths differ", () => {
    expect(profilesEqual([makeProfile()], [])).toBe(false);
  });

  test("false when a nested zone differs", () => {
    const a = [makeProfile()];
    const b = [makeProfile({ active: { ...zone, height: 0.5 } })];

    expect(profilesEqual(a, b)).toBe(false);
  });
});

describe("configsEqual", () => {
  test("notices a transport or relay change", () => {
    expect(configsEqual(makeConfig(), makeConfig({ transport: "telegram" }))).toBe(true);
    expect(configsEqual(makeConfig(), makeConfig({ transport: "relay" }))).toBe(false);
    expect(configsEqual(
      makeConfig({ relay: { url: "a", room: "r", displayName: "n" } }),
      makeConfig({ relay: { url: "a", room: "r2", displayName: "n" } }),
    )).toBe(false);
  });

  test("true for two separately built but identical configs", () => {
    expect(configsEqual(makeConfig(), makeConfig())).toBe(true);
  });

  test("false when the hotkey differs", () => {
    expect(configsEqual(makeConfig(), makeConfig({ hotkey: "Ctrl+Shift+Y" }))).toBe(false);
  });

  test("false when a profile differs", () => {
    expect(configsEqual(makeConfig(), makeConfig({ profiles: [makeProfile({ mode: "hidden" })] }))).toBe(false);
  });

  test("false when direction settings differ", () => {
    expect(configsEqual(makeConfig(), makeConfig({ directionSignals: { ...DEFAULT_DIRECTION_SETTINGS, enabled: true } }))).toBe(false);
  });

  test("false when direction bindings differ", () => {
    expect(configsEqual(makeConfig(), makeConfig({ directionSignals: { ...DEFAULT_DIRECTION_SETTINGS, enabled: true } }))).toBe(false);
  });

  test("false when phrase-wheel settings differ", () => {
    expect(configsEqual(makeConfig(), makeConfig({ phraseWheel: { ...DEFAULT_PHRASE_WHEEL_SETTINGS, enabled: true } }))).toBe(false);
  });
});
