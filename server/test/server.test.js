import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { after, before, describe, test } from 'node:test';
import { promisify } from 'node:util';
import { Client, ACCESS_KEY, b64, connect, join, randomRoomId, startRelay } from './helpers.js';
import { authProof } from '../src/client-crypto.js';

const execFileAsync = promisify(execFile);

describe('http', () => {
  let srv;
  before(async () => {
    srv = await startRelay();
  });
  after(async () => {
    await srv.stop();
    srv.cleanup();
  });

  test('GET /health returns ok', async () => {
    const res = await fetch(`http://127.0.0.1:${srv.port}/health`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'ok');
  });

  test('every other path is 404', async () => {
    for (const p of ['/', '/ws/', '/health/x', '/index.html']) {
      const res = await fetch(`http://127.0.0.1:${srv.port}${p}`);
      assert.equal(res.status, 404, p);
    }
  });

  test('websocket upgrade is only accepted on /ws', async () => {
    const c = new Client(`ws://127.0.0.1:${srv.port}/other`);
    await assert.rejects(c.opened);
  });
});

describe('auth', () => {
  let srv;
  before(async () => {
    srv = await startRelay({ tweak: (c) => { c.timing.authFailDelayMs = 250; c.timing.authTimeoutMs = 300; } });
  });
  after(async () => {
    await srv.stop();
    srv.cleanup();
  });

  test('valid proof is accepted and gets an empty ready', async () => {
    const c = await join(srv.url, { room: randomRoomId() });
    assert.equal(c.ready.type, 'ready');
    assert.equal(c.ready.seq, 0);
    assert.deepEqual(c.ready.history, []);
    assert.equal(c.challenge.v, 1);
    assert.equal(Buffer.from(c.challenge.nonce, 'base64').length, 32);
    await c.close();
  });

  test('wrong proof gets auth_failed after a delay, then the socket closes', async () => {
    const c = await connect(srv.url);
    const started = Date.now();
    c.send({ type: 'auth', role: 'client', proof: await authProof('some-other-key-123456', 'client', c.challenge.nonce), room: randomRoomId(), since: null });
    const err = await c.next('error');
    assert.equal(err.code, 'auth_failed');
    assert.ok(Date.now() - started >= 230, 'answer is delayed');
    const closed = await c.closed;
    assert.equal(closed.code, 1008);
  });

  test('garbage proof and wrong role proof fail', async () => {
    for (const proof of ['', 'AAAA', 'x'.repeat(500), 12]) {
      const c = await connect(srv.url);
      c.send({ type: 'auth', role: 'client', proof, room: randomRoomId() });
      assert.equal((await c.next('error')).code, 'auth_failed');
      await c.closed;
    }
    // A client proof must not work for the admin role.
    const c = await connect(srv.url);
    c.send({ type: 'auth', role: 'admin', proof: await authProof(ACCESS_KEY, 'client', c.challenge.nonce) });
    assert.equal((await c.next('error')).code, 'auth_failed');
    await c.closed;
  });

  test('proof is bound to the nonce of the connection', async () => {
    const a = await connect(srv.url);
    const b = await connect(srv.url);
    b.send({ type: 'auth', role: 'client', proof: await authProof(ACCESS_KEY, 'client', a.challenge.nonce), room: randomRoomId() });
    assert.equal((await b.next('error')).code, 'auth_failed');
    await a.close();
    await b.closed;
  });

  test('a frame before auth closes the connection', async () => {
    const c = await connect(srv.url);
    c.send({ type: 'send', cid: '1', data: b64('x') });
    assert.equal((await c.next('error')).code, 'bad_request');
    assert.equal((await c.closed).code, 1008);
  });

  test('a bad room id after a valid proof is bad_request', async () => {
    for (const room of [undefined, 'abc', 'A'.repeat(64), 5]) {
      const c = await connect(srv.url);
      c.send({ type: 'auth', role: 'client', proof: await authProof(ACCESS_KEY, 'client', c.challenge.nonce), room });
      assert.equal((await c.next('error')).code, 'bad_request');
      await c.closed;
    }
  });

  test('a bad since is bad_request', async () => {
    const c = await connect(srv.url);
    c.send({ type: 'auth', role: 'client', proof: await authProof(ACCESS_KEY, 'client', c.challenge.nonce), room: randomRoomId(), since: -1 });
    assert.equal((await c.next('error')).code, 'bad_request');
    await c.closed;
  });

  test('no auth within the timeout closes the connection', async () => {
    const c = await connect(srv.url);
    const err = await c.next('error', 2000);
    assert.equal(err.code, 'auth_failed');
    assert.equal((await c.closed).code, 1008);
  });
});

