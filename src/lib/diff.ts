/**
 * Unified diff generation for change preview.
 *
 * Produces diffs in unified format (like `git diff`) for human-readable
 * change visualization before applying modifications.
 */

import { createTwoFilesPatch } from 'diff';

// ─────────────────────────────────────────────────────────────
// Diff Generation
// ─────────────────────────────────────────────────────────────

/**
 * Generate a unified diff between two strings.
 *
 * Produces standard unified diff format with 3 lines of context:
 * - Lines starting with `-` are removed
 * - Lines starting with `+` are added
 * - Lines starting with ` ` are unchanged context
 *
 * @param oldContent - Original content
 * @param newContent - Modified content
 * @param filename - Filename for diff header (default: "file")
 * @returns Unified diff string, or "(no changes)" if identical
 *
 * @example
 * generateDiff("hello\nworld", "hello\nuniverse", "greeting.txt")
 * // --- a/greeting.txt
 * // +++ b/greeting.txt
 * // @@ -1,2 +1,2 @@
 * //  hello
 * // -world
 * // +universe
 */
export function generateDiff(oldContent: string, newContent: string, filename = 'file'): string {
  if (oldContent === newContent) {
    return '(no changes)';
  }

  const patch = createTwoFilesPatch(
    `a/${filename}`,
    `b/${filename}`,
    oldContent,
    newContent,
    '',
    '',
    { context: 3 },
  );

  return patch.trim();
}

// ─────────────────────────────────────────────────────────────
// Diff Analysis
// ─────────────────────────────────────────────────────────────

/**
 * Count lines added and removed in a diff.
 *
 * @param diff - Unified diff string
 * @returns Count of added and removed lines
 *
 * @example
 * const diff = generateDiff("a\nb", "a\nc\nd");
 * countDiffLines(diff)
 * // { added: 2, removed: 1 }
 */
export function countDiffLines(diff: string): { added: number; removed: number } {
  const lines = diff.split('\n');
  let added = 0;
  let removed = 0;

  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) added++;
    if (line.startsWith('-') && !line.startsWith('---')) removed++;
  }

  return { added, removed };
}
