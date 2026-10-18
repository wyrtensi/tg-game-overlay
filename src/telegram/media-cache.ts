import type { OverlayMediaRef } from "./types";

/**
 * Media already downloaded and pushed to the overlay, keyed by message id
 * and checked against the file it came from (an edit can swap the file). A
 * history re-push - after the overlay page reloads, or a backfill - uses it
 * instead of downloading the same files again. Bounded by bytes; the oldest
 * entries go first.
 */
export class PushedMediaCache {
  private readonly entries = new Map<string, { fileKey: string; media: OverlayMediaRef; bytes: number }>();
  private bytes = 0;

  constructor(private readonly maxBytes: number) {}

  get(messageId: string, fileKey: string): OverlayMediaRef | undefined {
    const entry = this.entries.get(messageId);
    return entry?.fileKey === fileKey ? entry.media : undefined;
  }

  set(messageId: string, fileKey: string, media: OverlayMediaRef): void {
    this.delete(messageId);
    const bytes = media.dataUrl.length;
    if (bytes > this.maxBytes) return;
    this.entries.set(messageId, { fileKey, media, bytes });
    this.bytes += bytes;
    for (const id of this.entries.keys()) {
      if (this.bytes <= this.maxBytes) break;
      this.delete(id);
    }
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }

  private delete(messageId: string): void {
    const entry = this.entries.get(messageId);
    if (!entry) return;
    this.entries.delete(messageId);
    this.bytes -= entry.bytes;
  }
}
