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

    ensureTrailingNewline: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        'Ensure file ends with a newline after write. Default true (POSIX convention, reduces git noise).',
      ),
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

interface FsWriteResult {
  success: boolean;
  path: string;
  operation: 'create' | 'update';
  applied: boolean;
  result?: {
    action: string;
    linesAffected?: number;
    newChecksum?: string;
    diff?: string;
  };
  error?: {
    code: string;
    message: string;
    recoveryHint?: string;
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
  options: { createDirs: boolean; dryRun: boolean; ensureTrailingNewline: boolean },
): Promise<FsWriteResult> {
  // Check if exists
  if (await fileExists(absPath)) {
    return {
      success: false,
      path: relativePath,
      operation: 'create',
      applied: false,
      error: {
        code: 'ALREADY_EXISTS',
        message: `File already exists: ${relativePath}`,
        recoveryHint: 'Use operation="update" to modify existing files.',
      },
      hint: 'File already exists. Use fs_write with operation="update" to modify it, or choose a different path.',
    };
  }

  // Normalize trailing newline
  const finalContent = withTrailingNewline(content, options.ensureTrailingNewline);

  if (options.dryRun) {
    const diff = generateDiff('', finalContent, relativePath);
    return {
      success: true,
      path: relativePath,
      operation: 'create',
      applied: false,
      result: {
        action: 'would_create',
        linesAffected: finalContent.split('\n').length,
        diff,
      },
      hint: 'DRY RUN — file would be created with the content shown. Run with dryRun=false to apply.',
    };
  }

  // Create parent dirs if needed
  if (options.createDirs) {
    await fs.mkdir(path.dirname(absPath), { recursive: true });
  }

  await fs.writeFile(absPath, finalContent, 'utf8');
  const newChecksum = generateChecksum(finalContent);

  return {
    success: true,
    path: relativePath,
    operation: 'create',
    applied: true,
    result: {
      action: 'created',
      linesAffected: finalContent.split('\n').length,
      newChecksum,
    },
    hint: `File created successfully. New checksum: ${newChecksum}. Use fs_read to verify the content.`,
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
      success: false,
      path: relativePath,
      operation: 'update',
      applied: false,
      error: {
        code: 'NOT_FOUND',
        message: `File does not exist: ${relativePath}`,
        recoveryHint: 'Use operation="create" to create a new file.',
      },
      hint: 'File not found. Use fs_write with operation="create" to create it.',
    };
  }

  // Check text file
  if (!isTextFile(absPath)) {
    return {
      success: false,
      path: relativePath,
      operation: 'update',
      applied: false,
      error: {
        code: 'NOT_TEXT',
        message: 'Cannot modify binary files',
      },
      hint: 'Only text files can be modified.',
    };
  }

  // Read current content
  const currentContent = await fs.readFile(absPath, 'utf8');
  const currentChecksum = generateChecksum(currentContent);

  // Verify checksum if provided
  if (input.checksum && input.checksum !== currentChecksum) {
    return {
      success: false,
      path: relativePath,
      operation: 'update',
      applied: false,
      error: {
        code: 'CHECKSUM_MISMATCH',
        message: `File has changed. Expected: ${input.checksum}, actual: ${currentChecksum}`,
        recoveryHint: 'Re-read the file to get the current content and checksum.',
      },
      hint: `Checksum mismatch — file changed since your last read. Use fs_read to get current content and new checksum (${currentChecksum}).`,
    };
  }

  if (!input.lines) {
    return {
      success: false,
      path: relativePath,
      operation: 'update',
      applied: false,
      error: {
        code: 'NO_TARGET',
        message: '"lines" must be specified for update',
      },
      hint: 'Specify lines="10-15" to target content for modification.',
    };
  }

  // Determine target range
  const range = parseLineRange(input.lines);
  if (!range) {
    return {
      success: false,
      path: relativePath,
      operation: 'update',
      applied: false,
      error: {
        code: 'INVALID_RANGE',
        message: `Invalid line range: ${input.lines}`,
      },
      hint: 'Line range format: "10" for single line, "10-15" for range.',
    };
  }

