import { beforeEach, describe, expect, test } from "vitest";
import { Feed } from "./feed";

const TTL = 10_000;

function textsOf(feed: Feed, mode: "inactive" | "active", now: number): string[] {
  return feed.visible(mode, now).map((message) => message.text);
}

describe("Feed", () => {
  let feed: Feed;

  beforeEach(() => {
    feed = new Feed({ ttlMs: TTL, historyLimit: 5 });
  });

  test("shows a message that just arrived", () => {
    feed.add({ id: "1", author: "Stas", text: "go mid", at: 1000 }, "inactive");

    expect(textsOf(feed, "inactive", 1500)).toEqual(["go mid"]);
  });

  test("lets a message fade out once its time to live is over", () => {
    feed.add({ id: "1", author: "Stas", text: "go mid", at: 1000 }, "inactive");

    expect(textsOf(feed, "inactive", 1000 + TTL + 1)).toEqual([]);
  });

  test("keeps expired messages on screen while the chat is active", () => {
    feed.add({ id: "1", author: "Stas", text: "go mid", at: 1000 }, "inactive");

    expect(textsOf(feed, "active", 1000 + TTL + 1)).toEqual(["go mid"]);
  });

  test("drops the expired message again after the chat goes back to inactive", () => {
    feed.add({ id: "1", author: "Stas", text: "go mid", at: 1000 }, "inactive");
    feed.add({ id: "2", author: "Stas", text: "now", at: 1000 + TTL }, "active");

    expect(textsOf(feed, "inactive", 1000 + TTL + 1)).toEqual(["now"]);
  });

  test("does not pop up messages that arrived while the game was minimized", () => {
    feed.add({ id: "1", author: "Stas", text: "while away", at: 1000 }, "hidden");

    expect(textsOf(feed, "inactive", 1100)).toEqual([]);
  });

  test("counts messages that arrived while the game was minimized as unread", () => {
    feed.add({ id: "1", author: "Stas", text: "while away", at: 1000 }, "hidden");
    feed.add({ id: "2", author: "Stas", text: "and another", at: 1100 }, "hidden");

    expect(feed.unreadCount()).toBe(2);
  });

  test("shows the missed messages once the user opens the chat", () => {
    feed.add({ id: "1", author: "Stas", text: "while away", at: 1000 }, "hidden");

    expect(textsOf(feed, "active", 1100)).toEqual(["while away"]);
  });

  test("clears the unread counter when the user opens the chat", () => {
    feed.add({ id: "1", author: "Stas", text: "while away", at: 1000 }, "hidden");
    feed.markRead();

    expect(feed.unreadCount()).toBe(0);
  });

  test("a message seen in the inactive feed is not unread", () => {
    feed.add({ id: "1", author: "Stas", text: "go mid", at: 1000 }, "inactive");

    expect(feed.unreadCount()).toBe(0);
  });

  test("keeps only the newest messages within the history limit", () => {
    for (let i = 1; i <= 7; i += 1) {
      feed.add({ id: String(i), author: "Stas", text: `m${i}`, at: 1000 + i }, "inactive");
    }

    expect(textsOf(feed, "active", 1100)).toEqual(["m3", "m4", "m5", "m6", "m7"]);
  });

  test("keeps messages in arrival order, oldest first", () => {
    feed.add({ id: "1", author: "Stas", text: "first", at: 1000 }, "inactive");
    feed.add({ id: "2", author: "Stas", text: "second", at: 1200 }, "inactive");

    expect(textsOf(feed, "inactive", 1300)).toEqual(["first", "second"]);
  });

  test("ignores a repeated delivery of the same message", () => {
    feed.add({ id: "1", author: "Stas", text: "go mid", at: 1000 }, "inactive");
    feed.add({ id: "1", author: "Stas", text: "go mid", at: 1000 }, "inactive");

    expect(textsOf(feed, "inactive", 1100)).toEqual(["go mid"]);
  });

  test("replaces the text of an edited message without duplicating it", () => {
    feed.add({ id: "1", author: "Stas", text: "go mid", at: 1000 }, "inactive");
    feed.add({ id: "1", author: "Stas", text: "go top", at: 1000 }, "inactive");

    expect(textsOf(feed, "inactive", 1100)).toEqual(["go top"]);
  });

  test("clears messages and unread state when the selected chat changes", () => {
    feed.add({ id: "1", author: "Stas", text: "old", at: 1000 }, "hidden");

    feed.clear();

    expect(feed.visible("active", 2000)).toEqual([]);
    expect(feed.unreadCount()).toBe(0);
  });

  test("keeps messages in time order when they arrive out of order", () => {
    feed.add({ id: "live", author: "Stas", text: "live", at: 3000 }, "active");
    feed.add({ id: "h1", author: "Stas", text: "history 1", at: 1000 }, "active");
    feed.add({ id: "h2", author: "Stas", text: "history 2", at: 2000 }, "active");
    feed.add({ id: "same", author: "Stas", text: "same second", at: 3000 }, "active");

    expect(textsOf(feed, "active", 3000)).toEqual(["history 1", "history 2", "live", "same second"]);
  });

  test("drops the oldest message, not the latest arrival, past the history limit", () => {
    for (let index = 1; index <= 5; index += 1) {
      feed.add({ id: String(index), author: "Stas", text: `m${index}`, at: index * 1000 + 1000 }, "active");
    }
    feed.add({ id: "old", author: "Stas", text: "backfilled", at: 500 }, "active");

    expect(textsOf(feed, "active", 7000)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
  });
});
