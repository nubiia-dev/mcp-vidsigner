import {
  EMPTY_LIST_CODES,
  VidSignerError,
  parseErrorBody,
  type VidSignerErrorKind,
} from './errors.js';
import { Redactor, silentLogger, type Logger } from './logger.js';
import type { TokenRequest, TokenResponse } from './auth.js';

/** Authentication strategy of a request. */
export interface AuthStrategy {
  /** Full value of the `Authorization` header. */
  getAuthorization(): Promise<string>;
  /**
   * If present, on a 401 it is called once to discard the cached token
   * and the request is retried with a fresh token (reactive renewal).
   */
  invalidate?(): void;
}

/**
 * Retry policy of an operation.
 *
 * - `safe`: retried on 5xx, timeout and network error (reads, PUT, DELETE, searches).
 * - `never`: never retried. Used for POSTs that create resources (documents, batches,
 *   e-deliveries...): if the server processed the request before failing,
 *   retrying would duplicate the document and the emails/SMS sent to the signer.
 */
export type RetryPolicy = 'safe' | 'never';

/**
 * When a 404 on a listing means "empty list":
 *
 * - `codes`: only if `Error.Code` is in {@link EMPTY_LIST_CODES} (50002 and 70001).
 * - `codes-or-empty-body`: the above, or a 404 without a code that has an empty body, "list is empty"
 *   or a bare "Elements not found". This is what `GET /signeddocuments` and the management API return
 *   for an empty collection. A 404 with descriptive text ("Element not found...", "not exist") is an error.
 * - `codes-or-empty-body-or-no-certs`: the previous rule plus one extra case, only for
 *   `GET /vidmobileusers/{legalid}/certs`: the user EXISTS but has no certificates and the API answers
 *   404 "Element not found.No certs for vidmobile user ..." (verified in pre-production). The 404 of a user
 *   that does not exist ("No vidmobile user with legalid ...") stays an error, and so does any other text.
 */
export type EmptyListRule = 'codes' | 'codes-or-empty-body' | 'codes-or-empty-body-or-no-certs';

/** Exact text of the "user exists but has no certificates" 404 (a missing user says "No vidmobile user with legalid"). */
const NO_CERTS_404 = /^element not found\.\s*no certs for vidmobile user\b/i;

/** Description of an HTTP request to the service. */
export interface RequestSpec {
  /** Logical name (`documents.create`). It is the only part of the route that gets logged. */
  operation: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Absolute URL with the path parameters already encoded. */
  url: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  auth: AuthStrategy;
  retry: RetryPolicy;
  /**
   * "Empty list" normalization (see {@link EmptyListRule}). Without this option any 404 is an error.
   * A 404 saying "not found" or "not exist" is never treated as empty: it means a missing parent resource.
   */
  emptyListOn404?: EmptyListRule;
}

export interface HttpTransportOptions {
  timeoutMs?: number;
  maxRetries?: number;
  /** Base wait of the exponential backoff in ms (default 300). */
  retryBaseDelayMs?: number;
  fetch?: typeof fetch;
  logger?: Logger;
  redactor?: Redactor;
  /** Injectable in tests to avoid real waiting. */
  sleep?: (ms: number) => Promise<void>;
  /** Randomness source for the jitter (0..1). */
  random?: () => number;
}

const DEFAULTS = {
  timeoutMs: 30_000,
  maxRetries: 2,
  retryBaseDelayMs: 300,
};

/**
 * HTTP transport shared by the signing API and the management API.
 *
 * Responsibilities: per-request timeout, retries with backoff only on
 * 5xx/network/timeout, reactive JWT renewal on 401, error mapping to
 * {@link VidSignerError} (with secret redaction) and empty-list normalization.
 */
