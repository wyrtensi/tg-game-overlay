import { describe, expect, test } from "vitest";
import { formatKeyCombo, hotkeyFieldKeyAction, validateHotkeyCombo } from "./hotkey";

describe("formatKeyCombo", () => {
  test("formats a letter key with two modifiers", () => {
    const combo = formatKeyCombo({
      key: "t",
      code: "KeyT",
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
    });

    expect(combo).toBe("Ctrl+Shift+T");
  });

  test("orders modifiers as Ctrl, Alt, Shift, Win", () => {
    const combo = formatKeyCombo({
      key: "m",
      code: "KeyM",
      ctrlKey: true,
      shiftKey: true,
      altKey: true,
      metaKey: true,
    });

    expect(combo).toBe("Ctrl+Alt+Shift+Win+M");
  });

  test("formats a digit key", () => {
    const combo = formatKeyCombo({
      key: "1",
      code: "Digit1",
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
      metaKey: false,
    });

    expect(combo).toBe("Ctrl+1");
  });

  test("formats a function key", () => {
    const combo = formatKeyCombo({
      key: "F4",
      code: "F4",
      ctrlKey: false,
      shiftKey: false,
      altKey: true,
      metaKey: false,
    });

    expect(combo).toBe("Alt+F4");
  });

  test("returns null while only a modifier key itself is pressed", () => {
    const combo = formatKeyCombo({
      key: "Shift",
      code: "ShiftLeft",
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
      metaKey: false,
    });

    expect(combo).toBeNull();
  });

  test("formats a key with no modifiers held (still returned, validation rejects it later)", () => {
    const combo = formatKeyCombo({
      key: "a",
      code: "KeyA",
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: false,
    });

    expect(combo).toBe("A");
  });
});

describe("validateHotkeyCombo", () => {
  test("accepts a combo with a modifier and a main key", () => {
    expect(validateHotkeyCombo("Ctrl+Shift+T")).toBeUndefined();
  });

  test("rejects a combo without any modifier", () => {
    expect(validateHotkeyCombo("A")).toBe("Нужен хотя бы один модификатор: Ctrl, Alt, Shift или Win");
  });

  test("rejects an empty combo", () => {
    expect(validateHotkeyCombo("")).toBe("Комбинация клавиш не задана");
  });
});

describe("hotkeyFieldKeyAction", () => {
  const key = (code: string, modifiers: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }> = {}) => ({
    key: code,
    code,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...modifiers,
  });

  test("lets Tab and Shift+Tab move focus instead of becoming the hotkey", () => {
    expect(hotkeyFieldKeyAction(key("Tab"))).toBe("navigate");
    expect(hotkeyFieldKeyAction(key("Tab", { shiftKey: true }))).toBe("navigate");
    expect(hotkeyFieldKeyAction(key("Tab", { ctrlKey: true }))).toBe("record");
  });

  test("cancels on Esc", () => {
    expect(hotkeyFieldKeyAction(key("Escape"))).toBe("cancel");
  });

  test("ignores a bare Backspace or Delete", () => {
    expect(hotkeyFieldKeyAction(key("Backspace"))).toBe("ignore");
    expect(hotkeyFieldKeyAction(key("Delete", { shiftKey: true }))).toBe("ignore");
    expect(hotkeyFieldKeyAction(key("Delete", { ctrlKey: true, altKey: true }))).toBe("record");
  });

  test("records ordinary keys", () => {
    expect(hotkeyFieldKeyAction(key("KeyT"))).toBe("record");
    expect(hotkeyFieldKeyAction(key("Enter"))).toBe("record");
  });
});
