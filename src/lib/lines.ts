/**
 * Line-based content manipulation utilities.
 *
 * All functions treat lines as 1-indexed (first line is line 1).
 * Content is split on '\n' — handles both Unix and Windows line endings.
 */

// ─────────────────────────────────────────────────────────────
// Parsing
// ─────────────────────────────────────────────────────────────

/**
 * Parse a line range string into start/end numbers.
 *
 * @param range - Line specification: "10" (single) or "10-15" (range)
 * @returns Parsed range or null if invalid
 *
 * @example
 * parseLineRange("10")      // { start: 10, end: 10 }
 * parseLineRange("10-15")   // { start: 10, end: 15 }
 * parseLineRange("15-10")   // null (invalid: start > end)
 * parseLineRange("abc")     // null (invalid format)
 */
export function parseLineRange(range: string): { start: number; end: number } | null {
  const trimmed = range.trim();

  // Single line: "10"
  if (/^\d+$/.test(trimmed)) {
    const line = parseInt(trimmed, 10);
    return { start: line, end: line };
  }

  // Range: "10-15"
  const match = trimmed.match(/^(\d+)-(\d+)$/);
  if (match?.[1] && match[2]) {
    const start = parseInt(match[1], 10);
    const end = parseInt(match[2], 10);
    if (start <= end) {
      return { start, end };
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────
// Display
// ─────────────────────────────────────────────────────────────

/**
 * Add line numbers to content for display.
 *
 * @param content - Text content to number
 * @param startLine - Starting line number (default: 1)
 * @returns Content with line numbers: "  1|line one\n  2|line two"
 *
 * @example
 * addLineNumbers("foo\nbar")
 * // "1|foo\n2|bar"
 *
 * addLineNumbers("foo\nbar", 10)
 * // "10|foo\n11|bar"
 */
export function addLineNumbers(content: string, startLine = 1): string {
  const lines = content.split('\n');
  const maxLineNum = startLine + lines.length - 1;
  const width = String(maxLineNum).length;

  return lines
    .map((line, i) => {
      const lineNum = String(startLine + i).padStart(width, ' ');
      return `${lineNum}|${line}`;
    })
    .join('\n');
}

// ─────────────────────────────────────────────────────────────
// Extraction
// ─────────────────────────────────────────────────────────────

/**
 * Extract a range of lines from content.
 *
 * @param content - Full text content
 * @param start - Start line (1-indexed, clamped to bounds)
 * @param end - End line (1-indexed, inclusive, clamped to bounds)
 * @returns Extracted text and actual line range used
 *
 * @example
 * const file = "a\nb\nc\nd\ne";
 * extractLines(file, 2, 4)
 * // { text: "b\nc\nd", actualStart: 2, actualEnd: 4 }
 *
 * extractLines(file, 4, 100)
 * // { text: "d\ne", actualStart: 4, actualEnd: 5 }
 */
export function extractLines(
  content: string,
  start: number,
  end: number,
): { text: string; actualStart: number; actualEnd: number } {
  const lines = content.split('\n');
  const actualStart = Math.max(1, start);
  const actualEnd = Math.min(lines.length, end);

  const extracted = lines.slice(actualStart - 1, actualEnd).join('\n');

  return {
    text: extracted,
    actualStart,
    actualEnd,
  };
}

/**
 * Get context lines around a target line.
 *
 * @param content - Full text content
 * @param line - Target line number (1-indexed)
 * @param contextBefore - Lines to include before target
 * @param contextAfter - Lines to include after target
 * @returns Lines before and after (not including target line)
 *
 * @example
 * const file = "a\nb\nc\nd\ne";
 * getContextLines(file, 3, 1, 1)
 * // { before: ["b"], after: ["d"] }
 */
export function getContextLines(
  content: string,
  line: number,
  contextBefore: number,
  contextAfter: number,
): { before: string[]; after: string[] } {
  const lines = content.split('\n');
  const lineIndex = line - 1;

  const beforeStart = Math.max(0, lineIndex - contextBefore);
  const afterEnd = Math.min(lines.length, lineIndex + 1 + contextAfter);

  return {
    before: lines.slice(beforeStart, lineIndex),
    after: lines.slice(lineIndex + 1, afterEnd),
  };
}

// ─────────────────────────────────────────────────────────────
// Modification
// ─────────────────────────────────────────────────────────────

/**
 * Replace a range of lines with new content.
 *
 * @param content - Original content
 * @param start - First line to replace (1-indexed)
 * @param end - Last line to replace (1-indexed, inclusive)
 * @param replacement - New content (can be multi-line)
 * @returns Modified content
 *
 * @example
 * const file = "a\nb\nc\nd";
 * replaceLines(file, 2, 3, "X\nY\nZ")
 * // "a\nX\nY\nZ\nd"
 */
export function replaceLines(
  content: string,
  start: number,
  end: number,
  replacement: string,
): string {
  const lines = content.split('\n');
  const before = lines.slice(0, start - 1);
  const after = lines.slice(end);

  return [...before, replacement, ...after].join('\n');
}

/**
 * Insert content before a specific line.
 *
 * @param content - Original content
 * @param line - Line to insert before (1-indexed)
 * @param insertion - Content to insert
 * @returns Modified content
 *
 * @example
 * const file = "a\nb\nc";
 * insertBeforeLine(file, 2, "X")
 * // "a\nX\nb\nc"
 */
export function insertBeforeLine(content: string, line: number, insertion: string): string {
  const lines = content.split('\n');
  const insertIndex = Math.max(0, line - 1);
  lines.splice(insertIndex, 0, insertion);
  return lines.join('\n');
}

/**
 * Insert content after a specific line.
 *
 * @param content - Original content
 * @param line - Line to insert after (1-indexed)
 * @param insertion - Content to insert
 * @returns Modified content
 *
 * @example
 * const file = "a\nb\nc";
 * insertAfterLine(file, 2, "X")
 * // "a\nb\nX\nc"
 */
export function insertAfterLine(content: string, line: number, insertion: string): string {
  const lines = content.split('\n');
  const insertIndex = Math.min(lines.length, line);
  lines.splice(insertIndex, 0, insertion);
  return lines.join('\n');
}

/**
 * Delete a range of lines from content.
 *
 * @param content - Original content
 * @param start - First line to delete (1-indexed)
 * @param end - Last line to delete (1-indexed, inclusive)
 * @returns Modified content
 *
 * @example
 * const file = "a\nb\nc\nd";
 * deleteLines(file, 2, 3)
 * // "a\nd"
 */
export function deleteLines(content: string, start: number, end: number): string {
  const lines = content.split('\n');
  const before = lines.slice(0, start - 1);
  const after = lines.slice(end);
  return [...before, ...after].join('\n');
}
