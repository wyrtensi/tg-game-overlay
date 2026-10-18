import { ConfigError, loadConfig } from './config.js';
import { createLogger } from './log.js';
import { createRelay } from './server.js';

let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  if (err instanceof ConfigError) {
    process.stderr.write(`configuration error: ${err.message}\n`);
    process.exit(1);
  }
  throw err;
}

const logger = createLogger();
const relay = createRelay(config, { logger });

try {
  await relay.start();
} catch (err) {
  logger.error('failed to start', { code: err.code ?? 'error' });
  process.exit(1);
}

let shuttingDown = false;
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutting down', { signal });
    try {
      await relay.stop();
    } finally {
      process.exit(0);
    }
  });
}
