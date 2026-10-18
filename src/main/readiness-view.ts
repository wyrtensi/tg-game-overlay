import type { ReadinessState, ReadinessStepId } from "./readiness";

export interface ReadinessViewSlot {
  id: ReadinessStepId;
  text: string;
  complete: boolean;
  disabled: boolean;
  targetId?: string;
}

export interface ReadinessTarget {
  focus(options: FocusOptions): void;
  scrollIntoView(options: ScrollIntoViewOptions): void;
}

const STEP_ORDER: ReadinessStepId[] = ["telegram", "chat", "game", "ready"];

/** Converts readiness data into the four slots already present in the settings page. */
export function readinessView(state: ReadinessState): ReadinessViewSlot[] {
  return STEP_ORDER.map((id) => {
    const step = state.steps.find((candidate) => candidate.id === id);
    if (!step) throw new Error(`Missing readiness step: ${id}`);
    return {
      id,
      text: step.text,
      complete: step.complete,
      disabled: step.complete || !step.targetId || state.next?.id !== id,
      targetId: step.targetId,
    };
  });
}

/** Moves keyboard focus before the one-shot visual scroll to an existing settings section. */
export function focusReadinessTarget(target: ReadinessTarget): void {
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: "start", behavior: "smooth" });
}
