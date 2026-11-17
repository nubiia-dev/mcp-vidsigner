import { beforeAll, describe, expect, it } from 'vitest';
import { ALL_TOOLS } from '../../src/tools/index.js';
import { strictObject } from '../../src/tools/schema-kit.js';
import { startHarness } from '../helpers/mcp.js';
import { json, mockFetch } from '../helpers/mock-fetch.js';
import { undocumentedProps, type JsonSchema } from '../helpers/schema-walk.js';

/**
 * Tool documentation as the model sees it (`tools/list`): every tool carries a useful description
 * and every parameter, including nested ones, carries its `description`.
 */

interface Listed {
  name: string;
  description?: string;
  inputSchema: JsonSchema;
}

let listed: Listed[] = [];

beforeAll(async () => {
  const h = await startHarness({
    env: {
      VIDSIGNER_ENV: 'pro',
      VIDSIGNER_ALLOW_WRITE: 'true',
      VIDSIGNER_ALLOW_DESTRUCTIVE: 'true',
      VIDSIGNER_ALLOW_MARK_DOWNLOADED: 'true',
      VIDSIGNER_ALLOW_SIGNING_LINKS: 'true',
      VIDSIGNER_ALLOW_CREDENTIAL_READS: 'true',
      VIDSIGNER_ENABLE_MGMT: 'true',
    },
    fetch: mockFetch(() => json(200, {})).fetch,
  });
  listed = (await h.client.listTools()).tools as unknown as Listed[];
});

/** Characters that only appear in Spanish text (accents, enye, inverted marks, guillemets). */
const NON_ENGLISH = /[\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1\u00bf\u00a1\u00ab\u00bb]/i;

/** Flag required by each risk level; the description the model sees must name it. */
const FLAG_BY_RISK: Record<string, string> = {
  write: 'VIDSIGNER_ALLOW_WRITE',
  destructive: 'VIDSIGNER_ALLOW_DESTRUCTIVE',
  mark_downloaded: 'VIDSIGNER_ALLOW_MARK_DOWNLOADED',
  sensitive_read: 'VIDSIGNER_ALLOW_SIGNING_LINKS',
  credential_read: 'VIDSIGNER_ALLOW_CREDENTIAL_READS',
};

/** Tools that send a real email, SMS or notification: the description must say so. */
const SENDS_MESSAGES = [
  'vidsigner_create_document',
  'vidsigner_close_batch',
  'vidsigner_create_edelivery',
  'vidsigner_send_signature_url',
  'vidsigner_send_edelivery_reminder',
  'vidsigner_mgmt_create_vidmobile_user',
  'vidsigner_mgmt_send_vidmobile_user_password_reminder',
];

