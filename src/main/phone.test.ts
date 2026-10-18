import { describe, expect, test } from "vitest";
import { normalizePhone, validatePhone } from "./phone";

describe("normalizePhone", () => {
  test("strips spaces, dashes and parens, keeping the leading +", () => {
    expect(normalizePhone("+1 (555) 123-4567")).toBe("+15551234567");
  });

  test("adds a leading + when the input has only digits", () => {
    expect(normalizePhone("79261234567")).toBe("+79261234567");
  });

  test("drops a + that is not in the leading position", () => {
    expect(normalizePhone("7926+1234567")).toBe("+79261234567");
  });

  test("returns an empty string for empty input", () => {
    expect(normalizePhone("")).toBe("");
  });

  test("returns an empty string when there are no digits", () => {
    expect(normalizePhone("abc")).toBe("");
  });
});

describe("validatePhone", () => {
  test("accepts a normalized international number", () => {
    expect(validatePhone("+79261234567")).toBeUndefined();
  });

  test("rejects an empty number", () => {
    expect(validatePhone("")).toBe("Введите номер телефона");
  });

  test("rejects a too-short number", () => {
    expect(validatePhone("+123")).toBe("Номер должен быть в международном формате, например +79261234567");
  });
});
