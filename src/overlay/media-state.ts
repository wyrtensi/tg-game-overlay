import type { MediaKind } from "./media";

export function mediaFailureLabel(kind: MediaKind): string {
  if (kind === "photo") return "Фото не удалось показать";
  if (kind === "gif") return "GIF не удалось показать";
  return "Стикер не удалось показать";
}
