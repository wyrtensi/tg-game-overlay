// Bounds applied to what a room member or the relay server sends. The
// envelope is authenticated by the room key, but anyone in the room (and a
// hostile server, for the fields it controls) can still send oversized or
// replayed content.

/** Longest chat line shown from the relay, in characters. */
export const MAX_TEXT_CHARS = 4096;
/** Matches the phrase wheel validator (src/main/phrase-wheel-settings.ts). */
export const MAX_PHRASE_CHARS = 160;
/**
 * A live direction or phrase whose sender timestamp is further than this
 * from the local clock is dropped: it is either replayed ciphertext captured
 * earlier or a sender with a badly wrong clock.
 */
export const MAX_SIGNAL_SKEW_MS = 2 * 60 * 1000;
/** Server times before 2020 cannot belong to this relay protocol. */
const MIN_SERVER_TIME_MS = Date.UTC(2020, 0, 1);

/** Cuts `text` to at most `max` code points without splitting a surrogate pair. */
export function capCodePoints(text: string, max: number): string {
  if (text.length <= max) return text;
  let count = 0;
  let end = 0;
  for (const char of text) {
    if (count === max) break;
    count += 1;
    end += char.length;
  }
  return text.slice(0, end);
}

/**
 * The server-assigned `at`, unless it is not a usable time: a value that is
 * not finite, predates the protocol or lies in the future becomes `now`
 * (a hostile server could otherwise send 1e300 and break date rendering).
 */
export function sanitizeServerTime(at: unknown, now: number): number {
  if (typeof at !== "number" || !Number.isFinite(at) || at < MIN_SERVER_TIME_MS) return now;
  return Math.min(at, now);
}

export function isFreshSignal(sentAt: number, now: number): boolean {
  return Math.abs(now - sentAt) <= MAX_SIGNAL_SKEW_MS;
}
