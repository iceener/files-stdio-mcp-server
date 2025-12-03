import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { fsReadTool } from './fs-read.tool.js';
import { fsWriteTool } from './fs-write.tool.js';

/**
 * Get the underlying object schema from a ZodEffects (after .refine() or .transform())
 * Walks down the _def chain to find the ZodObject.
 */
function getBaseSchema(schema: unknown): unknown {
  let current = schema;
  // Walk down the chain of ZodEffects to find the base ZodObject
  while (current && typeof current === 'object' && '_def' in current) {
    const def = (current as { _def: { schema?: unknown } })._def;
    if ('schema' in def && def.schema) {
      current = def.schema;
    } else {
      break;
    }
  }
  return current;
}

/**
 * Register all tools with the MCP server.
 */
export function registerTools(server: McpServer): void {
  // fs_read - explore, read, search
  // Note: We use getBaseSchema() to get the base schema before refine() transforms
  const readBaseSchema = getBaseSchema(fsReadTool.inputSchema) as { shape: unknown };
  server.registerTool(
    fsReadTool.name,
    {
      description: fsReadTool.description,
      inputSchema: readBaseSchema.shape,
    },
    fsReadTool.handler,
  );

  // fs_write - create, update, delete
  const writeBaseSchema = getBaseSchema(fsWriteTool.inputSchema) as { shape: unknown };
  server.registerTool(
    fsWriteTool.name,
    {
      description: fsWriteTool.description,
      inputSchema: writeBaseSchema.shape,
    },
    fsWriteTool.handler,
  );
}

/**
 * Export tools for testing
 */
export const tools = {
  fsRead: fsReadTool,
  fsWrite: fsWriteTool,
};
