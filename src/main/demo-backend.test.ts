import { describe, expect, test } from "vitest";
import { DemoBackend } from "./demo-backend";
import { createDemoConfig } from "./demo-config";
import { DEFAULT_FEED_SETTINGS } from "./feed-defaults";
import { DEFAULT_PHRASE_WHEEL_SETTINGS } from "./phrase-wheel-settings";

describe("DemoBackend", () => {
  test("setHotkey accepts a valid combo and updates the config", () => {
    const backend = new DemoBackend(createDemoConfig());

    const config = backend.setHotkey("Ctrl+Shift+Y");

    expect(config.hotkey).toBe("Ctrl+Shift+Y");
  });

  test("setHotkey rejects a combo already used by the markup hotkey", () => {
    const backend = new DemoBackend(createDemoConfig());

    expect(() => backend.setHotkey(backend.getConfig().markupHotkey)).toThrow(
      "Эта комбинация уже используется для разметки зон",
    );
  });

  test("setHotkey accepts a single key for chat", () => {
    const backend = new DemoBackend(createDemoConfig());

    expect(backend.setHotkey("A").hotkey).toBe("A");
  });

  test("setFeedSettings clamps out-of-range values", () => {
    const backend = new DemoBackend(createDemoConfig());

    const config = backend.setFeedSettings({ ttlMs: 999_999, opacity: 5, fontScale: 0.1 });

    expect(config.ttlMs).toBe(60_000);
    expect(config.opacity).toBe(1);
    expect(config.fontScale).toBe(0.8);
  });

  test("setFeedSettings clamps shadow and fade duration", () => {
    const backend = new DemoBackend(createDemoConfig());

    const config = backend.setFeedSettings({ ttlMs: 10000, opacity: 0.5, fontScale: 1, shadow: 5, fadeMs: 999_999 });

    expect(config.shadow).toBe(1);
    expect(config.fadeMs).toBe(5000);
  });

  test("setFeedSettings clamps a negative shadow or fade duration to zero", () => {
    const backend = new DemoBackend(createDemoConfig());

    const config = backend.setFeedSettings({ ttlMs: 10000, opacity: 0.5, fontScale: 1, shadow: -1, fadeMs: -100 });

    expect(config.shadow).toBe(0);
    expect(config.fadeMs).toBe(0);
  });

  test("setFeedSettings normalizes valid hex colours", () => {
    const backend = new DemoBackend(createDemoConfig());

    const config = backend.setFeedSettings({
      ttlMs: 10000,
      opacity: 0.5,
      fontScale: 1,
      textColor: "#ABCDEF",
      authorColor: "#123456",
    });

    expect(config.textColor).toBe("#abcdef");
    expect(config.authorColor).toBe("#123456");
  });

  test("setFeedSettings keeps the previous colour when given an invalid one", () => {
    const backend = new DemoBackend(createDemoConfig());
    const before = backend.getConfig().textColor;

    const config = backend.setFeedSettings({ ttlMs: 10000, opacity: 0.5, fontScale: 1, textColor: "not-a-color" });

    expect(config.textColor).toBe(before);
  });

  test("keeps the old bubble colour when a dialogue colour is invalid", () => {
    const backend = new DemoBackend({ ...createDemoConfig(), incomingBubbleColor: "#112233" });

    const config = backend.setFeedSettings({
      ...DEFAULT_FEED_SETTINGS,
      incomingBubbleColor: "blue",
      outgoingBubbleColor: "#ABCDEF",
    });

    expect(config.incomingBubbleColor).toBe("#112233");
    expect(config.outgoingBubbleColor).toBe("#abcdef");
  });

  test("restores compact dialogue defaults", () => {
    expect(DEFAULT_FEED_SETTINGS).toMatchObject({
      messageLayout: "compact",
      showAuthor: true,
      incomingBubbleColor: "#1c222c",
      outgoingBubbleColor: "#1e5d92",
    });
  });

  test("setFeedSettings keeps the previous shadow and fade when they are omitted", () => {
    const backend = new DemoBackend(createDemoConfig());
    const before = backend.getConfig();

    const config = backend.setFeedSettings({ ttlMs: 10000, opacity: 0.5, fontScale: 1 });

    expect(config.shadow).toBe(before.shadow);
    expect(config.fadeMs).toBe(before.fadeMs);
  });

  test("upsertProfile replaces an existing profile by exe", () => {
    const backend = new DemoBackend(createDemoConfig());
    const existing = backend.getConfig().profiles[0];

    const config = backend.upsertProfile({ ...existing, title: "Renamed" });

    expect(config.profiles.filter((p) => p.exe === existing.exe)).toHaveLength(1);
    expect(config.profiles.find((p) => p.exe === existing.exe)?.title).toBe("Renamed");
  });

  test("upsertProfile appends a new profile", () => {
    const backend = new DemoBackend(createDemoConfig());
    const before = backend.getConfig().profiles.length;

    const config = backend.upsertProfile({
      exe: "new-game.exe",
      title: "New game",
      mode: "show",
      inactive: { x: 0, y: 0, width: 0.2, height: 0.2 },
      active: { x: 0, y: 0, width: 0.2, height: 0.4 },
    });

    expect(config.profiles).toHaveLength(before + 1);
  });

  test("removeProfile drops the profile with a matching exe", () => {
    const backend = new DemoBackend(createDemoConfig());
    const exe = backend.getConfig().profiles[0].exe;

    const config = backend.removeProfile(exe);

    expect(config.profiles.some((p) => p.exe === exe)).toBe(false);
  });

  test("addCurrentApp appends a profile with a fresh exe each time", () => {
    const backend = new DemoBackend(createDemoConfig());
    const before = backend.getConfig().profiles.length;

    const first = backend.addCurrentApp();
    const second = backend.addCurrentApp();

    expect(first.profiles).toHaveLength(before + 1);
    expect(second.profiles).toHaveLength(before + 2);
    const exes = second.profiles.map((p) => p.exe);
    expect(new Set(exes).size).toBe(exes.length);
  });

  test("setFlags updates autostart and demoFeed", () => {
    const backend = new DemoBackend(createDemoConfig());

    const config = backend.setFlags({ autostart: true, demoFeed: false });

    expect(config.autostart).toBe(true);
    expect(config.demoFeed).toBe(false);
  });

  test("setChat stores the selected chat", () => {
    const backend = new DemoBackend(createDemoConfig());
    const chat = { kind: "chat" as const, id: "1", title: "Dota 2 сквад" };

    const config = backend.setChat(chat);

    expect(config.chat).toEqual(chat);
  });

  test("stores normalized phrase-wheel settings", () => {
    const backend = new DemoBackend(createDemoConfig());

    const config = backend.setPhraseWheelSettings({
      ...DEFAULT_PHRASE_WHEEL_SETTINGS,
      phrases: [" Вперёд ", "Назад"],
    });

    expect(config.phraseWheel.phrases).toEqual(["Вперёд", "Назад"]);
  });

  test("rejects a phrase-wheel hotkey already used by the chat", () => {
    const backend = new DemoBackend(createDemoConfig());
    backend.setHotkey("Ctrl+Shift+T");

    expect(() => backend.setPhraseWheelSettings({
      ...DEFAULT_PHRASE_WHEEL_SETTINGS,
      hotkey: backend.getConfig().hotkey,
    })).toThrow("Это сочетание уже используется другой функцией приложения");
  });

  test("setChat(null) clears the selected chat", () => {
    const backend = new DemoBackend(createDemoConfig());
    backend.setChat({ kind: "user", id: "1", title: "Алекс" });

    const config = backend.setChat(null);

    expect(config.chat).toBeNull();
  });

  test("saveApiKeys stores apiId on the config but not the hash", () => {
    const backend = new DemoBackend(createDemoConfig());

    const config = backend.saveApiKeys(123456, "some-secret-hash");

    expect(config.apiId).toBe(123456);
    expect(JSON.stringify(config)).not.toContain("some-secret-hash");
  });
});
