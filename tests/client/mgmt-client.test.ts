import { describe, expect, it } from 'vitest';
import { VidSignerError, VidSignerMgmtClient, normalizePage } from '../../src/client/index.js';
import { apiError, json, mockFetch, noSleep, token } from '../helpers/mock-fetch.js';

const MGMT = 'https://pre-vidsignercloudmgmt.validatedid.com/api';
const b64 = (s: string) => Buffer.from(s).toString('base64');

const base = {
  clientId: 'cid',
  clientSecret: 'csecret-xyz',
  partnerUser: 'padmin',
  partnerPass: 'partner-pass-1',
  subscriptionName: 'SubDemo',
  subscriptionPass: 'pass-demo-1234',
  sleep: noSleep,
  retryBaseDelayMs: 1,
};

describe('MGMT: per-operation authentication', () => {
  it('partners uses a scope=partner JWT with partner user/password and client Basic', async () => {
    const m = mockFetch((c) =>
      c.url.endsWith('/oauth/token')
        ? token('PT')
        : json(200, [{ PartnerGUID: 'p1', PartnerName: 'X', PartnerLegalId: '1' }]),
    );
    const client = new VidSignerMgmtClient({ ...base, fetch: m.fetch });
    const page = await client.listPartners();
    expect(page.items).toHaveLength(1);
    expect(m.calls[0]?.url).toBe(`${MGMT}/oauth/token`);
    expect(m.calls[0]?.headers['authorization']).toBe(`Basic ${b64('cid:csecret-xyz')}`);
    expect(JSON.parse(m.calls[0]?.body ?? '{}')).toEqual({
      grant_type: 'password',
      username: 'padmin',
      password: 'partner-pass-1',
      scope: 'partner',
    });
    expect(m.calls[1]?.headers['authorization']).toBe('Bearer PT');
  });

  it('subscription operations request the JWT with scope=subscription', async () => {
    const m = mockFetch((c) => (c.url.endsWith('/oauth/token') ? token('ST') : json(200, [])));
    const client = new VidSignerMgmtClient({ ...base, fetch: m.fetch });
    await client.listStampCertificates('sub-1');
    expect(JSON.parse(m.calls[0]?.body ?? '{}')).toMatchObject({
      scope: 'subscription',
      username: 'SubDemo',
    });
    expect(m.calls[1]?.url).toBe(`${MGMT}/subscription/sub-1/stampcertificates`);
  });

  it('/vidmobileusers uses the subscription Basic and does NOT request a token', async () => {
    const m = mockFetch(() => json(200, []));
    const client = new VidSignerMgmtClient({ ...base, fetch: m.fetch });
    await client.listVidMobileUsers();
    expect(m.calls).toHaveLength(1);
    expect(m.calls[0]?.headers['authorization']).toBe(`Basic ${b64('SubDemo:pass-demo-1234')}`);
  });

  it('without partner credentials it fails before sending anything, with a hint', async () => {
    const m = mockFetch(() => json(200, []));
    const client = new VidSignerMgmtClient({
      subscriptionName: 'S',
      subscriptionPass: 'P-1234',
      fetch: m.fetch,
    });
    const err = (await client.listPartners().catch((e: unknown) => e)) as VidSignerError;
    expect(err.kind).toBe('auth');
    expect(err.message).toMatch(/VIDSIGNER_MGMT_PARTNER_USER/);
    expect(m.calls).toHaveLength(0);
  });

  it('statistics accepts partner or subscription credentials', async () => {
    const m = mockFetch((c) =>
      c.url.endsWith('/oauth/token')
        ? token('T')
        : json(200, [{ Id: 'a', Type: 'device', SignaturesDone: 3 }]),
    );
    const onlySub = new VidSignerMgmtClient({
      clientId: 'cid',
      clientSecret: 'csecret-xyz',
      subscriptionName: 'SubDemo',
      subscriptionPass: 'pass-demo-1234',
      fetch: m.fetch,
    });
    const res = await onlySub.searchStatistics('sub-1', { From: '2026/01/01', To: '2026/02/01' });
    expect(res[0]?.SignaturesDone).toBe(3);
    expect(JSON.parse(m.calls[0]?.body ?? '{}')).toMatchObject({ scope: 'subscription' });
  });
});

