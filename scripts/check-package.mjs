#!/usr/bin/env node
/**
 * Release sanity checks, run in CI before publishing (`npm run check:package`):
 *
 * 1. `npm pack --dry-run` lists only what may ship: `dist/`, README.md, LICENSE, CHANGELOG.md and
 *    package.json. In particular no sources, tests, docs, `data/` or vendor documentation.
 * 2. No file of the package is, or looks like, Validated ID documentation.
 * 3. server.json (MCP Registry) agrees with package.json: name, version, package identifier and a
 *    description within the registry limit of 100 characters.
 *
 * Requires a built `dist/` (run `npm run build` first).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const problems = [];

if (!existsSync(resolve(ROOT, 'dist/index.js'))) {
  console.error('dist/index.js not found: run `npm run build` first.');
  process.exit(1);
}

// 1 + 2: package contents.
const pack = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
  cwd: ROOT,
  encoding: 'utf8',
});
if (pack.status !== 0) {
  console.error(pack.stderr || pack.stdout);
  process.exit(pack.status ?? 1);
}
const files = JSON.parse(pack.stdout)[0].files.map((f) => f.path);
const ALLOWED = [/^dist\//, /^README\.md$/, /^LICENSE$/, /^CHANGELOG\.md$/, /^package\.json$/];
const FORBIDDEN = [
  /VIDsigner(API|OpenAPI)/i,
  /\.txt$/,
  /\.pdf$/i,
  /^spec\//,
  /^tests?\//,
  /^data\//,
];
for (const f of files) {
  if (!ALLOWED.some((re) => re.test(f))) problems.push(`unexpected file in the package: ${f}`);
  if (FORBIDDEN.some((re) => re.test(f))) problems.push(`forbidden file in the package: ${f}`);
}
for (const required of ['README.md', 'LICENSE', 'CHANGELOG.md', 'dist/index.js']) {
  if (!files.includes(required)) problems.push(`missing from the package: ${required}`);
}

// 3: server.json vs package.json.
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
const server = JSON.parse(readFileSync(resolve(ROOT, 'server.json'), 'utf8'));
const entry = server.packages?.[0];
if (server.name !== pkg.mcpName)
  problems.push(`server.json name ${server.name} != mcpName ${pkg.mcpName}`);
if (server.version !== pkg.version)
  problems.push(`server.json version ${server.version} != ${pkg.version}`);
if (entry?.identifier !== pkg.name)
  problems.push(`server.json package ${entry?.identifier} != ${pkg.name}`);
if (entry?.version !== pkg.version)
  problems.push(`server.json package version ${entry?.version} != ${pkg.version}`);
if (!server.description || server.description.length > 100) {
  problems.push(
    `server.json description must be 1-100 characters (is ${server.description?.length})`,
  );
}

if (problems.length > 0) {
  console.error(`Package checks failed:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`Package checks passed (${files.length} files in the tarball).`);
