export interface DataUrlMedia {
  dataUrl: string;
}

/** Keeps only the newest media that fits the overlay's in-memory byte budget. */
export class MediaStore<T extends DataUrlMedia> {
  private readonly values = new Map<string, T>();

  constructor(private readonly maxBytes: number) {}

  set(id: string, media: T): void {
    this.values.set(id, media);
  }

  get(id: string): T | undefined {
    return this.values.get(id);
  }

  clear(): void {
    this.values.clear();
  }

  prune(retainedIdsOldestFirst: string[]): string[] {
    const retained = new Set(retainedIdsOldestFirst);
    const removed: string[] = [];
    for (const id of this.values.keys()) {
      if (!retained.has(id)) {
        this.values.delete(id);
        removed.push(id);
      }
    }

    let bytes = [...this.values.values()].reduce((total, media) => total + dataUrlByteLength(media.dataUrl), 0);
    for (const id of retainedIdsOldestFirst) {
      if (bytes <= this.maxBytes) break;
      const media = this.values.get(id);
      if (!media) continue;
      this.values.delete(id);
      bytes -= dataUrlByteLength(media.dataUrl);
      removed.push(id);
    }
    return removed;
  }
}

function dataUrlByteLength(dataUrl: string): number {
  const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((encoded.length * 3) / 4) - padding);
}
