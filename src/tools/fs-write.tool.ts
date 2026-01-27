/**
 * fs_write Tool
 *
 * Create and update file content with line-based targeting.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  deleteLines,
  generateChecksum,
  generateDiff,
  getMounts,
  insertAfterLine,
  insertBeforeLine,
  isTextFile,
  parseLineRange,
  replaceLines,
  resolvePath as resolveVirtualPath,
  validatePathChain,
} from '../lib/index.js';
import type { HandlerExtra } from '../types/index.js';

// ─────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────

export const fsWriteInputSchema = z
  .object({
    path: z
      .string()
      .min(1)
      .describe(
        'Relative path to the file. For create: where to create. For update: file to modify. ' +
          'Parent directories are created automatically for new files.',
      ),

    operation: z
      .enum(['create', 'update'])
      .describe(
        'REQUIRED. The operation type: ' +
          '"create" = make new file (fails if exists), ' +
          '"update" = modify existing file (requires "action" and "lines" parameters).',
      ),

    // Targeting (for update)
    lines: z
      .string()
      .optional()
      .describe(
        'REQUIRED for update. Target specific lines. Format: "10" (line 10), "10-15" (lines 10-15 inclusive). ' +
          'Get line numbers from fs_read output.',
      ),

    // Action (for update)
    action: z
      .enum(['replace', 'insert_before', 'insert_after', 'delete_lines'])
      .optional()
      .describe(
        'REQUIRED when operation="update". Specifies what to do with targeted content: ' +
          '"replace" = replace target lines with new content, ' +
          '"insert_before" = add content before target, ' +
          '"insert_after" = add content after target, ' +
          '"delete_lines" = remove target lines.',
      ),

    content: z
      .string()
      .optional()
      .describe(
        'The content to write. Required for create, replace, insert_before, insert_after. ' +
          'Not needed for delete_lines.',
      ),

    // Safety
    checksum: z
      .string()
      .optional()
      .describe(
        'Expected checksum of the current file (from previous fs_read). ' +
          'If provided and file has changed, operation fails. STRONGLY RECOMMENDED for updates.',
      ),

    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'If true, returns what WOULD change without applying it. ' +
          'Returns a unified diff. Use to preview and verify edits.',
      ),

    createDirs: z
      .boolean()
      .optional()
      .default(true)
      .describe('For create: whether to create parent directories if missing. Default true.'),

  })
  .passthrough() // Allow extra keys from SDK context
  .refine(
    (data) => {
      if (data.operation === 'create' && data.content === undefined) {
        return false;
      }
      return true;
    },
    { message: 'content is required for create operation', path: ['content'] },
  )
  .refine(
    (data) => {
      if (data.operation === 'update' && !data.action) {
        return false;
      }
      return true;
    },
    {
      message:
        '"action" parameter is required when operation="update". Use action="replace", "insert_before", "insert_after", or "delete_lines".',
      path: ['action'],
    },
  )
  .refine(
    (data) => {
      if (data.operation === 'update' && !data.lines) {
        return false;
      }
      return true;
    },
    { message: '"lines" parameter is required when operation="update".', path: ['lines'] },
  )
  .refine(
    (data) => {
      if (
        data.operation === 'update' &&
        data.action !== 'delete_lines' &&
        data.content === undefined
      ) {
        return false;
      }
      return true;
    },
    { message: 'content is required for replace/insert actions', path: ['content'] },
  );

export type FsWriteInput = z.infer<typeof fsWriteInputSchema>;

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

type FsWriteStatus = 'applied' | 'preview' | 'error';

interface FsWriteResultCreate {
  action: 'created' | 'would_create';
  newChecksum?: string;
  diff: string;
}

interface FsWriteResultUpdate {
  action: string;
  targetRange: { start: number; end: number };
  newChecksum?: string;
  diff: string;
}

interface FsWriteResult {
  status: FsWriteStatus;
  path: string;
  operation: 'create' | 'update';
  result?: FsWriteResultCreate | FsWriteResultUpdate;
  error?: {
    code: string;
    message: string;
    recoveryHint: string;
  };
  hint: string;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

async function fileExists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

function withTrailingNewline(content: string, ensure: boolean): string {
  if (!ensure) return content;
  return content.endsWith('\n') ? content : `${content}\n`;
}

// ─────────────────────────────────────────────────────────────
// Operations
// ─────────────────────────────────────────────────────────────

async function createFile(
  absPath: string,
  relativePath: string,
  content: string,
  options: { createDirs: boolean; dryRun: boolean },
): Promise<FsWriteResult> {
  // Check if exists
  if (await fileExists(absPath)) {
    return {
      status: 'error',
      path: relativePath,
      operation: 'create',
      error: {
        code: 'ALREADY_EXISTS',
        message: `File already exists: ${relativePath}`,
        recoveryHint:
          'To modify this file, first call fs_read to get its content and checksum, then use fs_write with operation="update".',
      },
      hint: 'File already exists. Read it first with fs_read, then use operation="update" to modify.',
    };
  }

  // Normalize trailing newline (POSIX convention)
  const finalContent = withTrailingNewline(content, true);
  const diff = generateDiff('', finalContent, relativePath);

  if (options.dryRun) {
    return {
      status: 'preview',
      path: relativePath,
      operation: 'create',
      result: {
        action: 'would_create',
        diff,
      },
      hint: 'DRY RUN: Review the diff above. If the content is correct, call fs_write again with dryRun=false to create the file.',
    };
  }

  // Create parent dirs if needed
  if (options.createDirs) {
    await fs.mkdir(path.dirname(absPath), { recursive: true });
  }

  await fs.writeFile(absPath, finalContent, 'utf8');
  const newChecksum = generateChecksum(finalContent);

  return {
    status: 'applied',
    path: relativePath,
    operation: 'create',
    result: {
      action: 'created',
      newChecksum,
      diff,
    },
    hint: `File created at "${relativePath}". Checksum: ${newChecksum}. Use this checksum when updating the file.`,
  };
}

async function updateFile(
  absPath: string,
  relativePath: string,
  input: FsWriteInput,
): Promise<FsWriteResult> {
  // Check exists
  if (!(await fileExists(absPath))) {
    return {
      status: 'error',
      path: relativePath,
      operation: 'update',
      error: {
        code: 'NOT_FOUND',
        message: `File does not exist: ${relativePath}`,
        recoveryHint:
          'Use fs_write with operation="create" and provide the content to create a new file.',
      },
      hint: 'File not found. To create it, use operation="create" with the desired content.',
    };
  }

  // Check text file
  if (!isTextFile(absPath)) {
    return {
      status: 'error',
      path: relativePath,
      operation: 'update',
      error: {
        code: 'NOT_TEXT',
        message: 'Cannot modify binary files',
        recoveryHint: 'This file appears to be binary. Only text files can be edited.',
      },
      hint: 'Binary files cannot be modified. Only text files are supported.',
    };
  }

  // Read current content
  const currentContent = await fs.readFile(absPath, 'utf8');
  const currentChecksum = generateChecksum(currentContent);

  // Verify checksum if provided
  if (input.checksum && input.checksum !== currentChecksum) {
    return {
      status: 'error',
      path: relativePath,
      operation: 'update',
      error: {
        code: 'CHECKSUM_MISMATCH',
        message: `File has changed since last read. Expected checksum: ${input.checksum}, current: ${currentChecksum}`,
        recoveryHint: `Call fs_read("${relativePath}") to get the current content and updated checksum, then retry.`,
      },
      hint: `File was modified externally. Re-read with fs_read to get current checksum (${currentChecksum}).`,
    };
  }

  if (!input.lines) {
    return {
      status: 'error',
      path: relativePath,
      operation: 'update',
      error: {
        code: 'NO_TARGET',
        message: '"lines" parameter is required for update operations',
        recoveryHint:
          'Add lines="N" or lines="N-M" to specify which lines to target. Get line numbers from fs_read output.',
      },
      hint: 'Missing target lines. Use fs_read to view the file with line numbers, then specify lines="10" or lines="10-15".',
    };
  }

  // Determine target range
  const range = parseLineRange(input.lines);
  if (!range) {
    return {
      status: 'error',
      path: relativePath,
      operation: 'update',
      error: {
        code: 'INVALID_RANGE',
        message: `Invalid line range format: "${input.lines}"`,
        recoveryHint: 'Use format "10" for single line or "10-15" for a range (inclusive).',
      },
      hint: 'Invalid line range. Use "10" for single line, "10-15" for range.',
    };
  }

  const lines = currentContent.split('\n');
  if (range.start > lines.length) {
    return {
      status: 'error',
      path: relativePath,
      operation: 'update',
      error: {
        code: 'OUT_OF_RANGE',
        message: `Line ${range.start} is beyond file end (file has ${lines.length} lines)`,
        recoveryHint: `Adjust your line range to be within 1-${lines.length}. Use fs_read to see the file content.`,
      },
      hint: `File has ${lines.length} lines. Target lines must be within 1-${lines.length}.`,
    };
  }

  const targetStart = range.start;
  const targetEnd = Math.min(range.end, lines.length);

  // Apply action
  let newContent: string;
  let actionDescription: string;

  // Content is guaranteed by Zod schema for non-delete actions
  const content = input.content ?? '';

  switch (input.action) {
    case 'replace':
      newContent = replaceLines(currentContent, targetStart, targetEnd, content);
      actionDescription = 'replaced';
      break;

    case 'insert_before':
      newContent = insertBeforeLine(currentContent, targetStart, content);
      actionDescription = 'inserted_before';
      break;

    case 'insert_after':
      newContent = insertAfterLine(currentContent, targetEnd, content);
      actionDescription = 'inserted_after';
      break;

    case 'delete_lines':
      newContent = deleteLines(currentContent, targetStart, targetEnd);
      actionDescription = 'deleted_lines';
      break;

    default:
      return {
        status: 'error',
        path: relativePath,
        operation: 'update',
        error: {
          code: 'INVALID_ACTION',
          message: `Unknown action: ${input.action}`,
          recoveryHint:
            'Use one of: action="replace", action="insert_before", action="insert_after", action="delete_lines".',
        },
        hint: 'Invalid action. Valid options: replace, insert_before, insert_after, delete_lines.',
      };
  }

  // Normalize trailing newline (POSIX convention)
  const finalContent = withTrailingNewline(newContent, true);

  // Generate diff
  const diff = generateDiff(currentContent, finalContent, relativePath);

  if (input.dryRun) {
    return {
      status: 'preview',
      path: relativePath,
      operation: 'update',
      result: {
        action: `would_${actionDescription}`,
        targetRange: { start: targetStart, end: targetEnd },
        diff,
      },
      hint: `DRY RUN: Review the diff above. If the changes match your intent, call fs_write again with dryRun=false to apply.`,
    };
  }

  // Apply changes
  await fs.writeFile(absPath, finalContent, 'utf8');
  const newChecksum = generateChecksum(finalContent);

  return {
    status: 'applied',
    path: relativePath,
    operation: 'update',
    result: {
      action: actionDescription,
      targetRange: { start: targetStart, end: targetEnd },
      newChecksum,
      diff,
    },
    hint: `Updated "${relativePath}": ${actionDescription.replace('_', ' ')} lines ${targetStart}-${targetEnd}. New checksum: ${newChecksum}.`,
  };
}

// ─────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────

export const fsWriteTool = {
  name: 'fs_write',
  description: `Create or update files in the sandboxed filesystem.

SANDBOXED FILESYSTEM — This tool can ONLY write to specific mounted directories.
   You CANNOT write to arbitrary system paths like /Users or C:\\.
   Use fs_read(".") first to see available mounts.

PREREQUISITE: You MUST call fs_read on a file BEFORE modifying it.
   This gives you: (1) current content, (2) line numbers, (3) checksum.

═══════════════════════════════════════════════════════════
                    SAFE WORKFLOW
═══════════════════════════════════════════════════════════
1. fs_read("path/file.md") → get content + checksum
2. fs_write with dryRun=true → preview diff
3. fs_write with dryRun=false + checksum → apply change
4. Verify diff in response matches your intent

═══════════════════════════════════════════════════════════
                    OPERATIONS
═══════════════════════════════════════════════════════════

CREATE — Make a new file
  Required: path, content
  Creates parent directories automatically.
  Fails if file already exists (use update to modify).

UPDATE — Modify existing file (line-based only)
  Required: path, action, lines
  Actions:
  - replace: Replace target lines with new content
  - insert_before: Add content before target
  - insert_after: Add content after target
  - delete_lines: Remove target lines

Use fs_search to locate content, then fs_read to get exact line numbers.

═══════════════════════════════════════════════════════════
                    SAFETY
═══════════════════════════════════════════════════════════
- checksum: Pass from fs_read to prevent stale overwrites
- dryRun: Preview diff without applying (ALWAYS use first)

DO NOT call fs_write without first calling fs_read on the same file.`,

  inputSchema: fsWriteInputSchema,

  handler: async (args: unknown, _extra: HandlerExtra): Promise<CallToolResult> => {
    // Validate
    const parsed = fsWriteInputSchema.safeParse(args);
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

    // Resolve virtual path to real path
    const resolved = resolveVirtualPath(input.path);
    if (!resolved.ok) {
      const mounts = getMounts();
      const mountExample = mounts[0]?.name ?? 'vault';

      // Detect if user tried an absolute path
      const isAbsolute = input.path.startsWith('/') || /^[a-zA-Z]:[/\\]/.test(input.path);

      const result: FsWriteResult = {
        status: 'error',
        path: input.path,
        operation: input.operation,
        error: {
          code: 'OUT_OF_SCOPE',
          message: resolved.error,
          recoveryHint: `Use fs_read(".") to see available mounts, then use a path like "${mountExample}/filename.ext".`,
        },
        hint: isAbsolute
          ? `SANDBOXED filesystem — cannot write to system paths. Call fs_read(".") first to see available mounts.`
          : `Path must be within a mount. Call fs_read(".") to see available mounts.`,
      };
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    const { absolutePath, virtualPath, mount } = resolved.resolved;

    // Security: Validate symlinks don't escape mount
    const symlinkCheck = await validatePathChain(absolutePath, mount);
    if (!symlinkCheck.ok) {
      const result: FsWriteResult = {
        status: 'error',
        path: virtualPath,
        operation: input.operation,
        error: {
          code: 'SYMLINK_ESCAPE',
          message: symlinkCheck.error,
          recoveryHint: 'Remove or update the symlink to point within the mounted directory.',
        },
        hint: 'Security: symlinks cannot point outside the mounted directory.',
      };
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    let result: FsWriteResult;

    switch (input.operation) {
      case 'create':
        // Content is guaranteed by Zod schema for create operation
        result = await createFile(absolutePath, virtualPath, input.content ?? '', {
          createDirs: input.createDirs,
          dryRun: input.dryRun,
        });
        break;

      case 'update':
        result = await updateFile(absolutePath, virtualPath, input);
        break;

      default:
        result = {
          status: 'error',
          path: virtualPath,
          operation: input.operation,
          error: {
            code: 'INVALID_OPERATION',
            message: `Unknown operation: ${input.operation}`,
            recoveryHint: 'Use operation="create" for new files or operation="update" for existing files.',
          },
          hint: 'Invalid operation. Use "create" for new files, "update" for existing files.',
        };
    }

    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
};
