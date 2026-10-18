import { describe, expect, test } from "vitest";
import {
  MAX_MEDIA_BYTES,
  buildDataUrl,
  detectMedia,
  detectMediaKind,
  exceedsMediaCap,
  fallbackMediaText,
} from "./media";

describe("detectMediaKind", () => {
  test("a photo message is kind photo", () => {
    expect(detectMediaKind({ photo: {} })).toBe("photo");
  });

  test("a static webp sticker document is kind webp", () => {
    expect(detectMediaKind({ document: { mimeType: "image/webp" } })).toBe("webp");
  });

  test("an animated .tgs sticker document is kind tgs", () => {
    expect(detectMediaKind({ document: { mimeType: "application/x-tgsticker" } })).toBe("tgs");
  });

  test("a video sticker (webm) document is kind webm", () => {
    expect(detectMediaKind({ document: { mimeType: "video/webm" } })).toBe("webm");
  });

  test("an mp4 GIF-like document is kind gif", () => {
    expect(detectMediaKind({ document: { mimeType: "video/mp4" } })).toBe("gif");
  });

  test("a real image/gif document is kind gif", () => {
    expect(detectMediaKind({ document: { mimeType: "image/gif" } })).toBe("gif");
  });

  test("an unsupported document mime type is null", () => {
    expect(detectMediaKind({ document: { mimeType: "application/pdf" } })).toBeNull();
  });

  test("a plain text message (no media) is null", () => {
    expect(detectMediaKind({})).toBeNull();
  });
});

describe("exceedsMediaCap", () => {
  test("accepts exactly eight mebibytes", () => {
    expect(exceedsMediaCap(8 * 1024 * 1024)).toBe(false);
    expect(exceedsMediaCap(8 * 1024 * 1024 + 1)).toBe(true);
  });

  test("is false right at the cap", () => {
    expect(exceedsMediaCap(MAX_MEDIA_BYTES)).toBe(false);
  });

  test("is true one byte over the cap", () => {
    expect(exceedsMediaCap(MAX_MEDIA_BYTES + 1)).toBe(true);
  });

  test("is false for small media", () => {
    expect(exceedsMediaCap(1024)).toBe(false);
  });
});

test("keeps the source MIME for a GIF", () => {
  expect(detectMedia({ document: { mimeType: "image/gif" } })).toEqual({
    kind: "gif",
    mimeType: "image/gif",
  });
});

describe("fallbackMediaText", () => {
  test("photo does not add a transport label", () => {
    expect(fallbackMediaText("photo")).toBe("");
  });

  test("stickers (webp/tgs/webm) fall back to [стикер]", () => {
    expect(fallbackMediaText("webp")).toBe("[стикер]");
    expect(fallbackMediaText("tgs")).toBe("[стикер]");
    expect(fallbackMediaText("webm")).toBe("[стикер]");
  });

  test("gif does not add a transport label", () => {
    expect(fallbackMediaText("gif")).toBe("");
  });
});

describe("buildDataUrl", () => {
  test("encodes bytes as a base64 data URL with the given mime type", () => {
    const bytes = new Uint8Array([0x68, 0x69]); // "hi"
    expect(buildDataUrl(bytes, "image/webp")).toBe("data:image/webp;base64,aGk=");
  });
});
