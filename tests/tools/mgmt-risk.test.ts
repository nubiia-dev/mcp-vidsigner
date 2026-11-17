import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_TOOLS } from '../../src/tools/index.js';
import { startHarness } from '../helpers/mcp.js';
import { VidSignerError, type VidSignerErrorKind } from '../../src/client/errors.js';
import { isAmbiguousFailure } from '../../src/tools/mgmt/subscriptions.js';
import { json, mockFetch, networkError, token } from '../helpers/mock-fetch.js';

const MGMT_ENV = {
  VIDSIGNER_ENABLE_MGMT: 'true',
  VIDSIGNER_ALLOW_DESTRUCTIVE: 'true',
  VIDSIGNER_CLIENT_ID: 'cid',
  VIDSIGNER_CLIENT_SECRET: 'csecret-xyz',
  VIDSIGNER_MGMT_PARTNER_USER: 'padmin',
  VIDSIGNER_MGMT_PARTNER_PASS: 'partner-pass-1',
};

const CHANNELS = {
  BIO: { Enabled: false, SignaturesLimit: 0, SignaturesLimitPeriod: 0, DevicesLimit: 0 },
  Remote: { Enabled: true, SignaturesLimit: 100, SignaturesLimitPeriod: 12 },
  ViDMobile: {
    Enabled: false,
    Domain: '',
    SignaturesLimit: 0,
    SignaturesLimitPeriod: 0,
    UsersLimit: 0,
  },
  Stamper: { Enabled: false, SignaturesLimit: 0, SignaturesLimitPeriod: 0, CertificatesLimit: 0 },
};
const CURRENT_PASS = 'CURRENT-PASS-20-CHRS';

describe('management operations equivalent to removing the account', () => {
  it.each([
    'vidsigner_mgmt_update_vidmobile_user_password',
    'vidsigner_mgmt_update_vidmobile_user_email',
    'vidsigner_mgmt_set_subscription_status',
    'vidsigner_mgmt_update_subscription',
    'vidsigner_mgmt_set_vidmobile_user_state',
  ])('%s is destructive', (name) => {
    expect(ALL_TOOLS.find((t) => t.name === name)?.risk).toBe('destructive');
  });

  it('with ALLOW_WRITE but without ALLOW_DESTRUCTIVE those five are not registered', async () => {
    const h = await startHarness({
      env: { ...MGMT_ENV, VIDSIGNER_ALLOW_DESTRUCTIVE: 'false' },
      fetch: mockFetch(() => json(200, {})).fetch,
    });
    const names = await h.toolNames();
    expect(names).not.toContain('vidsigner_mgmt_update_subscription');
    expect(names).not.toContain('vidsigner_mgmt_update_vidmobile_user_password');
    expect(names).toContain('vidsigner_mgmt_update_customer');
  });
});

