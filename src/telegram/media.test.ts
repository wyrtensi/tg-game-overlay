import { describe, expect, test } from "vitest";
import {
  MAX_MEDIA_BYTES,
  buildDataUrl,
  detectMedia,
  detectMediaKind,
  exceedsMediaCap,
  downloadedMediaAllowed,
  fallbackMediaText,
  mediaDownloadAllowed,
} from "./media";

describe("detectMediaKind", () => {
  test("a photo message is kind photo", () => {
    expect(detectMediaKind({ photo: {} })).toBe("photo");
  });

  test("a static webp sticker document is kind webp", () => {
    expect(detectMediaKind({ document: { mimeType: "image/webp" } })).toBe("webp");
  });

  test("an animated .tgs sticker document is kind tgs", () => {
    expect(detectMediaKind({
      document: { mimeType: "application/x-tgsticker", size: 20_000, attributes: [{ className: "DocumentAttributeSticker" }] },
    })).toBe("tgs");
  });

  test("a file that only claims the tgs MIME type is not a sticker", () => {
    expect(detectMediaKind({
      document: { mimeType: "application/x-tgsticker", size: 8 * 1024 * 1024, attributes: [{ className: "DocumentAttributeFilename" }] },
    })).toBeNull();
    expect(detectMediaKind({ document: { mimeType: "application/x-tgsticker" } })).toBeNull();
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

describe("mediaDownloadAllowed", () => {
  test("downloads a tgs sticker only within Telegram's 64 KiB limit", () => {
    expect(mediaDownloadAllowed("tgs", 64 * 1024)).toBe(true);
    expect(mediaDownloadAllowed("tgs", 64 * 1024 + 1)).toBe(false);
    expect(mediaDownloadAllowed("tgs", 8 * 1024 * 1024)).toBe(false);
    expect(mediaDownloadAllowed("tgs", undefined)).toBe(false);
  });

  test("keeps the general cap for other media", () => {
    expect(mediaDownloadAllowed("webp", 8 * 1024 * 1024)).toBe(true);
    expect(mediaDownloadAllowed("gif", 8 * 1024 * 1024 + 1)).toBe(false);
    expect(mediaDownloadAllowed("photo", undefined)).toBe(true);
  });

  test("checks the downloaded bytes against the same limits", () => {
    expect(downloadedMediaAllowed("tgs", 64 * 1024 + 1)).toBe(false);
    expect(downloadedMediaAllowed("webm", 64 * 1024 + 1)).toBe(true);
  });
});
