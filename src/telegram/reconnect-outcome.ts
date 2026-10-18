import type { ReconnectOutcome } from "./reconnect-loop";
import { isSessionAuthorizationError } from "./reconnect-policy";

export type ReconnectFailureOutcome = Exclude<ReconnectOutcome, { kind: "connected" }>;

/** Classifies a failed connection without exposing Telegram transport details to the UI. */
export function reconnectFailureOutcome(error: unknown): ReconnectFailureOutcome {
  if (isSessionAuthorizationError(error)) return { kind: "reauth_required" };

  const floodWaitSeconds = readFloodWaitSeconds(error);
  return floodWaitSeconds === undefined ? { kind: "retry" } : { kind: "retry", floodWaitSeconds };
}

function readFloodWaitSeconds(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("seconds" in error)) return undefined;
  const seconds = Number(error.seconds);
  return Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : undefined;
}