describe('update_subscription neither receives nor returns the password', () => {
  const setup = () => {
    const m = mockFetch((c) => {
      if (c.url.endsWith('/oauth/token')) return token('T');
      if (c.method === 'GET')
        return json(200, {
          SubscriptionGUID: 'g1',
          SubscriptionName: 'sub-name-01',
          SubscriptionPass: CURRENT_PASS,
          Active: true,
          SignatureChannels: CHANNELS,
        });
      return json(200, {
        SubscriptionGUID: 'g1',
        SubscriptionName: 'sub-name-01',
        SubscriptionPass: JSON.parse(c.body ?? '{}').SubscriptionPass,
        Active: true,
        SignatureChannels: CHANNELS,
      });
    });
    return m;
  };
  const args = {
    subscriptionGuid: 'g1',
    SubscriptionName: 'sub-name-01',
    Active: true,
    SignatureChannels: CHANNELS,
  };

  it('the schema has no SubscriptionPass', async () => {
    const h = await startHarness({ env: MGMT_ENV, fetch: setup().fetch });
    const tool = (await h.client.listTools()).tools.find(
      (t) => t.name === 'vidsigner_mgmt_update_subscription',
    );
    expect(Object.keys(tool?.inputSchema.properties ?? {})).not.toContain('SubscriptionPass');
    expect(Object.keys(tool?.inputSchema.properties ?? {})).toContain('rotatePassword');
  });

  it('by default re-sends the current password (read server-side) and does not return it', async () => {
    const m = setup();
    const h = await startHarness({ env: MGMT_ENV, fetch: m.fetch });
    const r = await h.call('vidsigner_mgmt_update_subscription', args);
    expect(r.isError).toBe(false);
    const put = m.calls.find((c) => c.method === 'PUT');
    expect(JSON.parse(put?.body ?? '{}').SubscriptionPass).toBe(CURRENT_PASS);
    expect(r.text).not.toContain(CURRENT_PASS);
    expect(r.text).toContain('[hidden]');
  });

  it('with rotatePassword it generates a new one, saves it as 0600 and returns only the path', async () => {
    const m = setup();
    const h = await startHarness({ env: MGMT_ENV, fetch: m.fetch });
    const r = await h.call('vidsigner_mgmt_update_subscription', { ...args, rotatePassword: true });
    expect(r.isError).toBe(false);
    const put = m.calls.find((c) => c.method === 'PUT');
    const sent = JSON.parse(put?.body ?? '{}').SubscriptionPass as string;
    expect(sent).toHaveLength(20);
    expect(sent).not.toBe(CURRENT_PASS);
    expect(m.calls.some((c) => c.method === 'GET')).toBe(false);
    const path = (r.json as { credentialsSavedTo: string }).credentialsSavedTo;
    expect(JSON.parse(readFileSync(path, 'utf8')).SubscriptionPass).toBe(sent);
    expect(r.text).not.toContain(sent);
  });

  it('successful rotation: warns that it invalidates the credentials of the MCP and other consumers', async () => {
    const h = await startHarness({ env: MGMT_ENV, fetch: setup().fetch });
    const r = await h.call('vidsigner_mgmt_update_subscription', { ...args, rotatePassword: true });
    const warning = (r.json as { warning: string }).warning;
    expect(warning).toMatch(/VIDSIGNER_SUBSCRIPTION_PASS/);
    expect(warning).toMatch(/other consumer of the same credentials/);
    expect(warning).toMatch(/401/);
  });

  it('with a non-writable outputDir it does NOT send the PUT and the password is unchanged', async () => {
    const blocker = join(mkdtempSync(join(tmpdir(), 'rot-')), 'is-a-file');
    writeFileSync(blocker, 'x');
    const m = setup();
    const h = await startHarness({
      env: { ...MGMT_ENV, VIDSIGNER_OUTPUT_DIR: join(blocker, 'sub') },
      fetch: m.fetch,
    });
    const r = await h.call('vidsigner_mgmt_update_subscription', { ...args, rotatePassword: true });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/VIDSIGNER_OUTPUT_DIR/);
    expect(r.text).toMatch(/No changes were made/);
    expect(m.calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  });

  it('the file is saved BEFORE the PUT; if the PUT fails it is renamed to .failed and the user is warned', async () => {
    const m = mockFetch((c) => {
      if (c.url.endsWith('/oauth/token')) return token('T');
      if (c.method === 'PUT') {
        // At PUT time the candidate password is already on disk.
        const sent = JSON.parse(c.body ?? '{}').SubscriptionPass as string;
        expect(readdirSync(h.outputDir).some((f) => f.endsWith('-credentials.json'))).toBe(true);
        expect(
          readFileSync(
            join(h.outputDir, readdirSync(h.outputDir).find((f) => f.endsWith('.json')) as string),
            'utf8',
          ),
        ).toContain(sent);
        return json(400, { Error: { Code: 10000, Message: 'rejected', Details: '' } });
      }
      return json(200, {});
    });
    const h = await startHarness({ env: MGMT_ENV, fetch: m.fetch });
    const r = await h.call('vidsigner_mgmt_update_subscription', { ...args, rotatePassword: true });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/NOT applied/);
    expect(r.text).toMatch(/\.failed/);
    const files = readdirSync(h.outputDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/-credentials\.json\.failed$/);
    expect(existsSync(join(h.outputDir, files[0] as string))).toBe(true);
  });

  describe('the rotation failure message distinguishes a clear rejection from an ambiguous failure', () => {
    const rotate = async (
      put: (dir: string) => ReturnType<typeof json> | Error,
      beforeReturn?: (dir: string) => void,
    ) => {
      let dir = '';
      const m = mockFetch((c) => {
        if (c.url.endsWith('/oauth/token')) return token('T');
        if (c.method === 'PUT') {
          beforeReturn?.(dir);
          return put(dir);
        }
        return json(200, {});
      });
      const h = await startHarness({ env: MGMT_ENV, fetch: m.fetch });
      dir = h.outputDir;
      const r = await h.call('vidsigner_mgmt_update_subscription', {
        ...args,
        rotatePassword: true,
      });
      return { r, dir };
    };

    it('4xx: says it was not applied and that the file can be deleted', async () => {
      const { r } = await rotate(() =>
        json(400, { Error: { Code: 10000, Message: 'rejected', Details: '' } }),
      );
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/The new password was NOT applied/);
      expect(r.text).toMatch(/You can delete it/);
      expect(r.text).not.toMatch(/It is unknown whether/);
    });

    it('5xx: opens with "It is unknown whether the password was applied. Do NOT delete the file"', async () => {
      const { r, dir } = await rotate(() =>
        json(500, { Error: { Code: 0, Message: 'boom', Details: '' } }),
      );
      expect(r.isError).toBe(true);
      const message = (r.json as { message: string }).message;
      expect(message).toContain(
        'It is unknown whether the password was applied. Do NOT delete the file',
      );
      expect(message).not.toMatch(/You can delete it/);
      const [file] = readdirSync(dir);
      expect(message).toContain(join(dir, file as string));
    });

    it('network error: the same ambiguous warning', async () => {
      const { r } = await rotate(() => networkError('socket hang up'));
      expect(r.isError).toBe(true);
      expect((r.json as { message: string }).message).toContain(
        'It is unknown whether the password was applied. Do NOT delete the file',
      );
    });

    it('isAmbiguousFailure: network, timeout and 5xx yes; 4xx and validation no', () => {
      const e = (kind: VidSignerErrorKind, httpStatus?: number) =>
        new VidSignerError({ kind, message: 'x', httpStatus });
      expect(isAmbiguousFailure(e('network'))).toBe(true);
      expect(isAmbiguousFailure(e('timeout'))).toBe(true);
      expect(isAmbiguousFailure(e('api', 502))).toBe(true);
      expect(isAmbiguousFailure(e('api', 409))).toBe(false);
      expect(isAmbiguousFailure(e('auth', 401))).toBe(false);
      expect(isAmbiguousFailure(e('validation'))).toBe(false);
    });

    it('if renaming to .failed is not possible, the message gives the real path and does not claim a rename', async () => {
      const { r, dir } = await rotate(
        () => json(500, { Error: { Code: 0, Message: 'boom', Details: '' } }),
        // Without write permission on the folder the rename is impossible (reading still works).
        (d) => chmodSync(d, 0o500),
      );
      try {
        expect(r.isError).toBe(true);
        const message = (r.json as { message: string }).message;
        const [file] = readdirSync(dir);
        expect(file).toMatch(/-credentials\.json$/);
        expect(message).toContain(join(dir, file as string));
        expect(message).toMatch(/is still at/);
        expect(message).not.toMatch(/renamed to/);
        expect(message).not.toMatch(/\.failed"/);
      } finally {
        chmodSync(dir, 0o700);
      }
    });
  });
});
