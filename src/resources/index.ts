import type { McpServer } from '@modelcontextprotocol/server';

/** This server intentionally exposes filesystem access only through tools. */
export function registerResources(_server: McpServer): void {}
