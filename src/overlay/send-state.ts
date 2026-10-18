import type { SendKind, SendResult } from "../telegram/send-result";

export type SendStatus = "pending" | "sent" | "error";

export interface SendState {
  requestId: string;
  kind: SendKind;
  status: SendStatus;
  error?: string;
  messageId?: string;
}

/** A send the overlay is still waiting to hear back about. */
export interface PendingSend {
  kind: SendKind;
  text?: string;
  /** Data URL of the attached image, for a file send. */
  attachment?: string;
  stickerId?: string;
  startedAt: number;
}

/**
 * How long an unanswered send keeps blocking the same text: long enough for
 * a slow confirmation, short enough that a lost answer never locks the text.
 */
export const DUPLICATE_SEND_WINDOW_MS = 30_000;

/**
 * True when the same text (and attachment) is already on its way. The text
 * stays in the input until the confirmation arrives, so a double Enter or
 * key auto-repeat would otherwise send it twice.
 */
export function isDuplicateSend(
  pending: Iterable<PendingSend>,
  candidate: Pick<PendingSend, "kind" | "text" | "attachment">,
  now: number,
): boolean {
  for (const send of pending) {
    if (
      send.kind === candidate.kind
      && send.text === candidate.text
      && send.attachment === candidate.attachment
      && now - send.startedAt < DUPLICATE_SEND_WINDOW_MS
    ) {
      return true;
    }
  }
  return false;
}

export function beginSend(kind: SendKind, requestId: string): SendState {
  return { requestId, kind, status: "pending" };
}

export function applySendResult(state: SendState, result: SendResult): SendState {
  if (state.requestId !== result.requestId || state.kind !== result.kind) return state;
  if (result.ok) {
    return { ...state, status: "sent", messageId: result.messageId, error: undefined };
  }
  return {
    ...state,
    status: "error",
    error: result.error ?? "Telegram не подтвердил отправку",
  };
}
