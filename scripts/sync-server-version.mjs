#!/usr/bin/env node
/**
 * Syncs the version of server.json (MCP Registry), which npm does not touch, with the version
 * semantic-release has just computed. It runs in the `prepare` phase, before
 * @semantic-release/git commits the assets.
 *
 * Usage: node scripts/sync-server-version.mjs <version>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2];

if (!version) {
  console.error('Usage: node scripts/sync-server-version.mjs <version>');
  process.exit(1);
}

// The version appears at the root and in every entry of "packages".
const server = JSON.parse(readFileSync('server.json', 'utf8'));

server.version = version;
if (Array.isArray(server.packages)) {
  for (const pkg of server.packages) {
    pkg.version = version;
  }
}

writeFileSync('server.json', `${JSON.stringify(server, null, 2)}\n`);

console.log(`server.json synced to version ${version}`);
