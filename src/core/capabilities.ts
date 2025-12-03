import type { ServerCapabilities } from '@modelcontextprotocol/sdk/types.js';

/**
 * Build server capabilities declaration.
 *
 * Capabilities tell the client what features this server supports:
 * - tools: Server can register and execute tools
 * - prompts: Server can provide prompt templates
 * - resources: Server can expose readable resources
 * - logging: Server can send log messages to client
 */
export function buildCapabilities(): ServerCapabilities {
  return {
    tools: {
      listChanged: true,
    },
    prompts: {
      listChanged: true,
    },
    resources: {
      listChanged: true,
      subscribe: true,
    },
    logging: {},
  };
}
