import type { PhraseWheelSettings } from "./types";
import { t } from "../i18n";

export const DEFAULT_PHRASE_WHEEL_SETTINGS: PhraseWheelSettings = {
  enabled: false,
  hotkey: "Ctrl+Space",
  deadZonePx: 42,
  phrases: ["Вперёд", "Назад", "Нужна помощь", "Подожди"],
};

export function validatePhrase(phrase: string): string | null {
  if (phrase.trim().length === 0) return t("Фраза не должна быть пустой");
  if ([...phrase].length > 160) return t("Фраза должна содержать не больше 160 символов");
  return null;
}

export function normalizePhrases(phrases: string[]): string[] {
  return phrases.map((phrase) => phrase.trim()).filter((phrase) => phrase.length > 0);
}

export function normalizePhraseWheelSettings(settings: PhraseWheelSettings): PhraseWheelSettings {
  return {
    ...settings,
    hotkey: settings.hotkey.trim(),
    deadZonePx: Math.max(16, Math.min(160, Math.round(settings.deadZonePx))),
    phrases: normalizePhrases(settings.phrases),
  };
}
