export interface StickerRef {
  fileId: string;
  emoji?: string;
  kind: "webp" | "tgs" | "webm";
  dataUrl?: string;
  documentReady?: boolean;
}

export interface StickerPack {
  id: string;
  title: string;
  stickers: StickerRef[];
}

const RECENT_PACK_ID = "recent";
const RECENT_PACK_TITLE = "Недавние";

/** Moves `fileId` to the front of the recent list, deduped and capped at `max`. */
export function pushRecent(current: string[], fileId: string, max: number): string[] {
  return [fileId, ...current.filter((id) => id !== fileId)].slice(0, max);
}

/**
 * Prepends a synthetic "Recent" pack built from `recentFileIds`, in that
 * order, using the sticker data already present in `packs`. Ids that no
 * longer resolve to a real sticker are skipped; if none resolve, no recent
 * pack is added at all.
 */
export function withRecentPack(packs: StickerPack[], recentFileIds: string[]): StickerPack[] {
  const byFileId = new Map<string, StickerRef>();
  for (const pack of packs) {
    for (const sticker of pack.stickers) byFileId.set(sticker.fileId, sticker);
  }

  const recentStickers = recentFileIds
    .map((id) => byFileId.get(id))
    .filter((sticker): sticker is StickerRef => sticker !== undefined);

  const telegramRecent = packs.find((pack) => pack.id === RECENT_PACK_ID);
  if (telegramRecent) {
    const stickers = uniqueStickers([...recentStickers, ...telegramRecent.stickers]);
    return packs.map((pack) => (pack.id === RECENT_PACK_ID ? { ...pack, stickers } : pack));
  }

  if (recentStickers.length === 0) return packs;

  return [{ id: RECENT_PACK_ID, title: RECENT_PACK_TITLE, stickers: recentStickers }, ...packs];
}

/** Filters packs by pack title or sticker emoji without changing their order. */
export function filterStickers(packs: StickerPack[], query: string): StickerPack[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return packs;

  return packs.flatMap((pack) => {
    const stickers = pack.title.toLowerCase().includes(needle)
      ? pack.stickers
      : pack.stickers.filter((sticker) => sticker.emoji?.toLowerCase().includes(needle));
    return stickers.length > 0 ? [{ ...pack, stickers }] : [];
  });
}

export interface StickerPreview {
  fileId: string;
  dataUrl: string;
}

/** A tg:stickers payload (CONTRACT.md). */
export interface StickerUpdate {
  packs?: StickerPack[];
  previews?: StickerPreview[];
}

/**
 * The packs after a tg:stickers payload: `packs` replaces them, `previews`
 * alone fills in preview data URLs of the packs already held (the relay
 * worker streams each preview once that way instead of the whole index).
 */
export function applyStickerUpdate(current: StickerPack[], update: StickerUpdate): StickerPack[] {
  if (update.packs) return update.packs;
  if (!update.previews || update.previews.length === 0) return current;
  const previews = new Map(update.previews.map((preview) => [preview.fileId, preview.dataUrl]));
  return current.map((pack) => ({
    ...pack,
    stickers: pack.stickers.map((sticker) => {
      const dataUrl = previews.get(sticker.fileId);
      return dataUrl === undefined ? sticker : { ...sticker, dataUrl };
    }),
  }));
}

/**
 * How the picker grid follows a new sticker list: rebuilt when the stickers
 * or their order differ (another pack or search), otherwise only the
 * stickers whose preview changed are replaced in place, so the rest keep
 * playing and the panel keeps its scroll position.
 */
export function planStickerGrid(
  current: readonly { fileId: string; dataUrl?: string }[],
  next: readonly { fileId: string; dataUrl?: string }[],
): { rebuild: true } | { rebuild: false; changed: string[] } {
  if (current.length !== next.length || current.some((sticker, index) => sticker.fileId !== next[index].fileId)) {
    return { rebuild: true };
  }
  return {
    rebuild: false,
    changed: next.filter((sticker, index) => sticker.dataUrl !== current[index].dataUrl).map((sticker) => sticker.fileId),
  };
}

function uniqueStickers(stickers: StickerRef[]): StickerRef[] {
  const seen = new Set<string>();
  return stickers.filter((sticker) => {
    if (seen.has(sticker.fileId)) return false;
    seen.add(sticker.fileId);
    return true;
  });
}
