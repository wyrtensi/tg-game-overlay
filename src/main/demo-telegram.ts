import { normalizePhone, validatePhone } from "./phone";
import type { ChatRef, LoginStep, TgStatus } from "./types";

/** Fixed dialog list the demo backend "finds" when there's no Tauri host to ask. */
export const DEMO_DIALOGS: ChatRef[] = [
  { kind: "user", id: "demo-user-1", title: "Алекс", username: "alex_demo" },
  { kind: "chat", id: "demo-chat-1", title: "Соло-группа" },
  { kind: "channel", id: "demo-channel-1", title: "Игровые новости" },
  { kind: "chat", id: "demo-chat-2", title: "Dota 2 сквад" },
];

/** A magic demo phone number that reproduces a FLOOD_WAIT-style error with a countdown. */
const FLOOD_WAIT_PHONE = "+70000000000";
const CODE_RE = /^\d{4,6}$/;

export interface DemoLoginResult {
  status: TgStatus;
  /** Simulated network delay in ms before the status should be emitted; 0 for a synchronous reject. */
  delayMs: number;
}

/**
 * Decides the next tg:status for the demo (no-Tauri) login flow. Pure and
 * synchronous - the caller is responsible for the actual delayMs wait and
 * for emitting the result as a tg:status event.
 */
export function nextDemoStatus(step: LoginStep, value: string | undefined, phone: string | undefined): DemoLoginResult {
  if (step === "logout") {
    return { status: { state: "offline" }, delayMs: 0 };
  }

  if (step === "phone") {
    const normalized = normalizePhone(value ?? "");
    const error = validatePhone(normalized);
    if (error) return { status: { state: "error", error }, delayMs: 0 };

    if (normalized === FLOOD_WAIT_PHONE) {
      return {
        status: { state: "error", error: "Слишком много попыток входа", waitSeconds: 30 },
        delayMs: 400,
      };
    }

    return { status: { state: "code", phone: normalized }, delayMs: 500 };
  }

  if (step === "code") {
    const code = (value ?? "").trim();
    if (!CODE_RE.test(code)) {
      return { status: { state: "error", error: "Неверный код", phone }, delayMs: 300 };
    }
    if (code === "000000") {
      return { status: { state: "password", phone }, delayMs: 400 };
    }
    return { status: { state: "connected", phone }, delayMs: 400 };
  }

  // step === "password"
  const password = value ?? "";
  if (password === "wrong") {
    return { status: { state: "error", error: "Неверный пароль", phone }, delayMs: 300 };
  }
  return { status: { state: "connected", phone }, delayMs: 400 };
}
