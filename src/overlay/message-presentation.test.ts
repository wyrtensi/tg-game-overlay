import { describe, expect, test } from "vitest";
import { messageClassNames, messageContent, messageTime, messageTimestamp, shouldRenderAuthor } from "./message-presentation";

describe("messageClassNames", () => {
  test("aligns outgoing messages only in dialogue layout", () => {
    expect(messageClassNames(true, "dialogue")).toEqual(["msg", "msg--outgoing", "msg--dialogue"]);
    expect(messageClassNames(true, "compact")).toEqual(["msg", "msg--outgoing"]);
  });

  test("keeps incoming messages on the dialogue's left side", () => {
    expect(messageClassNames(false, "dialogue")).toEqual(["msg", "msg--dialogue"]);
  });
});

test("removes instead of hiding the author element", () => {
  expect(shouldRenderAuthor(false)).toBe(false);
});

test("does not create an author part when names are disabled", () => {
  expect(messageContent("Hi", false)).toEqual({ showAuthor: false, showText: true });
});

test("suppresses the sticker transport placeholder once sticker media exists", () => {
  expect(messageContent("[стикер]", true, true)).toEqual({ showAuthor: true, showText: false });
});

describe("messageTime", () => {
  const formatter = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" });

  test("formats a normal time", () => {
    expect(messageTime(Date.UTC(2026, 0, 1, 9, 5), formatter)).toEqual({ dateTime: "2026-01-01T09:05:00.000Z", label: "09:05" });
  });

  test("does not throw for a time no Date can hold", () => {
    expect(messageTime(1e300, formatter)).toBeNull();
    expect(messageTime(Number.NaN, formatter)).toBeNull();
  });
});

test("replaces an unusable arrival time with now", () => {
  expect(messageTimestamp(1e300, 5)).toBe(5);
  expect(messageTimestamp(Number.POSITIVE_INFINITY, 5)).toBe(5);
  expect(messageTimestamp(1000, 5)).toBe(1000);
});
