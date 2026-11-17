import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startHarness } from '../helpers/mcp.js';
import { apiError, json, mockFetch, token } from '../helpers/mock-fetch.js';

const PDF_B64 = Buffer.from('%PDF-1.4 test content').toString('base64');
const JWT_ENV = { VIDSIGNER_CLIENT_ID: 'cid', VIDSIGNER_CLIENT_SECRET: 'csecret-xyz' };

const api = (inner: (u: URL, method: string, body?: string) => Response) =>
  mockFetch((c) =>
    c.url.endsWith('/oauth/token') ? token('T') : inner(new URL(c.url), c.method, c.body),
  );

describe('MCP: gates verified through the protocol', () => {
  it('pro by default: REST reads only; no writes or management tools exist', async () => {
    const h = await startHarness({
      env: { VIDSIGNER_ENV: 'pro' },
      fetch: mockFetch(() => json(200, [])).fetch,
    });
    const names = await h.toolNames();
    expect(names).toContain('vidsigner_list_documents');
    expect(names).toContain('vidsigner_search');
    expect(names).not.toContain('vidsigner_create_document');
    expect(names).not.toContain('vidsigner_download_signed_document');
    expect(names).not.toContain('vidsigner_delete_document');
    expect(names.some((n) => n.startsWith('vidsigner_mgmt_'))).toBe(false);
    const tools = (await h.client.listTools()).tools;
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
  });

  it('sensitive reads do NOT carry readOnlyHint (they return a credential)', async () => {
    const h = await startHarness({
      env: { VIDSIGNER_ENV: 'pre', VIDSIGNER_ENABLE_MGMT: 'true' },
      fetch: mockFetch(() => json(200, [])).fetch,
    });
    const tools = (await h.client.listTools()).tools;
    for (const [name, notice] of [
      ['vidsigner_get_signature_url', /SENSITIVE READ/],
      ['vidsigner_mgmt_get_vidmobile_user_token', /CREDENTIAL READ/],
      ['vidsigner_mgmt_list_enrollment_codes', /CREDENTIAL READ/],
    ] as const) {
      const t = tools.find((x) => x.name === name);
      expect(t, name).toBeDefined();
      expect(t?.annotations?.readOnlyHint, name).toBe(false);
      expect(t?.description, name).toMatch(notice);
    }
    expect(
      tools.find((x) => x.name === 'vidsigner_list_documents')?.annotations?.readOnlyHint,
    ).toBe(true);
  });

  it('calling an unregistered tool fails', async () => {
    const m = mockFetch(() => json(200, {}));
    const h = await startHarness({ env: { VIDSIGNER_ENV: 'pro' }, fetch: m.fetch });
    const res = await h.client
      .callTool({ name: 'vidsigner_delete_document', arguments: { docGuid: 'x' } })
      .catch((e: unknown) => ({ isError: true, e }));
    expect((res as { isError?: boolean }).isError).toBe(true);
    expect(m.calls).toHaveLength(0);
  });

  it('pro with explicit flags exposes every level and sets the annotations', async () => {
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
      fetch: mockFetch(() => json(200, [])).fetch,
    });
    expect(h.registered).toHaveLength(81);
    const tools = (await h.client.listTools()).tools;
    const del = tools.find((t) => t.name === 'vidsigner_delete_document');
    expect(del?.annotations?.destructiveHint).toBe(true);
    const dl = tools.find((t) => t.name === 'vidsigner_download_signed_document');
    expect(dl?.annotations?.readOnlyHint).toBe(false);
    expect(dl?.description).toMatch(/MARKS THE DOCUMENT AS DOWNLOADED/);
  });

  it('pre by default: no destructive or management tools; reports how to enable them', async () => {
    const h = await startHarness({
      env: { VIDSIGNER_ENV: 'pre' },
      fetch: mockFetch(() => json(200, [])).fetch,
    });
    const names = await h.toolNames();
    expect(names).toContain('vidsigner_create_document');
    expect(names).not.toContain('vidsigner_delete_document');
    expect(h.skipped.find((s) => s.name === 'vidsigner_delete_document')?.enableWith).toBe(
      'VIDSIGNER_ALLOW_DESTRUCTIVE=true',
    );
    expect(h.skipped.find((s) => s.name === 'vidsigner_mgmt_list_partners')?.enableWith).toBe(
      'VIDSIGNER_ENABLE_MGMT=true',
    );
  });
});

