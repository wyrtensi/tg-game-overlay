import { describe, expect, test } from "vitest";
import { validateAttachment } from "./attachment";

describe("validateAttachment", () => {
  test("accepts an animated GIF within the media limit", () => {
    expect(validateAttachment({ mimeType: "image/gif", byteLength: 1024 })).toBeNull();
  });

  test("rejects a non-image attachment", () => {
    expect(validateAttachment({ mimeType: "application/pdf", byteLength: 100 })).toContain("формат");
  });

  test("rejects an image above eight mebibytes", () => {
    expect(validateAttachment({ mimeType: "image/png", byteLength: 8 * 1024 * 1024 + 1 })).toContain("8");
  });
});
