/**
 * Pattern matching utilities with multiple modes.
 */

export type PatternMode = 'literal' | 'regex' | 'fuzzy';

/**
 * Preset patterns for common Obsidian/Markdown patterns.
 * These are convenience patterns that agents can use instead of writing regex.
 */
export type PresetPattern =
  | 'wikilinks' // [[Note]] and [[Note|Display]]
  | 'tags' // #tag and #nested/tag
  | 'tasks' // - [ ] and - [x]
  | 'tasks_open' // - [ ] only (incomplete)
  | 'tasks_done' // - [x] only (completed)
  | 'headings' // # through ######
  | 'codeblocks' // ```...```
  | 'frontmatter'; // ---...---

/**
 * Preset pattern definitions.
 * Each returns a regex pattern string and appropriate flags.
 */
export const PRESET_PATTERNS: Record<PresetPattern, { pattern: string; flags: string }> = {
  wikilinks: {
    pattern: '\\[\\[([^\\]|]+)(\\|[^\\]]+)?\\]\\]',
    flags: 'g',
  },
  tags: {
    pattern: '(?<=\\s|^)#[a-zA-Z][a-zA-Z0-9_/]*',
    flags: 'gm',
  },
  tasks: {
    pattern: '^\\s*-\\s*\\[([ xX])\\]\\s+(.*)$',
    flags: 'gm',
  },
  tasks_open: {
    pattern: '^\\s*-\\s*\\[ \\]\\s+(.*)$',
    flags: 'gm',
  },
  tasks_done: {
    pattern: '^\\s*-\\s*\\[[xX]\\]\\s+(.*)$',
    flags: 'gm',
  },
  headings: {
    pattern: '^(#{1,6})\\s+(.+)$',
    flags: 'gm',
  },
  codeblocks: {
    pattern: '```[\\s\\S]*?```',
    flags: 'g',
  },
  frontmatter: {
    pattern: '^---\\n[\\s\\S]*?\\n---',
    flags: 'm',
  },
};

/**
 * Check if a string is a valid preset pattern name.
 */
export function isPresetPattern(pattern: string): pattern is PresetPattern {
  return pattern in PRESET_PATTERNS;
}

/**
 * Build regex from a preset pattern.
 */
export function buildPresetPattern(preset: PresetPattern): RegExp {
  const { pattern, flags } = PRESET_PATTERNS[preset];
  return new RegExp(pattern, flags);
}

export interface MatchResult {
  /** Start index in content */
  index: number;
  /** The matched text */
  text: string;
  /** Line number (1-indexed) */
  line: number;
  /** Column number (1-indexed) */
  column: number;
}

/**
 * Escape special regex characters.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normalize whitespace for fuzzy matching.
 * - Collapses multiple whitespace to single space
 * - Trims leading/trailing whitespace
 * - Normalizes line endings
 */
function normalizeWhitespace(str: string): string {
  return str
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n /g, '\n')
    .replace(/ \n/g, '\n')
    .trim();
}

/**
 * Build a regex from pattern based on mode.
 */
export function buildPattern(
  pattern: string,
  mode: PatternMode,
  options: { multiline?: boolean; wholeWord?: boolean; caseInsensitive?: boolean } = {},
): RegExp {
  let source: string;
  let flags = 'g';

  if (options.multiline) {
    flags += 's'; // dotall mode
  }

  if (options.caseInsensitive) {
    flags += 'i';
  }

  switch (mode) {
    case 'literal':
      source = escapeRegex(pattern);
      break;

    case 'regex':
      source = pattern;
      break;

    case 'fuzzy': {
      // Normalize pattern and create flexible whitespace matching
      const normalized = normalizeWhitespace(pattern);
      source = escapeRegex(normalized).replace(/ /g, '\\s+').replace(/\n/g, '\\s*\\n\\s*');
      break;
    }
  }

  if (options.wholeWord) {
    source = `\\b${source}\\b`;
  }

  return new RegExp(source, flags);
}

/**
 * Find all matches of a pattern in content.
 */
