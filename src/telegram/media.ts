import { Buffer } from "buffer";
import { MAX_MEDIA_BYTES, MAX_TGS_BYTES } from "../core/media-limits";
import type { MediaKind } from "./types";

/** A single downloaded item over this is sent as text-only, per CONTRACT.md step 5. */
export { MAX_MEDIA_BYTES, MAX_TGS_BYTES };

export function exceedsMediaCap(byteLength: number): boolean {
  return byteLength > MAX_MEDIA_BYTES;
}

/** Duck-typed subset of a GramJS Message we need to classify its media. */
export interface MediaLikeMessage {
  photo?: unknown;
  document?: {
    mimeType?: string | null;
    /** GramJS hands a big-integer here; Number() reads it. */
    size?: unknown;
    attributes?: readonly { className?: string }[] | null;
  } | null;
}

export interface MediaDescriptor {
  kind: MediaKind;
  mimeType: string;
}

function descriptorForMimeType(mimeType: string | null | undefined): MediaDescriptor | null {
  switch (mimeType) {
    case "image/webp":
      return { kind: "webp", mimeType };
    case "application/x-tgsticker":
      return { kind: "tgs", mimeType };
    case "video/webm":
      return { kind: "webm", mimeType };
    case "video/mp4":
    case "image/gif":
      return { kind: "gif", mimeType };
    default:
      return null;
  }
}

export function mimeToMediaKind(mimeType: string | null | undefined): MediaKind | null {
  return descriptorForMimeType(mimeType)?.kind ?? null;
}

/** Classifies a message attachment and preserves its original MIME type. */
export function detectMedia(message: MediaLikeMessage): MediaDescriptor | null {
  if (message.photo) return { kind: "photo", mimeType: "image/jpeg" };
  if (!message.document) return null;
  const descriptor = descriptorForMimeType(message.document.mimeType);
  // The MIME type alone is chosen by the sender: a plain file labelled as TGS
  // is just a file, never something the overlay inflates.
  if (descriptor?.kind === "tgs" && !hasStickerAttribute(message.document)) return null;
  return descriptor;
}

function hasStickerAttribute(document: NonNullable<MediaLikeMessage["document"]>): boolean {
  return (document.attributes ?? []).some((attr) => attr.className === "DocumentAttributeSticker");
}

/**
 * Whether a media item may be downloaded at all, decided from the size
 * Telegram reports before any byte is fetched. A TGS sticker must report a
 * size within Telegram's own 64 KiB limit; everything else the general cap.
 */
export function mediaDownloadAllowed(kind: MediaKind, knownSize: number | undefined): boolean {
  if (kind === "tgs") return knownSize !== undefined && Number.isFinite(knownSize) && knownSize <= MAX_TGS_BYTES;
  return knownSize === undefined || !exceedsMediaCap(knownSize);
}

/** The same limits applied to the bytes actually downloaded. */
export function downloadedMediaAllowed(kind: MediaKind, byteLength: number): boolean {
  return kind === "tgs" ? byteLength <= MAX_TGS_BYTES : !exceedsMediaCap(byteLength);
}

/** Backward-compatible kind-only classifier for picker and focused unit tests. */
export function detectMediaKind(message: MediaLikeMessage): MediaKind | null {
  return detectMedia(message)?.kind ?? null;
}

const FALLBACK_TEXT: Record<MediaKind, string> = {
  photo: "",
  webp: "[стикер]",
  tgs: "[стикер]",
  webm: "[стикер]",
  gif: "",
};

/** The placeholder text used when a media item is skipped (too slow/too big). */
export function fallbackMediaText(kind: MediaKind): string {
  return FALLBACK_TEXT[kind];
}

/** Base64-encodes downloaded bytes into a `data:` URL for OverlayMessage.media. */
export function buildDataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}
