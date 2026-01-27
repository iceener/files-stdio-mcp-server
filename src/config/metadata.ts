/**
 * Centralized metadata for files-mcp tools.
 */

export const toolsMetadata = {
  fs_read: {
    name: 'fs_read',
    title: 'Filesystem Read',
    description:
      'Read files or list directories in the sandboxed filesystem. ' +
      'Returns line numbers and checksums needed for editing. ' +
      'Use fs_search to locate files or content.',
    readBeforeUse: false, // This IS the read tool
    annotations: {
      audience: ['agent'],
      safe: true,
      idempotent: true,
    },
  },

  fs_search: {
    name: 'fs_search',
    title: 'Filesystem Search',
    description:
      'Find files by name and search content within files. ' +
      'Supports literal, regex, and fuzzy content search with optional filters.',
    readBeforeUse: false,
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
      'Create or update files in the sandboxed filesystem. ' +
      'IMPORTANT: Always call fs_read first to get the checksum. ' +
      'Line-based targeting with dryRun preview.',
    readBeforeUse: true, // MUST read file before writing
    annotations: {
      audience: ['agent'],
      safe: false, // modifies state
      idempotent: false,
    },
  },

  fs_manage: {
    name: 'fs_manage',
    title: 'Filesystem Manage',
    description:
      'Structural operations for files and directories: delete, rename, move, copy, mkdir, stat.',
    readBeforeUse: false,
    annotations: {
      audience: ['agent'],
      safe: false,
      idempotent: false,
    },
  },
} as const;

export type ToolName = keyof typeof toolsMetadata;
