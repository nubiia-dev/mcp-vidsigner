import { describe, expect, it } from 'vitest';
import { VidSignerClient, VidSignerError } from '../../src/client/index.js';
import {
  apiError,
  json,
  mockFetch,
  networkError,
  noSleep,
  sequence,
} from '../helpers/mock-fetch.js';

const SUB = { subscriptionName: 'SubDemo', subscriptionPass: 'pass-demo-1234' };

function make(
  fetchImpl: typeof fetch,
  extra: Partial<ConstructorParameters<typeof VidSignerClient>[0]> = {},
) {
  return new VidSignerClient({
    ...SUB,
    fetch: fetchImpl,
    sleep: noSleep,
    retryBaseDelayMs: 1,
    maxRetries: 2,
    ...extra,
  });
}
const JWT = { clientId: 'cid', clientSecret: 'csecret-xyz' };

describe('empty-list normalization (404)', () => {
  it('documentlist 404/50002 -> empty list', async () => {
    const m = sequence(apiError(404, 50002, 'The list of documents are empty'));
    const page = await make(m.fetch).listDocuments('all');
    expect(page.items).toEqual([]);
  });

  it('devices 404/70001 -> []', async () => {
    const m = sequence(apiError(404, 70001, 'Devices not found for subscription: x'));
    expect(await make(m.fetch).getDevices()).toEqual([]);
  });

  it('GET /signeddocuments with an empty queue (404 without body, verified in pre) -> []', async () => {
    const m = sequence(new Response(null, { status: 404 }));
    expect(await make(m.fetch).listSignedDocuments()).toEqual([]);
  });

  it('a 404 with another code is NOT normalized (nonexistent document)', async () => {
    const m = sequence(apiError(404, 50000, 'Document abc not found'));
    const err = (await make(m.fetch)
      .getDocumentInfo('abc')
      .catch((e: unknown) => e)) as VidSignerError;
    expect(err.httpStatus).toBe(404);
    expect(err.code).toBe(50000);
  });

  it('a 404/50002 on a non-list operation is still an error', async () => {
    const m = sequence(apiError(404, 50002, 'x'));
    await expect(make(m.fetch).getDocumentInfo('abc')).rejects.toBeInstanceOf(VidSignerError);
  });

  it('listSignedDocuments, listEDeliveries and search tolerate the empty-list 404', async () => {
    const m = mockFetch(() => apiError(404, 50002, 'empty'));
    const c = make(m.fetch);
    expect(await c.listSignedDocuments()).toEqual([]);
    expect(await c.listEDeliveries()).toEqual([]);
  });
});

describe('error mapping', () => {
  it('maps Code/Message/HTTP and adds the Annex III catalog', async () => {
    const m = sequence(
      apiError(409, 16601, 'The signer x does not have the SkipSignatureEmail field'),
    );
    const err = (await make(m.fetch)
      .getSignatureRemoteUrl('s1')
      .catch((e: unknown) => e)) as VidSignerError;
    expect(err).toBeInstanceOf(VidSignerError);
    expect(err.kind).toBe('api');
    expect(err.httpStatus).toBe(409);
    expect(err.code).toBe(16601);
    expect(err.catalog?.http).toBe(409);
    expect(err.catalog?.endpoints.join(' ')).toMatch(/vidremoteurl/);
    expect(err.toJSON()['hint']).toMatch(/SkipSignatureEmail=true/);
    expect(err.message).toContain('HTTP 409 / 16601');
  });

  it('409/40111 explains AllowSkipEmail', async () => {
    const m = sequence(
      apiError(409, 40111, 'The subscription is not configured to allow skip email'),
    );
    const err = (await make(m.fetch)
      .getSignatureRemoteUrl('s1')
      .catch((e: unknown) => e)) as VidSignerError;
    expect(err.toJSON()['hint']).toMatch(/AllowSkipEmail/);
  });

  it('403 and 401 are of kind auth', async () => {
    const e403 = (await make(
      sequence(apiError(403, 20103, 'Invalid Subscription credentials')).fetch,
    )
      .getDevices()
      .catch((e: unknown) => e)) as VidSignerError;
    expect(e403.kind).toBe('auth');
    expect(e403.httpStatus).toBe(403);
  });

  it('the server credentials echo is redacted from the message', async () => {
    const m = sequence(
      apiError(
        403,
        20103,
        'Invalid Subscription credentials. Authentication header: SubDemo:pass-demo-1234',
      ),
    );
    const err = (await make(m.fetch)
      .getDevices()
      .catch((e: unknown) => e)) as VidSignerError;
    expect(err.message).not.toContain('pass-demo-1234');
    expect(err.message).toContain('[REDACTED]');
  });

  it('accepts plain-text and empty error bodies', async () => {
    const plain = (await make(sequence(new Response('Something failed', { status: 400 })).fetch)
      .getDevices()
      .catch((e: unknown) => e)) as VidSignerError;
    expect(plain.message).toContain('Something failed');
    expect(plain.code).toBeUndefined();
    const empty = (await make(sequence(new Response(null, { status: 400 })).fetch)
      .getDevices()
      .catch((e: unknown) => e)) as VidSignerError;
    expect(empty.httpStatus).toBe(400);
  });

  it('Code 0 (free-form exception) is preserved', async () => {
    const m = sequence(apiError(404, 0, 'Element not found.Not found document with GUID: x'));
    const err = (await make(m.fetch)
      .getDocument('x')
      .catch((e: unknown) => e)) as VidSignerError;
    expect(err.code).toBe(0);
    expect(err.catalog).toBeUndefined();
  });

  it('the server StackTrace never reaches the error', async () => {
    const body = {
      Error: {
        Code: 1,
        Message: 'm',
        Details: '',
        Timestamp: 't',
        StackTrace: 'at Secret.Namespace.Method',
      },
    };
    const err = (await make(sequence(json(500, body)).fetch, { maxRetries: 0 })
      .getDevices()
      .catch((e: unknown) => e)) as VidSignerError;
    expect(JSON.stringify(err.toJSON())).not.toContain('Secret.Namespace');
    expect(err.message).not.toContain('Secret.Namespace');
  });
});