export function findMatches(
  content: string,
  pattern: string,
  mode: PatternMode,
  options: { multiline?: boolean; wholeWord?: boolean; caseInsensitive?: boolean; maxMatches?: number } = {},
): MatchResult[] {
  const regex = buildPattern(pattern, mode, options);
  const matches: MatchResult[] = [];
  const maxMatches = options.maxMatches ?? 1000;

  let match = regex.exec(content);
  while (match !== null && matches.length < maxMatches) {
    const index = match.index;
    const text = match[0];

    // Calculate line and column
    const beforeMatch = content.slice(0, index);
    const lines = beforeMatch.split('\n');
    const line = lines.length;
    const column = (lines[lines.length - 1]?.length ?? 0) + 1;

    matches.push({ index, text, line, column });

    // Prevent infinite loop on zero-length matches
    if (match.index === regex.lastIndex) {
      regex.lastIndex++;
    }

    match = regex.exec(content);
  }

  return matches;
}

/**
 * Find a single match, or return null if not found or multiple matches.
 */
export function findUniqueMatch(
  content: string,
  pattern: string,
  mode: PatternMode,
  options: { multiline?: boolean; wholeWord?: boolean; caseInsensitive?: boolean } = {},
):
  | { match: MatchResult }
  | { error: 'not_found' }
  | { error: 'multiple'; count: number; lines: number[] } {
  const matches = findMatches(content, pattern, mode, { ...options, maxMatches: 10 });

  if (matches.length === 0) {
    return { error: 'not_found' };
  }

  if (matches.length > 1) {
    return {
      error: 'multiple',
      count: matches.length,
      lines: matches.map((m) => m.line),
    };
  }

  // At this point matches.length === 1 (not 0 and not > 1)
  const match = matches[0];
  if (!match) {
    return { error: 'not_found' };
  }
  return { match };
}

/**
 * Get line bounds (start/end indices) for a given position.
 */
export function getLineBounds(content: string, index: number): { start: number; end: number } {
  const lineStart = content.lastIndexOf('\n', index - 1) + 1;
  let lineEnd = content.indexOf('\n', index);
  if (lineEnd === -1) lineEnd = content.length;
  return { start: lineStart, end: lineEnd };
}

/**
 * Get the line number for a given index.
 */
export function getLineNumber(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
}

/**
 * Find all matches using a preset pattern.
 */
export function findPresetMatches(
  content: string,
  preset: PresetPattern,
  options: { maxMatches?: number } = {},
): MatchResult[] {
  const regex = buildPresetPattern(preset);
  const matches: MatchResult[] = [];
  const maxMatches = options.maxMatches ?? 1000;

  let match = regex.exec(content);
  while (match !== null && matches.length < maxMatches) {
    const index = match.index;
    const text = match[0];

    // Calculate line and column
    const beforeMatch = content.slice(0, index);
    const lines = beforeMatch.split('\n');
    const line = lines.length;
    const column = (lines[lines.length - 1]?.length ?? 0) + 1;

    matches.push({ index, text, line, column });

    // Prevent infinite loop on zero-length matches
    if (match.index === regex.lastIndex) {
      regex.lastIndex++;
    }

    match = regex.exec(content);
  }

  return matches;
}

/**
 * Replace all occurrences of a pattern in content.
 * Returns the new content and count of replacements.
 */
export function replaceAllMatches(
  content: string,
  pattern: string,
  replacement: string,
  mode: PatternMode,
  options: { multiline?: boolean; wholeWord?: boolean; caseInsensitive?: boolean } = {},
): { newContent: string; count: number; affectedLines: number[] } {
  const matches = findMatches(content, pattern, mode, { ...options, maxMatches: 10000 });

  if (matches.length === 0) {
    return { newContent: content, count: 0, affectedLines: [] };
  }

  // Replace from end to start to preserve indices
  let newContent = content;
  const affectedLines = new Set<number>();

  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i];
    if (!match) continue;

    newContent =
      newContent.slice(0, match.index) +
      replacement +
      newContent.slice(match.index + match.text.length);
    affectedLines.add(match.line);
  }

  return {
    newContent,
    count: matches.length,
    affectedLines: Array.from(affectedLines).sort((a, b) => a - b),
  };
}
