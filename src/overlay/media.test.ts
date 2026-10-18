import { describe, expect, test } from "vitest";
import { fitMediaBox, mediaElementKind, photoBoxes, photoPreviewMaxSize } from "./media";

describe("mediaElementKind", () => {
  test("photos and webp stickers render as an image", () => {
    expect(mediaElementKind("photo", "image/jpeg")).toBe("img");
    expect(mediaElementKind("webp", "image/webp")).toBe("img");
  });

  test("renders a GIF as an image", () => {
    expect(mediaElementKind("gif", "image/gif")).toBe("img");
  });

  test("webm and mp4 animation render as a video", () => {
    expect(mediaElementKind("webm", "video/webm")).toBe("video");
    expect(mediaElementKind("gif", "video/mp4")).toBe("video");
  });

  test("tgs renders through lottie", () => {
    expect(mediaElementKind("tgs", "application/x-tgsticker")).toBe("lottie");
  });
});

describe("fitMediaBox", () => {
  test("scales a landscape image down to fit the max box", () => {
    expect(fitMediaBox(200, 100, 128)).toEqual({ width: 128, height: 64 });
  });

  test("scales a portrait image down to fit the max box", () => {
    expect(fitMediaBox(100, 200, 128)).toEqual({ width: 64, height: 128 });
  });

  test("never upscales an image already smaller than the max box", () => {
    expect(fitMediaBox(50, 50, 128)).toEqual({ width: 50, height: 50 });
  });

  test("leaves an image that exactly fits untouched", () => {
    expect(fitMediaBox(128, 128, 128)).toEqual({ width: 128, height: 128 });
  });

  test("reserves a square placeholder when no dimensions are known yet", () => {
    expect(fitMediaBox(undefined, undefined, 128)).toEqual({ width: 128, height: 128 });
  });

  test("reserves the same square placeholder when only one dimension is missing", () => {
    expect(fitMediaBox(200, undefined, 128)).toEqual({ width: 128, height: 128 });
    expect(fitMediaBox(undefined, 200, 128)).toEqual({ width: 128, height: 128 });
  });
});

test("uses a compact photo preview in the active chat before opening the full view", () => {
  expect(photoPreviewMaxSize("active", 1)).toBeLessThan(photoPreviewMaxSize("inactive", 1));
  expect(photoPreviewMaxSize("active", 1)).toBe(96);
  expect(photoPreviewMaxSize("inactive", 1)).toBe(360);
});

test("gives a photo line both mode sizes up front", () => {
  expect(photoBoxes(1200, 600, 1)).toEqual({
    active: { width: 96, height: 48 },
    inactive: { width: 360, height: 180 },
  });
});
