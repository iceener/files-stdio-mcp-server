/**
 * fs_read Tool
 *
 * Read files and list directories.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  addLineNumbers,
  createIgnoreMatcherForDir,
  extractLines,
  generateChecksum,
  getMounts,
  isTextFile,
  matchesGlob,
  matchesType,
  parseLineRange,
  resolvePath as resolveVirtualPath,
  shouldExclude,
  tryAutoResolve,
  validatePathChain,
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
          'For directories: returns entries. For files: returns content with line numbers.',
      ),

    mode: z
      .enum(['auto', 'tree', 'list', 'content'])
      .optional()
      .default('auto')
      .describe(
        'Exploration mode: "auto" (default) detects file vs directory, ' +
          '"tree" returns directories only with child counts, ' +
          '"list" returns files + directories (paginated), ' +
          '"content" reads file content.',
      ),

    limit: z
      .number()
      .int()
      .min(1)
      .max(2000)
      .optional()
      .default(100)
      .describe('Max entries to return for directory listings (default 100).'),

    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .default(0)
      .describe('Skip the first N matching entries for directory listings (default 0).'),

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
      .describe('Directory listing depth (default 1).'),

    details: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'Include file details (size, modified time) in directory listings. ' +
          'Default false for compact output.',
      ),

    types: z
      .array(z.string())
      .optional()
      .describe('Filter directory listing by file type. Examples: ["ts", "js"], ["md"].'),

    glob: z
      .string()
      .optional()
      .describe('Glob pattern filter for directory listings. Example: "**/*.ts".'),

    exclude: z
      .array(z.string())
      .optional()
      .describe('Patterns to exclude. Example: ["**/test/**", "**/*.spec.ts"].'),

    respectIgnore: z
      .boolean()
      .optional()
      .default(true)
      .describe('Respect .gitignore and .ignore files. Default true.'),
  })
  .passthrough(); // Allow extra keys from SDK context

export type FsReadInput = z.infer<typeof fsReadInputSchema>;

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

type FsReadMode = 'auto' | 'tree' | 'list' | 'content';

interface TreeEntry {
  path: string;
  kind: 'file' | 'directory';
  size?: string;
  modified?: string;
  children?: number;
}

interface DirectoryStats {
  returned: number;
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  truncated: boolean;
}

