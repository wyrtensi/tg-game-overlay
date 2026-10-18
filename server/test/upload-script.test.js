import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { promisify } from 'node:util';
import { ADMIN_KEY, join, randomRoomId, startRelay, tmpDir } from './helpers.js';
import zlib from 'node:zlib';

// Real TGS files are gzip; the server checks that they inflate within limits.
const STICKER_A = zlib.gzipSync(Buffer.from('{"v":"sticker-a"}'));

const execFileAsync = promisify(execFile);
const script = new URL('../scripts/upload-stickers.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function run(args, env = {}) {
  return execFileAsync(process.execPath, [script, ...args], { env: { PATH: process.env.PATH, ...env }, timeout: 20_000 })
    .then((r) => ({ code: 0, ...r }))
    .catch((e) => ({ code: e.code, stdout: String(e.stdout), stderr: String(e.stderr) }));
}

describe('upload-stickers script', () => {
  let srv;
  let folder;
  let work;
  let keyFile;
  let exportFile;
  before(async () => {
    srv = await startRelay();
    work = tmpDir('tgo-upload-');
    folder = path.join(work, 'stickers');
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'a.tgs'), STICKER_A);
    fs.writeFileSync(path.join(folder, 'a_copy.tgs'), STICKER_A); // duplicate bytes
    fs.writeFileSync(path.join(folder, 'b.webp'), 'sticker-b');
    fs.writeFileSync(path.join(folder, 'c.WEBM'), 'sticker-c');
    fs.writeFileSync(path.join(folder, 'a_thumb.jpg'), 'thumb');
    fs.writeFileSync(path.join(folder, 'notes.txt'), 'text');
    fs.mkdirSync(path.join(folder, 'nested'));
    fs.writeFileSync(path.join(folder, 'nested', 'd.tgs'), 'sticker-d'); // not recursive
    keyFile = path.join(work, 'admin.key');
    fs.writeFileSync(keyFile, `${ADMIN_KEY}\n`);
    exportFile = path.join(work, 'result.json');
    fs.writeFileSync(
      exportFile,
      JSON.stringify({
        name: 'Private chat',
        messages: [
          { id: 1, type: 'message', text: 'PRIVATE-CHAT-TEXT', from: 'Someone Private' },
          { id: 2, type: 'message', media_type: 'sticker', file: 'stickers/a.tgs', sticker_emoji: 'A', text: 'PRIVATE-CHAT-TEXT' },
          { id: 3, type: 'message', media_type: 'sticker', file: 'stickers/b.webp', sticker_emoji: 'B' },
        ],
      }),
    );
  });
  after(async () => {
    await srv.stop();
    srv.cleanup();
    fs.rmSync(work, { recursive: true, force: true });
  });

  test('dry run connects to nothing and prints no secrets or chat content', async () => {
    const r = await run(['--dry-run', '--pack', 'Test', '--export', exportFile, folder]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Found 3 unique stickers \(2 with emoji\), 1 duplicates, 2 other files skipped/);
    assert.ok(!r.stdout.includes('PRIVATE-CHAT-TEXT'));
    assert.ok(!r.stdout.includes('Someone Private'));
  });

  test('uploads unique stickers once, maps emoji, and reports a second run as present', async () => {
    const args = ['--url', srv.url, '--admin-key-file', keyFile, '--pack', 'Test pack', '--export', exportFile, folder];
    const first = await run(args);
    assert.equal(first.code, 0, first.stderr);
    assert.match(first.stdout, /uploaded 3, already present 0, skipped 3/);
    assert.ok(!first.stdout.includes(ADMIN_KEY) && !first.stderr.includes(ADMIN_KEY));

    const second = await run(args);
    assert.equal(second.code, 0, second.stderr);
    assert.match(second.stdout, /uploaded 0, already present 3/);

    const c = await join(srv.url, { room: randomRoomId() });
    c.send({ type: 'stickers_index' });
    const idx = await c.next('stickers_index');
    await c.close();
    assert.equal(idx.packs.length, 1);
    assert.equal(idx.packs[0].title, 'Test pack');
    const byId = new Map(idx.packs[0].stickers.map((s) => [s.id, s]));
    assert.equal(byId.size, 3);
    assert.deepEqual(byId.get(sha(STICKER_A)), { id: sha(STICKER_A), kind: 'tgs', emoji: 'A', size: STICKER_A.length });
    assert.equal(byId.get(sha(Buffer.from('sticker-b'))).emoji, 'B');
    assert.equal(byId.get(sha(Buffer.from('sticker-c'))).kind, 'webm');
    assert.equal('emoji' in byId.get(sha(Buffer.from('sticker-c'))), false);
  });

  test('the admin key may come from the environment', async () => {
    const r = await run(['--url', srv.url, '--pack', 'Test pack', folder], { ADMIN_KEY });
    assert.equal(r.code, 0, r.stderr);
  });

  test('a wrong key fails without printing it', async () => {
    const bad = path.join(work, 'bad.key');
    fs.writeFileSync(bad, 'wrong-admin-key-123456\n');
    const r = await run(['--url', srv.url, '--admin-key-file', bad, '--pack', 'Test', folder]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /authentication failed/);
    assert.ok(!r.stderr.includes('wrong-admin-key-123456'));
  });

  test('missing arguments are reported', async () => {
    assert.equal((await run(['--pack', 'x', folder])).code, 1);
    assert.equal((await run(['--url', srv.url, folder])).code, 1);
  });
});
