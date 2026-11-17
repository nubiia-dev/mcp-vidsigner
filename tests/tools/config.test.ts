import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, defaultInputDir, loadConfig } from '../../src/config.js';

const base = { VIDSIGNER_SUBSCRIPTION_NAME: 'S', VIDSIGNER_SUBSCRIPTION_PASS: 'P' };
const load = (env: Record<string, string>) => loadConfig({ ...base, ...env } as NodeJS.ProcessEnv);

describe('config: environment and security defaults', () => {
  it('defaults to pre, with writes and mark-as-downloaded allowed, and no destructive or management tools', () => {
    const c = load({});
    expect(c.security).toEqual({
      environment: 'pre',
      allowWrite: true,
      allowDestructive: false,
      allowMarkDownloaded: true,
      allowSigningLinks: true,
      allowCredentialReads: true,
      enableMgmt: false,
    });
    expect(c.baseUrl).toBe('https://pre-vidsignercloud.validatedid.com/api/v3.0');
    expect(c.mgmtBaseUrl).toBe('https://pre-vidsignercloudmgmt.validatedid.com/api');
  });

  it('pro is read-only by default', () => {
    const c = load({ VIDSIGNER_ENV: 'pro' });
    expect(c.security).toEqual({
      environment: 'pro',
      allowWrite: false,
      allowDestructive: false,
      allowMarkDownloaded: false,
      allowSigningLinks: false,
      allowCredentialReads: false,
      enableMgmt: false,
    });
    expect(c.baseUrl).toBe('https://vidsignercloud.validatedid.com/api/v3.0');
    expect(c.mgmtBaseUrl).toBe('https://vidsignercloudmgmt.validatedid.com/api');
  });

  it('explicit flags override the environment', () => {
    const pro = load({
      VIDSIGNER_ENV: 'pro',
      VIDSIGNER_ALLOW_WRITE: 'true',
      VIDSIGNER_ALLOW_DESTRUCTIVE: '1',
      VIDSIGNER_ALLOW_MARK_DOWNLOADED: 'true',
      VIDSIGNER_ENABLE_MGMT: 'true',
    });
    expect(pro.security).toMatchObject({
      allowWrite: true,
      allowDestructive: true,
      allowMarkDownloaded: true,
      enableMgmt: true,
    });
    const pre = load({
      VIDSIGNER_ENV: 'pre',
      VIDSIGNER_ALLOW_WRITE: 'false',
      VIDSIGNER_ALLOW_MARK_DOWNLOADED: 'false',
      VIDSIGNER_ALLOW_SIGNING_LINKS: 'false',
    });
    expect(pre.security).toMatchObject({
      allowWrite: false,
      allowMarkDownloaded: false,
      allowSigningLinks: false,
    });
    expect(
      load({ VIDSIGNER_ENV: 'pro', VIDSIGNER_ALLOW_SIGNING_LINKS: 'true' }).security
        .allowSigningLinks,
    ).toBe(true);
  });

  it('VIDSIGNER_ALLOW_CREDENTIAL_READS is independent of ALLOW_SIGNING_LINKS', () => {
    const pro = (extra: Record<string, string>) =>
      load({ VIDSIGNER_ENV: 'pro', ...extra }).security;
    expect(pro({ VIDSIGNER_ALLOW_SIGNING_LINKS: 'true' }).allowCredentialReads).toBe(false);
    expect(pro({ VIDSIGNER_ALLOW_CREDENTIAL_READS: 'true' })).toMatchObject({
      allowCredentialReads: true,
      allowSigningLinks: false,
    });
    expect(load({ VIDSIGNER_ENV: 'pre' }).security.allowCredentialReads).toBe(true);
    expect(
      load({ VIDSIGNER_ENV: 'pre', VIDSIGNER_ALLOW_CREDENTIAL_READS: 'false' }).security
        .allowCredentialReads,
    ).toBe(false);
  });

  it('warns in a pro config with SIGNING_LINKS and MGMT but without ALLOW_CREDENTIAL_READS', () => {
    const base = { VIDSIGNER_ENV: 'pro', VIDSIGNER_ALLOW_SIGNING_LINKS: 'true' };
    const msg = /require VIDSIGNER_ALLOW_CREDENTIAL_READS=true.*tools are disabled/i;
    expect(load({ ...base, VIDSIGNER_ENABLE_MGMT: 'true' }).warnings.join(' ')).toMatch(msg);
    // Without management there is nothing to warn about; with the credential-reads flag (set either way) neither; it does not apply in pre.
    expect(load(base).warnings).toEqual([]);
    expect(
      load({
        ...base,
        VIDSIGNER_ENABLE_MGMT: 'true',
        VIDSIGNER_ALLOW_CREDENTIAL_READS: 'false',
      }).warnings,
    ).toEqual([]);
    expect(
      load({
        VIDSIGNER_ENV: 'pre',
        VIDSIGNER_ALLOW_SIGNING_LINKS: 'true',
        VIDSIGNER_ENABLE_MGMT: 'true',
      }).warnings,
    ).toEqual([]);
  });

  it('"false" is false (coerce.boolean is not used) and empty uses the default', () => {
    expect(load({ VIDSIGNER_ENV: 'pro', VIDSIGNER_ALLOW_WRITE: 'false' }).security.allowWrite).toBe(
      false,
    );
    expect(load({ VIDSIGNER_ENV: 'pro', VIDSIGNER_ALLOW_WRITE: '' }).security.allowWrite).toBe(
      false,
    );
    expect(load({ VIDSIGNER_ENV: 'pre', VIDSIGNER_ALLOW_WRITE: '' }).security.allowWrite).toBe(
      true,
    );
  });

  it('accepts yes, 1 and no as booleans and rejects the Spanish "si"/"sí"', () => {
    const allow = (v: string) => load({ VIDSIGNER_ENV: 'pro', VIDSIGNER_ALLOW_WRITE: v });
    expect(allow('yes').security.allowWrite).toBe(true);
    expect(allow('1').security.allowWrite).toBe(true);
    expect(allow('no').security.allowWrite).toBe(false);
    for (const v of ['si', 'sí']) {
      expect(() => allow(v)).toThrow(ConfigError);
      expect(() => allow(v)).toThrow(/invalid boolean value/);
    }
  });

  it('rejects invalid values', () => {
    expect(() => load({ VIDSIGNER_ENV: 'staging' })).toThrow(ConfigError);
    expect(() => load({ VIDSIGNER_ALLOW_WRITE: 'maybe' })).toThrow(/boolean/);
    expect(() => load({ VIDSIGNER_TIMEOUT_MS: '5' })).toThrow(ConfigError);
  });
});

