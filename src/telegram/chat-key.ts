import type { ChatRef } from "./types";

interface IdLike {
  toString(): string;
}

export interface MessagePeerLike {
  className?: string;
  userId?: IdLike;
  chatId?: IdLike;
  channelId?: IdLike;
}

export interface TopicReplyRef {
  replyToTopId?: number | null;
  replyToMsgId?: number | null;
}

export function chatKey(chat: ChatRef | null): string | null {
  return chat ? `${chat.kind}:${chat.id}:${chat.topicId ?? 0}` : null;
}

export function hasChatChanged(previous: ChatRef | null, next: ChatRef | null): boolean {
  return chatKey(previous) !== chatKey(next);
}

export function isCurrentGeneration(captured: number, current: number): boolean {
  return captured === current;
}

export function messageBelongsToChat(chat: ChatRef | null, peer: MessagePeerLike | undefined): boolean {
  if (!chat || !peer) return false;

  const peerKind = peer.className === "PeerUser" || peer.userId
    ? "user"
    : peer.className === "PeerChat" || peer.chatId
      ? "chat"
      : peer.className === "PeerChannel" || peer.channelId
        ? "channel"
        : null;
  if (peerKind !== chat.kind) return false;

  const peerId = peerKind === "user"
    ? peer.userId
    : peerKind === "chat"
      ? peer.chatId
      : peer.channelId;
  if (!peerId) return false;

  return normalizePeerId(chat.kind, chat.id) === normalizePeerId(peerKind, peerId.toString());
}

function normalizePeerId(kind: ChatRef["kind"], id: string): string {
  if (kind === "channel") return id.replace(/^-100/, "").replace(/^-/, "");
  if (kind === "chat") return id.replace(/^-/, "");
  return id;
}

export function messageBelongsToTopic(
  topicId: number | null | undefined,
  replyTo: TopicReplyRef | undefined,
  messageId?: number,
): boolean {
  if (topicId == null) return true;
  if (messageId === topicId) return true;
  return (replyTo?.replyToTopId ?? replyTo?.replyToMsgId) === topicId;
}
