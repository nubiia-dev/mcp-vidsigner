import { VidSignerError } from './errors.js';

/**
 * Basic credentials of the subscription (`SubscriptionName:SubscriptionPass`).
 *
 * Basic works for READS of the signing API (verified in the
 * pre-production environment on 2026-11-16); writes require a JWT.
 */
export interface BasicCredentials {
  username: string;
  password: string;
}

/** `Authorization: Basic base64(user:pass)` header value. */
export function basicHeader(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}`;
}

/** Grant sent to `POST /oauth/token`. */
export interface OauthGrant {
  /** `SubscriptionName` (subscription scope) or partner user (partner scope). */
  username: string;
  /** `SubscriptionPass` or partner password. */
  password: string;
  /** `subscription` (signing API) or `partner`/`subscription` (management API). */
  scope: string;
}

export interface TokenProviderOptions {
  /** Absolute URL of `POST /oauth/token`. */
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  grant: OauthGrant;
  /** Must go through the transport's `fetch` so timeout and mocks are shared. */
  request: (init: TokenRequest) => Promise<TokenResponse>;
  /** Injectable clock (epoch ms) for tests. */
  now?: () => number;
  /** Safety margin before expiry at which the token is renewed. Defaults to 60 s. */
  skewSeconds?: number;
  /** Logical name used in errors and logs. */
  label: string;
}

export interface TokenRequest {
  url: string;
  authorization: string;
  body: OauthGrantBody;
}

export interface OauthGrantBody {
  grant_type: 'password';
  username: string;
  password: string;
  scope: string;
}

export interface TokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: string | number;
  /** The REST manual spells it `expire_in`; both spellings are accepted. */
  expire_in?: string | number;
}

const DEFAULT_TTL_SECONDS = 3600;

/**
 * Fetches and caches the JWT from `POST /oauth/token` and renews it before it expires.
 *
 * - Only one token request is in flight even with many concurrent calls
 *   (`inflight`), so the OAuth client is neither flooded nor blocked.
 * - `invalidate()` discards the token (e.g. after an unexpected 401) and the
 *   next call requests a new one.
 * - The token never leaves this class except through {@link getToken}; it is never logged.
 */
export class TokenProvider {
  private token: string | undefined;
  private expiresAt = 0;
  private inflight: Promise<string> | undefined;
  private readonly now: () => number;
  private readonly skewMs: number;

  constructor(private readonly opts: TokenProviderOptions) {
    this.now = opts.now ?? Date.now;
    this.skewMs = (opts.skewSeconds ?? 60) * 1000;
  }

  /** Returns a valid token, renewing it if missing or about to expire. */
  async getToken(): Promise<string> {
    if (this.token && this.now() < this.expiresAt - this.skewMs) return this.token;
    this.inflight ??= this.fetchToken().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  /** Discards the cached token (the next call will request a new one). */
  invalidate(): void {
    this.token = undefined;
    this.expiresAt = 0;
  }

  /** True if a valid token is cached (without requesting one). For diagnostics/tests only. */
  get hasValidToken(): boolean {
    return !!this.token && this.now() < this.expiresAt - this.skewMs;
  }

  private async fetchToken(): Promise<string> {
    const { clientId, clientSecret, grant, tokenUrl, label } = this.opts;
    const res = await this.opts.request({
      url: tokenUrl,
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64')}`,
      body: {
        grant_type: 'password',
        username: grant.username,
        password: grant.password,
        scope: grant.scope,
      },
    });
    const token = res.access_token;
    if (!token) {
      throw new VidSignerError({
        kind: 'auth',
        message: `The oauth/token response (${label}) does not include access_token.`,
        operation: 'oauth.token',
      });
    }
    const ttl = Number(res.expires_in ?? res.expire_in ?? DEFAULT_TTL_SECONDS);
    const ttlSeconds = Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_TTL_SECONDS;
    this.token = token;
    this.expiresAt = this.now() + ttlSeconds * 1000;
    return token;
  }
}
