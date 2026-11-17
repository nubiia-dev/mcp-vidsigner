import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join, parse, resolve, sep } from 'node:path';
import { z } from 'zod';
import { VIDSIGNER_BASE_URLS } from './client/vidsigner-client.js';
import { VIDSIGNER_MGMT_BASE_URLS } from './client/mgmt-client.js';
import { trimEnd } from './util/trim.js';

/**
 * Environment boolean. `z.coerce.boolean()` treats "false" as true, so the text is parsed
 * explicitly. Empty or missing -> `undefined` (the default decides).
 */
const envBool = z
  .string()
  .optional()
  .transform((v, ctx) => {
    const t = v?.trim().toLowerCase();
    if (t === undefined || t === '') return undefined;
    if (['true', '1', 'yes'].includes(t)) return true;
    if (['false', '0', 'no'].includes(t)) return false;
    ctx.addIssue({
      code: 'custom',
      message: `invalid boolean value: "${v}" (use true or false)`,
    });
    return z.NEVER;
  });

const optStr = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const EnvSchema = z.object({
  VIDSIGNER_ENV: z.enum(['pre', 'pro']).default('pre'),
  VIDSIGNER_BASE_URL: optStr,
  VIDSIGNER_CLIENT_ID: optStr,
  VIDSIGNER_CLIENT_SECRET: optStr,
  VIDSIGNER_SUBSCRIPTION_NAME: optStr,
  VIDSIGNER_SUBSCRIPTION_PASS: optStr,

  VIDSIGNER_ALLOW_WRITE: envBool,
  VIDSIGNER_ALLOW_DESTRUCTIVE: envBool,
  VIDSIGNER_ALLOW_MARK_DOWNLOADED: envBool,
  VIDSIGNER_ALLOW_SIGNING_LINKS: envBool,
  VIDSIGNER_ALLOW_CREDENTIAL_READS: envBool,

  VIDSIGNER_ENABLE_MGMT: envBool,
  VIDSIGNER_MGMT_BASE_URL: optStr,
  VIDSIGNER_MGMT_CLIENT_ID: optStr,
  VIDSIGNER_MGMT_CLIENT_SECRET: optStr,
  VIDSIGNER_MGMT_PARTNER_USER: optStr,
  VIDSIGNER_MGMT_PARTNER_PASS: optStr,

  VIDSIGNER_OUTPUT_DIR: optStr,
  VIDSIGNER_ALLOWED_INPUT_DIRS: optStr,
  VIDSIGNER_ALLOWED_EMAIL_DOMAINS: optStr,
  VIDSIGNER_ALLOWED_PHONE_PREFIXES: optStr,
  VIDSIGNER_ALLOWED_NOTIFICATION_HOSTS: optStr,
  VIDSIGNER_ALLOWED_ASSET_HOSTS: optStr,
  VIDSIGNER_ALLOW_LOCAL_HOSTS: envBool,
  VIDSIGNER_MAX_UPLOAD_MB: z.coerce.number().positive().max(200).default(20),

  VIDSIGNER_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300_000).default(30_000),
  VIDSIGNER_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(2),
  VIDSIGNER_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
});

/** Names of all environment variables the server reads (the documentation tests require them in the README). */
export const ENV_VAR_NAMES: readonly string[] = Object.keys(EnvSchema.shape);

/** Resolved security gates (see {@link ../tools/policy}). */
export interface SecurityConfig {
  environment: 'pre' | 'pro';
  allowWrite: boolean;
  allowDestructive: boolean;
  allowMarkDownloaded: boolean;
  /** Allows `vidsigner_get_signature_url` (returns the link that lets someone sign). */
  allowSigningLinks: boolean;
  /**
   * Allows the management credential reads: `vidsigner_mgmt_get_vidmobile_user_token`
   * (a VIDmobile user token) and `vidsigner_mgmt_list_enrollment_codes` (device enrollment
   * codes). It is its own flag: `ALLOW_SIGNING_LINKS` does not cover them.
   */
  allowCredentialReads: boolean;
  enableMgmt: boolean;
}

