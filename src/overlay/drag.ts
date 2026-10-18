import { type PixelRect, type Zone, fromPixels, snapZone } from "../core/zones";

/** A point in the overlay window's own pixel coordinates. */
export interface Point {
  x: number;
  y: number;
}

/** Normalizes two drag corners into a rect, regardless of drag direction. */
export function rectFromPoints(a: Point, b: Point): PixelRect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/**
 * Turns a mouse drag (in window pixels) into a relative, edge-snapped zone.
 * The overlay window equals the game window, so `gameRect` is the window's
 * own rect, typically `{ x: 0, y: 0, width: innerWidth, height: innerHeight }`.
 */
export function zoneFromDrag(a: Point, b: Point, gameRect: PixelRect): Zone {
  return snapZone(fromPixels(rectFromPoints(a, b), gameRect));
}

/** Human-readable size of a zone, shown near the cursor while drawing it. */
export function formatZonePercent(zone: Zone): string {
  const width = Math.round(zone.width * 100);
  const height = Math.round(zone.height * 100);
  return `${width}% x ${height}%`;
}
