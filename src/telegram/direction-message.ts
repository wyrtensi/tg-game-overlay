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
      const edited = await transport.edit(request.messageId, emoji);
      return { messageId: edited.id, created: false };
    } catch (error) {
      const code = transport.errorCode(error);
      if (code === "MESSAGE_NOT_MODIFIED") return { messageId: request.messageId, created: false };
      if (directionFallback(code) !== "send-new") throw error;
    }
  }

  const sent = await transport.send(emoji);
  return { messageId: sent.id, created: true };
}
