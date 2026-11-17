import { describe, expect, it } from 'vitest';
import {
  Redactor,
  VidSignerClient,
  VidSignerMgmtClient,
  createLogger,
} from '../../src/client/index.js';
import { apiError, json, mockFetch, noSleep, token } from '../helpers/mock-fetch.js';

const SECRETS = {
  clientId: 'client-id-AAA',
  clientSecret: 'client-secret-BBB-xyz',
  subscriptionName: 'SubscriptionDemoName',
  subscriptionPass: 'sub-pass-CCC-123456',
};
const BIG_B64 = Buffer.alloc(600, 7).toString('base64');

function capture() {
  const lines: string[] = [];
  const redactor = new Redactor();
  for (const v of Object.values(SECRETS)) redactor.addSecret(v);
  const logger = createLogger({ level: 'debug', redactor, write: (l) => lines.push(l) });
  return { lines, logger };
}

describe('a 404 without a code normalized to an empty list leaves a warning', () => {
  const text = (status: number, body: string) => new Response(body, { status });
  const build = (inner: () => Response) => {
    const { lines, logger } = capture();
    const m = mockFetch((c) => (c.url.endsWith('/oauth/token') ? token('T') : inner()));
    const client = new VidSignerClient({ ...SECRETS, fetch: m.fetch, logger, sleep: noSleep });
    return { lines, client };
  };

  it('empty body: warn with the operation and the reason, without the body', async () => {
    const { lines, client } = build(() => text(404, ''));
    expect(await client.listSignedDocuments()).toEqual([]);
    const warn = lines.find((l) => l.includes('404 without code normalized to empty list'));
    expect(warn).toBeDefined();
    expect(warn).toMatch(/signeddocuments\.list/);
    expect(warn).toMatch(/empty body/);
  });

  it('with a catalog code (50002) no warning is needed', async () => {
    const { lines, client } = build(() => apiError(404, 50002, 'The list of documents are empty'));
    expect(await client.getDevices()).toEqual([]);
    expect(lines.some((l) => l.includes('normalized to empty list'))).toBe(false);
  });

  it('a 404 that is a real error is neither normalized nor warned about', async () => {
    const { lines, client } = build(() => text(404, 'Device zzz not found'));
    await expect(client.listSignedDocuments()).rejects.toMatchObject({ httpStatus: 404 });
    expect(lines.some((l) => l.includes('normalized to empty list'))).toBe(false);
  });
});

describe('the logger never records credentials or content', () => {
  it('normal requests and requests with retries', async () => {
    const { lines, logger } = capture();
    let n = 0;
    const m = mockFetch((call) => {
      if (call.url.endsWith('/oauth/token'))
        return token('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.token-signature-123');
      n += 1;
      return n === 1 ? apiError(500, 0, 'transient failure') : json(200, { DocGUI: 'doc-1' });
    });
    const client = new VidSignerClient({
      ...SECRETS,
      fetch: m.fetch,
      logger,
      sleep: noSleep,
      retryBaseDelayMs: 1,
    });
    await client.getDocumentInfo('doc-1');
    await client
      .createDocument(
        {
          FileName: 'x.pdf',
          SignersGroups: [
            {
              Signers: [
                {
                  SignerName: 'Jane Doe',
                  NumberID: '12345678Z',
                  Email: 'jane@example.test',
                  SignatureType: 'emailandsms',
                },
              ],
            },
          ],
        },
        BIG_B64,
      )
      .catch(() => undefined);
    const log = lines.join('\n');
    expect(lines.length).toBeGreaterThan(0);
    for (const secret of Object.values(SECRETS)) expect(log).not.toContain(secret);
    expect(log).not.toContain(
      Buffer.from(`${SECRETS.clientId}:${SECRETS.clientSecret}`).toString('base64'),
    );
    expect(log).not.toContain('token-signature');
    expect(log).not.toContain(BIG_B64.slice(0, 40));
    expect(log).not.toContain('Jane Doe');
    expect(log).not.toContain('12345678Z');
    expect(log).not.toContain('jane@example.test');
    expect(log).not.toMatch(/Bearer\s+\S{8,}/);
  });

  it('does not log the full path (it may carry personal identifiers)', async () => {
    const { lines, logger } = capture();
    const m = mockFetch(() => json(200, []));
    const mgmt = new VidSignerMgmtClient({
      subscriptionName: SECRETS.subscriptionName,
      subscriptionPass: SECRETS.subscriptionPass,
      fetch: m.fetch,
      logger,
    });
    await mgmt.listVidMobileUserCertificates('12345678Z');
    expect(lines.join('\n')).not.toContain('12345678Z');
    expect(lines.join('\n')).toContain('mgmt.vidmobileusers.certs.list');
  });

  it('errors redact the server credentials echo', async () => {
    const m = mockFetch(() =>
      apiError(
        403,
        20103,
        `Invalid Subscription credentials. Authentication header: ${SECRETS.subscriptionName}:${SECRETS.subscriptionPass}`,
      ),
    );
    const client = new VidSignerClient({ ...SECRETS, fetch: m.fetch, sleep: noSleep });
    const err = await client.getDevices().catch((e: unknown) => e as Error);
    expect(String((err as Error).message)).not.toContain(SECRETS.subscriptionPass);
  });
});

describe('Redactor', () => {
  const r = new Redactor();
  r.addBasicPair('user', 'my-secret-pass');

  it('hides registered secrets and their base64 form', () => {
    const pair = Buffer.from('user:my-secret-pass').toString('base64');
    expect(r.redact(`x my-secret-pass y ${pair}`)).toBe('x [REDACTED] y [REDACTED]');
  });

  it('hides headers, JWTs and base64 blobs', () => {
    expect(r.redact('Authorization: Bearer abcdefghijklmnop')).toBe(
      'Authorization: Bearer [REDACTED]',
    );
    expect(r.redact('t=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig_nature')).toContain(
      '[REDACTED_JWT]',
    );
    expect(r.redact(`doc=${BIG_B64}`)).toBe('doc=[REDACTED_BASE64]');
    expect(r.redact('Authentication header: a:b')).toBe('Authentication header: [REDACTED]');
  });

  it('honors the log level', () => {
    const lines: string[] = [];
    const log = createLogger({ level: 'warn', write: (l) => lines.push(l) });
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(lines).toHaveLength(2);
    expect(
      createLogger({ level: 'silent', write: (l) => lines.push(l) }).error('x'),
    ).toBeUndefined();
    expect(lines).toHaveLength(2);
  });
});
