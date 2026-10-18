import type { MessageLayout } from "../main/types";

export function messageClassNames(outgoing: boolean | undefined, layout: MessageLayout): string[] {
  return ["msg", ...(outgoing ? ["msg--outgoing"] : []), ...(layout === "dialogue" ? ["msg--dialogue"] : [])];
}

export function shouldRenderAuthor(showAuthor: boolean): boolean {
  return showAuthor;
}

/**
 * The `<time>` attribute and label for a message, or null when `at` is not a
 * representable date: Date#toISOString and Intl formatting both throw
 * RangeError there, which inside render() would stop the feed updating.
 */
export function messageTime(at: number, formatter: Pick<Intl.DateTimeFormat, "format">): { dateTime: string; label: string } | null {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  return { dateTime: date.toISOString(), label: formatter.format(date) };
}

/** A usable arrival time for the feed's ttl and fade math. */
export function messageTimestamp(at: unknown, now: number): number {
  return typeof at === "number" && !Number.isNaN(new Date(at).getTime()) ? at : now;
}

export function messageContent(
  text: string,
  showAuthor: boolean,
  hasStickerMedia = false,
): { showAuthor: boolean; showText: boolean } {
  return { showAuthor: shouldRenderAuthor(showAuthor), showText: text.length > 0 && !(hasStickerMedia && text === "[стикер]") };
}
