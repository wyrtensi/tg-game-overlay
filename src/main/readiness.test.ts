import { describe, expect, test } from "vitest";
import { readinessState } from "./readiness";
import type { Config } from "./types";

const CHAT: NonNullable<Config["chat"]> = { kind: "chat", id: "42", title: "Игровая команда" };
const PROFILE: Config["profiles"][number] = {
  exe: "game.exe",
  title: "Игра",
  mode: "show",
  inactive: { x: 0, y: 0, width: 1, height: 1 },
  active: { x: 0, y: 0, width: 1, height: 1 },
};

function config(overrides: Partial<Pick<Config, "chat" | "profiles" | "hotkey" | "transport" | "relay" | "apiId">> = {}) {
  return { chat: null, profiles: [], hotkey: "Ctrl+T", ...overrides };
}

describe("readinessState", () => {
  test("requires Telegram login before every other first-run step", () => {
    const state = readinessState({ state: "offline" }, config({ chat: CHAT, profiles: [PROFILE] }));
    expect(state.next).toMatchObject({ id: "telegram", targetId: "telegram-heading", text: "Войти в Telegram" });
  });

  test("requires a chat before a game", () => {
    const state = readinessState({ state: "connected" }, config({ profiles: [PROFILE] }));
    expect(state.next).toMatchObject({ id: "chat", targetId: "tg-chat-label", text: "Выберите чат" });
  });

  test("requires a game before ready", () => {
    const state = readinessState({ state: "connected" }, config({ chat: CHAT }));
    expect(state.next).toMatchObject({ id: "game", targetId: "profiles-heading", text: "Добавьте игру" });
  });

  test("keeps the selected chat visible during reconnect", () => {
    const state = readinessState({ state: "reconnecting", waitSeconds: 5 }, config({ chat: CHAT, profiles: [PROFILE] }));
    expect(state.steps.find((step) => step.id === "chat")).toMatchObject({ complete: true, text: CHAT.title });
    expect(state.next).toMatchObject({ id: "telegram", targetId: "telegram-heading", text: "Восстанавливаем связь" });
  });

  test("shows login next for an expired session", () => {
    const state = readinessState({ state: "reauth_required" }, config({ chat: CHAT, profiles: [PROFILE] }));
    expect(state.next).toMatchObject({ id: "telegram", targetId: "telegram-heading", text: "Войти заново" });
  });

  test("marks every step ready only with Telegram, chat, and game", () => {
    const state = readinessState({ state: "connected" }, config({ chat: CHAT, profiles: [PROFILE] }));
    expect(state.next).toBeNull();
    expect(state.steps[state.steps.length - 1]).toMatchObject({ id: "ready", complete: true, text: "Готово — Ctrl+T" });
  });

  test("asks for own API keys when the build has none", () => {
    const state = readinessState({ state: "offline" }, config(), { builtinKeys: false });
    expect(state.next).toMatchObject({ id: "telegram", targetId: "tg-api-keys-summary", text: "Нужны свои ключи API" });
    const withKeys = readinessState({ state: "offline" }, config({ apiId: 123 }), { builtinKeys: false });
    expect(withKeys.next).toMatchObject({ id: "telegram", text: "Войти в Telegram" });
  });

  test("guides the relay transport through server and room", () => {
    const relay = { url: "", room: "", displayName: "" };
    const offline = readinessState({ state: "offline" }, config({ transport: "relay", relay, profiles: [PROFILE] }));
    expect(offline.next).toMatchObject({ id: "telegram", targetId: "relay-heading", text: "Настройте сервер" });
    const connected = readinessState({ state: "connected" }, config({ transport: "relay", relay: { ...relay, room: "Squad" }, profiles: [PROFILE] }), { builtinKeys: false });
    expect(connected.steps.find((step) => step.id === "chat")).toMatchObject({ complete: true, text: "Комната «Squad»" });
    expect(connected.next).toBeNull();
  });
});
