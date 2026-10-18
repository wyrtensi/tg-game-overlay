import type { ChatRef } from "./types";

interface IdLike {
  toString(): string;
}

interface PeerLike {
  className?: string;
  userId?: IdLike;
  chatId?: IdLike;
  channelId?: IdLike;
}

interface EntityLike {
  className?: string;
  id?: IdLike;
  accessHash?: IdLike;
  title?: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  bot?: boolean;
}

export interface SearchResultLike {
  className?: string;
  results?: PeerLike[];
  users?: EntityLike[];
  chats?: EntityLike[];
}

/** Converts Telegram's contacts.Search result into the chat references used by the picker. */
export function remoteChatRefs(result: SearchResultLike): ChatRef[] {
  if (result.className !== "contacts.Found") return [];
  const users = new Map((result.users ?? []).flatMap((entity) => entity.id ? [[entity.id.toString(), entity] as const] : []));
  const chats = new Map((result.chats ?? []).flatMap((entity) => entity.id ? [[entity.id.toString(), entity] as const] : []));

  return (result.results ?? []).flatMap((peer): ChatRef[] => {
    if (peer.className === "PeerUser" && peer.userId) {
      const user = users.get(peer.userId.toString());
      if (!user) return [];
      const title = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || peer.userId.toString();
      return [{ kind: "user", id: peer.userId.toString(), accessHash: user.accessHash?.toString(), title, username: user.username || undefined, ...(user.bot === true ? { isBot: true } : {}) }];
    }
    if (peer.className === "PeerChat" && peer.chatId) {
      const chat = chats.get(peer.chatId.toString());
      if (!chat) return [];
      return [{ kind: "chat", id: peer.chatId.toString(), accessHash: undefined, title: chat.title || peer.chatId.toString(), username: undefined }];
    }
    if (peer.className === "PeerChannel" && peer.channelId) {
      const chat = chats.get(peer.channelId.toString());
      if (!chat) return [];
      return [{
        kind: "channel",
        id: peer.channelId.toString(),
        accessHash: chat.accessHash?.toString(),
        title: chat.title || peer.channelId.toString(),
        username: chat.username || undefined,
      }];
    }
    return [];
  });
}

/** Keeps remote results first without duplicating dialogs already loaded locally. */
export function mergeChatRefs(remote: ChatRef[], local: ChatRef[]): ChatRef[] {
  const localByKey = new Map(local.map((chat) => [`${chat.kind}:${chat.id}`, chat]));
  const seen = new Set<string>();
  return [...remote, ...local].flatMap((chat) => {
    const key = `${chat.kind}:${chat.id}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const saved = localByKey.get(key);
    return [{
      ...chat,
      ...(!chat.accessHash && saved?.accessHash ? { accessHash: saved.accessHash } : {}),
      ...(!chat.username && saved?.username ? { username: saved.username } : {}),
      ...(saved?.isBot === true ? { isBot: true } : {}),
    }];
  });
}
