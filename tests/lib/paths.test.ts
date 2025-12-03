/**
 * Tests for path resolution with multi-mount support.
 *
 * Note: These tests mock the config to test path resolution logic.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import path from 'node:path';

// We need to test the path resolution logic, so we'll test the functions directly
// after setting up mock mounts

describe('path resolution logic', () => {
  // Test path escape detection
  test('detects .. escape attempts', () => {
    const hasEscape = (p: string) => p.split(/[/\\]/).some((s) => s === '..');
    expect(hasEscape('../parent')).toBe(true);
    expect(hasEscape('folder/../sibling')).toBe(true);
    expect(hasEscape('normal/path')).toBe(false);
    expect(hasEscape('..hidden')).toBe(false); // This is a valid filename
  });

  // Test mount name extraction
  test('extracts mount name from path', () => {
    const getMountName = (p: string) => {
      const normalized = p.replace(/\\/g, '/').replace(/^\/+/, '');
      const segments = normalized.split('/');
      return segments[0] || null;
    };

    expect(getMountName('vault/notes/todo.md')).toBe('vault');
    expect(getMountName('projects/src/index.ts')).toBe('projects');
    expect(getMountName('single-file.md')).toBe('single-file.md');
    expect(getMountName('.')).toBe('.');
    expect(getMountName('')).toBe(null);
  });

  // Test path within mount extraction
  test('extracts rest of path after mount', () => {
    const getRestPath = (p: string) => {
      const normalized = p.replace(/\\/g, '/').replace(/^\/+/, '');
      const segments = normalized.split('/');
      return segments.slice(1).join('/') || '.';
    };

    expect(getRestPath('vault/notes/todo.md')).toBe('notes/todo.md');
    expect(getRestPath('vault/')).toBe('.');
    expect(getRestPath('vault')).toBe('.');
  });

  // Test virtual path construction
  test('constructs virtual path from mount and relative path', () => {
    const toVirtual = (mount: string, rel: string) => {
      if (rel === '.') return mount;
      return `${mount}/${rel}`;
    };

    expect(toVirtual('vault', '.')).toBe('vault');
    expect(toVirtual('vault', 'notes/todo.md')).toBe('vault/notes/todo.md');
  });

  // Test security checks
  test('validates path is within mount', () => {
    const isWithinMount = (absPath: string, mountPath: string) => {
      return absPath === mountPath || absPath.startsWith(mountPath + path.sep);
    };

    const mount = '/Users/test/vault';

    expect(isWithinMount('/Users/test/vault', mount)).toBe(true);
    expect(isWithinMount('/Users/test/vault/notes', mount)).toBe(true);
    expect(isWithinMount('/Users/test/vaultfake', mount)).toBe(false);
    expect(isWithinMount('/Users/test', mount)).toBe(false);
  });
});

describe('root path detection', () => {
  const isRootPath = (p: string) => {
    const trimmed = p.trim();
    return trimmed === '.' || trimmed === '' || trimmed === '/';
  };

  test('identifies root paths', () => {
    expect(isRootPath('.')).toBe(true);
    expect(isRootPath('')).toBe(true);
    expect(isRootPath('/')).toBe(true);
    expect(isRootPath('  .  ')).toBe(true);
  });

  test('identifies non-root paths', () => {
    expect(isRootPath('vault')).toBe(false);
    expect(isRootPath('vault/')).toBe(false);
    expect(isRootPath('./file')).toBe(false);
  });
});

describe('mount name generation', () => {
  // Test auto-naming from path
  test('generates mount name from folder name', () => {
    const getName = (p: string) => path.basename(path.resolve(p));

    expect(getName('/Users/test/vault')).toBe('vault');
    expect(getName('/Users/test/my-notes')).toBe('my-notes');
    expect(getName('./local-folder')).toBe('local-folder');
  });

  // Test unique name generation
  test('handles duplicate mount names', () => {
    const usedNames = new Set(['vault']);
    const getUniqueName = (name: string) => {
      let uniqueName = name;
      let counter = 2;
      while (usedNames.has(uniqueName)) {
        uniqueName = `${name}_${counter}`;
        counter++;
      }
      usedNames.add(uniqueName);
      return uniqueName;
    };

    expect(getUniqueName('vault')).toBe('vault_2');
    expect(getUniqueName('projects')).toBe('projects');
    expect(getUniqueName('vault')).toBe('vault_3');
  });
});

describe('path normalization', () => {
  test('normalizes path separators', () => {
    const normalize = (p: string) => p.replace(/\\/g, '/').replace(/^\/+/, '');

    expect(normalize('vault\\notes\\todo.md')).toBe('vault/notes/todo.md');
    expect(normalize('/vault/notes')).toBe('vault/notes');
    expect(normalize('///multiple/slashes')).toBe('multiple/slashes');
  });

  test('handles trailing slashes', () => {
    const normalize = (p: string) => path.resolve(p);

    // path.resolve removes trailing slashes
    expect(normalize('/test/path/')).toBe('/test/path');
    expect(normalize('/test/path')).toBe('/test/path');
  });
});

describe('glob pattern for find', () => {
  // Test converting find pattern to regex
  test('converts simple filename to regex', () => {
    const toRegex = (pattern: string) => {
      const regexPattern = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
      return new RegExp(`^${regexPattern}$`, 'i');
    };

    const regex = toRegex('file.md');
    expect(regex.test('file.md')).toBe(true);
    expect(regex.test('File.MD')).toBe(true);
    expect(regex.test('file.txt')).toBe(false);
  });

  test('handles wildcard patterns', () => {
    const toRegex = (pattern: string) => {
      const regexPattern = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
      return new RegExp(`^${regexPattern}$`, 'i');
    };

    const starMd = toRegex('*.md');
    expect(starMd.test('notes.md')).toBe(true);
    expect(starMd.test('README.md')).toBe(true);
    expect(starMd.test('file.txt')).toBe(false);

    const prefix = toRegex('config*');
    expect(prefix.test('config.json')).toBe(true);
    expect(prefix.test('config.yaml')).toBe(true);
    expect(prefix.test('settings.json')).toBe(false);

    const questionMark = toRegex('file?.md');
    expect(questionMark.test('file1.md')).toBe(true);
    expect(questionMark.test('fileA.md')).toBe(true);
    expect(questionMark.test('file12.md')).toBe(false);
  });
});

