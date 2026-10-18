import { describe, expect, test } from "vitest";
import { messageAreaRect, resolveInputPlacement, stickerPanelHeight } from "./layout";

const inactiveZone = { x: 0.05, y: 0.6, width: 0.3, height: 0.3 };

describe("messageAreaRect", () => {
  test("is exactly the inactive zone when not active", () => {
    const activeZone = { x: 0.05, y: 0.3, width: 0.3, height: 0.6 };
    expect(messageAreaRect(inactiveZone, activeZone, false)).toEqual(inactiveZone);
  });

  test("grows upward to the active zone's top, keeping the inactive zone's bottom", () => {
    const activeZone = { x: 0.05, y: 0.3, width: 0.3, height: 0.6 };
    expect(messageAreaRect(inactiveZone, activeZone, true)).toEqual({
      x: 0.05,
      y: 0.3,
      width: 0.3,
      height: 0.6, // bottom (0.9) minus the new top (0.3)
    });
  });

  test("ignores the active zone's own bottom edge entirely", () => {
    // This active zone's bottom (0.5) does not match the inactive zone's
    // bottom (0.9) at all - the message area must still end at 0.9.
    const activeZone = { x: 0.05, y: 0.2, width: 0.3, height: 0.3 };
    const rect = messageAreaRect(inactiveZone, activeZone, true);
    expect(rect.y + rect.height).toBeCloseTo(0.9);
  });

  test("never shrinks above the inactive zone's own top, even if misconfigured", () => {
    const shorterActiveZone = { x: 0.05, y: 0.7, width: 0.3, height: 0.1 };
    expect(messageAreaRect(inactiveZone, shorterActiveZone, true)).toEqual(inactiveZone);
  });

  test("keeps the inactive zone's x and width in active mode", () => {
    const activeZone = { x: 0.1, y: 0.2, width: 0.5, height: 0.7 };
    const rect = messageAreaRect(inactiveZone, activeZone, true);
    expect(rect.x).toBe(inactiveZone.x);
    expect(rect.width).toBe(inactiveZone.width);
  });
});

describe("resolveInputPlacement", () => {
  test("goes below when the window has plenty of room under the zone", () => {
    expect(resolveInputPlacement(0.6, 1000, 40)).toBe("below");
  });

  test("goes inside when the zone is flush with the window bottom", () => {
    expect(resolveInputPlacement(1, 1000, 40)).toBe("inside");
  });

  test("goes below when the remaining space exactly fits the input", () => {
    // 5% of 1000px = 50px of room, needs 50px.
    expect(resolveInputPlacement(0.95, 1000, 50)).toBe("below");
  });

  test("goes inside when the remaining space falls just short", () => {
    expect(resolveInputPlacement(0.95, 1000, 50.1)).toBe("inside");
  });
});

describe("stickerPanelHeight", () => {
  test("caps the floating picker without letting it leave the viewport", () => {
    expect(stickerPanelHeight(500)).toBe(260);
    expect(stickerPanelHeight(100)).toBe(88);
    expect(stickerPanelHeight(0)).toBe(0);
  });
});
