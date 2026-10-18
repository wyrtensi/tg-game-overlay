import { type PixelRect, type Zone, defaultActiveZone } from "../core/zones";
import { type Point, zoneFromDrag } from "./drag";

export type MarkupStep = "inactive" | "review" | "active";

export interface MarkupSnapshot {
  step: MarkupStep;
  inactiveZone: Zone | null;
  activeZone: Zone | null;
  /** The rectangle currently being dragged, or null when the mouse is up. */
  previewZone: Zone | null;
}

/**
 * Pure state machine behind the markup-mode UI: draw the inactive zone,
 * then the active zone (prefilled, redrawable), with no DOM involved.
 */
export class MarkupSession {
  private step: MarkupStep = "inactive";
  private inactiveZone: Zone | null = null;
  private activeZone: Zone | null = null;
  private dragStart: Point | null = null;
  private dragCurrent: Point | null = null;

  constructor(private readonly gameRect: PixelRect) {}

  pointerDown(point: Point): void {
    this.dragStart = point;
    this.dragCurrent = point;
  }

  pointerMove(point: Point): void {
    if (!this.dragStart) return;
    this.dragCurrent = point;
  }

  pointerUp(point: Point): void {
    if (!this.dragStart) return;

    const zone = zoneFromDrag(this.dragStart, point, this.gameRect);
    if (this.step === "inactive") {
      this.inactiveZone = zone;
      this.activeZone = defaultActiveZone(zone);
      this.step = "review";
    } else {
      this.activeZone = zone;
      this.step = "review";
    }

    this.dragStart = null;
    this.dragCurrent = null;
  }

  canSave(): boolean {
    return this.inactiveZone !== null && this.activeZone !== null;
  }

  startActiveEditing(): void {
    if (this.canSave()) this.step = "active";
  }

  cancelActiveEditing(): void {
    if (this.step === "active") this.step = "review";
  }

  snapshot(): MarkupSnapshot {
    return {
      step: this.step,
      inactiveZone: this.inactiveZone,
      activeZone: this.activeZone,
      previewZone: this.previewZone(),
    };
  }

  private previewZone(): Zone | null {
    if (!this.dragStart || !this.dragCurrent) return null;
    return zoneFromDrag(this.dragStart, this.dragCurrent, this.gameRect);
  }
}
