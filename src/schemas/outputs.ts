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
  type: z.enum(['file', 'directory']).describe('Type of result'),

  // Directory listing
  entries: z.array(treeEntrySchema).optional().describe('Directory entries (when path is a directory)'),
  summary: z.string().optional().describe('Human-readable summary'),

  // File content
  content: z
    .object({
      text: z.string().describe('File content with line numbers'),
      checksum: z.string().describe('Checksum for safe editing'),
      totalLines: z.number().describe('Total lines in file'),
      range: z
        .object({
          start: z.number().describe('Start line (1-indexed)'),
          end: z.number().describe('End line (1-indexed)'),
        })
        .optional(),
      truncated: z.boolean().describe('Whether content was truncated'),
    })
    .optional()
    .describe('File content (when path is a file)'),

  error: errorInfoSchema.optional().describe('Error details if success=false'),
  hint: z.string().describe('Suggested next action'),
});

// ─────────────────────────────────────────────────────────────
// fs_search Output
// ─────────────────────────────────────────────────────────────

export const filenameMatchSchema = z.object({
  path: z.string().describe('Matched file path'),
  score: z.number().describe('Fuzzy match score (higher is better)'),
  matchIndices: z.array(z.number()).describe('Indices of matched characters'),
});

export const contentMatchSchema = z.object({
  line: z.number().describe('Start line number'),
  endLine: z.number().describe('End line number'),
  matchCount: z.number().describe('Number of matches in this cluster'),
  text: z.string().describe('Matched text summary'),
  context: z.object({
    before: z.array(z.string()).describe('Lines before the match'),
    match: z.array(z.string()).describe('Matched lines'),
    after: z.array(z.string()).describe('Lines after the match'),
  }),
});

export const contentFileSchema = z.object({
  path: z.string().describe('File path where matches were found'),
  matches: z.array(contentMatchSchema).describe('Matches within the file'),
});

export const fsSearchOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  query: z.string().describe('Search query'),
  target: z.enum(['all', 'filename', 'content']).describe('Search target'),
  results: z.object({
    byFilename: z.array(filenameMatchSchema).describe('Filename matches'),
    byContent: z.array(contentFileSchema).describe('Content matches by file'),
  }),
  stats: z.object({
    filenameMatches: z.number().describe('Number of filename matches'),
    contentMatches: z.number().describe('Number of content matches'),
    filesSearched: z.number().describe('Number of files searched for content'),
  }),
  truncated: z.boolean().describe('Whether results were truncated'),
  error: errorInfoSchema.optional().describe('Error details if success=false'),
  hint: z.string().describe('Suggested next action'),
});

// ─────────────────────────────────────────────────────────────
// fs_write Output
// ─────────────────────────────────────────────────────────────

export const fsWriteOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  path: z.string().describe('Path that was written'),
  operation: z.enum(['create', 'update']).describe('Operation performed'),
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
// fs_manage Output
// ─────────────────────────────────────────────────────────────

export const fsManageOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  operation: z.string().describe('Operation performed'),
  path: z.string().describe('Source path'),
  target: z.string().optional().describe('Target path (if applicable)'),
  stat: z
    .object({
      size: z.number().describe('Size in bytes'),
      modified: z.string().describe('Last modified timestamp'),
      created: z.string().describe('Created timestamp'),
      isDirectory: z.boolean().describe('Whether path is a directory'),
    })
    .optional()
    .describe('Stat result (for stat operation)'),
  error: errorInfoSchema.optional().describe('Error details if success=false'),
  hint: z.string().describe('Suggested next action'),
});

// ─────────────────────────────────────────────────────────────
// Type Exports
// ─────────────────────────────────────────────────────────────

export type TreeEntry = z.infer<typeof treeEntrySchema>;
export type ErrorInfo = z.infer<typeof errorInfoSchema>;
export type FsReadOutput = z.infer<typeof fsReadOutputSchema>;
export type FsSearchOutput = z.infer<typeof fsSearchOutputSchema>;
export type FsWriteOutput = z.infer<typeof fsWriteOutputSchema>;
export type FsManageOutput = z.infer<typeof fsManageOutputSchema>;
