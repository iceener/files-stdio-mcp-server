# Files MCP Server

Stdio MCP server for sandboxed file access — read files, search content, safely edit with checksums, and manage file structure.

Author: [overment](https://x.com/_overment)

> [!WARNING]
> This server provides filesystem access to an AI agent. While it's sandboxed to specific directories, always:
> - Review tool outputs before confirming changes
> - Use `dryRun=true` to preview destructive operations
> - Keep backups of important files
> - Set `FS_ROOTS` to only the directories you want the agent to access

## Motivation

Traditional file operations require precise paths and exact content — things LLMs struggle with. This server is designed so AI agents can:

- **Explore first** — understand directory structure before acting
- **Find by name or content** — locate files without knowing exact paths
- **Edit safely** — checksum verification prevents stale overwrites
- **Preview changes** — dry-run mode shows diffs before applying
- **Recover from errors** — hints guide the agent to correct mistakes

The result: an agent that can reliably manage your Obsidian vault, documentation, notes, or any text-based file collection.

## Features

- ✅ **Directory Exploration** — tree view with file counts, sizes, timestamps
- ✅ **File Reading** — line-numbered content with checksums for safe editing
- ✅ **File & Content Search** — filename search + literal/regex/fuzzy content search
- ✅ **Safe Editing** — checksum verification, dry-run preview, unified diffs
- ✅ **Structural Operations** — delete, rename, move, copy, mkdir, stat
- ✅ **Multi-Mount Support** — access multiple directories as virtual mount points
- ✅ **Sandboxed** — cannot access paths outside configured mounts

### Design Principles

- **Explore before edit**: Agent must read a file before modifying it (gets checksum + line numbers)
- **Preview before apply**: `dryRun=true` shows exactly what would change
- **Clear feedback**: Every response includes hints for next steps and error recovery
- **Compact by default**: File details (size, modified) only shown when `details=true`
- **Single mount optimization**: When one mount is configured, `fs_read(".")` shows contents directly

---

## Quick Start

### 1. Install

```bash
cd files-mcp
bun install
```

### 2. Configure

Create `.env`:

```env
# Directories the agent can access (comma-separated)
FS_ROOTS=/path/to/vault,/path/to/docs

# Or for a single directory:
# FS_ROOT=/path/to/vault

# Optional
LOG_LEVEL=info
MAX_FILE_SIZE=1048576
```

### 3. Run

```bash
bun dev
```

### 4. Connect to Client

**Claude Desktop / Cursor:**

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/files-mcp/src/index.ts"],
      "env": {
        "FS_ROOTS": "/Users/you/vault,/Users/you/docs"
      }
    }
  }
}
```

---

## MCP Bundle (MCPB)

This server is also available as an **MCP Bundle** (`.mcpb`) for one-click installation in supported apps like Claude Desktop, Alice, and other MCPB-compatible applications.

### What is MCPB?

[MCP Bundles](https://github.com/modelcontextprotocol/mcpb) are zip archives containing a local MCP server and a `manifest.json` that describes the server and its capabilities. The format enables end users to install local MCP servers with a single click — no manual configuration required.

### Installing from MCPB

1. Download the `files-mcp.mcpb` file
2. Open it with a compatible app (Claude Desktop, Alice, etc.)
3. Configure the **Root Directory** when prompted — this is the directory the agent will have access to
4. Done! The server is installed and ready to use

### manifest.json

The manifest defines:

- **Server configuration** — command, args, environment variables
- **Tools** — `fs_read`, `fs_search`, `fs_write`, `fs_manage` with descriptions
- **User config** — prompts for `FS_ROOT` directory during installation

```json
{
  "manifest_version": "0.2",
  "name": "files-mcp",
  "version": "1.0.0",
  "server": {
    "type": "node",
    "entry_point": "dist/index.js",
    "mcp_config": {
      "command": "node",
      "args": ["${__dirname}/dist/index.js"],
      "env": {
        "FS_ROOT": "${user_config.FS_ROOT}"
      }
    }
  },
  "user_config": {
    "FS_ROOT": {
      "type": "directory",
      "title": "Root Directory",
      "description": "The directory the agent will have access to.",
      "required": true
    }
  }
}
```

The `${user_config.FS_ROOT}` syntax injects the user-selected directory into the server's environment at runtime.

---

## Server Instructions (What the Model Sees)

```text
🔒 SANDBOXED FILESYSTEM — This tool can ONLY access specific mounted directories.
   You CANNOT access arbitrary system paths like /Users or C:\.
   Always start with fs_read(".") to see available mounts.

⚠️ ALWAYS read a file BEFORE answering questions about its content.
⚠️ ALWAYS read a file BEFORE modifying it (you need the checksum).

