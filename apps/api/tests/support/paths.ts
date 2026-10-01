/**
 * Absolute paths for tests that read source files (contract tests that check a
 * pattern exists or is absent in the code).
 */
import { fileURLToPath } from 'node:url';

/** apps/api/src/ */
export const apiSrc = fileURLToPath(new URL('../../src/', import.meta.url));
/** Repository root. */
export const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