describe('MCP: tool execution', () => {
  it('list_devices normalizes the empty list (404/70001)', async () => {
    const h = await startHarness({
      fetch: mockFetch(() => apiError(404, 70001, 'Devices not found')).fetch,
    });
    const r = await h.call('vidsigner_list_devices');
    expect(r.isError).toBe(false);
    expect(r.json).toEqual({ count: 0, items: [] });
  });

  it('an API error comes back as isError with code, HTTP status and hint', async () => {
    const h = await startHarness({
      fetch: mockFetch(() =>
        apiError(409, 16601, 'The signer s does not have the SkipSignatureEmail field'),
      ).fetch,
    });
    const r = await h.call('vidsigner_get_signature_url', { signerGuid: 's1' });
    expect(r.isError).toBe(true);
    expect(r.json).toMatchObject({ error: 'api', httpStatus: 409, code: 16601 });
    expect((r.json as { hint: string }).hint).toMatch(/SkipSignatureEmail/);
  });

  it('get_signature_url adds url_return in base64 without opening anything', async () => {
    const h = await startHarness({
      fetch: mockFetch(() =>
        json(200, { SignatureViDRemoteURL: 'https://pre-vidremote.vidsigner.net/?emailid=abc' }),
      ).fetch,
    });
    const r = await h.call('vidsigner_get_signature_url', {
      signerGuid: 's1',
      returnUrl: 'https://www.google.com/',
    });
    expect((r.json as { url: string }).url).toBe(
      `https://pre-vidremote.vidsigner.net/?emailid=abc&url_return=${Buffer.from('https://www.google.com/').toString('base64')}`,
    );
  });

  it('downloads are saved to disk and the response does NOT carry base64', async () => {
    const h = await startHarness({
      fetch: mockFetch(() =>
        json(200, { FileName: 'contract.pdf', DocContent: PDF_B64, AdditionalData: 'ref-1' }),
      ).fetch,
    });
    for (const [tool, args] of [
      ['vidsigner_get_document', { docGuid: 'd1' }],
      ['vidsigner_download_signed_document', { docGuid: 'd1' }],
    ] as const) {
      const r = await h.call(tool, args);
      expect(r.isError).toBe(false);
      expect(r.text).not.toContain(PDF_B64);
      const saved = (r.json as { savedTo: string }).savedTo;
      expect(saved.startsWith(h.outputDir)).toBe(true);
      expect(existsSync(saved)).toBe(true);
      expect(readFileSync(saved).toString()).toContain('%PDF-1.4 test content');
    }
  });

  it('the evidence report is saved as a PDF', async () => {
    const h = await startHarness({
      fetch: mockFetch(() => json(200, { DocContent: PDF_B64 })).fetch,
    });
    const r = await h.call('vidsigner_get_document_report', { docGuid: 'd1', lang: 'es' });
    expect(r.text).not.toContain(PDF_B64);
    expect((r.json as { savedTo: string }).savedTo).toMatch(/\.pdf$/);
  });

  it('create_document uploads from a local path and does not return the content', async () => {
    const m = api((_u, method) =>
      method === 'POST' ? json(200, { DocGUI: 'doc-9' }) : json(200, {}),
    );
    const h = await startHarness({ env: JWT_ENV, fetch: m.fetch });
    const path = join(h.inputDir, 'in.pdf');
    writeFileSync(path, Buffer.from(PDF_B64, 'base64'));
    const r = await h.call('vidsigner_create_document', {
      filePath: path,
      IssuerName: 'Acme',
      SignersGroups: [
        {
          Signers: [
            {
              SignerName: 'Test',
              SignatureType: 'emailandsms',
              Email: 'test@example.com',
              SkipSignatureEmail: true,
              PhoneNumber: '+34600000000',
            },
          ],
        },
      ],
    });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ DocGUI: 'doc-9' });
    const post = m.calls.find((c) => c.url.endsWith('/documents') && c.method === 'POST');
    const body = JSON.parse(post?.body ?? '{}') as Record<string, unknown>;
    expect(body['DocContent']).toBe(PDF_B64);
    expect(body['FileName']).toBe('in.pdf');
    expect(JSON.stringify(body['SignersGroups'])).toContain('"SkipSignatureEmail":true');
    expect(r.text).not.toContain(PDF_B64);
  });

  it('create_document rejects a file that is not a PDF without calling the API', async () => {
    const m = api(() => json(200, {}));
    const h = await startHarness({ env: JWT_ENV, fetch: m.fetch });
    const path = join(h.inputDir, 'x.pdf');
    writeFileSync(path, 'plain text');
    const r = await h.call('vidsigner_create_document', {
      filePath: path,
      SignersGroups: [{ Signers: [{ SignatureType: 'bio' }] }],
    });
    expect(r.isError).toBe(true);
    expect(r.json).toMatchObject({ error: 'validation' });
    expect(m.calls).toHaveLength(0);
  });

  it('without a ClientID a write returns a clear auth error and does not touch the network', async () => {
    const m = mockFetch(() => json(200, {}));
    const h = await startHarness({ fetch: m.fetch });
    const r = await h.call('vidsigner_close_batch', { batchGuid: 'b1' });
    expect(r.isError).toBe(true);
    expect(r.json).toMatchObject({ error: 'auth' });
    expect(m.calls).toHaveLength(0);
  });

  it('list_documents validates pageSize in the schema (100 is invalid)', async () => {
    const m = mockFetch(() => json(200, []));
    const h = await startHarness({ fetch: m.fetch });
    const res = await h.client
      .callTool({ name: 'vidsigner_list_documents', arguments: { filter: 'all', pageSize: 100 } })
      .catch(() => ({ isError: true }));
    expect((res as { isError?: boolean }).isError).toBe(true);
    expect(m.calls).toHaveLength(0);
  });

  it('search requires BOTH terms: additionaldata alone, elementtype alone and none are refused locally', async () => {
    const m = mockFetch(() => json(200, []));
    const h = await startHarness({ fetch: m.fetch });
    const refused = async (args: Record<string, unknown>) =>
      (
        await h.client
          .callTool({ name: 'vidsigner_search', arguments: args })
          .catch(() => ({ isError: true }))
      ).isError;
    expect(await refused({})).toBe(true);
    expect(await refused({ additionaldata: 'ORDER-1' })).toBe(true);
    expect(await refused({ elementtype: 'document' })).toBe(true);
    expect(await refused({ additionaldata: 'ORDER-1', elementtype: 'Document' })).toBe(true);
    expect(m.calls).toHaveLength(0);
  });

  it('search sends both terms exactly as given', async () => {
    const m = mockFetch(() => json(200, [{ DocGUI: 'd1' }]));
    const h = await startHarness({ fetch: m.fetch });
    const r = await h.call('vidsigner_search', {
      additionaldata: 'ORDER-1',
      elementtype: 'document',
    });
    expect(r.json).toEqual({ count: 1, items: [{ DocGUI: 'd1' }] });
    expect(JSON.parse(String(m.calls[0]?.body))).toEqual({
      Terms: { additionaldata: 'ORDER-1', elementtype: 'document' },
    });
  });
});