MANDATORY WORKFLOW:
1. fs_read(".") → see available mounts
2. fs_search(...) → locate files or content
3. fs_read("path/file.md") → get content + checksum
4. fs_write with dryRun=true → preview diff
5. fs_write with dryRun=false + checksum → apply change
6. fs_manage for structural changes (delete/rename/move/copy/mkdir)
```

---

## Tools

### `fs_read`

Read files or list directories.

**Input:**
```ts
{
  path: string;                    // "." for root, "docs/", "notes/todo.md"
  
  // Options
  depth?: number;                  // Directory traversal depth (default 1)
  details?: boolean;               // Include size/modified (default false)
  lines?: string;                  // "10-50" for partial read
  types?: string[];                // Filter directory listing by type
  glob?: string;                   // Glob filter for listing
  exclude?: string[];              // Exclude patterns
  respectIgnore?: boolean;         // Honor .gitignore (default true)
}
```

**Output:**
```ts
{
  success: boolean;
  path: string;
  type: "directory" | "file";
  
  // For directories
  entries?: Array<{ path, kind, children?, size?, modified? }>;
  summary?: string;
  
  // For files
  content?: {
    text: string;        // With line numbers
    checksum: string;    // Pass to fs_write
    totalLines: number;
    range?: { start: number; end: number };
    truncated: boolean;
  };
  
  hint: string;          // Next action suggestion
}
```

### `fs_search`

Find files by name and search content within files.

**Input:**
```ts
{
  path: string;                   // "." for all mounts
  query: string;                  // Search term
  target?: "all" | "filename" | "content";
  patternMode?: "literal" | "regex" | "fuzzy";
  caseInsensitive?: boolean;
  wholeWord?: boolean;
  multiline?: boolean;
  types?: string[];
  glob?: string;
  exclude?: string[];
  depth?: number;                 // Default 5
  maxResults?: number;            // Default 100
  context?: number;               // Default 3
  respectIgnore?: boolean;
}
```

**Output:**
```ts
{
  success: boolean;
  query: string;
  target: "all" | "filename" | "content";
  results: {
    byFilename: Array<{ path, score, matchIndices }>;
    byContent: Array<{ path, matches: Array<{ line, endLine, matchCount, text, context }> }>;
  };
  stats: {
    filenameMatches: number;
    contentMatches: number;
    filesSearched: number;
  };
  truncated: boolean;
  hint: string;
}
```

### `fs_write`

Create or update files with safety features.

**Input:**
```ts
{
  path: string;
  operation: "create" | "update";
  
  // For create
  content?: string;
  
  // For update — target by lines
  lines?: string;                  // "10-15" — PREFERRED
  
  // For update — action
  action?: "replace" | "insert_before" | "insert_after" | "delete_lines";
  content?: string;                // New content
  
  // Safety
  checksum?: string;               // From fs_read — RECOMMENDED
  dryRun?: boolean;                // Preview only (default false)
  createDirs?: boolean;            // Auto-create parent dirs (default true)
}
```

**Output:**
```ts
{
  success: boolean;
  path: string;
  operation: "create" | "update";
  applied: boolean;
  
  result?: {
    action: string;
    linesAffected?: number;
    newChecksum?: string;
    diff?: string;               // Unified diff
  };
  
  error?: {
    code: string;
    message: string;
    recoveryHint?: string;
  };
  
  hint: string;
}
```

### `fs_manage`

Structural filesystem operations.

**Input:**
```ts
{
  operation: "delete" | "rename" | "move" | "copy" | "mkdir" | "stat";
  path: string;
  target?: string;                 // rename/move/copy
  recursive?: boolean;             // directory ops (default false)
  force?: boolean;                 // overwrite (default false)
}
```

**Output:**
```ts
{
  success: boolean;
  operation: string;
  path: string;
  target?: string;
  stat?: { size, modified, created, isDirectory };
  hint: string;
}
```

---

## Examples

### 1. Explore the vault

```json
{ "path": "." }
```

**Response:**
```
18 items (15 files, 3 directories)

- Core/
- Projects/
- Books/
- map.md
- inbox.md
...

hint: "Showing contents of 'vault'. Use fs_read on any path to explore deeper."
```

### 2. Search for a file by name

```json
{ "path": ".", "query": "todo", "target": "filename" }
```

**Response:**
```
Found 3 filename match(es)

- Core/Todo.md
- Projects/Todo.md
- inbox.md
...

hint: "Found 3 filename match(es)."
```

### 3. Read a file

```json
{ "path": "Core/Values.md" }
```

**Response:**
```
File read complete. Checksum: a1b2c3d4e5f6.

   1| # Values
   2|
   3| ## Integrity
   4| Be honest, even when it's hard.
   5|
   6| ## Growth
   7| Learn something new every day.
...

hint: "To edit this file, use fs_write with checksum a1b2c3d4e5f6."
```

### 4. Find all incomplete tasks

```json
{ "path": ".", "query": "- \\[ \\] ", "patternMode": "regex", "target": "content" }
```

**Response:**
```
Found 7 content match(es) in 4 file(s).

