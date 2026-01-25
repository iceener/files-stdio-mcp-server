/**
 * Fuzzy File Search Engine
 *
 * Inspired by Alice's file_search.rs - provides:
 * - Cached file index with TTL
 * - Fuzzy matching with smart scoring
 * - Multi-term space-separated queries
 * - Auto-resolve for wrong paths
 * - Match indices for UI highlighting
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import fuzzysort from 'fuzzysort';
import { createIgnoreMatcherForDir } from './ignore.js';
import { shouldExclude } from './filetypes.js';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface IndexedFile {
  /** Path relative to root, normalized with forward slashes */
  relativePath: string;
  /** Just the filename */
  fileName: string;
  /** Pre-lowercased path for matching */
  pathLower: string;
  /** Pre-lowercased filename for boosted matching */
  nameLower: string;
  /** Directory depth (segment count) for ranking penalty */
  depth: number;
  /** File extension without dot */
  extension: string;
  /** Whether this is a directory */
  isDirectory: boolean;
  /** Prepared target for fuzzysort (filename) */
  preparedName: Fuzzysort.Prepared;
  /** Prepared target for fuzzysort (path) */
  preparedPath: Fuzzysort.Prepared;
}

export interface FileIndex {
  /** Canonical absolute path to the indexed root */
  root: string;
  /** All indexed entries */
  entries: IndexedFile[];
  /** When this snapshot was built */
  builtAt: number;
  /** Number of files indexed */
  fileCount: number;
}

export interface FileSearchResult {
  /** Absolute path to the file */
  absolutePath: string;
  /** Path relative to the search root */
  relativePath: string;
  /** Just the file name */
  fileName: string;
  /** File extension (without dot) */
  extension: string;
  /** Whether this is a directory */
  isDirectory: boolean;
  /** Fuzzy match score (higher = better match) */
  score: number;
  /** Indices of matched characters for highlighting */
  matchIndices: number[];
}

export interface FileSearchOptions {
  /** Maximum number of results to return */
  maxResults?: number;
  /** Include hidden files (starting with .) */
  includeHidden?: boolean;
  /** Include directories in results */
  includeDirectories?: boolean;
  /** File extensions to filter by (empty = all) */
  extensions?: string[];
  /** Whether to respect .gitignore files */
  respectIgnore?: boolean;
  /** Patterns to exclude */
  exclude?: string[];
  /** Maximum depth to traverse */
  maxDepth?: number;
}

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

/** Default TTL for cached indexes (30 seconds) */
const DEFAULT_INDEX_TTL_MS = 30_000;

/** Maximum number of cached indexes */
const MAX_CACHED_INDEXES = 5;

/** Directories to always exclude (even if not in .gitignore) */
const ALWAYS_EXCLUDE = [
  '.git',
  'node_modules',
  '.svelte-kit',
  '.next',
  '.nuxt',
  '__pycache__',
  'target',
  'dist',
  '.agent-data',
];

// ─────────────────────────────────────────────────────────────
// Scoring Constants (matching Alice's algorithm)
// ─────────────────────────────────────────────────────────────

const SCORE_EXACT_MATCH = 100_000;
const SCORE_PREFIX_MATCH = 10_000;
const SCORE_SUBSTRING_MATCH = 1_000;
const SCORE_FILENAME_WEIGHT = 2;
const SCORE_DEPTH_PENALTY = 10;

/** Extension boost for code files */
function getExtensionBoost(ext: string): number {
  switch (ext.toLowerCase()) {
    case 'rs':
    case 'ts':
    case 'tsx':
    case 'svelte':
    case 'js':
    case 'jsx':
    case 'vue':
      return 50;
    case 'py':
    case 'go':
    case 'java':
    case 'kt':
    case 'c':
    case 'cpp':
    case 'h':
    case 'hpp':
    case 'cs':
      return 40;
    case 'rb':
    case 'php':
    case 'swift':
    case 'scala':
    case 'clj':
      return 35;
    case 'html':
    case 'css':
    case 'scss':
    case 'sass':
    case 'less':
      return 30;
    case 'json':
    case 'toml':
    case 'yaml':
    case 'yml':
      return 20;
    case 'md':
    case 'txt':
    case 'rst':
      return 10;
    default:
      return 0;
  }
}

