/**
 * fs_search Tool
 *
 * Find files by name and search content within files.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import fuzzysort from 'fuzzysort';
import { z } from 'zod';
import {
  createIgnoreMatcherForDir,
  findMatches,
  getMounts,
  isTextFile,
  matchesGlob,
  matchesType,
  resolvePath as resolveVirtualPath,
  searchFiles,
  shouldExclude,
  UnsafeRegexError,
  validatePathChain,
  type MatchResult,
  type PatternMode,
} from '../lib/index.js';
import type { HandlerExtra } from '../types/index.js';

// ─────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────

export const fsSearchInputSchema = z
  .object({
    path: z
      .string()
      .min(1)
      .describe('Starting directory. Use "." for all mounts, or "vault/" for specific mount.'),

    query: z
      .string()
      .min(1)
      .describe(
        'Search term for both filename matching (fuzzy) and content search. ' +
          'Examples: "config", "TODO", "function.*export" (with patternMode="regex").',
      ),

    target: z
      .enum(['all', 'filename', 'content'])
      .optional()
      .default('all')
      .describe('What to search. Default "all" (filename + content).'),

    patternMode: z
      .enum(['literal', 'regex', 'fuzzy'])
      .optional()
      .default('literal')
      .describe(
        'How to interpret query: "literal" (exact text), "regex" (regular expression, use for OR: "a|b"), ' +
          '"fuzzy" (flexible whitespace). Default "literal".',
      ),

    caseInsensitive: z
      .boolean()
      .optional()
      .default(false)
      .describe('Ignore case in content search (filename search is always case-insensitive). Default false.'),

    wholeWord: z
      .boolean()
      .optional()
      .default(false)
      .describe('Match whole words only for content search. Default false.'),

    multiline: z
      .boolean()
      .optional()
      .default(false)
      .describe('Allow content matches to span multiple lines. Default false.'),

    types: z
      .array(z.string())
      .optional()
      .describe('Filter by file type or extension. Examples: ["ts", "md"].'),

    glob: z.string().optional().describe('Glob pattern filter. Example: "**/*.ts".'),

    exclude: z
      .array(z.string())
      .optional()
      .describe('Patterns to exclude. Example: ["**/test/**", "**/*.spec.ts"].'),

    depth: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .default(5)
      .describe('Max directory traversal depth. Default 5.'),

    maxResults: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .optional()
      .default(100)
      .describe('Limit results (default 100).'),

    context: z
      .number()
      .int()
      .min(0)
      .max(20)
      .optional()
      .default(3)
      .describe('Context lines for content matches (default 3).'),

    respectIgnore: z
      .boolean()
      .optional()
      .default(true)
      .describe('Respect .gitignore and .ignore files. Default true.'),
  })
  .passthrough();

export type FsSearchInput = z.infer<typeof fsSearchInputSchema>;

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface FilenameMatch {
  path: string;
  score: number;
  matchIndices: number[];
}

interface ContentMatch {
  line: number;
  endLine: number;
  matchCount: number;
  text: string;
  context: {
    before: string[];
    match: string[];
    after: string[];
  };
}

interface ContentFileResult {
  path: string;
  matches: ContentMatch[];
}

