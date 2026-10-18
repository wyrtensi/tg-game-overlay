/**
 * Whether a scrollable element is close enough to its bottom edge that
 * newly appended content should pull the view down with it. Used so that
 * arriving messages only autoscroll when the user was already reading live.
 */
export function isNearBottom(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  thresholdPx = 12,
): boolean {
  return scrollHeight - (scrollTop + clientHeight) <= thresholdPx;
}
