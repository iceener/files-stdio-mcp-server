/**
 * Environment configuration for files-mcp server.
 */

import path from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warning' | 'error';

/**
 * A mount point mapping a virtual name to a real filesystem path.
 */
export interface Mount {
  /** Virtual name (used in paths like "vault/notes.md") */
  readonly name: string;
  /** Absolute path to the directory */
  readonly absolutePath: string;
}

export interface Config {
  // Server identity
  readonly NAME: string;
  readonly VERSION: string;
  readonly INSTRUCTIONS: string;

  // Logging
  readonly LOG_LEVEL: LogLevel;

  // Filesystem
  readonly MOUNTS: Mount[];
  readonly MAX_FILE_SIZE: number;

  /**
   * Relative paths (within mounts) that should always be visible,
   * even if matched by .gitignore, DEFAULT_IGNORE, or ALWAYS_EXCLUDE.
   *
   * Set via FS_INCLUDE env var (comma-separated).
   * Paths are recursive — including "data" also includes "data/sub/deep".
   */
  readonly INCLUDE_PATHS: readonly string[];
}

function parseLogLevel(value: string | undefined): LogLevel {
  const level = value?.toLowerCase();
  if (level === 'debug' || level === 'info' || level === 'warning' || level === 'error') {
    return level;
  }
  return 'info';
}

/**
 * Parse FS_ROOTS environment variable into mount points.
 * Format: comma-separated paths, e.g. "/path/to/vault,/path/to/projects"
 * Each path becomes a mount with the folder name as the virtual name.
 * Falls back to FS_ROOT for backward compatibility.
 */
function parseMounts(): Mount[] {
  const rootsEnv = process.env['FS_ROOTS'] ?? process.env['FS_ROOT'] ?? '.';
  // DEBUG: Log what we received
  console.error('[files-mcp] FS_ROOTS:', process.env['FS_ROOTS']);
  console.error('[files-mcp] FS_ROOT:', process.env['FS_ROOT']);
  console.error('[files-mcp] Using:', rootsEnv);
  const paths = rootsEnv
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  const mounts: Mount[] = [];
  const usedNames = new Set<string>();

  for (const rawPath of paths) {
    // Resolve to absolute path
    const absolutePath = path.isAbsolute(rawPath)
      ? path.resolve(rawPath)
      : path.resolve(process.cwd(), rawPath);

    // Extract folder name for virtual mount name
    let name = path.basename(absolutePath);

    // Handle root path edge case
    if (!name || name === '/') {
      name = 'root';
    }

    // Ensure unique names by adding suffix if needed
    let uniqueName = name;
    let counter = 2;
    while (usedNames.has(uniqueName)) {
      uniqueName = `${name}_${counter}`;
      counter++;
    }
    usedNames.add(uniqueName);

    mounts.push({ name: uniqueName, absolutePath });
  }

  return mounts;
}

/**
 * Generate instructions that include available mount points.
 */
function generateInstructions(mounts: Mount[]): string {
  const mountList = mounts.map((m) => `  - ${m.name}/`).join('\n');
  const firstMount = mounts[0]?.name ?? 'vault';

  return `
Sandboxed filesystem access. Only these paths are available:
${mountList}

CRITICAL RULES:
1. ALWAYS fs_read a file BEFORE answering about its contents or modifying it
2. NEVER guess file contents or line numbers from memory
3. ALWAYS use dryRun=true first for modifications, then apply with dryRun=false
4. ALWAYS pass checksum (from fs_read) to fs_write to prevent stale overwrites

TOOLS:
- fs_read: Read files (returns line numbers + checksum) or list directories
- fs_search: Find files by name and/or search content (returns line numbers)
- fs_write: Create or update files (line-based targeting)
- fs_manage: delete, rename, move, copy, mkdir, stat

MODIFY WORKFLOW:
1. fs_read("${firstMount}/file.md") → get content, line numbers, checksum
2. fs_write({ path: "${firstMount}/file.md", operation: "update", action: "replace", lines: "10-15", content: "new text", checksum: "abc123", dryRun: true }) → preview diff
3. If diff looks correct: repeat with dryRun: false
4. On CHECKSUM_MISMATCH: re-read file and restart

CREATE WORKFLOW:
1. fs_read("${firstMount}/") → check parent directory
2. fs_write({ path: "${firstMount}/new.md", operation: "create", content: "...", dryRun: true })
3. If correct: repeat with dryRun: false

UPDATE ACTIONS (operation: "update"):
- action: "replace", lines: "10-15" → replace lines 10-15 with content
- action: "insert_before", lines: "10" → insert content before line 10
- action: "insert_after", lines: "10" → insert content after line 10  
- action: "delete_lines", lines: "10-15" → remove lines 10-15

SEARCH EXAMPLES:
- fs_search({ path: ".", query: "TODO" }) → search filenames + content
- fs_search({ path: ".", query: "error|warn", patternMode: "regex" }) → regex OR search
- fs_search({ path: ".", query: "config", target: "filename" }) → filenames only

MANAGE EXAMPLES:
- fs_manage({ operation: "mkdir", path: "${firstMount}/new-folder", recursive: true })
- fs_manage({ operation: "move", path: "${firstMount}/a.md", target: "${firstMount}/archive/a.md" })
- fs_manage({ operation: "delete", path: "${firstMount}/old.md" })

START: fs_read(".") to see available mounts
`.trim();
}

/**
 * Parse FS_INCLUDE into relative path prefixes that override ignore rules.
 * Format: comma-separated relative paths, e.g. "data,build/output"
 */
function parseIncludePaths(): string[] {
  const raw = process.env['FS_INCLUDE'] ?? '';
  return raw
    .split(',')
    .map((p) => p.trim().replace(/^\/+/, '').replace(/\/+$/, ''))
    .filter(Boolean);
}

function loadConfig(): Config {
  const mounts = parseMounts();
  const includePaths = parseIncludePaths();

  if (includePaths.length > 0) {
    console.error('[files-mcp] FS_INCLUDE:', includePaths.join(', '));
  }

  return {
    NAME: process.env['MCP_NAME'] ?? 'files-mcp',
    VERSION: process.env['MCP_VERSION'] ?? '1.0.0',
    INSTRUCTIONS: process.env['MCP_INSTRUCTIONS'] ?? generateInstructions(mounts),

    LOG_LEVEL: parseLogLevel(process.env['LOG_LEVEL']),

    MOUNTS: mounts,
    MAX_FILE_SIZE: parseInt(process.env['MAX_FILE_SIZE'] ?? '1048576', 10), // 1MB default
    INCLUDE_PATHS: includePaths,
  };
}

/** Global configuration instance */
export const config: Config = loadConfig();
