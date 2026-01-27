import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Register prompts with the MCP server.
 *
 * Prompts are pre-defined templates that help users start common workflows.
 * This server currently has no prompts — tools are self-descriptive.
 *
 * To add a prompt, create a file like `explore.prompt.ts` and register it here:
 *
 * @example
 * import { explorePrompt } from './explore.prompt.js';
 *
 * export function registerPrompts(server: McpServer): void {
 *   server.registerPrompt(
 *     explorePrompt.name,
 *     { description: explorePrompt.description },
 *     explorePrompt.handler,
 *   );
 * }
 */
export function registerPrompts(_server: McpServer): void {
  // No prompts defined — tools are self-explanatory (fs_read, fs_search, fs_write, fs_manage)
}