describe('retries: only 5xx and network', () => {
  it('retries a 5xx and succeeds', async () => {
    const m = sequence(
      apiError(503, 0, 'down'),
      apiError(500, 0, 'oops'),
      json(200, [{ DeviceName: 'A' }]),
    );
    const res = await make(m.fetch).getDevices();
    expect(res).toHaveLength(1);
    expect(m.calls).toHaveLength(3);
  });

  it('exhausts the retries (maxRetries=2 -> 3 attempts) and throws the last error', async () => {
    const m = sequence(apiError(500, 0, 'oops'));
    const err = (await make(m.fetch)
      .getDevices()
      .catch((e: unknown) => e)) as VidSignerError;
    expect(err.httpStatus).toBe(500);
    expect(m.calls).toHaveLength(3);
  });

  it('does NOT retry 4xx', async () => {
    for (const status of [400, 401, 403, 404, 409, 429]) {
      const m = sequence(apiError(status, 1, 'x'));
      await make(m.fetch)
        .getDevices()
        .catch(() => undefined);
      expect(m.calls, `status ${status}`).toHaveLength(1);
    }
  });

  it('retries network errors', async () => {
    const m = sequence(networkError(), networkError(), json(200, []));
    expect(await make(m.fetch).getDevices()).toEqual([]);
    expect(m.calls).toHaveLength(3);
  });

  it('persistent network error -> kind network', async () => {
    const m = sequence(networkError('ECONNRESET'));
    const err = (await make(m.fetch)
      .getDevices()
      .catch((e: unknown) => e)) as VidSignerError;
    expect(err.kind).toBe('network');
    expect(err.retryable).toBe(true);
  });

  it('a timeout aborts the request and is reported as timeout', async () => {
    const m = mockFetch(
      (_call) => new Promise<Response>(() => undefined), // never responds
    );
    const impl: typeof fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => {
        void m.fetch(input, init);
        init?.signal?.addEventListener('abort', () =>
          rej(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      })) as typeof fetch;
    const c = make(impl, { timeoutMs: 20, maxRetries: 1 });
    const err = (await c.getDevices().catch((e: unknown) => e)) as VidSignerError;
    expect(err.kind).toBe('timeout');
    expect(m.calls).toHaveLength(2); // 1 attempt + 1 retry
  });

  it('creating POSTs (createDocument) are NOT retried on 5xx or network errors', async () => {
    const doc = { SignersGroups: [{ Signers: [{ SignatureType: 'emailandsms' as const }] }] };
    const m5 = mockFetch((call) =>
      call.url.endsWith('/oauth/token')
        ? json(200, { access_token: 'T', expires_in: '3600' })
        : apiError(500, 0, 'x'),
    );
    await make(m5.fetch, JWT)
      .createDocument(doc, 'JVBERi0=')
      .catch(() => undefined);
    expect(m5.calls.filter((c) => c.url.endsWith('/documents'))).toHaveLength(1);

    const mN = mockFetch((call) =>
      call.url.endsWith('/oauth/token')
        ? json(200, { access_token: 'T', expires_in: '3600' })
        : networkError(),
    );
    await make(mN.fetch, JWT)
      .createDocument(doc, 'JVBERi0=')
      .catch(() => undefined);
    expect(mN.calls.filter((c) => c.url.endsWith('/documents'))).toHaveLength(1);
  });

  it('real notices (PUT vidremoteurl, close batch, reminders) are not retried either', async () => {
    const m = mockFetch((call) =>
      call.url.endsWith('/oauth/token')
        ? json(200, { access_token: 'T', expires_in: '3600' })
        : apiError(502, 0, 'x'),
    );
    const c = make(m.fetch, JWT);
    await c.sendSignatureRemoteUrl('s', { Channel: 'email' }).catch(() => undefined);
    await c.closeBatch('b').catch(() => undefined);
    await c.sendEDeliveryReminder('e', { Channel: 'email' }).catch(() => undefined);
    expect(m.calls.filter((x) => !x.url.endsWith('/oauth/token'))).toHaveLength(3);
  });

  it('DELETEs are retried (idempotent)', async () => {
    const m = mockFetch((call) =>
      call.url.endsWith('/oauth/token')
        ? json(200, { access_token: 'T', expires_in: '3600' })
        : call.method === 'DELETE' && m.calls.filter((x) => x.method === 'DELETE').length < 2
          ? apiError(500, 0, 'x')
          : json(204),
    );
    await make(m.fetch, JWT).deleteDocument('d');
    expect(m.calls.filter((x) => x.method === 'DELETE')).toHaveLength(2);
  });
});

