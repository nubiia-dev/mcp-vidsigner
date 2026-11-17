/**
 * Tool-level regression tests for the defects found in the real E2E run against pre-production
 * (17/11/2026) and fixed afterwards.
 */
import { describe, expect, it } from 'vitest';
import { startHarness } from '../helpers/mcp.js';
import { json, mockFetch, token } from '../helpers/mock-fetch.js';
import { toApiDate } from '../../src/tools/mgmt/statistics.js';
import { ALL_TOOLS } from '../../src/tools/index.js';

const MGMT_ENV = {
  VIDSIGNER_ENABLE_MGMT: 'true',
  VIDSIGNER_ALLOW_DESTRUCTIVE: 'true',
  VIDSIGNER_CLIENT_ID: 'cid',
  VIDSIGNER_CLIENT_SECRET: 'csecret-xyz',
};
const api = (inner: (u: URL, method: string, body?: string) => Response) =>
  mockFetch((c) =>
    c.url.endsWith('/oauth/token') ? token('T') : inner(new URL(c.url), c.method, c.body),
  );
const tool = (name: string) => ALL_TOOLS.find((t) => t.name === name);
const refused = async (
  h: Awaited<ReturnType<typeof startHarness>>,
  name: string,
  args: Record<string, unknown>,
) => (await h.client.callTool({ name, arguments: args }).catch(() => ({ isError: true }))).isError;

describe('BUG-4: Software is deprecated in the management API', () => {
  it('set_vidmobile_user_cert_types accepts a call without Software and does not send it', async () => {
    const m = api(() => json(200, {}));
    const h = await startHarness({ env: MGMT_ENV, fetch: m.fetch });
    const r = await h.call('vidsigner_mgmt_set_vidmobile_user_cert_types', {
      legalId: 'E2E1',
      KeyVault: true,
      FirmaRemota: false,
    });
    expect(r.isError).toBe(false);
    const sent = m.calls.find((c) => c.url.includes('/certstype'));
    expect(JSON.parse(sent?.body ?? '{}')).toEqual({ KeyVault: true, FirmaRemota: false });
  });

  it('set_vidmobile_user_cert_types still lets a caller send Software (the API refuses it with 400)', async () => {
    const m = api(() => json(200, {}));
    const h = await startHarness({ env: MGMT_ENV, fetch: m.fetch });
    const r = await h.call('vidsigner_mgmt_set_vidmobile_user_cert_types', {
      legalId: 'E2E1',
      Software: false,
      KeyVault: true,
      FirmaRemota: false,
    });
    expect(r.isError).toBe(false);
  });

  it('the schema marks Software as optional and deprecated, and certtype offers only KeyVault', async () => {
    const h = await startHarness({ env: MGMT_ENV, fetch: mockFetch(() => json(200, {})).fetch });
    const listed = (await h.client.listTools()).tools;
    const types = listed.find((t) => t.name === 'vidsigner_mgmt_set_vidmobile_user_cert_types');
    const schema = types?.inputSchema as {
      required?: string[];
      properties: Record<string, { description?: string; enum?: string[] }>;
    };
    expect(schema.required).not.toContain('Software');
    expect(schema.required).toEqual(expect.arrayContaining(['KeyVault', 'FirmaRemota']));
    expect(schema.properties['Software']?.description).toMatch(/DEPRECATED/);
    const add = listed.find((t) => t.name === 'vidsigner_mgmt_add_vidmobile_user_certificate');
    const certtype = (
      add?.inputSchema as { properties: Record<string, { description?: string; enum?: string[] }> }
    ).properties['certtype'];
    expect(certtype?.enum).toEqual(['KeyVault']);
    expect(
      await refused(h, 'vidsigner_mgmt_add_vidmobile_user_certificate', {
        legalId: 'E2E1',
        certalias: 'a',
        pin: '1',
        certtype: 'Software',
        contentBase64: 'AAAA',
      }),
    ).toBe(true);
  });
});

