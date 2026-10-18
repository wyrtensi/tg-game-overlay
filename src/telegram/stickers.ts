import { mimeToMediaKind } from "./media";
import type { StickerEntry, StickerKind, StickerPack } from "./types";

/** Duck-typed subset of a GramJS `Api.Document` we need to build a StickerEntry. */
export interface StickerDocumentLike {
  id: { toString(): string };
  mimeType?: string | null;
  /** DocumentAttributeSticker.alt - the emoji tied to this sticker, if any. */
  alt?: string | null;
}

/** Narrows a document's mime type to the StickerPack.stickers[].kind union. */
export function stickerKindFromMime(mimeType: string | null | undefined): StickerKind | null {
  const kind = mimeToMediaKind(mimeType);
  return kind === "webp" || kind === "tgs" || kind === "webm" ? kind : null;
}

/** Describes the safest preview payload to request from Telegram for a sticker. */
export function stickerPreviewRequest(
  mimeType: string | null | undefined,
  hasRasterThumbnail: boolean,
): { mimeType: "image/jpeg" | "image/webp" | "application/x-tgsticker" | "video/webm"; thumbnail: boolean } | null {
  if (hasRasterThumbnail) return { mimeType: "image/jpeg", thumbnail: true };
  switch (stickerKindFromMime(mimeType)) {
    case "webp":
      return { mimeType: "image/webp", thumbnail: false };
    case "tgs":
      return { mimeType: "application/x-tgsticker", thumbnail: false };
    case "webm":
      return { mimeType: "video/webm", thumbnail: false };
    default:
      return null;
  }
}

export interface StickerWithPreview {
  document: StickerDocumentLike;
  /** Small preview data URL, already downloaded - see client.ts. */
  dataUrl?: string;
}

/** Maps downloaded (document, preview) pairs into the StickerPack shape from CONTRACT.md. */
export function buildStickerPack(id: string, title: string, entries: StickerWithPreview[]): StickerPack {
  const stickers: StickerEntry[] = [];

  for (const { document, dataUrl } of entries) {
    const kind = stickerKindFromMime(document.mimeType);
    if (!kind) continue;

    stickers.push({
      fileId: document.id.toString(),
      emoji: document.alt || undefined,
      kind,
      ...(dataUrl ? { dataUrl } : {}),
    });
  }

  return { id, title, stickers };
}

/**
 * Telegram's messages.RecentStickers gives parallel `stickers`/`dates`
 * arrays; this orders the documents newest-used first. Missing or
 * mismatched dates just sort to the back rather than throwing.
 */
export function orderRecentStickers<T extends StickerDocumentLike>(
  documents: T[],
  dates: number[],
): T[] {
  return documents
    .map((document, index) => ({ document, date: dates[index] ?? -Infinity }))
    .sort((a, b) => b.date - a.date)
    .map((entry) => entry.document);
}
