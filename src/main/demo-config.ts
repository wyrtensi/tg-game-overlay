import { DEFAULT_FEED_SETTINGS } from "./feed-defaults";
import { DEFAULT_DIRECTION_SETTINGS } from "./direction-settings";
import { DEFAULT_PHRASE_WHEEL_SETTINGS } from "./phrase-wheel-settings";
import type { Config } from "./types";

/** Fallback config for the smoke-test / plain-browser case, and the empty-state screenshot. */
export function createDemoConfig(): Config {
  return {
    hotkey: "T",
    markupHotkey: "Ctrl+Shift+M",
    ...DEFAULT_FEED_SETTINGS,
    directionSignals: DEFAULT_DIRECTION_SETTINGS,
    phraseWheel: DEFAULT_PHRASE_WHEEL_SETTINGS,
    autostart: false,
    demoFeed: true,
    profiles: [
      {
        exe: "dota2.exe",
        title: "Dota 2",
        mode: "show",
        inactive: { x: 0.02, y: 0.7, width: 0.3, height: 0.25 },
        active: { x: 0.02, y: 0.35, width: 0.3, height: 0.6 },
      },
      {
        exe: "csgo.exe",
        title: "Counter-Strike",
        mode: "hidden",
        inactive: { x: 0.65, y: 0.05, width: 0.3, height: 0.2 },
        active: { x: 0.65, y: 0.05, width: 0.3, height: 0.4 },
      },
    ],
  };
}