describe('admin role is disabled without ADMIN_KEY', () => {
  test('admin auth fails', async () => {
    const srv = await startRelay({ env: { ADMIN_KEY: '' }, tweak: (c) => { c.timing.authFailDelayMs = 10; } });
    try {
      const c = await connect(srv.url);
      c.send({ type: 'auth', role: 'admin', proof: await authProof('whatever-key-1234567', 'admin', c.challenge.nonce) });
      assert.equal((await c.next('error')).code, 'auth_failed');
      await c.closed;
    } finally {
      await srv.stop();
      srv.cleanup();
    }
  });
});

describe('limits', () => {
  test('rate limit: 30 sends per 10 s, then rate_limited with the cid', async () => {
    const srv = await startRelay();
    try {
      const c = await join(srv.url, { room: randomRoomId() });
      for (let i = 0; i < 31; i++) c.send({ type: 'send', cid: `c${i}`, data: b64(`m${i}`) });
      const err = await c.next('error');
      assert.equal(err.code, 'rate_limited');
      assert.equal(err.cid, 'c30');
      for (let i = 0; i < 30; i++) assert.equal((await c.next('msg')).cid, `c${i}`);
      await c.close();
    } finally {
      await srv.stop();
      srv.cleanup();
    }
  });

  test('send validation: cid required, data must be base64, size capped', async () => {
    const srv = await startRelay({ tweak: (c) => { c.limits.maxMessageData = 100; } });
    try {
      const c = await join(srv.url, { room: randomRoomId() });
      c.send({ type: 'send', data: b64('x') });
      assert.equal((await c.next('error')).code, 'bad_request');
      c.send({ type: 'send', cid: 'a', data: 'not base64!' });
      const bad = await c.next('error');
      assert.deepEqual([bad.code, bad.cid], ['bad_request', 'a']);
      c.send({ type: 'send', cid: 'b', data: Buffer.alloc(200).toString('base64') });
      const big = await c.next('error');
      assert.deepEqual([big.code, big.cid], ['too_large', 'b']);
      c.send('{not json');
      assert.equal((await c.next('error')).code, 'bad_request');
      c.send({ type: 'nope' });
      assert.equal((await c.next('error')).code, 'bad_request');
      await c.close();
    } finally {
      await srv.stop();
      srv.cleanup();
    }
  });

  test('a frame over 2 MiB closes the connection with 1009', async () => {
    const srv = await startRelay();
    try {
      const c = await join(srv.url, { room: randomRoomId() });
      c.send({ type: 'send', cid: 'big', data: Buffer.alloc(2 * 1024 * 1024 + 1024).toString('base64') });
      const closed = await c.closed;
      assert.equal(closed.code, 1009);
    } finally {
      await srv.stop();
      srv.cleanup();
    }
  });

  test('connections per IP are capped', async () => {
    const srv = await startRelay({ tweak: (c) => { c.limits.maxConnsPerIp = 3; } });
    try {
      const open = [];
      for (let i = 0; i < 3; i++) open.push(await connect(srv.url));
      const extra = new Client(srv.url);
      await assert.rejects(extra.opened, /429/);
      await open[0].close();
      const again = await connect(srv.url);
      open.slice(1).concat(again).forEach((c) => c.ws.terminate());
    } finally {
      await srv.stop();
      srv.cleanup();
    }
  });

  test('X-Forwarded-For is used for the IP limit only with TRUST_PROXY', async () => {
    const srv = await startRelay({ env: { TRUST_PROXY: '1' }, tweak: (c) => { c.limits.maxConnsPerIp = 1; } });
    try {
      const a = await connect(srv.url, { headers: { 'x-forwarded-for': '198.51.100.1' } });
      const b = await connect(srv.url, { headers: { 'x-forwarded-for': '198.51.100.2' } });
      const c = new Client(srv.url, { headers: { 'x-forwarded-for': '198.51.100.1' } });
      await assert.rejects(c.opened, /429/);
      a.ws.terminate();
      b.ws.terminate();
    } finally {
      await srv.stop();
      srv.cleanup();
    }
  });

  test('a connection that never answers pings is dropped', async () => {
    const srv = await startRelay({ tweak: (c) => { c.timing.pingIntervalMs = 30; } });
    try {
      const c = await connect(srv.url, { autoPong: false });
      const closed = await Promise.race([c.closed, new Promise((r) => setTimeout(() => r(null), 2000))]);
      assert.ok(closed, 'server terminated the silent connection');
      for (let i = 0; i < 50 && srv.relay.connectionCount > 0; i++) await new Promise((r) => setTimeout(r, 20));
      assert.equal(srv.relay.connectionCount, 0);
    } finally {
      await srv.stop();
      srv.cleanup();
    }
  });

  test('a connection that answers pings stays open', async () => {
    const srv = await startRelay({ tweak: (c) => { c.timing.pingIntervalMs = 30; } });
    try {
      const c = await join(srv.url, { room: randomRoomId() });
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(c.ws.readyState, 1);
      await c.close();
    } finally {
      await srv.stop();
      srv.cleanup();
    }
  });
});

