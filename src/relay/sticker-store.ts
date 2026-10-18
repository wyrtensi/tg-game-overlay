// Local cache for relay stickers. Files are content-addressed by SHA-256, so a
// cached entry never goes stale and the server is asked for each file once.

import type { RelayStickerKind } from "./crypto";

export interface CachedSticker {
  id: string;
  kind: RelayStickerKind;
  b64: string;
  lastUsedAt: number;
}

export interface StickerStore {
  get(id: string): Promise<CachedSticker | null>;
  put(entry: CachedSticker): Promise<void>;
}

const MIME_BY_KIND: Record<RelayStickerKind, string> = {
  tgs: "application/x-tgsticker",
  webp: "image/webp",
  webm: "video/webm",
};

export function stickerMimeType(kind: RelayStickerKind): string {
  return MIME_BY_KIND[kind];
}

export function stickerDataUrl(entry: { kind: RelayStickerKind; b64: string }): string {
  return `data:${stickerMimeType(entry.kind)};base64,${entry.b64}`;
}

export class MemoryStickerStore implements StickerStore {
  readonly entries = new Map<string, CachedSticker>();

  async get(id: string): Promise<CachedSticker | null> {
    return this.entries.get(id) ?? null;
  }

  async put(entry: CachedSticker): Promise<void> {
    this.entries.set(entry.id, entry);
  }
}

const DB_NAME = "tg-overlay-relay-stickers-v1";
const STORE = "stickers";

export class IndexedDbStickerStore implements StickerStore {
  private database: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database;
    this.database = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Не удалось открыть кэш стикеров"));
    });
    return this.database;
  }

  async get(id: string): Promise<CachedSticker | null> {
    const db = await this.open();
    const entry = await requestResult<CachedSticker | undefined>(
      db.transaction(STORE, "readonly").objectStore(STORE).get(id),
    );
    return entry ?? null;
  }

  async put(entry: CachedSticker): Promise<void> {
    const db = await this.open();
    await requestResult(db.transaction(STORE, "readwrite").objectStore(STORE).put(entry));
  }
}

function requestResult<T = undefined>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Ошибка кэша стикеров"));
  });
}
