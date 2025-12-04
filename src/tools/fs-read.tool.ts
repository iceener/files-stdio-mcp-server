/**
 * fs_read Tool
 *
 * Unified exploration tool for directories, files, and search.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  addLineNumbers,
  createIgnoreMatcherForDir,
  extractLines,
  findMatches,
  findPresetMatches,
  generateChecksum,
  getMounts,
  isPresetPattern,
  isTextFile,
  type MatchResult,
  matchesType,
  type PatternMode,
  parseLineRange,
  resolvePath as resolveVirtualPath,
  shouldExclude,
} from '../lib/index.js';
import type { HandlerExtra } from '../types/index.js';

// ─────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────

export const fsReadInputSchema = z
  .object({
    path: z
      .string()
      .min(1)
      .describe(
        'Relative path to file or directory. Examples: "." (current dir), "docs/", "src/index.ts". ' +
          'For directories: returns tree. For files: returns content with line numbers.',
      ),

    pattern: z
      .string()
      .optional()
      .describe(
        'Search pattern to find within file(s). Matches both file contents AND filenames. ' +
          'When provided with a file path, returns matching lines with context. ' +
          'When provided with a directory path, searches recursively. ' +
          'Files whose names contain the pattern are included even without content matches. ' +
          'Treated as literal text by default — set patternMode="regex" for regular expressions. ' +
          'For common patterns, use "preset" instead.',
      ),

    preset: z
      .enum([
        'wikilinks',
        'tags',
        'tasks',
        'tasks_open',
        'tasks_done',
        'headings',
        'codeblocks',
        'frontmatter',
      ])
      .optional()
      .describe(
        'Use a preset pattern for common Obsidian/Markdown searches. Easier than writing regex. ' +
          'Options: "wikilinks" → [[links]], "tags" → #tags, "tasks" → all tasks, ' +
          '"tasks_open" → incomplete tasks, "tasks_done" → completed tasks, ' +
          '"headings" → # headings, "codeblocks" → ``` blocks, "frontmatter" → YAML ---. ' +
          'Cannot be used with "pattern".',
      ),

    patternMode: z
      .enum(['literal', 'regex', 'fuzzy', 'smart'])
      .optional()
      .default('literal')
      .describe(
        '"literal" (default): exact text match. "regex": regular expression. ' +
          '"fuzzy": normalizes whitespace. "smart": case-insensitive unless pattern has uppercase.',
      ),

    multiline: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'Enable patterns to span multiple lines. The dot (.) will match newlines. ' +
          'Note: ^ and $ still match string boundaries, not line boundaries. ' +
          'For line-start matching, use preset="headings" or patternMode="regex" with (?m) flag.',
      ),

    wholeWord: z
      .boolean()
      .optional()
      .default(false)
      .describe('Match whole words only. Prevents "cat" from matching "category".'),

    lines: z
      .string()
      .optional()
      .describe(
        'Limit file reading to specific lines. Format: "10" (single line), "10-50" (range). ' +
          'Useful for large files or when you know the target area.',
      ),

    depth: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .default(7)
      .describe(
        'How many directory levels deep to traverse. Default 7. ' +
          'Applies to directory listing, search, and find operations.',
      ),

    context: z
      .number()
      .int()
      .min(0)
      .max(20)
      .optional()
      .default(3)
      .describe(
        'For search results: number of lines to show before and after each match. Default 3.',
      ),

    types: z
      .array(z.string())
      .optional()
      .describe('Filter by file type. Examples: ["ts", "js"], ["md"], ["config"].'),

    glob: z.string().optional().describe('Glob pattern to filter files. Example: "**/*.ts".'),

    find: z
      .string()
      .optional()
      .describe(
        'Find files by name (not content). Searches recursively from path. ' +
          'Examples: "mega.md" finds exact match, "*.md" finds all markdown files. ' +
          'Returns list of matching file paths. Use this when you know the filename but not the location.',
      ),

    exclude: z
      .array(z.string())
      .optional()
      .describe('Patterns to exclude. Example: ["**/test/**", "**/*.spec.ts"].'),

    respectIgnore: z
      .boolean()
      .optional()
      .default(true)
      .describe('Respect .gitignore and .ignore files. Default true.'),

    output: z
      .enum(['full', 'list', 'count', 'summary'])
      .optional()
      .default('full')
      .describe(
        '"full" (default): complete content. "list": just file paths. ' +
          '"count": match counts per file. "summary": overview statistics.',
      ),

    maxMatches: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .optional()
      .default(100)
      .describe('Maximum matches to return. Default 100.'),

    maxFiles: z
      .number()
      .int()
      .min(1)
      .optional()
      .default(999999)
      .describe('Maximum files with matches to return. Searches all files but caps results. No limit by default.'),

    details: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'Include file details (size, modified time) in directory listings. ' +
          'Default false for compact output. Set true when you need file metadata.',
      ),
  })
  .passthrough() // Allow extra keys from SDK context
  .refine((data) => !(data.pattern && data.preset), {
    message: 'Cannot use both "pattern" and "preset". Use one or the other.',
    path: ['preset'],
  });

