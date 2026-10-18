import type { OverlayMessage } from "./types";

/** Pushed as history right after connect (CONTRACT.md step 4: "last ~20"). */
export const HISTORY_LIMIT = 20;

/** Duck-typed subset of a GramJS sender (User | Chat | Channel). */
export interface SenderLike {
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  title?: string | null;
}

/** Duck-typed subset of a GramJS `Api.Message` we need for the overlay feed. */
export interface MessageLike {
  id: number;
  message?: string | null;
  date: number; // unix seconds, as GramJS gives it
  out?: boolean | null;
}

export function resolveAuthorName(sender: SenderLike | undefined, fallback = "?"): string {
  if (!sender) return fallback;
  if (sender.title) return sender.title;

  const fullName = [sender.firstName, sender.lastName].filter(Boolean).join(" ").trim();
  if (fullName) return fullName;

  if (sender.username) return `@${sender.username}`;

  return fallback;
}

/** Converts a GramJS message into the OverlayMessage shape from CONTRACT.md. Media is attached separately (it downloads async - see media.ts / client.ts). */
export function mapMessageToOverlay(message: MessageLike, author: string): OverlayMessage {
  return {
    id: String(message.id),
    author,
    text: message.message ?? "",
    at: message.date * 1000,
    outgoing: message.out ? true : undefined,
  };
}
