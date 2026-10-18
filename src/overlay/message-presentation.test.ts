import { describe, expect, test } from "vitest";
import { messageClassNames, messageContent, shouldRenderAuthor } from "./message-presentation";

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
