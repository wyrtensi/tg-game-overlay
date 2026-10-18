export function playbackDeadline(existing: number | undefined, startedAt: number, seconds: number): number | null {
  if (seconds <= 0) return null;
  return existing ?? startedAt + seconds * 1_000;
}

export function remainingPlaybackMs(now: number, deadline: number | null): number | null {
  if (deadline === null) return null;
  return Math.max(0, deadline - now);
}