export type FsReadInput = z.infer<typeof fsReadInputSchema>;

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface TreeEntry {
  path: string;
  kind: 'file' | 'directory';
  size?: string;
  modified?: string;
  children?: number;
}

interface SearchMatch {
  file: string;
  /** First line of this match/cluster */
  line: number;
  /** Last line of this match/cluster (same as line for single match) */
  endLine: number;
  /** Number of individual matches in this cluster */
  matchCount: number;
  /** Line numbers where matches occur within this cluster */
  matchLines: number[];
  /** The matched text(s) */
  text: string;
  /** Context lines around the cluster, formatted as "LINE_NUM|content" */
  context: {
    before: string[];
    match: string[];
    after: string[];
  };
}

interface FsReadResult {
  success: boolean;
  path: string;
  type: 'directory' | 'file' | 'search';
  tree?: {
    entries: TreeEntry[];
    summary: string;
  };
  content?: {
    text: string;
    checksum: string;
    totalLines: number;
    range?: { start: number; end: number };
    truncated: boolean;
  };
  matches?: SearchMatch[];
  matchCount?: number;
  filesSearched?: number;
  truncated?: boolean;
  stats?: {
    filesSearched: number;
    filesMatched: number;
    totalMatches: number;
  };
  error?: {
    code: string;
    message: string;
  };
  hint: string;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toISOString().split('T')[0] ?? date.toISOString();
}

/**
 * Check if the path is requesting mount listing (root path).
 */
function isRootPath(pathStr: string): boolean {
  const trimmed = pathStr.trim();
  return trimmed === '.' || trimmed === '' || trimmed === '/';
}

/**
 * List all available mount points, or directly show single mount contents.
 */
async function listMountsOrSingleMount(
  depth: number,
  options: {
    types?: string[];
    exclude?: string[];
    respectIgnore: boolean;
    maxFiles: number;
    details?: boolean;
  },
): Promise<FsReadResult> {
  const mounts = getMounts();

  // SINGLE MOUNT: Skip the extra navigation step — show contents directly
  if (mounts.length === 1) {
    const mount = mounts[0];
    if (!mount) {
      throw new Error('Unexpected: mounts array is empty after length check');
    }
    const { entries, truncated } = await listDirectory(mount.absolutePath, '', depth, options);

    const fileCount = entries.filter((e) => e.kind === 'file').length;
    const dirCount = entries.filter((e) => e.kind === 'directory').length;

    return {
      success: true,
      path: '.',
      type: 'directory',
      tree: {
        entries,
        summary: `${entries.length} items (${fileCount} files, ${dirCount} directories)`,
      },
      truncated,
      hint:
        entries.length === 0
          ? 'Directory is empty or all files are ignored.'
          : `Showing contents of "${mount.name}". Use fs_read on any path to explore deeper.`,
    };
  }

  // MULTIPLE MOUNTS: Show mount list
  const entries: TreeEntry[] = [];

  for (const mount of mounts) {
    try {
      const stat = await fs.stat(mount.absolutePath);
      let childCount = 0;
      try {
        const children = await fs.readdir(mount.absolutePath);
        childCount = children.length;
      } catch {
        // Can't read
      }

      const entry: TreeEntry = {
        path: mount.name,
        kind: 'directory',
        children: childCount,
      };
      if (options.details) {
        entry.modified = formatRelativeTime(stat.mtime);
      }
      entries.push(entry);
    } catch {
      // Mount not accessible, still show it
      entries.push({
        path: mount.name,
        kind: 'directory',
        children: 0,
      });
    }
  }

  const mountNames = mounts.map((m) => m.name).join(', ');

  return {
    success: true,
    path: '.',
    type: 'directory',
    tree: {
      entries,
      summary: `${mounts.length} mount point(s): ${mountNames}`,
    },
    truncated: false,
    hint: `${mounts.length} mounts available. Use fs_read("mountname/") to explore a specific mount, or find="filename" to search all mounts.`,
  };
}

// ─────────────────────────────────────────────────────────────
// Core Functions
// ─────────────────────────────────────────────────────────────