  const lines = currentContent.split('\n');
  if (range.start > lines.length) {
    return {
      success: false,
      path: relativePath,
      operation: 'update',
      applied: false,
      error: {
        code: 'OUT_OF_RANGE',
        message: `Line ${range.start} is beyond file end (${lines.length} lines)`,
      },
      hint: `File has ${lines.length} lines. Adjust your line range.`,
    };
  }

  const targetStart = range.start;
  const targetEnd = Math.min(range.end, lines.length);

  // Apply action
  let newContent: string;
  let actionDescription: string;
  let linesAffected: number;

  // Content is guaranteed by Zod schema for non-delete actions
  const content = input.content ?? '';

  switch (input.action) {
    case 'replace':
      newContent = replaceLines(currentContent, targetStart, targetEnd, content);
      actionDescription = 'replaced';
      linesAffected = targetEnd - targetStart + 1;
      break;

    case 'insert_before':
      newContent = insertBeforeLine(currentContent, targetStart, content);
      actionDescription = 'inserted_before';
      linesAffected = content.split('\n').length;
      break;

    case 'insert_after':
      newContent = insertAfterLine(currentContent, targetEnd, content);
      actionDescription = 'inserted_after';
      linesAffected = content.split('\n').length;
      break;

    case 'delete_lines':
      newContent = deleteLines(currentContent, targetStart, targetEnd);
      actionDescription = 'deleted_lines';
      linesAffected = targetEnd - targetStart + 1;
      break;

    default:
      return {
        success: false,
        path: relativePath,
        operation: 'update',
        applied: false,
        error: {
          code: 'INVALID_ACTION',
          message: `Unknown action: ${input.action}`,
        },
        hint: 'Valid actions: replace, insert_before, insert_after, delete_lines',
      };
  }

  // Normalize trailing newline
  const finalContent = withTrailingNewline(newContent, input.ensureTrailingNewline);

  // Generate diff
  const diff = generateDiff(currentContent, finalContent, relativePath);

  if (input.dryRun) {
    return {
      success: true,
      path: relativePath,
      operation: 'update',
      applied: false,
      result: {
        action: `would_${actionDescription}`,
        linesAffected,
        diff,
      },
      hint: 'DRY RUN — no changes applied. Review the diff above. Run with dryRun=false to apply.',
    };
  }

  // Apply changes
  await fs.writeFile(absPath, finalContent, 'utf8');
  const newChecksum = generateChecksum(finalContent);

  return {
    success: true,
    path: relativePath,
    operation: 'update',
    applied: true,
    result: {
      action: actionDescription,
      linesAffected,
      newChecksum,
      diff,
    },
    hint: `${actionDescription.replace('_', ' ')} ${linesAffected} line(s). New checksum: ${newChecksum}. The diff above shows what changed.`,
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
        success: false,
        path: input.path,
        operation: input.operation,
        applied: false,
        error: { code: 'OUT_OF_SCOPE', message: resolved.error },
        hint: isAbsolute
          ? `This is a SANDBOXED filesystem — you cannot write to arbitrary system paths. ` +
            `Use fs_read(".") first to see available mounts, then write to paths like "${mountExample}/file.md".`
          : `Path must be within a mount. Example: "${mountExample}/file.md". ` +
            `Use fs_read(".") to see available mounts.`,
      };
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    const { absolutePath, virtualPath, mount } = resolved.resolved;

    // Security: Validate symlinks don't escape mount
    const symlinkCheck = await validatePathChain(absolutePath, mount);
    if (!symlinkCheck.ok) {
      const result: FsWriteResult = {
        success: false,
        path: virtualPath,
        operation: input.operation,
        applied: false,
        error: { code: 'SYMLINK_ESCAPE', message: symlinkCheck.error },
        hint: 'Symlinks pointing outside the mounted directory are not allowed for security.',
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
          ensureTrailingNewline: input.ensureTrailingNewline,
        });
        break;

      case 'update':
        result = await updateFile(absolutePath, virtualPath, input);
        break;

      default:
        result = {
          success: false,
          path: virtualPath,
          operation: input.operation,
          applied: false,
          error: { code: 'INVALID_OPERATION', message: `Unknown operation: ${input.operation}` },
          hint: 'Valid operations: create, update',
        };
    }

    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
};
