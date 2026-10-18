import type { MessageLayout } from "../main/types";

export function messageClassNames(outgoing: boolean | undefined, layout: MessageLayout): string[] {
  return ["msg", ...(outgoing ? ["msg--outgoing"] : []), ...(layout === "dialogue" ? ["msg--dialogue"] : [])];
}

export function shouldRenderAuthor(showAuthor: boolean): boolean {
  return showAuthor;
}

export function messageContent(
  text: string,
  showAuthor: boolean,
  hasStickerMedia = false,
): { showAuthor: boolean; showText: boolean } {
  return { showAuthor: shouldRenderAuthor(showAuthor), showText: text.length > 0 && !(hasStickerMedia && text === "[стикер]") };
}