async function listDirectory(
  absPath: string,
  relativePath: string,
  depth: number,
  options: {
    types?: string[];
    exclude?: string[];
    respectIgnore: boolean;
    maxFiles: number;
    details?: boolean;
  },
): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
  const entries: TreeEntry[] = [];
  let truncated = false;

  const ignoreMatcher = options.respectIgnore ? await createIgnoreMatcherForDir(absPath) : null;

  async function walk(dir: string, relDir: string, currentDepth: number): Promise<void> {
    if (currentDepth > depth || entries.length >= options.maxFiles) {
      truncated = entries.length >= options.maxFiles;
      return;
    }

    let items: string[];
    try {
      items = await fs.readdir(dir);
    } catch {
      return;
    }

    for (const item of items) {
      if (entries.length >= options.maxFiles) {
        truncated = true;
        break;
      }

      const itemPath = path.join(dir, item);
      const itemRelPath = path.join(relDir, item);

      // Check ignore
      if (ignoreMatcher?.isIgnored(itemRelPath)) continue;
      if (options.exclude && shouldExclude(itemRelPath, options.exclude)) continue;

      try {
        const stat = await fs.stat(itemPath);

        if (stat.isDirectory()) {
          // Count children
          let childCount = 0;
          try {
            const children = await fs.readdir(itemPath);
            childCount = children.length;
          } catch {
            // Can't read
          }

          const entry: TreeEntry = {
            path: itemRelPath,
            kind: 'directory',
            children: childCount,
          };
          if (options.details) {
            entry.modified = formatRelativeTime(stat.mtime);
          }
          entries.push(entry);

          if (currentDepth < depth) {
            await walk(itemPath, itemRelPath, currentDepth + 1);
          }
        } else if (stat.isFile()) {
          // Type filter
          if (options.types && options.types.length > 0) {
            if (!matchesType(item, options.types)) continue;
          }

          const entry: TreeEntry = {
            path: itemRelPath,
            kind: 'file',
          };
          if (options.details) {
            entry.size = formatSize(stat.size);
            entry.modified = formatRelativeTime(stat.mtime);
          }
          entries.push(entry);
        }
      } catch {
        // Skip inaccessible items
      }
    }
  }

  await walk(absPath, relativePath === '.' ? '' : relativePath, 1);
  return { entries, truncated };
}

async function readFile(
  absPath: string,
  relativePath: string,
  options: { lines?: string },
): Promise<FsReadResult> {
  // Check if text file
  if (!isTextFile(absPath)) {
    return {
      success: false,
      path: relativePath,
      type: 'file',
      error: { code: 'NOT_TEXT', message: 'Cannot read binary files' },
      hint: 'This appears to be a binary file. Only text files can be read.',
    };
  }

  let content: string;
  try {
    content = await fs.readFile(absPath, 'utf8');
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      return {
        success: false,
        path: relativePath,
        type: 'file',
        error: { code: 'NOT_FOUND', message: `File does not exist: ${relativePath}` },
        hint: 'File not found. Use fs_read on the parent directory to see available files, or fs_write with operation="create" to create it.',
      };
    }
    return {
      success: false,
      path: relativePath,
      type: 'file',
      error: { code: 'IO_ERROR', message: err.message },
      hint: 'Could not read file. Check if the path is correct.',
    };
  }

  const checksum = generateChecksum(content);
  const totalLines = content.split('\n').length;
  let text = content;
  let range: { start: number; end: number } | undefined;
  let truncated = false;

  // Handle line range
  if (options.lines) {
    const parsedRange = parseLineRange(options.lines);
    if (!parsedRange) {
      return {
        success: false,
        path: relativePath,
        type: 'file',
        error: { code: 'INVALID_RANGE', message: `Invalid line range: ${options.lines}` },
        hint: 'Line range format: "10" for single line, "10-50" for range.',
      };
    }

    const extracted = extractLines(content, parsedRange.start, parsedRange.end);
    text = addLineNumbers(extracted.text, extracted.actualStart);
    range = { start: extracted.actualStart, end: extracted.actualEnd };
  } else {
    // Truncate large files to first 100 lines
    const PREVIEW_LINES = 100;
    if (totalLines > PREVIEW_LINES) {
      const extracted = extractLines(content, 1, PREVIEW_LINES);
      text = addLineNumbers(extracted.text);
      truncated = true;
      range = { start: 1, end: PREVIEW_LINES };
    } else {
      text = addLineNumbers(content);
    }
  }

  return {
    success: true,
    path: relativePath,
    type: 'file',
    content: {
      text,
      checksum,
      totalLines,
      range,
      truncated,
    },
    hint: truncated
      ? `📄 LARGE FILE: ${totalLines.toLocaleString()} lines total, showing lines 1-${range?.end ?? 100}. ` +
        `To read more: use lines="101-200", lines="500-600", etc. ` +
        `To find specific content: use pattern="search term". ` +
        `Checksum: ${checksum}`
      : `File read complete. Checksum: ${checksum}. To edit this file, use fs_write with this checksum. Reference lines by number for precise edits.`,
  };
}

/**
 * Cluster nearby matches to avoid redundant overlapping results.
 * Matches within CLUSTER_DISTANCE lines of each other are merged.
 */
const CLUSTER_DISTANCE = 5;

function clusterMatches(
  matches: MatchResult[],
  content: string,
  contextLines: number,
): SearchMatch[] {
  if (matches.length === 0) return [];

  // Sort by line number
  const sorted = [...matches].sort((a, b) => a.line - b.line);

  const first = sorted.at(0);
  if (!first) return [];

  const clusters: SearchMatch[] = [];
  let currentCluster: MatchResult[] = [first];

  for (let i = 1; i < sorted.length; i++) {
    const match = sorted.at(i);
    const lastInCluster = currentCluster.at(-1);
    if (!match || !lastInCluster) continue;

    // If this match is close to the last one, add to cluster
    if (match.line - lastInCluster.line <= CLUSTER_DISTANCE) {
      currentCluster.push(match);
    } else {
      // Finalize current cluster and start new one
      clusters.push(buildClusterResult(currentCluster, content, contextLines));
      currentCluster = [match];
    }
  }

  // Don't forget the last cluster
  clusters.push(buildClusterResult(currentCluster, content, contextLines));

  return clusters;
}

