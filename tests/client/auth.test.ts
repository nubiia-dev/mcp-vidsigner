import { describe, expect, it } from 'vitest';
import { VidSignerClient, VidSignerError } from '../../src/client/index.js';
import { apiError, fakeClock, json, mockFetch, noSleep, token } from '../helpers/mock-fetch.js';

const BASE = 'https://pre-vidsignercloud.validatedid.com/api/v3.0';
const SUB = { subscriptionName: 'SubDemo', subscriptionPass: 'pass-demo-1234' };
const b64 = (s: string) => Buffer.from(s).toString('base64');

function client(extra: Partial<ConstructorParameters<typeof VidSignerClient>[0]> = {}) {
  return (fetchImpl: typeof fetch, clock = fakeClock()) =>
    new VidSignerClient({
      ...SUB,
      fetch: fetchImpl,
      now: clock.now,
      sleep: noSleep,
      retryBaseDelayMs: 1,
      ...extra,
    });
}

describe('authentication: Basic for reads', () => {
  it('without ClientID it uses Basic SubscriptionName:SubscriptionPass', async () => {
    const m = mockFetch(() => json(200, [{ DeviceName: 'T1' }]));
    const c = client()(m.fetch);
    const devices = await c.getDevices();
    expect(devices).toHaveLength(1);
    expect(m.calls).toHaveLength(1);
    expect(m.calls[0]?.url).toBe(`${BASE}/devices`);
    expect(m.calls[0]?.headers['authorization']).toBe(`Basic ${b64('SubDemo:pass-demo-1234')}`);
  });

  it('a write without ClientID fails BEFORE sending anything', async () => {
    const m = mockFetch(() => json(200, {}));
    const c = client()(m.fetch);
    const err = await c
      .createDocument(
        { SignersGroups: [{ Signers: [{ SignatureType: 'emailandsms' }] }] },
        'JVBERi0=',
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VidSignerError);
    expect((err as VidSignerError).kind).toBe('auth');
    expect((err as VidSignerError).message).toMatch(/requires a JWT/);
    expect(m.calls).toHaveLength(0);
    expect(c.canWrite).toBe(false);
  });

  it('authMode=jwt without ClientID is a configuration error', () => {
    expect(() => new VidSignerClient({ ...SUB, authMode: 'jwt' })).toThrow(/clientId/);
  });

  it('requires subscription credentials', () => {
    expect(() => new VidSignerClient({ subscriptionName: '', subscriptionPass: '' })).toThrow(
      /subscriptionName/,
    );
  });
});

describe('authentication: JWT', () => {
  const withJwt = { clientId: 'cid', clientSecret: 'csecret-xyz' };

  it('requests the token with Basic(ClientID:Secret) and the password/subscription body', async () => {
    const m = mockFetch((call) =>
      call.url.endsWith('/oauth/token') ? token('T1') : json(200, []),
    );
    const c = client(withJwt)(m.fetch);
    await c.getDevices();
    const tokenCall = m.calls[0]!;
    expect(tokenCall.method).toBe('POST');
    expect(tokenCall.url).toBe(`${BASE}/oauth/token`);
    expect(tokenCall.headers['authorization']).toBe(`Basic ${b64('cid:csecret-xyz')}`);
    expect(JSON.parse(tokenCall.body ?? '{}')).toEqual({
      grant_type: 'password',
      username: 'SubDemo',
      password: 'pass-demo-1234',
      scope: 'subscription',
    });
    expect(m.calls[1]?.headers['authorization']).toBe('Bearer T1');
    expect(c.canWrite).toBe(true);
  });

  it('caches the token between calls', async () => {
    const m = mockFetch((call) =>
      call.url.endsWith('/oauth/token') ? token('T1') : json(200, []),
    );
    const c = client(withJwt)(m.fetch);
    await c.getDevices();
    await c.getDevices();
    await c.listEDeliveries();
    expect(m.calls.filter((x) => x.url.endsWith('/oauth/token'))).toHaveLength(1);
  });

  it('renews the token before it expires (60 s margin)', async () => {
    const clock = fakeClock();
    let n = 0;
    const m = mockFetch((call) =>
      call.url.endsWith('/oauth/token') ? token(`T${++n}`, 3600) : json(200, []),
    );
    const c = client(withJwt)(m.fetch, clock);
    await c.getDevices();
    clock.advance((3600 - 61) * 1000);
    await c.getDevices(); // still valid
    expect(n).toBe(1);
    clock.advance(2 * 1000); // within the renewal margin
    await c.getDevices();
    expect(n).toBe(2);
    const bearer = m.calls
      .filter((x) => !x.url.endsWith('/oauth/token'))
      .map((x) => x.headers['authorization']);
    expect(bearer).toEqual(['Bearer T1', 'Bearer T1', 'Bearer T2']);
  });

  it('shares a single token request among concurrent calls', async () => {
    const m = mockFetch(async (call) => {
      if (call.url.endsWith('/oauth/token')) {
        await new Promise((r) => setTimeout(r, 10));
        return token('T1');
      }
      return json(200, []);
    });
    const c = client(withJwt)(m.fetch);
    await Promise.all([c.getDevices(), c.getDevices(), c.getDevices()]);
    expect(m.calls.filter((x) => x.url.endsWith('/oauth/token'))).toHaveLength(1);
  });

  it('a 401 with a cached token renews the token and retries once', async () => {
    let tokens = 0;
    const m = mockFetch((call) => {
      if (call.url.endsWith('/oauth/token')) return token(`T${++tokens}`);
      return call.headers['authorization'] === 'Bearer T1'
        ? apiError(401, 20200, 'revoked')
        : json(200, [{ DeviceName: 'A' }]);
    });
    const c = client(withJwt)(m.fetch);
    const res = await c.getDevices();
    expect(res).toEqual([{ DeviceName: 'A' }]);
    expect(tokens).toBe(2);
  });

  it('a persistent 401 does not loop', async () => {
    const m = mockFetch((call) =>
      call.url.endsWith('/oauth/token') ? token('T') : apiError(401, 20200, 'no'),
    );
    const c = client(withJwt)(m.fetch);
    const err = (await c.getDevices().catch((e: unknown) => e)) as VidSignerError;
    expect(err.kind).toBe('auth');
    expect(err.httpStatus).toBe(401);
    // token + request + (renewal) token + request = 4
    expect(m.calls).toHaveLength(4);
  });

  it('an OAuth credentials failure is reported as auth and not retried', async () => {
    const m = mockFetch(() => apiError(401, 40001, 'The subscription x not found'));
    const c = client(withJwt)(m.fetch);
    const err = (await c.getDevices().catch((e: unknown) => e)) as VidSignerError;
    expect(err.kind).toBe('auth');
    expect(err.code).toBe(40001);
    expect(m.calls).toHaveLength(1);
  });

  it('accepts expire_in (the manual spelling) and uses 3600 s if missing', async () => {
    const clock = fakeClock();
    let n = 0;
    const m = mockFetch((call) => {
      if (call.url.endsWith('/oauth/token')) {
        n += 1;
        return json(200, { token_type: 'Bearer', access_token: `T${n}`, expire_in: '120' });
      }
      return json(200, []);
    });
    const c = client(withJwt)(m.fetch, clock);
    await c.getDevices();
    clock.advance(70 * 1000); // 120 s - 60 s margin = 60 s usable
    await c.getDevices();
    expect(n).toBe(2);
  });
});
