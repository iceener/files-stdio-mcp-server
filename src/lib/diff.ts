/**
 * Unified diff generation for change preview.
 *
 * Produces diffs in unified format (like `git diff`) for human-readable
 * change visualization before applying modifications.
 */

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
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  const hunks: string[] = [];
  let i = 0;
  let j = 0;

  while (i < oldLines.length || j < newLines.length) {
    // Find next difference
    while (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      i++;
      j++;
    }

    if (i >= oldLines.length && j >= newLines.length) break;

    // Found a difference, collect the hunk
    const hunkStartOld = Math.max(0, i - 3);
    const hunkStartNew = Math.max(0, j - 3);

    const hunkLines: string[] = [];

    // Add context before
    for (let k = hunkStartOld; k < i; k++) {
      hunkLines.push(` ${oldLines[k]}`);
    }

    // Find extent of changes
    let oldEnd = i;
    let newEnd = j;
    let contextAfter = 0;

    while (oldEnd < oldLines.length || newEnd < newLines.length) {
      if (
        oldEnd < oldLines.length &&
        newEnd < newLines.length &&
        oldLines[oldEnd] === newLines[newEnd]
      ) {
        contextAfter++;
        if (contextAfter >= 3) break;
        oldEnd++;
        newEnd++;
      } else {
        contextAfter = 0;
        if (
          oldEnd < oldLines.length &&
          (newEnd >= newLines.length || oldLines[oldEnd] !== newLines[newEnd])
        ) {
          oldEnd++;
        }
        if (
          newEnd < newLines.length &&
          (oldEnd >= oldLines.length || oldLines[oldEnd - 1] !== newLines[newEnd])
        ) {
          newEnd++;
        }
      }
    }

    // Add removed lines
    for (let k = i; k < oldEnd - contextAfter; k++) {
      hunkLines.push(`-${oldLines[k]}`);
    }

    // Add added lines
    for (let k = j; k < newEnd - contextAfter; k++) {
      hunkLines.push(`+${newLines[k]}`);
    }

    // Add context after
    for (let k = 0; k < contextAfter && oldEnd - contextAfter + k < oldLines.length; k++) {
      hunkLines.push(` ${oldLines[oldEnd - contextAfter + k]}`);
    }

    if (hunkLines.length > 0) {
      const header = `@@ -${hunkStartOld + 1},${oldEnd - hunkStartOld} +${hunkStartNew + 1},${newEnd - hunkStartNew} @@`;
      hunks.push(`${header}\n${hunkLines.join('\n')}`);
    }

    i = oldEnd;
    j = newEnd;
  }

  if (hunks.length === 0) {
    return '(no changes)';
  }

  return `--- a/${filename}\n+++ b/${filename}\n${hunks.join('\n')}`;
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
