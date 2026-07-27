#!/usr/bin/env node

import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { config } from './config/env.js';
import { buildServer } from './core/mcp.js';
import { logger } from './utils/logger.js';

const handle = serveStdio(
  (context) =>
    buildServer(
      {
        name: config.NAME,
        version: config.VERSION,
        instructions: config.INSTRUCTIONS,
      },
      context.era,
    ),
  {
    legacy: 'serve',
    onerror: (error) => {
      logger.error('server', { message: 'MCP stdio transport error', error: error.message });
    },
  },
);

logger.info('server', {
  message: 'MCP stdio server started',
  name: config.NAME,
  version: config.VERSION,
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('server', { message: `Received ${signal}, shutting down` });
  await handle.close();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

process.on('uncaughtException', (error) => {
  logger.error('server', { message: 'Uncaught exception', error: error.message });
  void handle.close().finally(() => process.exit(1));
});

process.on('unhandledRejection', (reason) => {
  logger.error('server', {
    message: 'Unhandled rejection',
    error: reason instanceof Error ? reason.message : String(reason),
  });
  void handle.close().finally(() => process.exit(1));
});
