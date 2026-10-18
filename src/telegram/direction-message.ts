export type Direction = "up" | "down" | "left" | "right";

export interface DirectionMessageRequest {
  direction: Direction;
  messageId?: number;
}

export interface DirectionMessageTransport {
  edit(messageId: number, emoji: string): Promise<{ id: number }>;
  send(emoji: string): Promise<{ id: number }>;
  errorCode(error: unknown): string;
}

const DIRECTION_EMOJI: Record<Direction, string> = {
  up: "⬆️",
  down: "⬇️",
  left: "⬅️",
  right: "➡️",
};

const RECREATE_MESSAGE_ERRORS = new Set([
  "MESSAGE_ID_INVALID",
  "MESSAGE_EDIT_TIME_EXPIRED",
  "MESSAGE_AUTHOR_REQUIRED",
  "CHAT_WRITE_FORBIDDEN",
]);

export function directionEmoji(direction: Direction): string {
  return DIRECTION_EMOJI[direction];
}

/**
 * The same arrow with the emoji variation selector toggled. Telegram answers
 * MESSAGE_NOT_MODIFIED to an edit that keeps the text, so repeating the
 * current direction would reach nobody; the variant looks the same and
 * directionFromText reads both.
 */
export function alternateDirectionText(text: string): string {
  return text.includes("️") ? text.replace(/️/g, "") : `${text}️`;
}

/** Edits to `text`, or to `alternate` when the message already shows `text`. */
export async function editWithVariant(
  transport: Pick<DirectionMessageTransport, "edit" | "errorCode">,
  messageId: number,
  text: string,
  alternate: string,
): Promise<{ id: number }> {
  try {
    return await transport.edit(messageId, text);
  } catch (error) {
    if (transport.errorCode(error) !== "MESSAGE_NOT_MODIFIED") throw error;
  }
  try {
    return await transport.edit(messageId, alternate);
  } catch (error) {
    // Telegram normalized the variant away; the message is current either way.
    if (transport.errorCode(error) === "MESSAGE_NOT_MODIFIED") return { id: messageId };
    throw error;
  }
}

export function directionFromText(text: string): Direction | null {
  const normalized = text.replace(/\uFE0F/g, "");
  for (const [direction, emoji] of Object.entries(DIRECTION_EMOJI) as Array<[Direction, string]>) {
    if (normalized === emoji.replace(/\uFE0F/g, "")) return direction;
  }
  return null;
}

export function directionFallback(errorCode: string): "send-new" | "keep-existing" {
  return RECREATE_MESSAGE_ERRORS.has(errorCode) ? "send-new" : "keep-existing";
}

export function telegramErrorCode(error: unknown): string {
  const rpcCode = typeof error === "object" && error !== null && "errorMessage" in error
    ? (error as { errorMessage?: unknown }).errorMessage
    : undefined;
  const text = typeof rpcCode === "string"
    ? rpcCode
    : error instanceof Error
      ? error.message
      : String(error);
  const matches = text.match(/[A-Z][A-Z0-9_]*_[A-Z0-9_]+/g);
  return matches?.[matches.length - 1] ?? text;
}

export async function sendOrEditDirection(
  request: DirectionMessageRequest,
  transport: DirectionMessageTransport,
): Promise<{ messageId: number; created: boolean }> {
  const emoji = directionEmoji(request.direction);
  if (request.messageId !== undefined) {
    try {
      const edited = await editWithVariant(transport, request.messageId, emoji, alternateDirectionText(emoji));
      return { messageId: edited.id, created: false };
    } catch (error) {
      if (directionFallback(transport.errorCode(error)) !== "send-new") throw error;
    }
  }

  const sent = await transport.send(emoji);
  return { messageId: sent.id, created: true };
}
