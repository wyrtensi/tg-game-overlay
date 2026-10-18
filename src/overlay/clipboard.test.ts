import { describe, expect, test } from "vitest";
import { findImageClipboardItem } from "./clipboard";

describe("findImageClipboardItem", () => {
  test("finds the index of an image item", () => {
    expect(findImageClipboardItem([{ type: "text/plain" }, { type: "image/png" }])).toBe(1);
  });

  test("returns null when there is no image item", () => {
    expect(findImageClipboardItem([{ type: "text/plain" }, { type: "text/html" }])).toBeNull();
  });

  test("returns null for an empty clipboard", () => {
    expect(findImageClipboardItem([])).toBeNull();
  });

  test("picks the first image when several are present", () => {
    expect(findImageClipboardItem([{ type: "image/gif" }, { type: "image/png" }])).toBe(0);
  });
});