interface FsReadResult {
  success: boolean;
  path: string;
  type: 'directory' | 'file';
  // For directories:
  entries?: TreeEntry[];
  summary?: string;
  stats?: DirectoryStats;
  // For files:
  content?: {
    text: string;
    checksum: string;
    totalLines: number;
    range?: { start: number; end: number };
    truncated: boolean;
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

function resolveMode(requestedMode: FsReadMode, isFile: boolean): FsReadMode {
  if (requestedMode === 'auto') {
    return isFile ? 'content' : 'list';
  }
  return requestedMode;
}

function getListingFlags(mode: FsReadMode): { includeFiles: boolean; includeDirs: boolean } {
  if (mode === 'tree') {
    return { includeFiles: false, includeDirs: true };
  }
  return { includeFiles: true, includeDirs: true };
}

/**
 * List all available mount points, or directly show single mount contents.
 */
async function listMountsOrSingleMount(
  depth: number,
  options: {
    mode: FsReadMode;
    limit: number;
    offset: number;
    types?: string[];
    glob?: string;
    exclude?: string[];
    respectIgnore: boolean;
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
    const listingMode = options.mode === 'auto' ? 'list' : options.mode;
    const { includeFiles, includeDirs } = getListingFlags(listingMode);
    const { entries, stats } = await listDirectory(mount.absolutePath, '', depth, {
      types: options.types,
      glob: options.glob,
      exclude: options.exclude,
      respectIgnore: options.respectIgnore,
      details: options.details,
      includeFiles,
      includeDirs,
      limit: options.limit,
      offset: options.offset,
    });

    const fileCount = entries.filter((e) => e.kind === 'file').length;
    const dirCount = entries.filter((e) => e.kind === 'directory').length;
    const pagingSuffix = stats.hasMore ? ` — showing ${stats.returned} of ${stats.total}` : '';
    const truncatedSuffix = stats.truncated ? ' — truncated' : '';

    const nextOffset = stats.offset + stats.returned;
    return {
      success: true,
      path: '.',
      type: 'directory',
      entries,
      summary: `${entries.length} items (${fileCount} files, ${dirCount} directories)${pagingSuffix}${truncatedSuffix}`,
      stats,
      hint:
        entries.length === 0
          ? 'Directory is empty or all files are ignored.'
          : stats.hasMore
            ? `Showing ${stats.returned} of ${stats.total} items in "${mount.name}". To see more: use offset=${nextOffset}. Or use mode="tree" for structure overview.`
            : `Showing contents of "${mount.name}". Use fs_read on any path to explore deeper or fs_search to locate files/content.`,
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
  const total = entries.length;
  const start = Math.max(0, options.offset);
  const end = start + Math.max(1, options.limit);
  const pagedEntries = entries.slice(start, end);
  const stats: DirectoryStats = {
    returned: pagedEntries.length,
    total,
    offset: start,
    limit: Math.max(1, options.limit),
    hasMore: total > start + pagedEntries.length,
    truncated: false,
  };

  const nextOffset = stats.offset + stats.returned;
  return {
    success: true,
    path: '.',
    type: 'directory',
    entries: pagedEntries,
    summary: `${mounts.length} mount point(s): ${mountNames}`,
    stats,
    hint: stats.hasMore
      ? `${mounts.length} mounts available. To see more: use offset=${nextOffset}. Or use fs_read("mountname/") to explore a specific mount.`
      : `${mounts.length} mounts available. Use fs_read("mountname/") to explore a specific mount, or fs_search to locate files/content.`,
  };
}

// ─────────────────────────────────────────────────────────────
// Core Functions
// ─────────────────────────────────────────────────────────────

const MAX_ENTRIES = 10_000;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB limit for file reading

async function listDirectory(
  absPath: string,
  relativePath: string,
  depth: number,
  options: {
    types?: string[];
    glob?: string;
    exclude?: string[];
    respectIgnore: boolean;
    details?: boolean;
    includeFiles: boolean;
    includeDirs: boolean;
    limit: number;
    offset: number;
  },
): Promise<{ entries: TreeEntry[]; stats: DirectoryStats }> {
  const entries: TreeEntry[] = [];
  let truncated = false;
  let total = 0;
  const limit = Math.max(1, options.limit);
  const offset = Math.max(0, options.offset);

  const ignoreMatcher = options.respectIgnore ? await createIgnoreMatcherForDir(absPath) : null;

  function recordEntry(entry: TreeEntry): void {
    total += 1;
    if (total <= offset) return;
    if (entries.length < limit) {
      entries.push(entry);
    }
  }

  async function walk(dir: string, relDir: string, currentDepth: number): Promise<void> {
    if (currentDepth > depth || total >= MAX_ENTRIES) {
      truncated = total >= MAX_ENTRIES;
      return;
    }

    let items: string[];
    try {
      items = await fs.readdir(dir);
    } catch {
      return;
    }

    for (const item of items) {
      if (total >= MAX_ENTRIES) {
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

          const includeDir =
            (!options.glob || matchesGlob(itemRelPath, options.glob)) && options.includeDirs;
          if (includeDir) {
            const entry: TreeEntry = {
              path: itemRelPath,
              kind: 'directory',
              children: childCount,
            };
            if (options.details) {
              entry.modified = formatRelativeTime(stat.mtime);
            }
            recordEntry(entry);
          }

          if (currentDepth < depth) {
            await walk(itemPath, itemRelPath, currentDepth + 1);
          }
        } else if (stat.isFile()) {
          if (!options.includeFiles) continue;
          // Type filter
          if (options.types && options.types.length > 0) {
            if (!matchesType(item, options.types)) continue;
          }

          if (options.glob && !matchesGlob(itemRelPath, options.glob)) continue;

          const entry: TreeEntry = {
            path: itemRelPath,
            kind: 'file',
          };
          if (options.details) {
            entry.size = formatSize(stat.size);
            entry.modified = formatRelativeTime(stat.mtime);
          }
          recordEntry(entry);
        }
      } catch {
        // Skip inaccessible items
      }
    }
  }

  await walk(absPath, relativePath === '.' ? '' : relativePath, 1);
  const stats: DirectoryStats = {
    returned: entries.length,
    total,
    offset,
    limit,
    hasMore: truncated || total > offset + entries.length,
    truncated,
  };
  return { entries, stats };
}

async function readFile(
  absPath: string,
  relativePath: string,
  options: { lines?: string },
): Promise<FsReadResult> {
  // Check file size first
  try {
    const stat = await fs.stat(absPath);
    if (stat.size > MAX_FILE_SIZE) {
      const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);
      const limitMB = (MAX_FILE_SIZE / (1024 * 1024)).toFixed(0);
      return {
        success: false,
        path: relativePath,
        type: 'file',
        error: {
          code: 'FILE_TOO_LARGE',
          message: `File size (${sizeMB}MB) exceeds limit (${limitMB}MB)`,
        },
        hint: `This file is too large to read. Use fs_search to find specific content, or use lines="1-100" to read portions.`,
      };
    }
  } catch {
    // Will be caught below in the actual read
  }

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
        `To find specific content: use fs_search. ` +
        `Checksum: ${checksum}`
      : `File read complete. Checksum: ${checksum}. To edit this file, use fs_write with this checksum. Reference lines by number for precise edits.`,
  };
}

// ─────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────

export const fsReadTool = {
  name: 'fs_read',
  description: `Read files and list directories in the sandboxed filesystem.

SANDBOXED FILESYSTEM — This tool can ONLY access specific mounted directories.
You CANNOT access arbitrary system paths like /Users or C:\\.
Always start with fs_read(".") to see available mounts.

ALWAYS read a file BEFORE answering questions about its content.
ALWAYS read a file BEFORE modifying it (you need the checksum).

MODES:
- auto (default): detects file vs directory
- tree: directories only with child counts (lightweight structure)
- list: files + directories (paginated with limit/offset)
- content: read file content with line numbers

PAGINATION:
Use limit/offset to control directory listing size and fetch next pages.

AUTO-RESOLVE: If you request a file path that doesn't exist but the filename is unique,
   the tool will automatically resolve it and read the correct file.
   If multiple files match, you'll see a list of candidates to choose from.

TIPS:
- Use fs_search to locate files or content, then fs_read to inspect.
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
    const requestedMode = input.mode ?? 'auto';
    const effectiveDepth = input.depth ?? 1;
    const limit = input.limit ?? 100;
    const offset = input.offset ?? 0;

    // Special case: root path shows mount listing (or single mount contents)
    if (isRootPath(input.path)) {
      if (requestedMode === 'content') {
        const result: FsReadResult = {
          success: false,
          path: input.path,
          type: 'directory',
          error: { code: 'MODE_MISMATCH', message: 'Root path is a directory' },
          hint: 'Use mode="list" or mode="tree" for directory exploration.',
        };
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      const result = await listMountsOrSingleMount(effectiveDepth, {
        mode: requestedMode,
        limit,
        offset,
        types: input.types,
        glob: input.glob,
        exclude: input.exclude,
        respectIgnore: input.respectIgnore,
        details: input.details,
      });
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

      // Suggest corrected path for absolute paths
      const suggestedPath = isAbsolute
        ? input.path.replace(/^\/+/, '').replace(/^[a-zA-Z]:[/\\]+/, '')
        : null;

      const result: FsReadResult = {
        success: false,
        path: input.path,
        type: 'file',
        error: { code: 'OUT_OF_SCOPE', message: resolved.error },
        hint: isAbsolute
          ? `This is a SANDBOXED filesystem — absolute paths are not allowed. ` +
            (suggestedPath
              ? `Try: fs_read("${suggestedPath}") — use relative paths without leading "/". `
              : '') +
            `If unsure, use fs_read(".") first to see available paths.`
          : `Path not found. Try fs_read(".") to see available mounts, or fs_read(${mountExamples}) to explore a mount.`,
      };
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    const { absolutePath, virtualPath, mount } = resolved.resolved;

    // Security: Validate symlinks don't escape mount
    const symlinkCheck = await validatePathChain(absolutePath, mount);
    if (!symlinkCheck.ok) {
      const result: FsReadResult = {
        success: false,
        path: virtualPath,
        type: 'file',
        error: { code: 'SYMLINK_ESCAPE', message: symlinkCheck.error },
        hint: 'Symlinks pointing outside the mounted directory are not allowed for security.',
      };
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    // Check if path exists
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(absolutePath);
    } catch {
      // Try auto-resolve: if the filename is unique, resolve to that path
      const mountName = virtualPath.split('/')[0] ?? '';
      const mount = getMounts().find((m) => m.name === mountName);

      if (mount) {
        const autoResolve = await tryAutoResolve(
          mount.absolutePath,
          virtualPath.slice(mountName.length + 1),
        );

        if (autoResolve.resolved && autoResolve.resolvedPath) {
          // Found unique match - read the resolved file instead
          const resolvedVirtualPath = `${mountName}/${autoResolve.resolvedPath}`;
          const resolvedAbsolutePath = path.join(mount.absolutePath, autoResolve.resolvedPath);
          const autoMode = resolveMode(requestedMode, true);
          if (autoMode !== 'content') {
            const result: FsReadResult = {
              success: false,
              path: virtualPath,
              type: 'file',
              error: {
                code: 'MODE_MISMATCH',
                message: `Path "${virtualPath}" auto-resolved to file "${resolvedVirtualPath}"`,
              },
              hint:
                'This path points to a file. Use mode="content" (or omit mode) to read it, ' +
                'or use fs_read on a directory path for listing.',
            };
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          try {
            stat = await fs.stat(resolvedAbsolutePath);

            // Read the resolved file
            const resolvedResult = await readFile(resolvedAbsolutePath, resolvedVirtualPath, {
              lines: input.lines,
            });

            // Add auto-resolve hint
            const autoResolveHint = `Auto-resolved "${virtualPath}" → "${resolvedVirtualPath}". `;
            resolvedResult.hint = autoResolveHint + (resolvedResult.hint ?? '');

            return { content: [{ type: 'text', text: JSON.stringify(resolvedResult, null, 2) }] };
          } catch {
            // Fall through to NOT_FOUND
          }
        } else if (autoResolve.ambiguous && autoResolve.candidates.length > 0) {
          // Multiple matches - show candidates
          const candidates = autoResolve.candidates.slice(0, 5).map((c) => `${mountName}/${c}`);
          const result: FsReadResult = {
            success: false,
            path: virtualPath,
            type: 'file',
            error: {
              code: 'AMBIGUOUS_PATH',
              message: `Multiple files match "${path.basename(virtualPath)}"`,
            },
            hint: `Found ${autoResolve.candidates.length} files with this name. Did you mean:\n${candidates
              .map((c) => `  • ${c}`)
              .join(
                '\n',
              )}${autoResolve.candidates.length > 5 ? `\n  ... and ${autoResolve.candidates.length - 5} more` : ''}`,
          };
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
      }

      const result: FsReadResult = {
        success: false,
        path: virtualPath,
        type: 'file',
        error: { code: 'NOT_FOUND', message: `Path does not exist: ${virtualPath}` },
        hint: 'Use fs_read on the parent directory to see what exists, or fs_read(".") to see mount points. You can also use fs_search to locate files.',
      };
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    let result: FsReadResult;

    if (stat.isDirectory()) {
      const directoryMode = resolveMode(requestedMode, false);
      if (directoryMode === 'content') {
        result = {
          success: false,
          path: virtualPath,
          type: 'directory',
          error: {
            code: 'MODE_MISMATCH',
            message: 'Directory path cannot be read as file content',
          },
          hint: 'Use mode="list" or mode="tree" for directory exploration.',
        };
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      const { includeFiles, includeDirs } = getListingFlags(directoryMode);
      const { entries, stats } = await listDirectory(absolutePath, virtualPath, effectiveDepth, {
        types: input.types,
        glob: input.glob,
        exclude: input.exclude,
        respectIgnore: input.respectIgnore,
        details: input.details,
        includeFiles,
        includeDirs,
        limit,
        offset,
      });

      const fileCount = entries.filter((e) => e.kind === 'file').length;
      const dirCount = entries.filter((e) => e.kind === 'directory').length;
      const pagingSuffix = stats.hasMore ? ` — showing ${stats.returned} of ${stats.total}` : '';
      const truncatedSuffix = stats.truncated ? ' — truncated' : '';

      const nextOffset = stats.offset + stats.returned;
      result = {
        success: true,
        path: input.path,
        type: 'directory',
        entries,
        summary: `${entries.length} items (${fileCount} files, ${dirCount} directories)${pagingSuffix}${truncatedSuffix}`,
        stats,
        hint:
          entries.length === 0
            ? 'Directory is empty or all files are ignored.'
            : stats.hasMore
              ? `Showing ${stats.returned} of ${stats.total} items. To see more: use offset=${nextOffset}. Or use mode="tree" for structure overview.`
              : `Found ${entries.length} items. Use fs_read on a file path to see its content, or on a subdirectory to explore deeper.`,
      };
    } else if (stat.isFile()) {
      const fileMode = resolveMode(requestedMode, true);
      if (fileMode !== 'content') {
        result = {
          success: false,
          path: virtualPath,
          type: 'file',
          error: { code: 'MODE_MISMATCH', message: 'File path cannot be listed as a directory' },
          hint: 'Use mode="content" (or omit mode) to read files.',
        };
      } else {
        result = await readFile(absolutePath, virtualPath, { lines: input.lines });
      }
    } else {
      result = {
        success: false,
        path: virtualPath,
        type: 'file',
        error: { code: 'UNSUPPORTED', message: 'Unsupported filesystem entry type' },
        hint: 'Only files and directories are supported.',
      };
    }

    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
};
