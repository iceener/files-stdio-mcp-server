import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { config } from '../../src/config/env.js';
import { buildServer } from '../../src/core/mcp.js';

serveStdio(
  (context) =>
    buildServer(
      {
        name: config.NAME,
        version: config.VERSION,
        instructions: config.INSTRUCTIONS,
      },
      context.era,
    ),
  { legacy: 'reject', onerror: (error) => console.error(error.message) },
);
