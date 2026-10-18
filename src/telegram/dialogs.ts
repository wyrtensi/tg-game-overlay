import type { ChatRef } from "./types";

const MAX_DIALOGS = 200;

/** Duck-typed subset of GramJS's `Dialog` (tl/custom/dialog.ts) we need. */
export interface DialogLike {
  id?: { toString(): string };
  title?: string;
  isUser: boolean;
  isGroup: boolean;
  isChannel: boolean;
  entity?: { accessHash?: { toString(): string }; username?: string; bot?: boolean };
}

/** Maps one GramJS Dialog to the ChatRef shape sent to the settings window. */
export function mapDialogToChatRef(dialog: DialogLike): ChatRef | null {
  if (!dialog.id) return null;

  return {
    kind: dialog.isChannel ? "channel" : dialog.isUser ? "user" : "chat",
    id: dialog.id.toString(),
    accessHash: dialog.entity?.accessHash?.toString(),
    title: dialog.title ?? "",
    username: dialog.entity?.username || undefined,
    ...(dialog.entity?.bot === true ? { isBot: true } : {}),
  };
}

/** Maps, filters by title, id or public username, and caps to the picker limit. */
export function toChatRefs(dialogs: DialogLike[], query: string | null): ChatRef[] {
  const needle = query?.trim().toLowerCase().replace(/^@/, "");
  const result: ChatRef[] = [];

  for (const dialog of dialogs) {
    const chat = mapDialogToChatRef(dialog);
    if (!chat) continue;
    if (
      needle &&
      !chat.title.toLowerCase().includes(needle) &&
      !chat.id.toLowerCase().includes(needle) &&
      !chat.username?.toLowerCase().includes(needle)
    ) {
      continue;
    }

    result.push(chat);
    if (result.length >= MAX_DIALOGS) break;
  }

  return result;
}
