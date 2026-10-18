import { t } from "../i18n";
export function formatStickerAnimationSeconds(seconds: number): string {
  return seconds === 0 ? t("Без анимации") : t("{n} с", { n: Math.round(seconds) });
}
