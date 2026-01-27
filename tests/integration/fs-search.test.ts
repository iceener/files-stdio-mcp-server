/**
 * Integration tests for fs_search tool.
 */

// IMPORTANT: Setup must be imported first to set env vars before config loads
import { describe, expect, test } from 'bun:test';

// Import the tool handler AFTER setup
import { fsSearchTool } from '../../src/tools/fs-search.tool.js';

async function runFsSearch(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await fsSearchTool.handler(args, {} as never);
  const text = (result.content[0] as { text: string }).text;
  return JSON.parse(text);
}

describe('fs_search: filename search', () => {
  test('finds file by exact name', async () => {
    const result = await runFsSearch({
      path: 'vault',
      query: 'todo.md',
      target: 'filename',
      depth: 10,
    });

    expect(result.success).toBe(true);
    const entries = result.results.byFilename as { path: string }[];
    expect(entries.some((e) => e.path.endsWith('todo.md'))).toBe(true);
  });

  test('filters by glob', async () => {
    const result = await runFsSearch({
      path: 'vault',
      query: 'md',
      target: 'filename',
      glob: '**/*.md',
      depth: 10,
    });

    expect(result.success).toBe(true);
    const entries = result.results.byFilename as { path: string }[];
    expect(entries.every((e) => e.path.endsWith('.md'))).toBe(true);
  });

  test('returns empty for no matches', async () => {
    const result = await runFsSearch({
      path: 'vault',
      query: 'nonexistent-file.xyz',
      target: 'filename',
      depth: 10,
    });

    expect(result.success).toBe(true);
    const entries = result.results.byFilename as unknown[];
    expect(entries.length).toBe(0);
  });
});

describe('fs_search: content search', () => {
  test('searches for literal query', async () => {
    const result = await runFsSearch({
      path: 'vault',
      query: 'keyword',
      target: 'content',
      depth: 10,
    });

    expect(result.success).toBe(true);
    expect((result.results.byContent as unknown[]).length).toBeGreaterThan(0);
  });

  test('searches with regex query', async () => {
    const result = await runFsSearch({
      path: 'vault',
      query: 'line\\s+\\d+',
      target: 'content',
      patternMode: 'regex',
      depth: 10,
    });

    expect(result.success).toBe(true);
  });

  test('returns context lines around matches', async () => {
    const result = await runFsSearch({
      path: 'vault',
      query: 'keyword',
      target: 'content',
      context: 3,
      depth: 10,
    });

    expect(result.success).toBe(true);
    const contentResults = result.results.byContent as { matches: { context: { before: string[]; after: string[] } }[] }[];
    if (contentResults.length > 0) {
      expect(contentResults[0]?.matches[0]?.context).toBeDefined();
    }
  });
});
