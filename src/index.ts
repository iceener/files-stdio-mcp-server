#!/usr/bin/env node
/**
 * MCP Stdio Server Entry Point
 *
 * This server communicates via stdin/stdout using the MCP protocol.
 * It's designed to be spawned by MCP clients like Claude Desktop, Cursor, etc.
 *
 * Usage:
 *   bun run src/index.ts
 *   node dist/index.js
 *
 * Environment variables:
 *   MCP_NAME        - Server name (default: mcp-stdio-server)
 *   MCP_VERSION     - Server version (default: 1.0.0)
 *   MCP_INSTRUCTIONS - Instructions for LLM
 *   LOG_LEVEL       - debug | info | warning | error (default: info)
 *   API_KEY         - Optional API key for external services
 *   API_URL         - Optional API base URL
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { config } from './config/env.js';
import { buildServer } from './core/mcp.js';
import { logger } from './utils/logger.js';

async function main(): Promise<void> {
  // Build the MCP server
  const server = buildServer({
    name: config.NAME,
    version: config.VERSION,
    instructions: config.INSTRUCTIONS,
  });

  // Create stdio transport (reads from stdin, writes to stdout)
  const transport = new StdioServerTransport();

  // Set up initialization callback - MCP notifications can only be sent AFTER
  // the client sends the 'initialized' notification (handshake complete)
  server.server.oninitialized = () => {
    logger.setServer(server);
    logger.info('server', {
      message: 'MCP stdio server started',
      name: config.NAME,
      version: config.VERSION,
    });
  };

  // Connect server to transport (starts listening, handshake happens async)
  await server.connect(transport);
}

// Graceful shutdown handlers
function shutdown(signal: string): void {
  logger.info('server', { message: `Received ${signal}, shutting down` });
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('server', { message: 'Uncaught exception', error: error.message });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('server', {
    message: 'Unhandled rejection',
    error: reason instanceof Error ? reason.message : String(reason),
  });
  process.exit(1);
});

// Start the server
main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
