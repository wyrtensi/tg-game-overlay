import type { StickerPack } from "./types";

export type StickerLoadPhase = "metadata" | "previews" | "complete";

export function canSendSticker(sticker: { previewCached: boolean; documentReady: boolean }): boolean {
  return sticker.documentReady;
}

export function pickerStatus(state: { phase: StickerLoadPhase; packCount: number }): string {
  if (state.phase === "metadata") return `Найдено наборов: ${state.packCount}`;
  if (state.phase === "previews") return "Загружаем превью стикеров…";
  return "Стикеры готовы";
}

export function mergePreview(packs: StickerPack[], fileId: string, dataUrl: string): StickerPack[] {
  return packs.map((pack) => ({
    ...pack,
    stickers: pack.stickers.map((sticker) =>
      sticker.fileId === fileId ? { ...sticker, dataUrl } : sticker,
    ),
  }));
}