describe('MCP: management', () => {
  const MGMT_ENV = {
    VIDSIGNER_ENABLE_MGMT: 'true',
    VIDSIGNER_ALLOW_DESTRUCTIVE: 'true',
    VIDSIGNER_MGMT_PARTNER_USER: 'padmin',
    VIDSIGNER_MGMT_PARTNER_PASS: 'ppass-123',
    ...JWT_ENV,
  };

  it('subscription passwords and tokens do not reach the model', async () => {
    const m = api((u) =>
      u.pathname.endsWith('/subscriptions')
        ? json(200, [
            {
              SubscriptionName: 'sub-name-1',
              SubscriptionPass: 'SECRET-SUB-PASS-0001',
              Active: true,
            },
          ])
        : json(200, {
            userid: 'u',
            legalid: 'l',
            password: 'n/a',
            token: 'SECRET-TOKEN',
            active: true,
          }),
    );
    const h = await startHarness({ env: MGMT_ENV, fetch: m.fetch });
    const subs = await h.call('vidsigner_mgmt_list_subscriptions', { customerGuid: 'c1' });
    expect(subs.text).not.toContain('SECRET-SUB-PASS');
    expect(subs.text).toContain('[hidden]');
    const user = await h.call('vidsigner_mgmt_get_vidmobile_user', { legalId: 'l' });
    expect(user.text).not.toContain('SECRET-TOKEN');
  });

  it('get_subscription never returns SubscriptionPass', async () => {
    const m = api((u) =>
      u.pathname.endsWith('/subscription/g1')
        ? json(200, {
            SubscriptionGUID: 'g1',
            SubscriptionName: 'sub-name-1',
            SubscriptionPass: 'SECRET-SUB-PASS-0002',
            Active: true,
          })
        : json(404, {}),
    );
    const h = await startHarness({ env: MGMT_ENV, fetch: m.fetch });
    const r = await h.call('vidsigner_mgmt_get_subscription', { subscriptionId: 'g1' });
    expect(r.isError).toBe(false);
    expect(r.text).not.toContain('SECRET-SUB-PASS');
    expect(r.text).toContain('[hidden]');
    expect(r.text).toContain('sub-name-1');
  });

  it('create_subscription saves the password to a file and does not return it', async () => {
    const m = api(() =>
      json(200, [
        {
          SubscriptionGUID: 'g1',
          SubscriptionName: 'abcdefgh',
          SubscriptionPass: 'GENERATED-PASS-000001',
          Active: false,
        },
      ]),
    );
    const h = await startHarness({ env: MGMT_ENV, fetch: m.fetch });
    const ch = { Enabled: false, SignaturesLimit: 0, SignaturesLimitPeriod: 0 };
    const r = await h.call('vidsigner_mgmt_create_subscription', {
      customerGuid: 'c1',
      SubscriptionName: 'abcdefgh',
      SignatureChannels: {
        BIO: { ...ch, DevicesLimit: 0 },
        Remote: ch,
        ViDMobile: { ...ch, Domain: '', UsersLimit: 0 },
        Stamper: { ...ch, CertificatesLimit: 0 },
      },
    });
    expect(r.isError).toBe(false);
    expect(r.text).not.toContain('GENERATED-PASS');
    const file = (r.json as { credentialsSavedTo: string }).credentialsSavedTo;
    expect(readFileSync(file, 'utf8')).toContain('GENERATED-PASS-000001');
  });

  it('the VIDmobile user token goes to a file, not to the response', async () => {
    const h = await startHarness({
      env: MGMT_ENV,
      fetch: mockFetch(() => json(200, { token: 'SECRET-TOKEN-ZZZ' })).fetch,
    });
    const r = await h.call('vidsigner_mgmt_get_vidmobile_user_token', { legalId: 'l1' });
    expect(r.text).not.toContain('SECRET-TOKEN-ZZZ');
    expect(readFileSync((r.json as { tokenSavedTo: string }).tokenSavedTo, 'utf8')).toContain(
      'SECRET-TOKEN-ZZZ',
    );
  });

  it('personal data (ID card images) is saved to disk', async () => {
    const img = Buffer.alloc(300, 9).toString('base64');
    const h = await startHarness({
      env: MGMT_ENV,
      fetch: mockFetch(() =>
        json(200, {
          fullname: 'Jane Doe',
          legalidNumber: '1',
          DocIdImageSideA: img,
          DocIdImageSideB: img,
        }),
      ).fetch,
    });
    const r = await h.call('vidsigner_mgmt_get_vidmobile_user_personal_data', { legalId: '1' });
    expect(r.text).not.toContain(img);
    expect(existsSync((r.json as { idCardSideA: string }).idCardSideA)).toBe(true);
  });

  it('without partner credentials the tool returns an actionable error', async () => {
    const m = mockFetch(() => json(200, []));
    const h = await startHarness({ env: { VIDSIGNER_ENABLE_MGMT: 'true' }, fetch: m.fetch });
    const r = await h.call('vidsigner_mgmt_list_partners');
    expect(r.isError).toBe(true);
    expect((r.json as { message: string }).message).toMatch(/VIDSIGNER_MGMT_PARTNER_USER/);
    expect(m.calls).toHaveLength(0);
  });
});
