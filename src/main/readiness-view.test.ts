import { describe, expect, test, vi } from "vitest";
import { focusReadinessTarget, readinessView } from "./readiness-view";
import type { ReadinessState } from "./readiness";

const STATE: ReadinessState = {
  steps: [
    { id: "telegram", complete: false, text: "Восстанавливаем связь", targetId: "telegram-heading" },
    { id: "chat", complete: true, text: "Игровая команда", targetId: "tg-chat-label" },
    { id: "game", complete: true, text: "Игр: 1", targetId: "profiles-heading" },
    { id: "ready", complete: false, text: "Почти готово" },
  ],
  next: { id: "telegram", complete: false, text: "Восстанавливаем связь", targetId: "telegram-heading" },
};

describe("readinessView", () => {
  test("maps readiness to the same four static slots", () => {
    const slots = readinessView(STATE);
    expect(slots.map((slot) => slot.id)).toEqual(["telegram", "chat", "game", "ready"]);
    expect(slots).toHaveLength(4);
  });

  test("enables only an unfinished step with a destination", () => {
    expect(readinessView(STATE)).toMatchObject([
      { id: "telegram", disabled: false, targetId: "telegram-heading" },
      { id: "chat", disabled: true },
      { id: "game", disabled: true },
      { id: "ready", disabled: true },
    ]);
  });

  test("enables only the next available action when earlier setup is missing", () => {
    const state: ReadinessState = {
      steps: [
        { id: "telegram", complete: false, text: "Войти в Telegram", targetId: "telegram-heading" },
        { id: "chat", complete: false, text: "Выберите чат", targetId: "tg-chat-label" },
        { id: "game", complete: false, text: "Добавьте игру", targetId: "profiles-heading" },
        { id: "ready", complete: false, text: "Почти готово" },
      ],
      next: { id: "telegram", complete: false, text: "Войти в Telegram", targetId: "telegram-heading" },
    };

    expect(readinessView(state).map((slot) => slot.disabled)).toEqual([false, true, true, true]);
  });
});

describe("focusReadinessTarget", () => {
  test("focuses the target before scrolling", () => {
    const target = { focus: vi.fn(), scrollIntoView: vi.fn() };
    focusReadinessTarget(target);
    expect(target.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
  });
});