export class HttpTransport {
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly baseDelay: number;
  private readonly fetchImpl: typeof fetch;
  private readonly logger: Logger;
  readonly redactor: Redactor;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(opts: HttpTransportOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs;
    this.maxRetries = opts.maxRetries ?? DEFAULTS.maxRetries;
    this.baseDelay = opts.retryBaseDelayMs ?? DEFAULTS.retryBaseDelayMs;
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.logger = opts.logger ?? silentLogger;
    this.redactor = opts.redactor ?? new Redactor();
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = opts.random ?? Math.random;
  }

  /** Executes the request and returns the parsed body (`undefined` if empty). */
  async request<T = unknown>(spec: RequestSpec): Promise<T> {
    const maxAttempts = spec.retry === 'never' ? 1 : this.maxRetries + 1;
    let refreshed = false;
    let attempt = 0;

    for (;;) {
      attempt += 1;
      try {
        return (await this.once<T>(spec, attempt)) as T;
      } catch (err) {
        const e = err instanceof VidSignerError ? err : this.wrapUnknown(err, spec);

        // A failure while fetching the token was already retried inside its own request;
        // it is not retried again here (avoids multiplying requests to the OAuth client).
        if (e.operation !== spec.operation) throw e;

        // Reactive renewal: a 401 with a cached JWT is usually a revoked token.
        if (e.httpStatus === 401 && spec.auth.invalidate && !refreshed) {
          refreshed = true;
          spec.auth.invalidate();
          attempt -= 1;
          this.logger.warn('401 with cached JWT: renewing the token and retrying', {
            op: spec.operation,
          });
          continue;
        }

        if (e.retryable && attempt < maxAttempts) {
          const delay = this.backoff(attempt);
          this.logger.warn('Request failed, retrying', {
            op: spec.operation,
            attempt,
            status: e.httpStatus,
            kind: e.kind,
            delayMs: delay,
          });
          await this.sleep(delay);
          continue;
        }
        throw e;
      }
    }
  }

  /** Token request to `/oauth/token` (used by {@link TokenProvider}). */
  async requestToken(req: TokenRequest, operation: string): Promise<TokenResponse> {
    const res = await this.request<TokenResponse>({
      operation,
      method: 'POST',
      url: req.url,
      body: req.body,
      auth: { getAuthorization: async () => req.authorization },
      // Requesting a token is idempotent: it is safe to retry.
      retry: 'safe',
    });
    return res ?? {};
  }

  private backoff(attempt: number): number {
    const exp = this.baseDelay * 2 ** (attempt - 1);
    return Math.round(exp + this.random() * this.baseDelay);
  }

  private async once<T>(spec: RequestSpec, attempt: number): Promise<T | undefined> {
    const started = Date.now();
    const url = buildUrl(spec.url, spec.query);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: await spec.auth.getAuthorization(),
    };
    let body: string | undefined;
    if (spec.body !== undefined) {
      headers['Content-Type'] = 'application/json; charset=utf-8';
      body = JSON.stringify(spec.body);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    let text: string;
    try {
      res = await this.fetchImpl(url, {
        method: spec.method,
        headers,
        body,
        signal: controller.signal,
      });
      text = await res.text();
    } catch (cause) {
      throw this.networkError(cause, spec, controller.signal.aborted);
    } finally {
      clearTimeout(timer);
    }

    this.logger.debug('Response', {
      op: spec.operation,
      method: spec.method,
      status: res.status,
      ms: Date.now() - started,
      attempt,
    });

    if (res.ok) return parseSuccess<T>(text);

    const parsed = parseErrorBody(text);
    if (res.status === 404 && isEmptyList(spec.emptyListOn404, parsed)) {
      // With a catalog code (50002/70001) the 404 is unambiguous. Without a code it is a heuristic
      // (empty body or "list is empty"): it is logged so that a missing parent resource
      // being mistaken for an empty list can be detected.
      if (parsed.code === undefined) {
        this.logger.warn('404 without code normalized to empty list', {
          op: spec.operation,
          status: 404,
          reason:
            parsed.message.trim() === ''
              ? 'empty body'
              : spec.emptyListOn404 === 'codes-or-empty-body-or-no-certs' &&
                  /no certs/i.test(parsed.message)
                ? 'user without certificates'
                : 'empty-list message',
        });
      }
      return [] as unknown as T;
    }
    throw this.apiError(res.status, parsed, spec);
  }