describe('hardening', () => {
  test('a socket that sends too much before auth is dropped', async () => {
    const srv = await startRelay();
    try {
      const c = await connect(srv.url);
      // Half of a 2 MiB frame: never a complete message, only buffered bytes.
      c.ws._socket.write(Buffer.concat([Buffer.from([0x81, 0xff]), Buffer.alloc(8), Buffer.alloc(64 * 1024, 0x61)]));
      await c.closed;
      assert.ok(true);
    } finally {
      await srv.stop();
      srv.cleanup();
    }
  });

  test('unauthenticated sockets have their own server-wide cap', async () => {
    const srv = await startRelay({ tweak: (c) => { c.limits.maxUnauthenticated = 2; } });
    try {
      const a = await connect(srv.url);
      const b = await connect(srv.url);
      const third = new Client(srv.url);
      await assert.rejects(third.opened);
      // Authenticating frees a slot.
      a.send({ type: 'auth', role: 'client', proof: await authProof(ACCESS_KEY, 'client', a.challenge.nonce), room: randomRoomId() });
      await a.next('ready');
      const fourth = await connect(srv.url);
      assert.equal(fourth.challenge.type, 'challenge');
      for (const c of [a, b, fourth]) c.ws.close();
    } finally {
      await srv.stop();
      srv.cleanup();
    }
  });

  test('joining beyond the loaded room cap is refused as busy', async () => {
    const srv = await startRelay({ tweak: (c) => { c.limits.maxLoadedRooms = 1; } });
    try {
      const first = await join(srv.url, { room: randomRoomId() });
      const c = await connect(srv.url);
      c.send({ type: 'auth', role: 'client', proof: await authProof(ACCESS_KEY, 'client', c.challenge.nonce), room: randomRoomId() });
      const err = await c.next('error');
      assert.equal(err.code, 'busy');
      await c.closed;
      first.ws.close();
    } finally {
      await srv.stop();
      srv.cleanup();
    }
  });
});

describe('startup', () => {
  const run = (env) =>
    execFileAsync(process.execPath, ['src/index.js'], { cwd: new URL('..', import.meta.url), env: { PATH: process.env.PATH, ...env }, timeout: 10_000 })
      .then(() => ({ code: 0, stderr: '' }))
      .catch((e) => ({ code: e.code, stderr: String(e.stderr) }));

  test('refuses to start without ACCESS_KEY', async () => {
    const r = await run({});
    assert.equal(r.code, 1);
    assert.match(r.stderr, /ACCESS_KEY is required/);
  });

  test('refuses to start with a short ACCESS_KEY and does not echo it', async () => {
    const r = await run({ ACCESS_KEY: 'short-secret' });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /too short/);
    assert.ok(!r.stderr.includes('short-secret'));
  });

  test('refuses an unreadable ACCESS_KEY_FILE', async () => {
    const r = await run({ ACCESS_KEY_FILE: '/definitely/not/here' });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /ACCESS_KEY_FILE/);
  });
});
