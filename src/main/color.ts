import { t } from "../i18n";
/** Validation for the text/author colour pickers in the feed-appearance section. */

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function isValidHexColor(value: string): boolean {
  return HEX_COLOR_RE.test(value.trim());
}

/** Returns a lower-case #rrggbb, or null when the input is not a valid hex colour. */
export function normalizeHexColor(value: string): string | null {
  const trimmed = value.trim();
  return isValidHexColor(trimmed) ? trimmed.toLowerCase() : null;
}

export function validateHexColor(value: string): string | undefined {
  if (!isValidHexColor(value)) return t("Цвет должен быть в формате #rrggbb");
  return undefined;
}
