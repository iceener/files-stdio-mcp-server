/**
 * Tests for Obsidian-like knowledge base patterns using fs_search.
 */

import { FIXTURES_PATH } from '../setup.js';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { fsSearchTool } from '../../src/tools/fs-search.tool.js';

const KNOWLEDGE_FILE = 'vault/knowledge/programming-notes.md';
const TEST_DIR = path.join(FIXTURES_PATH, 'obsidian-tests');

async function runFsSearch(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await fsSearchTool.handler(args, {} as never);
  const text = (result.content[0] as { text: string }).text;
  return JSON.parse(text);
}

beforeAll(async () => {
  await fs.mkdir(TEST_DIR, { recursive: true });
});

afterAll(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────
// Wikilink Patterns
// ─────────────────────────────────────────────────────────────

describe('Obsidian: Wikilinks', () => {
  test('finds all wikilinks in a file', async () => {
    const result = await runFsSearch({
      path: KNOWLEDGE_FILE,
      query: '\\[\\[([^\\]|]+)(\\|[^\\]]+)?\\]\\]',
      patternMode: 'regex',
      target: 'content',
    });

    expect(result.success).toBe(true);
    expect(result.stats.contentMatches).toBeGreaterThanOrEqual(5);
  });

  test('finds wikilinks with display text', async () => {
    const result = await runFsSearch({
      path: KNOWLEDGE_FILE,
      query: '\\[\\[[^\\]]+\\|[^\\]]+\\]\\]',
      patternMode: 'regex',
      target: 'content',
    });

    expect(result.success).toBe(true);
    expect(result.stats.contentMatches).toBeGreaterThan(0);
  });

  test('finds links to specific note', async () => {
    const result = await runFsSearch({
      path: KNOWLEDGE_FILE,
      query: '\\[\\[.*Alice.*\\]\\]',
      patternMode: 'regex',
      target: 'content',
    });

    expect(result.success).toBe(true);
    expect(result.stats.contentMatches).toBeGreaterThan(0);
  });

  test('finds heading links', async () => {
    const result = await runFsSearch({
      path: KNOWLEDGE_FILE,
      query: '\\[\\[[^\\]]+#[^\\]]+\\]\\]',
      patternMode: 'regex',
      target: 'content',
    });

    expect(result.success).toBe(true);
    expect(result.stats.contentMatches).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────
// Tag Patterns
// ─────────────────────────────────────────────────────────────

describe('Obsidian: Tags', () => {
  test('finds all inline tags', async () => {
    const result = await runFsSearch({
      path: KNOWLEDGE_FILE,
      query: '#[a-zA-Z][\\w/-]*',
      patternMode: 'regex',
      target: 'content',
    });

    expect(result.success).toBe(true);
    expect(result.stats.contentMatches).toBeGreaterThan(3);
  });

  test('finds nested tags', async () => {
    const result = await runFsSearch({
      path: 'vault',
      query: '#\\w+/\\w+',
      patternMode: 'regex',
      target: 'content',
      depth: 10,
    });

    expect(result.success).toBe(true);
  });

  test('searches for files with specific tag', async () => {
    const result = await runFsSearch({
      path: 'vault',
      query: '#learning',
      target: 'content',
      depth: 10,
    });

    expect(result.success).toBe(true);
    expect(result.stats.contentMatches).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────
// Frontmatter Patterns
// ─────────────────────────────────────────────────────────────

describe('Obsidian: Frontmatter', () => {
  test('finds frontmatter delimiters', async () => {
    const result = await runFsSearch({
      path: KNOWLEDGE_FILE,
      query: '---',
      patternMode: 'literal',
      target: 'content',
    });

    expect(result.success).toBe(true);
    expect(result.stats.contentMatches).toBeGreaterThanOrEqual(2);
  });

  test('finds specific frontmatter field', async () => {
    const result = await runFsSearch({
      path: KNOWLEDGE_FILE,
      query: 'title:\\s*.+',
      patternMode: 'regex',
      target: 'content',
    });

    expect(result.success).toBe(true);
    expect(result.stats.contentMatches).toBeGreaterThan(0);
  });

  test('finds files with specific frontmatter tag', async () => {
    const result = await runFsSearch({
      path: 'vault',
      query: 'tags:[\\s\\S]*?programming',
      patternMode: 'regex',
      multiline: true,
      target: 'content',
      depth: 10,
    });

    expect(result.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// Task/TODO Patterns
// ─────────────────────────────────────────────────────────────

describe('Obsidian: Tasks', () => {
  test('finds incomplete tasks', async () => {
    const result = await runFsSearch({
      path: KNOWLEDGE_FILE,
      query: '- \\[ \\] .+',
      patternMode: 'regex',
      target: 'content',
    });

    expect(result.success).toBe(true);
    expect(result.stats.contentMatches).toBeGreaterThan(2);
  });
});
