import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Register resources with the MCP server.
 *
 * Resources expose data via URIs that clients can read.
 * This server currently has no resources — filesystem access is via tools.
 *
 * Potential resources to add:
 * - `config://mounts` — list of available mount points
 * - `file:///{path}` — direct file access (alternative to fs_read)
 *
 * @example
 * import { mountsResource } from './mounts.resource.js';
 *
 * export function registerResources(server: McpServer): void {
 *   server.registerResource(
 *     mountsResource.uri,
 *     { name: mountsResource.name, mimeType: mountsResource.mimeType },
 *     mountsResource.handler,
 *   );
 * }
 */
export function registerResources(_server: McpServer): void {
  // No resources defined — filesystem access is via fs_read/fs_search/fs_write/fs_manage tools
}
