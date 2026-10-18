import { t } from "../i18n";
export type DialogLoadState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready" }
  | { state: "error"; error: string };

export function chatPickerMessage(loadState: DialogLoadState, count: number, query = ""): string | null {
  if (loadState.state === "loading") return t("Загружаем чаты из Telegram…");
  if (loadState.state === "error") return t("Не удалось загрузить чаты: {error}", { error: t(loadState.error) });
  if (count > 0) return null;
  return query.trim() ? t("Ничего не найдено") : t("Telegram не вернул доступных чатов");
}
