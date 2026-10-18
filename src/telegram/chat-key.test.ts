import { describe, expect, test } from "vitest";
import { chatKey, hasChatChanged, isCurrentGeneration, messageBelongsToTopic } from "./chat-key";

describe("chatKey", () => {
  test("distinguishes forum topics in the same channel", () => {
    const topic2 = { kind: "channel" as const, id: "9", title: "Raid", topicId: 2 };
    const topic3 = { kind: "channel" as const, id: "9", title: "Raid", topicId: 3 };

    expect(chatKey(topic2)).not.toBe(chatKey(topic3));
    expect(hasChatChanged(topic2, topic3)).toBe(true);
  });

  test("ignores presentation-only chat fields", () => {
    expect(chatKey({ kind: "user", id: "7", title: "Old title" })).toBe(
      chatKey({ kind: "user", id: "7", title: "New title", username: "new_name" }),
    );
  });

  test("represents an unselected chat as null", () => {
    expect(chatKey(null)).toBeNull();
  });
});

describe("chat generation", () => {
  test("accepts work only from the active generation", () => {
    expect(isCurrentGeneration(4, 4)).toBe(true);
    expect(isCurrentGeneration(3, 4)).toBe(false);
  });
});

describe("messageBelongsToTopic", () => {
  test("keeps only messages rooted in the selected forum topic", () => {
    expect(messageBelongsToTopic(12, { replyToTopId: 12 })).toBe(true);
    expect(messageBelongsToTopic(12, { replyToTopId: 11 })).toBe(false);
  });

  test("treats the topic root itself as part of the topic", () => {
    expect(messageBelongsToTopic(12, undefined, 12)).toBe(true);
  });

  test("accepts all messages when no topic is selected", () => {
    expect(messageBelongsToTopic(undefined, { replyToTopId: 99 }, 4)).toBe(true);
  });

  test("accepts ordinary chat messages when Rust serializes the absent topic as null", () => {
    expect(messageBelongsToTopic(null as never, undefined, 4)).toBe(true);
  });
});
