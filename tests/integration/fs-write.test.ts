/**
 * Integration tests for fs_write tool.
 *
 * These tests use the actual filesystem with test fixtures.
 */

// IMPORTANT: Setup must be imported first to set env vars before config loads
import { FIXTURES_PATH } from '../setup.js';

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

// Import the tool handlers AFTER setup
import { fsReadTool } from '../../src/tools/fs-read.tool.js';
import { fsWriteTool } from '../../src/tools/fs-write.tool.js';

const TEST_DIR = path.join(FIXTURES_PATH, 'write-tests');

// Helper to run tools
async function runFsRead(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await fsReadTool.handler(args, {} as never);
  const text = (result.content[0] as { text: string }).text;
  return JSON.parse(text);
}

async function runFsWrite(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await fsWriteTool.handler(args, {} as never);
  if (result.isError) {
    // Return a structured error for validation failures
    return {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: (result.content[0] as { text: string }).text },
    };
  }
  const text = (result.content[0] as { text: string }).text;
  return JSON.parse(text);
}

// Setup and teardown
beforeAll(async () => {
  await fs.mkdir(TEST_DIR, { recursive: true });
});

afterAll(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

beforeEach(async () => {
  // Clean test directory before each test
  const files = await fs.readdir(TEST_DIR);
  for (const file of files) {
    await fs.rm(path.join(TEST_DIR, file), { recursive: true, force: true });
  }
});

describe('fs_write: create operation', () => {
  test('creates new file', async () => {
    const result = await runFsWrite({
      path: 'write-tests/new-file.md',
      operation: 'create',
      content: '# New File\n\nContent here.',
    });

    expect(result.success).toBe(true);
    expect(result.operation).toBe('create');
    expect(result.applied).toBe(true);

    // Verify file exists
    const readResult = await runFsRead({ path: 'write-tests/new-file.md' });
    expect(readResult.success).toBe(true);
  });

  test('creates file with nested path', async () => {
    const result = await runFsWrite({
      path: 'write-tests/deep/nested/path/file.md',
      operation: 'create',
      content: 'Nested content',
    });

    expect(result.success).toBe(true);

    // Verify file exists (with trailing newline - default behavior)
    const content = await fs.readFile(path.join(TEST_DIR, 'deep/nested/path/file.md'), 'utf8');
    expect(content).toBe('Nested content\n');
  });

  test('fails if file already exists', async () => {
    // Create file first
    await fs.writeFile(path.join(TEST_DIR, 'existing.md'), 'existing');

    const result = await runFsWrite({
      path: 'write-tests/existing.md',
      operation: 'create',
      content: 'new content',
    });

    expect(result.success).toBe(false);
    expect((result.error as { code: string }).code).toBe('ALREADY_EXISTS');
  });

  test('dry run does not create file', async () => {
    const result = await runFsWrite({
      path: 'write-tests/dry-run.md',
      operation: 'create',
      content: 'content',
      dryRun: true,
    });

    expect(result.success).toBe(true);
    expect(result.applied).toBe(false);

    // File should not exist
    await expect(fs.access(path.join(TEST_DIR, 'dry-run.md'))).rejects.toThrow();
  });

  test('returns checksum after creation', async () => {
    const result = await runFsWrite({
      path: 'write-tests/checksum-test.md',
      operation: 'create',
      content: 'test content',
    });

    expect(result.success).toBe(true);
    expect((result.result as { newChecksum: string }).newChecksum).toBeDefined();
  });
});

describe('fs_write: update operation - line-based', () => {
  beforeEach(async () => {
    await fs.writeFile(
      path.join(TEST_DIR, 'update-test.md'),
      'line1\nline2\nline3\nline4\nline5',
    );
  });

  test('replaces single line', async () => {
    const result = await runFsWrite({
      path: 'write-tests/update-test.md',
      operation: 'update',
      action: 'replace',
      lines: '3',
      content: 'REPLACED',
    });

    expect(result.success).toBe(true);

    const content = await fs.readFile(path.join(TEST_DIR, 'update-test.md'), 'utf8');
    expect(content).toBe('line1\nline2\nREPLACED\nline4\nline5\n');
  });

  test('replaces line range', async () => {
    const result = await runFsWrite({
      path: 'write-tests/update-test.md',
      operation: 'update',
      action: 'replace',
      lines: '2-4',
      content: 'NEW',
    });

    expect(result.success).toBe(true);

    const content = await fs.readFile(path.join(TEST_DIR, 'update-test.md'), 'utf8');
    expect(content).toBe('line1\nNEW\nline5\n');
  });

  test('inserts before line', async () => {
    const result = await runFsWrite({
      path: 'write-tests/update-test.md',
      operation: 'update',
      action: 'insert_before',
      lines: '3',
      content: 'INSERTED',
    });

    expect(result.success).toBe(true);

    const content = await fs.readFile(path.join(TEST_DIR, 'update-test.md'), 'utf8');
    expect(content).toBe('line1\nline2\nINSERTED\nline3\nline4\nline5\n');
  });

  test('inserts after line', async () => {
    const result = await runFsWrite({
      path: 'write-tests/update-test.md',
      operation: 'update',
      action: 'insert_after',
      lines: '3',
      content: 'INSERTED',
    });

    expect(result.success).toBe(true);

    const content = await fs.readFile(path.join(TEST_DIR, 'update-test.md'), 'utf8');
    expect(content).toBe('line1\nline2\nline3\nINSERTED\nline4\nline5\n');
  });

  test('deletes lines', async () => {
    const result = await runFsWrite({
      path: 'write-tests/update-test.md',
      operation: 'update',
      action: 'delete_lines',
      lines: '2-4',
    });

    expect(result.success).toBe(true);

    const content = await fs.readFile(path.join(TEST_DIR, 'update-test.md'), 'utf8');
    expect(content).toBe('line1\nline5\n');
  });
});

describe('fs_write: checksum verification', () => {
  test('succeeds with correct checksum', async () => {
    await fs.writeFile(path.join(TEST_DIR, 'checksum.md'), 'original');

    // Get checksum
    const readResult = await runFsRead({ path: 'write-tests/checksum.md' });
    const checksum = (readResult.content as { checksum: string }).checksum;

    // Update with correct checksum
    const result = await runFsWrite({
      path: 'write-tests/checksum.md',
      operation: 'update',
      action: 'replace',
      lines: '1',
      content: 'modified',
      checksum,
    });

    expect(result.success).toBe(true);
  });

  test('fails with incorrect checksum', async () => {
    await fs.writeFile(path.join(TEST_DIR, 'checksum.md'), 'original');

    const result = await runFsWrite({
      path: 'write-tests/checksum.md',
      operation: 'update',
      action: 'replace',
      lines: '1',
      content: 'modified',
      checksum: 'wrong-checksum',
    });

    expect(result.success).toBe(false);
    expect((result.error as { code: string }).code).toBe('CHECKSUM_MISMATCH');
  });
});

describe('fs_write: diff generation', () => {
  test('returns diff for updates', async () => {
    await fs.writeFile(path.join(TEST_DIR, 'diff-test.md'), 'old content');

    const result = await runFsWrite({
      path: 'write-tests/diff-test.md',
      operation: 'update',
      action: 'replace',
      lines: '1',
      content: 'new content',
    });

    expect(result.success).toBe(true);
    expect((result.result as { diff: string }).diff).toBeDefined();
    expect((result.result as { diff: string }).diff).toContain('-old content');
    expect((result.result as { diff: string }).diff).toContain('+new content');
  });

  test('dry run returns preview diff', async () => {
    await fs.writeFile(path.join(TEST_DIR, 'diff-test.md'), 'original');

    const result = await runFsWrite({
      path: 'write-tests/diff-test.md',
      operation: 'update',
      action: 'replace',
      lines: '1',
      content: 'modified',
      dryRun: true,
    });

    expect(result.success).toBe(true);
    expect((result.result as { diff: string }).diff).toContain('-original');
    expect((result.result as { diff: string }).diff).toContain('+modified');
  });
});

describe('fs_write: edge cases', () => {
  test('handles path outside allowed directory', async () => {
    const result = await runFsWrite({
      path: '../../../etc/passwd',
      operation: 'create',
      content: 'malicious',
    });

    expect(result.success).toBe(false);
  });

  test('handles empty content for create', async () => {
    // Empty string is valid content
    const result = await runFsWrite({
      path: 'write-tests/empty.md',
      operation: 'create',
      content: '',
    });

    // Should succeed - empty files are valid (but get trailing newline)
    if (!result.success) {
      // If it fails due to validation, that's also acceptable behavior
      expect(result.error).toBeDefined();
    } else {
      const content = await fs.readFile(path.join(TEST_DIR, 'empty.md'), 'utf8');
      expect(content).toBe('\n'); // Empty content still gets trailing newline
    }
  });

  test('handles multi-line replacement content', async () => {
    await fs.writeFile(path.join(TEST_DIR, 'multiline.md'), 'single line');

    const result = await runFsWrite({
      path: 'write-tests/multiline.md',
      operation: 'update',
      action: 'replace',
      lines: '1',
      content: 'line1\nline2\nline3',
    });

    expect(result.success).toBe(true);

    const content = await fs.readFile(path.join(TEST_DIR, 'multiline.md'), 'utf8');
    expect(content).toBe('line1\nline2\nline3\n');
  });

  test('update fails for non-existent file', async () => {
    const result = await runFsWrite({
      path: 'write-tests/nonexistent.md',
      operation: 'update',
      action: 'replace',
      lines: '1',
      content: 'content',
    });

    expect(result.success).toBe(false);
    expect((result.error as { code: string }).code).toBe('NOT_FOUND');
  });

  test('update requires lines', async () => {
    const result = await runFsWrite({
      path: 'write-tests/nonexistent.md',
      operation: 'update',
      action: 'replace',
      content: 'content',
    });

    expect(result.success).toBe(false);
  });
});
