import type { ChatKind, ChatRef } from "./types";
import { t } from "../i18n";

const KIND_LABELS: Record<ChatKind, string> = {
  user: "человек",
  chat: "группа",
  channel: "канал",
};

export function describeChatKind(kind: ChatKind, isBot = false): string {
  if (kind === "user" && isBot) return t("бот");
  return t(KIND_LABELS[kind]);
}

/** Filters the complete dialog cache in the settings window. */
export function filterDialogs(dialogs: ChatRef[], query: string): ChatRef[] {
  const needle = normalizeDialogQuery(query);
  if (!needle) return dialogs;
  return dialogs.filter((dialog) => matchesDialogQuery(dialog, needle));
}

function normalizeDialogQuery(query: string): string {
  return query.trim().toLowerCase().replace(/^@/, "");
}

function matchesDialogQuery(dialog: ChatRef, needle: string): boolean {
  return (
    dialog.title.toLowerCase().includes(needle) ||
    dialog.id.toLowerCase().includes(needle) ||
    dialog.username?.toLowerCase().includes(needle) === true
  );
}

export function isChatEqual(a: ChatRef | null | undefined, b: ChatRef | null | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.kind === b.kind && a.id === b.id && (a.topicId ?? null) === (b.topicId ?? null);
}
