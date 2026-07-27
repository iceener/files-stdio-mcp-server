import { McpServer, type ProtocolEra } from '@modelcontextprotocol/server';
import { config } from '../config/env.js';
import { registerPrompts } from '../prompts/index.js';
import { registerResources } from '../resources/index.js';
import { registerTools } from '../tools/index.js';
import { buildCapabilities } from './capabilities.js';

export interface ServerOptions {
  name: string;
  version: string;
  instructions?: string;
}

/** Build the server instance that will be pinned to one stdio connection. */
export function buildServer(options: ServerOptions, era: ProtocolEra = 'legacy'): McpServer {
  const server = new McpServer(
    { name: options.name, version: options.version },
    {
      capabilities: buildCapabilities(era),
      instructions: options.instructions ?? config.INSTRUCTIONS,
    },
  );

  registerTools(server);
  registerPrompts(server);
  registerResources(server);
  return server;
}
