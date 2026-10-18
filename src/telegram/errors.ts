import { errors as tgErrors } from "telegram";
import type { TgStatus } from "./types";

/**
 * Maps a GramJS login error (thrown from client.start()'s phoneCode/password
 * callbacks, or the onError callback) to a `tg:status` payload with a
 * readable Russian message. See CONTRACT.md's `tg:status` shape.
 */
export function mapLoginError(err: unknown): TgStatus {
  if (err instanceof tgErrors.FloodWaitError) {
    return {
      state: "error",
      error: `Слишком много попыток. Подождите ${err.seconds} сек. и попробуйте снова.`,
      waitSeconds: err.seconds,
    };
  }

  const code = errorCode(err);
  switch (code) {
    case "PHONE_CODE_INVALID":
      return { state: "error", error: "Неверный код подтверждения." };
    case "PHONE_CODE_EXPIRED":
      return { state: "error", error: "Код подтверждения истёк, запросите новый." };
    case "PHONE_NUMBER_INVALID":
      return { state: "error", error: "Неверный номер телефона." };
    case "PASSWORD_HASH_INVALID":
      return { state: "error", error: "Неверный пароль." };
    default:
      return { state: "error", error: `Ошибка входа: ${code ?? describe(err)}` };
  }
}

function errorCode(err: unknown): string | undefined {
  if (err instanceof tgErrors.RPCError) return err.errorMessage;
  return undefined;
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
