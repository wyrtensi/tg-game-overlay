import type { DirectionSettings } from "./types";
import { t } from "../i18n";

export const DEFAULT_DIRECTION_SETTINGS: DirectionSettings = {
  enabled: false,
  upKey: "ArrowUp",
  downKey: "ArrowDown",
  leftKey: "ArrowLeft",
  rightKey: "ArrowRight",
  displayMs: 2500,
};

export function normalizeDirectionSettings(settings: DirectionSettings): DirectionSettings {
  return {
    ...settings,
    upKey: settings.upKey.trim(),
    downKey: settings.downKey.trim(),
    leftKey: settings.leftKey.trim(),
    rightKey: settings.rightKey.trim(),
    displayMs: Math.max(500, Math.min(10_000, Math.round(settings.displayMs))),
  };
}

export function validateDirectionSettings(settings: DirectionSettings): string | null {
  const keys = [settings.upKey, settings.downKey, settings.leftKey, settings.rightKey].map((key) => key.toLowerCase());
  if (keys.some((key) => key.length === 0)) return t("Назначьте клавишу для каждого направления");
  if (new Set(keys).size !== keys.length) return t("Клавиша направления повторяется");
  return null;
}
