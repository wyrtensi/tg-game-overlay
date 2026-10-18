import { describe, expect, test } from "vitest";
import { computeBackoffMs } from "./backoff";

describe("computeBackoffMs", () => {
  test("starts at the base delay for attempt 0", () => {
    expect(computeBackoffMs(0)).toBe(1000);
  });

  test("doubles each attempt", () => {
    expect(computeBackoffMs(1)).toBe(2000);
    expect(computeBackoffMs(2)).toBe(4000);
    expect(computeBackoffMs(3)).toBe(8000);
  });

  test("caps at 30 seconds", () => {
    expect(computeBackoffMs(10)).toBe(30_000);
  });

  test("treats negative attempts as attempt 0", () => {
    expect(computeBackoffMs(-1)).toBe(1000);
  });
});
