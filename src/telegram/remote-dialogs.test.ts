import { describe, expect, test } from "vitest";
import { mergeChatRefs, remoteChatRefs } from "./remote-dialogs";

const id = (value: string) => ({ toString: () => value });

describe("remoteChatRefs", () => {
  test("maps a Telegram search result into selectable users and channels", () => {
    const chats = remoteChatRefs({
      className: "contacts.Found",
      results: [{ className: "PeerUser", userId: id("10") }, { className: "PeerChannel", channelId: id("20") }],
      users: [{ className: "User", id: id("10"), accessHash: id("77"), firstName: "Ada", lastName: "Lovelace", username: "ada", bot: true }],
      chats: [{ className: "Channel", id: id("20"), accessHash: id("99"), title: "Game team", username: "game_team" }],
    });

    expect(chats).toEqual([
      { kind: "user", id: "10", accessHash: "77", title: "Ada Lovelace", username: "ada", isBot: true },
      { kind: "channel", id: "20", accessHash: "99", title: "Game team", username: "game_team" },
    ]);
  });

  test("keeps the local access hash when search returns the same bot without one", () => {
    const chats = mergeChatRefs(
      [{ kind: "user", id: "10", title: "Molli Store", isBot: true }],
      [{ kind: "user", id: "10", accessHash: "77", title: "Molli Store", isBot: true }],
    );

    expect(chats).toEqual([
      { kind: "user", id: "10", accessHash: "77", title: "Molli Store", isBot: true },
    ]);
  });
});