/**
 * Format a line with its line number for context output.
 * Example: "  42|const x = 1;"
 */
function formatLineWithNumber(lineNum: number, text: string, maxLineNum: number): string {
  const padding = String(maxLineNum).length;
  return `${String(lineNum).padStart(padding)}|${text}`;
}

function buildClusterResult(
  matches: MatchResult[],
  content: string,
  contextLines: number,
): SearchMatch {
  const lines = content.split('\n');
  const firstMatch = matches.at(0);
  const lastMatch = matches.at(-1);

  // Should never happen if called correctly, but satisfy linter
  if (!firstMatch || !lastMatch) {
    return {
      file: '',
      line: 0,
      endLine: 0,
      matchCount: 0,
      matchLines: [],
      text: '',
      context: { before: [], match: [], after: [] },
    };
  }

  // Calculate line ranges
  const beforeStart = Math.max(1, firstMatch.line - contextLines);
  const afterEnd = Math.min(lines.length, lastMatch.line + contextLines);
  const maxLineNum = afterEnd; // For padding calculation

  // Build context.before: lines before the first match
  const beforeLines: string[] = [];
  for (let i = beforeStart; i < firstMatch.line; i++) {
    beforeLines.push(formatLineWithNumber(i, lines[i - 1] ?? '', maxLineNum));
  }

  // Build context.match: all lines from first to last match (inclusive)
  const matchLineTexts: string[] = [];
  for (let i = firstMatch.line; i <= lastMatch.line; i++) {
    matchLineTexts.push(formatLineWithNumber(i, lines[i - 1] ?? '', maxLineNum));
  }

  // Build context.after: lines after the last match
  const afterLines: string[] = [];
  for (let i = lastMatch.line + 1; i <= afterEnd; i++) {
    afterLines.push(formatLineWithNumber(i, lines[i - 1] ?? '', maxLineNum));
  }

  // Build text showing matched content
  const matchTexts = matches.map((m) => m.text);
  const uniqueTexts = [...new Set(matchTexts)];
  const firstText = matchTexts.at(0) ?? '';
  const firstUnique = uniqueTexts.at(0) ?? '';

  let text: string;
  if (matches.length === 1) {
    text = firstText;
  } else if (uniqueTexts.length === 1) {
    // All matches are the same text
    text = `"${firstUnique}" (×${matches.length} in lines ${firstMatch.line}-${lastMatch.line})`;
  } else {
    // Different matched texts
    text = `${matches.length} matches: ${uniqueTexts
      .slice(0, 3)
      .map((t) => `"${t}"`)
      .join(', ')}${uniqueTexts.length > 3 ? '...' : ''}`;
  }

  return {
    file: '', // Will be set by caller
    line: firstMatch.line,
    endLine: lastMatch.line,
    matchCount: matches.length,
    matchLines: matches.map((m) => m.line),
    text,
    context: {
      before: beforeLines,
      match: matchLineTexts,
      after: afterLines,
    },
  };
}

async function searchInFile(
  _absPath: string,
  relativePath: string,
  content: string,
  patternOrPreset: string,
  options: {
    patternMode: PatternMode;
    multiline: boolean;
    wholeWord: boolean;
    context: number;
    maxMatches: number;
    isPreset?: boolean;
  },
): Promise<SearchMatch[]> {
  let matches: MatchResult[];

  if (options.isPreset && isPresetPattern(patternOrPreset)) {
    matches = findPresetMatches(content, patternOrPreset, {
      maxMatches: options.maxMatches,
    });
  } else {
    matches = findMatches(content, patternOrPreset, options.patternMode, {
      multiline: options.multiline,
      wholeWord: options.wholeWord,
      maxMatches: options.maxMatches,
    });
  }

  // Cluster nearby matches to reduce redundancy
  const clustered = clusterMatches(matches, content, options.context);

  // Set file path on all results
  return clustered.map((cluster) => ({
    ...cluster,
    file: relativePath,
  }));
}

