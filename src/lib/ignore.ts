/**
 * Ignore file handling (.gitignore, .ignore).
 */

import fs from 'node:fs/promises';
import path from 'node:path';

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
 * Parse ignore file content into patterns.
 */
function parseIgnorePatterns(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

/**
 * Convert glob pattern to regex.
 */
function globToRegex(pattern: string): RegExp {
  let regex = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '<<<GLOBSTAR>>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<<GLOBSTAR>>>/g, '.*')
    .replace(/\?/g, '[^/]');

  // Handle directory patterns
  if (pattern.endsWith('/')) {
    regex = `${regex.slice(0, -2)}(/.*)?$`;
  } else {
    regex = `(^|/)${regex}(/.*)?$`;
  }

  return new RegExp(regex);
}

/**
 * Create an ignore matcher from patterns.
 */
export function createIgnoreMatcher(patterns: string[]): IgnoreMatcher {
  const allPatterns = [...DEFAULT_IGNORE, ...patterns];
  const regexes = allPatterns.map((p) => ({
    pattern: p,
    regex: globToRegex(p),
    negated: p.startsWith('!'),
  }));

  return {
    isIgnored(relativePath: string): boolean {
      let ignored = false;

      for (const { regex, negated } of regexes) {
        if (regex.test(relativePath)) {
          ignored = !negated;
        }
      }

      return ignored;
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
      patterns.push(...parseIgnorePatterns(content));
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
