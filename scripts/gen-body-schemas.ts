/**
 * Generates the zod schemas of the request bodies (src/tools/generated/body-schemas.ts), the client
 * types with the manual-only fields (src/client/generated/manual-extras.ts) and the versioned API
 * surface (data/openapi-surface.json).
 *
 * Usage:
 *   VIDSIGNER_SPEC_DIR=/path/to/vendor-docs npm run gen:schemas
 *   npm run gen:schemas -- --spec-dir /path/to/vendor-docs
 *   npm run gen:schemas -- --from-surface   # regenerate from the versioned surface, no vendor docs
 *
 * The first two forms re-extract the surface from the vendor OpenAPI document, which is available
 * to Validated ID customers and is not redistributed with this repository. `--from-surface` only
 * needs the versioned files: use it after editing data/field-docs.json, data/manual-extras.json or
 * src/tools/aliases.ts.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { generate } from './lib/body-schemas.js';
import { requireOpenApi, runScript } from './lib/spec-dir.mjs';
import { ROOT, SURFACE_PATH, extractSurface, loadSurface, renderSurface } from './lib/surface.js';

await runScript(async () => {
  const fromSurface = process.argv.includes('--from-surface');
  const files: Record<string, string> = {};
  let surface;
  if (fromSurface) {
    surface = loadSurface();
  } else {
    surface = extractSurface(readFileSync(requireOpenApi(), 'utf8'));
    files[SURFACE_PATH] = await renderSurface(surface);
  }
  Object.assign(files, (await generate(surface)).files);
  for (const [rel, content] of Object.entries(files)) {
    const path = resolve(ROOT, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    console.log(`generated ${rel}`);
  }
});
