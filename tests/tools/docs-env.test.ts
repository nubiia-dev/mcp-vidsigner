import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENV_VAR_NAMES } from '../../src/config.js';

const root = resolve(import.meta.dirname, '../..');
const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
const envExample = readFileSync(resolve(root, '.env.example'), 'utf8');

describe('environment variable documentation', () => {
  it('reads 28 variables', () => {
    expect(ENV_VAR_NAMES).toHaveLength(28);
  });

  it.each(ENV_VAR_NAMES)('%s is in the README table and in .env.example', (name) => {
    expect(readme, `README is missing ${name}`).toMatch(new RegExp(`^\\| \`${name}\``, 'm'));
    expect(envExample, `.env.example is missing ${name}`).toContain(name);
  });

  it('documents every VIDSIGNER_* variable that the README mentions', () => {
    const mentioned = new Set(readme.match(/\bVIDSIGNER_[A-Z0-9_]+\b/g) ?? []);
    // Variables that are not read by the server: the test switches of the repository.
    const NOT_SERVER = new Set([
      'VIDSIGNER_IT',
      'VIDSIGNER_IT_ENV_FILE',
      'VIDSIGNER_SPEC_DIR',
      'VIDSIGNER_MATRIX_OUT',
    ]);
    const known = new Set<string>(ENV_VAR_NAMES);
    const unknown = [...mentioned].filter((v) => !known.has(v) && !NOT_SERVER.has(v));
    expect(unknown, 'the README mentions variables the server does not read').toEqual([]);
  });

  it('the README documents the credential-read flag', () => {
    expect(readme).toMatch(/VIDSIGNER_ALLOW_CREDENTIAL_READS/);
  });

  it('the README has the trademark notice, the example flows and the limitations section', () => {
    for (const expected of [
      /Unofficial, community-maintained MCP server for the VIDsigner API\./,
      /Not affiliated with, endorsed or sponsored by Validated ID\./,
      /VIDsigner is a trademark of Validated ID, S\.L\./,
      /Check the status of a document/,
      /Create a document with your own signing link/,
      /Download the signed document and the evidence report/,
      /Walk through the pending documents with pagination/,
      /## Known limitations and open questions/,
      /Spellings to verify with a ClientID/,
      /does not redistribute the documentation of Validated ID/i,
    ]) {
      expect(readme).toMatch(expected);
    }
  });
});
