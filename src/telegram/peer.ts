import bigInt from "big-integer";
import { Api } from "telegram";
import type { ChatRef } from "./types";

/**
 * Builds an InputPeer straight from a stored ChatRef instead of calling
 * client.getEntity(id).
 *
 * The entity-cache trap: GramJS keeps an in-memory (and, with a file/store
 * session, on-disk) entity cache that maps bare ids to access hashes. A
 * StringSession does not persist that cache, so after an app restart
 * getEntity(id) throws "Could not find the input entity for ...". We never
 * rely on it here - the ChatRef we saved from getDialogs already carries the
 * accessHash we need, so the InputPeer is constructed directly.
 */
export function buildInputPeer(chat: ChatRef): Api.TypeInputPeer {
  const id = inputPeerId(chat);
  switch (chat.kind) {
    case "chat":
      return new Api.InputPeerChat({ chatId: bigInt(id) });
    case "user":
      return new Api.InputPeerUser({
        userId: bigInt(id),
        accessHash: bigInt(requireAccessHash(chat)),
      });
    case "channel":
      return new Api.InputPeerChannel({
        channelId: bigInt(id),
        accessHash: bigInt(requireAccessHash(chat)),
      });
    default:
      throw new Error(`Unknown chat kind: ${String((chat as ChatRef).kind)}`);
  }
}

function inputPeerId(chat: ChatRef): string {
  if (chat.kind === "channel") return chat.id.replace(/^-100/, "").replace(/^-/, "");
  if (chat.kind === "chat") return chat.id.replace(/^-/, "");
  return chat.id;
}

function requireAccessHash(chat: ChatRef): string {
  if (!chat.accessHash) {
    throw new Error(
      `ChatRef for "${chat.title}" (${chat.kind} ${chat.id}) has no accessHash - cannot build an InputPeer`,
    );
  }
  return chat.accessHash;
}
