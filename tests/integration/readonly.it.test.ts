/**
 * OPTIONAL integration test against pre-production. READS ONLY.
 *
 * It runs only if:
 *  - VIDSIGNER_IT=1, and
 *  - a .env file with credentials exists (the one in the root, or the one given in VIDSIGNER_IT_ENV_FILE), and
 *  - the resulting environment is `pre`.
 *
 * It never creates documents, sends emails/SMS, deletes, or marks anything as downloaded.
 * It only uses GET /devices, GET /documentlist/* and GET /signeddocuments (list).
 *
 *   VIDSIGNER_IT=1 npm run test:it
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import { describe, expect, it } from 'vitest';
import { VidSignerClient } from '../../src/client/index.js';
import { loadConfig } from '../../src/config.js';

const envFile = resolve(process.env['VIDSIGNER_IT_ENV_FILE'] ?? '.env');
const enabled = process.env['VIDSIGNER_IT'] === '1' && existsSync(envFile);
const vars = enabled ? parse(readFileSync(envFile)) : {};
const hasCreds = !!(vars['VIDSIGNER_SUBSCRIPTION_NAME'] && vars['VIDSIGNER_SUBSCRIPTION_PASS']);
const isPre = (vars['VIDSIGNER_ENV'] ?? 'pre') === 'pre';

describe.skipIf(!enabled || !hasCreds || !isPre)('pre-production integration (read-only)', () => {
  // Built lazily: the describe body is evaluated even if the block is skipped.
  let cached: VidSignerClient | undefined;
  const getClient = (): VidSignerClient => {
    if (cached) return cached;
    const cfg = loadConfig({ ...vars, VIDSIGNER_ENV: 'pre' } as NodeJS.ProcessEnv);
    cached = new VidSignerClient({
      environment: 'pre',
      baseUrl: cfg.baseUrl,
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      subscriptionName: cfg.subscriptionName as string,
      subscriptionPass: cfg.subscriptionPass as string,
      authMode: cfg.clientId ? 'auto' : 'basic',
    });
    return cached;
  };

  it('GET /devices returns a list (empty if there are no tablets)', async () => {
    expect(Array.isArray(await getClient().getDevices())).toBe(true);
  });

  it('GET /documentlist/all with valid pagination returns a page', async () => {
    const page = await getClient().listDocuments('all', { pageNumber: 1, pageSize: 10 });
    expect(Array.isArray(page.items)).toBe(true);
  });

  it('GET /documentlist/unsigned and /signeddocuments (list) do not fail, even if the queue is empty', async () => {
    expect(
      Array.isArray((await getClient().listDocuments('unsigned', { pageSize: 5 })).items),
    ).toBe(true);
    expect(Array.isArray(await getClient().listSignedDocuments())).toBe(true);
  });

  it('orderType asc, des and desc do not give 400/10521 (desc is sent as des)', async () => {
    for (const orderType of ['asc', 'des', 'desc'] as const) {
      const page = await getClient().listDocuments('all', {
        pageNumber: 1,
        pageSize: 2,
        orderBy: 'UploadTime',
        orderType,
      });
      expect(Array.isArray(page.items), orderType).toBe(true);
    }
  });

  it('a base URL with a trailing dot in the host is canonicalized and the GET works', async () => {
    for (const host of [
      'pre-vidsignercloud.validatedid.com.',
      'pre-vidsignercloud.validatedid.com。',
    ]) {
      const cfg = loadConfig({
        ...vars,
        VIDSIGNER_ENV: 'pre',
        VIDSIGNER_BASE_URL: `https://${host}/api/v3.0`,
      } as NodeJS.ProcessEnv);
      expect(cfg.baseUrl).toBe('https://pre-vidsignercloud.validatedid.com/api/v3.0');
      const client = new VidSignerClient({
        environment: 'pre',
        baseUrl: cfg.baseUrl,
        clientId: cfg.clientId,
        clientSecret: cfg.clientSecret,
        subscriptionName: cfg.subscriptionName as string,
        subscriptionPass: cfg.subscriptionPass as string,
        authMode: cfg.clientId ? 'auto' : 'basic',
      });
      expect(Array.isArray(await client.getDevices()), host).toBe(true);
    }
  });

  it('an invalid pageSize is rejected client-side', async () => {
    await expect(getClient().listDocuments('all', { pageSize: 100 })).rejects.toThrow(/pageSize/);
  });
});