- Projects/Alice.md:12 — "- [ ] Implement search"
- Projects/Alice.md:15 — "- [ ] Add tests"
- inbox.md:3 — "- [ ] Review PR"
...
```

### 5. Replace text (preview first, line-based)

```json
{
  "path": "Core/Values.md",
  "operation": "update",
  "action": "replace",
  "lines": "3",
  "content": "Act with integrity",
  "checksum": "a1b2c3d4e5f6",
  "dryRun": true
}
```

**Response:**
```
DRY RUN — no changes applied.

--- a/Core/Values.md
+++ b/Core/Values.md
@@ -3,1 +3,1 @@
-Be honest, even when it's hard.
+Act with integrity, even when it's hard.

hint: "Review the diff above. Run with dryRun=false to apply."
```

### 6. Move a file to archive

```json
{
  "operation": "move",
  "path": "Projects/Alice.md",
  "target": "Archive/Alice.md",
  "force": true
}
```

**Response:**
```
Move completed successfully.
```

### 7. Mark task as complete

```json
{
  "path": "inbox.md",
  "operation": "update",
  "action": "replace",
  "lines": "3",
  "content": "- [x] Review PR",
  "checksum": "xyz789"
}
```

**Response:**
```
replaced 1 line(s). New checksum: abc123.

hint: "The diff above shows what changed."
```

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `FS_ROOTS` | `.` | Comma-separated paths the agent can access |
| `FS_ROOT` | `.` | Single path (backward compatibility) |
| `MCP_NAME` | `files-mcp` | Server name |
| `MCP_VERSION` | `1.0.0` | Server version |
| `LOG_LEVEL` | `info` | Log level: debug, info, warning, error |
| `MAX_FILE_SIZE` | `1048576` | Max file size in bytes (1MB) |

### Multi-Mount Setup

Access multiple directories:

```env
FS_ROOTS=/Users/me/vault,/Users/me/projects,/Users/me/notes
```

Each path becomes a mount named after its folder:
- `vault/` → `/Users/me/vault`
- `projects/` → `/Users/me/projects`
- `notes/` → `/Users/me/notes`

---

## Client Configuration

**Claude Desktop:**

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "bun",
      "args": ["run", "/path/to/files-mcp/src/index.ts"],
      "env": {
        "FS_ROOTS": "/Users/me/vault"
      }
    }
  }
}
```

**Cursor:**

```json
{
  "filesystem": {
    "command": "bun",
    "args": ["run", "/path/to/files-mcp/src/index.ts"],
    "env": {
      "FS_ROOTS": "/Users/me/vault"
    }
  }
}
```

---

## Development

```bash
bun dev           # Start with hot reload
bun test          # Run tests
bun run typecheck # TypeScript check
bun run lint      # Lint code
bun run build     # Production build
bun run inspector # Test with MCP Inspector
```

---

## Architecture

```
src/
├── index.ts              # Entry point: stdio transport
├── config/
│   ├── env.ts            # Environment config & mount parsing
│   └── metadata.ts       # Tool descriptions
├── core/
│   ├── capabilities.ts   # Server capabilities
│   └── mcp.ts            # McpServer builder
├── tools/
│   ├── index.ts          # Tool registration
│   ├── fs-read.tool.ts   # Read and explore
│   ├── fs-search.tool.ts # Filename + content search
│   ├── fs-write.tool.ts  # Create and update
│   └── fs-manage.tool.ts # Structural operations
├── lib/
│   ├── checksum.ts       # SHA256 checksums
│   ├── diff.ts           # Unified diff generation
│   ├── filetypes.ts      # Text/binary detection
│   ├── ignore.ts         # .gitignore support
│   ├── lines.ts          # Line manipulation
│   ├── paths.ts          # Multi-mount path resolution
│   └── patterns.ts       # Pattern matching utilities
└── utils/
    ├── errors.ts         # Error utilities
    └── logger.ts         # Logging
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "SANDBOXED FILESYSTEM: Absolute paths not allowed" | Use relative paths within mounts. Start with `fs_read(".")` to see available mounts. |
| "Path does not match any mount" | Check `FS_ROOTS` is set correctly. Paths must start with a mount name (e.g., `vault/notes.md`). |
| "CHECKSUM_MISMATCH" | File changed since you read it. Re-read with `fs_read` to get fresh content. |
| "DIRECTORY_NOT_EMPTY" | Directory operations need `recursive=true` for delete/move/copy. |
| "ALREADY_EXISTS" | Target already exists. Use `force=true` where supported. |
| Binary file errors | Only text files can be read/written. Check file extension. |
| Single mount still shows "docs" | Restart the MCP server after changing `FS_ROOTS`. |

---

## License

MIT
