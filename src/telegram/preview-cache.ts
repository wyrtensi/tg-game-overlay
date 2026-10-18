import type { StickerPack } from "./types";

const CACHE_DB = "tg-overlay-sticker-previews-v1";
const CACHE_STORE = "previews";
const PACKS_STORE = "packs";
const PREVIEW_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface CachedPreview {
  fileId: string;
  dataUrl: string;
  bytes: number;
  updatedAt: number;
  lastUsedAt: number;
}

export interface PreviewCacheLimits {
  maxEntries: number;
  maxBytes: number;
}

interface CachedStickerPacks {
  accountId: string;
  packs: StickerPack[];
  updatedAt: number;
}

export function cachedStickerPacks(packs: StickerPack[]): StickerPack[] {
  return packs.map((pack) => ({
    ...pack,
    stickers: pack.stickers.map((sticker) => ({ ...sticker, documentReady: false })),
  }));
}

export function evictionPlan(entries: CachedPreview[], limits: PreviewCacheLimits, now = Date.now()): string[] {
  const removed = new Set(
    entries.filter((entry) => now - entry.updatedAt > PREVIEW_TTL_MS).map((entry) => entry.fileId),
  );
  const remaining = entries.filter((entry) => !removed.has(entry.fileId));
  let count = remaining.length;
  let bytes = remaining.reduce((sum, entry) => sum + entry.bytes, 0);

  for (const entry of [...remaining].sort((a, b) => a.lastUsedAt - b.lastUsedAt)) {
    if (count <= limits.maxEntries && bytes <= limits.maxBytes) break;
    removed.add(entry.fileId);
    count -= 1;
    bytes -= entry.bytes;
  }
  return [...removed];
}

export class PreviewCache {
  private readonly limits: PreviewCacheLimits = { maxEntries: 800, maxBytes: 24 * 1024 * 1024 };
  private database: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database;
    this.database = new Promise((resolve, reject) => {
      const request = indexedDB.open(CACHE_DB, 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(CACHE_STORE)) db.createObjectStore(CACHE_STORE, { keyPath: "fileId" });
        if (!db.objectStoreNames.contains(PACKS_STORE)) db.createObjectStore(PACKS_STORE, { keyPath: "accountId" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Не удалось открыть кэш стикеров"));
    });
    return this.database;
  }

  async get(fileId: string): Promise<CachedPreview | null> {
    const db = await this.open();
    const entry = await requestResult<CachedPreview | undefined>(
      db.transaction(CACHE_STORE, "readonly").objectStore(CACHE_STORE).get(fileId),
    );
    if (!entry || Date.now() - entry.updatedAt > PREVIEW_TTL_MS) return null;
    const touched = { ...entry, lastUsedAt: Date.now() };
    await requestResult(db.transaction(CACHE_STORE, "readwrite").objectStore(CACHE_STORE).put(touched));
    return touched;
  }

  async put(entry: CachedPreview): Promise<void> {
    const db = await this.open();
    await requestResult(db.transaction(CACHE_STORE, "readwrite").objectStore(CACHE_STORE).put(entry));
  }

  async prune(): Promise<void> {
    const db = await this.open();
    const entries = await requestResult<CachedPreview[]>(
      db.transaction(CACHE_STORE, "readonly").objectStore(CACHE_STORE).getAll(),
    );
    const ids = evictionPlan(entries, this.limits);
    if (ids.length > 0) {
      const store = db.transaction(CACHE_STORE, "readwrite").objectStore(CACHE_STORE);
      await Promise.all(ids.map((id) => requestResult(store.delete(id))));
    }
  }

  async getPacks(accountId: string): Promise<StickerPack[] | null> {
    const db = await this.open();
    const entry = await requestResult<CachedStickerPacks | undefined>(
      db.transaction(PACKS_STORE, "readonly").objectStore(PACKS_STORE).get(accountId),
    );
    if (!entry || Date.now() - entry.updatedAt > PREVIEW_TTL_MS) return null;
    return cachedStickerPacks(entry.packs);
  }

  async putPacks(accountId: string, packs: StickerPack[]): Promise<void> {
    const db = await this.open();
    await requestResult(
      db.transaction(PACKS_STORE, "readwrite").objectStore(PACKS_STORE).put({ accountId, packs, updatedAt: Date.now() }),
    );
  }
}

function requestResult<T = undefined>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Ошибка кэша стикеров"));
  });
}
