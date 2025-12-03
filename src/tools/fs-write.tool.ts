/**
 * fs_write Tool
 *
 * Unified modification tool for create, update, and delete operations.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  deleteLines,
  findMatches,
  findUniqueMatch,
  generateChecksum,
  generateDiff,
  getMounts,
  insertAfterLine,
  insertBeforeLine,
  isTextFile,
  type PatternMode,
  parseLineRange,
  replaceAllMatches,
  replaceLines,
  resolvePath as resolveVirtualPath,
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
        'Relative path to the file. For create: where to create. For update/delete: file to modify. ' +
          'Parent directories are created automatically for new files.',
      ),

    operation: z
      .enum(['create', 'update', 'delete'])
      .describe(
        '"create": Make new file (fails if exists). ' +
          '"update": Modify existing file (fails if not exists). ' +
          '"delete": Remove file permanently.',
      ),

    // Targeting (for update)
    lines: z
      .string()
      .optional()
      .describe(
        'Target specific lines for update. Format: "10" (line 10), "10-15" (lines 10-15 inclusive). ' +
          'PREFERRED over pattern — line numbers are unambiguous. Get line numbers from fs_read output.',
      ),

    pattern: z
      .string()
      .optional()
      .describe(
        "Target content by pattern for update. Use when you don't have line numbers. " +
          'The FIRST match is used. If multiple matches exist, use lines instead.',
      ),

    patternMode: z
      .enum(['literal', 'regex', 'fuzzy', 'smart'])
      .optional()
      .default('literal')
      .describe(
        '"literal" (default): Exact text match. "regex": Regular expression. ' +
          '"fuzzy": Normalizes whitespace. "smart": Case-insensitive unless pattern has uppercase.',
      ),

    multiline: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'Enable patterns to span multiple lines. The dot (.) will match newlines. ' +
          'Note: ^ and $ still match string boundaries, not line boundaries.',
      ),

    replaceAll: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'When true with pattern+replace, replaces ALL occurrences instead of requiring unique match. ' +
          'Useful for bulk renames like [[OldName]] → [[NewName]] across a file. ' +
          'Use with caution — preview with dryRun=true first.',
      ),

    // Action (for update)
    action: z
      .enum(['replace', 'insert_before', 'insert_after', 'delete_lines'])
      .optional()
      .describe(
        'What to do with the targeted content. ' +
          '"replace": Replace target with new content. ' +
          '"insert_before": Add content before target (target unchanged). ' +
          '"insert_after": Add content after target (target unchanged). ' +
          '"delete_lines": Remove target lines entirely.',
      ),

    content: z
      .string()
      .optional()
      .describe(
        'The content to write. Required for create, replace, insert_before, insert_after. ' +
          'Not needed for delete or delete_lines.',
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
          'Returns a unified diff. Use to preview and verify complex edits.',
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
      if (data.operation === 'create' && !data.content) {
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
    { message: 'action is required for update operation', path: ['action'] },
  )
  .refine(
    (data) => {
      if (data.operation === 'update' && data.action !== 'delete_lines' && !data.content) {
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
  operation: 'create' | 'update' | 'delete';
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

  if (options.dryRun) {
    const diff = generateDiff('', content, relativePath);
    return {
      success: true,
      path: relativePath,
      operation: 'create',
      applied: false,
      result: {
        action: 'would_create',
        linesAffected: content.split('\n').length,
        diff,
      },
      hint: 'DRY RUN — file would be created with the content shown. Run with dryRun=false to apply.',
    };
  }

  // Create parent dirs if needed
  if (options.createDirs) {
    await fs.mkdir(path.dirname(absPath), { recursive: true });
  }

  await fs.writeFile(absPath, content, 'utf8');
  const newChecksum = generateChecksum(content);

  return {
    success: true,
    path: relativePath,
    operation: 'create',
    applied: true,
    result: {
      action: 'created',
      linesAffected: content.split('\n').length,
      newChecksum,
    },
    hint: `File created successfully. New checksum: ${newChecksum}. Use fs_read to verify the content.`,
  };
}

async function deleteFile(
  absPath: string,
  relativePath: string,
  dryRun: boolean,
): Promise<FsWriteResult> {
  if (!(await fileExists(absPath))) {
    return {
      success: false,
      path: relativePath,
      operation: 'delete',
      applied: false,
      error: {
        code: 'NOT_FOUND',
        message: `File does not exist: ${relativePath}`,
      },
      hint: 'File not found. Use fs_read to check if the path is correct.',
    };
  }

  if (dryRun) {
    return {
      success: true,
      path: relativePath,
      operation: 'delete',
      applied: false,
      result: {
        action: 'would_delete',
      },
      hint: 'DRY RUN — file would be deleted. Run with dryRun=false to apply.',
    };
  }

  await fs.unlink(absPath);

  return {
    success: true,
    path: relativePath,
    operation: 'delete',
    applied: true,
    result: {
      action: 'deleted',
    },
    hint: 'File deleted successfully.',
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

  // Determine target range
  let targetStart: number;
  let targetEnd: number;
  let patternMatch: { index: number; text: string } | null = null;

  if (input.lines) {
    // Line-based targeting
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

    targetStart = range.start;
    targetEnd = Math.min(range.end, lines.length);
  } else if (input.pattern) {
    // Pattern-based targeting
    // Check if replaceAll is requested
    if (input.replaceAll && input.action === 'replace') {
      // ReplaceAll mode: replace all occurrences
      const content = input.content ?? '';
      const result = replaceAllMatches(
        currentContent,
        input.pattern,
        content,
        input.patternMode as PatternMode,
        { multiline: input.multiline },
      );

      if (result.count === 0) {
        return {
          success: false,
          path: relativePath,
          operation: 'update',
          applied: false,
          error: {
            code: 'PATTERN_NOT_FOUND',
            message: `Pattern not found: "${input.pattern}"`,
            recoveryHint: 'Read the file to see current content, or try patternMode="fuzzy".',
          },
          hint: 'Pattern not found. Use fs_read to see current content and find the correct pattern.',
        };
      }

      // Generate diff
      const diff = generateDiff(currentContent, result.newContent, relativePath);

      if (input.dryRun) {
        return {
          success: true,
          path: relativePath,
          operation: 'update',
          applied: false,
          result: {
            action: 'would_replace_all',
            linesAffected: result.affectedLines.length,
            diff,
          },
          hint: `DRY RUN — would replace ${result.count} occurrence(s) at lines ${result.affectedLines.join(', ')}. Run with dryRun=false to apply.`,
        };
      }

      // Apply changes
      await fs.writeFile(absPath, result.newContent, 'utf8');
      const newChecksum = generateChecksum(result.newContent);

      return {
        success: true,
        path: relativePath,
        operation: 'update',
        applied: true,
        result: {
          action: 'replaced_all',
          linesAffected: result.affectedLines.length,
          newChecksum,
          diff,
        },
        hint: `Replaced ${result.count} occurrence(s) at lines ${result.affectedLines.join(', ')}. New checksum: ${newChecksum}.`,
      };
    }

    // Single match mode (default)
    const matchResult = findUniqueMatch(
      currentContent,
      input.pattern,
      input.patternMode as PatternMode,
      {
        multiline: input.multiline,
      },
    );

    if ('error' in matchResult) {
      if (matchResult.error === 'not_found') {
        return {
          success: false,
          path: relativePath,
          operation: 'update',
          applied: false,
          error: {
            code: 'PATTERN_NOT_FOUND',
            message: `Pattern not found: "${input.pattern}"`,
            recoveryHint: 'Read the file to see current content, or try patternMode="fuzzy".',
          },
          hint: 'Pattern not found. Use fs_read to see current content and find the correct pattern.',
        };
      } else {
        // Multiple matches found - suggest replaceAll or specific line
        const matches = findMatches(
          currentContent,
          input.pattern,
          input.patternMode as PatternMode,
          {
            multiline: input.multiline,
            maxMatches: 10,
          },
        );

        return {
          success: false,
          path: relativePath,
          operation: 'update',
          applied: false,
          error: {
            code: 'MULTIPLE_MATCHES',
            message: `Pattern matched ${matchResult.count} times at lines ${matchResult.lines.join(', ')}`,
            recoveryHint:
              'Use replaceAll=true to replace all, or lines="N" to target specific match.',
          },
          hint: `Pattern matched ${matchResult.count} times at lines ${matchResult.lines.join(', ')}. Options: (1) Use replaceAll=true to replace all occurrences, or (2) Use lines="${matches[0]?.line}" to target the first match.`,
        };
      }
    }

    const match = matchResult.match;
    targetStart = match.line;

    // For multiline matches, calculate end line
    const matchLines = match.text.split('\n').length;
    targetEnd = match.line + matchLines - 1;

    // Store match for substring replacement
    patternMatch = match;
  } else {
    return {
      success: false,
      path: relativePath,
      operation: 'update',
      applied: false,
      error: {
        code: 'NO_TARGET',
        message: 'Either lines or pattern must be specified for update',
      },
      hint: 'Specify lines="10-15" or pattern="text to find" to target content for modification.',
    };
  }

  // Apply action
  let newContent: string;
  let actionDescription: string;
  let linesAffected: number;

  // Content is guaranteed by Zod schema for non-delete actions
  const content = input.content ?? '';

  switch (input.action) {
    case 'replace':
      if (patternMatch) {
        // Substring replacement: replace only the matched text
        newContent =
          currentContent.slice(0, patternMatch.index) +
          content +
          currentContent.slice(patternMatch.index + patternMatch.text.length);
        actionDescription = 'replaced';
        // Calculate actual lines affected (old match lines + new content lines - overlap)
        const oldMatchLines = patternMatch.text.split('\n').length;
        const newContentLines = content.split('\n').length;
        linesAffected = Math.max(oldMatchLines, newContentLines);
      } else {
        // Line-based replacement (when using lines="N-M")
        newContent = replaceLines(currentContent, targetStart, targetEnd, content);
        actionDescription = 'replaced';
        linesAffected = targetEnd - targetStart + 1;
      }
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

  // Generate diff
  const diff = generateDiff(currentContent, newContent, relativePath);

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
  await fs.writeFile(absPath, newContent, 'utf8');
  const newChecksum = generateChecksum(newContent);

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
  description: `Create, modify, or delete files in the sandboxed filesystem.

🔒 SANDBOXED FILESYSTEM — This tool can ONLY write to specific mounted directories.
   You CANNOT write to arbitrary system paths like /Users or C:\\.
   Use fs_read(".") first to see available mounts.

⚠️ PREREQUISITE: You MUST call fs_read on a file BEFORE modifying it.
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

UPDATE — Modify existing file
  Required: path, action, content (except for delete_lines)
  Target using EITHER:
  - lines: "10-15" — PREFERRED, unambiguous
  - pattern: "text" — use when line numbers unknown

DELETE — Remove a file
  Required: path only. Cannot be undone.

═══════════════════════════════════════════════════════════
                    ACTIONS (for update)
═══════════════════════════════════════════════════════════
- replace: Replace target lines/pattern with new content
- insert_before: Add content before target
- insert_after: Add content after target
- delete_lines: Remove target lines

═══════════════════════════════════════════════════════════
                    REPLACE ALL
═══════════════════════════════════════════════════════════
To replace ALL occurrences of a pattern (e.g., rename [[OldName]] → [[NewName]]):
  { pattern: "[[OldName]]", replaceAll: true, content: "[[NewName]]" }

Without replaceAll, multiple matches cause an error.
Always use dryRun=true first to preview bulk changes.

═══════════════════════════════════════════════════════════
                    SAFETY
═══════════════════════════════════════════════════════════
- checksum: Pass from fs_read to prevent stale overwrites
- dryRun: Preview diff without applying (ALWAYS use first)

🚫 DO NOT call fs_write without first calling fs_read on the same file.`,

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

    const { absolutePath, virtualPath } = resolved.resolved;
    let result: FsWriteResult;

    switch (input.operation) {
      case 'create':
        // Content is guaranteed by Zod schema for create operation
        result = await createFile(absolutePath, virtualPath, input.content ?? '', {
          createDirs: input.createDirs,
          dryRun: input.dryRun,
        });
        break;

      case 'delete':
        result = await deleteFile(absolutePath, virtualPath, input.dryRun);
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
          hint: 'Valid operations: create, update, delete',
        };
    }

    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
};
