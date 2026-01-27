/**
 * Integration tests for fs_manage tool.
 */

// IMPORTANT: Setup must be imported first to set env vars before config loads
import { FIXTURES_PATH } from '../setup.js';

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { fsManageTool } from '../../src/tools/fs-manage.tool.js';

const TEST_DIR = path.join(FIXTURES_PATH, 'manage-tests');

async function runFsManage(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await fsManageTool.handler(args, {} as never);
  if (result.isError) {
    return {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: (result.content[0] as { text: string }).text },
    };
  }
  const text = (result.content[0] as { text: string }).text;
  return JSON.parse(text);
}

beforeAll(async () => {
  await fs.mkdir(TEST_DIR, { recursive: true });
});

afterAll(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

beforeEach(async () => {
  const files = await fs.readdir(TEST_DIR);
  for (const file of files) {
    await fs.rm(path.join(TEST_DIR, file), { recursive: true, force: true });
  }
});

describe('fs_manage: mkdir and stat', () => {
  test('creates directory recursively', async () => {
    const result = await runFsManage({
      operation: 'mkdir',
      path: 'manage-tests/nested/dir',
      recursive: true,
    });

    expect(result.success).toBe(true);
    const stat = await fs.stat(path.join(TEST_DIR, 'nested/dir'));
    expect(stat.isDirectory()).toBe(true);
  });

  test('returns stat for file', async () => {
    await fs.writeFile(path.join(TEST_DIR, 'file.txt'), 'content');

    const result = await runFsManage({
      operation: 'stat',
      path: 'manage-tests/file.txt',
    });

    expect(result.success).toBe(true);
    expect((result.stat as { isDirectory: boolean }).isDirectory).toBe(false);
  });
});

describe('fs_manage: rename, move, copy, delete', () => {
  test('renames a file', async () => {
    await fs.writeFile(path.join(TEST_DIR, 'old.txt'), 'content');

    const result = await runFsManage({
      operation: 'rename',
      path: 'manage-tests/old.txt',
      target: 'manage-tests/new.txt',
    });

    expect(result.success).toBe(true);
    const exists = await fs.access(path.join(TEST_DIR, 'new.txt')).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  test('moves a file', async () => {
    await fs.writeFile(path.join(TEST_DIR, 'move-me.txt'), 'content');
    await fs.mkdir(path.join(TEST_DIR, 'dest'), { recursive: true });

    const result = await runFsManage({
      operation: 'move',
      path: 'manage-tests/move-me.txt',
      target: 'manage-tests/dest/move-me.txt',
    });

    expect(result.success).toBe(true);
    const exists = await fs.access(path.join(TEST_DIR, 'dest/move-me.txt')).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  test('copies a file', async () => {
    await fs.writeFile(path.join(TEST_DIR, 'copy-me.txt'), 'content');

    const result = await runFsManage({
      operation: 'copy',
      path: 'manage-tests/copy-me.txt',
      target: 'manage-tests/copy-me-copy.txt',
    });

    expect(result.success).toBe(true);
    const content = await fs.readFile(path.join(TEST_DIR, 'copy-me-copy.txt'), 'utf8');
    expect(content).toBe('content');
  });

  test('deletes a file', async () => {
    await fs.writeFile(path.join(TEST_DIR, 'delete-me.txt'), 'content');

    const result = await runFsManage({
      operation: 'delete',
      path: 'manage-tests/delete-me.txt',
    });

    expect(result.success).toBe(true);
    const exists = await fs.access(path.join(TEST_DIR, 'delete-me.txt')).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });

  test('deletes a directory recursively', async () => {
    await fs.mkdir(path.join(TEST_DIR, 'dir'), { recursive: true });
    await fs.writeFile(path.join(TEST_DIR, 'dir/file.txt'), 'content');

    const result = await runFsManage({
      operation: 'delete',
      path: 'manage-tests/dir',
      recursive: true,
    });

    expect(result.success).toBe(true);
    const exists = await fs.access(path.join(TEST_DIR, 'dir')).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });
});