describe('MGMT: requests and responses', () => {
  const client = (fetchImpl: typeof fetch) =>
    new VidSignerMgmtClient({ ...base, fetch: fetchImpl });
  const jwt = (inner: (c: { url: string; method: string; body: string | undefined }) => Response) =>
    mockFetch((c) => (c.url.endsWith('/oauth/token') ? token('T') : inner(c)));

  it('pagination of partners/customers with the manual names', async () => {
    const m = jwt(() =>
      json(200, {
        List: [{ CustomerGUID: 'c1' }],
        Count: 1,
        HasNext: false,
        TotalPages: 1,
        PageNumber: 1,
        PageSize: 5,
      }),
    );
    const page = await client(m.fetch).listCustomers('p1', {
      pageNumber: 1,
      pageSize: 5,
      orderBy: 'CustomerName',
      orderType: 'asc',
      searchText: 'x',
    });
    expect(page).toMatchObject({ count: 1, hasNext: false, totalPages: 1 });
    const u = new URL(m.calls[1]!.url);
    expect(u.pathname).toBe('/api/partners/p1/customers');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      PageNumber: '1',
      PageSize: '5',
      OrderBy: 'CustomerName',
      OrderType: 'asc',
      SearchText: 'x',
    });
  });

  it('an empty list (404 without body) is normalized to empty', async () => {
    const m = jwt(() => new Response('Elements not found', { status: 404 }));
    expect((await client(m.fetch).listPartners()).items).toEqual([]);
    expect(await client(m.fetch).listCustomerSubscriptions('c1')).toEqual([]);
  });

  it('a 404 on a specific resource is still an error', async () => {
    const m = jwt(() => new Response('Element not found', { status: 404 }));
    await expect(client(m.fetch).getCustomer('nope')).rejects.toMatchObject({ httpStatus: 404 });
  });

  it('createSubscription normalizes the manual array response', async () => {
    const m = jwt(() =>
      json(200, [{ SubscriptionGUID: 'g1', SubscriptionName: 'abcdefgh', Active: false }]),
    );
    const sub = await client(m.fetch).createSubscription('c1', {
      SubscriptionName: 'abcdefgh',
      SignatureChannels: {
        BIO: { Enabled: false, SignaturesLimit: 0, SignaturesLimitPeriod: 0, DevicesLimit: 0 },
        Remote: { Enabled: true, SignaturesLimit: 100, SignaturesLimitPeriod: 12 },
        ViDMobile: {
          Enabled: false,
          Domain: '',
          SignaturesLimit: 0,
          SignaturesLimitPeriod: 0,
          UsersLimit: 0,
        },
        Stamper: {
          Enabled: false,
          SignaturesLimit: 0,
          SignaturesLimitPeriod: 0,
          CertificatesLimit: 0,
        },
      },
    });
    expect(sub.SubscriptionGUID).toBe('g1');
  });

  it('routes: singular/plural, status and enrollment codes as in the manual', async () => {
    const m = jwt(() => json(200, {}));
    const c = client(m.fetch);
    await c.getSubscription('s1');
    await c.setSubscriptionStatus('s1', 'active');
    await c.createEnrollmentCode('s1', 3);
    await c.updateEnrollmentCode('e1', 4);
    await c.deleteEnrollmentCode('e1');
    await c.updateDevice('Tab 1', 'nueva');
    const seen = m.calls
      .filter((x) => !x.url.endsWith('/oauth/token'))
      .map((x) => `${x.method} ${new URL(x.url).pathname}`);
    expect(seen).toEqual([
      'GET /api/subscriptions/s1',
      'PUT /api/subscription/s1/status/active',
      'POST /api/subscription/s1/enrollmentcode',
      'PUT /api/enrollmentcodes/e1',
      'DELETE /api/enrollmentcodes/e1',
      'PUT /api/devices/Tab%201',
    ]);
  });

  it('creating POSTs are not retried; GETs are', async () => {
    const m = jwt(() => apiError(500, 0, 'x'));
    const c = client(m.fetch);
    await c
      .createCustomer('p1', {
        CustomerName: 'a',
        CustomerLegalId: 'b',
        Address: 'c',
        City: 'd',
        State: 'e',
        PostalCode: '1',
        Country: 'ES',
        CustomerURL: 'n/a',
      })
      .catch(() => undefined);
    expect(
      m.calls.filter((x) => x.method === 'POST' && !x.url.endsWith('/oauth/token')),
    ).toHaveLength(1);
    await c.getCustomer('c1').catch(() => undefined);
    expect(m.calls.filter((x) => x.method === 'GET')).toHaveLength(3);
  });

  it('normalizePage', () => {
    expect(normalizePage<number>([1, 2]).items).toEqual([1, 2]);
    expect(normalizePage<number>({ List: [1], Count: 1 }).count).toBe(1);
    expect(normalizePage<number>(undefined).items).toEqual([]);
  });
});
