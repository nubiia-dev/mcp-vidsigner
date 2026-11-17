/**
 * Regression tests for the findings of the final review before the first release: secret hiding,
 * statistics dates, the VIDmobile password policy and the description of a tool that cannot work
 * with the credentials of this MCP.
 */
import { describe, expect, it } from 'vitest';
import { ALL_TOOLS } from '../../src/tools/index.js';
import { assertDateRange, toApiDate } from '../../src/tools/mgmt/statistics.js';
import { newUserPassword } from '../../src/tools/mgmt/vidmobileusers.js';
import { hideSecrets } from '../../src/tools/util.js';
import { startHarness } from '../helpers/mcp.js';
import { json, mockFetch, token } from '../helpers/mock-fetch.js';

const MGMT_ENV = {
  VIDSIGNER_ENABLE_MGMT: 'true',
  VIDSIGNER_CLIENT_ID: 'cid',
  VIDSIGNER_CLIENT_SECRET: 'csecret-xyz',
};

describe('hideSecrets', () => {
  it.each([
    'password',
    'SubscriptionPass',
    'token',
    'pin',
    'access_token',
    'clientSecret',
    'partnerPass',
    'secret',
    'Authorization',
  ])('hides %s, also nested', (key) => {
    const out = hideSecrets({ a: 1, nested: [{ [key]: 'TOP-SECRET-VALUE' }], [key]: 'TOP-SECRET' });
    const text = JSON.stringify(out);
    expect(text).not.toContain('TOP-SECRET');
    expect(text).toContain('[hidden]');
  });

  it('keeps ordinary fields and empty secrets as they are', () => {
    expect(hideSecrets({ name: 'x', secret: '', n: 0 })).toEqual({ name: 'x', secret: '', n: 0 });
  });
});

describe('statistics dates', () => {
  const run = async (From: string, To: string) => {
    const m = mockFetch((c) =>
      c.url.endsWith('/oauth/token') ? token('T') : json(200, [{ Type: 'vidremote' }]),
    );
    const h = await startHarness({ env: MGMT_ENV, fetch: m.fetch });
    const r = await h.client
      .callTool({
        name: 'vidsigner_mgmt_search_statistics',
        arguments: { subscriptionGuid: 'g1', From, To },
      })
      .catch((e: unknown) => ({ isError: true, text: String(e) }));
    return { r, calls: m.calls.filter((c) => !c.url.endsWith('/oauth/token')) };
  };

  it('rejects mixed separators before calling the API', async () => {
    for (const bad of ['2026/11-01', '2026-11/01', '01-11-2026', '01/11-2026']) {
      const { r, calls } = await run(bad, '30/11/2026');
      expect(r.isError, bad).toBe(true);
      expect(calls, bad).toHaveLength(0);
    }
  });

  it('rejects a range whose start is after its end, in any of the formats', async () => {
    for (const [from, to] of [
      ['02/12/2026', '01/12/2026'],
      ['2026/12/02', '2026-12-01'],
      ['31/12/2026', '01/01/2026'],
    ] as const) {
      const { r, calls } = await run(from, to);
      expect(r.isError, `${from} ${to}`).toBe(true);
      expect(JSON.stringify(r), `${from} ${to}`).toMatch(/must not be after/);
      expect(calls, `${from} ${to}`).toHaveLength(0);
    }
  });

  it('accepts equal dates and a normal range and sends dd/MM/yyyy', async () => {
    for (const [from, to] of [
      ['01/11/2026', '01/11/2026'],
      ['2026-11-01', '2026/11/30'],
    ] as const) {
      const { r, calls } = await run(from, to);
      expect(Boolean(r.isError), `${from} ${to}`).toBe(false);
      expect(calls).toHaveLength(1);
      const sent = JSON.parse(calls[0]?.body ?? '{}') as { From: string; To: string };
      expect(sent.From).toBe(toApiDate(from, 'From'));
      expect(sent.To).toBe(toApiDate(to, 'To'));
    }
  });

  it('assertDateRange compares by year first, not by day', () => {
    expect(() => assertDateRange('31/01/2026', '01/02/2026')).not.toThrow();
    expect(() => assertDateRange('01/01/2027', '31/12/2026')).toThrow(/must not be after/);
  });
});

describe('create_vidmobile_user password policy', () => {
  it.each(['Abcdef1@', 'Change-me#1234', 'Zz9$zzzz'])('accepts %s', (p) => {
    expect(newUserPassword.safeParse(p).success).toBe(true);
  });

  it.each([
    ['too short', 'Ab1@xyz'],
    ['no uppercase', 'abcdef1@'],
    ['no number', 'Abcdefg@'],
    ['no @ # $', 'Abcdef1!'],
    ['only ! - _ .', 'Abcdef1-_.'],
  ])('rejects a password with %s', (_why, p) => {
    expect(newUserPassword.safeParse(p).success).toBe(false);
  });

  it('is enforced by the tool before the API is called', async () => {
    const m = mockFetch((c) => (c.url.endsWith('/oauth/token') ? token('T') : json(200, {})));
    const h = await startHarness({ env: MGMT_ENV, fetch: m.fetch });
    const r = await h.client
      .callTool({
        name: 'vidsigner_mgmt_create_vidmobile_user',
        arguments: {
          userid: 'u1',
          username: 'User',
          legalid: '12345678Z',
          email: 'user@example.org',
          password: 'weakpass',
          skipEnrollEmail: true,
        },
      })
      .catch(() => ({ isError: true }));
    expect(r.isError).toBe(true);
    expect(m.calls.filter((c) => !c.url.endsWith('/oauth/token'))).toHaveLength(0);
  });
});

describe('get_vidmobile_signature_request', () => {
  it('says in its title and description that subscription tokens cannot use it', () => {
    const t = ALL_TOOLS.find((x) => x.name === 'vidsigner_get_vidmobile_signature_request');
    expect(t?.title).toMatch(/not usable with subscription tokens/i);
    expect(t?.description).toMatch(/^NOT USABLE WITH SUBSCRIPTION TOKENS/);
  });
});
