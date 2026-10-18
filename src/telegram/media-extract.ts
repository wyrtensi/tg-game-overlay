import type { Api } from "telegram";
import type { MediaKind } from "./types";

/** Best-effort width/height for a media item, straight from the TL attributes - no network call. */
export function extractDimensions(
  message: { photo?: Api.TypePhoto | null; document?: Api.TypeDocument | null },
  kind: MediaKind,
): { width?: number; height?: number } {
  if (kind === "photo") {
    return dimensionsFromPhoto(message.photo);
  }
  return dimensionsFromDocument(message.document);
}

function dimensionsFromPhoto(photo: Api.TypePhoto | null | undefined): { width?: number; height?: number } {
  if (!photo || photo.className !== "Photo") return {};
  const sizes = photo.sizes ?? [];
  const largest = sizes
    .filter((size): size is Api.PhotoSize => size.className === "PhotoSize")
    .reduce<Api.PhotoSize | undefined>((current, size) => (
      !current || size.w * size.h > current.w * current.h ? size : current
    ), undefined);
  if (!largest) return {};
  return { width: largest.w, height: largest.h };
}

function dimensionsFromDocument(doc: Api.TypeDocument | null | undefined): { width?: number; height?: number } {
  if (!doc || doc.className !== "Document") return {};
  for (const attr of doc.attributes) {
    if (attr.className === "DocumentAttributeImageSize" || attr.className === "DocumentAttributeVideo") {
      return { width: attr.w, height: attr.h };
    }
  }
  return {};
}
