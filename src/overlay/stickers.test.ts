import { describe, expect, test } from "vitest";
import { applyStickerUpdate, filterStickers, planStickerGrid, pushRecent, withRecentPack } from "./stickers";

describe("pushRecent", () => {
  test("adds a fresh sticker to the front", () => {
    expect(pushRecent([], "a", 5)).toEqual(["a"]);
    expect(pushRecent(["a"], "b", 5)).toEqual(["b", "a"]);
  });

  test("moves an already-used sticker to the front instead of duplicating it", () => {
    expect(pushRecent(["a", "b", "c"], "b", 5)).toEqual(["b", "a", "c"]);
  });

  test("caps the list at the given size", () => {
    expect(pushRecent(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"]);
  });
});

describe("withRecentPack", () => {
  const packs = [
    {
      id: "pack1",
      title: "Pack One",
      stickers: [
        { fileId: "s1", kind: "webp" as const, dataUrl: "data:1" },
        { fileId: "s2", kind: "webp" as const, dataUrl: "data:2" },
      ],
    },
    {
      id: "pack2",
      title: "Pack Two",
      stickers: [{ fileId: "s3", kind: "tgs" as const, dataUrl: "data:3" }],
    },
  ];

  test("adds no recent pack when nothing has been used yet", () => {
    expect(withRecentPack(packs, [])).toEqual(packs);
  });

  test("prepends a recent pack built from the most-recently-used stickers, in order", () => {
    const result = withRecentPack(packs, ["s3", "s1"]);

    expect(result[0].id).toBe("recent");
    expect(result[0].stickers.map((s) => s.fileId)).toEqual(["s3", "s1"]);
    expect(result.slice(1)).toEqual(packs);
  });

  test("drops a recent id that no longer exists in any pack", () => {
    const result = withRecentPack(packs, ["gone", "s2"]);

    expect(result[0].stickers.map((s) => s.fileId)).toEqual(["s2"]);
  });

  test("omits the recent pack entirely if none of the recent ids still exist", () => {
    expect(withRecentPack(packs, ["gone"])).toEqual(packs);
  });

  test("merges local and Telegram recents without duplicating the Telegram collection", () => {
    const telegramPacks = [
      {
        id: "recent",
        title: "Недавние",
        stickers: [
          { fileId: "r1", kind: "webp" as const, dataUrl: "data:r1" },
          { fileId: "r2", kind: "webp" as const, dataUrl: "data:r2" },
        ],
      },
      { id: "favorites", title: "Избранные", stickers: [{ fileId: "f1", kind: "webp" as const, dataUrl: "data:f1" }] },
      { id: "pack1", title: "Pack One", stickers: [{ fileId: "local", kind: "webp" as const, dataUrl: "data:l" }] },
    ];

    const result = withRecentPack(telegramPacks, ["local", "r1"]);

    expect(result.map((pack) => pack.id)).toEqual(["recent", "favorites", "pack1"]);
    expect(result[0].stickers.map((sticker) => sticker.fileId)).toEqual(["local", "r1", "r2"]);
  });
});

describe("applyStickerUpdate", () => {
  const packs = [{ id: "p", title: "Pack", stickers: [
    { fileId: "a", kind: "webp" as const },
    { fileId: "b", kind: "webp" as const, dataUrl: "data:b" },
  ] }];

  test("replaces the packs when the payload carries them", () => {
    const next = [{ id: "q", title: "Other", stickers: [] }];
    expect(applyStickerUpdate(packs, { packs: next })).toBe(next);
  });

  test("merges streamed previews into the packs already held", () => {
    const merged = applyStickerUpdate(packs, { previews: [{ fileId: "a", dataUrl: "data:a" }, { fileId: "zzz", dataUrl: "data:z" }] });
    expect(merged[0].stickers.map((sticker) => sticker.dataUrl)).toEqual(["data:a", "data:b"]);
    expect(applyStickerUpdate(packs, { previews: [] })).toBe(packs);
  });
});

describe("planStickerGrid", () => {
  const grid = [{ fileId: "a" }, { fileId: "b", dataUrl: "data:b" }];

  test("replaces only stickers whose preview arrived", () => {
    expect(planStickerGrid(grid, [{ fileId: "a", dataUrl: "data:a" }, { fileId: "b", dataUrl: "data:b" }]))
      .toEqual({ rebuild: false, changed: ["a"] });
    expect(planStickerGrid(grid, grid)).toEqual({ rebuild: false, changed: [] });
  });

  test("rebuilds for another pack, a search or a new order", () => {
    expect(planStickerGrid(grid, [{ fileId: "b" }, { fileId: "a" }])).toEqual({ rebuild: true });
    expect(planStickerGrid(grid, [{ fileId: "a" }])).toEqual({ rebuild: true });
  });
});

describe("filterStickers", () => {
  const packs = [
    {
      id: "cats",
      title: "Cats",
      stickers: [
        { fileId: "cat", emoji: "🐱", kind: "webp" as const, dataUrl: "data:cat" },
        { fileId: "dog", emoji: "🐶", kind: "webp" as const, dataUrl: "data:dog" },
      ],
    },
  ];

  test("finds stickers by their emoji", () => {
    expect(filterStickers(packs, "🐱")[0].stickers.map((sticker) => sticker.fileId)).toEqual(["cat"]);
  });

  test("keeps a whole matching pack for a title search", () => {
    expect(filterStickers(packs, "CATS")[0].stickers.map((sticker) => sticker.fileId)).toEqual(["cat", "dog"]);
  });
});
