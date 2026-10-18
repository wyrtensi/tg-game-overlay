export function formatStickerAnimationSeconds(seconds: number): string {
  return seconds === 0 ? "Без анимации" : `${Math.round(seconds)} с`;
}
