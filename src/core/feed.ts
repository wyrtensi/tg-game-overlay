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

  add(message: ChatMessage, mode: FeedMode): void {
    const existing = this.messages.find((stored) => stored.id === message.id);
    if (existing) {
      Object.assign(existing, message);
      return;
    }

    this.messages.push({
      ...message,
      missed: mode === "hidden",
      read: mode !== "hidden",
    });

    if (this.messages.length > this.options.historyLimit) {
      this.messages.splice(0, this.messages.length - this.options.historyLimit);
    }
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
