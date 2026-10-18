import type { StickerPack } from "./stickers";
import { t } from "../i18n";

export type StickerPickerState =
  | { status: "idle" | "loading" }
  | { status: "ready"; packs: StickerPack[]; phase?: "metadata" | "previews" | "complete" }
  | { status: "error"; message: string };

export function pickerEmptyMessage(state: StickerPickerState): string | null {
  if (state.status === "loading") return t("Загрузка стикеров…");
  if (state.status === "error") return state.message;
  if (state.status === "ready" && state.packs.length === 0) return t("Стикеров пока нет");
  return null;
}

export function pickerProgressMessage(state: StickerPickerState): string | null {
  if (state.status !== "ready") return null;
  if (state.phase === "metadata") return t("Найдено наборов: {count}", { count: state.packs.length });
  if (state.phase === "previews") return t("Загружаем превью стикеров…");
  return null;
}
