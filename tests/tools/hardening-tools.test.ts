import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { errorResult } from '../../src/server.js';
import { startHarness } from '../helpers/mcp.js';
import { apiError, json, mockFetch, token } from '../helpers/mock-fetch.js';

const JWT = { VIDSIGNER_CLIENT_ID: 'cid', VIDSIGNER_CLIENT_SECRET: 'csecret-xyz' };
const api = (inner: (url: string, method: string) => Response) =>
  mockFetch((c) => (c.url.endsWith('/oauth/token') ? token('T') : inner(c.url, c.method)));
const PDF = '%PDF-1.4 sample';

describe('tools: review fixes', () => {
  it('create_edelivery returns GUID even if the server answers DocGUI, plus the rest', async () => {
    const m = api(() => json(200, { DocGUI: 'e-77', Extra: 'x' }));
    const h = await startHarness({ env: JWT, fetch: m.fetch });
    writeFileSync(join(h.inputDir, 'a.pdf'), PDF);
    const r = await h.call('vidsigner_create_edelivery', {
      filePath: join(h.inputDir, 'a.pdf'),
      RecipientEmailAddress: 'a@example.com',
      RecipientPhoneNumber: '+34600000000',
      Language: 'es',
      IssuerName: 'Acme',
    });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ GUID: 'e-77', DocGUI: 'e-77', Extra: 'x' });
  });

  it('list_documents with fetchAll warns when it stops at maxPages', async () => {
    let n = 0;
    const m = api(() =>
      json(200, {
        List: [{ DocGUI: `g${++n}` }],
        PageNumber: n,
        PageSize: 1,
        HasNext: true,
      }),
    );
    const h = await startHarness({ fetch: m.fetch });
    const r = await h.call('vidsigner_list_documents', {
      filter: 'all',
      fetchAll: true,
      pageSize: 1,
      maxPages: 2,
    });
    expect(r.json).toMatchObject({ count: 2, pagesFetched: 2, truncated: true });
    expect((r.json as { warning: string }).warning).toMatch(/incomplete/);
  });

  it('list_documents rejects a short searchText and an unsupported orderBy (schema)', async () => {
    const h = await startHarness({ fetch: api(() => json(200, [])).fetch });
    for (const args of [
      { filter: 'all', searchText: 'ab' },
      { filter: 'all', orderBy: 'DocGUI' },
    ]) {
      const err = await h.client
        .callTool({ name: 'vidsigner_list_documents', arguments: args })
        .then(
          (r) => ({ isError: r.isError, text: JSON.stringify(r.content) }),
          (e: Error) => ({ isError: true, text: e.message }),
        );
      expect(err.isError).toBe(true);
    }
  });

  it('update_signer_data without fields is a validation error and does not call the API', async () => {
    const m = api(() => json(200, {}));
    const h = await startHarness({ env: JWT, fetch: m.fetch });
    const r = await h.call('vidsigner_update_signer_data', { signerGuid: 's1' });
    expect(r.isError).toBe(true);
    expect(r.json).toMatchObject({ error: 'validation' });
    expect(m.calls.filter((c) => !c.url.endsWith('/oauth/token'))).toHaveLength(0);
  });

  it('an identifier ".." does not pass the schema', async () => {
    const m = api(() => json(200, {}));
    const h = await startHarness({ fetch: m.fetch });
    const res = await h.client
      .callTool({ name: 'vidsigner_get_document', arguments: { docGuid: '..' } })
      .then(
        (r) => r.isError === true,
        () => true,
      );
    expect(res).toBe(true);
    expect(m.calls).toHaveLength(0);
  });

  it('an unexpected error does not return its message (it may carry paths)', () => {
    const res = errorResult(new Error('ENOENT: no such file /Users/jdoe/.ssh/id_rsa'));
    const text = JSON.stringify(res);
    expect(res.isError).toBe(true);
    expect(text).not.toContain('/Users/jdoe');
    expect(text).toContain('unexpected');
  });

  it('delete_batch adds the unconfirmed-endpoint warning on a 404/405', async () => {
    const m = api(() => apiError(404, 0, 'Not found'));
    const h = await startHarness({
      env: { ...JWT, VIDSIGNER_ALLOW_DESTRUCTIVE: 'true' },
      fetch: m.fetch,
    });
    const r = await h.call('vidsigner_delete_batch', { batchGuid: 'b1' });
    expect(r.isError).toBe(true);
    expect((r.json as { message: string }).message).toMatch(/is unconfirmed/);
  });

  it('get_document_info and get_batch_info always return the OpenAPI spelling', async () => {
    const m = api((url) =>
      url.includes('/documentinfo/')
        ? json(200, { DocGUI: 'd', SignersGroups: [{ Signers: [] }] })
        : json(200, {
            BatchGUI: 'b',
            BatchStatus: 'Pending',
            Docs: [{ DocGUI: 'd1', Status: 'x' }],
          }),
    );
    const h = await startHarness({ fetch: m.fetch });
    const info = (await h.call('vidsigner_get_document_info', { docGuid: 'd' })).json as Record<
      string,
      unknown
    >;
    expect(info['SignerGroups']).toBeDefined();
    expect(info['SignersGroups']).toBeUndefined();
    const batch = (await h.call('vidsigner_get_batch_info', { batchGuid: 'b' })).json as {
      Guid: string;
      BatchGUI?: string;
      Docs: Array<Record<string, unknown>>;
    };
    expect(batch.Guid).toBe('b');
    expect(batch.BatchGUI).toBeUndefined();
    expect(batch.Docs[0]).toEqual({ Guid: 'd1', Status: 'x' });
  });
});
