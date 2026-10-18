import { computeBackoffMs } from "./backoff";

const SESSION_AUTH_ERRORS = new Set([
  "AUTH_KEY_INVALID",
  "AUTH_KEY_UNREGISTERED",
  "SESSION_REVOKED",
  "USER_DEACTIVATED",
]);

/** Returns the next reconnect delay without violating a server-imposed wait. */
export function reconnectDelayMs(attempt: number, floodWaitSeconds?: number): number {
  return Math.max(computeBackoffMs(attempt), Math.max(0, floodWaitSeconds ?? 0) * 1000);
}

/** True only for Telegram errors which prove that the saved session cannot recover. */
export function isSessionAuthorizationError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("errorMessage" in error)) return false;
  return SESSION_AUTH_ERRORS.has(String(error.errorMessage));
}
