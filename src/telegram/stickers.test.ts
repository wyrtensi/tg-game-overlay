import { describe, expect, test } from "vitest";
import {
  buildStickerPack,
  orderRecentStickers,
  stickerKindFromMime,
  stickerPreviewRequest,
  type StickerDocumentLike,
} from "./stickers";

describe("stickerKindFromMime", () => {
  test("maps image/webp to webp", () => {
    expect(stickerKindFromMime("image/webp")).toBe("webp");
  });

  test("maps application/x-tgsticker to tgs", () => {
    expect(stickerKindFromMime("application/x-tgsticker")).toBe("tgs");
  });

  test("maps video/webm to webm", () => {
    expect(stickerKindFromMime("video/webm")).toBe("webm");
  });

  test("rejects a non-sticker mime type (e.g. a plain photo/gif)", () => {
    expect(stickerKindFromMime("video/mp4")).toBeNull();
    expect(stickerKindFromMime("image/jpeg")).toBeNull();
  });
});

function doc(overrides: Partial<StickerDocumentLike>): StickerDocumentLike {
  return {
    id: { toString: () => "1" },
    mimeType: "image/webp",
    alt: undefined,
    ...overrides,
  };
}

describe("buildStickerPack", () => {
  test("maps documents into a StickerPack, pairing each with its preview and emoji", () => {
    const pack = buildStickerPack("42", "Cats", [
      { document: doc({ id: { toString: () => "7" }, alt: "🐱" }), dataUrl: "data:image/webp;base64,AA==" },
    ]);

    expect(pack).toEqual({
      id: "42",
      title: "Cats",
      stickers: [{ fileId: "7", emoji: "🐱", kind: "webp", dataUrl: "data:image/webp;base64,AA==" }],
    });
  });

  test("drops entries whose document is not a supported sticker mime type", () => {
    const pack = buildStickerPack("1", "Mixed", [
      { document: doc({ mimeType: "application/pdf" }), dataUrl: "data:x;base64,AA==" },
    ]);

    expect(pack.stickers).toHaveLength(0);
  });

  test("omits emoji when the document has no alt text", () => {
    const pack = buildStickerPack("1", "No emoji", [
      { document: doc({ alt: "" }), dataUrl: "data:image/webp;base64,AA==" },
    ]);

    expect(pack.stickers[0].emoji).toBeUndefined();
  });

  test("keeps an animated sticker selectable when Telegram has no raster thumb", () => {
    const pack = buildStickerPack("1", "Cats", [
      { document: doc({ mimeType: "application/x-tgsticker", alt: "🐱" }) },
    ]);

    expect(pack.stickers).toEqual([{ fileId: "1", emoji: "🐱", kind: "tgs" }]);
  });
});

describe("stickerPreviewRequest", () => {
  test("uses Telegram's raster thumbnail when one is available", () => {
    expect(stickerPreviewRequest("application/x-tgsticker", true)).toEqual({
      mimeType: "image/jpeg",
      thumbnail: true,
    });
  });

  test("downloads an original static WebP when Telegram has no thumbnail", () => {
    expect(stickerPreviewRequest("image/webp", false)).toEqual({
      mimeType: "image/webp",
      thumbnail: false,
    });
  });

  test("downloads compact animated stickers when Telegram has no raster thumbnail", () => {
    expect(stickerPreviewRequest("video/webm", false)).toEqual({
      mimeType: "video/webm",
      thumbnail: false,
    });
    expect(stickerPreviewRequest("application/x-tgsticker", false)).toEqual({
      mimeType: "application/x-tgsticker",
      thumbnail: false,
    });
  });
});

describe("orderRecentStickers", () => {
  test("orders documents newest-used first, by the parallel dates array", () => {
    const a = doc({ id: { toString: () => "a" } });
    const b = doc({ id: { toString: () => "b" } });
    const c = doc({ id: { toString: () => "c" } });

    const ordered = orderRecentStickers([a, b, c], [100, 300, 200]);

    expect(ordered.map((d) => d.id.toString())).toEqual(["b", "c", "a"]);
  });

  test("is stable when dates are missing or arrays are mismatched in length", () => {
    const a = doc({ id: { toString: () => "a" } });
    const b = doc({ id: { toString: () => "b" } });

    expect(() => orderRecentStickers([a, b], [100])).not.toThrow();
  });
});
