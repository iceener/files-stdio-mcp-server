/**
 * Ignore file handling (.gitignore, .ignore).
 *
 * Uses the `ignore` package for proper gitignore semantics.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import ignore, { type Ignore } from 'ignore';

/** Default patterns to always ignore */
const DEFAULT_IGNORE = [
  // Hidden files/folders (start with dot)
  '.*',
  // Common non-content directories
  'node_modules',
  // OS junk files
  'Thumbs.db',
  // Editor temp files
  '*.swp',
  '*.swo',
  '*~',
];

/** Pattern matcher for ignore rules */
export interface IgnoreMatcher {
  isIgnored(relativePath: string): boolean;
}

/**
 * Create an ignore matcher from patterns.
 */
export function createIgnoreMatcher(patterns: string[]): IgnoreMatcher {
  const ig: Ignore = ignore().add(DEFAULT_IGNORE).add(patterns);

  return {
    isIgnored(relativePath: string): boolean {
      // The ignore package requires paths without leading slashes
      const normalized = relativePath.replace(/^\/+/, '');
      if (!normalized) return false;
      return ig.ignores(normalized);
    },
  };
}

/**
 * Load ignore patterns from a directory.
 * Looks for .gitignore and .ignore files.
 */
export async function loadIgnorePatterns(dir: string): Promise<string[]> {
  const patterns: string[] = [];

  for (const filename of ['.gitignore', '.ignore']) {
    try {
      const content = await fs.readFile(path.join(dir, filename), 'utf8');
      const lines = content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));
      patterns.push(...lines);
    } catch {
      // File doesn't exist, that's fine
    }
  }

  return patterns;
}

/**
 * Create an ignore matcher for a directory.
 */
export async function createIgnoreMatcherForDir(dir: string): Promise<IgnoreMatcher> {
  const patterns = await loadIgnorePatterns(dir);
  return createIgnoreMatcher(patterns);
}
