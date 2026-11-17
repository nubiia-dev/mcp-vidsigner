/**
 * Regression tests for the defects found in the real E2E run against pre-production (17/11/2026)
 * and fixed afterwards. Each test names the evidence it comes from.
 */
import { describe, expect, it } from 'vitest';
import { VidSignerError, VidSignerMgmtClient, hintFor } from '../../src/client/index.js';
import { json, mockFetch, noSleep, token } from '../helpers/mock-fetch.js';

const NO_CERTS =
  'Element not found.No certs for vidmobile user n/a with legalid E2E1 for subscription: subdemo';
const NO_USER =
  'Element not found.No vidmobile user with legalid NOPE and GUID n/a for subscription: subdemo';

const mgmt = (fetchImpl: typeof fetch) =>
  new VidSignerMgmtClient({
    subscriptionName: 'SubDemo',
    subscriptionPass: 'pass-demo-1234',
    fetch: fetchImpl,
    sleep: noSleep,
    retryBaseDelayMs: 1,
  });

const text404 = (body: string) => new Response(body, { status: 404 });

describe('BUG-5: user without certificates -> empty list, and only that case', () => {
  it('"No certs for vidmobile user" (user exists, no certificates) is an empty list', async () => {
    const m = mockFetch(() => text404(NO_CERTS));
    expect(await mgmt(m.fetch).listVidMobileUserCertificates('E2E1')).toEqual([]);
  });

  it('"No vidmobile user with legalid" (the user does not exist) is still an error', async () => {
    const m = mockFetch(() => text404(NO_USER));
    await expect(mgmt(m.fetch).listVidMobileUserCertificates('NOPE')).rejects.toMatchObject({
      httpStatus: 404,
    });
  });

  it('any other generic 404 on that route stays an error', async () => {
    for (const body of ['Not found', 'No certs', 'Something else: No certs for vidmobile user x']) {
      const m = mockFetch(() => text404(body));
      await expect(mgmt(m.fetch).listVidMobileUserCertificates('E2E1')).rejects.toBeInstanceOf(
        VidSignerError,
      );
    }
  });

  it('the no-certs text does NOT normalize other management operations', async () => {
    const m = mockFetch(() => text404(NO_CERTS));
    await expect(mgmt(m.fetch).getVidMobileUser('E2E1')).rejects.toMatchObject({ httpStatus: 404 });
    await expect(mgmt(m.fetch).listVidMobileUsers()).rejects.toMatchObject({ httpStatus: 404 });
  });

  it('the previous rules of the same route keep working (empty body, bare "Elements not found")', async () => {
    expect(
      await mgmt(
        mockFetch(() => new Response(null, { status: 404 })).fetch,
      ).listVidMobileUserCertificates('E2E1'),
    ).toEqual([]);
    expect(
      await mgmt(
        mockFetch(() => text404('Elements not found')).fetch,
      ).listVidMobileUserCertificates('E2E1'),
    ).toEqual([]);
  });
});

describe('routes that differ from the manual (verified in pre-production, 17/11/2026)', () => {
  const jwt = (inner: () => Response) =>
    mockFetch((c) => (c.url.endsWith('/oauth/token') ? token('T') : inner()));
  const client = (fetchImpl: typeof fetch) =>
    new VidSignerMgmtClient({
      clientId: 'cid',
      clientSecret: 'csecret-xyz',
      subscriptionName: 'SubDemo',
      subscriptionPass: 'pass-demo-1234',
      fetch: fetchImpl,
      sleep: noSleep,
      retryBaseDelayMs: 1,
    });
  const path = (m: ReturnType<typeof mockFetch>) =>
    new URL(m.calls.at(-1)?.url ?? '').pathname.replace('/api', '');

  it('GET subscription uses the SINGULAR route (the plural of the manual answers 404 "No HTTP resource")', async () => {
    const m = jwt(() => json(200, { SubscriptionGUID: 'g' }));
    await client(m.fetch).getSubscription('g');
    expect(path(m)).toBe('/subscription/g');
  });

  it('POST T-Systems document type uses the SINGULAR route (the plural answers 405)', async () => {
    const m = jwt(() => json(200, { GUID: 'x' }));
    await client(m.fetch).createTSystemsDocType('g', { DocumentType: 'T', Code: 'C' });
    expect(path(m)).toBe('/subscription/g/tsystemsdoctype');
  });
});

describe('hintFor: errors observed in the E2E run', () => {
  const err = (code: number | undefined, message: string, httpStatus = 400) =>
    new VidSignerError({ kind: 'api', httpStatus, code, message });

  it('12205 explains that the NotificationURL must be the same in every document of the batch', () => {
    expect(hintFor(err(12205, 'Notification URL must match the list of documents'))).toMatch(
      /same NotificationURL/,
    );
  });

  it('12200 explains that Appearance.App needs Logo', () => {
    const h = hintFor(err(12200, 'Logo URL cannot be null or empty'));
    expect(h).toMatch(/Appearance\.App needs Logo/);
  });

  it('12305 and 90140 have a hint, and an observed catalog entry', () => {
    expect(hintFor(err(12305, 'The image width is not valid value: 0'))).toMatch(
      /CorporateLogoWidth/,
    );
    expect(hintFor(err(90140, 'Pin cannot be null or empty'))).toMatch(/Pin/);
    expect(err(12305, 'x').catalog).toMatchObject({ source: 'observed' });
    expect(err(90140, 'x').catalog).toMatchObject({ source: 'observed' });
  });

  it('52002 says that an open batch is not listed', () => {
    expect(hintFor(err(52002, 'Documents on Batch b not found', 404))).toMatch(/OPEN/);
  });

  it('code 0 "Is no next signature" gets the ordered-flow hint, other code-0 errors do not', () => {
    const h = hintFor(err(0, 'Is no next signature.Signature with ID abc', 409));
    expect(h).toMatch(/ordered/i);
    expect(h).toMatch(/signer before/);
    expect(hintFor(err(0, 'Error updating expiration doc', 409))).toBeUndefined();
  });

  it('the IIS 404 page gets a "route does not exist here" hint; an API 404 does not', () => {
    const iis = err(
      undefined,
      'mgmt.vidmobileusers.token -> HTTP 404: The resource you are looking for has been removed, had its name changed, or is temporarily unavailable.',
      404,
    );
    expect(hintFor(iis)).toMatch(/does not exist in this environment/);
    expect(hintFor(err(undefined, 'Element not found.No vidmobileusers', 404))).toBeUndefined();
  });
});