/**
 * Optional recipient allowlists. An empty list means "no restriction".
 * Defining them is recommended in `pro`.
 */
export interface RecipientRules {
  /** Allowed email domains (`example.com`, `*.example.com`). */
  emailDomains: string[];
  /** Allowed phone prefixes (`+34`). */
  phonePrefixes: string[];
  /** Allowed hosts for `NotificationURL` and `returnUrl` (`hooks.example.com`). */
  notificationHosts: string[];
  /**
   * Allowed hosts for the resource URLs that VIDsigner displays or downloads: logos
   * (`Appearance.APP.Logo`, `EmailNotification.CorporateLogo`) and `CustomerURL`. Kept separate
   * from the notification list: a logo CDN is not a webhook destination.
   */
  assetHosts: string[];
  /**
   * `VIDSIGNER_ALLOW_LOCAL_HOSTS=true` (pre only): allows `http://localhost` and
   * `http://127.0.0.1` as the destination of `NotificationURL`/`returnUrl` (webhook testing).
   */
  allowLocalHosts: boolean;
}

export interface Config {
  security: SecurityConfig;
  baseUrl: string;
  mgmtBaseUrl: string;
  clientId?: string;
  clientSecret?: string;
  subscriptionName?: string;
  subscriptionPass?: string;
  mgmt: {
    clientId?: string;
    clientSecret?: string;
    partnerUser?: string;
    partnerPass?: string;
  };
  files: {
    outputDir: string;
    /** Never empty: files are never read outside these folders. */
    allowedInputDirs: string[];
    maxUploadBytes: number;
  };
  recipients: RecipientRules;
  http: { timeoutMs: number; maxRetries: number };
  logLevel: 'debug' | 'info' | 'warn' | 'error' | 'silent';
  /** Configuration warnings for the startup log (e.g. a gate that is likely to be misconfigured). */
  warnings: string[];
}

/**
 * Exact host allowlist per environment and per API. Any other host is rejected: a denylist of the
 * other environment let variants such as `vidsignercloud.validatedid.com.` (trailing dot) or
 * unrelated hosts through. The REST and management hosts are kept separate: pointing one API at
 * the other's host is also rejected.
 */
const ALLOWED_HOSTS = {
  pre: {
    rest: 'pre-vidsignercloud.validatedid.com',
    mgmt: 'pre-vidsignercloudmgmt.validatedid.com',
  },
  pro: { rest: 'vidsignercloud.validatedid.com', mgmt: 'vidsignercloudmgmt.validatedid.com' },
} as const;

/** Exact path of each API, without a trailing slash. */
const API_PATHS = { rest: '/api/v3.0', mgmt: '/api' } as const;

/** Local hosts, only with `VIDSIGNER_ALLOW_LOCAL_HOSTS=true` and `VIDSIGNER_ENV=pre`. */
const LOCAL_HOSTS = ['localhost', '127.0.0.1'];

/** Default input folder: a dedicated working folder, never the whole disk. */
export function defaultInputDir(): string {
  return join(homedir(), 'vidsigner-mcp', 'in');
}

/** Configuration error (message safe to show to the user, no secrets). */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Splits a comma-separated list into trimmed items, optionally lowercased. */
function splitList(value: string | undefined, lower = false): string[] {
  return (value ?? '')
    .split(',')
    .map((d) => (lower ? d.trim().toLowerCase() : d.trim()))
    .filter(Boolean);
}

