import { VID_ERROR_CATALOG, type VidErrorCatalogEntry } from './errors/catalog.generated.js';

export { VID_ERROR_CATALOG, type VidErrorCatalogEntry };

/**
 * Error family, so callers can branch without parsing messages:
 *
 * - `api`: the API answered with an HTTP error status (4xx/5xx).
 * - `auth`: missing or invalid credentials, or the operation requires a JWT and there is no ClientID.
 * - `network`: no response was received (DNS, connection refused, reset...).
 * - `timeout`: the request timeout was exceeded.
 * - `validation`: the request was rejected client-side before being sent (e.g. `pageSize` out of range).
 * - `config`: invalid client configuration.
 */
export type VidSignerErrorKind = 'api' | 'auth' | 'network' | 'timeout' | 'validation' | 'config';

export interface VidSignerErrorInit {
  kind: VidSignerErrorKind;
  message: string;
  /** HTTP status, if a response was received. */
  httpStatus?: number;
  /** `Error.Code` from the body (0 = free-form exception without a catalog code). */
  code?: number;
  /** `Error.Details` from the body, if not empty. */
  details?: string;
  /** `Error.Timestamp` from the body. */
  timestamp?: string;
  /** Logical operation name (`documents.create`...). */
  operation?: string;
  cause?: unknown;
}

/**
 * Typed VIDsigner error. Messages arrive already redacted (no credentials).
 *
 * API error format (Annex III of the manual):
 * `{"Error":{"Code":n,"Message":"...","Details":"","Timestamp":"...","StackTrace":""}}`.
 * The server `StackTrace` is never propagated.
 */
export class VidSignerError extends Error {
  readonly kind: VidSignerErrorKind;
  readonly httpStatus: number | undefined;
  readonly code: number | undefined;
  readonly details: string | undefined;
  readonly timestamp: string | undefined;
  readonly operation: string | undefined;
  /** Annex III catalog entry for `code`, if any (aids diagnosis). */
  readonly catalog: VidErrorCatalogEntry | undefined;

  constructor(init: VidSignerErrorInit) {
    super(init.message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = 'VidSignerError';
    this.kind = init.kind;
    this.httpStatus = init.httpStatus;
    this.code = init.code;
    this.details = init.details;
    this.timestamp = init.timestamp;
    this.operation = init.operation;
    this.catalog = init.code !== undefined ? VID_ERROR_CATALOG[init.code] : undefined;
  }

  /** True if retrying makes sense (5xx, network or timeout). */
  get retryable(): boolean {
    return (
      this.kind === 'network' ||
      this.kind === 'timeout' ||
      (this.kind === 'api' && (this.httpStatus ?? 0) >= 500)
    );
  }

  /** Safe representation for logs and tool responses. */
  toJSON(): Record<string, unknown> {
    return {
      error: this.kind,
      message: this.message,
      httpStatus: this.httpStatus,
      code: this.code,
      details: this.details || undefined,
      operation: this.operation,
      catalogMessage: this.catalog?.message,
      hint: hintFor(this),
    };
  }
}

/** Resolution hints for errors observed in practice. */
export function hintFor(err: VidSignerError): string | undefined {
  switch (err.code) {
    case 16601:
      return 'GET vidremoteurl only works if the signer was created with SkipSignatureEmail=true.';
    case 40111:
      return 'The subscription needs the AllowSkipEmail permission (ask Validated ID for it).';
    case 20206:
      return 'This operation requires a JWT (ClientID/ClientSecret); with Basic it answers 401.';
    case 12006:
      return 'pageNumber starts at 1.';
    case 10510:
      return 'pageSize must be greater than 0 and less than 100.';
    default:
      break;
  }
  if (err.kind === 'auth' && err.code === undefined) {
    return 'Check VIDSIGNER_CLIENT_ID/SECRET and VIDSIGNER_SUBSCRIPTION_NAME/PASS.';
  }
  return undefined;
}

/**
 * Codes the API uses for an "empty list" by returning 404 instead of `[]`:
 * 50002 ("The list of documents are empty", `GET /documentlist`) and
 * 70001 ("Devices not found for subscription", `GET /devices`).
 */
export const EMPTY_LIST_CODES: readonly number[] = [50002, 70001];

/** Shape of the signing API error body. */
export interface ApiErrorBody {
  Error?: {
    Code?: number;
    Message?: string;
    Details?: string;
    Timestamp?: string;
    StackTrace?: string;
  };
}

/** Result of parsing an error body (API JSON, plain text or empty). */
export interface ParsedErrorBody {
  code: number | undefined;
  message: string;
  details: string | undefined;
  timestamp: string | undefined;
}

/**
 * Parses the body of an error response. Accepts the JSON format
 * `{ "Error": {...} }`, plain text (the management API answers this way) or empty.
 */
export function parseErrorBody(raw: string): ParsedErrorBody {
  const text = raw.trim();
  if (!text) return { code: undefined, message: '', details: undefined, timestamp: undefined };
  try {
    const json = JSON.parse(text) as ApiErrorBody | string;
    if (typeof json === 'string') {
      return { code: undefined, message: json, details: undefined, timestamp: undefined };
    }
    const e = json?.Error;
    if (e && typeof e === 'object') {
      return {
        code: typeof e.Code === 'number' ? e.Code : undefined,
        message: e.Message ?? '',
        details: e.Details ? e.Details : undefined,
        timestamp: e.Timestamp,
      };
    }
  } catch {
    // Not JSON: plain text.
  }
  return { code: undefined, message: text.slice(0, 500), details: undefined, timestamp: undefined };
}
