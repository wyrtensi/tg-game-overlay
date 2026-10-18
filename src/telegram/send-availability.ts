import type { SendKind, SendResult } from "./send-result";

export interface SendAvailability {
  clientConnected: boolean;
  chatSelected: boolean;
  reconnecting: boolean;
}

/** Returns a correlated failure before a disconnected worker can create a false local echo. */
export function unavailableSendResult(
  requestId: string,
  kind: SendKind,
  availability: SendAvailability,
): SendResult | null {
  if (availability.clientConnected && availability.chatSelected) return null;
  const error = availability.reconnecting
    ? "Сообщение не отправлено, связь восстанавливается"
    : "Telegram не подключён или чат не выбран";
  return { requestId, kind, ok: false, error };
}