/**
 * Loads and validates the configuration from environment variables.
 *
 * Security defaults:
 * - `VIDSIGNER_ENV=pre`.
 * - In `pre`, writes, marking as downloaded, signing links and credential reads are allowed; in `pro`, they are denied unless explicitly enabled.
 * - Destructive operations require `VIDSIGNER_ALLOW_DESTRUCTIVE=true` in ANY environment.
 * - Management tools require `VIDSIGNER_ENABLE_MGMT=true`.
 * - Reading files by path is only possible inside `VIDSIGNER_ALLOWED_INPUT_DIRS`
 *   (default `~/vidsigner-mcp/in`). The disk root and the home directory are rejected.
 *
 * `VIDSIGNER_BASE_URL` and `VIDSIGNER_MGMT_BASE_URL` must be `https:`, with no credentials in the
 * URL, no port other than 443, no query or fragment, with the host of ITS API in the chosen
 * environment (REST and management are not interchangeable) and with the exact path
 * (`/api/v3.0` and `/api`). This prevents `VIDSIGNER_ENV=pre` (with relaxed gates) from actually
 * talking to production. `localhost` and `127.0.0.1` (also over `http:`) only with
 * `VIDSIGNER_ALLOW_LOCAL_HOSTS=true` and `VIDSIGNER_ENV=pre`.
 *
 * The paths in `VIDSIGNER_ALLOWED_INPUT_DIRS` and `VIDSIGNER_OUTPUT_DIR` accept `~` and `~/`, and
 * must be absolute after expansion. This function does not touch the disk: see `prepareDirectories`.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new ConfigError(`Invalid VIDsigner configuration:\n${issues}`);
  }
  const e = parsed.data;
  const environment = e.VIDSIGNER_ENV;
  const isPre = environment === 'pre';
  const allowLocalHosts = e.VIDSIGNER_ALLOW_LOCAL_HOSTS ?? false;
  if (allowLocalHosts && !isPre) {
    throw new ConfigError(
      'VIDSIGNER_ALLOW_LOCAL_HOSTS=true is only valid with VIDSIGNER_ENV=pre (never in production).',
    );
  }

  const baseUrl = validateEndpoint({
    name: 'VIDSIGNER_BASE_URL',
    raw: e.VIDSIGNER_BASE_URL ?? VIDSIGNER_BASE_URLS[environment],
    api: 'rest',
    environment,
    allowLocalHosts,
  });
  const mgmtBaseUrl = validateEndpoint({
    name: 'VIDSIGNER_MGMT_BASE_URL',
    raw: e.VIDSIGNER_MGMT_BASE_URL ?? VIDSIGNER_MGMT_BASE_URLS[environment],
    api: 'mgmt',
    environment,
    allowLocalHosts,
  });

  const inputDirs = splitList(e.VIDSIGNER_ALLOWED_INPUT_DIRS).map((d) =>
    resolveConfiguredPath('VIDSIGNER_ALLOWED_INPUT_DIRS', d),
  );
  const allowedInputDirs = inputDirs.length > 0 ? inputDirs : [defaultInputDir()];
  for (const dir of allowedInputDirs) assertInputDirNotTooBroad(dir);
  const outputDir =
    e.VIDSIGNER_OUTPUT_DIR !== undefined
      ? resolveConfiguredPath('VIDSIGNER_OUTPUT_DIR', e.VIDSIGNER_OUTPUT_DIR)
      : join(tmpdir(), 'vidsigner-mcp');

  return {
    security: {
      environment,
      allowWrite: e.VIDSIGNER_ALLOW_WRITE ?? isPre,
      allowDestructive: e.VIDSIGNER_ALLOW_DESTRUCTIVE ?? false,
      allowMarkDownloaded: e.VIDSIGNER_ALLOW_MARK_DOWNLOADED ?? isPre,
      allowSigningLinks: e.VIDSIGNER_ALLOW_SIGNING_LINKS ?? isPre,
      allowCredentialReads: e.VIDSIGNER_ALLOW_CREDENTIAL_READS ?? isPre,
      enableMgmt: e.VIDSIGNER_ENABLE_MGMT ?? false,
    },
    baseUrl,
    mgmtBaseUrl,
    clientId: e.VIDSIGNER_CLIENT_ID,
    clientSecret: e.VIDSIGNER_CLIENT_SECRET,
    subscriptionName: e.VIDSIGNER_SUBSCRIPTION_NAME,
    subscriptionPass: e.VIDSIGNER_SUBSCRIPTION_PASS,
    mgmt: {
      clientId: e.VIDSIGNER_MGMT_CLIENT_ID ?? e.VIDSIGNER_CLIENT_ID,
      clientSecret: e.VIDSIGNER_MGMT_CLIENT_SECRET ?? e.VIDSIGNER_CLIENT_SECRET,
      partnerUser: e.VIDSIGNER_MGMT_PARTNER_USER,
      partnerPass: e.VIDSIGNER_MGMT_PARTNER_PASS,
    },
    files: {
      outputDir,
      allowedInputDirs,
      maxUploadBytes: Math.round(e.VIDSIGNER_MAX_UPLOAD_MB * 1024 * 1024),
    },
    recipients: {
      emailDomains: splitList(e.VIDSIGNER_ALLOWED_EMAIL_DOMAINS, true),
      phonePrefixes: splitList(e.VIDSIGNER_ALLOWED_PHONE_PREFIXES),
      notificationHosts: splitList(e.VIDSIGNER_ALLOWED_NOTIFICATION_HOSTS, true),
      assetHosts: splitList(e.VIDSIGNER_ALLOWED_ASSET_HOSTS, true),
      allowLocalHosts,
    },
    http: { timeoutMs: e.VIDSIGNER_TIMEOUT_MS, maxRetries: e.VIDSIGNER_MAX_RETRIES },
    logLevel: e.VIDSIGNER_LOG_LEVEL,
    warnings: configWarnings(e, isPre),
  };
}

/**
 * Configuration hints. The VIDmobile token and the enrollment codes have their own flag, separate
 * from the signing links one: a production configuration with `VIDSIGNER_ALLOW_SIGNING_LINKS=true`
 * and management enabled, but without `VIDSIGNER_ALLOW_CREDENTIAL_READS`, silently leaves those two
 * tools disabled, which is easy to overlook.
 */
