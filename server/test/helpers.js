// Pure helper module (no side effects on import): test server and client.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { loadConfig } from '../src/config.js';
import { createRelay } from '../src/server.js';
import { authProof } from '../src/client-crypto.js';

export const ACCESS_KEY = 'test-access-key-0123456789';
export const ADMIN_KEY = 'test-admin-key-9876543210';

export function tmpDir(prefix = 'tgo-relay-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function randomRoomId() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Starts a relay on a random port. `tweak(config)` may adjust limits/timing.
 * `stop()` flushes rooms; the data dir is removed only with `cleanup()`.
 */
export async function startRelay({ dataDir = tmpDir(), env = {}, tweak } = {}) {
  const config = loadConfig({
    ACCESS_KEY,
    ADMIN_KEY,
    PORT: '0',
    HOST: '127.0.0.1',
    DATA_DIR: dataDir,
    ...env,
  });
  config.timing.persistDebounceMs = 20;
  tweak?.(config);
  const relay = createRelay(config, { logger: { info() {}, warn: console.error, error: console.error } });
  const { port } = await relay.start();
  return {
    relay,
    port,
    dataDir,
    config,
    url: `ws://127.0.0.1:${port}/ws`,
    stop: () => relay.stop(),
    cleanup: () => fs.rmSync(dataDir, { recursive: true, force: true }),
  };
}

export class Client {
  constructor(url, wsOptions) {
    this.ws = new WebSocket(url, wsOptions);
    this.queue = [];
    this.waiters = [];
    this.closeInfo = null;
    this.closed = new Promise((resolve) => {
      this.ws.on('close', (code, reason) => {
        this.closeInfo = { code, reason: reason.toString() };
        resolve(this.closeInfo);
      });
    });
    this.ws.on('error', () => {});
    this.ws.on('message', (raw) => {
      const frame = JSON.parse(raw.toString());
      const i = this.waiters.findIndex((w) => w.match(frame));
      if (i >= 0) this.waiters.splice(i, 1)[0].resolve(frame);
      else this.queue.push(frame);
    });
    this.opened = new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
  }

  /** Resolves with the next frame matching `match` (a type string or predicate). */
  next(match = () => true, timeoutMs = 3000) {
    const pred = typeof match === 'string' ? (f) => f.type === match : match;
    const i = this.queue.findIndex(pred);
    if (i >= 0) return Promise.resolve(this.queue.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { match: pred, resolve: (f) => { clearTimeout(timer); resolve(f); } };
      const timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        reject(new Error(`timeout waiting for frame ${typeof match === 'string' ? match : ''}`));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  send(obj) {
    this.ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
  }

  close() {
    this.ws.close();
    return this.closed;
  }
}

/** Opens a socket and waits for the challenge frame. */
export async function connect(url, wsOptions) {
  const client = new Client(url, wsOptions);
  await client.opened;
  client.challenge = await client.next('challenge');
  return client;
}

/** Connect and authenticate; resolves with the client and its `ready` frame. */
export async function join(url, { role = 'client', key, room, since = null } = {}) {
  const client = await connect(url);
  const proof = await authProof(key ?? (role === 'admin' ? ADMIN_KEY : ACCESS_KEY), role, client.challenge.nonce);
  const frame = { type: 'auth', role, proof };
  if (role === 'client') {
    frame.room = room;
    frame.since = since;
  }
  client.send(frame);
  client.ready = await client.next((f) => f.type === 'ready' || f.type === 'error');
  return client;
}

export function b64(text) {
  return Buffer.from(text).toString('base64');
}