  private apiError(
    status: number,
    parsed: ReturnType<typeof parseErrorBody>,
    spec: RequestSpec,
  ): VidSignerError {
    const kind: VidSignerErrorKind = status === 401 || status === 403 ? 'auth' : 'api';
    const codePart = parsed.code !== undefined ? ` / ${parsed.code}` : '';
    const msgPart = parsed.message ? `: ${this.redactor.redact(parsed.message)}` : '';
    return new VidSignerError({
      kind,
      httpStatus: status,
      code: parsed.code,
      details: parsed.details ? this.redactor.redact(parsed.details) : undefined,
      timestamp: parsed.timestamp,
      operation: spec.operation,
      message: `${spec.operation} -> HTTP ${status}${codePart}${msgPart}`,
    });
  }

  private networkError(cause: unknown, spec: RequestSpec, aborted: boolean): VidSignerError {
    const name = cause instanceof Error ? cause.name : '';
    const isTimeout = aborted || name === 'AbortError' || name === 'TimeoutError';
    const detail = cause instanceof Error ? this.redactor.redact(cause.message) : '';
    return new VidSignerError({
      kind: isTimeout ? 'timeout' : 'network',
      operation: spec.operation,
      message: isTimeout
        ? `${spec.operation} -> timeout after ${this.timeoutMs} ms`
        : `${spec.operation} -> network error${detail ? `: ${detail}` : ''}`,
      cause,
    });
  }

  private wrapUnknown(err: unknown, spec: RequestSpec): VidSignerError {
    const msg = err instanceof Error ? this.redactor.redact(err.message) : 'unknown error';
    return new VidSignerError({
      kind: 'network',
      operation: spec.operation,
      message: `${spec.operation} -> ${msg}`,
      cause: err,
    });
  }
}

/** Decides whether a 404 on a listing is an "empty list" according to the operation's rule. */
export function isEmptyList(
  rule: EmptyListRule | undefined,
  parsed: ReturnType<typeof parseErrorBody>,
): boolean {
  if (!rule) return false;
  const byCode = parsed.code !== undefined && EMPTY_LIST_CODES.includes(parsed.code);
  if (rule === 'codes') return byCode;
  const message = parsed.message.trim();
  // A bare "Elements not found" is what the management manual returns for an empty collection;
  // if it names a resource ("Element not found. Subscription not exist") the parent does not exist.
  const emptyBody =
    parsed.code === undefined &&
    (message === '' ||
      (/\blist is empty\b/i.test(message) && !/not (found|exist)/i.test(message)) ||
      /^elements? not found\.?$/i.test(message));
  const noCerts =
    rule === 'codes-or-empty-body-or-no-certs' &&
    parsed.code === undefined &&
    NO_CERTS_404.test(message);
  return byCode || emptyBody || noCerts;
}

function parseSuccess<T>(text: string): T | undefined {
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    // Non-JSON 2xx response (e.g. plain text): returned as is.
    return text as unknown as T;
  }
}

/** Builds the final URL with its query string (skips `undefined`). */
export function buildUrl(
  base: string,
  query?: Record<string, string | number | boolean | undefined>,
): string {
  if (!query) return base;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) params.append(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${base}${base.includes('?') ? '&' : '?'}${qs}` : base;
}

/**
 * Encodes a path segment (GUID, device name, national ID...).
 *
 * Rejects an empty segment, `.` and `..`: `encodeURIComponent` does not escape them and the final URL
 * (`/documents/..`) would escape the intended operation once normalized by the client or the server.
 */
export function seg(value: string): string {
  if (value === '' || value === '.' || value === '..') {
    throw new VidSignerError({
      kind: 'validation',
      message: 'Invalid path identifier: it cannot be empty, "." or "..".',
    });
  }
  return encodeURIComponent(value);
}
