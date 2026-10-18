import { describe, expect, test } from "vitest";
import { formatZonePercent, rectFromPoints, zoneFromDrag } from "./drag";

const gameRect = { x: 0, y: 0, width: 1000, height: 800 };

describe("rectFromPoints", () => {
  test("normalizes a drag going down-right", () => {
    expect(rectFromPoints({ x: 100, y: 50 }, { x: 400, y: 250 })).toEqual({
      x: 100,
      y: 50,
      width: 300,
      height: 200,
    });
  });

  test("normalizes a drag going up-left", () => {
    expect(rectFromPoints({ x: 400, y: 250 }, { x: 100, y: 50 })).toEqual({
      x: 100,
      y: 50,
      width: 300,
      height: 200,
    });
  });
});

describe("zoneFromDrag", () => {
  test("converts a drag into a relative, snapped zone", () => {
    const zone = zoneFromDrag({ x: 0, y: 400 }, { x: 300, y: 800 }, gameRect);

    expect(zone).toEqual({ x: 0, y: 0.5, width: 0.3, height: 0.5 });
  });

  test("snaps a drag that nearly touches the window edge", () => {
    const zone = zoneFromDrag({ x: 2, y: 400 }, { x: 300, y: 800 }, gameRect);

    expect(zone.x).toBe(0);
  });
});

describe("formatZonePercent", () => {
  test("renders width and height as rounded percentages", () => {
    expect(formatZonePercent({ x: 0, y: 0, width: 0.3, height: 0.256 })).toBe("30% x 26%");
  });
});
