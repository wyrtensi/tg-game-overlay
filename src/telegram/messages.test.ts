import { describe, expect, test } from "vitest";
import { HISTORY_LIMIT, mapMessageToOverlay, resolveAuthorName } from "./messages";

describe("resolveAuthorName", () => {
  test("uses first + last name for a user", () => {
    expect(resolveAuthorName({ firstName: "Ada", lastName: "Lovelace" })).toBe("Ada Lovelace");
  });

  test("uses first name alone when there is no last name", () => {
    expect(resolveAuthorName({ firstName: "Ada" })).toBe("Ada");
  });

  test("uses the chat/channel title when there is one", () => {
    expect(resolveAuthorName({ title: "Announcements" })).toBe("Announcements");
  });

  test("falls back to @username when there is no name", () => {
    expect(resolveAuthorName({ username: "ada" })).toBe("@ada");
  });

  test("falls back to the given default when the sender is unknown", () => {
    expect(resolveAuthorName(undefined, "Неизвестный")).toBe("Неизвестный");
  });
});

describe("mapMessageToOverlay", () => {
  test("maps a plain incoming text message", () => {
    const overlay = mapMessageToOverlay(
      { id: 42, message: "hello", date: 1_700_000_000, out: false },
      "Ada",
    );

    expect(overlay).toEqual({
      id: "42",
      author: "Ada",
      text: "hello",
      at: 1_700_000_000_000,
      outgoing: undefined,
    });
  });

  test("marks an outgoing message", () => {
    const overlay = mapMessageToOverlay({ id: 1, message: "hi", date: 0, out: true }, "Me");

    expect(overlay.outgoing).toBe(true);
  });

  test("empty message text (media-only) becomes an empty string, not null", () => {
    const overlay = mapMessageToOverlay({ id: 1, message: null, date: 0, out: false }, "Ada");

    expect(overlay.text).toBe("");
  });
});

test("HISTORY_LIMIT matches the ~20 messages CONTRACT.md asks for on connect", () => {
  expect(HISTORY_LIMIT).toBe(20);
});
