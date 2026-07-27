import { afterEach, describe, expect, test } from 'bun:test';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const repoRoot = path.resolve(import.meta.dir, '..');
const fixtureRoot = path.join(repoRoot, 'tests/fixtures');
const activeClients = new Set<Client>();

function entryCommand(entry: string): { command: string; args: string[] } {
  return entry.endsWith('.js')
    ? { command: 'node', args: [entry] }
    : { command: 'bun', args: ['run', entry] };
}

function createTransport(
  entry = process.env['MCP_TEST_ENTRY'] ?? 'src/index.ts',
): StdioClientTransport {
  return new StdioClientTransport({
    ...entryCommand(entry),
    cwd: repoRoot,
    env: {
      FS_ROOT: fixtureRoot,
      LOG_LEVEL: 'info',
    },
    stderr: 'pipe',
  });
}

async function connect(
  mode: 'modern' | 'legacy',
  entry?: string,
): Promise<{ client: Client; transport: StdioClientTransport; stderr: string[] }> {
  const stderr: string[] = [];
  const transport = createTransport(entry);
  transport.stderr?.on('data', (chunk) => stderr.push(String(chunk)));
  const client = new Client(
    { name: `files-test-${mode}`, version: '1.0.0' },
    mode === 'modern' ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : undefined,
  );
  await client.connect(transport);
  activeClients.add(client);
  return { client, transport, stderr };
}

afterEach(async () => {
  await Promise.all([...activeClients].map((client) => client.close()));
  activeClients.clear();
});

describe('MCP 2026-07-28 over stdio', () => {
  test('discovers exact primitives and calls through the official modern client', async () => {
    const { client, stderr } = await connect('modern');

    expect(client.getProtocolEra()).toBe('modern');
    expect(client.getNegotiatedProtocolVersion()).toBe('2026-07-28');
    expect(client.getServerCapabilities()).toMatchObject({
      tools: { listChanged: true },
      prompts: { listChanged: true },
      resources: { listChanged: true, subscribe: true },
    });
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
      'fs_read',
      'fs_search',
      'fs_write',
      'fs_manage',
    ]);
    expect((await client.listPrompts()).prompts).toEqual([]);
    expect((await client.listResources()).resources).toEqual([]);

    const result = await client.callTool({
      name: 'fs_read',
      arguments: { path: 'vault/notes/todo.md' },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      success: true,
      type: 'file',
      path: 'vault/notes/todo.md',
    });
    expect(stderr.join('')).toContain('MCP stdio server started');
  });

  test('serves a legacy initialize/list/call flow on one pinned instance', async () => {
    const { client } = await connect('legacy');

    expect(client.getProtocolEra()).toBe('legacy');
    expect(client.getNegotiatedProtocolVersion()).toBe('2025-11-25');
    expect(client.getServerCapabilities()).toMatchObject({
      tools: { listChanged: false },
      prompts: { listChanged: false },
      resources: { listChanged: false, subscribe: false },
    });
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
      'fs_read',
      'fs_search',
      'fs_write',
      'fs_manage',
    ]);
    const result = await client.callTool({
      name: 'fs_read',
      arguments: { path: 'vault/notes/todo.md', lines: '1-3' },
    });
    expect(result.structuredContent).toMatchObject({ success: true, type: 'file' });
  });

  test('closes the spawned stdio process cleanly', async () => {
    const { client, transport } = await connect('modern');
    expect(transport.pid).not.toBeNull();
    activeClients.delete(client);
    await client.close();
    expect(transport.pid).toBeNull();
  });

  test('reject mode refuses legacy while still accepting a modern opening', async () => {
    const rejectEntry = 'tests/fixtures/reject-server.ts';
    const legacyTransport = createTransport(rejectEntry);
    const legacyClient = new Client({ name: 'reject-legacy', version: '1.0.0' });
    await expect(legacyClient.connect(legacyTransport)).rejects.toThrow(/protocol version/i);
    await legacyTransport.close();

    const modern = await connect('modern', rejectEntry);
    expect(modern.client.getProtocolEra()).toBe('modern');
    expect((await modern.client.listTools()).tools).toHaveLength(4);
  });
});
