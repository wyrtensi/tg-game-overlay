import fs from 'node:fs';
import path from 'node:path';

/**
 * @typedef {{ seq: number, at: number, data: string }} Stored
 */

/** Writes a file atomically: temp file in the same directory, then rename. */
export function writeFileAtomic(file, content) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, content);
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (err) {
      // Windows can briefly refuse to replace a file that a scanner or indexer has open.
      const transient = err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES';
      if (!transient || attempt >= 20) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
}

function unlinkQuiet(file) {
  try {
    fs.unlinkSync(file);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

export class Room {
  constructor(id, store) {
    this.id = id;
    this.store = store;
    this.seq = 0;
    /** @type {Stored[]} */
    this.messages = [];
    this.bytes = 0;
    /** @type {Set<import('ws').WebSocket>} */
    this.conns = new Set();
    this.dirty = false;
    this.timer = null;
  }

  /** Drops expired messages; returns true when something was removed. */
  pruneExpired(now = Date.now()) {
    const cutoff = now - this.store.limits.messageTtlMs;
    let n = 0;
    while (n < this.messages.length && this.messages[n].at < cutoff) {
      this.bytes -= this.messages[n].data.length;
      n++;
    }
    if (n > 0) {
      this.messages.splice(0, n);
      this.markDirty();
    }
    return n > 0;
  }

  /** @returns {Stored} */
  add(data, now = Date.now()) {
    const stored = { seq: ++this.seq, at: now, data };
    this.messages.push(stored);
    this.bytes += data.length;
    const { roomHistory, roomMaxBytes } = this.store.limits;
    let drop = 0;
    while (this.messages.length - drop > roomHistory) this.bytes -= this.messages[drop++].data.length;
    while (this.messages.length - drop > 1 && this.bytes > roomMaxBytes) this.bytes -= this.messages[drop++].data.length;
    if (drop > 0) this.messages.splice(0, drop);
    this.markDirty();
    return stored;
  }

  /** Messages with seq > since (all when since is null). */
  history(since) {
    if (since === null || since > this.seq) return this.messages;
    return this.messages.filter((m) => m.seq > since);
  }

  markDirty() {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.store.timing.persistDebounceMs);
    this.timer.unref();
  }

  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty) return;
    this.dirty = false;
    const file = this.store.fileFor(this.id);
    try {
      if (this.messages.length === 0) {
        unlinkQuiet(file);
      } else {
        writeFileAtomic(file, JSON.stringify({ v: 1, seq: this.seq, messages: this.messages }));
      }
    } catch (err) {
      this.dirty = true;
      this.store.logger.error('room persist failed', { code: err.code ?? 'error' });
    }
  }
}

export class RoomStore {
  constructor({ dataDir, limits, timing, seqStart = () => Date.now() }, logger) {
    this.dir = path.join(dataDir, 'rooms');
    this.seqStart = seqStart;
    this.limits = limits;
    this.timing = timing;
    this.logger = logger;
    /** @type {Map<string, Room>} rooms with at least one connection */
    this.rooms = new Map();
    fs.mkdirSync(this.dir, { recursive: true });
    this.sweepFiles();
  }

  fileFor(id) {
    return path.join(this.dir, `${id}.json`);
  }

  /** Adds a connection to a room (loading it from disk if needed); null when the server is full. */
  join(id, ws) {
    let room = this.rooms.get(id);
    if (!room) {
      if (this.rooms.size >= this.limits.maxLoadedRooms) return null;
      if (!fs.existsSync(this.fileFor(id)) && this.fileCount() >= this.limits.maxRoomFiles) return null;
      room = this.load(id);
      this.rooms.set(id, room);
    }
    room.pruneExpired();
    room.conns.add(ws);
    return room;
  }

  leave(id, ws) {
    const room = this.rooms.get(id);
    if (!room || !room.conns.delete(ws) || room.conns.size > 0) return;
    room.pruneExpired();
    room.flush();
    this.rooms.delete(id);
  }

  load(id) {
    const room = new Room(id, this);
    // A room without a file (new, or forgotten after its messages expired)
    // starts numbering at the clock, so a client that still remembers an old
    // `since` never skips the first messages of the new life of the room.
    room.seq = this.seqStart();
    const file = this.fileFor(id);
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') this.logger.error('room read failed', { code: err.code ?? 'error' });
      return room;
    }
    try {
      const parsed = JSON.parse(text);
      const list = Array.isArray(parsed.messages) ? parsed.messages : [];
      for (const m of list) {
        if (Number.isSafeInteger(m?.seq) && Number.isFinite(m.at) && typeof m.data === 'string') {
          room.messages.push({ seq: m.seq, at: m.at, data: m.data });
          room.bytes += m.data.length;
        }
      }
      room.seq = Math.max(Number.isSafeInteger(parsed.seq) ? parsed.seq : 0, room.messages.at(-1)?.seq ?? 0);
    } catch {
      this.logger.warn('room file is corrupt, starting empty');
      try {
        fs.renameSync(file, `${file}.corrupt`);
      } catch {
        // best effort: the next flush overwrites it
      }
      room.messages = [];
      room.bytes = 0;
      room.seq = this.seqStart();
    }
    return room;
  }

  /** Removes expired messages from loaded rooms and stale files from disk. */
  sweep(now = Date.now()) {
    for (const room of this.rooms.values()) room.pruneExpired(now);
    this.sweepFiles(now);
  }

  /**
   * A room file whose mtime is older than the TTL holds only expired messages
   * (the file is rewritten on every change), so it can go without parsing.
   */
  sweepFiles(now = Date.now()) {
    let names;
    try {
      names = fs.readdirSync(this.dir);
    } catch {
      return;
    }
    for (const name of names) {
      const id = name.endsWith('.json') ? name.slice(0, -5) : null;
      if (name.endsWith('.tmp') || (id && this.rooms.has(id))) {
        if (name.endsWith('.tmp')) unlinkQuiet(path.join(this.dir, name));
        continue;
      }
      if (!id) continue;
      try {
        const file = path.join(this.dir, name);
        if (fs.statSync(file).mtimeMs < now - this.limits.messageTtlMs) unlinkQuiet(file);
      } catch {
        // file vanished or unreadable: ignore
      }
    }
  }

  fileCount() {
    try {
      return fs.readdirSync(this.dir).filter((name) => name.endsWith('.json')).length;
    } catch {
      return 0;
    }
  }

  flushAll() {
    for (const room of this.rooms.values()) room.flush();
  }

  get size() {
    return this.rooms.size;
  }
}
