import { describe, expect, test } from "vitest";
import { MarkupSession } from "./markup-session";

const gameRect = { x: 0, y: 0, width: 1000, height: 800 };

describe("MarkupSession", () => {
  test("starts on the inactive-zone step with nothing drawn yet", () => {
    const session = new MarkupSession(gameRect);

    expect(session.snapshot()).toEqual({
      step: "inactive",
      inactiveZone: null,
      activeZone: null,
      previewZone: null,
    });
    expect(session.canSave()).toBe(false);
  });

  test("reports a preview zone while the first rectangle is being dragged", () => {
    const session = new MarkupSession(gameRect);

    session.pointerDown({ x: 0, y: 400 });
    session.pointerMove({ x: 300, y: 800 });

    expect(session.snapshot().previewZone).toEqual({ x: 0, y: 0.5, width: 0.3, height: 0.5 });
    expect(session.snapshot().step).toBe("inactive");
  });

  test("finishing the first drag sets the inactive zone and advances with a prefilled active zone", () => {
    const session = new MarkupSession(gameRect);

    session.pointerDown({ x: 0, y: 400 });
    session.pointerUp({ x: 300, y: 800 });

    const snapshot = session.snapshot();
    expect(snapshot.step).toBe("review");
    expect(snapshot.inactiveZone).toEqual({ x: 0, y: 0.5, width: 0.3, height: 0.5 });
    // Prefilled from defaultActiveZone: same width, bounded height, grown upwards.
    expect(snapshot.activeZone).toEqual({ x: 0, y: 0.5, width: 0.3, height: 0.5 });
    expect(snapshot.previewZone).toBeNull();
    expect(session.canSave()).toBe(true);
  });

  test("redrawing the active zone replaces the prefilled one", () => {
    const session = new MarkupSession(gameRect);
    session.pointerDown({ x: 0, y: 400 });
    session.pointerUp({ x: 300, y: 800 });

    session.startActiveEditing();
    session.pointerDown({ x: 0, y: 0 });
    session.pointerUp({ x: 300, y: 320 });

    const snapshot = session.snapshot();
    expect(snapshot.step).toBe("review");
    expect(snapshot.activeZone).toEqual({ x: 0, y: 0, width: 0.3, height: 0.4 });
    expect(snapshot.inactiveZone).toEqual({ x: 0, y: 0.5, width: 0.3, height: 0.5 });
  });

  test("cancelling active customization preserves the automatic active zone", () => {
    const session = new MarkupSession(gameRect);
    session.pointerDown({ x: 0, y: 400 });
    session.pointerUp({ x: 300, y: 800 });
    const automatic = session.snapshot().activeZone;

    session.startActiveEditing();
    session.cancelActiveEditing();

    expect(session.snapshot()).toMatchObject({ step: "review", activeZone: automatic });
  });

  test("a stray pointerUp without a preceding pointerDown is a no-op", () => {
    const session = new MarkupSession(gameRect);

    session.pointerUp({ x: 300, y: 800 });

    expect(session.snapshot().step).toBe("inactive");
    expect(session.canSave()).toBe(false);
  });
});
