import type { ProtocolEra, ServerCapabilities } from '@modelcontextprotocol/server';

/** Build capabilities appropriate for the connection's negotiated protocol era. */
export function buildCapabilities(era: ProtocolEra): ServerCapabilities {
  const changeStreams = era === 'modern';
  return {
    tools: { listChanged: changeStreams },
    prompts: { listChanged: changeStreams },
    resources: {
      listChanged: changeStreams,
      subscribe: changeStreams,
    },
  };
}
