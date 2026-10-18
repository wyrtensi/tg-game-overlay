import { describe, expect, test } from "vitest";
import { currentLoginStep, describeTelegramStatus, formatCountdown, reconnectAction, shouldClearLoginInput } from "./telegram-status";

describe("formatCountdown", () => {
  test("formats under a minute as 0:ss", () => {
    expect(formatCountdown(5)).toBe("0:05");
  });

  test("formats over a minute as m:ss", () => {
    expect(formatCountdown(65)).toBe("1:05");
  });

  test("formats an exact ten minutes", () => {
    expect(formatCountdown(600)).toBe("10:00");
  });

  test("clamps a negative value to zero", () => {
    expect(formatCountdown(-3)).toBe("0:00");
  });

  test("rounds down fractional seconds", () => {
    expect(formatCountdown(65.9)).toBe("1:05");
  });
});

describe("describeTelegramStatus", () => {
  test("offline", () => {
    expect(describeTelegramStatus({ state: "offline" })).toBe("Не подключено");
  });

  test("connecting", () => {
    expect(describeTelegramStatus({ state: "connecting" })).toBe("Подключение…");
  });

  test("waiting for the code", () => {
    expect(describeTelegramStatus({ state: "code" })).toBe("Введите код из Telegram");
  });

  test("keeps the submitted phone visible while waiting for the code", () => {
    expect(describeTelegramStatus({ state: "code", phone: "+79261234567" })).toBe(
      "Введите код из Telegram для +79261234567",
    );
  });

  test("waiting for the 2FA password", () => {
    expect(describeTelegramStatus({ state: "password" })).toBe("Введите пароль двухфакторной аутентификации");
  });

  test("connected with a phone number", () => {
    expect(describeTelegramStatus({ state: "connected", phone: "+79261234567" })).toBe(
      "Подключено: +79261234567",
    );
  });

  test("connected without a phone number", () => {
    expect(describeTelegramStatus({ state: "connected" })).toBe("Подключено");
  });

  test("error with a message from the worker", () => {
    expect(describeTelegramStatus({ state: "error", error: "Неверный код" })).toBe("Неверный код");
  });

  test("error without a message falls back to a generic label", () => {
    expect(describeTelegramStatus({ state: "error" })).toBe("Ошибка подключения");
  });

  test("error with a flood wait appends a live countdown", () => {
    expect(describeTelegramStatus({ state: "error", error: "Слишком много попыток", waitSeconds: 65 })).toBe(
      "Слишком много попыток. Повтор через 1:05",
    );
  });

  test("connecting with a wait time also shows the countdown", () => {
    expect(describeTelegramStatus({ state: "connecting", waitSeconds: 5 })).toBe("Подключение… Повтор через 0:05");
  });

  test("describes a scheduled reconnect", () => {
    expect(describeTelegramStatus({ state: "reconnecting", waitSeconds: 5 })).toBe(
      "Связь потеряна. Повтор через 0:05",
    );
  });

  test("describes an expired session without a technical error", () => {
    expect(describeTelegramStatus({ state: "reauth_required" })).toBe("Сессия закончилась. Войдите заново");
  });

  test("a wait time of zero is not shown", () => {
    expect(describeTelegramStatus({ state: "connecting", waitSeconds: 0 })).toBe("Подключение…");
  });
});

describe("currentLoginStep", () => {
  test("offline shows the phone step", () => {
    expect(currentLoginStep({ state: "offline" }, "phone")).toBe("phone");
  });

  test("the worker asking for a code shows the code step regardless of what was last submitted", () => {
    expect(currentLoginStep({ state: "code" }, "phone")).toBe("code");
  });

  test("the worker asking for a password shows the password step", () => {
    expect(currentLoginStep({ state: "password" }, "code")).toBe("password");
  });

  test("an error after submitting the phone re-shows the phone step", () => {
    expect(currentLoginStep({ state: "error", error: "bad phone" }, "phone")).toBe("phone");
  });

  test("an error after submitting the code re-shows the code step", () => {
    expect(currentLoginStep({ state: "error", error: "bad code" }, "code")).toBe("code");
  });

  test("an error after submitting the password re-shows the password step", () => {
    expect(currentLoginStep({ state: "error", error: "bad password" }, "password")).toBe("password");
  });

  test("connecting keeps showing the step that was just submitted", () => {
    expect(currentLoginStep({ state: "connecting" }, "code")).toBe("code");
  });

  test("connecting right after the initial phone submit shows the phone step", () => {
    expect(currentLoginStep({ state: "connecting" }, "phone")).toBe("phone");
  });
});

describe("reconnectAction", () => {
  test("shows a reconnect action while a saved session is recovering", () => {
    expect(reconnectAction({ state: "reconnecting", waitSeconds: 5 })).toEqual({ visible: true, disabled: false });
  });

  test("disables the action while its immediate retry is starting", () => {
    expect(reconnectAction({ state: "reconnecting", waitSeconds: 0 })).toEqual({ visible: true, disabled: true });
  });

  test("hides the action outside recovery", () => {
    expect(reconnectAction({ state: "connected" })).toEqual({ visible: false, disabled: true });
  });
});

describe("shouldClearLoginInput", () => {
  test("clears the phone before the code step", () => {
    expect(shouldClearLoginInput("phone", "code")).toBe(true);
  });

  test("keeps a code after a rejected code attempt", () => {
    expect(shouldClearLoginInput("code", "code")).toBe(false);
  });
});
