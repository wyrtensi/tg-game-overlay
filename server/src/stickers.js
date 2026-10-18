import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from './rooms.js';

export const STICKER_KINDS = new Set(['tgs', 'webp', 'webm']);
const MAX_EMOJI_LENGTH = 32; // UTF-16 code units
const MAX_TITLE_LENGTH = 64;

/** Error carrying a protocol error code. */
export class StickerError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Pack id from a title: lowercase ascii letters, digits and dashes.
 * Titles with non-ascii characters (after stripping accents) get a short
 * hash suffix so that e.g. different Cyrillic titles never collide.
 */
export function packSlug(title) {
  const stripped = title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  let slug = stripped
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  if (/[^\x00-\x7f]/.test(stripped)) {
    const h = crypto.createHash('sha256').update(title.normalize('NFC')).digest('hex').slice(0, 8);
    slug = slug ? `${slug}-${h}` : `p-${h}`;
  } else if (!slug) {
    slug = `p-${crypto.createHash('sha256').update(title).digest('hex').slice(0, 8)}`;
  }
  return slug;
}

/**
 * Content-addressed sticker files plus an index of packs, all under
 * DATA_DIR/stickers. The index is small and kept in memory.
 */
export class StickerStore {
  constructor(dataDir, { maxStickerBytes }, logger) {
    this.dir = path.join(dataDir, 'stickers');
    this.indexFile = path.join(this.dir, 'index.json');
    this.maxStickerBytes = maxStickerBytes;
    this.logger = logger;
    /** @type {{ id: string, title: string, stickers: { id: string, kind: string, emoji?: string, size: number }[] }[]} */
    this.packs = [];
    this.byId = new Map();
    this._index = null;
    fs.mkdirSync(this.dir, { recursive: true });
    this.load();
  }

  load() {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') this.logger.warn('sticker index unreadable, starting empty');
      return;
    }
    for (const p of Array.isArray(parsed.packs) ? parsed.packs : []) {
      if (typeof p?.id !== 'string' || typeof p.title !== 'string' || !Array.isArray(p.stickers)) continue;
      const pack = { id: p.id, title: p.title, stickers: [] };
      for (const s of p.stickers) {
        if (typeof s?.id !== 'string' || !STICKER_KINDS.has(s.kind) || !Number.isSafeInteger(s.size)) continue;
        const sticker = { id: s.id, kind: s.kind, size: s.size };
        if (typeof s.emoji === 'string' && s.emoji) sticker.emoji = s.emoji;
        pack.stickers.push(sticker);
        this.byId.set(sticker.id, sticker);
      }
      this.packs.push(pack);
    }
  }

  save() {
    this._index = null;
    writeFileAtomic(this.indexFile, JSON.stringify({ packs: this.packs }));
  }

  /** @returns {{ version: string, packs: object[] }} */
  index() {
    if (!this._index) {
      const packs = [...this.packs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const version = crypto.createHash('sha256').update(JSON.stringify(packs)).digest('hex');
      this._index = { version, packs };
    }
    return this._index;
  }

  /**
   * @param {{ pack: unknown, kind: unknown, emoji?: unknown, bytes: Buffer }} input
   * @returns {{ id: string, created: boolean }}
   */
  put({ pack, kind, emoji, bytes }) {
    if (typeof pack !== 'string' || !pack.trim() || pack.length > MAX_TITLE_LENGTH) {
      throw new StickerError('bad_request', 'pack must be a non-empty title of at most 64 characters');
    }
    if (typeof kind !== 'string' || !STICKER_KINDS.has(kind)) {
      throw new StickerError('bad_request', 'kind must be tgs, webp or webm');
    }
    if (emoji !== undefined && (typeof emoji !== 'string' || emoji.length > MAX_EMOJI_LENGTH)) {
      throw new StickerError('bad_request', 'emoji must be a short string');
    }
    if (bytes.length === 0) throw new StickerError('bad_request', 'empty sticker');
    if (bytes.length > this.maxStickerBytes) throw new StickerError('too_large', 'sticker exceeds the size limit');

    const id = crypto.createHash('sha256').update(bytes).digest('hex');
    if (this.byId.has(id)) return { id, created: false };

    writeFileAtomic(path.join(this.dir, `${id}.${kind}`), bytes);
    const title = pack.trim();
    const packId = packSlug(title);
    let target = this.packs.find((p) => p.id === packId);
    if (!target) {
      target = { id: packId, title, stickers: [] };
      this.packs.push(target);
    }
    const sticker = { id, kind, size: bytes.length };
    if (emoji) sticker.emoji = emoji;
    target.stickers.push(sticker);
    this.byId.set(id, sticker);
    this.save();
    return { id, created: true };
  }

  /** @returns {boolean} false when the id is unknown */
  delete(id) {
    const sticker = this.byId.get(id);
    if (!sticker) return false;
    this.byId.delete(id);
    for (const pack of this.packs) pack.stickers = pack.stickers.filter((s) => s.id !== id);
    this.packs = this.packs.filter((p) => p.stickers.length > 0);
    this.save();
    try {
      fs.unlinkSync(path.join(this.dir, `${id}.${sticker.kind}`));
    } catch (err) {
      if (err.code !== 'ENOENT') this.logger.warn('sticker file removal failed', { code: err.code ?? 'error' });
    }
    return true;
  }

  /** @returns {Promise<{ kind: string, bytes: Buffer } | null>} */
  async read(id) {
    const sticker = this.byId.get(id);
    if (!sticker) return null;
    try {
      const bytes = await fs.promises.readFile(path.join(this.dir, `${id}.${sticker.kind}`));
      return { kind: sticker.kind, bytes };
    } catch (err) {
      this.logger.warn('sticker file unreadable', { code: err.code ?? 'error' });
      return null;
    }
  }
}
