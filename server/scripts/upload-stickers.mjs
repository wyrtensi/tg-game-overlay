#!/usr/bin/env node
// Uploads a folder of stickers (*.tgs, *.webp, *.webm) to a relay server.
//
//   node scripts/upload-stickers.mjs --url ws://host:8790/ws \
//     --admin-key-file <path> --pack "Pack title" [--export <result.json>] \
//     [--dry-run] <folder>
//
// The admin key is read from --admin-key-file or the ADMIN_KEY environment
// variable and is never printed.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { WebSocket } from 'ws';

const KINDS = new Set(['tgs', 'webp', 'webm']);
const MAX_STICKER_BYTES = 1024 * 1024;
const MAX_EMOJI_LENGTH = 32;
const STEP_TIMEOUT_MS = 15_000;

const USAGE = `Usage: node scripts/upload-stickers.mjs --url ws://host:8790/ws --pack "Pack title" \\
         [--admin-key-file <path>] [--export <result.json>] [--dry-run] <folder>

  --url              relay WebSocket URL (required unless --dry-run)
  --admin-key-file   file holding ADMIN_KEY (or set the ADMIN_KEY environment variable)
  --pack             pack title (required)
  --export           Telegram Desktop chat export result.json, used only to map
                     sticker file names to emoji
  --dry-run          scan and report, connect to nothing
`;

function fail(message) {
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}

/** Reads sticker file name -> emoji from a Telegram Desktop export. Nothing else is kept. */
export function readEmojiMap(exportFile) {
  const data = JSON.parse(fs.readFileSync(exportFile, 'utf8'));
  const lists = [];
  if (Array.isArray(data?.messages)) lists.push(data.messages);
  if (Array.isArray(data?.chats?.list)) {
    for (const chat of data.chats.list) if (Array.isArray(chat?.messages)) lists.push(chat.messages);
  }
  const map = new Map();
  for (const messages of lists) {
    for (const m of messages) {
      if (m?.media_type !== 'sticker' || typeof m.file !== 'string' || typeof m.sticker_emoji !== 'string') continue;
      const emoji = m.sticker_emoji.trim();
      if (!emoji || emoji.length > MAX_EMOJI_LENGTH) continue;
      const name = path.posix.basename(m.file.replace(/\\/g, '/'));
      if (!map.has(name)) map.set(name, emoji);
    }
  }
  return map;
}

/** Lists uploadable files in a folder (non-recursive), de-duplicated by sha256. */
export function scanFolder(folder, emojiMap = new Map()) {
  const result = { items: [], skipped: [], duplicates: 0 };
  const seen = new Set();
  const names = fs.readdirSync(folder, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort();
  for (const name of names) {
    const ext = path.extname(name).slice(1).toLowerCase();
    if (/_thumb\.jpe?g$/i.test(name) || !KINDS.has(ext)) {
      result.skipped.push({ name, reason: 'not a sticker file' });
      continue;
    }
    const bytes = fs.readFileSync(path.join(folder, name));
    if (bytes.length === 0 || bytes.length > MAX_STICKER_BYTES) {
      result.skipped.push({ name, reason: bytes.length === 0 ? 'empty file' : 'larger than 1 MiB' });
      continue;
    }
    const id = crypto.createHash('sha256').update(bytes).digest('hex');
    if (seen.has(id)) {
      result.duplicates++;
      continue;
    }
    seen.add(id);
    result.items.push({ name, kind: ext, bytes, id, emoji: emojiMap.get(name) });
  }
  return result;
}

class AdminSession {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.pending = null;
    this.queue = [];
    this.ws.on('message', (raw) => {
      let frame;
      try {
        frame = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (this.pending) {
        const p = this.pending;
        this.pending = null;
        clearTimeout(p.timer);
        p.resolve(frame);
      } else {
        this.queue.push(frame);
      }
    });
    this.closed = new Promise((resolve) => {
      this.ws.on('close', () => {
        resolve();
        if (this.pending) {
          const p = this.pending;
          this.pending = null;
          clearTimeout(p.timer);
          p.reject(new Error('connection closed'));
        }
      });
    });
    this.ws.on('error', () => {});
  }

  /** Waits for the next frame from the server. */
  nextFrame() {
    if (this.queue.length > 0) return Promise.resolve(this.queue.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error('timed out waiting for the server'));
      }, STEP_TIMEOUT_MS);
      this.pending = { resolve, reject, timer };
    });
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', (err) => reject(new Error(`cannot connect: ${err.code ?? err.message}`)));
    });
  }
}