describe('requests', () => {
  it('encodes path parameters and uses the given base URL', async () => {
    const m = sequence(json(200, {}));
    await make(m.fetch, { baseUrl: 'https://example.test/api/v3.0/' }).getDocumentInfo('a b/c');
    expect(m.calls[0]?.url).toBe('https://example.test/api/v3.0/documentinfo/a%20b%2Fc');
  });

  it('pro environment uses the production URL', async () => {
    const m = sequence(json(200, []));
    await make(m.fetch, { environment: 'pro' }).getDevices();
    expect(m.calls[0]?.url).toBe('https://vidsignercloud.validatedid.com/api/v3.0/devices');
  });

  it('createDocument encodes the content as base64 and preserves the body', async () => {
    const m = mockFetch((c) =>
      c.url.endsWith('/oauth/token')
        ? json(200, { access_token: 'T' })
        : json(200, { DocGUI: 'doc-1' }),
    );
    const res = await make(m.fetch, JWT).createDocument(
      {
        FileName: 'a.pdf',
        SignersGroups: [{ Signers: [{ SignatureType: 'emailandsms', SkipSignatureEmail: true }] }],
      },
      Buffer.from('%PDF-1.4 hello'),
    );
    expect(res.DocGUI).toBe('doc-1');
    const body = JSON.parse(m.calls.at(-1)?.body ?? '{}') as Record<string, unknown>;
    expect(body['DocContent']).toBe(Buffer.from('%PDF-1.4 hello').toString('base64'));
    expect(JSON.stringify(body['SignersGroups'])).toContain('SkipSignatureEmail');
  });

  it('closeBatch sends {"Status":"close"} and updateSignerData wraps in SignerData', async () => {
    const m = mockFetch((c) =>
      c.url.endsWith('/oauth/token') ? json(200, { access_token: 'T' }) : json(204),
    );
    const c = make(m.fetch, JWT);
    await c.closeBatch('b1');
    await c.updateSignerData('s1', { email: 'a@example.test' });
    const bodies = m.calls.filter((x) => x.method === 'PUT').map((x) => JSON.parse(x.body ?? '{}'));
    expect(bodies).toEqual([{ Status: 'close' }, { SignerData: { email: 'a@example.test' } }]);
  });

  it('listDocumentsByDevice builds the minutesold gt N filter', async () => {
    const m = sequence(json(200, []));
    await make(m.fetch).listDocumentsByDevice('Tab 1', 5);
    expect(m.calls[0]?.url).toContain('device=Tab+1');
    expect(decodeURIComponent(m.calls[0]?.url ?? '')).toContain('filter=minutesold+gt+5');
    await expect(make(m.fetch).listDocumentsByDevice('x', -1)).rejects.toThrow(/integer/);
  });
});
