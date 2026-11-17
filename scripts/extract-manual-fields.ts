/**
 * Regenerates `tests/fixtures/rest-manual-fields.ts` from the REST manual, the same way
 * `tests/fixtures/mgmt-params.ts` is the reference for the management API.
 *
 * The completeness test (`tests/tools/param-completeness.test.ts`) derives from that fixture which
 * fields ONLY the manual documents (the ones missing from the OpenAPI surface) and requires
 * `data/manual-extras.json` to contain them: the list is not a hand-kept snapshot, it comes from
 * the manual. Another test (skipped without the vendor manual) checks that the fixture matches
 * what this script extracts.
 *
 * Usage:
 *   VIDSIGNER_SPEC_DIR=/path/to/vendor-docs npm run gen:manual-fields
 *   npm run gen:manual-fields -- --spec-dir /path/to/vendor-docs
 *   npm run gen:manual-fields -- --check      # fails if the fixture does not match the manual
 *
 * The manual (`VIDsignerAPI_Rest_Lastest.txt`, text produced by `pdftotext`) belongs to Validated
 * ID, is available to its customers and is not redistributed with this repository.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import prettier from 'prettier';
import { extractManualFields, renderFixture } from './lib/manual-fields.js';
import { requireManual, runScript } from './lib/spec-dir.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(ROOT, 'tests/fixtures/rest-manual-fields.ts');
const check = process.argv.includes('--check');

await runScript(async () => {
  const rendered = await prettier.format(
    renderFixture(extractManualFields(readFileSync(requireManual(), 'utf8'))),
    { ...(await prettier.resolveConfig(OUT)), filepath: OUT },
  );
  if (check) {
    if (readFileSync(OUT, 'utf8') !== rendered) {
      console.error(
        'tests/fixtures/rest-manual-fields.ts does not match the manual: npm run gen:manual-fields',
      );
      process.exit(1);
    }
    console.log('rest-manual-fields.ts is up to date');
  } else {
    writeFileSync(OUT, rendered);
    console.log('generated tests/fixtures/rest-manual-fields.ts');
  }
});