interface FsSearchResult {
  success: boolean;
  query: string;
  target: 'all' | 'filename' | 'content';
  results: {
    byFilename: FilenameMatch[];
    byContent: ContentFileResult[];
  };
  stats: {
    filenameMatches: number;
    contentMatches: number;
    filesSearched: number;
  };
  truncated: boolean;
  error?: {
    code: string;
    message: string;
  };
  hint: string;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

const CLUSTER_DISTANCE = 5;

function isRootPath(pathStr: string): boolean {
  const trimmed = pathStr.trim();
  return trimmed === '.' || trimmed === '' || trimmed === '/';
}

function formatLineWithNumber(lineNum: number, text: string, maxLineNum: number): string {
  const padding = String(maxLineNum).length;
  return `${String(lineNum).padStart(padding)}|${text}`;
}

function buildClusterResult(matches: MatchResult[], content: string, contextLines: number): ContentMatch {
  const lines = content.split('\n');
  const firstMatch = matches.at(0);
  const lastMatch = matches.at(-1);

  if (!firstMatch || !lastMatch) {
    return {
      line: 0,
      endLine: 0,
      matchCount: 0,
      text: '',
      context: { before: [], match: [], after: [] },
    };
  }

  // Calculate line ranges
  const beforeStart = Math.max(1, firstMatch.line - contextLines);
  const afterEnd = Math.min(lines.length, lastMatch.line + contextLines);
  const maxLineNum = afterEnd;

  const beforeLines: string[] = [];
  for (let i = beforeStart; i < firstMatch.line; i++) {
    beforeLines.push(formatLineWithNumber(i, lines[i - 1] ?? '', maxLineNum));
  }

  const matchLineTexts: string[] = [];
  for (let i = firstMatch.line; i <= lastMatch.line; i++) {
    matchLineTexts.push(formatLineWithNumber(i, lines[i - 1] ?? '', maxLineNum));
  }

  const afterLines: string[] = [];
  for (let i = lastMatch.line + 1; i <= afterEnd; i++) {
    afterLines.push(formatLineWithNumber(i, lines[i - 1] ?? '', maxLineNum));
  }

  const matchTexts = matches.map((m) => m.text);
  const uniqueTexts = [...new Set(matchTexts)];
  const firstText = matchTexts.at(0) ?? '';
  const firstUnique = uniqueTexts.at(0) ?? '';

  let text: string;
  if (matches.length === 1) {
    text = firstText;
  } else if (uniqueTexts.length === 1) {
    text = `"${firstUnique}" (×${matches.length} in lines ${firstMatch.line}-${lastMatch.line})`;
  } else {
    text = `${matches.length} matches: ${uniqueTexts
      .slice(0, 3)
      .map((t) => `"${t}"`)
      .join(', ')}${uniqueTexts.length > 3 ? '...' : ''}`;
  }

  return {
    line: firstMatch.line,
    endLine: lastMatch.line,
    matchCount: matches.length,
    text,
    context: {
      before: beforeLines,
      match: matchLineTexts,
      after: afterLines,
    },
  };
}

function clusterMatches(matches: MatchResult[], content: string, contextLines: number): ContentMatch[] {
  if (matches.length === 0) return [];

  const sorted = [...matches].sort((a, b) => a.line - b.line);
  const first = sorted.at(0);
  if (!first) return [];

  const clusters: ContentMatch[] = [];
  let currentCluster: MatchResult[] = [first];

  for (let i = 1; i < sorted.length; i++) {
    const match = sorted.at(i);
    const lastInCluster = currentCluster.at(-1);
    if (!match || !lastInCluster) continue;

    if (match.line - lastInCluster.line <= CLUSTER_DISTANCE) {
      currentCluster.push(match);
    } else {
      clusters.push(buildClusterResult(currentCluster, content, contextLines));
      currentCluster = [match];
    }
  }

  clusters.push(buildClusterResult(currentCluster, content, contextLines));

  return clusters;
}

function joinVirtualPath(base: string, relative: string): string {
  if (!base || base === '.') return relative;
  if (!relative || relative === '.') return base;
  return path.join(base, relative);
}

function matchFilename(query: string, filename: string): { score: number; matchIndices: number[] } | null {
  const result = fuzzysort.single(query.toLowerCase(), filename.toLowerCase());
  if (!result) return null;
  return { score: result.score, matchIndices: result.indexes ?? [] };
}

async function searchContentInFile(
  content: string,
  query: string,
  options: {
    patternMode: PatternMode;
    multiline: boolean;
    wholeWord: boolean;
    caseInsensitive: boolean;
    context: number;
    maxResults: number;
  },
): Promise<{ clusters: ContentMatch[]; matchCount: number; error?: string }> {
  try {
    const maxMatches = Math.max(options.maxResults, options.maxResults * 5);
    const matches = findMatches(content, query, options.patternMode, {
      multiline: options.multiline,
      wholeWord: options.wholeWord,
      caseInsensitive: options.caseInsensitive,
      maxMatches,
    });

    const clusters = clusterMatches(matches, content, options.context);
    const matchCount = clusters.reduce((sum, cluster) => sum + cluster.matchCount, 0);

    return { clusters, matchCount };
  } catch (err) {
    if (err instanceof UnsafeRegexError) {
      return { clusters: [], matchCount: 0, error: err.message };
    }
    throw err;
  }
}

const SEARCH_CONCURRENCY = 10;

interface FileToSearch {
  absPath: string;
  relPath: string;
}

async function searchContentInDirectory(
  absPath: string,
  virtualPath: string,
  options: {
    query: string;
    patternMode: PatternMode;
    multiline: boolean;
    wholeWord: boolean;
    caseInsensitive: boolean;
    context: number;
    depth: number;
    types?: string[];
    glob?: string;
    exclude?: string[];
    respectIgnore: boolean;
    maxResults: number;
    remainingClusters: number;
  },
): Promise<{
  results: ContentFileResult[];
  filesSearched: number;
  matchCount: number;
  remainingClusters: number;
  truncated: boolean;
  error?: string;
}> {
  // Phase 1: Collect all files to search
  const filesToSearch: FileToSearch[] = [];
  let truncatedCollection = false;
  const MAX_FILES_TO_COLLECT = 10_000;

  const ignoreMatcher = options.respectIgnore ? await createIgnoreMatcherForDir(absPath) : null;

  async function collectFiles(dir: string, relDir: string, currentDepth: number): Promise<void> {
    if (currentDepth > options.depth || filesToSearch.length >= MAX_FILES_TO_COLLECT) {
      truncatedCollection = filesToSearch.length >= MAX_FILES_TO_COLLECT;
      return;
    }

    let items: string[];
    try {
      items = await fs.readdir(dir);
    } catch {
      return;
    }

    for (const item of items) {
      if (filesToSearch.length >= MAX_FILES_TO_COLLECT) {
        truncatedCollection = true;
        break;
      }

      const itemPath = path.join(dir, item);
      const itemRelPath = relDir ? path.join(relDir, item) : item;

      if (ignoreMatcher?.isIgnored(itemRelPath)) continue;
      if (options.exclude && shouldExclude(itemRelPath, options.exclude)) continue;

      try {
        const stat = await fs.stat(itemPath);

        if (stat.isDirectory()) {
          if (currentDepth < options.depth) {
            await collectFiles(itemPath, itemRelPath, currentDepth + 1);
          }
        } else if (stat.isFile() && isTextFile(itemPath)) {
          if (options.types && options.types.length > 0) {
            if (!matchesType(item, options.types)) continue;
          }
          if (options.glob && !matchesGlob(itemRelPath, options.glob)) continue;

          filesToSearch.push({ absPath: itemPath, relPath: itemRelPath });
        }
      } catch {
        // Skip errors
      }
    }
  }

  await collectFiles(absPath, '', 1);

  // Phase 2: Search files concurrently
  const results: ContentFileResult[] = [];
  let filesSearched = 0;
  let matchCount = 0;
  let truncated = truncatedCollection;
  let remainingClusters = options.remainingClusters;

  // Process files in batches with concurrency
  const processFile = async (file: FileToSearch): Promise<ContentFileResult | null> => {
    try {
      const content = await fs.readFile(file.absPath, 'utf8');
      const searchResult = await searchContentInFile(content, options.query, {
        patternMode: options.patternMode,
        multiline: options.multiline,
        wholeWord: options.wholeWord,
        caseInsensitive: options.caseInsensitive,
        context: options.context,
        maxResults: options.maxResults,
      });

      if (searchResult.error || searchResult.clusters.length === 0) {
        return null;
      }

      return {
        path: joinVirtualPath(virtualPath, file.relPath),
        matches: searchResult.clusters,
      };
    } catch {
      return null;
    }
  };

  // Process in concurrent batches
  for (let i = 0; i < filesToSearch.length && remainingClusters > 0; i += SEARCH_CONCURRENCY) {
    const batch = filesToSearch.slice(i, i + SEARCH_CONCURRENCY);
    const batchResults = await Promise.all(batch.map(processFile));

    for (const result of batchResults) {
      filesSearched++;

      if (result && result.matches.length > 0) {
        let fileClusters = result.matches;
        if (fileClusters.length > remainingClusters) {
          fileClusters = fileClusters.slice(0, remainingClusters);
          truncated = true;
        }

        remainingClusters -= fileClusters.length;
        matchCount += fileClusters.reduce((sum, cluster) => sum + cluster.matchCount, 0);

        results.push({
          path: result.path,
          matches: fileClusters,
        });

        if (remainingClusters <= 0) {
          truncated = true;
          break;
        }
      }
    }
  }

  return {
    results,
    filesSearched,
    matchCount,
    remainingClusters,
    truncated,
  };
}

// ─────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────

export const fsSearchTool = {
  name: 'fs_search',
  description: `Find files by name and search file content.

🔍 DEFAULT: target="all" searches BOTH filenames AND content in one call.

PATTERN MODES (for content search):
- literal (default): Exact text match. "foo|bar" finds literal "foo|bar"
- regex: Regular expression. "foo|bar" finds "foo" OR "bar"
- fuzzy: Flexible whitespace. "hello  world" matches "hello world"

⚠️ FOR OR SEARCHES: Use patternMode="regex" with "term1|term2"

WORKFLOW:
1. fs_search to locate files/content
2. fs_read to inspect matches and get checksum
3. fs_write to make edits

EXAMPLES:
- Find files: { path: ".", query: "config" }
- Search content: { path: ".", query: "TODO", target: "content" }
- Regex OR search: { path: ".", query: "error|warning", patternMode: "regex" }`,

  inputSchema: fsSearchInputSchema,

  handler: async (args: unknown, _extra: HandlerExtra): Promise<CallToolResult> => {
    const parsed = fsSearchInputSchema.safeParse(args);
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
    const target = input.target ?? 'all';
    const depth = input.depth ?? 5;

    // Early validation: check regex safety for content search
    if ((target === 'all' || target === 'content') && input.patternMode === 'regex') {
      const { isUnsafeRegex } = await import('../lib/index.js');
      if (isUnsafeRegex(input.query)) {
        const result: FsSearchResult = {
          success: false,
          query: input.query,
          target,
          results: { byFilename: [], byContent: [] },
          stats: { filenameMatches: 0, contentMatches: 0, filesSearched: 0 },
          truncated: false,
          error: {
            code: 'UNSAFE_REGEX',
            message: `Regex pattern may cause catastrophic backtracking: "${input.query.slice(0, 50)}${input.query.length > 50 ? '...' : ''}"`,
          },
          hint: 'Simplify your regex pattern. Avoid nested quantifiers like (a+)+, overlapping alternatives, or extremely long patterns.',
        };
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
    }

    const results: FsSearchResult = {
      success: true,
      query: input.query,
      target,
      results: { byFilename: [], byContent: [] },
      stats: { filenameMatches: 0, contentMatches: 0, filesSearched: 0 },
      truncated: false,
      hint: '',
    };

    // Root path: search across all mounts
    if (isRootPath(input.path)) {
      const mounts = getMounts();

      // Filename search across mounts
      if (target === 'all' || target === 'filename') {
        const allFileMatches: FilenameMatch[] = [];

        for (const mount of mounts) {
          const found = await searchFiles(mount.absolutePath, input.query, {
            maxResults: input.maxResults,
            includeDirectories: false,
            respectIgnore: input.respectIgnore,
            exclude: input.exclude,
            maxDepth: depth,
          });

          for (const item of found) {
            if (input.types && input.types.length > 0 && !matchesType(item.relativePath, input.types)) {
              continue;
            }
            if (input.glob && !matchesGlob(item.relativePath, input.glob)) {
              continue;
            }

            allFileMatches.push({
              path: joinVirtualPath(mount.name, item.relativePath),
              score: item.score,
              matchIndices: item.matchIndices,
            });
          }
        }

        allFileMatches.sort((a, b) => b.score - a.score);
        if (allFileMatches.length > input.maxResults) {
          results.truncated = true;
        }
        results.results.byFilename = allFileMatches.slice(0, input.maxResults);
      }

      // Content search across mounts
      if (target === 'all' || target === 'content') {
        let remainingClusters = input.maxResults;
        let totalFilesSearched = 0;
        let totalContentMatches = 0;

        for (const mount of mounts) {
          if (remainingClusters <= 0) {
            results.truncated = true;
            break;
          }

          const contentResult = await searchContentInDirectory(mount.absolutePath, mount.name, {
            query: input.query,
            patternMode: input.patternMode as PatternMode,
            multiline: input.multiline,
            wholeWord: input.wholeWord,
            caseInsensitive: input.caseInsensitive,
            context: input.context,
            depth,
            types: input.types,
            glob: input.glob,
            exclude: input.exclude,
            respectIgnore: input.respectIgnore,
            maxResults: input.maxResults,
            remainingClusters,
          });

          results.results.byContent.push(...contentResult.results);
          totalFilesSearched += contentResult.filesSearched;
          totalContentMatches += contentResult.matchCount;
          remainingClusters = contentResult.remainingClusters;
          if (contentResult.truncated) {
            results.truncated = true;
            break;
          }
        }

        results.stats.filesSearched = totalFilesSearched;
        results.stats.contentMatches = totalContentMatches;
      }

      results.stats.filenameMatches = results.results.byFilename.length;
      results.hint = buildSearchHint(results);

      return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
    }

    // Resolve virtual path to real path
    const resolved = resolveVirtualPath(input.path);
    if (!resolved.ok) {
      const mounts = getMounts();
      const mountExample = mounts[0]?.name ?? 'vault';

      const result: FsSearchResult = {
        success: false,
        query: input.query,
        target,
        results: { byFilename: [], byContent: [] },
        stats: { filenameMatches: 0, contentMatches: 0, filesSearched: 0 },
        truncated: false,
        error: { code: 'OUT_OF_SCOPE', message: resolved.error },
        hint: `Path must be within a mount. Example: "${mountExample}/". Use fs_read(".") to see available mounts.`,
      };
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    const { absolutePath, virtualPath, mount } = resolved.resolved;

    // Security: Validate symlinks don't escape mount
    const symlinkCheck = await validatePathChain(absolutePath, mount);
    if (!symlinkCheck.ok) {
      const result: FsSearchResult = {
        success: false,
        query: input.query,
        target,
        results: { byFilename: [], byContent: [] },
        stats: { filenameMatches: 0, contentMatches: 0, filesSearched: 0 },
        truncated: false,
        error: { code: 'SYMLINK_ESCAPE', message: symlinkCheck.error },
        hint: 'Symlinks pointing outside the mounted directory are not allowed for security.',
      };
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(absolutePath);
    } catch {
      const result: FsSearchResult = {
        success: false,
        query: input.query,
        target,
        results: { byFilename: [], byContent: [] },
        stats: { filenameMatches: 0, contentMatches: 0, filesSearched: 0 },
        truncated: false,
        error: { code: 'NOT_FOUND', message: `Path does not exist: ${virtualPath}` },
        hint: 'Use fs_read on the parent directory to see what exists, or fs_search from a higher-level directory.',
      };
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    if (input.exclude && shouldExclude(virtualPath, input.exclude)) {
      results.hint = 'Path excluded by exclude patterns.';
      return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
    }

    // Filename search
    if (target === 'all' || target === 'filename') {
      if (stat.isDirectory()) {
        const found = await searchFiles(absolutePath, input.query, {
          maxResults: input.maxResults,
          includeDirectories: false,
          respectIgnore: input.respectIgnore,
          exclude: input.exclude,
          maxDepth: depth,
        });

        const filtered = found
          .filter((item) => {
            if (input.types && input.types.length > 0 && !matchesType(item.relativePath, input.types)) {
              return false;
            }
            if (input.glob && !matchesGlob(item.relativePath, input.glob)) {
              return false;
            }
            return true;
          })
          .map((item) => ({
            path: joinVirtualPath(virtualPath, item.relativePath),
            score: item.score,
            matchIndices: item.matchIndices,
          }));

        if (filtered.length >= input.maxResults) {
          results.truncated = true;
        }

        results.results.byFilename = filtered.slice(0, input.maxResults);
      } else if (stat.isFile()) {
        const fileName = path.basename(virtualPath);
        if (input.types && input.types.length > 0 && !matchesType(fileName, input.types)) {
          // skip
        } else if (input.glob && !matchesGlob(virtualPath, input.glob)) {
          // skip
        } else {
          const matched = matchFilename(input.query, fileName);
          if (matched) {
            results.results.byFilename = [
              {
                path: virtualPath,
                score: matched.score,
                matchIndices: matched.matchIndices,
              },
            ];
          }
        }
      }
    }

    // Content search
    if (target === 'all' || target === 'content') {
      if (stat.isDirectory()) {
        const contentResult = await searchContentInDirectory(absolutePath, virtualPath, {
          query: input.query,
          patternMode: input.patternMode as PatternMode,
          multiline: input.multiline,
          wholeWord: input.wholeWord,
          caseInsensitive: input.caseInsensitive,
          context: input.context,
          depth,
          types: input.types,
          glob: input.glob,
          exclude: input.exclude,
          respectIgnore: input.respectIgnore,
          maxResults: input.maxResults,
          remainingClusters: input.maxResults,
        });

        results.results.byContent = contentResult.results;
        results.stats.filesSearched = contentResult.filesSearched;
        results.stats.contentMatches = contentResult.matchCount;
        if (contentResult.truncated) {
          results.truncated = true;
        }
      } else if (stat.isFile()) {
        if (!isTextFile(absolutePath)) {
          results.success = false;
          results.error = { code: 'NOT_TEXT', message: 'Cannot search in binary files' };
          results.hint = 'Only text files can be searched.';
          return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
        }

        if (input.types && input.types.length > 0 && !matchesType(path.basename(virtualPath), input.types)) {
          // skip
        } else if (input.glob && !matchesGlob(virtualPath, input.glob)) {
          // skip
        } else {
          const content = await fs.readFile(absolutePath, 'utf8');
          const { clusters } = await searchContentInFile(content, input.query, {
            patternMode: input.patternMode as PatternMode,
            multiline: input.multiline,
            wholeWord: input.wholeWord,
            caseInsensitive: input.caseInsensitive,
            context: input.context,
            maxResults: input.maxResults,
          });

          let fileClusters = clusters;
          if (clusters.length > input.maxResults) {
            fileClusters = clusters.slice(0, input.maxResults);
            results.truncated = true;
          }

          const trimmedMatchCount = fileClusters.reduce((sum, cluster) => sum + cluster.matchCount, 0);

          results.results.byContent =
            fileClusters.length > 0
              ? [
                  {
                    path: virtualPath,
                    matches: fileClusters,
                  },
                ]
              : [];
          results.stats.filesSearched = 1;
          results.stats.contentMatches = trimmedMatchCount;
        }
      }
    }

    results.stats.filenameMatches = results.results.byFilename.length;
    results.hint = buildSearchHint(results);

    return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
  },
};

function buildSearchHint(result: FsSearchResult): string {
  const filenameMatches = result.results.byFilename.length;
  const contentFileCount = result.results.byContent.length;
  const contentMatches = result.stats.contentMatches;

  let hint = '';
  if (result.target === 'filename') {
    hint = filenameMatches
      ? `Found ${filenameMatches} filename match(es).`
      : 'No filename matches found.';
  } else if (result.target === 'content') {
    hint = contentMatches
      ? `Found ${contentMatches} content match(es) in ${contentFileCount} file(s).`
      : 'No content matches found.';
  } else {
    const filenameHint = filenameMatches
      ? `${filenameMatches} filename match(es)`
      : 'no filename matches';
    const contentHint = contentMatches
      ? `${contentMatches} content match(es) in ${contentFileCount} file(s)`
      : 'no content matches';
    hint = `Found ${filenameHint} and ${contentHint}.`;
  }

  if (result.truncated) {
    hint += ' Results truncated — narrow your search for complete results.';
  }

  return hint;
}
