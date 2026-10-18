import { describe, expect, test } from "vitest";
import { isValidHexColor, normalizeHexColor, validateHexColor } from "./color";

describe("isValidHexColor", () => {
  test("accepts a lower case #rrggbb value", () => {
    expect(isValidHexColor("#f2f2f2")).toBe(true);
  });

  test("accepts an upper case #rrggbb value", () => {
    expect(isValidHexColor("#7FB2FF")).toBe(true);
  });

  test("rejects a value missing the leading #", () => {
    expect(isValidHexColor("f2f2f2")).toBe(false);
  });

  test("rejects the 3-digit shorthand", () => {
    expect(isValidHexColor("#fff")).toBe(false);
  });

  test("rejects a non-hex character", () => {
    expect(isValidHexColor("#gggggg")).toBe(false);
  });

  test("rejects an empty string", () => {
    expect(isValidHexColor("")).toBe(false);
  });
});

describe("normalizeHexColor", () => {
  test("lower-cases a valid value", () => {
    expect(normalizeHexColor("#7FB2FF")).toBe("#7fb2ff");
  });

  test("returns null for an invalid value", () => {
    expect(normalizeHexColor("blue")).toBeNull();
  });
});

describe("validateHexColor", () => {
  test("accepts a valid value", () => {
    expect(validateHexColor("#f2f2f2")).toBeUndefined();
  });

  test("rejects an invalid value with a Russian message", () => {
    expect(validateHexColor("f2f2f2")).toBe("Цвет должен быть в формате #rrggbb");
  });
});
