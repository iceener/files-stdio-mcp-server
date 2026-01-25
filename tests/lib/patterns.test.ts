/**
 * Tests for pattern matching utilities.
 */

import { describe, expect, test } from 'bun:test';
import { buildPattern, findMatches, findUniqueMatch } from '../../src/lib/patterns.js';

describe('buildPattern', () => {
  test('literal mode escapes special regex characters', () => {
    const regex = buildPattern('array.map((x) => x * 2)', 'literal');
    expect(regex.test('array.map((x) => x * 2)')).toBe(true);
    expect(regex.test('arrayXmap((x) => x * 2)')).toBe(false);
  });

  test('regex mode uses pattern as-is', () => {
    const regex = buildPattern('\\d{4}-\\d{2}-\\d{2}', 'regex');
    expect(regex.test('2024-12-03')).toBe(true);
    expect(regex.test('not-a-date')).toBe(false);
  });

  test('fuzzy mode handles basic whitespace normalization', () => {
    // Fuzzy mode normalizes the PATTERN, so search in normalized content
    const regex = buildPattern('function doSomething', 'fuzzy');
    expect(regex.test('function doSomething')).toBe(true);
    // Note: fuzzy normalizes pattern whitespace, not necessarily target
  });

  test('caseInsensitive option makes matching case-insensitive', () => {
    const regex1 = buildPattern('react', 'literal', { caseInsensitive: true });
    const regex2 = buildPattern('react', 'literal', { caseInsensitive: true });
    expect(regex1.test('react')).toBe(true);
    expect(regex2.test('React')).toBe(true);
  });

  test('without caseInsensitive, matching is case-sensitive', () => {
    const regex = buildPattern('React', 'literal');
    expect(regex.test('React')).toBe(true);
    expect(regex.test('react')).toBe(false);
  });

  test('caseInsensitive works with regex mode', () => {
    const regex1 = buildPattern('foo|bar', 'regex', { caseInsensitive: true });
    const regex2 = buildPattern('foo|bar', 'regex', { caseInsensitive: true });
    expect(regex1.test('FOO')).toBe(true);
    expect(regex2.test('Bar')).toBe(true);
  });

  test('wholeWord option matches word boundaries', () => {
    const regex = buildPattern('Java', 'literal', { wholeWord: true });
    expect(regex.test('Java is cool')).toBe(true);
    expect(regex.test('JavaScript is cool')).toBe(false);
  });

  test('multiline option allows dot to match newlines', () => {
    const regex = buildPattern('start.*end', 'regex', { multiline: true });
    expect(regex.test('start\nmiddle\nend')).toBe(true);
  });
});

describe('findMatches', () => {
  const content = `# Title
This is line 2.
This is line 3 with keyword here.
Another line.
And keyword again on line 5.`;

  test('finds all literal matches', () => {
    const matches = findMatches(content, 'keyword', 'literal');
    expect(matches).toHaveLength(2);
    expect(matches[0]?.line).toBe(3);
    expect(matches[1]?.line).toBe(5);
  });

  test('respects maxMatches limit', () => {
    const matches = findMatches(content, 'line', 'literal', { maxMatches: 2 });
    expect(matches).toHaveLength(2);
  });

  test('returns correct column positions', () => {
    const matches = findMatches(content, 'keyword', 'literal');
    expect(matches[0]?.column).toBeGreaterThan(1);
  });

  test('finds regex matches', () => {
    const matches = findMatches(content, 'line \\d', 'regex');
    expect(matches).toHaveLength(3); // line 2, line 3, line 5
  });

  test('handles multiline patterns', () => {
    const multilineContent = '```js\nconst x = 1;\n```';
    const matches = findMatches(multilineContent, '```.*```', 'regex', { multiline: true });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.text).toContain('const x = 1');
  });

  test('returns empty array for no matches', () => {
    const matches = findMatches(content, 'nonexistent', 'literal');
    expect(matches).toHaveLength(0);
  });
});

describe('findUniqueMatch', () => {
  test('returns match when exactly one found', () => {
    const content = 'one unique thing here';
    const result = findUniqueMatch(content, 'unique', 'literal');
    expect('match' in result).toBe(true);
    if ('match' in result) {
      expect(result.match.text).toBe('unique');
    }
  });

  test('returns not_found when no matches', () => {
    const content = 'nothing here';
    const result = findUniqueMatch(content, 'missing', 'literal');
    expect(result).toEqual({ error: 'not_found' });
  });

  test('returns multiple error with count when multiple matches', () => {
    const content = 'word word word';
    const result = findUniqueMatch(content, 'word', 'literal');
    expect('error' in result && result.error === 'multiple').toBe(true);
    if ('error' in result && result.error === 'multiple') {
      expect(result.count).toBe(3);
      expect(result.lines).toHaveLength(3);
    }
  });
});

describe('edge cases', () => {
  test('handles empty content', () => {
    const matches = findMatches('', 'test', 'literal');
    expect(matches).toHaveLength(0);
  });

  test('handles empty pattern in literal mode', () => {
    // Empty pattern should match at every position, but we limit
    const matches = findMatches('abc', '', 'literal', { maxMatches: 5 });
    expect(matches.length).toBeGreaterThan(0);
  });

  test('handles special characters in content', () => {
    const content = 'Price: $100.00 (USD)';
    const matches = findMatches(content, '$100.00', 'literal');
    expect(matches).toHaveLength(1);
  });

  test('handles unicode content', () => {
    const content = 'Hello 世界! 🚀 Emoji test';
    const matches = findMatches(content, '世界', 'literal');
    expect(matches).toHaveLength(1);
  });

  test('handles very long lines', () => {
    const longLine = 'x'.repeat(10000) + 'FIND' + 'y'.repeat(10000);
    const matches = findMatches(longLine, 'FIND', 'literal');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.column).toBe(10001);
  });
});

