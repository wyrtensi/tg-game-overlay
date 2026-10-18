import { describe, expect, test } from "vitest";
import { Api } from "telegram";
import { buildInputPeer } from "./peer";
import type { ChatRef } from "./types";

// The entity-cache trap (CONTRACT.md / task step 7): a StringSession does not
// persist entities, so getEntity(id) fails after a restart. We must build the
// InputPeer ourselves from the stored ChatRef instead of relying on GramJS's
// entity cache.

describe("buildInputPeer", () => {
  test("builds InputPeerUser from a user ChatRef", () => {
    const chat: ChatRef = { kind: "user", id: "12345", accessHash: "6789", title: "Alice" };

    const peer = buildInputPeer(chat);

    expect(peer).toBeInstanceOf(Api.InputPeerUser);
    const user = peer as Api.InputPeerUser;
    expect(user.userId.toString()).toBe("12345");
    expect(user.accessHash.toString()).toBe("6789");
  });

  test("builds InputPeerChat from a basic group ChatRef (no accessHash needed)", () => {
    const chat: ChatRef = { kind: "chat", id: "555", title: "Group" };

    const peer = buildInputPeer(chat);

    expect(peer).toBeInstanceOf(Api.InputPeerChat);
    expect((peer as Api.InputPeerChat).chatId.toString()).toBe("555");
  });

  test("builds InputPeerChannel from a channel/supergroup ChatRef", () => {
    const chat: ChatRef = { kind: "channel", id: "999", accessHash: "111", title: "Channel" };

    const peer = buildInputPeer(chat);

    expect(peer).toBeInstanceOf(Api.InputPeerChannel);
    const channel = peer as Api.InputPeerChannel;
    expect(channel.channelId.toString()).toBe("999");
    expect(channel.accessHash.toString()).toBe("111");
  });

  test("throws a readable error when a user ChatRef has no accessHash", () => {
    const chat: ChatRef = { kind: "user", id: "1", title: "No hash" };

    expect(() => buildInputPeer(chat)).toThrow(/accessHash/);
  });

  test("throws a readable error when a channel ChatRef has no accessHash", () => {
    const chat: ChatRef = { kind: "channel", id: "1", title: "No hash" };

    expect(() => buildInputPeer(chat)).toThrow(/accessHash/);
  });
});
