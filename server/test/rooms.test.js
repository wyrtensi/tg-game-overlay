import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { b64, join, randomRoomId, startRelay, tmpDir } from './helpers.js';

async function sendAndEcho(client, cid, text) {
  client.send({ type: 'send', cid, data: b64(text) });
  return client.next((f) => f.type === 'msg' && f.cid === cid);
}

describe('rooms', () => {
  test('broadcast reaches everyone in the room; cid only on the sender copy', async () => {
    const srv = await startRelay();
    try {
      const room = randomRoomId();
      const a = await join(srv.url, { room });
      const b = await join(srv.url, { room });
      a.send({ type: 'send', cid: 'one', data: b64('hello') });
      const own = await a.next('msg');
      const other = await b.next('msg');
      assert.equal(own.cid, 'one');
      assert.equal('cid' in other, false);
      assert.equal(own.seq, 1);
      assert.equal(other.seq, 1);
      assert.equal(own.data, b64('hello'));
      assert.equal(other.data, own.data);
      assert.equal(other.at, own.at);
      assert.ok(Math.abs(own.at - Date.now()) < 5000);
      const second = await sendAndEcho(b, 'two', 'again');
      assert.equal(second.seq, 2);
      assert.equal((await a.next('msg')).seq, 2);
      await a.close();
      await b.close();
    } finally {
      await srv.stop();
      srv.cleanup();
    }
  });

  test('rooms are isolated', async () => {
    const srv = await startRelay();
    try {
      const a = await join(srv.url, { room: randomRoomId() });
      const b = await join(srv.url, { room: randomRoomId() });
      await sendAndEcho(a, 'x', 'secret');
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(b.queue.length, 0);
      const late = await join(srv.url, { room: randomRoomId() });
      assert.deepEqual(late.ready.history, []);
      await a.close();
      await b.close();
      await late.close();
    } finally {
      await srv.stop();
      srv.cleanup();
    }
  });

  test('ready history honours since', async () => {
    const srv = await startRelay();
    try {
      const room = randomRoomId();
      const a = await join(srv.url, { room });
      for (let i = 1; i <= 5; i++) await sendAndEcho(a, `c${i}`, `m${i}`);

      const all = await join(srv.url, { room, since: null });
      assert.equal(all.ready.seq, 5);
      assert.deepEqual(all.ready.history.map((m) => m.seq), [1, 2, 3, 4, 5]);
      assert.deepEqual(Object.keys(all.ready.history[0]).sort(), ['at', 'data', 'seq']);

      const some = await join(srv.url, { room, since: 3 });
      assert.deepEqual(some.ready.history.map((m) => m.seq), [4, 5]);

      const none = await join(srv.url, { room, since: 5 });
      assert.deepEqual(none.ready.history, []);
      assert.equal(none.ready.seq, 5);

      // A since beyond the latest seq (server lost state) resyncs with everything.
      const ahead = await join(srv.url, { room, since: 99 });
      assert.equal(ahead.ready.history.length, 5);
      for (const c of [a, all, some, none, ahead]) await c.close();
    } finally {
      await srv.stop();
      srv.cleanup();
    }
  });

  test('ring buffer keeps the last 300 messages', async () => {
    const srv = await startRelay({ tweak: (c) => { c.limits.rateMax = 10_000; } });
    try {
      const room = randomRoomId();
      const a = await join(srv.url, { room });
      for (let i = 1; i <= 305; i++) a.send({ type: 'send', cid: `c${i}`, data: b64(`m${i}`) });
      await a.next((f) => f.type === 'msg' && f.seq === 305, 10_000);
      const b = await join(srv.url, { room });
      assert.equal(b.ready.seq, 305);
      assert.equal(b.ready.history.length, 300);
      assert.equal(b.ready.history[0].seq, 6);
      assert.equal(b.ready.history.at(-1).seq, 305);
      await a.close();
      await b.close();
    } finally {
      await srv.stop();
      srv.cleanup();
    }
  });

  test('room byte cap evicts the oldest messages but keeps the newest', async () => {
    const srv = await startRelay({ tweak: (c) => { c.limits.roomMaxBytes = 1000; } });
    try {
      const room = randomRoomId();
      const a = await join(srv.url, { room });
      const chunk = Buffer.alloc(300).toString('base64'); // 400 chars
      for (let i = 1; i <= 5; i++) {
        a.send({ type: 'send', cid: `d${i}`, data: chunk });
        await a.next((f) => f.cid === `d${i}`);
      }
      const b = await join(srv.url, { room });
      assert.equal(b.ready.history.length, 2);
      assert.equal(b.ready.history.at(-1).seq, 5);
      await a.close();
      await b.close();
    } finally {
      await srv.stop();
      srv.cleanup();
    }
  });
});

