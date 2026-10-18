import type { SendKind, SendResult } from "../telegram/send-result";

export type SendStatus = "pending" | "sent" | "error";

export interface SendState {
  requestId: string;
  kind: SendKind;
  status: SendStatus;
  error?: string;
  messageId?: string;
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
