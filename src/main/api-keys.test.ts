import { describe, expect, test } from "vitest";
import { parseApiId, validateApiHash, validateApiId } from "./api-keys";

describe("parseApiId", () => {
  test("parses a plain integer string", () => {
    expect(parseApiId("123456")).toBe(123456);
  });

  test("returns null for non-numeric input", () => {
    expect(parseApiId("abc")).toBeNull();
  });

  test("returns null for a fractional number", () => {
    expect(parseApiId("123.5")).toBeNull();
  });

  test("returns null for empty input", () => {
    expect(parseApiId("")).toBeNull();
  });
});

describe("validateApiId", () => {
  test("accepts a positive integer string", () => {
    expect(validateApiId("123456")).toBeUndefined();
  });

  test("rejects non-numeric input", () => {
    expect(validateApiId("abc")).toBe("api_id должен быть числом");
  });

  test("rejects zero or a negative number", () => {
    expect(validateApiId("0")).toBe("api_id должен быть числом");
  });
});

describe("validateApiHash", () => {
  test("accepts a non-empty hash", () => {
    expect(validateApiHash("0123456789abcdef0123456789abcdef")).toBeUndefined();
  });

  test("rejects an empty hash", () => {
    expect(validateApiHash("")).toBe("api_hash не может быть пустым");
  });

  test("rejects a hash with whitespace only", () => {
    expect(validateApiHash("   ")).toBe("api_hash не может быть пустым");
  });
});
