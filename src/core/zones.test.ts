import { describe, expect, test } from "vitest";
import { clampZone, defaultActiveZone, fromPixels, snapZone, toPixels } from "./zones";

const gameRect = { x: 100, y: 50, width: 1000, height: 800 };

describe("toPixels", () => {
  test("maps a relative zone onto the game window rect", () => {
    const pixels = toPixels({ x: 0.1, y: 0.2, width: 0.3, height: 0.25 }, gameRect);

    expect(pixels).toEqual({ x: 200, y: 210, width: 300, height: 200 });
  });

  test("rounds to whole pixels so the overlay never lands on a half pixel", () => {
    const pixels = toPixels({ x: 0.3333, y: 0, width: 0.3333, height: 1 }, gameRect);

    expect(pixels).toEqual({ x: 433, y: 50, width: 333, height: 800 });
  });
});

describe("fromPixels", () => {
  test("converts a screen rect back to relative coordinates", () => {
    const zone = fromPixels({ x: 200, y: 210, width: 300, height: 200 }, gameRect);

    expect(zone).toEqual({ x: 0.1, y: 0.2, width: 0.3, height: 0.25 });
  });

  test("clamps a selection drawn outside the game window", () => {
    const zone = fromPixels({ x: 0, y: 0, width: 2000, height: 2000 }, gameRect);

    expect(zone).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });
});

describe("clampZone", () => {
  test("keeps a zone that sticks out on the right inside the window", () => {
    const zone = clampZone({ x: 0.8, y: 0.1, width: 0.5, height: 0.2 });

    expect(zone).toEqual({ x: 0.8, y: 0.1, width: 0.2, height: 0.2 });
  });

  test("enforces a minimum size so a stray click cannot create an invisible zone", () => {
    const zone = clampZone({ x: 0.5, y: 0.5, width: 0.001, height: 0.001 });

    expect(zone.width).toBeGreaterThanOrEqual(0.05);
    expect(zone.height).toBeGreaterThanOrEqual(0.05);
  });
});

describe("snapZone", () => {
  test("snaps a nearly flush left edge to the window edge", () => {
    const zone = snapZone({ x: 0.008, y: 0.5, width: 0.3, height: 0.3 });

    expect(zone.x).toBe(0);
  });

  test("snaps a nearly flush bottom edge to the window edge", () => {
    const zone = snapZone({ x: 0.1, y: 0.695, width: 0.3, height: 0.3 });

    expect(zone.y).toBe(0.7);
  });

  test("leaves a zone in open space untouched", () => {
    const zone = { x: 0.4, y: 0.4, width: 0.2, height: 0.2 };

    expect(snapZone(zone)).toEqual(zone);
  });
});

describe("defaultActiveZone", () => {
  test("does not turn a tall message area into a full-height open chat", () => {
    const active = defaultActiveZone({ x: 0.1, y: 0.45, width: 0.3, height: 0.5 });

    expect(active.height).toBe(0.5);
    expect(active.y + active.height).toBe(0.95);
  });
  test("keeps the width and grows upward without exceeding half the game height", () => {
    const active = defaultActiveZone({ x: 0.05, y: 0.6, width: 0.3, height: 0.3 });

    expect(active).toEqual({ x: 0.05, y: 0.4, width: 0.3, height: 0.5 });
  });

  test("stops at the top edge instead of growing off screen", () => {
    const active = defaultActiveZone({ x: 0.05, y: 0.1, width: 0.3, height: 0.3 });

    expect(active).toEqual({ x: 0.05, y: 0, width: 0.3, height: 0.4 });
  });
});
