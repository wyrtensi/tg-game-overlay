import type { StickerPack } from "./stickers";

export type StickerPickerState =
  | { status: "idle" | "loading" }
  | { status: "ready"; packs: StickerPack[]; phase?: "metadata" | "previews" | "complete" }
  | { status: "error"; message: string };

export function pickerEmptyMessage(state: StickerPickerState): string | null {
  if (state.status === "loading") return "Загрузка стикеров…";
  if (state.status === "error") return state.message;
  if (state.status === "ready" && state.packs.length === 0) return "Стикеров пока нет";
  return null;
}

export function pickerProgressMessage(state: StickerPickerState): string | null {
  if (state.status !== "ready") return null;
  if (state.phase === "metadata") return `Найдено наборов: ${state.packs.length}`;
  if (state.phase === "previews") return "Загружаем превью стикеров…";
  return null;
}
