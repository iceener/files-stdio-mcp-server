/**
 * Path resolution for multi-mount filesystem.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { config, type Mount } from '../config/env.js';

export interface ResolvedPath {
  /** The mount this path belongs to */
  mount: Mount;
  /** Absolute path on the filesystem */
  absolutePath: string;
  /** Path relative to the mount (without mount name prefix) */
  relativePath: string;
  /** Full virtual path (with mount name prefix) */
  virtualPath: string;
}

export type PathResolutionResult =
  | { ok: true; resolved: ResolvedPath }
  | { ok: false; error: string };

/**
 * Check if a path segment attempts to escape (e.g., "..")
 */
function hasEscapeAttempt(pathStr: string): boolean {
  const segments = pathStr.split(/[/\\]/);
  return segments.some((seg) => seg === '..');
}

/**
 * Check if a path is an absolute filesystem path (not a virtual mount path).
 */
function isAbsolutePath(pathStr: string): boolean {
  // Unix absolute path: starts with /
  if (pathStr.startsWith('/')) {
    return true;
  }
  // Windows absolute path: starts with drive letter (C:\, D:\, etc.)
  if (/^[a-zA-Z]:[/\\]/.test(pathStr)) {
    return true;
  }
  return false;
}

/**
 * Resolve a virtual path to a real filesystem path.
 *
 * Virtual paths are structured as: mountName/path/to/file
 * For example: "vault/notes/todo.md" resolves to the vault mount + "notes/todo.md"
 *
 * Special case: "." returns null mount, indicating root listing should show mounts.
 */
export function resolvePath(virtualPath: string): PathResolutionResult {
  const trimmed = virtualPath.trim();

  // Check for absolute paths (not allowed - this is a sandboxed filesystem)
  if (isAbsolutePath(trimmed)) {
    const mounts = config.MOUNTS.map((m) => m.name).join(', ');

    // Suggest the corrected path by stripping the leading slash
    const suggestedPath = trimmed.replace(/^\/+/, '');
    const suggestion = suggestedPath
      ? `Try using "${suggestedPath}" instead (without the leading "/").`
      : `Use fs_read(".") to explore available mounts.`;

    return {
      ok: false,
      error:
        `SANDBOXED FILESYSTEM: Absolute paths like "${trimmed}" are not allowed. ` +
        `This tool only accesses specific mounted directories. ` +
        `Available mounts: ${mounts}. ${suggestion}`,
    };
  }

  // Check for escape attempts
  if (hasEscapeAttempt(trimmed)) {
    return { ok: false, error: 'Path cannot contain ".." segments (no directory traversal)' };
  }

  // Special case: root path shows mount listing
  if (trimmed === '.' || trimmed === '' || trimmed === '/') {
    // Return first mount as a placeholder - handler will show mount list
    const mount = config.MOUNTS[0];
    if (!mount) {
      return { ok: false, error: 'No filesystem mounts configured' };
    }
    return {
      ok: true,
      resolved: {
        mount,
        absolutePath: mount.absolutePath,
        relativePath: '.',
        virtualPath: '.',
      },
    };
  }

  // Normalize path separators
  const normalized = trimmed.replace(/\\/g, '/').replace(/^\/+/, '');

  // Extract mount name (first segment)
  const segments = normalized.split('/');
  const mountName = segments[0];
  const restPath = segments.slice(1).join('/') || '.';

  // Find matching mount
  const mount = config.MOUNTS.find((m) => m.name === mountName);
  if (!mount) {
    // Maybe user is trying to access without mount prefix?
    // If there's only one mount, be lenient
    if (config.MOUNTS.length === 1) {
      const singleMount = config.MOUNTS[0];
      if (!singleMount) {
        return { ok: false, error: 'No filesystem mounts configured' };
      }
      const absolutePath = path.resolve(singleMount.absolutePath, normalized);

      // Security check: ensure path is within mount
      if (
        !absolutePath.startsWith(singleMount.absolutePath + path.sep) &&
        absolutePath !== singleMount.absolutePath
      ) {
        return { ok: false, error: 'Path is outside allowed directory' };
      }

      return {
        ok: true,
        resolved: {
          mount: singleMount,
          absolutePath,
          relativePath: normalized,
          virtualPath: normalized,
        },
      };
    }

    const availableMounts = config.MOUNTS.map((m) => `"${m.name}/"`).join(', ');
    return {
      ok: false,
      error:
        `Path "${normalized}" does not match any mount. Available mounts: ${availableMounts}. ` +
        `Paths must start with a mount name (e.g., "${config.MOUNTS[0]?.name}/file.md").`,
    };
  }

  // Resolve the path within the mount
  const absolutePath = path.resolve(mount.absolutePath, restPath);

  // Security check: ensure path is within mount
  if (
    !absolutePath.startsWith(mount.absolutePath + path.sep) &&
    absolutePath !== mount.absolutePath
  ) {
    return { ok: false, error: 'Path is outside allowed directory' };
  }

  return {
    ok: true,
    resolved: {
      mount,
      absolutePath,
      relativePath: restPath,
      virtualPath: restPath === '.' ? mount.name : `${mount.name}/${restPath}`,
    },
  };
}

