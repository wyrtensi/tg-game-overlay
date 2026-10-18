import { describe, expect, test } from "vitest";
import { messageChanged } from "./message-update";

const base = { id: "1", author: "Ada", text: "[стикер]", at: 1000 };
const sticker = { dataUrl: "data:image/webp;base64,AA==" };

describe("messageChanged", () => {
  test("ignores a re-push of what the line already shows", () => {
    expect(messageChanged(base, sticker, { ...base, media: { ...sticker } })).toBe(false);
    expect(messageChanged(base, sticker, { ...base })).toBe(false);
  });

  test("repaints for new media, new text or an edit", () => {
    expect(messageChanged(base, undefined, { ...base, media: sticker })).toBe(true);
    expect(messageChanged(base, sticker, { ...base, media: { dataUrl: "data:image/webp;base64,AB==" } })).toBe(true);
    expect(messageChanged(base, sticker, { ...base, text: "edited" })).toBe(true);
    expect(messageChanged(base, undefined, { ...base, outgoing: true })).toBe(true);
  });
});
