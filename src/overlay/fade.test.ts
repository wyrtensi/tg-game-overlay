import { describe, expect, test } from "vitest";
import { fadeDelayMs } from "./fade";

describe("fadeDelayMs", () => {
  test("delays the fade-out until the last fadeMs of the ttl, for a fresh message", () => {
    expect(fadeDelayMs(0, 8000, 1200)).toBe(6800);
  });

  test("is zero exactly when the fade window starts", () => {
    expect(fadeDelayMs(6800, 8000, 1200)).toBe(0);
  });

  test("goes negative once the message is already partway through its fade", () => {
    // 600ms into a 1200ms fade window: the animation should start 600ms in.
    expect(fadeDelayMs(7400, 8000, 1200)).toBe(-600);
  });

  test("is exactly -fadeMs for a message already at the end of its ttl", () => {
    expect(fadeDelayMs(8000, 8000, 1200)).toBe(-1200);
  });

  test("scales with a different fadeMs setting", () => {
    expect(fadeDelayMs(0, 10_000, 2000)).toBe(8000);
  });
});
