import { z } from 'zod';

/**
 * Output schemas for filesystem tools.
 *
 * These define the structure of tool responses for validation and documentation.
 */

// ─────────────────────────────────────────────────────────────
// Common Types
// ─────────────────────────────────────────────────────────────

/** Tree entry for directory listings */
export const treeEntrySchema = z.object({
  path: z.string().describe('Relative path from mount root'),
  kind: z.enum(['file', 'directory']).describe('Entry type'),
  children: z.number().optional().describe('Number of children (directories only)'),
  size: z.string().optional().describe('Human-readable size (files only, when details=true)'),
  modified: z.string().optional().describe('Last modified date (when details=true)'),
});

/** Search match result */
export const matchSchema = z.object({
  file: z.string().describe('File path where match was found'),
  line: z.number().describe('Line number (1-indexed)'),
  column: z.number().describe('Column position in line'),
  text: z.string().describe('Matched text'),
  context: z
    .object({
      before: z.array(z.string()).describe('Lines before match'),
      after: z.array(z.string()).describe('Lines after match'),
    })
    .optional()
    .describe('Surrounding context lines'),
});

/** Error info in responses */
export const errorInfoSchema = z.object({
  code: z.string().describe('Error code for programmatic handling'),
  message: z.string().describe('Human-readable error message'),
  recoveryHint: z.string().optional().describe('Suggestion for fixing the error'),
});

// ─────────────────────────────────────────────────────────────
// fs_read Output
// ─────────────────────────────────────────────────────────────

export const fsReadOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  path: z.string().describe('Path that was read'),
  type: z.enum(['file', 'directory', 'search']).describe('Type of result'),

  // Directory listing
  tree: z
    .object({
      entries: z.array(treeEntrySchema).describe('Directory entries'),
      summary: z.string().describe('Human-readable summary'),
    })
    .optional()
    .describe('Directory tree (when path is a directory)'),

  // File content
  content: z
    .object({
      text: z.string().describe('File content with line numbers'),
      checksum: z.string().describe('Checksum for safe editing'),
      totalLines: z.number().describe('Total lines in file'),
    })
    .optional()
    .describe('File content (when path is a file)'),

  // Search results
  matches: z.array(matchSchema).optional().describe('Search matches'),
  matchCount: z.number().optional().describe('Total matches found'),
  filesSearched: z.number().optional().describe('Files searched'),

  // Metadata
  truncated: z.boolean().optional().describe('Whether results were truncated'),
  error: errorInfoSchema.optional().describe('Error details if success=false'),
  hint: z.string().describe('Suggested next action'),
});

// ─────────────────────────────────────────────────────────────
// fs_write Output
// ─────────────────────────────────────────────────────────────

export const fsWriteOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  path: z.string().describe('Path that was written'),
  operation: z.enum(['create', 'update', 'delete']).describe('Operation performed'),
  applied: z.boolean().describe('Whether changes were applied (false for dryRun)'),

  result: z
    .object({
      action: z.string().describe('Specific action taken'),
      linesAffected: z.number().optional().describe('Lines changed'),
      newChecksum: z.string().optional().describe('Checksum after modification'),
      diff: z.string().optional().describe('Unified diff of changes'),
    })
    .optional()
    .describe('Result details for successful operations'),

  error: errorInfoSchema.optional().describe('Error details if success=false'),
  hint: z.string().describe('Suggested next action'),
});

// ─────────────────────────────────────────────────────────────
// Type Exports
// ─────────────────────────────────────────────────────────────

export type TreeEntry = z.infer<typeof treeEntrySchema>;
export type Match = z.infer<typeof matchSchema>;
export type ErrorInfo = z.infer<typeof errorInfoSchema>;
export type FsReadOutput = z.infer<typeof fsReadOutputSchema>;
export type FsWriteOutput = z.infer<typeof fsWriteOutputSchema>;
