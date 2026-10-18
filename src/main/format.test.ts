import { describe, expect, test } from "vitest";
import {
  formatFadeLabel,
  formatFontScaleLabel,
  formatOpacityLabel,
  formatShadowLabel,
  formatTtlLabel,
  formatZoneSummary,
  msToSeconds,
  secondsToMs,
} from "./format";

describe("ttl conversion", () => {
  test("converts milliseconds to whole seconds", () => {
    expect(msToSeconds(10000)).toBe(10);
  });

  test("converts seconds to milliseconds", () => {
    expect(secondsToMs(10)).toBe(10000);
  });

  test("formats the ttl slider label", () => {
    expect(formatTtlLabel(10)).toBe("10 с");
  });
});

describe("formatOpacityLabel", () => {
  test("formats a fraction as a rounded percent", () => {
    expect(formatOpacityLabel(0.85)).toBe("85%");
  });

  test("rounds instead of truncating", () => {
    expect(formatOpacityLabel(0.005)).toBe("1%");
  });
});

describe("formatFontScaleLabel", () => {
  test("formats scale with one decimal and a multiply sign", () => {
    expect(formatFontScaleLabel(1.2)).toBe("1.2×");
  });

  test("formats the base scale", () => {
    expect(formatFontScaleLabel(1)).toBe("1.0×");
  });
});

describe("formatShadowLabel", () => {
  test("formats shadow strength as a rounded percent", () => {
    expect(formatShadowLabel(0.85)).toBe("85%");
  });

  test("formats zero shadow", () => {
    expect(formatShadowLabel(0)).toBe("0%");
  });
});

describe("formatFadeLabel", () => {
  test("formats a whole-second fade duration", () => {
    expect(formatFadeLabel(1000)).toBe("1.0 с");
  });

  test("formats a fractional-second fade duration", () => {
    expect(formatFadeLabel(1200)).toBe("1.2 с");
  });

  test("formats a zero fade duration", () => {
    expect(formatFadeLabel(0)).toBe("0.0 с");
  });
});

describe("formatZoneSummary", () => {
  test("summarizes a zone as percentages", () => {
    const summary = formatZoneSummary({ x: 0.1, y: 0.2, width: 0.3, height: 0.25 });

    expect(summary).toBe("10%, 20% · 30%×25%");
  });
});
