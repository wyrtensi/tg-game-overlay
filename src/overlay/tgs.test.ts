import { gzip } from "pako";
import { describe, expect, test } from "vitest";
import { inflateTgs, inflateTgsDataUrl, MAX_TGS_JSON_BYTES, TgsTooLargeError } from "./tgs";

describe("inflateTgs", () => {
  test("inflates a gzipped Lottie animation", () => {
    const animation = { v: "5.5.2", fr: 60, layers: [] };
    expect(inflateTgs(gzip(JSON.stringify(animation)))).toEqual(animation);
  });

  test("reads the animation out of a data URL", () => {
    const base64 = btoa(String.fromCharCode(...gzip('{"fr":30}')));
    expect(inflateTgsDataUrl(`data:application/x-tgsticker;base64,${base64}`)).toEqual({ fr: 30 });
  });

  test("gives up on a gzip bomb once the output passes the cap", () => {
    // ~8 KiB of gzip that would inflate to 8 MiB of zeros.
    const bomb = gzip(new Uint8Array(8 * 1024 * 1024));
    expect(bomb.length).toBeLessThan(64 * 1024);
    expect(() => inflateTgs(bomb)).toThrow(TgsTooLargeError);
    expect(() => inflateTgs(gzip(new Uint8Array(1025)), 1024)).toThrow(TgsTooLargeError);
  });

  test("accepts output right at the cap", () => {
    const json = `"${"a".repeat(1022)}"`;
    expect(inflateTgs(gzip(json), 1024)).toBe("a".repeat(1022));
    expect(MAX_TGS_JSON_BYTES).toBe(4 * 1024 * 1024);
  });

  test("rejects data that is not gzip", () => {
    expect(() => inflateTgs(new Uint8Array([1, 2, 3, 4]))).toThrow();
  });
});