describe('persistence', () => {
  test('history and seq survive a restart; no temp files are left', async () => {
    const dataDir = tmpDir();
    const room = randomRoomId();
    let srv = await startRelay({ dataDir });
    const a = await join(srv.url, { room });
    for (let i = 1; i <= 3; i++) await sendAndEcho(a, `c${i}`, `m${i}`);
    await srv.stop();
    await a.closed;

    const files = fs.readdirSync(path.join(dataDir, 'rooms'));
    assert.deepEqual(files, [`${room}.json`]);

    srv = await startRelay({ dataDir });
    try {
      const b = await join(srv.url, { room });
      assert.equal(b.ready.seq, 3);
      assert.deepEqual(b.ready.history.map((m) => m.data), [b64('m1'), b64('m2'), b64('m3')]);
      const next = await sendAndEcho(b, 'c4', 'm4');
      assert.equal(next.seq, 4);
      await b.close();
    } finally {
      await srv.stop();
      srv.cleanup();
    }
  });

  test('a room with no connections is forgotten from memory but stays on disk', async () => {
    const srv = await startRelay();
    try {
      const room = randomRoomId();
      const a = await join(srv.url, { room });
      await sendAndEcho(a, 'c1', 'm1');
      await a.close();
      await new Promise((r) => setTimeout(r, 50));
      const file = path.join(srv.dataDir, 'rooms', `${room}.json`);
      assert.ok(fs.existsSync(file));
      const b = await join(srv.url, { room });
      assert.equal(b.ready.history.length, 1);
      await b.close();
    } finally {
      await srv.stop();
      srv.cleanup();
    }
  });

  test('messages older than 7 days are dropped and an emptied room file is deleted', async () => {
    const dataDir = tmpDir();
    const rooms = path.join(dataDir, 'rooms');
    fs.mkdirSync(rooms, { recursive: true });
    const day = 24 * 3600 * 1000;
    const mixed = randomRoomId();
    const stale = randomRoomId();
    const ancient = randomRoomId();
    const write = (id, seq, messages) => fs.writeFileSync(path.join(rooms, `${id}.json`), JSON.stringify({ v: 1, seq, messages }));
    write(mixed, 3, [
      { seq: 1, at: Date.now() - 8 * day, data: b64('old') },
      { seq: 2, at: Date.now() - 6 * day, data: b64('recent') },
      { seq: 3, at: Date.now() - 1000, data: b64('new') },
    ]);
    write(stale, 1, [{ seq: 1, at: Date.now() - 9 * day, data: b64('old') }]);
    write(ancient, 1, [{ seq: 1, at: Date.now() - 20 * day, data: b64('old') }]);
    const old = new Date(Date.now() - 20 * day);
    fs.utimesSync(path.join(rooms, `${ancient}.json`), old, old);

    const srv = await startRelay({ dataDir });
    try {
      // startup sweep removes files untouched for longer than the TTL
      assert.equal(fs.existsSync(path.join(rooms, `${ancient}.json`)), false);

      const a = await join(srv.url, { room: mixed });
      assert.deepEqual(a.ready.history.map((m) => m.seq), [2, 3]);
      assert.equal(a.ready.seq, 3);

      const b = await join(srv.url, { room: stale });
      assert.deepEqual(b.ready.history, []);
      await b.close();
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(fs.existsSync(path.join(rooms, `${stale}.json`)), false);
      await a.close();
    } finally {
      await srv.stop();
      srv.cleanup();
    }
  });

  test('a corrupt room file is set aside and the room starts empty', async () => {
    const dataDir = tmpDir();
    const rooms = path.join(dataDir, 'rooms');
    fs.mkdirSync(rooms, { recursive: true });
    const room = randomRoomId();
    fs.writeFileSync(path.join(rooms, `${room}.json`), '{ broken');
    const srv = await startRelay({ dataDir });
    try {
      const a = await join(srv.url, { room });
      assert.equal(a.ready.type, 'ready');
      assert.equal(a.ready.seq, 0);
      assert.ok(fs.existsSync(path.join(rooms, `${room}.json.corrupt`)));
      await a.close();
    } finally {
      await srv.stop();
      srv.cleanup();
    }
  });
});

describe('sequence numbers', () => {
  test('a room forgotten on disk restarts above any seq a client remembers', async () => {
    const dataDir = tmpDir();
    const room = randomRoomId();
    let srv = await startRelay({ dataDir, tweak: (c) => { c.seqStart = () => Date.now(); } });
    let a;
    try {
      a = await join(srv.url, { room });
      a.send({ type: 'send', cid: 'x', data: b64('first life') });
      const first = await a.next('msg');
      a.ws.close();
      await srv.stop();
      fs.rmSync(path.join(dataDir, 'rooms', `${room}.json`), { force: true });

      srv = await startRelay({ dataDir, tweak: (c) => { c.seqStart = () => Date.now(); } });
      const b = await join(srv.url, { room });
      b.send({ type: 'send', cid: 'y', data: b64('second life') });
      const second = await b.next('msg');
      assert.ok(second.seq > first.seq, `${second.seq} should exceed ${first.seq}`);
      // A client reconnecting with the old seq still receives the new message.
      const late = await join(srv.url, { room, since: first.seq });
      assert.deepEqual(late.ready.history.map((m) => m.seq), [second.seq]);
      for (const c of [b, late]) c.ws.close();
    } finally {
      await srv.stop();
      srv.cleanup();
    }
  });
});