// ─────────────────────────────────────────────────────────────
// FileIndexManager - Singleton cache for indexes
// ─────────────────────────────────────────────────────────────

class FileIndexManager {
  private indexes: Map<string, FileIndex> = new Map();
  private ttlMs: number;

  constructor(ttlMs = DEFAULT_INDEX_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  /** Check if an index has expired */
  private isExpired(index: FileIndex): boolean {
    return Date.now() - index.builtAt > this.ttlMs;
  }

  /** Evict oldest entries if cache is too large */
  private evictIfNeeded(): void {
    while (this.indexes.size >= MAX_CACHED_INDEXES) {
      let oldest: { key: string; builtAt: number } | null = null;
      for (const [key, index] of this.indexes) {
        if (!oldest || index.builtAt < oldest.builtAt) {
          oldest = { key, builtAt: index.builtAt };
        }
      }
      if (oldest) {
        this.indexes.delete(oldest.key);
      } else {
        break;
      }
    }
  }

  /** Get or build index for a directory */
  async getOrBuild(root: string, options: FileSearchOptions = {}): Promise<FileIndex> {
    const canonical = path.resolve(root);

    // Check cache
    const cached = this.indexes.get(canonical);
    if (cached && !this.isExpired(cached)) {
      return cached;
    }

    // Build new index
    const index = await this.buildIndex(canonical, options);

    // Evict old entries if needed
    this.evictIfNeeded();

    // Store in cache
    this.indexes.set(canonical, index);

    return index;
  }

  /** Force rebuild of an index */
  async rebuild(root: string, options: FileSearchOptions = {}): Promise<FileIndex> {
    const canonical = path.resolve(root);
    this.indexes.delete(canonical);
    return this.getOrBuild(root, options);
  }

  /** Invalidate a cached index */
  invalidate(root: string): void {
    const canonical = path.resolve(root);
    this.indexes.delete(canonical);
  }

  /** Build the file index for a directory */
  private async buildIndex(root: string, options: FileSearchOptions): Promise<FileIndex> {
    const entries: IndexedFile[] = [];
    const maxDepth = options.maxDepth ?? 10;
    const includeHidden = options.includeHidden ?? false;
    const includeDirectories = options.includeDirectories ?? false;
    const respectIgnore = options.respectIgnore ?? true;
    const exclude = options.exclude ?? [];

    const ignoreMatcher = respectIgnore ? await createIgnoreMatcherForDir(root) : null;

    const walk = async (dir: string, relDir: string, currentDepth: number): Promise<void> => {
      if (currentDepth > maxDepth) return;

      let items: string[];
      try {
        items = await fs.readdir(dir);
      } catch {
        return;
      }

      for (const item of items) {
        // Skip hidden files if not included
        if (!includeHidden && item.startsWith('.')) continue;

        // Skip always-excluded directories
        if (ALWAYS_EXCLUDE.includes(item)) continue;

        const itemPath = path.join(dir, item);
        const itemRelPath = relDir ? path.join(relDir, item).replace(/\\/g, '/') : item;

        // Check ignore
        if (ignoreMatcher?.isIgnored(itemRelPath)) continue;
        if (exclude.length > 0 && shouldExclude(itemRelPath, exclude)) continue;

        try {
          const stat = await fs.stat(itemPath);

          if (stat.isDirectory()) {
            if (includeDirectories) {
              const extension = '';
              const depth = itemRelPath.split('/').length - 1;

              entries.push({
                relativePath: itemRelPath,
                fileName: item,
                pathLower: itemRelPath.toLowerCase(),
                nameLower: item.toLowerCase(),
                depth,
                extension,
                isDirectory: true,
                preparedName: fuzzysort.prepare(item.toLowerCase()),
                preparedPath: fuzzysort.prepare(itemRelPath.toLowerCase()),
              });
            }

            await walk(itemPath, itemRelPath, currentDepth + 1);
          } else if (stat.isFile()) {
            const extension = path.extname(item).slice(1).toLowerCase();
            const depth = itemRelPath.split('/').length - 1;

            entries.push({
              relativePath: itemRelPath,
              fileName: item,
              pathLower: itemRelPath.toLowerCase(),
              nameLower: item.toLowerCase(),
              depth,
              extension,
              isDirectory: false,
              preparedName: fuzzysort.prepare(item.toLowerCase()),
              preparedPath: fuzzysort.prepare(itemRelPath.toLowerCase()),
            });
          }
        } catch {
          // Skip inaccessible items
        }
      }
    };

    await walk(root, '', 0);

    return {
      root,
      entries,
      builtAt: Date.now(),
      fileCount: entries.length,
    };
  }
}

// Global singleton
const indexManager = new FileIndexManager();

// ─────────────────────────────────────────────────────────────
// Search Engine
// ─────────────────────────────────────────────────────────────

interface ScoredEntry {
  entry: IndexedFile;
  score: number;
  indices: number[];
}

/**
 * Search files with fuzzy matching and smart ranking.
 */
export async function searchFiles(
  root: string,
  query: string,
  options: FileSearchOptions = {},
): Promise<FileSearchResult[]> {
  const maxResults = options.maxResults ?? 50;
  const extensions = options.extensions ?? [];
  const includeDirectories = options.includeDirectories ?? false;

  // Get or build index
  const index = await indexManager.getOrBuild(root, options);

  // Build extension filter
  const extFilter = new Set(extensions.map((e) => e.toLowerCase().replace(/^\./, '')));

  const queryLower = query.toLowerCase().trim();

  // Score all entries
  const scored: ScoredEntry[] = [];

  for (const entry of index.entries) {
    // Apply extension filter
    if (extFilter.size > 0 && !entry.isDirectory && !extFilter.has(entry.extension)) {
      continue;
    }

    // Skip directories if not requested
    if (entry.isDirectory && !includeDirectories) {
      continue;
    }

    const result = scoreEntry(entry, queryLower);
    if (result) {
      scored.push(result);
    }
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Take top results and convert to FileSearchResult
  return scored.slice(0, maxResults).map((s) => ({
    absolutePath: path.join(index.root, s.entry.relativePath),
    relativePath: s.entry.relativePath,
    fileName: s.entry.fileName,
    extension: s.entry.extension,
    isDirectory: s.entry.isDirectory,
    score: s.score,
    matchIndices: s.indices,
  }));
}

/**
 * Score an entry against a query.
 * Returns null if no match.
 */
function scoreEntry(entry: IndexedFile, queryLower: string): ScoredEntry | null {
  // Empty query: return all files, prefer shallow paths
  if (!queryLower) {
    return {
      entry,
      score: 100 - entry.depth * SCORE_DEPTH_PENALTY + getExtensionBoost(entry.extension),
      indices: [],
    };
  }

  // Space-separated query: ALL parts must match somewhere in the path
  if (queryLower.includes(' ')) {
    return scoreMultiTermQuery(entry, queryLower);
  }

  // Single-term query
  return scoreSingleTermQuery(entry, queryLower);
}

/**
 * Score a multi-term (space-separated) query.
 * All parts must match somewhere in the path.
 */
function scoreMultiTermQuery(entry: IndexedFile, queryLower: string): ScoredEntry | null {
  const parts = queryLower.split(/\s+/).filter(Boolean);
  let totalScore = 0;
  const allIndices: number[] = [];

  for (const part of parts) {
    // Try matching part against path
    const pathResult = fuzzysort.single(part, entry.preparedPath);
    if (!pathResult) {
      return null; // All parts must match
    }
    totalScore += pathResult.score;
    if (pathResult.indexes) {
      allIndices.push(...pathResult.indexes);
    }
  }

  // Bonus if the last part matches the filename
  const lastPart = parts.at(-1);
  if (lastPart) {
    if (entry.nameLower.includes(lastPart)) {
      totalScore += 5_000;
    }
    if (entry.nameLower.startsWith(lastPart)) {
      totalScore += SCORE_PREFIX_MATCH;
    }
  }

  totalScore -= entry.depth * SCORE_DEPTH_PENALTY;
  totalScore += getExtensionBoost(entry.extension);

  return { entry, score: totalScore, indices: allIndices };
}

/**
 * Score a single-term query with filename preference.
 */
function scoreSingleTermQuery(entry: IndexedFile, queryLower: string): ScoredEntry | null {
  const nameResult = fuzzysort.single(queryLower, entry.preparedName);
  const pathResult = fuzzysort.single(queryLower, entry.preparedPath);

  // Query looks like a filename if it contains a dot or has no path separators
  const queryIsFilenameLike = queryLower.includes('.') || !queryLower.includes('/');

  const hasNameMatch = nameResult !== null;
  const hasPathMatch = pathResult !== null;

  if (!hasNameMatch && !hasPathMatch) {
    return null;
  }

  let score = 0;
  let indices: number[] = [];

  if (hasNameMatch && hasPathMatch) {
    // Filename matches are weighted 2x
    score = (nameResult?.score ?? 0) * SCORE_FILENAME_WEIGHT + (pathResult?.score ?? 0);
    indices = nameResult?.indexes ? [...nameResult.indexes] : [];

    // Exact filename match bonus
    if (entry.nameLower === queryLower) {
      score += SCORE_EXACT_MATCH;
    } else if (entry.nameLower.startsWith(queryLower)) {
      score += SCORE_PREFIX_MATCH;
    } else if (entry.nameLower.includes(queryLower)) {
      score += SCORE_SUBSTRING_MATCH;
    }
  } else if (hasNameMatch) {
    score = (nameResult?.score ?? 0) * SCORE_FILENAME_WEIGHT;
    indices = nameResult?.indexes ? [...nameResult.indexes] : [];

    if (entry.nameLower === queryLower) {
      score += SCORE_EXACT_MATCH;
    } else if (entry.nameLower.startsWith(queryLower)) {
      score += SCORE_PREFIX_MATCH;
    } else if (entry.nameLower.includes(queryLower)) {
      score += SCORE_SUBSTRING_MATCH;
    }
  } else if (hasPathMatch) {
    // Path matches but filename doesn't
    // For filename-like queries, skip path-only matches
    if (queryIsFilenameLike) {
      return null;
    }
    score = pathResult?.score ?? 0;
    indices = pathResult?.indexes ? [...pathResult.indexes] : [];
  }

  // Depth penalty
  score -= entry.depth * SCORE_DEPTH_PENALTY;

  // Extension boost
  score += getExtensionBoost(entry.extension);

  return { entry, score, indices };
}

// ─────────────────────────────────────────────────────────────
// Auto-Resolve
// ─────────────────────────────────────────────────────────────

export interface AutoResolveResult {
  /** Whether a unique match was found */
  resolved: boolean;
  /** The resolved path (if unique) or null */
  resolvedPath: string | null;
  /** All matching paths (if ambiguous) */
  candidates: string[];
  /** Whether there were multiple matches */
  ambiguous: boolean;
}

/**
 * Try to auto-resolve a file path by searching for the filename.
 * If the filename is unique in the mount, returns the resolved path.
 * If ambiguous, returns all candidates.
 */
export async function tryAutoResolve(
  root: string,
  relativePath: string,
  options: FileSearchOptions = {},
): Promise<AutoResolveResult> {
  // Extract filename from the relative path
  const fileName = path.basename(relativePath);
  if (!fileName) {
    return { resolved: false, resolvedPath: null, candidates: [], ambiguous: false };
  }

  // Get index
  const index = await indexManager.getOrBuild(root, options);

  // Find all files with matching filename (case-insensitive)
  const fileNameLower = fileName.toLowerCase();
  const matches = index.entries.filter(
    (e) => !e.isDirectory && e.nameLower === fileNameLower,
  );

  if (matches.length === 0) {
    return { resolved: false, resolvedPath: null, candidates: [], ambiguous: false };
  }

  if (matches.length === 1) {
    const match = matches[0];
    if (match) {
      return {
        resolved: true,
        resolvedPath: match.relativePath,
        candidates: [match.relativePath],
        ambiguous: false,
      };
    }
  }

  // Multiple matches - ambiguous
  return {
    resolved: false,
    resolvedPath: null,
    candidates: matches.map((m) => m.relativePath),
    ambiguous: true,
  };
}

// ─────────────────────────────────────────────────────────────
// Exports for cache management
// ─────────────────────────────────────────────────────────────

export function invalidateFileIndex(root: string): void {
  indexManager.invalidate(root);
}

export async function rebuildFileIndex(
  root: string,
  options: FileSearchOptions = {},
): Promise<FileIndex> {
  return indexManager.rebuild(root, options);
}
