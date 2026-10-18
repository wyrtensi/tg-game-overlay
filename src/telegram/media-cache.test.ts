import { describe, expect, test } from "vitest";
import { PushedMediaCache } from "./media-cache";

const media = (dataUrl: string) => ({ kind: "photo" as const, mimeType: "image/jpeg", dataUrl });

describe("PushedMediaCache", () => {
  test("returns media only for the same file", () => {
    const cache = new PushedMediaCache(1000);
    cache.set("1", "photo:7", media("data:a"));
    expect(cache.get("1", "photo:7")).toEqual(media("data:a"));
    expect(cache.get("1", "photo:8")).toBeUndefined();
    expect(cache.get("2", "photo:7")).toBeUndefined();
  });

  test("drops the oldest entries past the byte budget", () => {
    const cache = new PushedMediaCache(20);
    cache.set("1", "f", media("data:0123456789"));
    cache.set("2", "f", media("data:0123456789"));
    expect(cache.get("1", "f")).toBeUndefined();
    expect(cache.get("2", "f")).toBeDefined();
    cache.set("3", "f", media("data:" + "x".repeat(40)));
    expect(cache.get("3", "f")).toBeUndefined();
    expect(cache.get("2", "f")).toBeDefined();
  });
});
