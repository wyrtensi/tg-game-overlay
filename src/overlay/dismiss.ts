import type { OverlayKind } from "../core/states";

/**
 * Whether a mousedown should close the chat, mirroring Esc. Only active mode
 * takes the mouse at all (inactive/hidden/off are click-through), markup mode
 * owns clicks for drawing zones, and a click anywhere inside the active zone
 * (input, history, future controls) is normal chat interaction, not a dismiss.
 */
export function shouldDismissOnOutsideClick(
  kind: OverlayKind,
  isMarkupActive: boolean,
  clickedInsideActiveZone: boolean,
): boolean {
  return kind === "active" && !isMarkupActive && !clickedInsideActiveZone;
}
