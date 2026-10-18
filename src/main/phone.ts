/** Normalizes and validates the phone number typed into the Telegram login form. */

const MIN_DIGITS = 7;

export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.length > 0 ? `+${digits}` : "";
}

export function validatePhone(normalized: string): string | undefined {
  if (!normalized) return "Введите номер телефона";
  const digitCount = normalized.replace(/\D/g, "").length;
  if (digitCount < MIN_DIGITS) {
    return "Номер должен быть в международном формате, например +79261234567";
  }
  return undefined;
}