/**
 * Convert an absolute path back to a virtual path.
 */
export function toVirtualPath(absolutePath: string): string | null {
  for (const mount of config.MOUNTS) {
    if (absolutePath === mount.absolutePath) {
      return mount.name;
    }
    if (absolutePath.startsWith(mount.absolutePath + path.sep)) {
      const relative = absolutePath.slice(mount.absolutePath.length + 1);
      return `${mount.name}/${relative}`;
    }
  }
  return null;
}

/**
 * Get all configured mounts.
 */
export function getMounts(): Mount[] {
  return config.MOUNTS;
}

/**
 * Check if we're in single-mount mode (backward compatible).
 */
export function isSingleMount(): boolean {
  return config.MOUNTS.length === 1;
}

/**
 * Security check: Verify a path doesn't escape mount via symlinks.
 * Returns the real path if safe, or an error if symlink points outside mount.
 */
export async function validateSymlinks(
  absPath: string,
  mount: Mount,
): Promise<{ ok: true; realPath: string } | { ok: false; error: string }> {
  try {
    const stat = await fs.lstat(absPath);

    if (stat.isSymbolicLink()) {
      // Resolve the symlink target
      const target = await fs.readlink(absPath);
      const resolvedTarget = path.resolve(path.dirname(absPath), target);

      // Check if resolved target is within mount
      if (
        !resolvedTarget.startsWith(mount.absolutePath + path.sep) &&
        resolvedTarget !== mount.absolutePath
      ) {
        return {
          ok: false,
          error: `Symlink "${absPath}" points outside mount to "${resolvedTarget}"`,
        };
      }

      // Recursively check the target (symlinks can chain)
      return validateSymlinks(resolvedTarget, mount);
    }

    // Not a symlink, return the path as-is
    return { ok: true, realPath: absPath };
  } catch (err) {
    // Path doesn't exist yet (for create operations) - that's fine
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      return { ok: true, realPath: absPath };
    }
    return { ok: false, error: `Failed to validate path: ${error.message}` };
  }
}

/**
 * Validate an entire path chain for symlink escapes.
 * Checks each directory component from mount root to target.
 */
export async function validatePathChain(
  absPath: string,
  mount: Mount,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const relativePath = absPath.slice(mount.absolutePath.length + 1);
  if (!relativePath) {
    return { ok: true }; // Mount root itself
  }

  const segments = relativePath.split(path.sep);
  let currentPath = mount.absolutePath;

  for (const segment of segments) {
    currentPath = path.join(currentPath, segment);

    const validation = await validateSymlinks(currentPath, mount);
    if (!validation.ok) {
      return validation;
    }
  }

  return { ok: true };
}
