import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { base64ToBytes, decryptEnvelope, deriveRoomKeys, encryptEnvelope, normalizeRoomName } from './client-crypto.js';
import { join, startRelay } from './helpers.js';

describe('client-side crypto from PROTOCOL.md', () => {
  test('same room and password derive the same keys, anything else does not', async () => {
    const a = await deriveRoomKeys('  Game Night ', 'correct horse');
    const b = await deriveRoomKeys('game night', 'correct horse');
    const wrongPw = await deriveRoomKeys('game night', 'wrong horse', 1000);
    const wrongRoom = await deriveRoomKeys('game night 2', 'correct horse', 1000);
    assert.match(a.roomId, /^[0-9a-f]{64}$/);
    assert.equal(a.roomId, b.roomId);
    assert.notEqual(a.roomId, wrongPw.roomId);
    assert.notEqual(a.roomId, wrongRoom.roomId);

    const data = await encryptEnvelope(a, { v: 1, id: 'x', author: 'A', at: 1, t: 'text', text: 'hi' });
    assert.equal((await decryptEnvelope(b, data)).text, 'hi');
    assert.equal(await decryptEnvelope(wrongPw, data), null);
  });

  test('room names are normalized with NFC and lowercase', () => {
    assert.equal(normalizeRoomName(' ÉCOLE '), 'école');
  });

  test('padding: multiple of 256 plus iv and tag, at least one zero byte', async () => {
    const keys = await deriveRoomKeys('pad', 'pw', 1000);
    for (const n of [1, 100, 200]) {
      const env = { v: 1, t: 'text', text: 'a'.repeat(n) };
      const raw = base64ToBytes(await encryptEnvelope(keys, env));
      assert.equal((raw.length - 12 - 16) % 256, 0);
      assert.deepEqual(await decryptEnvelope(keys, await encryptEnvelope(keys, env)), env);
    }
    // plain length of exactly 256 must grow to 512 (at least one 0x00)
    const base = JSON.stringify({ t: '' }).length;
    const exact = { t: 'a'.repeat(256 - base) };
    assert.equal(JSON.stringify(exact).length, 256);
    assert.equal(base64ToBytes(await encryptEnvelope(keys, exact)).length, 12 + 512 + 16);
  });

  test('the room id is bound into the ciphertext (AAD)', async () => {
    const a = await deriveRoomKeys('aad', 'pw', 1000);
    const data = await encryptEnvelope(a, { v: 1, t: 'text', text: 'x' });
    assert.equal(await decryptEnvelope({ roomId: 'f'.repeat(64), encKey: a.encKey }, data), null);
  });

  test('an envelope round-trips through the server and is stored opaque', async () => {
    const srv = await startRelay();
    try {
      const keys = await deriveRoomKeys('Round Trip', 'a long enough password');
      const plaintext = 'the quick brown fox is definitely not stored in the clear';
      const envelope = { v: 1, id: crypto.randomUUID(), author: 'Alice', at: Date.now(), t: 'text', text: plaintext };

      const a = await join(srv.url, { room: keys.roomId });
      const b = await join(srv.url, { room: keys.roomId });
      a.send({ type: 'send', cid: 'rt', data: await encryptEnvelope(keys, envelope) });
      const echoed = await a.next('msg');
      const received = await b.next('msg');
      assert.equal(echoed.cid, 'rt');
      assert.deepEqual(await decryptEnvelope(keys, received.data), envelope);

      // A member with the wrong password lands in another room and sees nothing.
      const other = await deriveRoomKeys('Round Trip', 'a different password', 1000);
      const stranger = await join(srv.url, { room: other.roomId });
      assert.deepEqual(stranger.ready.history, []);

      await a.close();
      await b.close();
      await stranger.close();
      await srv.stop();

      const file = fs.readFileSync(path.join(srv.dataDir, 'rooms', `${keys.roomId}.json`), 'utf8');
      assert.ok(!file.includes(plaintext));
      assert.ok(!file.includes('Alice'));
      assert.ok(!Buffer.from(JSON.parse(file).messages[0].data, 'base64').includes(plaintext));
      assert.ok(file.includes(received.data));
    } finally {
      srv.cleanup();
    }
  });
});
