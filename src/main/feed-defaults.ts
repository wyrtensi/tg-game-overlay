import type { FeedAppearance } from "./types";

/** Values the "Сбросить по умолчанию" button restores, per the product spec. */
export const DEFAULT_FEED_SETTINGS: FeedAppearance = {
  ttlMs: 10000,
  opacity: 0.45,
  fontScale: 1,
  textColor: "#f2f2f2",
  authorColor: "#7fb2ff",
  shadow: 0.85,
  fadeMs: 1200,
  stickerAnimationSeconds: 10,
  messageLayout: "compact",
  showAuthor: true,
  showMessageTime: true,
  incomingBubbleColor: "#1c222c",
  outgoingBubbleColor: "#1e5d92",
};
