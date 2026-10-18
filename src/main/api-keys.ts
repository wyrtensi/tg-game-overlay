import { t } from "../i18n";
/** Validation for the optional "own Telegram API keys" escape hatch. */

export function parseApiId(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function validateApiId(value: string): string | undefined {
  const parsed = parseApiId(value);
  if (parsed === null || parsed <= 0) return t("api_id должен быть числом");
  return undefined;
}

export function validateApiHash(value: string): string | undefined {
  if (value.trim().length === 0) return t("api_hash не может быть пустым");
  return undefined;
}