function configWarnings(
  e: {
    VIDSIGNER_ALLOW_SIGNING_LINKS?: boolean | undefined;
    VIDSIGNER_ALLOW_CREDENTIAL_READS?: boolean | undefined;
    VIDSIGNER_ENABLE_MGMT?: boolean | undefined;
  },
  isPre: boolean,
): string[] {
  if (
    !isPre &&
    e.VIDSIGNER_ALLOW_SIGNING_LINKS === true &&
    e.VIDSIGNER_ENABLE_MGMT === true &&
    e.VIDSIGNER_ALLOW_CREDENTIAL_READS === undefined
  ) {
    return [
      'The VIDmobile token (vidsigner_mgmt_get_vidmobile_user_token) and the enrollment codes (vidsigner_mgmt_list_enrollment_codes) require VIDSIGNER_ALLOW_CREDENTIAL_READS=true; VIDSIGNER_ALLOW_SIGNING_LINKS only covers vidsigner_get_signature_url. Those two tools are disabled.',
    ];
  }
  return [];
}

/** Normalizes a host: lowercase and without the trailing dot of FQDNs (`host.` -> `host`). */
export function normalizeHost(host: string): string {
  return trimEnd(host.trim().toLowerCase(), '.');
}

interface EndpointCheck {
  name: string;
  raw: string;
  api: 'rest' | 'mgmt';
  environment: 'pre' | 'pro';
  allowLocalHosts: boolean;
}

/**
 * Validates an API base URL and returns its canonical form (`origin + path`, no trailing slash):
 * `https:` (or `http:` only on allowed local hosts), no userinfo, no port (or 443), no query or
 * fragment, the exact host for the API and environment, and the exact API path.
 */
