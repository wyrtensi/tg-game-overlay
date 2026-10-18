export type SendKind = "text" | "sticker" | "file" | "direction" | "phrase";

export interface SendResult {
  requestId: string;
  kind: SendKind;
  ok: boolean;
  error?: string;
  messageId?: string;
}

export function sendErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Telegram не подтвердил отправку";
}
