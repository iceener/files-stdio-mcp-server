/**
 * Library exports for filesystem utilities.
 */

export { generateChecksum, verifyChecksum } from './checksum.js';
export { countDiffLines, generateDiff } from './diff.js';
export {
  getExtensionsForType,
  isTextFile,
  matchesGlob,
  matchesType,
  shouldExclude,
} from './filetypes.js';
export {
  createIgnoreMatcher,
  createIgnoreMatcherForDir,
  type IgnoreMatcher,
  loadIgnorePatterns,
} from './ignore.js';
export {
  addLineNumbers,
  deleteLines,
  extractLines,
  getContextLines,
  insertAfterLine,
  insertBeforeLine,
  parseLineRange,
  replaceLines,
} from './lines.js';
export {
  getMounts,
  isSingleMount,
  type PathResolutionResult,
  type ResolvedPath,
  resolvePath,
  toVirtualPath,
} from './paths.js';
export {
  buildPattern,
  buildPresetPattern,
  findMatches,
  findPresetMatches,
  findUniqueMatch,
  getLineBounds,
  getLineNumber,
  isPresetPattern,
  type MatchResult,
  type PatternMode,
  PRESET_PATTERNS,
  type PresetPattern,
  replaceAllMatches,
} from './patterns.js';
