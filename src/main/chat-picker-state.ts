export type DialogLoadState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready" }
  | { state: "error"; error: string };

export function chatPickerMessage(loadState: DialogLoadState, count: number, query = ""): string | null {
  if (loadState.state === "loading") return "Загружаем чаты из Telegram…";
  if (loadState.state === "error") return `Не удалось загрузить чаты: ${loadState.error}`;
  if (count > 0) return null;
  return query.trim() ? "Ничего не найдено" : "Telegram не вернул доступных чатов";
}
