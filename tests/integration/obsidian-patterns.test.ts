/**
 * Tests for Obsidian-like knowledge base patterns.
 *
 * These tests verify that our filesystem tools can handle common
 * Obsidian vault operations like finding wikilinks, tags, frontmatter,
 * and structured markdown content.
 */

import { FIXTURES_PATH } from '../setup.js';

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { fsReadTool } from '../../src/tools/fs-read.tool.js';
import { fsWriteTool } from '../../src/tools/fs-write.tool.js';

const KNOWLEDGE_FILE = 'vault/knowledge/programming-notes.md';
const TEST_DIR = path.join(FIXTURES_PATH, 'obsidian-tests');

async function runFsRead(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await fsReadTool.handler(args, {} as never);
  const text = (result.content[0] as { text: string }).text;
  return JSON.parse(text);
}

async function runFsWrite(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await fsWriteTool.handler(args, {} as never);
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

// ─────────────────────────────────────────────────────────────
// Wikilink Patterns
// ─────────────────────────────────────────────────────────────

describe('Obsidian: Wikilinks', () => {
  test('finds all wikilinks in a file', async () => {
    const result = await runFsRead({
      path: KNOWLEDGE_FILE,
      pattern: '\\[\\[([^\\]|]+)(\\|[^\\]]+)?\\]\\]',
      patternMode: 'regex',
    });

    expect(result.success).toBe(true);
    // matchCount is raw matches; matches.length is cluster count
    expect(result.matchCount).toBeGreaterThanOrEqual(5);
  });

  test('finds wikilinks with display text', async () => {
    const result = await runFsRead({
      path: KNOWLEDGE_FILE,
      pattern: '\\[\\[[^\\]]+\\|[^\\]]+\\]\\]',
      patternMode: 'regex',
    });

    expect(result.success).toBe(true);
    // Should find [[Algorithms|algorithm problems]]
    const matches = result.matches as { text: string }[];
    expect(matches.some((m) => m.text.includes('|'))).toBe(true);
  });

  test('finds links to specific note', async () => {
    const result = await runFsRead({
      path: KNOWLEDGE_FILE,
      pattern: '\\[\\[.*Alice.*\\]\\]',
      patternMode: 'regex',
    });

    expect(result.success).toBe(true);
    expect((result.matches as unknown[]).length).toBeGreaterThan(0);
  });

  test('finds heading links', async () => {
    const result = await runFsRead({
      path: KNOWLEDGE_FILE,
      pattern: '\\[\\[[^\\]]+#[^\\]]+\\]\\]',
      patternMode: 'regex',
    });

    expect(result.success).toBe(true);
    // Should find [[Design Patterns#DI]]
    expect((result.matches as unknown[]).length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────
// Tag Patterns
// ─────────────────────────────────────────────────────────────

describe('Obsidian: Tags', () => {
  test('finds all inline tags', async () => {
    const result = await runFsRead({
      path: KNOWLEDGE_FILE,
      pattern: '#[a-zA-Z][\\w/-]*',
      patternMode: 'regex',
    });

    expect(result.success).toBe(true);
    // matchCount is the raw match count; matches.length is cluster count (nearby matches grouped)
    expect(result.matchCount).toBeGreaterThan(3);
  });

  test('finds nested tags', async () => {
    const result = await runFsRead({
      path: 'vault',
      pattern: '#\\w+/\\w+',
      patternMode: 'regex',
      depth: 10,
    });

    expect(result.success).toBe(true);
    // Should find tags like #project/alice or similar nested tags
  });

  test('searches for files with specific tag', async () => {
    const result = await runFsRead({
      path: 'vault',
      pattern: '#learning',
      depth: 10,
    });

    expect(result.success).toBe(true);
    expect((result.matches as unknown[]).length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────
// Frontmatter Patterns
// ─────────────────────────────────────────────────────────────

describe('Obsidian: Frontmatter', () => {
  test('finds frontmatter delimiters', async () => {
    // Search for the --- delimiter which marks frontmatter
    const result = await runFsRead({
      path: KNOWLEDGE_FILE,
      pattern: '---',
      patternMode: 'literal',
    });

    expect(result.success).toBe(true);
    // Should find at least opening and closing ---
    expect((result.matches as unknown[]).length).toBeGreaterThanOrEqual(2);
  });

  test('finds specific frontmatter field', async () => {
    const result = await runFsRead({
      path: KNOWLEDGE_FILE,
      pattern: 'title:\\s*.+',
      patternMode: 'regex',
    });

    expect(result.success).toBe(true);
    const match = (result.matches as { text: string }[])[0];
    expect(match?.text).toContain('Programming Notes');
  });

  test('finds files with specific frontmatter tag', async () => {
    const result = await runFsRead({
      path: 'vault',
      pattern: 'tags:[\\s\\S]*?programming',
      patternMode: 'regex',
      multiline: true,
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
    const result = await runFsRead({
      path: KNOWLEDGE_FILE,
      pattern: '- \\[ \\] .+',
      patternMode: 'regex',
    });

    expect(result.success).toBe(true);
    // matchCount is raw matches; matches.length is cluster count
    expect(result.matchCount).toBeGreaterThan(2);
  });

  test('finds completed tasks', async () => {
    const result = await runFsRead({
      path: KNOWLEDGE_FILE,
      pattern: '- \\[x\\] .+',
      patternMode: 'regex',
    });

    expect(result.success).toBe(true);
    expect((result.matches as unknown[]).length).toBeGreaterThan(0);
  });

  test('finds all tasks (complete and incomplete)', async () => {
    const result = await runFsRead({
      path: KNOWLEDGE_FILE,
      pattern: '- \\[[x ]\\] .+',
      patternMode: 'regex',
    });

    expect(result.success).toBe(true);
    // matchCount is raw matches; matches.length is cluster count
    expect(result.matchCount).toBeGreaterThan(3);
  });

  test('marks task as complete', async () => {
    // Create test file
    const testFile = path.join(TEST_DIR, 'tasks.md');
    await fs.writeFile(testFile, '- [ ] Buy groceries\n- [ ] Call mom\n- [x] Done task');

    const result = await runFsWrite({
      path: 'obsidian-tests/tasks.md',
      operation: 'update',
      action: 'replace',
      pattern: '- \\[ \\] Buy groceries',
      patternMode: 'regex',
      content: '- [x] Buy groceries',
    });

    expect(result.success).toBe(true);

    const content = await fs.readFile(testFile, 'utf8');
    expect(content).toContain('- [x] Buy groceries');
  });
});

// ─────────────────────────────────────────────────────────────
// Block Reference Patterns
// ─────────────────────────────────────────────────────────────

describe('Obsidian: Block References', () => {
  test('finds block IDs', async () => {
    // Block IDs appear at end of lines like "### Code Snippets ^snippets"
    const result = await runFsRead({
      path: KNOWLEDGE_FILE,
      pattern: '\\^[a-zA-Z][\\w-]*',
      patternMode: 'regex',
    });

    expect(result.success).toBe(true);
    // Should find ^snippets and ^commands
    expect((result.matches as unknown[]).length).toBeGreaterThan(0);
  });

  test('finds content with specific block ID', async () => {
    const result = await runFsRead({
      path: KNOWLEDGE_FILE,
      pattern: '### .*\\^snippets',
      patternMode: 'regex',
    });

    expect(result.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// Heading Patterns
// ─────────────────────────────────────────────────────────────

describe('Obsidian: Headings', () => {
  test('finds all headings', async () => {
    // Search for lines starting with # (heading marker)
    const result = await runFsRead({
      path: KNOWLEDGE_FILE,
      pattern: '# ',
      patternMode: 'literal',
    });

    expect(result.success).toBe(true);
    // File has multiple headings at various levels
    // matchCount is raw matches; matches.length is cluster count
    expect(result.matchCount).toBeGreaterThanOrEqual(5);
  });

  test('finds H2 headings only', async () => {
    const result = await runFsRead({
      path: KNOWLEDGE_FILE,
      pattern: '## ',
      patternMode: 'literal',
    });

    expect(result.success).toBe(true);
    const matches = result.matches as { text: string }[];
    // All matches should be from lines with ## headings
    expect(matches.length).toBeGreaterThan(0);
  });

  test('finds heading by name', async () => {
    const result = await runFsRead({
      path: KNOWLEDGE_FILE,
      pattern: '## Current Learning',
      patternMode: 'literal',
    });

    expect(result.success).toBe(true);
    expect((result.matches as unknown[]).length).toBe(1);
  });

  test('inserts content after heading', async () => {
    const testFile = path.join(TEST_DIR, 'headings.md');
    await fs.writeFile(testFile, '# Title\n\n## Section 1\n\nContent here.\n\n## Section 2\n\nMore content.');

    const result = await runFsWrite({
      path: 'obsidian-tests/headings.md',
      operation: 'update',
      action: 'insert_after',
      pattern: '## Section 1',
      content: '\nNew content under section 1.\n',
    });

    expect(result.success).toBe(true);

    const content = await fs.readFile(testFile, 'utf8');
    expect(content).toContain('New content under section 1.');
    expect(content.indexOf('Section 1')).toBeLessThan(content.indexOf('New content'));
  });
});

// ─────────────────────────────────────────────────────────────
// Code Block Patterns
// ─────────────────────────────────────────────────────────────

describe('Obsidian: Code Blocks', () => {
  test('finds code blocks', async () => {
    const result = await runFsRead({
      path: KNOWLEDGE_FILE,
      pattern: '```[\\s\\S]*?```',
      patternMode: 'regex',
      multiline: true,
    });

    expect(result.success).toBe(true);
    expect((result.matches as unknown[]).length).toBeGreaterThan(0);
  });

  test('finds JavaScript code blocks', async () => {
    // Search for the language identifier line
    const result = await runFsRead({
      path: KNOWLEDGE_FILE,
      pattern: '```javascript',
      patternMode: 'literal',
    });

    expect(result.success).toBe(true);
    expect((result.matches as unknown[]).length).toBeGreaterThan(0);

    // Verify the code content exists nearby
    const contentResult = await runFsRead({
      path: KNOWLEDGE_FILE,
      pattern: 'debounce',
    });
    expect((contentResult.matches as unknown[]).length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────
// Daily Note Patterns
// ─────────────────────────────────────────────────────────────

describe('Obsidian: Daily Notes', () => {
  test('finds daily note entries', async () => {
    const result = await runFsRead({
      path: KNOWLEDGE_FILE,
      pattern: '### \\d{4}-\\d{2}-\\d{2}',
      patternMode: 'regex',
    });

    expect(result.success).toBe(true);
    expect((result.matches as unknown[]).length).toBeGreaterThan(0);
  });

  test('finds files by date pattern', async () => {
    const result = await runFsRead({
      path: 'vault',
      find: '2024-*.md',
      depth: 10,
    });

    expect(result.success).toBe(true);
    // Should find journal entries
  });

  test('creates daily note with template', async () => {
    const today = new Date().toISOString().split('T')[0];
    const template = `# ${today}

## Morning Thoughts

## Tasks
- [ ] 

## Notes

## Gratitude
`;

    const result = await runFsWrite({
      path: `obsidian-tests/${today}.md`,
      operation: 'create',
      content: template,
    });

    expect(result.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// Backlink Discovery (Simulated)
// ─────────────────────────────────────────────────────────────

describe('Obsidian: Backlinks', () => {
  beforeAll(async () => {
    // Create test files with links
    await fs.mkdir(path.join(TEST_DIR, 'notes'), { recursive: true });

    await fs.writeFile(
      path.join(TEST_DIR, 'notes/project.md'),
      '# Project\n\nThis is the main project. See [[inbox]] for ideas.',
    );
    await fs.writeFile(
      path.join(TEST_DIR, 'notes/inbox.md'),
      '# Inbox\n\nIdeas for [[project]].\n\n- Item from [[project]]',
    );
    await fs.writeFile(
      path.join(TEST_DIR, 'notes/other.md'),
      '# Other\n\nNo links here.',
    );
  });

  test('finds all files linking to a note', async () => {
    const result = await runFsRead({
      path: 'obsidian-tests/notes',
      pattern: '\\[\\[project\\]\\]',
      patternMode: 'regex',
      depth: 5,
    });

    expect(result.success).toBe(true);
    // Should find inbox.md linking to project
    expect((result.matches as unknown[]).length).toBeGreaterThan(0);
  });

  test('counts backlinks per file', async () => {
    const result = await runFsRead({
      path: 'obsidian-tests/notes',
      pattern: '\\[\\[project\\]\\]',
      patternMode: 'regex',
      output: 'count',
      depth: 5,
    });

    expect(result.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// Complex Editing Scenarios
// ─────────────────────────────────────────────────────────────

describe('Obsidian: Complex Edits', () => {
  test('adds new link to existing list', async () => {
    const testFile = path.join(TEST_DIR, 'links.md');
    await fs.writeFile(
      testFile,
      '# Links\n\n## Resources\n\n- [[Link 1]]\n- [[Link 2]]\n\n## Notes',
    );

    const result = await runFsWrite({
      path: 'obsidian-tests/links.md',
      operation: 'update',
      action: 'insert_after',
      pattern: '- [[Link 2]]',
      content: '\n- [[Link 3]]',
    });

    expect(result.success).toBe(true);

    const content = await fs.readFile(testFile, 'utf8');
    expect(content).toContain('- [[Link 3]]');
  });

  test('updates frontmatter field', async () => {
    const testFile = path.join(TEST_DIR, 'frontmatter.md');
    await fs.writeFile(
      testFile,
      '---\ntitle: Old Title\nmodified: 2024-01-01\n---\n\n# Content',
    );

    const result = await runFsWrite({
      path: 'obsidian-tests/frontmatter.md',
      operation: 'update',
      action: 'replace',
      pattern: 'modified: 2024-01-01',
      content: 'modified: 2024-12-03',
    });

    expect(result.success).toBe(true);

    const content = await fs.readFile(testFile, 'utf8');
    expect(content).toContain('modified: 2024-12-03');
  });

  test('renames wikilink target', async () => {
    const testFile = path.join(TEST_DIR, 'rename.md');
    await fs.writeFile(
      testFile,
      'See [[Old Name]] for details.\n\nAlso check [[Old Name|display text]].',
    );

    // This would need multiple passes or a replace_all for real rename
    const result = await runFsWrite({
      path: 'obsidian-tests/rename.md',
      operation: 'update',
      action: 'replace',
      pattern: '[[Old Name]]',
      content: '[[New Name]]',
    });

    expect(result.success).toBe(true);

    const content = await fs.readFile(testFile, 'utf8');
    expect(content).toContain('[[New Name]]');
  });

  test('adds tag to file', async () => {
    const testFile = path.join(TEST_DIR, 'add-tag.md');
    await fs.writeFile(testFile, '# Note\n\n#existing-tag\n\nContent here.');

    const result = await runFsWrite({
      path: 'obsidian-tests/add-tag.md',
      operation: 'update',
      action: 'insert_after',
      pattern: '#existing-tag',
      content: ' #new-tag',
    });

    expect(result.success).toBe(true);

    const content = await fs.readFile(testFile, 'utf8');
    expect(content).toContain('#new-tag');
  });
});

// ─────────────────────────────────────────────────────────────
// Search Across Vault
// ─────────────────────────────────────────────────────────────

describe('Obsidian: Vault-wide Search', () => {
  test('finds all incomplete tasks in vault', async () => {
    const result = await runFsRead({
      path: 'vault',
      pattern: '- \\[ \\] .+',
      patternMode: 'regex',
      depth: 10,
      output: 'full',
    });

    expect(result.success).toBe(true);
    expect((result.matches as unknown[]).length).toBeGreaterThan(0);
  });

  test('finds all files mentioning a topic', async () => {
    const result = await runFsRead({
      path: 'vault',
      pattern: 'TypeScript',
      patternMode: 'literal',
      caseInsensitive: true,
      depth: 10,
      output: 'list',
    });

    expect(result.success).toBe(true);
  });

  test('finds orphan notes (no incoming links) - setup', async () => {
    // First, get all note names
    const allNotes = await runFsRead({
      path: 'vault',
      find: '*.md',
      depth: 10,
    });

    expect(allNotes.success).toBe(true);
    // In a real scenario, you'd then search for [[each-note]] to find backlinks
  });
});

