export type StickerRequestFailure = "disconnected" | "failed";

export function stickerRequestResult(reason: StickerRequestFailure): { packs: []; error: string } {
  return {
    packs: [],
    error: reason === "disconnected" ? "Подключите Telegram и повторите" : "Не удалось загрузить стикеры",
  };
}
