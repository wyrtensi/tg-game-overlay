import { Buffer } from "buffer";

const DATA_URL_RE = /^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/s;

export interface DecodedDataUrl {
  mimeType: string;
  bytes: Uint8Array;
}

/** Decodes a `data:` URL (as pasted images arrive from the overlay) into raw bytes. */
export function decodeDataUrl(dataUrl: string): DecodedDataUrl {
  const match = DATA_URL_RE.exec(dataUrl);
  if (!match) {
    throw new Error("Not a data: URL");
  }
  const [, mimeType = "application/octet-stream", isBase64, payload] = match;
  if (!isBase64) {
    throw new Error("Only base64-encoded data: URLs are supported");
  }

  const bytes = Buffer.from(payload, "base64");
  if (bytes.length === 0 && payload.length > 0) {
    throw new Error("Could not decode the data: URL payload as base64");
  }

  return { mimeType, bytes: new Uint8Array(bytes) };
}

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** A filename extension for a pasted image's mime type, so Telegram can tell it's a photo. */
export function extensionForMimeType(mimeType: string): string {
  return EXTENSION_BY_MIME[mimeType] ?? "bin";
}
