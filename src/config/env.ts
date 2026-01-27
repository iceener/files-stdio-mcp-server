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
You have access to a sandboxed filesystem through this server.

═══════════════════════════════════════════════════════════
                    MANDATORY RULES
═══════════════════════════════════════════════════════════

🔍 BEFORE ANSWERING about file contents:
   - ALWAYS use fs_read to get current content first
   - NEVER assume or guess file contents from memory
   - If asked "what's in X?", read X first

✏️ BEFORE MODIFYING (update/replace):
   1. fs_read the file → get current content + checksum
   2. Use fs_search to locate content, then identify exact line numbers
   3. Use dryRun=true to preview the change
   4. Apply with the checksum from step 1
   5. Verify the diff in response matches your intent

🗑️ BEFORE DELETING/RENAMING/MOVING/COPYING:
   1. Use fs_read to confirm important content if needed
   2. Confirm with user if content looks important
   3. Use fs_manage for structural changes

📁 BEFORE CREATING:
   1. fs_read the parent directory to check for conflicts
   2. Check if similar file already exists

🔄 IF CHECKSUM MISMATCH:
   - File changed since you read it
   - Re-read with fs_read to get fresh content
   - Start modification workflow again

⚠️ NEVER:
   - Modify a file you haven't read in this conversation
   - Use line numbers from memory (they may have shifted)
   - Skip dryRun for destructive operations

═══════════════════════════════════════════════════════════
                    AVAILABLE PATHS
═══════════════════════════════════════════════════════════
${mountList}

All paths are relative to these mount points. Examples:
- "${firstMount}/notes.md" → file in ${firstMount}
- Use fs_read(".") to list all mount points

═══════════════════════════════════════════════════════════
                    WORKFLOW PATTERNS
═══════════════════════════════════════════════════════════

EXPLORE FIRST:
  fs_read(".") → see available mounts
  fs_read("${firstMount}/") → explore a mount
  fs_search(".", query="config") → find files and content

READ BEFORE EDIT:
  fs_read("${firstMount}/file.md") → get content + checksum
  Note the line numbers for precise edits

SEARCH:
  fs_search { path: "${firstMount}/", query: "TODO" } → find content
  fs_search { path: "${firstMount}/", query: "config", target: "filename" } → find files by name

SAFE EDITING:
  fs_write with dryRun=true → preview diff
  fs_write with dryRun=false → apply change
  Check returned diff to verify

MANAGE (STRUCTURE):
  fs_manage { operation: "rename", path: "${firstMount}/old.md", target: "${firstMount}/new.md" }
  fs_manage { operation: "move", path: "${firstMount}/a.md", target: "${firstMount}/archive/a.md", force: true }
  fs_manage { operation: "copy", path: "${firstMount}/a.md", target: "${firstMount}/backup/a.md" }
  fs_manage { operation: "mkdir", path: "${firstMount}/archive", recursive: true }
  fs_manage { operation: "delete", path: "${firstMount}/old.md" }

═══════════════════════════════════════════════════════════
                    CHECKSUMS & SAFETY
═══════════════════════════════════════════════════════════

Every fs_read returns a checksum. This is your "file version".
Pass it to fs_write to ensure file hasn't changed.
If mismatch occurs, re-read to get current state.

LINE NUMBERS:
- Prefer lines="10-15" when you have line numbers
 - Use fs_search to locate content, then fs_read to get exact line numbers
`.trim();
}

function loadConfig(): Config {
  const mounts = parseMounts();

  return {
    NAME: process.env['MCP_NAME'] ?? 'files-mcp',
    VERSION: process.env['MCP_VERSION'] ?? '1.0.0',
    INSTRUCTIONS: process.env['MCP_INSTRUCTIONS'] ?? generateInstructions(mounts),

    LOG_LEVEL: parseLogLevel(process.env['LOG_LEVEL']),

    MOUNTS: mounts,
    MAX_FILE_SIZE: parseInt(process.env['MAX_FILE_SIZE'] ?? '1048576', 10), // 1MB default
  };
}

/** Global configuration instance */
export const config: Config = loadConfig();
