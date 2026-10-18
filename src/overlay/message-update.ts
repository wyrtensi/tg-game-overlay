import type { ChatMessage } from "../core/feed";

interface WithDataUrl {
  dataUrl: string;
}

/**
 * Whether a message pushed again under a known id differs from what its line
 * shows. Workers re-push unchanged messages (history after a reconnect, or a
 * text placeholder whose media is already shown); repainting those would
 * rebuild the media and replay animated stickers for nothing.
 */
export function messageChanged(
  previous: ChatMessage,
  previousMedia: WithDataUrl | undefined,
  next: ChatMessage & { media?: WithDataUrl },
): boolean {
  if (
    previous.text !== next.text
    || previous.author !== next.author
    || previous.at !== next.at
    || Boolean(previous.outgoing) !== Boolean(next.outgoing)
  ) {
    return true;
  }
  return next.media !== undefined && next.media.dataUrl !== previousMedia?.dataUrl;
}