describe('statistics: the API only parses dd/MM/yyyy (verified in pre-production)', () => {
  it('converts the manual (yyyy/MM/dd) and ISO forms, and keeps dd/MM/yyyy', () => {
    expect(toApiDate('2026/11/01', 'From')).toBe('01/11/2026');
    expect(toApiDate('2026-11-17', 'To')).toBe('17/11/2026');
    expect(toApiDate('01/11/2026', 'From')).toBe('01/11/2026');
  });

  it('rejects dates that do not exist, before calling the API', () => {
    expect(() => toApiDate('31/02/2026', 'From')).toThrow(/not a real date/);
    expect(() => toApiDate('2026/13/01', 'To')).toThrow(/not a real date/);
  });

  it('the tool sends dd/MM/yyyy whichever of the three forms it receives', async () => {
    const m = api(() => json(200, []));
    const h = await startHarness({ env: MGMT_ENV, fetch: m.fetch });
    for (const [from, to] of [
      ['2026/11/01', '2026/11/17'],
      ['2026-11-01', '2026-11-17'],
      ['01/11/2026', '17/11/2026'],
    ] as const) {
      const r = await h.call('vidsigner_mgmt_search_statistics', {
        subscriptionGuid: 'g',
        From: from,
        To: to,
      });
      expect(r.isError).toBe(false);
      const sent = m.calls.filter((c) => c.url.includes('/stats/search')).at(-1);
      expect(JSON.parse(sent?.body ?? '{}')).toMatchObject({
        From: '01/11/2026',
        To: '17/11/2026',
      });
    }
  });
});

describe('BUG-6: documentation that must state what was verified', () => {
  const desc = (n: string) => tool(n)?.description ?? '';
  const notes = (n: string) => (tool(n)?.notes ?? []).join(' ');

  it('search documents the exact, case-sensitive match', () => {
    expect(notes('vidsigner_search')).toMatch(/EXACT and case-sensitive/);
    expect(desc('vidsigner_search')).toMatch(/exact and case-sensitive/);
    expect(notes('vidsigner_search')).toMatch(/Both additionaldata and elementtype are mandatory/);
  });

  it('create_document documents Appearance.Logo, the NotificationURL slash and what documentinfo hides', () => {
    const n = notes('vidsigner_create_document');
    expect(n).toMatch(/Appearance\.App needs Logo/);
    expect(n).toMatch(/12200/);
    expect(n).toMatch(/12305/);
    expect(n).toMatch(/trailing "\/"/);
    expect(n).toMatch(/does not echo Reminder, OTPChannel, Appearance/);
  });

  it('create_vidmobile_user documents the mandatory image and the special-character password', () => {
    const n = notes('vidsigner_mgmt_create_vidmobile_user');
    expect(n).toMatch(/REQUIRES a handwritten signature image/);
    expect(n).toMatch(/uppercase letter, a number and one of the special characters @ # \$/);
  });

  it('expire_document and get_signature_url describe the observed behaviour', () => {
    expect(notes('vidsigner_expire_document')).toMatch(/does NOT move to an "Expired" status/);
    expect(notes('vidsigner_get_signature_url')).toMatch(/Is no next signature/);
    expect(notes('vidsigner_get_signature_url')).toMatch(/EXPIRED document/);
    expect(notes('vidsigner_get_signature_url')).not.toMatch(/only invalidated by expiring/);
  });

  it('the management tools that are not served in pre say so', () => {
    for (const n of [
      'vidsigner_mgmt_get_vidmobile_user_token',
      'vidsigner_mgmt_get_vidmobile_user_personal_data',
      'vidsigner_mgmt_set_vidmobile_user_state',
    ]) {
      expect(desc(n), n).toMatch(/pre-production/);
      expect(desc(n), n).toMatch(/unconfirmed|NOT AVAILABLE/i);
    }
  });

  it('no tool still names a non-existent set_batch_status tool', () => {
    for (const t of ALL_TOOLS)
      expect(t.description, t.name).not.toMatch(/vidsigner_set_batch_status/);
    expect(notes('vidsigner_close_batch')).toMatch(/no separate "set batch status" tool/);
  });
});
