import { describe, expect, it } from 'vitest';
import { VidSignerClient, VidSignerError, VidSignerMgmtClient } from '../../src/client/index.js';
import { seg } from '../../src/client/http.js';
import { apiError, json, mockFetch, noSleep, token } from '../helpers/mock-fetch.js';

const rest = (f: typeof fetch) =>
  new VidSignerClient({
    subscriptionName: 'S',
    subscriptionPass: 'P-1234',
    clientId: 'c',
    clientSecret: 'csecret-1',
    fetch: f,
    sleep: noSleep,
    maxRetries: 0,
  });
const mgmt = (f: typeof fetch) =>
  new VidSignerMgmtClient({
    subscriptionName: 'S',
    subscriptionPass: 'P-1234',
    clientId: 'c',
    clientSecret: 'csecret-1',
    partnerUser: 'p',
    partnerPass: 'ppass-1',
    fetch: f,
    sleep: noSleep,
    maxRetries: 0,
  });
const api = (inner: () => Response) =>
  mockFetch((c) => (c.url.endsWith('/oauth/token') ? token('T') : inner()));
const text = (status: number, body: string) => new Response(body, { status });

describe('a listing 404 is only an "empty list" if it really is', () => {
  it('REST: signeddocuments with an empty queue (404 without body) -> []', async () => {
    expect(await rest(api(() => text(404, '')).fetch).listSignedDocuments()).toEqual([]);
  });

  it('REST: a 404 with another code or with text is NOT an empty list', async () => {
    await expect(
      rest(api(() => apiError(404, 70000, 'Device zzz not found')).fetch).listDocumentsByDevice(
        'zzz',
      ),
    ).rejects.toMatchObject({ httpStatus: 404, code: 70000 });
    await expect(
      rest(api(() => text(404, 'Element not found.Algo')).fetch).listSignedDocuments(),
    ).rejects.toMatchObject({ httpStatus: 404 });
  });

  it('REST: a 404 without body in documentlist (which uses a code) is still an error', async () => {
    await expect(rest(api(() => text(404, '')).fetch).listDocuments('all')).rejects.toMatchObject({
      httpStatus: 404,
    });
  });

  it('management: 404 without body, "list is empty" or a bare "Elements not found" -> empty list', async () => {
    for (const body of ['', 'Partners list is empty', 'Elements not found']) {
      const m = api(() => text(404, body));
      expect((await mgmt(m.fetch).listPartners()).items).toEqual([]);
    }
    expect(await mgmt(api(() => text(404, '')).fetch).listVidMobileUsers()).toEqual([]);
  });

  it('management: a 404 naming a nonexistent parent resource is an error, not []', async () => {
    for (const body of [
      'Element not found.No vidmobile user with legalid zzz and GUID n/a for subscription: s',
      'Elements not found. Subscription not exist.',
      'Customer not exist',
      'VIDmobileUser not found or certificate list is empty',
    ]) {
      const m = api(() => text(404, body));
      await expect(mgmt(m.fetch).listVidMobileUserCertificates('zzz')).rejects.toMatchObject({
        httpStatus: 404,
      });
      await expect(mgmt(m.fetch).listCustomerSubscriptions('zzz')).rejects.toMatchObject({
        httpStatus: 404,
      });
    }
  });
});

describe('documentinfo and documentbatchinfo accept both spellings', () => {
  const group = { Signers: [{ SignerGUI: 's1' }], Min: 1 };

  it('documentinfo with SignerGroups (OpenAPI) or SignersGroups (manual) returns both', async () => {
    for (const key of ['SignerGroups', 'SignersGroups']) {
      const info = await rest(
        api(() => json(200, { DocGUI: 'd1', [key]: [group] })).fetch,
      ).getDocumentInfo('d1');
      expect(info.SignerGroups).toEqual([group]);
      expect(info.SignersGroups).toEqual([group]);
    }
  });

  it('documentbatchinfo: Guid/BatchGUI y Docs[].Guid/DocGUI', async () => {
    const manual = await rest(
      api(() =>
        json(200, {
          BatchGUI: 'b1',
          BatchStatus: 'Pending',
          Docs: [{ DocGUI: 'd1', Status: 'Unsigned' }],
        }),
      ).fetch,
    ).getBatchInfo('b1');
    expect(manual).toMatchObject({ Guid: 'b1', BatchGUI: 'b1' });
    expect(manual.Docs?.[0]).toMatchObject({ Guid: 'd1', DocGUI: 'd1', Status: 'Unsigned' });
    const spec = await rest(
      api(() => json(200, { Guid: 'b2', BatchStatus: 'Completed', Docs: [{ Guid: 'd2' }] })).fetch,
    ).getBatchInfo('b2');
    expect(spec).toMatchObject({ Guid: 'b2', BatchGUI: 'b2' });
    expect(spec.Docs?.[0]).toMatchObject({ Guid: 'd2', DocGUI: 'd2' });
  });

  it('createEDelivery returns GUID and DocGUI even if the server only sends DocGUI', async () => {
    const res = await rest(api(() => json(200, { DocGUI: 'e1' })).fetch).createEDelivery(
      {
        RecipientEmailAddress: 'a@example.test',
        Language: 'es',
        FileName: 'a.pdf',
        IssuerName: 'S',
      },
      'QUJD',
    );
    expect(res).toMatchObject({ GUID: 'e1', DocGUI: 'e1' });
  });
});

