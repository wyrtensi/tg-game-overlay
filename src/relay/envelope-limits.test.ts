import { describe, expect, test } from "vitest";
import { capCodePoints, isFreshSignal, MAX_SIGNAL_SKEW_MS, sanitizeServerTime } from "./envelope-limits";

const NOW = Date.UTC(2026, 5, 1);

describe("capCodePoints", () => {
  test("leaves short text alone and cuts long text", () => {
    expect(capCodePoints("hello", 5)).toBe("hello");
    expect(capCodePoints("hello world", 5)).toBe("hello");
  });

  test("never splits a surrogate pair", () => {
    expect(capCodePoints("😀😀😀", 2)).toBe("😀😀");
  });
});

describe("sanitizeServerTime", () => {
  test("keeps a plausible server time", () => {
    expect(sanitizeServerTime(NOW - 5000, NOW)).toBe(NOW - 5000);
  });

  test("replaces times that cannot be rendered or belong to no real message", () => {
    expect(sanitizeServerTime(1e300, NOW)).toBe(NOW);
    expect(sanitizeServerTime(Number.NaN, NOW)).toBe(NOW);
    expect(sanitizeServerTime(-1, NOW)).toBe(NOW);
    expect(sanitizeServerTime(1000, NOW)).toBe(NOW);
    expect(sanitizeServerTime("1", NOW)).toBe(NOW);
    expect(sanitizeServerTime(NOW + 60_000, NOW)).toBe(NOW);
  });
});

describe("isFreshSignal", () => {
  test("accepts signals sent within two minutes either way", () => {
    expect(isFreshSignal(NOW - MAX_SIGNAL_SKEW_MS, NOW)).toBe(true);
    expect(isFreshSignal(NOW + MAX_SIGNAL_SKEW_MS, NOW)).toBe(true);
    expect(isFreshSignal(NOW - MAX_SIGNAL_SKEW_MS - 1, NOW)).toBe(false);
  });
});
