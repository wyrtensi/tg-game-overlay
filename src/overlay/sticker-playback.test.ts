import { expect, test } from "vitest";
import { playbackDeadline, remainingPlaybackMs } from "./sticker-playback";

test("sets a stable ten-second deadline", () => {
  expect(playbackDeadline(undefined, 1_000, 10)).toBe(11_000);
  expect(playbackDeadline(11_000, 4_000, 10)).toBe(11_000);
  expect(remainingPlaybackMs(4_000, 11_000)).toBe(7_000);
});

test("disables playback for zero seconds", () => {
  expect(playbackDeadline(undefined, 1_000, 0)).toBeNull();
});
