/**
 * Helper functions for sending MCP notifications.
 *
 * These helpers make it easy to notify clients when lists change,
 * which allows clients to refresh their cached data.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Notify clients that the tool list has changed.
 *
 * Call this when tools are dynamically added or removed.
 * Clients will re-fetch the tool list.
 *
 * @example
 * // After dynamically registering a new tool
 * server.registerTool('new_tool', {...}, handler);
 * await sendToolListChanged(server);
 */
export async function sendToolListChanged(server: McpServer): Promise<void> {
  try {
    await server.server.sendToolListChanged();
  } catch {
    // Ignore errors - client may not support notifications
  }
}

/**
 * Notify clients that the resource list has changed.
 *
 * Call this when resources are dynamically added or removed.
 * Clients will re-fetch the resource list.
 *
 * @example
 * // After adding a new file resource
 * await sendResourceListChanged(server);
 */
export async function sendResourceListChanged(server: McpServer): Promise<void> {
  try {
    await server.server.sendResourceListChanged();
  } catch {
    // Ignore errors - client may not support notifications
  }
}

/**
 * Notify clients that a specific resource has been updated.
 *
 * Call this when a subscribed resource's content changes.
 * Clients that have subscribed to this resource will re-fetch it.
 *
 * @param server - MCP server instance
 * @param uri - URI of the updated resource
 *
 * @example
 * // After updating the config
 * config.logLevel = 'debug';
 * await sendResourceUpdated(server, 'config://server');
 */
export async function sendResourceUpdated(server: McpServer, uri: string): Promise<void> {
  try {
    await server.server.sendResourceUpdated({ uri });
  } catch {
    // Ignore errors - client may not support notifications
  }
}

/**
 * Notify clients that the prompt list has changed.
 *
 * Call this when prompts are dynamically added or removed.
 * Clients will re-fetch the prompt list.
 *
 * @example
 * // After adding a new prompt template
 * await sendPromptListChanged(server);
 */
export async function sendPromptListChanged(server: McpServer): Promise<void> {
  try {
    await server.server.sendPromptListChanged();
  } catch {
    // Ignore errors - client may not support notifications
  }
}
