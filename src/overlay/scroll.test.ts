import { describe, expect, test } from "vitest";
import { isNearBottom } from "./scroll";

describe("isNearBottom", () => {
  test("is true when scrolled exactly to the bottom", () => {
    expect(isNearBottom(200, 100, 300)).toBe(true);
  });

  test("is true when the content does not overflow the container", () => {
    expect(isNearBottom(0, 300, 200)).toBe(true);
  });

  test("stays true within the threshold", () => {
    expect(isNearBottom(190, 100, 300, 12)).toBe(true);
  });

  test("is false once scrolled away from the bottom past the threshold", () => {
    expect(isNearBottom(100, 100, 300, 12)).toBe(false);
  });
});
