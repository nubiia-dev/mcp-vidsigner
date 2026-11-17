/**
 * Optional vendor documentation for the tests.
 *
 * The VIDsigner OpenAPI document and REST manual belong to Validated ID and are not part of this
 * repository. Customers of Validated ID can point `VIDSIGNER_SPEC_DIR` at a directory holding
 * `VIDsignerOpenAPI_Lastest.json` and `VIDsignerAPI_Rest_Lastest.txt` to enable the extra tests that
 * compare the versioned artifacts (API surface, generated schemas, manual-field fixture) against
 * the vendor documents. Without it those tests are skipped, with a warning; the rest of the suite
 * runs on the versioned artifacts alone.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = process.env['VIDSIGNER_SPEC_DIR'];

function locate(file: string): string | undefined {
  if (!dir) return undefined;
  const path = join(resolve(dir), file);
  return existsSync(path) ? path : undefined;
}

/** Absolute path of the vendor OpenAPI document, when available. */
export const OPENAPI_PATH = locate('VIDsignerOpenAPI_Lastest.json');
/** Absolute path of the vendor REST manual text, when available. */
export const MANUAL_PATH = locate('VIDsignerAPI_Rest_Lastest.txt');

/** Suffix that explains a skipped test. */
export const NEEDS_SPEC = ' [needs VIDSIGNER_SPEC_DIR]';

if (!OPENAPI_PATH || !MANUAL_PATH) {
  const reason = dir
    ? `VIDSIGNER_SPEC_DIR=${dir} does not contain ${!OPENAPI_PATH ? 'VIDsignerOpenAPI_Lastest.json' : 'VIDsignerAPI_Rest_Lastest.txt'}`
    : 'VIDSIGNER_SPEC_DIR is not set';
  console.warn(
    `[spec] ${reason}: the tests that compare against the Validated ID OpenAPI/manual are skipped.`,
  );
}
