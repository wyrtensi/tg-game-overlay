const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;

/** Exponential backoff for the reconnect loop (CONTRACT.md: "reconnect on drop with backoff"). */
export function computeBackoffMs(attempt: number): number {
  const safeAttempt = Math.max(0, attempt);
  return Math.min(BASE_DELAY_MS * 2 ** safeAttempt, MAX_DELAY_MS);
}
