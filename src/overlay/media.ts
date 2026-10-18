export type MediaKind = "photo" | "webp" | "tgs" | "webm" | "gif";

/** Which DOM primitive renders a given media kind and original MIME type. */
export function mediaElementKind(kind: MediaKind, mimeType: string): "img" | "video" | "lottie" {
  if (kind === "tgs") return "lottie";
  if (mimeType.startsWith("image/")) return "img";
  return "video";
}

export interface MediaBoxSize {
  width: number;
  height: number;
}

export function photoPreviewMaxSize(mode: "active" | "inactive", fontScale: number): number {
  return (mode === "active" ? 96 : 360) * fontScale;
}

/**
 * A photo line's box in each mode. A line outlives mode switches (the feed
 * is never rebuilt), so both sizes are set up front and CSS picks one.
 */
export function photoBoxes(
  width: number | undefined,
  height: number | undefined,
  fontScale: number,
): Record<"active" | "inactive", MediaBoxSize> {
  return {
    active: fitMediaBox(width, height, photoPreviewMaxSize("active", fontScale)),
    inactive: fitMediaBox(width, height, photoPreviewMaxSize("inactive", fontScale)),
  };
}

/**
 * The box a piece of media should reserve, in pixels, before it has
 * actually loaded - so the layout never shifts once it does. Scales down to
 * fit within `maxSizePx` on both axes, preserving aspect ratio, but never
 * upscales past the media's own size. Falls back to a square placeholder
 * when the dimensions are not known yet (or only partially known).
 */
export function fitMediaBox(
  width: number | undefined,
  height: number | undefined,
  maxSizePx: number,
): MediaBoxSize {
  if (!width || !height) {
    return { width: maxSizePx, height: maxSizePx };
  }

  const scale = Math.min(1, maxSizePx / width, maxSizePx / height);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}
