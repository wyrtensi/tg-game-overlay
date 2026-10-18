import { describe, expect, test } from "vitest";
import { canSendSticker, mergePreview, pickerStatus } from "./sticker-load";

describe("sticker loading state", () => {
  test("does not enable a cached preview whose Telegram document is unresolved", () => {
    expect(canSendSticker({ previewCached: true, documentReady: false })).toBe(false);
  });

  test("describes metadata as available while previews continue loading", () => {
    expect(pickerStatus({ phase: "metadata", packCount: 2 })).toContain("2");
  });

  test("merges a hydrated preview into the matching sticker only", () => {
    const packs = [{ id: "cats", title: "Cats", stickers: [
      { fileId: "1", kind: "webp" as const, documentReady: true },
      { fileId: "2", kind: "webp" as const, documentReady: true },
    ] }];

    expect(mergePreview(packs, "2", "data:image/webp;base64,AA==")[0].stickers).toEqual([
      { fileId: "1", kind: "webp", documentReady: true },
      { fileId: "2", kind: "webp", documentReady: true, dataUrl: "data:image/webp;base64,AA==" },
    ]);
  });
});
