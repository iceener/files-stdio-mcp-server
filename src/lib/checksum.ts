/**
 * Checksum utilities for file integrity verification.
 *
 * Checksums are used to detect stale reads — if a file changes between
 * reading and writing, the checksum won't match and the write is rejected.
 */

import { createHash } from 'node:crypto';

/**
 * Generate a short checksum for content verification.
 *
 * Uses first 12 characters of SHA256 hash for brevity while maintaining
 * collision resistance for typical file sizes.
 *
 * @param content - Text content to hash
 * @returns 12-character hex checksum
 *
 * @example
 * generateChecksum("Hello, World!")
 * // "dffd6021bb2b"
 */
export function generateChecksum(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 12);
}

/**
 * Verify that content matches an expected checksum.
 *
 * @param content - Current content to verify
 * @param expected - Expected checksum from previous read
 * @returns true if checksums match
 *
 * @example
 * const checksum = generateChecksum("Hello");
 * verifyChecksum("Hello", checksum)   // true
 * verifyChecksum("World", checksum)   // false
 */
export function verifyChecksum(content: string, expected: string): boolean {
  return generateChecksum(content) === expected;
}
