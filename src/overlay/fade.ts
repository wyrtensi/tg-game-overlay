/**
 * CSS animation delay (in ms) for a passive-feed message's fade-out.
 * The fade is meant to start at `ttlMs - fadeMs` and last `fadeMs`, ending
 * exactly when the feed would drop the message. A negative result is a
 * valid CSS animation-delay: it starts the animation already in progress,
 * which is what a message needs if it is rendered partway through its fade
 * (e.g. the overlay just came back from being hidden).
 */
export function fadeDelayMs(ageMs: number, ttlMs: number, fadeMs: number): number {
  return ttlMs - fadeMs - ageMs;
}
