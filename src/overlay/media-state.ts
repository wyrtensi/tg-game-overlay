import type { MediaKind } from "./media";
import { t } from "../i18n";

export function mediaFailureLabel(kind: MediaKind): string {
  if (kind === "photo") return t("Фото не удалось показать");
  if (kind === "gif") return t("GIF не удалось показать");
  return t("Стикер не удалось показать");
}