describe('config: base URL and consistency with the environment', () => {
  it('accepts a local server only with VIDSIGNER_ALLOW_LOCAL_HOSTS=true and in pre', () => {
    const local = { VIDSIGNER_ALLOW_LOCAL_HOSTS: 'true' };
    expect(load({ ...local, VIDSIGNER_BASE_URL: 'http://localhost:9999/api/v3.0/' }).baseUrl).toBe(
      'http://localhost:9999/api/v3.0',
    );
    expect(load({ ...local, VIDSIGNER_BASE_URL: 'http://127.0.0.1:9999/api/v3.0' }).baseUrl).toBe(
      'http://127.0.0.1:9999/api/v3.0',
    );
    expect(
      load({ ...local, VIDSIGNER_MGMT_BASE_URL: 'http://localhost:9998/api' }).mgmtBaseUrl,
    ).toBe('http://localhost:9998/api');
    // Without the flag nothing else is enough (not even NODE_ENV=test).
    expect(() => load({ VIDSIGNER_BASE_URL: 'http://localhost:9999/api/v3.0' })).toThrow(
      /is not an allowed VIDsigner host/,
    );
    expect(() =>
      load({ NODE_ENV: 'test', VIDSIGNER_BASE_URL: 'http://localhost:9999/api/v3.0' }),
    ).toThrow(/is not an allowed VIDsigner host/);
    // In production the flag is an error, it is not ignored.
    expect(() => load({ VIDSIGNER_ENV: 'pro', ...local })).toThrow(
      /is only valid with VIDSIGNER_ENV=pre/,
    );
    // The flag only opens localhost and 127.0.0.1, not any host.
    expect(() =>
      load({ ...local, VIDSIGNER_BASE_URL: 'https://evil.example.com/api/v3.0' }),
    ).toThrow(/is not an allowed VIDsigner host/);
  });

  it('keeps the REST and management hosts separate', () => {
    expect(() =>
      load({ VIDSIGNER_MGMT_BASE_URL: 'https://pre-vidsignercloud.validatedid.com/api' }),
    ).toThrow(/signing API/);
    expect(() =>
      load({ VIDSIGNER_BASE_URL: 'https://pre-vidsignercloudmgmt.validatedid.com/api/v3.0' }),
    ).toThrow(/management API/);
  });

  it.each([
    ['http://', 'http://pre-vidsignercloud.validatedid.com/api/v3.0', /https:/],
    ['ftp://', 'ftp://pre-vidsignercloud.validatedid.com/api/v3.0', /https:/],
    ['userinfo', 'https://u:p@pre-vidsignercloud.validatedid.com/api/v3.0', /username or password/],
    [
      'username only',
      'https://u@pre-vidsignercloud.validatedid.com/api/v3.0',
      /username or password/,
    ],
    ['no path', 'https://pre-vidsignercloud.validatedid.com', /\/api\/v3\.0/],
    ['management path', 'https://pre-vidsignercloud.validatedid.com/api', /\/api\/v3\.0/],
    ['path with prefix', 'https://pre-vidsignercloud.validatedid.com/x/api/v3.0', /\/api\/v3\.0/],
    [
      'path with suffix',
      'https://pre-vidsignercloud.validatedid.com/api/v3.0/extra',
      /\/api\/v3\.0/,
    ],
    ['other version', 'https://pre-vidsignercloud.validatedid.com/api/v9.9', /\/api\/v3\.0/],
    ['query', 'https://pre-vidsignercloud.validatedid.com/api/v3.0?x=1', /query/],
    ['fragment', 'https://pre-vidsignercloud.validatedid.com/api/v3.0#x', /fragment/],
    ['port', 'https://pre-vidsignercloud.validatedid.com:8443/api/v3.0', /port/],
  ])('VIDSIGNER_BASE_URL with %s is rejected', (_n, url, msg) => {
    expect(() => load({ VIDSIGNER_BASE_URL: url })).toThrow(msg);
  });

  it.each([
    ['http://', 'http://pre-vidsignercloudmgmt.validatedid.com/api', /https:/],
    ['userinfo', 'https://u:p@pre-vidsignercloudmgmt.validatedid.com/api', /username or password/],
    ['no path', 'https://pre-vidsignercloudmgmt.validatedid.com', /\/api/],
    ['signing path', 'https://pre-vidsignercloudmgmt.validatedid.com/api/v3.0', /\/api/],
  ])('VIDSIGNER_MGMT_BASE_URL with %s is rejected', (_n, url, msg) => {
    expect(() => load({ VIDSIGNER_MGMT_BASE_URL: url })).toThrow(msg);
  });

  it('accepts the canonical URL, with a trailing slash, uppercase, trailing dot and port 443', () => {
    const h = 'pre-vidsignercloud.validatedid.com';
    for (const url of [
      `https://${h}/api/v3.0`,
      `https://${h}/api/v3.0/`,
      `https://${h.toUpperCase()}/api/v3.0`,
      `https://${h}:443/api/v3.0`,
      `  https://${h}/api/v3.0  `,
    ]) {
      expect(load({ VIDSIGNER_BASE_URL: url }).baseUrl, url).toBe(`https://${h}/api/v3.0`);
    }
  });

  it('the canonical base URL does not keep the trailing dot of the host (REST and management)', () => {
    const rest = 'pre-vidsignercloud.validatedid.com';
    const mgmt = 'pre-vidsignercloudmgmt.validatedid.com';
    for (const host of [`${rest}.`, `${rest}..`, rest.replace(/\.com$/, '。com'), `${rest}。`]) {
      expect(load({ VIDSIGNER_BASE_URL: `https://${host}/api/v3.0` }).baseUrl, host).toBe(
        `https://${rest}/api/v3.0`,
      );
    }
    for (const host of [`${mgmt}.`, `${mgmt.toUpperCase()}.`]) {
      expect(load({ VIDSIGNER_MGMT_BASE_URL: `https://${host}/api/` }).mgmtBaseUrl, host).toBe(
        `https://${mgmt}/api`,
      );
    }
    // The canonical value is the one the client uses: the host never ends in a dot.
    const c = load({ VIDSIGNER_BASE_URL: `https://${rest}./api/v3.0` });
    expect(new URL(c.baseUrl).hostname.endsWith('.')).toBe(false);
  });

  it('a local host keeps its port and scheme in the canonical URL', () => {
    const c = load({
      VIDSIGNER_ALLOW_LOCAL_HOSTS: 'true',
      VIDSIGNER_BASE_URL: 'http://localhost.:8080/api/v3.0',
    });
    expect(c.baseUrl).toBe('http://localhost:8080/api/v3.0');
  });

  it('the host is validated against an exact allowlist: trailing dot, uppercase and foreign hosts', () => {
    // The trailing dot of an FQDN does not let the other environment's host through.
    expect(() =>
      load({
        VIDSIGNER_ENV: 'pre',
        VIDSIGNER_BASE_URL: 'https://vidsignercloud.validatedid.com./api/v3.0',
      }),
    ).toThrow(/the production host/);
    expect(() =>
      load({
        VIDSIGNER_ENV: 'pre',
        VIDSIGNER_MGMT_BASE_URL: 'https://VIDSIGNERCLOUDMGMT.validatedid.com./api',
      }),
    ).toThrow(/the production host/);
    expect(() =>
      load({
        VIDSIGNER_ENV: 'pro',
        VIDSIGNER_BASE_URL: 'https://pre-vidsignercloud.validatedid.com./api/v3.0',
      }),
    ).toThrow(/pre-production host/);
    // A foreign host is not accepted even if it is not the other environment's.
    expect(() =>
      load({ VIDSIGNER_ENV: 'pre', VIDSIGNER_BASE_URL: 'https://evil.example.com/api/v3.0' }),
    ).toThrow(/is not an allowed VIDsigner host/);
    expect(() =>
      load({
        VIDSIGNER_ENV: 'pre',
        VIDSIGNER_BASE_URL: 'https://pre-vidsignercloud.validatedid.com.evil.com/api/v3.0',
      }),
    ).toThrow(/is not an allowed VIDsigner host/);
    // Legitimate URLs, with a trailing dot or uppercase, are accepted.
    expect(
      load({
        VIDSIGNER_ENV: 'pre',
        VIDSIGNER_BASE_URL: 'https://PRE-vidsignercloud.validatedid.com./api/v3.0',
      }).baseUrl,
    ).toContain('validatedid.com');
  });

  it('rejects VIDSIGNER_ENV=pre pointing to the production host (and vice versa)', () => {
    expect(() =>
      load({
        VIDSIGNER_ENV: 'pre',
        VIDSIGNER_BASE_URL: 'https://vidsignercloud.validatedid.com/api/v3.0',
      }),
    ).toThrow(/the production host/);
    expect(() =>
      load({
        VIDSIGNER_ENV: 'pre',
        VIDSIGNER_MGMT_BASE_URL: 'https://vidsignercloudmgmt.validatedid.com/api',
      }),
    ).toThrow(/the production host/);
    expect(() =>
      load({
        VIDSIGNER_ENV: 'pro',
        VIDSIGNER_BASE_URL: 'https://pre-vidsignercloud.validatedid.com/api/v3.0',
      }),
    ).toThrow(/pre-production host/);
  });

  it('rejects an invalid URL', () => {
    expect(() => load({ VIDSIGNER_BASE_URL: 'not-a-url' })).toThrow(/URL/);
  });
});

