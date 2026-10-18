import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { RoomStore } from './rooms.js';
import { StickerError, StickerStore } from './stickers.js';
import { silentLogger } from './log.js';
import { ROOM_ID_RE, SHA256_HEX_RE, base64DecodedLength, isBase64 } from './util.js';

const PROTOCOL_VERSION = 1;
const MAX_CID_LENGTH = 128;
const OPEN = 1;

/** Constant-time check of an auth proof (base64 HMAC-SHA256). */
export function verifyProof(key, role, nonce, proof) {
  const expected = crypto.createHmac('sha256', key).update(`tgo-relay-v1|auth|${role}|${nonce}`).digest();
  const got = typeof proof === 'string' && proof.length <= 128 ? Buffer.from(proof, 'base64') : Buffer.alloc(0);
  if (got.length !== expected.length) return false;
  return crypto.timingSafeEqual(got, expected);
}

function normalizeIp(ip) {
  if (!ip) return 'unknown';
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

/**
 * Creates the relay (HTTP + WebSocket) without starting to listen.
 * @param {ReturnType<import('./config.js').loadConfig>} config
 * @param {{ logger?: { info: Function, warn: Function, error: Function } }} [options]
 */
export function createRelay(config, { logger = silentLogger } = {}) {
  const { limits, timing } = config;
  fs.mkdirSync(config.dataDir, { recursive: true });
  const rooms = new RoomStore(config, logger);
  const stickers = new StickerStore(config.dataDir, limits, logger);
  const ipCounts = new Map();
  const sockets = new Set();
  /** Sockets still in the handshake: they get a tiny byte budget and a separate cap. */
  const unauthenticated = new Set();
  const stats = { authFailures: 0, lastLogged: '' };
  let timers = [];
  let stopped = false;

  const httpServer = http.createServer((req, res) => {
    const pathname = (req.url ?? '').split('?')[0];
    if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain', 'content-length': 2 });
      res.end(req.method === 'HEAD' ? undefined : 'ok');
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain', 'content-length': 9 });
    res.end('not found');
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: limits.maxFrameBytes });

  function clientIp(req) {
    if (config.trustProxy) {
      const xff = req.headers['x-forwarded-for'];
      const list = (Array.isArray(xff) ? xff.join(',') : (xff ?? ''))
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      // The last entry is the one appended by the nearest trusted proxy.
      if (list.length > 0) return normalizeIp(list[list.length - 1]);
    }
    return normalizeIp(req.socket.remoteAddress);
  }

  httpServer.on('upgrade', (req, socket, head) => {
    const pathname = (req.url ?? '').split('?')[0];
    if (pathname !== '/ws') {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    const ip = clientIp(req);
    if (
      sockets.size >= limits.maxConns
      || unauthenticated.size >= limits.maxUnauthenticated
      || (ipCounts.get(ip) ?? 0) >= limits.maxConnsPerIp
    ) {
      socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, ip));
  });

  function sendJson(ws, obj) {
    if (ws.readyState !== OPEN) return;
    ws.send(JSON.stringify(obj));
  }

  function sendError(ws, code, extra = {}) {
    sendJson(ws, { type: 'error', code, ...extra });
  }

  /** Sends an error and closes. Further frames from this socket are ignored. */
  function failAndClose(ws, ctx, code, message) {
    ctx.state = 'closing';
    sendError(ws, code, message ? { message } : {});
    ws.close(1008, code);
  }

  wss.on('connection', (ws, ip) => {
    const nonce = crypto.randomBytes(32).toString('base64');
    const ctx = {
      ip,
      nonce,
      state: 'await_auth', // await_auth -> authing -> ready | closing
      role: null,
      room: null,
      roomId: null,
      sendTimes: [],
      stickerTimes: [],
      stickerQueue: Promise.resolve(),
      preAuthBytes: 0,
      missed: 0,
      authTimer: null,
      failTimer: null,
    };
    ws.relay = ctx;
    sockets.add(ws);
    unauthenticated.add(ws);
    // ws buffers a whole frame (up to maxFrameBytes) before 'message' fires, so
    // count raw bytes until the socket authenticates and drop a chatty stranger.
    const rawSocket = ws._socket;
    const countPreAuth = (chunk) => {
      ctx.preAuthBytes += chunk.length;
      if (ctx.preAuthBytes > limits.preAuthMaxBytes) {
        rawSocket?.off('data', countPreAuth);
        ws.terminate();
      }
    };
    rawSocket?.on('data', countPreAuth);
    ctx.stopPreAuthCount = () => {
      rawSocket?.off('data', countPreAuth);
      unauthenticated.delete(ws);
    };
    ipCounts.set(ip, (ipCounts.get(ip) ?? 0) + 1);

    ctx.authTimer = setTimeout(() => {
      if (ctx.state === 'await_auth') failAndClose(ws, ctx, 'auth_failed', 'authentication timeout');
    }, timing.authTimeoutMs);

    ws.on('pong', () => {
      ctx.missed = 0;
    });

    ws.on('error', () => {
      // socket errors (including oversize frames) are followed by 'close'
    });

    ws.on('close', () => {
      clearTimeout(ctx.authTimer);
      clearTimeout(ctx.failTimer);
      sockets.delete(ws);
      ctx.stopPreAuthCount();
      const n = (ipCounts.get(ip) ?? 1) - 1;
      if (n <= 0) ipCounts.delete(ip);
      else ipCounts.set(ip, n);
      if (ctx.room) rooms.leave(ctx.roomId, ws);
    });

    ws.on('message', (raw, isBinary) => {
      if (ctx.state === 'closing' || ctx.state === 'authing') return;
      let msg = null;
      if (!isBinary) {
        try {
          msg = JSON.parse(raw.toString('utf8'));
        } catch {
          msg = null;
        }
      }
      const valid = msg !== null && typeof msg === 'object' && !Array.isArray(msg) && typeof msg.type === 'string';
      if (ctx.state === 'await_auth') {
        if (!valid || msg.type !== 'auth') return failAndClose(ws, ctx, 'bad_request', 'authenticate first');
        return handleAuth(ws, ctx, msg);
      }
      if (!valid) return sendError(ws, 'bad_request', { message: 'invalid frame' });
      handleMessage(ws, ctx, msg);
    });

    sendJson(ws, { type: 'challenge', v: PROTOCOL_VERSION, nonce });
  });

  function handleAuth(ws, ctx, msg) {
    const role = msg.role;
    if (role !== 'client' && role !== 'admin') return failAndClose(ws, ctx, 'bad_request', 'unknown role');
    clearTimeout(ctx.authTimer);
    ctx.state = 'authing';
    const key = role === 'client' ? config.accessKey : config.adminKey;
    // With no admin key configured, still do the work against a random key so
    // the result is always a failure and the timing matches.
    const ok = verifyProof(key ?? crypto.randomBytes(32), role, ctx.nonce, msg.proof) && key !== null;
    if (!ok) {
      stats.authFailures++;
      ctx.failTimer = setTimeout(() => failAndClose(ws, ctx, 'auth_failed'), timing.authFailDelayMs);
      return;
    }
    let since = null;
    if (role === 'client') {
      if (typeof msg.room !== 'string' || !ROOM_ID_RE.test(msg.room)) {
        return failAndClose(ws, ctx, 'bad_request', 'room must be 64 lowercase hex characters');
      }
      if (msg.since !== undefined && msg.since !== null) {
        if (!Number.isSafeInteger(msg.since) || msg.since < 0) {
          return failAndClose(ws, ctx, 'bad_request', 'since must be null or a non-negative integer');
        }
        since = msg.since;
      }
    }
    if (role === 'client') {
      const room = rooms.join(msg.room, ws);
      if (!room) return failAndClose(ws, ctx, 'busy', 'the server holds too many rooms right now');
      ctx.room = room;
      ctx.roomId = msg.room;
    }
    ctx.role = role;
    ctx.state = 'ready';
    ctx.stopPreAuthCount();
    if (role === 'client') {
      sendJson(ws, { type: 'ready', seq: ctx.room.seq, history: ctx.room.history(since) });
    } else {
      sendJson(ws, { type: 'ready', seq: 0, history: [] });
    }
  }

  function handleMessage(ws, ctx, msg) {
    switch (msg.type) {
      case 'send':
        return handleSend(ws, ctx, msg);
      case 'stickers_index':
        try {
          return sendJson(ws, { type: 'stickers_index', ...stickers.index() });
        } catch {
          return sendError(ws, 'bad_request', { request: 'stickers_index' });
        }
      case 'sticker_get': {
        const now = Date.now();
        const times = ctx.stickerTimes;
        while (times.length > 0 && now - times[0] >= limits.rateWindowMs) times.shift();
        if (times.length >= limits.stickerRateMax || ws.bufferedAmount > limits.maxBufferedBytes) {
          return sendError(ws, 'rate_limited', { id: typeof msg.id === 'string' ? msg.id.slice(0, 80) : null });
        }
        times.push(now);
        // One file read at a time per connection: a burst of requests must not
        // hold hundreds of sticker buffers in memory at once.
        ctx.stickerQueue = ctx.stickerQueue.then(() => handleStickerGet(ws, msg)).catch(() => {});
        return undefined;
      }
      case 'sticker_put':
      case 'sticker_delete':
        if (ctx.role !== 'admin') return sendError(ws, 'forbidden', { message: 'admin only' });
        return msg.type === 'sticker_put' ? handleStickerPut(ws, msg) : handleStickerDelete(ws, msg);
      default:
        return sendError(ws, 'bad_request', { message: 'unknown message type' });
    }
  }

  function handleSend(ws, ctx, msg) {
    const cid = typeof msg.cid === 'string' && msg.cid.length > 0 && msg.cid.length <= MAX_CID_LENGTH ? msg.cid : null;
    if (ctx.role !== 'client') return sendError(ws, 'forbidden', cid ? { cid } : {});
    if (cid === null) return sendError(ws, 'bad_request', { message: 'cid is required' });

    const now = Date.now();
    const times = ctx.sendTimes;
    while (times.length > 0 && now - times[0] >= limits.rateWindowMs) times.shift();
    if (times.length >= limits.rateMax) return sendError(ws, 'rate_limited', { cid });
    times.push(now);

    if (!isBase64(msg.data)) return sendError(ws, 'bad_request', { cid, message: 'data must be base64' });
    if (msg.data.length > limits.maxMessageData) return sendError(ws, 'too_large', { cid });

    const room = ctx.room;
    const stored = room.add(msg.data, now);
    // One buffer for every peer instead of a fresh copy per send.
    const plain = Buffer.from(JSON.stringify({ type: 'msg', ...stored }));
    const own = JSON.stringify({ type: 'msg', ...stored, cid });
    for (const peer of room.conns) {
      if (peer.readyState !== OPEN) continue;
      if (peer.bufferedAmount > limits.maxBufferedBytes) {
        peer.terminate(); // slow consumer: it resyncs through `since` on reconnect
        continue;
      }
      if (peer === ws) peer.send(own);
      else peer.send(plain, { binary: false });
    }
  }

  async function handleStickerGet(ws, msg) {
    const id = msg.id;
    if (typeof id !== 'string' || !SHA256_HEX_RE.test(id)) {
      return sendError(ws, 'bad_request', { id: typeof id === 'string' ? id.slice(0, 80) : null, message: 'id must be a sha256 hex string' });
    }
    if (ws.readyState !== OPEN) return;
    const file = await stickers.read(id);
    if (!file) return sendError(ws, 'not_found', { id });
    // Re-check after the read: the peer may not be draining what it already got.
    if (ws.bufferedAmount > limits.maxBufferedBytes) return sendError(ws, 'rate_limited', { id });
    sendJson(ws, { type: 'sticker', id, kind: file.kind, b64: file.bytes.toString('base64') });
  }

  function handleStickerPut(ws, msg) {
    try {
      if (typeof msg.b64 !== 'string' || !isBase64(msg.b64)) {
        throw new StickerError('bad_request', 'b64 must be base64');
      }
      if (base64DecodedLength(msg.b64) > limits.maxStickerBytes) {
        throw new StickerError('too_large', 'sticker exceeds the size limit');
      }
      const result = stickers.put({ pack: msg.pack, kind: msg.kind, emoji: msg.emoji, bytes: Buffer.from(msg.b64, 'base64') });
      sendJson(ws, { type: 'sticker_put', id: result.id, created: result.created });
    } catch (err) {
      if (!(err instanceof StickerError)) {
        logger.error('sticker_put failed', { code: err.code ?? 'error' });
        return sendError(ws, 'bad_request', { message: 'could not store sticker' });
      }
      sendError(ws, err.code, { message: err.message });
    }
  }

  function handleStickerDelete(ws, msg) {
    const id = msg.id;
    if (typeof id !== 'string' || !SHA256_HEX_RE.test(id)) {
      return sendError(ws, 'bad_request', { id: typeof id === 'string' ? id.slice(0, 80) : null, message: 'id must be a sha256 hex string' });
    }
    if (!stickers.delete(id)) return sendError(ws, 'not_found', { id });
    sendJson(ws, { type: 'sticker_delete', id, deleted: true });
  }

  function heartbeat() {
    for (const ws of sockets) {
      const ctx = ws.relay;
      if (ctx.missed >= 2) {
        ws.terminate();
        continue;
      }
      ctx.missed++;
      ws.ping();
    }
  }

  function logStats() {
    const summary = JSON.stringify({ c: sockets.size, r: rooms.size, a: stats.authFailures });
    if (summary === stats.lastLogged) return;
    stats.lastLogged = summary;
    logger.info('stats', { connections: sockets.size, rooms: rooms.size, authFailures: stats.authFailures });
  }

  return {
    /** @returns {Promise<{ port: number }>} */
    start() {
      return new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(config.port, config.host, () => {
          httpServer.off('error', reject);
          const port = httpServer.address().port;
          const every = (fn, ms) => {
            const t = setInterval(fn, ms);
            t.unref();
            timers.push(t);
          };
          every(heartbeat, timing.pingIntervalMs);
          every(() => rooms.sweep(), timing.sweepIntervalMs);
          every(logStats, timing.statsIntervalMs);
          logger.info('relay listening', { port, host: config.host, admin: config.adminKey !== null, trustProxy: config.trustProxy });
          resolve({ port });
        });
      });
    },

    /** Stops accepting, closes sockets and flushes rooms to disk. */
    async stop() {
      if (stopped) return;
      stopped = true;
      timers.forEach(clearInterval);
      timers = [];
      for (const ws of sockets) ws.close(1001, 'server shutting down');
      rooms.flushAll();
      await new Promise((resolve) => {
        const force = setTimeout(() => {
          for (const ws of sockets) ws.terminate();
          httpServer.closeAllConnections();
        }, 1000);
        wss.close(() => {
          httpServer.close(() => {
            clearTimeout(force);
            resolve();
          });
          httpServer.closeAllConnections();
        });
      });
      rooms.flushAll();
      logger.info('relay stopped');
    },

    get connectionCount() {
      return sockets.size;
    },
  };
}
