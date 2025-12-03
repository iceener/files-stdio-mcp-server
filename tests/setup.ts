/**
 * Test setup - must be imported before any other modules.
 * Sets up environment variables for testing.
 */

import path from 'node:path';

// Set FS_ROOT before any other imports
const FIXTURES_PATH = path.resolve(import.meta.dir, 'fixtures');
process.env['FS_ROOT'] = FIXTURES_PATH;

export { FIXTURES_PATH };