describe('config: credentials and files', () => {
  it('management credentials fall back to the signing ones when not provided', () => {
    const c = load({ VIDSIGNER_CLIENT_ID: 'a', VIDSIGNER_CLIENT_SECRET: 'b' });
    expect(c.mgmt).toMatchObject({ clientId: 'a', clientSecret: 'b' });
    const d = load({
      VIDSIGNER_CLIENT_ID: 'a',
      VIDSIGNER_CLIENT_SECRET: 'b',
      VIDSIGNER_MGMT_CLIENT_ID: 'm',
      VIDSIGNER_MGMT_CLIENT_SECRET: 'n',
    });
    expect(d.mgmt).toMatchObject({ clientId: 'm', clientSecret: 'n' });
  });

  it('input folders and upload limit', () => {
    const c = load({
      VIDSIGNER_ALLOWED_INPUT_DIRS: '/a, /b ,',
      VIDSIGNER_MAX_UPLOAD_MB: '5',
      VIDSIGNER_OUTPUT_DIR: '/tmp/out',
    });
    expect(c.files.allowedInputDirs).toEqual(['/a', '/b']);
    expect(c.files.maxUploadBytes).toBe(5 * 1024 * 1024);
    expect(c.files.outputDir).toBe('/tmp/out');
  });

  it('empty strings count as not provided', () => {
    const c = load({ VIDSIGNER_CLIENT_ID: '  ', VIDSIGNER_CLIENT_SECRET: '' });
    expect(c.clientId).toBeUndefined();
    expect(c.clientSecret).toBeUndefined();
  });
});

