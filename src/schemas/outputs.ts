import * as z from 'zod/v4';

export const treeEntrySchema = z.object({
  path: z.string(),
  kind: z.enum(['file', 'directory']),
  size: z.string().optional(),
  modified: z.string().optional(),
  children: z.number().int().nonnegative().optional(),
  files: z.number().int().nonnegative().optional(),
  depthLimitReached: z.boolean().optional(),
});

export const errorInfoSchema = z.object({
  code: z.string(),
  message: z.string(),
  recoveryHint: z.string().optional(),
});

const directoryStatsSchema = z.object({
  returned: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  hasMore: z.boolean(),
  truncated: z.boolean(),
});

export const fsReadOutputSchema = z.object({
  success: z.boolean(),
  path: z.string(),
  type: z.enum(['file', 'directory']),
  entries: z.array(treeEntrySchema).optional(),
  summary: z.string().optional(),
  stats: directoryStatsSchema.optional(),
  content: z
    .object({
      text: z.string(),
      checksum: z.string(),
      totalLines: z.number().int().nonnegative(),
      range: z
        .object({
          start: z.number().int().positive(),
          end: z.number().int().nonnegative(),
        })
        .optional(),
      truncated: z.boolean(),
    })
    .optional(),
  error: errorInfoSchema.optional(),
  hint: z.string(),
});

const fileMatchSchema = z.object({
  name: z.string(),
  path: z.string(),
});

const contentMatchSchema = z.object({
  path: z.string(),
  line: z.number().int().positive(),
  text: z.string(),
});

export const fsSearchOutputSchema = z.object({
  success: z.boolean(),
  query: z.string(),
  files: z.array(fileMatchSchema),
  content: z.array(contentMatchSchema).optional(),
  totalCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
  error: errorInfoSchema.optional(),
  hint: z.string(),
});

const createResultSchema = z.object({
  action: z.enum(['created', 'would_create']),
  newChecksum: z.string().optional(),
  diff: z.string(),
});

const updateResultSchema = z.object({
  action: z.string(),
  targetRange: z.object({
    start: z.number().int().positive(),
    end: z.number().int().positive(),
  }),
  newChecksum: z.string().optional(),
  diff: z.string(),
});

export const fsWriteOutputSchema = z.object({
  status: z.enum(['applied', 'preview', 'error']),
  path: z.string(),
  operation: z.enum(['create', 'update']),
  result: z.union([createResultSchema, updateResultSchema]).optional(),
  error: errorInfoSchema.optional(),
  hint: z.string(),
});

export const fsManageOutputSchema = z.object({
  success: z.boolean(),
  operation: z.string(),
  path: z.string(),
  target: z.string().optional(),
  stat: z
    .object({
      size: z.number().nonnegative(),
      modified: z.string(),
      created: z.string(),
      isDirectory: z.boolean(),
    })
    .optional(),
  error: errorInfoSchema.optional(),
  hint: z.string(),
});

export type TreeEntry = z.infer<typeof treeEntrySchema>;
export type ErrorInfo = z.infer<typeof errorInfoSchema>;
export type FsReadOutput = z.infer<typeof fsReadOutputSchema>;
export type FsSearchOutput = z.infer<typeof fsSearchOutputSchema>;
export type FsWriteOutput = z.infer<typeof fsWriteOutputSchema>;
export type FsManageOutput = z.infer<typeof fsManageOutputSchema>;
