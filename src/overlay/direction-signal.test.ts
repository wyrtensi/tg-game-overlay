import { describe, expect, test } from "vitest";
import { DirectionSignalStore, MAX_DIRECTION_SIGNALS } from "./direction-signal";

describe("DirectionSignalStore", () => {
  test("replaces a signal when Telegram edits the same message", () => {
    const store = new DirectionSignalStore();
    store.upsert({ messageId: "42", direction: "up", at: 100, author: "Ada" });
    store.upsert({ messageId: "42", direction: "left", at: 200, author: "Ada" });

    expect(store.current()).toMatchObject({ messageId: "42", direction: "left", at: 200 });
    expect(store.entries()).toHaveLength(1);
  });

  test("keeps an edited direction when a delayed original delivery arrives afterwards", () => {
    const store = new DirectionSignalStore();
    store.upsert({ messageId: "42", direction: "up", at: 100, author: "Ada" });
    store.upsert({ messageId: "42", direction: "right", at: 200, author: "Ada" });

    store.upsert({ messageId: "42", direction: "up", at: 100, author: "Ada" });

    expect(store.current()).toMatchObject({ messageId: "42", direction: "right", at: 200 });
  });

  test("reconciles a local pending signal with its confirmed Telegram message", () => {
    const store = new DirectionSignalStore();
    store.pending("req-1", "right", 300);
    store.confirm("req-1", "99");

    expect(store.entries()).toHaveLength(1);
    expect(store.current()).toMatchObject({ requestId: "req-1", messageId: "99", direction: "right" });
  });

  test("keeps the locally confirmed direction over an older mirrored value", () => {
    const store = new DirectionSignalStore();
    store.upsert({ messageId: "99", direction: "up", at: 100, author: "Ada" });
    store.pending("req-1", "left", 200);

    store.confirm("req-1", "99");

    expect(store.current()).toMatchObject({ messageId: "99", direction: "left", at: 200 });
  });

  test("keeps a pending direction separate until its own request confirms", () => {
    const store = new DirectionSignalStore();
    store.pending("req-1", "up", 100);
    store.pending("req-2", "down", 200);
    store.confirm("req-1", "42");

    expect(store.entries()).toHaveLength(2);
    expect(store.current()).toMatchObject({ requestId: "req-2", direction: "down" });
  });

  test("clears cached visual signals when the mirrored chat changes", () => {
    const store = new DirectionSignalStore();
    store.pending("req-1", "up", 100);

    store.clear();

    expect(store.entries()).toEqual([]);
    expect(store.current()).toBeNull();
  });

  test("stays bounded however many message ids arrive, keeping the newest", () => {
    const store = new DirectionSignalStore();
    for (let index = 0; index < 1000; index += 1) {
      store.upsert({ messageId: `spam-${index}`, direction: "up", at: index });
    }

    expect(store.entries()).toHaveLength(MAX_DIRECTION_SIGNALS);
    expect(store.current()).toMatchObject({ messageId: "spam-999" });
  });
});