describe('config: mandatory input folder (anti-exfiltration)', () => {
  it('when unset it uses a dedicated working folder, never the whole disk', () => {
    const c = load({});
    expect(c.files.allowedInputDirs).toEqual([join(homedir(), 'vidsigner-mcp', 'in')]);
    expect(c.files.allowedInputDirs).toEqual([defaultInputDir()]);
  });

  it('rejects the disk root and the home directory', () => {
    expect(() => load({ VIDSIGNER_ALLOWED_INPUT_DIRS: '/' })).toThrow(/whole disk/);
    expect(() => load({ VIDSIGNER_ALLOWED_INPUT_DIRS: homedir() })).toThrow(/whole disk/);
    expect(() => load({ VIDSIGNER_ALLOWED_INPUT_DIRS: '/tmp/ok, /' })).toThrow(ConfigError);
    expect(() => load({ VIDSIGNER_ALLOWED_INPUT_DIRS: join(homedir(), 'docs') })).not.toThrow();
  });
});

describe('config: ~ paths and absolute paths', () => {
  it('expands ~ and ~/ in the input folders and in the output folder', () => {
    const c = load({
      VIDSIGNER_ALLOWED_INPUT_DIRS: '~/vidsigner-mcp/in, ~/other',
      VIDSIGNER_OUTPUT_DIR: '~/vidsigner-mcp/out',
    });
    expect(c.files.allowedInputDirs).toEqual([
      join(homedir(), 'vidsigner-mcp', 'in'),
      join(homedir(), 'other'),
    ]);
    expect(c.files.outputDir).toBe(join(homedir(), 'vidsigner-mcp', 'out'));
  });

  it('a bare ~ (the whole home directory) is still rejected as an input folder', () => {
    expect(() => load({ VIDSIGNER_ALLOWED_INPUT_DIRS: '~' })).toThrow(/whole disk/);
    expect(() => load({ VIDSIGNER_ALLOWED_INPUT_DIRS: '~/' })).toThrow(/whole disk/);
  });

  it.each(['.', 'relative/folder', '../fuera', '~otheruser/x', '$HOME/x'])(
    'rejects the non-absolute path %j after expansion',
    (dir) => {
      expect(() => load({ VIDSIGNER_ALLOWED_INPUT_DIRS: dir })).toThrow(/is not an absolute path/);
      expect(() => load({ VIDSIGNER_OUTPUT_DIR: dir })).toThrow(/is not an absolute path/);
    },
  );

  it('the default output is still absolute', () => {
    expect(load({}).files.outputDir).toMatch(/^\//);
  });
});

describe('config: recipient allowlists', () => {
  it('empty by default (no restriction)', () => {
    expect(load({}).recipients).toEqual({
      emailDomains: [],
      phonePrefixes: [],
      notificationHosts: [],
      assetHosts: [],
      allowLocalHosts: false,
    });
  });

  it('are read lowercased and without empty entries', () => {
    const c = load({
      VIDSIGNER_ALLOWED_EMAIL_DOMAINS: 'Example.com, *.Example.com ,',
      VIDSIGNER_ALLOWED_PHONE_PREFIXES: '+34, +351',
      VIDSIGNER_ALLOWED_NOTIFICATION_HOSTS: 'Hooks.example.com',
      VIDSIGNER_ALLOWED_ASSET_HOSTS: 'CDN.example.com, ,*.static.example.com',
    });
    expect(c.recipients).toEqual({
      emailDomains: ['example.com', '*.example.com'],
      phonePrefixes: ['+34', '+351'],
      notificationHosts: ['hooks.example.com'],
      assetHosts: ['cdn.example.com', '*.static.example.com'],
      allowLocalHosts: false,
    });
  });
});
