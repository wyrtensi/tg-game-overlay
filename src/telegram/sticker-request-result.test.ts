import { expect, test } from "vitest";
import { stickerRequestResult } from "./sticker-request-result";

test("returns an actionable picker error when pack loading rejects", () => {
  expect(stickerRequestResult("failed")).toEqual({ packs: [], error: "Не удалось загрузить стикеры" });
});

test("asks the user to connect before loading stickers", () => {
  expect(stickerRequestResult("disconnected")).toEqual({ packs: [], error: "Подключите Telegram и повторите" });
});
