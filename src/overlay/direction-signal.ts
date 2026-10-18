import type { Direction } from "../telegram/direction-message";

export interface DirectionSignal {
  requestId?: string;
  messageId?: string;
  direction: Direction;
  at: number;
  author?: string;
  outgoing?: boolean;
}

export class DirectionSignalStore {
  private readonly signals = new Map<string, DirectionSignal>();

  pending(requestId: string, direction: Direction, at: number): void {
    this.signals.set(`request:${requestId}`, { requestId, direction, at });
  }

  confirm(requestId: string, messageId: string): void {
    const pendingKey = `request:${requestId}`;
    const pending = this.signals.get(pendingKey);
    if (!pending) return;
    this.signals.delete(pendingKey);

    const messageKey = `message:${messageId}`;
    const existing = this.signals.get(messageKey);
    // The local send is newer than a delayed Telegram mirror of the prior value.
    this.signals.set(messageKey, { ...existing, ...pending, requestId, messageId });
  }

  discard(requestId: string): void {
    this.signals.delete(`request:${requestId}`);
  }

  clear(): void {
    this.signals.clear();
  }

  upsert(signal: Required<Pick<DirectionSignal, "messageId" | "direction" | "at">> & Omit<DirectionSignal, "messageId" | "direction" | "at">): void {
    const key = `message:${signal.messageId}`;
    const existing = this.signals.get(key);
    if (existing && existing.at >= signal.at) return;
    this.signals.set(key, { ...existing, ...signal });
  }

  current(): DirectionSignal | null {
    let current: DirectionSignal | null = null;
    for (const signal of this.signals.values()) {
      if (!current || signal.at >= current.at) current = signal;
    }
    return current;
  }

  entries(): DirectionSignal[] {
    return [...this.signals.values()].sort((a, b) => a.at - b.at);
  }
}