async function searchDirectory(
  absPath: string,
  relativePath: string,
  patternOrPreset: string,
  options: {
    patternMode: PatternMode;
    multiline: boolean;
    wholeWord: boolean;
    context: number;
    depth: number;
    types?: string[];
    exclude?: string[];
    respectIgnore: boolean;
    output: 'full' | 'list' | 'count' | 'summary';
    maxMatches: number;
    maxFiles: number;
    isPreset?: boolean;
  },
): Promise<FsReadResult> {
  const allMatches: SearchMatch[] = [];
  const fileCounts: Record<string, number> = {};
  let filesSearched = 0;
  let truncated = false;

  const ignoreMatcher = options.respectIgnore ? await createIgnoreMatcherForDir(absPath) : null;

  async function walk(dir: string, relDir: string, currentDepth: number): Promise<void> {
    if (currentDepth > options.depth) {
      return;
    }
    
    const filesMatched = Object.keys(fileCounts).length;
    if (filesMatched >= options.maxFiles || allMatches.length >= options.maxMatches) {
      truncated = true;
      return;
    }

    let items: string[];
    try {
      items = await fs.readdir(dir);
    } catch {
      return;
    }

    for (const item of items) {
      const filesMatchedInLoop = Object.keys(fileCounts).length;
      if (filesMatchedInLoop >= options.maxFiles || allMatches.length >= options.maxMatches) {
        truncated = true;
        break;
      }

      const itemPath = path.join(dir, item);
      const itemRelPath = relDir ? path.join(relDir, item) : item;

      if (ignoreMatcher?.isIgnored(itemRelPath)) continue;
      if (options.exclude && shouldExclude(itemRelPath, options.exclude)) continue;

      try {
        const stat = await fs.stat(itemPath);

        if (stat.isDirectory()) {
          await walk(itemPath, itemRelPath, currentDepth + 1);
        } else if (stat.isFile() && isTextFile(itemPath)) {
          if (options.types && options.types.length > 0) {
            if (!matchesType(item, options.types)) continue;
          }

          filesSearched++;
          
          // Check if filename matches the pattern (case-insensitive, skip for presets)
          const filenameMatches = !options.isPreset && 
            item.toLowerCase().includes(patternOrPreset.toLowerCase());
          
          const content = await fs.readFile(itemPath, 'utf8');
          const fileMatches = await searchInFile(itemPath, itemRelPath, content, patternOrPreset, {
            patternMode: options.patternMode,
            multiline: options.multiline,
            wholeWord: options.wholeWord,
            context: options.context,
            maxMatches: options.maxMatches - allMatches.length,
            isPreset: options.isPreset,
          });

          if (fileMatches.length > 0) {
            fileCounts[itemRelPath] = fileMatches.length;
            allMatches.push(...fileMatches);
          } else if (filenameMatches) {
            // Filename matches but no content matches — add a filename-only result
            fileCounts[itemRelPath] = 1;
            allMatches.push({
              file: itemRelPath,
              line: 0,
              endLine: 0,
              matchCount: 1,
              matchLines: [],
              text: `Filename contains "${patternOrPreset}"`,
              context: { before: [], match: [], after: [] },
            });
          }
        }
      } catch {
        // Skip errors
      }
    }
  }

  await walk(absPath, relativePath === '.' ? '' : relativePath, 1);

  const filesMatched = Object.keys(fileCounts).length;

  // Build result based on output mode
  if (options.output === 'summary') {
    return {
      success: true,
      path: relativePath,
      type: 'search',
      stats: {
        filesSearched,
        filesMatched,
        totalMatches: allMatches.length,
      },
      truncated,
      hint: `Searched ${filesSearched} files, found ${allMatches.length} matches in ${filesMatched} files.${truncated ? ' Results truncated — narrow your search for complete results.' : ''} Use output="full" to see match details.`,
    };
  }

  if (options.output === 'count') {
    return {
      success: true,
      path: relativePath,
      type: 'search',
      matchCount: allMatches.length,
      filesSearched,
      matches: Object.entries(fileCounts).map(([file, count]) => ({
        file,
        line: 0,
        endLine: 0,
        matchCount: count,
        matchLines: [],
        text: `${count} matches`,
        context: { before: [], match: [], after: [] },
      })),
      truncated,
      hint: `Found ${allMatches.length} matches across ${filesMatched} files. Use output="full" to see match content with context.`,
    };
  }

  if (options.output === 'list') {
    return {
      success: true,
      path: relativePath,
      type: 'search',
      matchCount: allMatches.length,
      filesSearched,
      matches: Object.keys(fileCounts).map((file) => ({
        file,
        line: 0,
        endLine: 0,
        matchCount: fileCounts[file] ?? 0,
        matchLines: [],
        text: '',
        context: { before: [], match: [], after: [] },
      })),
      truncated,
      hint: `Found matches in ${filesMatched} files. Use output="full" to see match details, or fs_read on a specific file.`,
    };
  }

  // Full output - build informative hint
  const totalRawMatches = allMatches.reduce((sum, m) => sum + m.matchCount, 0);

  let hint: string;
  if (allMatches.length === 0) {
    hint = `No matches found for "${patternOrPreset}" in ${filesSearched} files. Try a different pattern or check the path.`;
  } else if (allMatches.length === 1 && allMatches[0]?.matchCount === 1) {
    const m = allMatches[0];
    const contextStart = Math.max(1, m.line - 20);
    const contextEnd = m.line + 20;
    hint =
      `Found 1 match in ${m.file} at line ${m.line}. ` +
      `To see more context: fs_read with lines="${contextStart}-${contextEnd}". ` +
      `To edit: use fs_write with checksum and lines="${m.line}".`;
  } else {
    // Build example for first match
    const firstMatch = allMatches.at(0);
    const exampleLine = firstMatch?.line ?? 1;
    const exampleStart = Math.max(1, exampleLine - 20);
    const exampleEnd = exampleLine + 20;

    const clusterInfo =
      allMatches.length < totalRawMatches
        ? ` (${totalRawMatches} total occurrences grouped into ${allMatches.length} regions - nearby matches are clustered)`
        : '';
    hint =
      `Found ${allMatches.length} match regions${clusterInfo} in ${filesMatched} files. ` +
      `Each result shows: line (start), endLine (end of cluster), matchCount, matchLines (exact line numbers). ` +
      `To expand context around a match, e.g. line ${exampleLine}: use lines="${exampleStart}-${exampleEnd}".`;
  }

  return {
    success: true,
    path: relativePath,
    type: 'search',
    matches: allMatches,
    matchCount: totalRawMatches,
    filesSearched,
    truncated,
    hint,
  };
}

