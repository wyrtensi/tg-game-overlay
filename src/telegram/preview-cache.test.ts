import { describe, expect, test } from "vitest";
import { cachedStickerPacks, evictionPlan, type CachedPreview } from "./preview-cache";

function entry(fileId: string, bytes: number, updatedAt: number, lastUsedAt = updatedAt): CachedPreview {
  return { fileId, dataUrl: `data:image/webp;base64,${fileId}`, bytes, updatedAt, lastUsedAt };
}

describe("evictionPlan", () => {
  test("expires previews older than seven days", () => {
    const now = 8 * 24 * 60 * 60 * 1000;

    expect(evictionPlan([entry("old", 10, 0), entry("fresh", 10, now)], { maxEntries: 10, maxBytes: 100 }, now))
      .toEqual(["old"]);
  });

  test("evicts least recently used entries until count and byte caps fit", () => {
    const entries = [entry("oldest", 8, 100, 100), entry("middle", 8, 200, 200), entry("newest", 8, 300, 300)];

    expect(evictionPlan(entries, { maxEntries: 2, maxBytes: 16 }, 300)).toEqual(["oldest"]);
  });
});

test("restores cached sticker previews as visible but not yet sendable", () => {
  expect(cachedStickerPacks([{ id: "cats", title: "Cats", stickers: [{ fileId: "1", kind: "webp", dataUrl: "data:image/webp;base64,AA==", documentReady: true }] }]))
    .toEqual([{ id: "cats", title: "Cats", stickers: [{ fileId: "1", kind: "webp", dataUrl: "data:image/webp;base64,AA==", documentReady: false }] }]);
});
