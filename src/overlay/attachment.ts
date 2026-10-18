import { MAX_MEDIA_BYTES } from "../core/media-limits";

const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export interface AttachmentMeta {
  mimeType: string;
  byteLength: number;
}

export function validateAttachment(meta: AttachmentMeta): string | null {
  if (!ALLOWED_MIME_TYPES.has(meta.mimeType)) return "Неподдерживаемый формат. Выберите PNG, JPEG, WebP или GIF";
  if (meta.byteLength > MAX_MEDIA_BYTES) return "Файл больше 8 МиБ";
  return null;
}