async function findFiles(
  absPath: string,
  relativePath: string,
  findPattern: string,
  options: {
    depth: number;
    exclude?: string[];
    respectIgnore: boolean;
    maxFiles: number;
  },
): Promise<FsReadResult> {
  const foundFiles: TreeEntry[] = [];
  let truncated = false;

  const ignoreMatcher = options.respectIgnore ? await createIgnoreMatcherForDir(absPath) : null;

  // Convert find pattern to regex
  // Support simple wildcards: * matches anything, ? matches single char
  const regexPattern = findPattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special chars except * and ?
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  const findRegex = new RegExp(`^${regexPattern}$`, 'i');

  async function walk(dir: string, relDir: string, currentDepth: number): Promise<void> {
    if (currentDepth > options.depth || foundFiles.length >= options.maxFiles) {
      if (foundFiles.length >= options.maxFiles) truncated = true;
      return;
    }

    let items: string[];
    try {
      items = await fs.readdir(dir);
    } catch {
      return;
    }

    for (const item of items) {
      if (foundFiles.length >= options.maxFiles) {
        truncated = true;
        break;
      }

      const itemPath = path.join(dir, item);
      const itemRelPath = relDir ? path.join(relDir, item) : item;

      if (ignoreMatcher?.isIgnored(itemRelPath)) continue;
      if (options.exclude && shouldExclude(itemRelPath, options.exclude)) continue;

      try {
        const stat = await fs.stat(itemPath);

        if (stat.isDirectory()) {
          // Check if directory name matches
          if (findRegex.test(item)) {
            foundFiles.push({
              path: itemRelPath,
              kind: 'directory',
              modified: formatRelativeTime(stat.mtime),
            });
          }
          await walk(itemPath, itemRelPath, currentDepth + 1);
        } else if (stat.isFile()) {
          // Check if filename matches
          if (findRegex.test(item)) {
            foundFiles.push({
              path: itemRelPath,
              kind: 'file',
              size: formatSize(stat.size),
              modified: formatRelativeTime(stat.mtime),
            });
          }
        }
      } catch {
        // Skip errors
      }
    }
  }

  await walk(absPath, relativePath === '.' ? '' : relativePath, 1);

  return {
    success: true,
    path: relativePath,
    type: 'directory',
    tree: {
      entries: foundFiles,
      summary: `Found ${foundFiles.length} item(s) matching "${findPattern}"`,
    },
    truncated,
    hint:
      foundFiles.length === 0
        ? `No files matching "${findPattern}" found. Try a different pattern or increase depth.`
        : foundFiles.length === 1
          ? `Found "${foundFiles[0]?.path}". Use fs_read with this path to see its content.`
          : `Found ${foundFiles.length} matching files. Use fs_read on a specific path to see its content.`,
  };
}

// ─────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────

