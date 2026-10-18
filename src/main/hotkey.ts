import { t } from "../i18n";
/**
 * Turning a keydown event into a hotkey string like "Ctrl+Shift+T", and
 * validating that string before it is sent to the backend.
 */

export interface KeyComboInput {
  key: string;
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

const MODIFIER_LABELS = ["Ctrl", "Alt", "Shift", "Win"] as const;

const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "ShiftLeft",
  "ShiftRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
]);

const CODE_LABELS: Record<string, string> = {
  Space: "Space",
  Escape: "Esc",
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
};

export function isModifierCode(code: string): boolean {
  return MODIFIER_CODES.has(code);
}

function keyLabelFromCode(input: KeyComboInput): string {
  const { code, key } = input;

  if (code in CODE_LABELS) return CODE_LABELS[code];

  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1];

  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1];

  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;

  if (key.length === 1) return key.toUpperCase();

  return code || key;
}

/**
 * Builds the display string for a keydown event, or null while the pressed
 * key is only a modifier (Ctrl/Alt/Shift/Win on their own) so the caller
 * keeps waiting for the actual key.
 */
export function formatKeyCombo(input: KeyComboInput): string | null {
  if (isModifierCode(input.code)) return null;

  const parts: string[] = [];
  if (input.ctrlKey) parts.push("Ctrl");
  if (input.altKey) parts.push("Alt");
  if (input.shiftKey) parts.push("Shift");
  if (input.metaKey) parts.push("Win");
  parts.push(keyLabelFromCode(input));

  return parts.join("+");
}

export type HotkeyFieldKeyAction = "navigate" | "cancel" | "ignore" | "record";

/**
 * What a hotkey capture field does with a keydown before it records a
 * combination: Tab and Shift+Tab keep moving focus through the form, Esc
 * cancels the capture, and a bare Backspace or Delete (an attempt to clear
 * the field, which a hotkey cannot be) is ignored instead of becoming the
 * new hotkey.
 */
export function hotkeyFieldKeyAction(input: KeyComboInput): HotkeyFieldKeyAction {
  const main = input.code || input.key;
  const commandModifier = input.ctrlKey || input.altKey || input.metaKey;
  if (main === "Tab" && !commandModifier) return "navigate";
  if (main === "Escape") return "cancel";
  if ((main === "Backspace" || main === "Delete") && !commandModifier) return "ignore";
  return "record";
}

/**
 * Returns a Russian error message when the combo is unusable, or undefined
 * when it is fine to send to the backend. The backend still has the final
 * word (set_hotkey can reject a combo the OS or another app already owns).
 */
export function validateHotkeyCombo(combo: string, allowSingleKey = false): string | undefined {
  if (!combo) return t("Комбинация клавиш не задана");

  const parts = combo.split("+");
  const mainKey = parts[parts.length - 1];
  const modifierParts = parts.slice(0, -1);

  if (parts.length === 1 && allowSingleKey) {
    if ((MODIFIER_LABELS as readonly string[]).includes(mainKey)) {
      return t("Нужна клавиша, а не модификатор");
    }
    return undefined;
  }

  const hasModifier = modifierParts.length > 0 && modifierParts.every((part) =>
    (MODIFIER_LABELS as readonly string[]).includes(part),
  );

  if (!hasModifier) return t("Нужен хотя бы один модификатор: Ctrl, Alt, Shift или Win");
  if ((MODIFIER_LABELS as readonly string[]).includes(mainKey)) {
    return t("Нужна ещё одна клавиша, помимо модификатора");
  }

  return undefined;
}
