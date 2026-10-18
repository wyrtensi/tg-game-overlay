export type FeedMode = "inactive" | "active" | "hidden";

export interface ChatMessage {
  id: string;
  author: string;
  text: string;
  /** Arrival timestamp in milliseconds. */
  at: number;
  outgoing?: boolean;
}

interface StoredMessage extends ChatMessage {
  /** Messages that arrived while the game was minimized stay out of the passive feed. */
  missed: boolean;
  read: boolean;
}

export interface FeedOptions {
  ttlMs: number;
  historyLimit: number;
}

/**
 * Message buffer behind both chat modes: the passive feed shows only fresh
 * messages, the active one shows the scrollback.
 */
export class Feed {
  private readonly messages: StoredMessage[] = [];

  constructor(private readonly options: FeedOptions) {}

  /**
   * Keeps the buffer ordered by `at`, stable for equal times. Messages do not
   * always arrive in order: a live message can land while history is still
   * loading, and a backfill can bring an older message after newer ones.
   */
  add(message: ChatMessage, mode: FeedMode): void {
    const index = this.messages.findIndex((stored) => stored.id === message.id);
    if (index >= 0) {
      const existing = this.messages[index];
      const moved = existing.at !== message.at;
      Object.assign(existing, message);
      if (moved) {
        this.messages.splice(index, 1);
        this.insertSorted(existing);
      }
      return;
    }

    this.insertSorted({
      ...message,
      missed: mode === "hidden",
      read: mode !== "hidden",
    });

    if (this.messages.length > this.options.historyLimit) {
      this.messages.splice(0, this.messages.length - this.options.historyLimit);
    }
  }

  private insertSorted(message: StoredMessage): void {
    let index = this.messages.length;
    while (index > 0 && this.messages[index - 1].at > message.at) index -= 1;
    this.messages.splice(index, 0, message);
  }

  clear(): void {
    this.messages.splice(0, this.messages.length);
  }

  visible(mode: "inactive" | "active", now: number): ChatMessage[] {
    if (mode === "active") return [...this.messages];

    return this.messages.filter(
      (message) => !message.missed && now - message.at <= this.options.ttlMs,
    );
  }

  unreadCount(): number {
    return this.messages.filter((message) => !message.read).length;
  }

  markRead(): void {
    for (const message of this.messages) {
      message.read = true;
    }
  }
}
