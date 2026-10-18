import type { LoginStep, TgStatus } from "./types";

/** Formats a FLOOD_WAIT-style remaining time as a live "m:ss" countdown. */
export function formatCountdown(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(clamped / 60);
  const rest = clamped % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

const BASE_LABELS: Record<TgStatus["state"], (status: TgStatus) => string> = {
  offline: () => "Не подключено",
  connecting: () => "Подключение…",
  reconnecting: () => "Связь потеряна",
  code: (status) => (status.phone ? `Введите код из Telegram для ${status.phone}` : "Введите код из Telegram"),
  password: () => "Введите пароль двухфакторной аутентификации",
  connected: (status) => (status.phone ? `Подключено: ${status.phone}` : "Подключено"),
  reauth_required: () => "Сессия закончилась. Войдите заново",
  error: (status) => status.error || "Ошибка подключения",
};

/** A single Russian line describing the current Telegram connection status. */
export function describeTelegramStatus(status: TgStatus): string {
  const base = BASE_LABELS[status.state](status);

  if (status.waitSeconds && status.waitSeconds > 0) {
    const separator = /[.!?…]$/.test(base) ? " " : ". ";
    return `${base}${separator}Повтор через ${formatCountdown(status.waitSeconds)}`;
  }

  return base;
}

export interface ReconnectAction {
  visible: boolean;
  disabled: boolean;
}

/** Keeps the manual retry unavailable while its zero-delay reconnect is starting. */
export function reconnectAction(status: TgStatus): ReconnectAction {
  if (status.state !== "reconnecting") return { visible: false, disabled: true };
  return { visible: true, disabled: !status.waitSeconds };
}

export type LoginFormStep = "phone" | "code" | "password";

/** The field must never carry a phone number or code into the next login step. */
export function shouldClearLoginInput(previous: LoginFormStep | undefined, next: LoginFormStep): boolean {
  return previous !== undefined && previous !== next;
}

/**
 * Which step of the login form to show. The worker's "code"/"password"
 * states are authoritative; "error" and "connecting" don't say which step
 * they belong to, so we fall back to whatever the user last submitted.
 */
export function currentLoginStep(status: TgStatus, lastAttempted: LoginStep): LoginFormStep {
  if (status.state === "code") return "code";
  if (status.state === "password") return "password";
  if (status.state === "error" || status.state === "connecting") {
    return lastAttempted === "logout" ? "phone" : lastAttempted;
  }
  return "phone";
}
