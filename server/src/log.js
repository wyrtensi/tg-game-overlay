/**
 * Minimal structured logger: one JSON object per line on stdout.
 * Callers must never pass secrets or message data.
 */
export function createLogger(out = process.stdout) {
  const write = (level, msg, fields) => {
    out.write(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }) + '\n');
  };
  return {
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
  };
}

export const silentLogger = { info() {}, warn() {}, error() {} };
