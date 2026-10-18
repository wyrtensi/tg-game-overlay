import { Buffer } from "buffer";
import { describe, expect, test } from "vitest";
import { decodeDataUrl, extensionForMimeType } from "./dataurl";
import { MAX_MEDIA_BYTES } from "../core/media-limits";

describe("decodeDataUrl", () => {
  test("decodes mime type and base64 payload", () => {
    // "hi" base64-encoded, matching buildDataUrl's own test in media.test.ts
    const result = decodeDataUrl("data:image/webp;base64,aGk=");

    expect(result.mimeType).toBe("image/webp");
    expect(Array.from(result.bytes)).toEqual([0x68, 0x69]);
  });

  test("round-trips through buildDataUrl", () => {
    const bytes = new Uint8Array([1, 2, 3, 255, 0]);
    const url = `data:application/octet-stream;base64,${Buffer.from(bytes).toString("base64")}`;

    const result = decodeDataUrl(url);

    expect(result.mimeType).toBe("application/octet-stream");
    expect(Array.from(result.bytes)).toEqual(Array.from(bytes));
  });

  test("throws a readable error on a non data: URL", () => {
    expect(() => decodeDataUrl("https://example.com/a.png")).toThrow(/data:/);
  });

  test("throws a readable error when the payload is not base64", () => {
    expect(() => decodeDataUrl("data:image/png,not-base64")).toThrow();
  });
});

test("decoded payload length exposes files above the shared media limit", () => {
  const payload = Buffer.alloc(MAX_MEDIA_BYTES + 1).toString("base64");

  expect(decodeDataUrl(`data:image/png;base64,${payload}`).bytes.byteLength).toBe(MAX_MEDIA_BYTES + 1);
});

describe("extensionForMimeType", () => {
  test("maps common pasted-image mime types", () => {
    expect(extensionForMimeType("image/png")).toBe("png");
    expect(extensionForMimeType("image/jpeg")).toBe("jpg");
    expect(extensionForMimeType("image/webp")).toBe("webp");
    expect(extensionForMimeType("image/gif")).toBe("gif");
  });

  test("falls back to a generic extension for an unknown mime type", () => {
    expect(extensionForMimeType("application/x-made-up")).toBe("bin");
  });
});