export const fsReadTool = {
  name: 'fs_read',
  description: `Explore directories, read files, find files by name, or search content.

🔒 SANDBOXED FILESYSTEM — This tool can ONLY access specific mounted directories.
   You CANNOT access arbitrary system paths like /Users or C:\\.
   Always start with fs_read(".") to see available mounts.

⚠️ ALWAYS read a file BEFORE answering questions about its content.
⚠️ ALWAYS read a file BEFORE modifying it (you need the checksum).

MODES (automatically detected):

1. DIRECTORY EXPLORATION — path to directory
   Returns: Tree structure with file sizes and modification times.
   Use to: Understand layout, plan navigation.

2. FILE READING — path to file
   Returns: Full content with LINE NUMBERS and CHECKSUM.
   Use to: See exact content before editing, get line numbers for precise edits.

3. FIND FILES BY NAME — path + find
   Example: { path: ".", find: "mega.md" } or { path: ".", find: "*.md" }
   Returns: List of matching file paths anywhere under the directory.
   Use to: Locate a file when you know its name but not its location.

4. SEARCH CONTENT — path + pattern OR path + preset
   Returns: Matching lines with context and line numbers.
   Use to: Find specific content inside files.

PRESET PATTERNS (for Obsidian/Markdown):
- preset="wikilinks" → find [[links]]
- preset="tags" → find #tags
- preset="tasks" → find all tasks (- [ ] and - [x])
- preset="tasks_open" → find incomplete tasks only
- preset="tasks_done" → find completed tasks only
- preset="headings" → find # headings
- preset="codeblocks" → find \`\`\` blocks
- preset="frontmatter" → find YAML ---

TIPS:
- Use 'find' to locate files: { path: ".", find: "config.json" }
- Use 'pattern' for custom search: { path: ".", pattern: "TODO" }
- Use 'preset' for common patterns: { path: ".", preset: "tasks_open" }
- Note the CHECKSUM when reading a file you plan to edit
- Line numbers are 1-indexed (first line is 1)`,

  inputSchema: fsReadInputSchema,

  handler: async (args: unknown, _extra: HandlerExtra): Promise<CallToolResult> => {
    // Validate
    const parsed = fsReadInputSchema.safeParse(args);
    if (!parsed.success) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Invalid input: ${parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
          },
        ],
      };
    }

    const input = parsed.data;

    // Special case: root path shows mount listing (or single mount contents)
    if (isRootPath(input.path) && !input.find && !input.pattern && !input.preset) {
      const result = await listMountsOrSingleMount(input.depth, {
        types: input.types,
        exclude: input.exclude,
        respectIgnore: input.respectIgnore,
        maxFiles: input.maxFiles,
        details: input.details,
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    // Determine effective pattern (from pattern or preset)
    const searchPattern = input.pattern ?? input.preset;
    const isPreset = Boolean(input.preset);

    // For find/pattern/preset on root, search all mounts
    if (isRootPath(input.path) && (input.find || searchPattern)) {
      const mounts = getMounts();
      let result: FsReadResult;

      if (input.find) {
        // Find across all mounts
        const allEntries: TreeEntry[] = [];
        let anyTruncated = false;

        for (const mount of mounts) {
          const findResult = await findFiles(mount.absolutePath, mount.name, input.find, {
            depth: input.depth,
            exclude: input.exclude,
            respectIgnore: input.respectIgnore,
            maxFiles: Math.floor(input.maxFiles / mounts.length),
          });
          if (findResult.tree?.entries) {
            allEntries.push(...findResult.tree.entries);
          }
          if (findResult.truncated) anyTruncated = true;
        }

        result = {
          success: true,
          path: '.',
          type: 'directory',
          tree: {
            entries: allEntries,
            summary: `Found ${allEntries.length} item(s) matching "${input.find}" across all mounts`,
          },
          truncated: anyTruncated,
          hint:
            allEntries.length === 0
              ? `No files matching "${input.find}" found. Try a different pattern or increase depth.`
              : allEntries.length === 1
                ? `Found "${allEntries[0]?.path}". Use fs_read with this path to see its content.`
                : `Found ${allEntries.length} matching files. Use fs_read on a specific path to see its content.`,
        };
      } else if (searchPattern) {
        // Search content across all mounts (pattern or preset)
        const displayPattern = isPreset ? `preset:${searchPattern}` : searchPattern;
        const allMatches: SearchMatch[] = [];
        let totalFilesSearched = 0;
        let anyTruncated = false;

        for (const mount of mounts) {
          const searchResult = await searchDirectory(
            mount.absolutePath,
            mount.name,
            searchPattern,
            {
              patternMode: input.patternMode as PatternMode,
              multiline: input.multiline,
              wholeWord: input.wholeWord,
              context: input.context,
              depth: input.depth,
              types: input.types,
              exclude: input.exclude,
              respectIgnore: input.respectIgnore,
              output: input.output,
              maxMatches: Math.floor(input.maxMatches / mounts.length),
              maxFiles: Math.floor(input.maxFiles / mounts.length),
              isPreset,
            },
          );
          if (searchResult.matches) {
            allMatches.push(...searchResult.matches);
          }
          if (searchResult.filesSearched) totalFilesSearched += searchResult.filesSearched;
          if (searchResult.truncated) anyTruncated = true;
        }

        result = {
          success: true,
          path: '.',
          type: 'search',
          matches: allMatches,
          matchCount: allMatches.length,
          filesSearched: totalFilesSearched,
          truncated: anyTruncated,
          hint:
            allMatches.length === 0
              ? `No matches found for ${displayPattern} in ${totalFilesSearched} files across all mounts.`
              : `Found ${allMatches.length} matches for ${displayPattern} in ${totalFilesSearched} files across all mounts.`,
        };
      } else {
        // Should not reach here, but satisfy TypeScript
        result = await listMountsOrSingleMount(input.depth, {
          types: input.types,
          exclude: input.exclude,
          respectIgnore: input.respectIgnore,
          maxFiles: input.maxFiles,
          details: input.details,
        });
      }

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    // Resolve virtual path to real path
    const resolved = resolveVirtualPath(input.path);
    if (!resolved.ok) {
      const mounts = getMounts();
      const mountExamples = mounts
        .slice(0, 2)
        .map((m) => `"${m.name}/"`)
        .join(' or ');

      // Detect if user tried an absolute path
      const isAbsolute = input.path.startsWith('/') || /^[a-zA-Z]:[/\\]/.test(input.path);

      const result: FsReadResult = {
        success: false,
        path: input.path,
        type: 'file',
        error: { code: 'OUT_OF_SCOPE', message: resolved.error },
        hint: isAbsolute
          ? `This is a SANDBOXED filesystem — you cannot access arbitrary system paths. ` +
            `Start with fs_read(".") to see available mounts, then explore from there.`
          : `Path not found. Try fs_read(".") to see available mounts, or fs_read(${mountExamples}) to explore a mount.`,
      };
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    const { absolutePath, virtualPath } = resolved.resolved;

    // Check if path exists
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(absolutePath);
    } catch {
      const result: FsReadResult = {
        success: false,
        path: virtualPath,
        type: 'file',
        error: { code: 'NOT_FOUND', message: `Path does not exist: ${virtualPath}` },
        hint: 'Use fs_read on the parent directory to see what exists, or fs_read(".") to see mount points.',
      };
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    let result: FsReadResult;

    if (stat.isDirectory()) {
      if (input.find) {
        // Find files by name
        result = await findFiles(absolutePath, virtualPath, input.find, {
          depth: input.depth,
          exclude: input.exclude,
          respectIgnore: input.respectIgnore,
          maxFiles: input.maxFiles,
        });
      } else if (searchPattern) {
        // Search in directory (pattern or preset)
        result = await searchDirectory(absolutePath, virtualPath, searchPattern, {
          patternMode: input.patternMode as PatternMode,
          multiline: input.multiline,
          wholeWord: input.wholeWord,
          context: input.context,
          depth: input.depth,
          types: input.types,
          exclude: input.exclude,
          respectIgnore: input.respectIgnore,
          output: input.output,
          maxMatches: input.maxMatches,
          maxFiles: input.maxFiles,
          isPreset,
        });
      } else {
        // List directory
        const { entries, truncated } = await listDirectory(absolutePath, virtualPath, input.depth, {
          types: input.types,
          exclude: input.exclude,
          respectIgnore: input.respectIgnore,
          maxFiles: input.maxFiles,
          details: input.details,
        });

        const fileCount = entries.filter((e) => e.kind === 'file').length;
        const dirCount = entries.filter((e) => e.kind === 'directory').length;

        result = {
          success: true,
          path: input.path,
          type: 'directory',
          tree: {
            entries,
            summary: `${entries.length} items (${fileCount} files, ${dirCount} directories)`,
          },
          truncated,
          hint:
            entries.length === 0
              ? 'Directory is empty or all files are ignored.'
              : `Found ${entries.length} items. Use fs_read on a file path to see its content, or on a subdirectory to explore deeper.`,
        };
      }
    } else if (stat.isFile()) {
      if (searchPattern) {
        // Search in single file (pattern or preset)
        if (!isTextFile(absolutePath)) {
          result = {
            success: false,
            path: virtualPath,
            type: 'file',
            error: { code: 'NOT_TEXT', message: 'Cannot search in binary files' },
            hint: 'Only text files can be searched.',
          };
        } else {
          const content = await fs.readFile(absolutePath, 'utf8');
          const matches = await searchInFile(absolutePath, virtualPath, content, searchPattern, {
            patternMode: input.patternMode as PatternMode,
            multiline: input.multiline,
            wholeWord: input.wholeWord,
            context: input.context,
            maxMatches: input.maxMatches,
            isPreset,
          });

          const checksum = generateChecksum(content);
          const displayPattern = isPreset ? `preset:${searchPattern}` : `"${searchPattern}"`;
          const totalRawMatches = matches.reduce((sum, m) => sum + m.matchCount, 0);

          let searchHint: string;
          if (matches.length === 0) {
            searchHint = `No matches for ${displayPattern} in this file.${isPreset ? '' : ' Try a different pattern or patternMode="fuzzy".'}`;
          } else {
            const firstMatch = matches.at(0);
            const exampleLine = firstMatch?.line ?? 1;
            const exampleStart = Math.max(1, exampleLine - 20);
            const exampleEnd = exampleLine + 20;

            const clusterInfo =
              matches.length < totalRawMatches
                ? ` (${totalRawMatches} total occurrences grouped into ${matches.length} regions)`
                : '';
            searchHint =
              `Found ${matches.length} match region(s)${clusterInfo}. ` +
              `Each result has: line, endLine, matchCount, matchLines (exact positions). ` +
              `To expand context around line ${exampleLine}: use lines="${exampleStart}-${exampleEnd}". ` +
              `Checksum: ${checksum} (required for fs_write).`;
          }

          result = {
            success: true,
            path: input.path,
            type: 'search',
            matches,
            matchCount: totalRawMatches,
            filesSearched: 1,
            truncated: false,
            hint: searchHint,
          };
        }
      } else {
        // Read file
        result = await readFile(absolutePath, virtualPath, { lines: input.lines });
      }
    } else {
      result = {
        success: false,
        path: virtualPath,
        type: 'file',
        error: { code: 'INVALID_TYPE', message: 'Path is not a file or directory' },
        hint: 'Only files and directories can be read.',
      };
    }

    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
};
