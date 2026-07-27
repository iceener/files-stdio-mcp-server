import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import {
  fsManageOutputSchema,
  fsReadOutputSchema,
  fsSearchOutputSchema,
  fsWriteOutputSchema,
} from '../schemas/outputs.js';
import { fsManageTool } from './fs-manage.tool.js';
import { fsReadTool } from './fs-read.tool.js';
import { fsSearchTool } from './fs-search.tool.js';
import { fsWriteTool } from './fs-write.tool.js';

/** Add v2 structured output without changing the preserved filesystem handlers. */
function addStructuredContent(result: CallToolResult): CallToolResult {
  if (result.isError || result.structuredContent !== undefined) return result;

  const text = result.content.find(
    (item): item is Extract<(typeof result.content)[number], { type: 'text' }> =>
      item.type === 'text',
  )?.text;
  if (text === undefined) return result;

  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return result;
    return { ...result, structuredContent: parsed as Record<string, unknown> };
  } catch {
    return result;
  }
}

/** Register filesystem tools in their established discovery order. */
export function registerTools(server: McpServer): void {
  server.registerTool(
    fsReadTool.name,
    {
      description: fsReadTool.description,
      inputSchema: fsReadTool.inputSchema,
      outputSchema: fsReadOutputSchema,
    },
    async (args, context) => addStructuredContent(await fsReadTool.handler(args, context)),
  );

  server.registerTool(
    fsSearchTool.name,
    {
      description: fsSearchTool.description,
      inputSchema: fsSearchTool.inputSchema,
      outputSchema: fsSearchOutputSchema,
    },
    async (args, context) => addStructuredContent(await fsSearchTool.handler(args, context)),
  );

  server.registerTool(
    fsWriteTool.name,
    {
      description: fsWriteTool.description,
      inputSchema: fsWriteTool.inputSchema,
      outputSchema: fsWriteOutputSchema,
    },
    async (args, context) => addStructuredContent(await fsWriteTool.handler(args, context)),
  );

  server.registerTool(
    fsManageTool.name,
    {
      description: fsManageTool.description,
      inputSchema: fsManageTool.inputSchema,
      outputSchema: fsManageOutputSchema,
    },
    async (args, context) => addStructuredContent(await fsManageTool.handler(args, context)),
  );
}

export const tools = {
  fsRead: fsReadTool,
  fsSearch: fsSearchTool,
  fsWrite: fsWriteTool,
  fsManage: fsManageTool,
};