describe('listAllDocumentsPaged reports truncation', () => {
  const page = (n: number) =>
    json(200, {
      List: [{ DocGUI: `g${n}a` }, { DocGUI: `g${n}b` }],
      PageNumber: n,
      PageSize: 2,
      HasNext: true,
    });
  it('truncated=true if it stops at maxPages with more pages available', async () => {
    let n = 0;
    const r = await rest(api(() => page(++n)).fetch).listAllDocumentsPaged('all', {
      pageSize: 2,
      maxPages: 3,
    });
    expect(r).toMatchObject({ pagesFetched: 3, truncated: true });
    expect(r.items).toHaveLength(6);
  });

  it('truncated=false if the list ends before the limit', async () => {
    let n = 0;
    const r = await rest(
      api(() =>
        ++n < 3
          ? page(n)
          : json(200, { List: [{ DocGUI: 'last' }], PageNumber: 3, PageSize: 2, HasNext: false }),
      ).fetch,
    ).listAllDocumentsPaged('all', { pageSize: 2, maxPages: 10 });
    expect(r).toMatchObject({ pagesFetched: 3, truncated: false });
  });

  it('not flagged as truncated if the last allowed page is exactly the last one', async () => {
    const r = await rest(
      api(() => json(200, { List: [{ DocGUI: 'x' }], PageNumber: 1, PageSize: 2, HasNext: false }))
        .fetch,
    ).listAllDocumentsPaged('all', { pageSize: 2, maxPages: 1 });
    expect(r.truncated).toBe(false);
  });
});

describe('L1-L4: client-side validations', () => {
  it('updateSignerData without fields is rejected without calling the API', async () => {
    const m = api(() => json(200, {}));
    for (const data of [{}, { email: '  ' }, { phonenumber: '' }]) {
      await expect(rest(m.fetch).updateSignerData('s1', data)).rejects.toMatchObject({
        kind: 'validation',
      });
    }
    expect(m.calls).toHaveLength(0);
  });

  it('seg rejects empty, "." and ".."', () => {
    for (const bad of ['', '.', '..']) expect(() => seg(bad)).toThrow(VidSignerError);
    expect(seg('a b/c')).toBe('a%20b%2Fc');
    expect(seg('..a')).toBe('..a');
  });

  it('a path with ".." never reaches the network', async () => {
    const m = api(() => json(200, {}));
    await expect(rest(m.fetch).getDocument('..')).rejects.toMatchObject({ kind: 'validation' });
    await expect(mgmt(m.fetch).getCustomer('.')).rejects.toMatchObject({ kind: 'validation' });
    expect(m.calls).toHaveLength(0);
  });

  it.each([
    [{ searchText: 'ab' }, /searchText/],
    [{ searchText: 'abcdefghijk' }, /searchText/],
    [{ orderBy: 'DocGUI' }, /orderBy/],
    [{ orderBy: 'filename' }, /orderBy/],
    [{ orderType: 'DES' }, /orderType/],
    [{ orderType: 'descending' }, /orderType/],
  ])('documentlist rejects %j before calling', async (opts, msg) => {
    const m = api(() => json(200, []));
    await expect(rest(m.fetch).listDocuments('all', opts)).rejects.toThrow(msg);
    expect(m.calls).toHaveLength(0);
  });

  it('accepts searchText of 3 to 10 and the verified orderBy values', async () => {
    const m = api(() => json(200, []));
    for (const orderBy of ['FileName', 'DocStatus', 'Downloaded', 'AdditionalData', 'UploadTime']) {
      await rest(m.fetch).listDocuments('all', { searchText: 'abc', orderBy, orderType: 'desc' });
    }
    await rest(m.fetch).listDocuments('all', { searchText: 'abcdefghij' });
  });

  it('management limits pageSize to 1-99 and pageNumber >= 1', async () => {
    const m = api(() => json(200, []));
    await expect(mgmt(m.fetch).listPartners({ pageSize: 100 })).rejects.toThrow(/pageSize/);
    await expect(mgmt(m.fetch).listCustomers('p', { pageSize: 0 })).rejects.toThrow(/pageSize/);
    await expect(mgmt(m.fetch).listPartners({ pageNumber: 0 })).rejects.toThrow(/pageNumber/);
    await mgmt(m.fetch).listPartners({ pageSize: 99, pageNumber: 1 });
  });
});