describe('documentation of the 81 tools', () => {
  it('the full catalog is visible (81 tools)', () => {
    expect(listed).toHaveLength(81);
    expect(listed.map((t) => t.name).sort()).toEqual(ALL_TOOLS.map((t) => t.name).sort());
  });

  it('every tool has a description for the model: what it does, when to use it and its risk', () => {
    const problems: string[] = [];
    for (const t of listed) {
      const d = t.description?.trim() ?? '';
      if (d.length < 120) problems.push(`${t.name}: description too short (${d.length})`);
      if (!/\bUse when\b/.test(d))
        problems.push(`${t.name}: missing "Use when ..." (when to use it)`);
      if (!/\nRisk: /.test(d)) problems.push(`${t.name}: missing the risk notice`);
    }
    expect(problems).toEqual([]);
  });

  it('the description names the flag that enables every non-read tool', () => {
    const problems: string[] = [];
    for (const def of ALL_TOOLS) {
      const flag = FLAG_BY_RISK[def.risk];
      if (!flag) continue;
      const text = listed.find((t) => t.name === def.name)?.description ?? '';
      if (!text.includes(flag)) problems.push(`${def.name} (${def.risk}) does not name ${flag}`);
      if (def.api === 'mgmt' && !/management API/i.test(text)) {
        problems.push(`${def.name} does not say it belongs to the management API`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('tools that send emails or SMS say so; destructive ones say they are irreversible', () => {
    const problems: string[] = [];
    for (const name of SENDS_MESSAGES) {
      const d = listed.find((t) => t.name === name)?.description ?? '';
      if (!/SENDS?\b.*\b(EMAIL|MESSAGE|SMS)|EMAIL|SMS/i.test(d))
        problems.push(`${name} does not warn that it sends messages`);
    }
    for (const def of ALL_TOOLS.filter((t) => t.risk === 'destructive')) {
      const d = listed.find((t) => t.name === def.name)?.description ?? '';
      if (!/irreversible|DESTRUCTIVE/i.test(d))
        problems.push(`${def.name} does not warn that it is irreversible`);
    }
    expect(problems).toEqual([]);
  });

  it('write tools carry a usage example that validates against their own schema', () => {
    const problems: string[] = [];
    for (const def of ALL_TOOLS.filter((t) => ['write', 'destructive'].includes(t.risk))) {
      const m = /Example: (\{.*\})\s*$/s.exec(def.description);
      if (!m) {
        problems.push(`${def.name}: missing "Example: {...}" at the end of the description`);
        continue;
      }
      let args: unknown;
      try {
        args = JSON.parse(m[1] as string);
      } catch {
        problems.push(`${def.name}: the example is not valid JSON`);
        continue;
      }
      const parsed = strictObject(def.inputSchema).safeParse(args);
      if (!parsed.success) {
        problems.push(
          `${def.name}: the example does not validate (${parsed.error.issues
            .slice(0, 2)
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ')})`,
        );
      }
    }
    expect(problems).toEqual([]);
  });

  it('every tool has a non-empty English docSummary and well-formed notes', () => {
    const problems: string[] = [];
    for (const def of ALL_TOOLS) {
      const summary = def.docSummary?.trim() ?? '';
      if (summary.length < 10) problems.push(`${def.name}: docSummary missing or too short`);
      if (NON_ENGLISH.test(summary)) problems.push(`${def.name}: docSummary is not English`);
      for (const note of def.notes ?? []) {
        if (note.trim().length === 0) problems.push(`${def.name}: empty note`);
        if (NON_ENGLISH.test(note)) problems.push(`${def.name}: note is not English`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('every inputSchema parameter, nested ones included, has a description', () => {
    const problems: string[] = [];
    let total = 0;
    for (const t of listed) {
      const r = undocumentedProps(t.inputSchema);
      total += r.total;
      for (const path of r.missing) problems.push(`${t.name}: ${path}`);
    }
    expect(total).toBeGreaterThan(500);
    expect(problems).toEqual([]);
  });

  it('the walk detects a missing description (negative check)', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        a: { type: 'string', description: 'fine' },
        b: {
          type: 'object',
          description: 'container',
          properties: { c: { type: 'string' }, d: { type: 'string', description: '  ' } },
        },
        e: {
          type: 'array',
          description: 'list',
          items: { properties: { f: { type: 'string' } } },
        },
        g: {
          anyOf: [{ properties: { h: { type: 'number' } } }, { type: 'null' }],
          description: 'value',
        },
      },
    };
    expect(undocumentedProps(schema).missing.sort()).toEqual(['b.c', 'b.d', 'e[].f', 'g.h']);
  });
});

describe('verified rules of the API in the descriptions (pre-production, 17/11/2026)', () => {
  const desc = (name: string) => listed.find((t) => t.name === name)?.description ?? '';
  const notes = (name: string) => (ALL_TOOLS.find((t) => t.name === name)?.notes ?? []).join(' ');

  it('create_document, create_batch and add_document_to_batch state the 12541/12544 rule', () => {
    for (const name of [
      'vidsigner_create_document',
      'vidsigner_create_batch',
      'vidsigner_add_document_to_batch',
    ]) {
      expect(desc(name), name).toMatch(/12541\/12544/);
      expect(notes(name), name).toMatch(/12541/);
      expect(notes(name), name).toMatch(/12544/);
    }
    // The rule was verified for the batch endpoint too (17/11/2026): the description must say so.
    expect(desc('vidsigner_create_batch')).toMatch(
      /verified in pre-production for POST \/documentbatch and POST \/documents/,
    );
    expect(desc('vidsigner_create_batch')).not.toMatch(/not yet for the batch/);
    expect(notes('vidsigner_create_batch')).not.toMatch(/assumed, not verified/);
    expect(notes('vidsigner_add_document_to_batch')).not.toMatch(
      /verified for POST \/documents only/,
    );
  });

  it('batch tools state the same-NotificationURL rule (12205)', () => {
    for (const name of ['vidsigner_create_batch', 'vidsigner_add_document_to_batch']) {
      expect(desc(name), name).toMatch(/12205/);
    }
    expect(notes('vidsigner_add_document_to_batch')).toMatch(/IDENTICAL in every document/);
  });

  it('NotificationEmailMessage documents the rule in the schema of the three tools', () => {
    for (const name of ['vidsigner_create_document', 'vidsigner_create_batch']) {
      const json = JSON.stringify(listed.find((t) => t.name === name)?.inputSchema);
      expect(json, name).toMatch(/must be omitted\/null when SkipSignatureEmail=true/);
      expect(json, name).not.toMatch(/notification email to the signer \(required/);
    }
  });

  it('get_signature_url warns about the evidence, the stable URL, the OTP and its prerequisites', () => {
    const d = desc('vidsigner_get_signature_url');
    expect(d).toMatch(/SIGNATUREURL_RETRIEVED/);
    expect(d).toMatch(/stable per signer/);
    expect(d).toMatch(/OTP/);
    expect(d).toMatch(/16601/);
    expect(d).toMatch(/40111/);
    expect(notes('vidsigner_get_signature_url')).toMatch(/AllowEmptyPhoneNumber/);
  });

  it('no tool claims to be free of side effects: reads are recorded in the document log', () => {
    for (const t of listed) expect(t.description, t.name).not.toMatch(/without side effects/i);
    expect(desc('vidsigner_get_document')).toMatch(/on a SIGNED document, it DOES/);
    expect(desc('vidsigner_get_document_log')).toMatch(/IP of the client/);
    expect(desc('vidsigner_send_signature_url')).toMatch(/SkipSignatureEmail=true/);
  });
});
