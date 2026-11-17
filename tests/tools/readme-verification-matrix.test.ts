import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_TOOLS } from '../../src/tools/index.js';

/**
 * The README states which tools were verified against the real API and which only have unit tests.
 * That matrix is a promise to users: every tool must be in it exactly once, with a known status, and
 * the counts quoted in the prose must be the ones the table adds up to.
 */

const root = resolve(import.meta.dirname, '../..');
const readme = readFileSync(resolve(root, 'README.md'), 'utf8');

const HEADING = '## What is verified and what is not';
const start = readme.indexOf(HEADING);
const end = readme.indexOf('\n## ', start + HEADING.length);
const section = readme.slice(start, end === -1 ? undefined : end);

interface Row {
  group: string;
  status: string;
  evidence: string;
  notVerified: string;
  tools: string[];
}

/** Rows of the matrix: the tools of a row are the ones named in its FIRST cell. */
const rows: Row[] = section
  .split('\n')
  .filter((l) => l.startsWith('|'))
  .map((l) =>
    l
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim()),
  )
  .filter((c) => c.length === 4 && c[0] !== 'Group (tools)' && !/^-+$/.test(c[0] ?? ''))
  .map(([group = '', status = '', evidence = '', notVerified = '']) => ({
    group,
    status,
    evidence,
    notVerified,
    tools: group.match(/`vidsigner_[a-z0-9_]+`/g)?.map((t) => t.slice(1, -1)) ?? [],
  }));

const VERIFIED = /^Verified live/;
const UNIT = /^Unit tests only$/;

describe('README matrix "What is verified and what is not"', () => {
  it('exists, near the top, before the quick start', () => {
    expect(start).toBeGreaterThan(-1);
    expect(start).toBeLessThan(readme.indexOf('## Quick start'));
    expect(rows.length).toBeGreaterThanOrEqual(10);
  });

  it('every row has a known status, evidence and a reason for what is not verified', () => {
    for (const r of rows) {
      expect(VERIFIED.test(r.status) || UNIT.test(r.status), `${r.group}: ${r.status}`).toBe(true);
      expect(r.evidence.length, `${r.group}: evidence`).toBeGreaterThan(10);
      expect(r.notVerified.length, `${r.group}: not verified`).toBeGreaterThan(10);
    }
  });

  it('lists every one of the tools exactly once, and no tool that does not exist', () => {
    const listed = rows.flatMap((r) => r.tools);
    const names = ALL_TOOLS.map((t) => t.name);
    expect(
      names.filter((n) => !listed.includes(n)),
      'tools missing from the matrix',
    ).toEqual([]);
    expect(
      listed.filter((n) => !names.includes(n)),
      'names in the matrix that are not tools',
    ).toEqual([]);
    const duplicated = listed.filter((n, i) => listed.indexOf(n) !== i);
    expect(duplicated, 'tools listed in more than one group').toEqual([]);
    expect(listed).toHaveLength(names.length);
  });

  it('the verified and unit-only counts quoted in the README are the ones the table adds up to', () => {
    const verified = rows.filter((r) => VERIFIED.test(r.status)).flatMap((r) => r.tools).length;
    const unit = rows.filter((r) => UNIT.test(r.status)).flatMap((r) => r.tools).length;
    expect(verified + unit).toBe(ALL_TOOLS.length);
    expect(readme).toContain(`**${verified} of ${ALL_TOOLS.length} tools**`);
    expect(readme).toContain(`${unit} of ${ALL_TOOLS.length} tools.**`);
    expect(readme).toContain(`${verified} of its ${ALL_TOOLS.length} tools verified live`);
    expect(readme).toContain(`Only ${verified} of the ${ALL_TOOLS.length} tools`);
    expect(readme).toContain(`the other ${unit} are implemented from the vendor manual`);
  });

  it('does not use the wording that overstated the verification', () => {
    expect(readme).not.toMatch(/\*\*Complete\.\*\*/);
    expect(readme).not.toMatch(/\*\*Tested\.\*\*/);
    expect(readme).not.toMatch(/Built against prompt injection/i);
  });

  it('the tool that cannot work with this MCP credentials is flagged in the matrix', () => {
    const row = rows.find((r) => r.tools.includes('vidsigner_get_vidmobile_signature_request'));
    expect(row?.notVerified).toMatch(/cannot work with the credentials of this MCP/);
  });
});

describe('README does not leak identifiers of the test environment', () => {
  it('has no real tenant, customer or credential names', () => {
    // Built from fragments so that this file does not contain the names it forbids.
    const forbidden = [
      ['serli', 'mar'],
      ['hi', 'gea'],
      ['vid_', '[0-9a-f]{8}'],
    ].map((p) => p.join(''));
    expect(readme).not.toMatch(new RegExp(forbidden.join('|'), 'i'));
  });
});
