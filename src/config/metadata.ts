/**
 * Centralized metadata for files-mcp tools.
 */

export const toolsMetadata = {
  fs_read: {
    name: 'fs_read',
    title: 'Filesystem Read',
    description:
      'Explore directories, read files, find files by name, or search content. ' +
      'Returns line numbers and checksums needed for editing. ' +
      'Supports preset patterns for Obsidian/Markdown (wikilinks, tags, tasks, headings). ' +
      'IMPORTANT: For OR searches (term1 OR term2), use patternMode="regex" with pattern="term1|term2". ' +
      'Default "literal" mode treats | as literal character, not OR operator.',
    readBeforeUse: false, // This IS the read tool
    annotations: {
      audience: ['agent'],
      safe: true,
      idempotent: true,
    },
  },

  fs_write: {
    name: 'fs_write',
    title: 'Filesystem Write',
    description:
      'Create, modify, or delete files in the sandboxed filesystem. ' +
      'IMPORTANT: Always call fs_read first to get the checksum. ' +
      'Supports line-based and pattern-based targeting with dryRun preview.',
    readBeforeUse: true, // MUST read file before writing
    annotations: {
      audience: ['agent'],
      safe: false, // modifies state
      idempotent: false,
    },
  },
} as const;

export type ToolName = keyof typeof toolsMetadata;
