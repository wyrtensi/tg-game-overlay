import type { Direction } from "../telegram/direction-message";

export interface DirectionSignal {
  requestId?: string;
  messageId?: string;
  direction: Direction;
  at: number;
  author?: string;
  outgoing?: boolean;
}

/**
 * Signals are keyed by message id, which a relay room member chooses freely;
 * only the newest one is ever shown, so older entries past this are dropped.
 */
export const MAX_DIRECTION_SIGNALS = 64;

export class DirectionSignalStore {
  private readonly signals = new Map<string, DirectionSignal>();

  pending(requestId: string, direction: Direction, at: number): void {
    this.signals.set(`request:${requestId}`, { requestId, direction, at });
    this.trim();
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
    this.trim();
  }

  private trim(): void {
    while (this.signals.size > MAX_DIRECTION_SIGNALS) {
      let oldestKey: string | null = null;
      let oldestAt = Infinity;
      for (const [key, signal] of this.signals) {
        if (signal.at < oldestAt) {
          oldestAt = signal.at;
          oldestKey = key;
        }
      }
      if (oldestKey === null) return;
      this.signals.delete(oldestKey);
    }
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