function validateEndpoint(c: EndpointCheck): string {
  const trimmed = trimEnd(c.raw.trim(), '/');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ConfigError(`${c.name} is not a valid URL.`);
  }
  const host = normalizeHost(url.hostname);
  const isLocal = c.allowLocalHosts && LOCAL_HOSTS.includes(host);
  assertHostAllowed(c, host, isLocal);

  if (url.protocol !== 'https:' && !(isLocal && url.protocol === 'http:')) {
    throw new ConfigError(
      `${c.name} must use https: (received "${url.protocol}"). ` +
        `Credentials would travel unencrypted or over an unsupported scheme.`,
    );
  }
  if (url.username || url.password) {
    throw new ConfigError(
      `${c.name} must not contain a username or password in the URL (https://user:pass@host). ` +
        `Credentials go in their own variables.`,
    );
  }
  if (url.search || url.hash) {
    throw new ConfigError(`${c.name} must not contain a query (?...) or fragment (#...).`);
  }
  if (url.port !== '' && !isLocal) {
    throw new ConfigError(
      `${c.name} must not specify a port (${url.port}); the default 443 is used.`,
    );
  }
  const expectedPath = API_PATHS[c.api];
  if (trimEnd(url.pathname, '/') !== expectedPath) {
    throw new ConfigError(
      `${c.name} must end exactly in ${expectedPath} (received "${url.pathname}").`,
    );
  }
  // Built with the ALREADY normalized host: `url.origin` would keep the trailing dot (or the `。`
  // converted to `.`) and the first GET would fail with `fetch failed`.
  return `${url.protocol}//${host}${url.port ? `:${url.port}` : ''}${expectedPath}`;
}

/** Requires the host to be in the exact allowlist for the API and environment (or an allowed local host). */
function assertHostAllowed(c: EndpointCheck, host: string, isLocal: boolean): void {
  if (isLocal) return;
  const { environment, api, name } = c;
  const allowed = ALLOWED_HOSTS[environment][api];
  if (host === allowed) return;
  const other = environment === 'pre' ? 'pro' : 'pre';
  const otherApi = api === 'rest' ? 'mgmt' : 'rest';
  if (host === ALLOWED_HOSTS[other][api]) {
    throw new ConfigError(
      `${name} points to ${host}, which is the ${other === 'pro' ? 'production' : 'pre-production'} host, ` +
        `but VIDSIGNER_ENV=${environment}. Fix one of the two variables.`,
    );
  }
  if (host === ALLOWED_HOSTS[environment][otherApi]) {
    throw new ConfigError(
      `${name} points to ${host}, which is the host of the ${otherApi === 'mgmt' ? 'management' : 'signing'} API; ` +
        `the host of the ${api === 'mgmt' ? 'management' : 'signing'} API (${allowed}) is expected here.`,
    );
  }
  throw new ConfigError(
    `${name} points to ${host}, which is not an allowed VIDsigner host for ${environment} (${allowed}).` +
      (environment === 'pre'
        ? ' For a local test server use VIDSIGNER_ALLOW_LOCAL_HOSTS=true.'
        : ''),
  );
}

/**
 * Expands `~` and `~/...` to the home directory and requires an absolute path (relative paths
 * would depend on the directory the MCP client is started from).
 */
export function resolveConfiguredPath(name: string, raw: string): string {
  const value = raw.trim();
  let expanded = value;
  if (value === '~') expanded = homedir();
  else if (value.startsWith('~/') || value.startsWith(`~${sep}`)) {
    expanded = join(homedir(), value.slice(2));
  }
  if (!isAbsolute(expanded)) {
    throw new ConfigError(
      `${name}: "${value}" is not an absolute path. Use a full path (/path/folder) or one starting with ~/ (other forms such as ~user or relative paths are not supported).`,
    );
  }
  return resolve(expanded);
}

/** Rejects input folders equivalent to "the whole disk": the root and the home directory. */
function assertInputDirNotTooBroad(dir: string): void {
  if (parse(dir).root === dir || dir === resolve(homedir())) {
    throw new ConfigError(
      `VIDSIGNER_ALLOWED_INPUT_DIRS must not include "${dir}" (it is equivalent to the whole disk or your entire home directory). ` +
        `Specify a dedicated working folder, e.g. ${defaultInputDir()}.`,
    );
  }
}
