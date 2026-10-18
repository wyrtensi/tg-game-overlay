import fs from 'node:fs';

export class ConfigError extends Error {}

const MIN_KEY_LENGTH = 16;

/**
 * Reads a secret from NAME or NAME_FILE. NAME wins when both are set.
 * Error messages mention variable names only, never values.
 */
function readSecret(env, name) {
  const direct = env[name];
  if (direct !== undefined && direct !== '') return direct;
  const file = env[`${name}_FILE`];
  if (file !== undefined && file !== '') {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (err) {
      throw new ConfigError(`${name}_FILE: cannot read ${file} (${err.code ?? 'error'})`);
    }
    return text.replace(/[\r\n]+$/, '');
  }
  return null;
}

function parsePort(value) {
  if (value === undefined || value === '') return 8790;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 65535) throw new ConfigError('PORT must be an integer between 0 and 65535');
  return n;
}

/**
 * Builds the server configuration from environment variables.
 * Throws ConfigError with a human readable message on invalid input.
 * @param {Record<string, string | undefined>} env
 */
export function loadConfig(env = process.env) {
  const accessKey = readSecret(env, 'ACCESS_KEY');
  if (accessKey === null) {
    throw new ConfigError('ACCESS_KEY is required (set ACCESS_KEY or ACCESS_KEY_FILE; at least 16 characters)');
  }
  if (accessKey.length < MIN_KEY_LENGTH) {
    throw new ConfigError(`ACCESS_KEY is too short: need at least ${MIN_KEY_LENGTH} characters`);
  }
  const adminKey = readSecret(env, 'ADMIN_KEY');
  if (adminKey !== null && adminKey.length < MIN_KEY_LENGTH) {
    throw new ConfigError(`ADMIN_KEY is too short: need at least ${MIN_KEY_LENGTH} characters`);
  }
  if (adminKey !== null && adminKey === accessKey) {
    throw new ConfigError('ADMIN_KEY must differ from ACCESS_KEY');
  }
  return {
    port: parsePort(env.PORT),
    host: env.HOST || '0.0.0.0',
    dataDir: env.DATA_DIR || '/data',
    accessKey,
    adminKey,
    trustProxy: /^(1|true|yes|on)$/i.test(env.TRUST_PROXY ?? ''),
    limits: {
      maxFrameBytes: 2 * 1024 * 1024,
      maxMessageData: 1_500_000, // base64 characters of one stored message
      maxStickerBytes: 1024 * 1024,
      roomHistory: 300,
      roomMaxBytes: 2_000_000, // total base64 characters kept per room
      messageTtlMs: 7 * 24 * 3600 * 1000,
      rateMax: 30,
      rateWindowMs: 10_000,
      maxConnsPerIp: 16,
      maxConns: 512,
      maxUnauthenticated: 64, // sockets that have not authenticated yet, server-wide
      preAuthMaxBytes: 16 * 1024, // bytes a socket may send before it authenticates
      maxLoadedRooms: 32, // rooms held in memory (rooms with a connection)
      maxRoomFiles: 500, // rooms persisted on disk
      stickerRateMax: 300, // sticker_get frames per rateWindowMs and connection
      maxBufferedBytes: 8 * 1024 * 1024,
    },
    timing: {
      authTimeoutMs: 10_000,
      authFailDelayMs: 1000,
      pingIntervalMs: 25_000,
      persistDebounceMs: 2000,
      sweepIntervalMs: 3600_000,
      statsIntervalMs: 60_000,
    },
  };
}
