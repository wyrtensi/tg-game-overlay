import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { join, randomRoomId, startRelay } from './helpers.js';
import { packSlug } from '../src/stickers.js';

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

describe('stickers', () => {
  let srv;
  let admin;
  let client;
  before(async () => {
    srv = await startRelay();
    admin = await join(srv.url, { role: 'admin' });
    client = await join(srv.url, { room: randomRoomId() });
  });
  after(async () => {
    await admin.close();
    await client.close();
    await srv.stop();
    srv.cleanup();
  });

  const put = (pack, kind, bytes, emoji) =>
    admin.send({ type: 'sticker_put', pack, kind, emoji, b64: bytes.toString('base64') });

  test('admin ready has no history', () => {
    assert.equal(admin.ready.type, 'ready');
  });

  test('empty catalog', async () => {
    client.send({ type: 'stickers_index' });
    const idx = await client.next('stickers_index');
    assert.deepEqual(idx.packs, []);
    assert.match(idx.version, /^[0-9a-f]{64}$/);
  });

  test('put, duplicate put, index, get and delete', async () => {
    const bytes = Buffer.from('fake tgs sticker bytes');
    const id = sha(bytes);
    put('Cats', 'tgs', bytes, 'A');
    assert.deepEqual(await admin.next('sticker_put'), { type: 'sticker_put', id, created: true });
    assert.ok(fs.existsSync(path.join(srv.dataDir, 'stickers', `${id}.tgs`)));

    put('Other pack', 'tgs', bytes, 'B');
    assert.deepEqual(await admin.next('sticker_put'), { type: 'sticker_put', id, created: false });

    const second = Buffer.from('another sticker');
    put('Cats', 'webp', second);
    const id2 = (await admin.next('sticker_put')).id;
    assert.equal(id2, sha(second));

    client.send({ type: 'stickers_index' });
    const idx = await client.next('stickers_index');
    assert.equal(idx.packs.length, 1);
    assert.deepEqual(idx.packs[0], {
      id: 'cats',
      title: 'Cats',
      stickers: [
        { id, kind: 'tgs', emoji: 'A', size: bytes.length },
        { id: id2, kind: 'webp', size: second.length },
      ],
    });

    client.send({ type: 'sticker_get', id });
    const got = await client.next('sticker');
    assert.equal(got.id, id);
    assert.equal(got.kind, 'tgs');
    assert.deepEqual(Buffer.from(got.b64, 'base64'), bytes);
    assert.equal(sha(Buffer.from(got.b64, 'base64')), id);

    const before = idx.version;
    admin.send({ type: 'sticker_delete', id });
    assert.deepEqual(await admin.next('sticker_delete'), { type: 'sticker_delete', id, deleted: true });
    assert.equal(fs.existsSync(path.join(srv.dataDir, 'stickers', `${id}.tgs`)), false);

    client.send({ type: 'stickers_index' });
    const after = await client.next('stickers_index');
    assert.notEqual(after.version, before);
    assert.deepEqual(after.packs[0].stickers.map((s) => s.id), [id2]);

    client.send({ type: 'sticker_get', id });
    const err = await client.next('error');
    assert.deepEqual([err.code, err.id], ['not_found', id]);

    admin.send({ type: 'sticker_delete', id });
    assert.equal((await admin.next('error')).code, 'not_found');

    admin.send({ type: 'sticker_delete', id: id2 });
    await admin.next('sticker_delete');
    client.send({ type: 'stickers_index' });
    assert.deepEqual((await client.next('stickers_index')).packs, []);
  });

  test('the catalog survives a restart and the version is stable', async () => {
    const bytes = Buffer.from('persistent sticker');
    put('Keep', 'webm', bytes);
    const { id } = await admin.next('sticker_put');
    client.send({ type: 'stickers_index' });
    const first = await client.next('stickers_index');

    const other = await startRelay({ dataDir: srv.dataDir });
    try {
      const c = await join(other.url, { room: randomRoomId() });
      c.send({ type: 'stickers_index' });
      const idx = await c.next('stickers_index');
      assert.equal(idx.version, first.version);
      assert.equal(idx.packs[0].stickers[0].id, id);
      await c.close();
    } finally {
      await other.stop();
    }
    admin.send({ type: 'sticker_delete', id });
    await admin.next('sticker_delete');
  });

  test('a client cannot put or delete stickers', async () => {
    client.send({ type: 'sticker_put', pack: 'Evil', kind: 'tgs', b64: Buffer.from('x').toString('base64') });
    assert.equal((await client.next('error')).code, 'forbidden');
    client.send({ type: 'sticker_delete', id: 'a'.repeat(64) });
    assert.equal((await client.next('error')).code, 'forbidden');
    client.send({ type: 'stickers_index' });
    assert.deepEqual((await client.next('stickers_index')).packs, []);
  });

  test('an admin cannot send chat messages', async () => {
    admin.send({ type: 'send', cid: 'x', data: Buffer.from('hi').toString('base64') });
    const err = await admin.next('error');
    assert.deepEqual([err.code, err.cid], ['forbidden', 'x']);
  });

  test('validation: kind, size, emoji, base64, pack title, ids', async () => {
    const ok = Buffer.from('v').toString('base64');
    const cases = [
      [{ pack: 'P', kind: 'gif', b64: ok }, 'bad_request'],
      [{ pack: 'P', kind: 'tgs', b64: 'not base64!' }, 'bad_request'],
      [{ pack: 'P', kind: 'tgs' }, 'bad_request'],
      [{ pack: '', kind: 'tgs', b64: ok }, 'bad_request'],
      [{ kind: 'tgs', b64: ok }, 'bad_request'],
      [{ pack: 'P', kind: 'tgs', emoji: 'x'.repeat(40), b64: ok }, 'bad_request'],
      [{ pack: 'P', kind: 'tgs', emoji: 5, b64: ok }, 'bad_request'],
      [{ pack: 'P', kind: 'tgs', b64: Buffer.alloc(1024 * 1024 + 1).toString('base64') }, 'too_large'],
    ];
    for (const [fields, code] of cases) {
      admin.send({ type: 'sticker_put', ...fields });
      assert.equal((await admin.next('error')).code, code, JSON.stringify(Object.keys(fields)));
    }
    // exactly 1 MiB is fine
    put('Big', 'webm', Buffer.alloc(1024 * 1024, 7));
    const { id } = await admin.next('sticker_put');
    admin.send({ type: 'sticker_delete', id });
    await admin.next('sticker_delete');

    client.send({ type: 'sticker_get', id: 'nothex' });
    const bad = await client.next('error');
    assert.deepEqual([bad.code, bad.id], ['bad_request', 'nothex']);
    client.send({ type: 'sticker_get', id: 'b'.repeat(64) });
    const missing = await client.next('error');
    assert.deepEqual([missing.code, missing.id], ['not_found', 'b'.repeat(64)]);
  });

  test('Cyrillic and other non-ascii titles get a stable hash-based pack id', async () => {
    put('Привет', 'tgs', Buffer.from('ru1'));
    const { id: a } = await admin.next('sticker_put');
    put('Пока', 'tgs', Buffer.from('ru2'));
    const { id: b } = await admin.next('sticker_put');
    put('Привет', 'tgs', Buffer.from('ru3'));
    const { id: c } = await admin.next('sticker_put');
    client.send({ type: 'stickers_index' });
    const idx = await client.next('stickers_index');
    assert.equal(idx.packs.length, 2);
    for (const pack of idx.packs) assert.match(pack.id, /^[a-z0-9-]+$/);
    const privet = idx.packs.find((p) => p.title === 'Привет');
    assert.equal(privet.id, packSlug('Привет'));
    assert.deepEqual(privet.stickers.map((s) => s.id).sort(), [a, c].sort());
    for (const id of [a, b, c]) {
      admin.send({ type: 'sticker_delete', id });
      await admin.next('sticker_delete');
    }
  });
});

describe('packSlug', () => {
  test('ascii titles', () => {
    assert.equal(packSlug('Funny Cats 2!'), 'funny-cats-2');
    assert.equal(packSlug('  --a__b--  '), 'a-b');
  });
  test('non-ascii titles never collapse into an empty or colliding id', () => {
    assert.match(packSlug('Привет'), /^p-[0-9a-f]{8}$/);
    assert.notEqual(packSlug('Привет'), packSlug('Пока'));
    assert.match(packSlug('Кот cat'), /^cat-[0-9a-f]{8}$/);
    assert.notEqual(packSlug('Кот cat'), packSlug('cat'));
    assert.match(packSlug('!!!'), /^p-[0-9a-f]{8}$/);
  });
  test('accents are stripped', () => {
    assert.equal(packSlug('Café Noir'), 'cafe-noir');
  });
});
