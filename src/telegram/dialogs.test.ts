import { describe, expect, test } from "vitest";
import { mapDialogToChatRef, toChatRefs, type DialogLike } from "./dialogs";

function dialog(overrides: Partial<DialogLike>): DialogLike {
  return {
    id: { toString: () => "1" },
    title: "Untitled",
    isUser: false,
    isGroup: false,
    isChannel: false,
    entity: undefined,
    ...overrides,
  };
}

describe("mapDialogToChatRef", () => {
  test("maps a user dialog to kind user", () => {
    const d = dialog({
      id: { toString: () => "111" },
      title: "Alice",
      isUser: true,
      entity: { accessHash: { toString: () => "222" } },
    });

    expect(mapDialogToChatRef(d)).toEqual({
      kind: "user",
      id: "111",
      accessHash: "222",
      title: "Alice",
    });
  });

  test("keeps a public username for chat selection", () => {
    const d = dialog({
      id: { toString: () => "111" },
      title: "Alice",
      isUser: true,
      entity: { accessHash: { toString: () => "222" }, username: "alice" } as DialogLike["entity"],
    });

    expect(mapDialogToChatRef(d)).toEqual({
      kind: "user",
      id: "111",
      accessHash: "222",
      title: "Alice",
      username: "alice",
    });
  });

  test("maps a basic group dialog to kind chat, no accessHash", () => {
    const d = dialog({ id: { toString: () => "333" }, title: "Group", isGroup: true });

    expect(mapDialogToChatRef(d)).toEqual({
      kind: "chat",
      id: "333",
      accessHash: undefined,
      title: "Group",
    });
  });

  test("maps a channel/supergroup dialog to kind channel", () => {
    const d = dialog({
      id: { toString: () => "444" },
      title: "Channel",
      isChannel: true,
      isGroup: true, // GramJS sets both for megagroups
      entity: { accessHash: { toString: () => "555" } },
    });

    expect(mapDialogToChatRef(d)?.kind).toBe("channel");
  });

  test("falls back to an empty title when the dialog has none", () => {
    const d = dialog({ title: undefined });

    expect(mapDialogToChatRef(d)?.title).toBe("");
  });

  test("returns null when the dialog has no id", () => {
    const d = dialog({ id: undefined });

    expect(mapDialogToChatRef(d)).toBeNull();
  });
});

describe("toChatRefs", () => {
  const dialogs: DialogLike[] = Array.from({ length: 150 }, (_, i) =>
    dialog({ id: { toString: () => String(i) }, title: `Chat ${i}`, isUser: true }),
  );

  test("caps the result at 200 entries", () => {
    expect(toChatRefs(dialogs, null)).toHaveLength(150);
  });

  test("filters by a case-insensitive title substring", () => {
    const small = [
      dialog({ id: { toString: () => "1" }, title: "Rocket League", isUser: true }),
      dialog({ id: { toString: () => "2" }, title: "Work chat", isGroup: true }),
    ];

    const result = toChatRefs(small, "rocket");

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Rocket League");
  });

  test("an empty query keeps every dialog (up to the cap)", () => {
    const small = [dialog({ id: { toString: () => "1" }, title: "A", isUser: true })];

    expect(toChatRefs(small, "")).toHaveLength(1);
  });

  test("filters by an ID and public username", () => {
    const publicDialog = dialog({
      id: { toString: () => "90042" },
      title: "Игровые новости",
      isChannel: true,
      entity: { username: "game_news" } as DialogLike["entity"],
    });

    expect(toChatRefs([publicDialog], "042")).toHaveLength(1);
    expect(toChatRefs([publicDialog], "@GAME_NEWS")).toHaveLength(1);
  });
});
