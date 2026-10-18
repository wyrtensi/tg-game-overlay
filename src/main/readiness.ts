import type { ChatRef, Config, TgStatus } from "./types";

export type ReadinessStepId = "telegram" | "chat" | "game" | "ready";

export interface ReadinessStep {
  id: ReadinessStepId;
  complete: boolean;
  text: string;
  targetId?: string;
}

export interface ReadinessState {
  steps: ReadinessStep[];
  next: ReadinessStep | null;
}

type ReadinessConfig = Pick<Config, "chat" | "profiles" | "hotkey" | "transport" | "relay" | "apiId">;

export interface ReadinessContext {
  /** False in public builds, where Telegram needs the user's own api_id / api_hash. */
  builtinKeys?: boolean;
}

/** Derives first-run guidance from already persisted settings and current connection state. */
export function readinessState(status: TgStatus, config: ReadinessConfig, context: ReadinessContext = {}): ReadinessState {
  const relay = config.transport === "relay";
  const telegramComplete = status.state === "connected";
  const selectedChat = config.chat ?? null;
  const room = config.relay?.room.trim() ?? "";
  const chatComplete = relay ? room.length > 0 : selectedChat !== null;
  const gameComplete = config.profiles.length > 0;
  const needsKeys = !relay && context.builtinKeys === false && !config.apiId;
  const telegram = relay ? relayStep(status, telegramComplete) : telegramStep(status, telegramComplete, needsKeys);
  const chat = relay ? roomStep(room, chatComplete) : chatStep(selectedChat, chatComplete);
  const game = gameStep(config.profiles.length, gameComplete);
  const ready: ReadinessStep = {
    id: "ready",
    complete: telegramComplete && chatComplete && gameComplete,
    text: telegramComplete && chatComplete && gameComplete ? `Готово — ${config.hotkey}` : "Почти готово",
  };
  const steps = [telegram, chat, game, ready];
  return { steps, next: steps.find((step) => !step.complete && step.targetId) ?? null };
}

function telegramStep(status: TgStatus, complete: boolean, needsKeys: boolean): ReadinessStep {
  if (!complete && needsKeys) {
    return { id: "telegram", complete, text: "Нужны свои ключи API", targetId: "tg-api-keys-summary" };
  }
  const text = status.state === "connected"
    ? "Подключено"
    : status.state === "reconnecting"
      ? "Восстанавливаем связь"
      : status.state === "reauth_required"
        ? "Войти заново"
        : "Войти в Telegram";
  return { id: "telegram", complete, text, targetId: "telegram-heading" };
}

function relayStep(status: TgStatus, complete: boolean): ReadinessStep {
  const text = status.state === "connected"
    ? "Подключено"
    : status.state === "reconnecting" || status.state === "connecting"
      ? "Подключаемся к серверу"
      : status.state === "error"
        ? "Проверьте ключ доступа"
        : "Настройте сервер";
  return { id: "telegram", complete, text, targetId: "relay-heading" };
}

function roomStep(room: string, complete: boolean): ReadinessStep {
  return { id: "chat", complete, text: complete ? `Комната «${room}»` : "Укажите комнату", targetId: "relay-room-input" };
}

function chatStep(chat: ChatRef | null, complete: boolean): ReadinessStep {
  return {
    id: "chat",
    complete,
    text: chat?.title ?? "Выберите чат",
    targetId: "tg-chat-label",
  };
}

function gameStep(profileCount: number, complete: boolean): ReadinessStep {
  return {
    id: "game",
    complete,
    text: profileCount > 0 ? `Игр: ${profileCount}` : "Добавьте игру",
    targetId: "profiles-heading",
  };
}
