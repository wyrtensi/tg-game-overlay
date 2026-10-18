import type { Zone } from "../core/zones";

// Matches the precision core/zones.ts rounds its own zone math to, so
// results here are equally free of floating-point noise (e.g. 0.8999...9).
const PRECISION = 10000;
const STICKER_PANEL_MAX_HEIGHT_PX = 260;
const STICKER_PANEL_GAP_PX = 12;

function round(value: number): number {
  return Math.round(value * PRECISION) / PRECISION;
}

/**
 * The message area's rect for the given mode. Its bottom edge is always the
 * inactive zone's bottom - never the active zone's own bottom - so a line
 * already on screen never moves, in either direction. Only the top edge
 * changes: it stays put in passive mode and rises to the active zone's top
 * when active, growing the box upwards only (never below the inactive
 * zone's own top, even if the active zone is misconfigured as shorter).
 */
export function messageAreaRect(inactiveZone: Zone, activeZone: Zone, isActive: boolean): Zone {
  const bottom = round(inactiveZone.y + inactiveZone.height);
  const top = isActive ? Math.min(inactiveZone.y, activeZone.y) : inactiveZone.y;

  return {
    x: inactiveZone.x,
    y: top,
    width: inactiveZone.width,
    height: round(bottom - top),
  };
}

/**
 * Where the input field goes relative to the message area: below it when
 * the game window has room there, otherwise inside its bottom edge - the
 * owner does not want the message area's own geometry to depend on this,
 * so "inside" is a deliberate fallback, not the normal case.
 */
export function resolveInputPlacement(
  messageAreaBottom: number,
  windowHeightPx: number,
  inputHeightPx: number,
): "below" | "inside" {
  const spaceBelowPx = (1 - messageAreaBottom) * windowHeightPx;
  return spaceBelowPx >= inputHeightPx ? "below" : "inside";
}

/** Height available above the input for the floating sticker picker. */
export function stickerPanelHeight(spaceAboveInputPx: number): number {
  return Math.max(0, Math.min(STICKER_PANEL_MAX_HEIGHT_PX, spaceAboveInputPx - STICKER_PANEL_GAP_PX));
}
