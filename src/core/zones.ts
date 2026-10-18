/**
 * Overlay zones are stored relative to the game window (0..1 on both axes),
 * so a resolution change does not force the user to place the chat again.
 */
export interface Zone {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Smallest zone that can still show a line of text. */
export const MIN_ZONE_SIDE = 0.05;

/** A zone edge closer than this to a window edge is treated as flush with it. */
export const SNAP_THRESHOLD = 0.01;

const PRECISION = 10000;

function round(value: number): number {
  return Math.round(value * PRECISION) / PRECISION;
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function toPixels(zone: Zone, gameRect: PixelRect): PixelRect {
  return {
    x: Math.round(gameRect.x + zone.x * gameRect.width),
    y: Math.round(gameRect.y + zone.y * gameRect.height),
    width: Math.round(zone.width * gameRect.width),
    height: Math.round(zone.height * gameRect.height),
  };
}

export function fromPixels(rect: PixelRect, gameRect: PixelRect): Zone {
  return clampZone({
    x: (rect.x - gameRect.x) / gameRect.width,
    y: (rect.y - gameRect.y) / gameRect.height,
    width: rect.width / gameRect.width,
    height: rect.height / gameRect.height,
  });
}

export function clampZone(zone: Zone): Zone {
  // Position wins over size: a zone reaching past an edge is trimmed, not moved.
  const x = Math.min(clampUnit(zone.x), 1 - MIN_ZONE_SIDE);
  const y = Math.min(clampUnit(zone.y), 1 - MIN_ZONE_SIDE);
  const width = Math.min(1 - x, Math.max(MIN_ZONE_SIDE, zone.width));
  const height = Math.min(1 - y, Math.max(MIN_ZONE_SIDE, zone.height));

  return {
    x: round(x),
    y: round(y),
    width: round(width),
    height: round(height),
  };
}

export function snapZone(zone: Zone): Zone {
  let { x, y } = zone;
  const { width, height } = zone;

  if (Math.abs(x) <= SNAP_THRESHOLD) x = 0;
  if (Math.abs(1 - (x + width)) <= SNAP_THRESHOLD) x = 1 - width;
  if (Math.abs(y) <= SNAP_THRESHOLD) y = 0;
  if (Math.abs(1 - (y + height)) <= SNAP_THRESHOLD) y = 1 - height;

  return { x: round(x), y: round(y), width: round(width), height: round(height) };
}

/**
 * The active zone keeps the width of the inactive one and grows upwards,
 * so the input field stays where the user put it.
 */
export function defaultActiveZone(inactive: Zone): Zone {
  const bottom = inactive.y + inactive.height;
  const height = Math.min(0.5, Math.max(inactive.height, inactive.height * 2), bottom);

  return clampZone({
    x: inactive.x,
    y: bottom - height,
    width: inactive.width,
    height,
  });
}
