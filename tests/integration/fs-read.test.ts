/**
 * Integration tests for fs_read tool.
 *
 * These tests use the actual filesystem with test fixtures.
 */

// IMPORTANT: Setup must be imported first to set env vars before config loads
import { FIXTURES_PATH } from '../setup.js';

import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

// Import the tool handler AFTER setup
import { fsReadTool } from '../../src/tools/fs-read.tool.js';

// Helper to run the tool and parse result
async function runFsRead(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await fsReadTool.handler(args, {} as never);
  const text = (result.content[0] as { text: string }).text;
  return JSON.parse(text);
}

describe('fs_read: directory listing', () => {
  test('lists root directory', async () => {
    const result = await runFsRead({ path: '.' });

    expect(result.success).toBe(true);
    expect(result.type).toBe('directory');
    expect(result.tree).toBeDefined();
  });

  test('lists subdirectory', async () => {
    const result = await runFsRead({ path: 'vault' });

    expect(result.success).toBe(true);
    expect(result.type).toBe('directory');
    expect((result.tree as { entries: unknown[] }).entries.length).toBeGreaterThan(0);
  });

  test('respects depth parameter', async () => {
    const shallow = await runFsRead({ path: 'vault', depth: 1 });
    const deep = await runFsRead({ path: 'vault', depth: 5 });

    const shallowEntries = (shallow.tree as { entries: unknown[] }).entries;
    const deepEntries = (deep.tree as { entries: unknown[] }).entries;

    // Deep should have more or equal entries
    expect(deepEntries.length).toBeGreaterThanOrEqual(shallowEntries.length);
  });

  test('returns error for non-existent path', async () => {
    const result = await runFsRead({ path: 'nonexistent' });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe('fs_read: file reading', () => {
  test('reads file content with line numbers', async () => {
    const result = await runFsRead({ path: 'vault/notes/todo.md' });

    expect(result.success).toBe(true);
    expect(result.type).toBe('file');
    expect(result.content).toBeDefined();

    const content = result.content as { text: string; checksum: string; totalLines: number };
    expect(content.text).toContain('1|');
    expect(content.checksum).toBeDefined();
    expect(content.totalLines).toBeGreaterThan(0);
  });

  test('reads specific line range', async () => {
    const result = await runFsRead({ path: 'vault/notes/todo.md', lines: '1-5' });

    expect(result.success).toBe(true);
    const content = result.content as { range: { start: number; end: number } };
    expect(content.range).toBeDefined();
    expect(content.range.start).toBe(1);
    expect(content.range.end).toBe(5);
  });

  test('returns checksum for file integrity', async () => {
    const result1 = await runFsRead({ path: 'vault/notes/todo.md' });
    const result2 = await runFsRead({ path: 'vault/notes/todo.md' });

    const checksum1 = (result1.content as { checksum: string }).checksum;
    const checksum2 = (result2.content as { checksum: string }).checksum;

    expect(checksum1).toBe(checksum2);
  });
});

describe('fs_read: find files', () => {
  test('finds file by exact name', async () => {
    const result = await runFsRead({ path: 'vault', find: 'todo.md', depth: 10 });

    expect(result.success).toBe(true);
    const entries = (result.tree as { entries: { path: string }[] }).entries;
    expect(entries.some((e) => e.path.endsWith('todo.md'))).toBe(true);
  });

  test('finds files by wildcard pattern', async () => {
    const result = await runFsRead({ path: 'vault', find: '*.md', depth: 10 });

    expect(result.success).toBe(true);
    const entries = (result.tree as { entries: { path: string }[] }).entries;
    expect(entries.every((e) => e.path.endsWith('.md'))).toBe(true);
  });

  test('returns empty for no matches', async () => {
    const result = await runFsRead({ path: 'vault', find: 'nonexistent-file.xyz', depth: 10 });

    expect(result.success).toBe(true);
    const entries = (result.tree as { entries: unknown[] }).entries;
    expect(entries.length).toBe(0);
  });
});

describe('fs_read: content search', () => {
  test('searches for literal pattern', async () => {
    const result = await runFsRead({
      path: 'vault',
      pattern: 'keyword',
      depth: 10,
    });

    expect(result.success).toBe(true);
    expect(result.type).toBe('search');
    expect((result.matches as unknown[]).length).toBeGreaterThan(0);
  });

  test('searches with regex pattern', async () => {
    // Search for something we know exists in the fixtures
    const result = await runFsRead({
      path: 'vault',
      pattern: 'line\\s+\\d+',
      patternMode: 'regex',
      depth: 10,
    });

    expect(result.success).toBe(true);
    // Regex should find "line 2", "line 3" etc in journal files
  });

  test('returns context lines around matches', async () => {
    const result = await runFsRead({
      path: 'vault',
      pattern: 'keyword',
      context: 3,
      depth: 10,
    });

    expect(result.success).toBe(true);
    const matches = result.matches as { context: { before: string[]; after: string[] } }[];
    if (matches.length > 0) {
      expect(matches[0]?.context).toBeDefined();
    }
  });

  test('respects output mode: summary', async () => {
    const result = await runFsRead({
      path: 'vault',
      pattern: 'the',
      output: 'summary',
      depth: 10,
    });

    expect(result.success).toBe(true);
    expect(result.stats).toBeDefined();
  });

  test('respects output mode: count', async () => {
    const result = await runFsRead({
      path: 'vault',
      pattern: 'the',
      output: 'count',
      depth: 10,
    });

    expect(result.success).toBe(true);
    expect(result.matchCount).toBeDefined();
  });
});

describe('fs_read: pattern modes', () => {
  test('literal mode escapes special characters', async () => {
    // Create a file with special chars for this test
    const testFile = path.join(FIXTURES_PATH, 'vault/test-special.md');
    await fs.writeFile(testFile, 'Price: $100.00 (USD)');

    try {
      const result = await runFsRead({
        path: 'vault/test-special.md',
        pattern: '$100.00',
        patternMode: 'literal',
      });

      expect(result.success).toBe(true);
      expect((result.matches as unknown[]).length).toBe(1);
    } finally {
      await fs.unlink(testFile);
    }
  });

  test('whole word matching', async () => {
    const result = await runFsRead({
      path: 'vault/programming/javascript.md',
      pattern: 'const',
      wholeWord: true,
    });

    expect(result.success).toBe(true);
    // Should match "const" but not if it were part of another word
  });
});

describe('fs_read: edge cases', () => {
  test('handles path outside allowed directory', async () => {
    const result = await runFsRead({ path: '../../../etc/passwd' });

    expect(result.success).toBe(false);
    expect((result.error as { code: string }).code).toBeDefined();
  });

  test('handles empty directory', async () => {
    const emptyDir = path.join(FIXTURES_PATH, 'empty-test');
    await fs.mkdir(emptyDir, { recursive: true });

    try {
      const result = await runFsRead({ path: 'empty-test' });
      expect(result.success).toBe(true);
      expect((result.tree as { entries: unknown[] }).entries.length).toBe(0);
    } finally {
      await fs.rmdir(emptyDir);
    }
  });

  test('handles binary file gracefully', async () => {
    const binaryFile = path.join(FIXTURES_PATH, 'vault/test.bin');
    await fs.writeFile(binaryFile, Buffer.from([0x00, 0x01, 0x02]));

    try {
      const result = await runFsRead({ path: 'vault/test.bin' });
      expect(result.success).toBe(false);
      expect((result.error as { code: string }).code).toBe('NOT_TEXT');
    } finally {
      await fs.unlink(binaryFile);
    }
  });
});

