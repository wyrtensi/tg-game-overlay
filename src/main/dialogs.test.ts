import { describe, expect, test } from "vitest";
import { describeChatKind, filterDialogs, isChatEqual } from "./dialogs";
import type { ChatRef } from "./types";

const dialogs: ChatRef[] = [
  { kind: "user", id: "1", title: "Алекс" },
  { kind: "chat", id: "2", title: "Dota 2 сквад" },
  { kind: "channel", id: "3", title: "Игровые новости" },
];

describe("describeChatKind", () => {
  test("user", () => {
    expect(describeChatKind("user")).toBe("человек");
  });

  test("chat", () => {
    expect(describeChatKind("chat")).toBe("группа");
  });

  test("channel", () => {
    expect(describeChatKind("channel")).toBe("канал");
  });
});

describe("filterDialogs", () => {
  test("returns everything for an empty query", () => {
    expect(filterDialogs(dialogs, "")).toEqual(dialogs);
  });

  test("matches a title substring case-insensitively", () => {
    expect(filterDialogs(dialogs, "dota")).toEqual([dialogs[1]]);
  });

  test("matches regardless of query case", () => {
    expect(filterDialogs(dialogs, "АЛЕКС")).toEqual([dialogs[0]]);
  });

  test("matches a chat ID", () => {
    expect(filterDialogs(dialogs, "2")).toEqual([dialogs[1]]);
  });

  test("matches a username with or without an at sign", () => {
    const publicDialog = {
      kind: "channel",
      id: "42",
      title: "Новости игры",
      username: "game_news",
    } as ChatRef;

    expect(filterDialogs([publicDialog], "@GAME_NEWS")).toEqual([publicDialog]);
    expect(filterDialogs([publicDialog], "game_news")).toEqual([publicDialog]);
  });

  test("returns an empty array when nothing matches", () => {
    expect(filterDialogs(dialogs, "zzz")).toEqual([]);
  });

  test("ignores leading and trailing whitespace in the query", () => {
    expect(filterDialogs(dialogs, "  новости  ")).toEqual([dialogs[2]]);
  });
});

describe("isChatEqual", () => {
  test("true for two nulls", () => {
    expect(isChatEqual(null, null)).toBe(true);
  });

  test("true for undefined and null", () => {
    expect(isChatEqual(undefined, null)).toBe(true);
  });

  test("false when one side is missing", () => {
    expect(isChatEqual(dialogs[0], null)).toBe(false);
  });

  test("true for the same kind and id", () => {
    expect(isChatEqual(dialogs[0], { ...dialogs[0] })).toBe(true);
  });

  test("treats a saved null topic and an absent picker topic as the same chat", () => {
    const saved: ChatRef = { kind: "user", id: "7", title: "Bot", topicId: null };
    const picker: ChatRef = { kind: "user", id: "7", title: "Bot" };

    expect(isChatEqual(saved, picker)).toBe(true);
  });

  test("false for a different id", () => {
    expect(isChatEqual(dialogs[0], dialogs[1])).toBe(false);
  });

  test("false when only the topicId differs", () => {
    const a: ChatRef = { kind: "chat", id: "5", title: "Group" };
    const b: ChatRef = { kind: "chat", id: "5", title: "Group", topicId: 2 };

    expect(isChatEqual(a, b)).toBe(false);
  });
});