async function adminLogin(session, adminKey) {
  const challenge = await session.nextFrame();
  if (challenge.type !== 'challenge') throw new Error('unexpected reply from the server');
  const proof = crypto
    .createHmac('sha256', adminKey)
    .update(`tgo-relay-v1|auth|admin|${challenge.nonce}`)
    .digest('base64');
  const reply = session.nextFrame();
  session.ws.send(JSON.stringify({ type: 'auth', role: 'admin', proof }));
  const frame = await reply;
  if (frame.type === 'error') throw new Error(`authentication failed (${frame.code})`);
  if (frame.type !== 'ready') throw new Error('unexpected reply from the server');
}

async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        url: { type: 'string' },
        'admin-key-file': { type: 'string' },
        pack: { type: 'string' },
        export: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (err) {
    fail(`${err.message}\n\n${USAGE}`);
  }
  const { values, positionals } = parsed;
  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (positionals.length !== 1) fail(`expected exactly one folder\n\n${USAGE}`);
  if (!values.pack?.trim()) fail(`--pack is required\n\n${USAGE}`);
  const dryRun = values['dry-run'];
  if (!dryRun && !values.url) fail(`--url is required\n\n${USAGE}`);
  const folder = positionals[0];
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) fail('the folder does not exist');

  let adminKey = null;
  if (!dryRun) {
    if (values['admin-key-file']) {
      try {
        adminKey = fs.readFileSync(values['admin-key-file'], 'utf8').replace(/[\r\n]+$/, '');
      } catch (err) {
        fail(`cannot read the admin key file (${err.code ?? 'error'})`);
      }
    } else {
      adminKey = process.env.ADMIN_KEY || null;
    }
    if (!adminKey) fail('no admin key: use --admin-key-file or the ADMIN_KEY environment variable');
  }

  let emojiMap = new Map();
  if (values.export) {
    try {
      emojiMap = readEmojiMap(values.export);
    } catch (err) {
      fail(`cannot read the export file (${err.code ?? 'invalid JSON'})`);
    }
  }

  const scan = scanFolder(folder, emojiMap);
  const withEmoji = scan.items.filter((i) => i.emoji).length;
  process.stdout.write(
    `Found ${scan.items.length} unique stickers (${withEmoji} with emoji), ` +
      `${scan.duplicates} duplicates, ${scan.skipped.length} other files skipped.\n`,
  );

  const summary = { uploaded: 0, present: 0, failed: 0 };
  if (dryRun) {
    for (const item of scan.items) process.stdout.write(`  would upload ${item.name} (${item.kind}, ${item.bytes.length} bytes)\n`);
    process.stdout.write(`Dry run: nothing was sent. skipped: ${scan.skipped.length + scan.duplicates}\n`);
    return 0;
  }

  const session = new AdminSession(values.url);
  try {
    await session.open();
    await adminLogin(session, adminKey);
    for (const item of scan.items) {
      const reply = session.nextFrame();
      const frame = { type: 'sticker_put', pack: values.pack.trim(), kind: item.kind, b64: item.bytes.toString('base64') };
      if (item.emoji) frame.emoji = item.emoji;
      session.ws.send(JSON.stringify(frame));
      const r = await reply;
      if (r.type === 'sticker_put' && r.created) summary.uploaded++;
      else if (r.type === 'sticker_put') summary.present++;
      else {
        summary.failed++;
        process.stderr.write(`  failed ${item.name}: ${r.code ?? r.type}\n`);
      }
    }
  } catch (err) {
    process.stderr.write(`error: ${err.message}\n`);
    session.ws.terminate();
    return 1;
  }
  session.ws.close();
  await session.closed;

  process.stdout.write(
    `Summary: uploaded ${summary.uploaded}, already present ${summary.present}, ` +
      `skipped ${scan.skipped.length + scan.duplicates + summary.failed} ` +
      `(${scan.skipped.length} other files, ${scan.duplicates} duplicates, ${summary.failed} failed)\n`,
  );
  return summary.failed > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2));
}
