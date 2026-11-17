/**
 * Client logger and secret redactor.
 *
 * Golden rule: credentials, tokens, request bodies, base64 document content
 * and personal data (national IDs, names, emails, phone numbers) are NEVER
 * logged. The client therefore only logs operation metadata (logical name,
 * method, HTTP status, duration, attempt) and never the full URL, which may
 * contain personal identifiers (e.g. the national ID of a VIDmobile user in
 * `/vidmobileusers/{legalid}`).
 *
 * Even so, any text that reaches the log or an error goes through {@link Redactor},
 * as defense in depth against accidental echoes of sensitive data
 * (in some errors the VIDsigner API returns the `Authorization` header it
 * received: "Authentication header: user:password").
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 99,
};

/** Structured fields accepted by a log record (metadata only). */
export type LogFields = Record<string, string | number | boolean | null | undefined>;

/** Minimal logger contract. Any application logger that satisfies it will do. */
export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

/** Logger that discards everything. A sensible default when the client is used as a library. */
export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** Length from which a base64-like string is considered content and gets hidden. */
const BASE64_BLOB_MIN = 120;

/**
 * Removes registered secrets and known sensitive patterns from any text.
 * It is idempotent and never throws.
 */
export class Redactor {
  private readonly secrets = new Set<string>();

  /** Registers a literal secret (and its base64 form) to hide it wherever it appears. */
  addSecret(value: string | undefined | null): void {
    if (!value || value.length < 4) return;
    this.secrets.add(value);
    this.secrets.add(Buffer.from(value, 'utf8').toString('base64'));
  }

  /** Registers the `user:password` pair used in Basic, as is and encoded. */
  addBasicPair(user: string | undefined, pass: string | undefined): void {
    if (!user || !pass) return;
    this.addSecret(pass);
    const pair = `${user}:${pass}`;
    this.secrets.add(pair);
    this.secrets.add(Buffer.from(pair, 'utf8').toString('base64'));
  }

  redact(text: string): string {
    let out = text;
    for (const secret of this.secrets) {
      if (out.includes(secret)) out = out.split(secret).join('[REDACTED]');
    }
    out = out
      // The server returns "Authentication header: user:pass" in 20103 errors.
      .replace(/(Authentication header:\s*)\S+/gi, '$1[REDACTED]')
      .replace(/(Authorization:\s*(?:Basic|Bearer)\s+)\S+/gi, '$1[REDACTED]')
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/g, '$1 [REDACTED]')
      // JWT (three base64url segments).
      .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, '[REDACTED_JWT]')
      // Long base64 blobs (DocContent, images, p12).
      .replace(new RegExp(`[A-Za-z0-9+/_-]{${BASE64_BLOB_MIN},}={0,2}`, 'g'), '[REDACTED_BASE64]');
    return out;
  }
}

/** Options of the default logger (stderr). */
export interface ConsoleLoggerOptions {
  level?: LogLevel;
  redactor?: Redactor;
  /** Component prefix, e.g. `vidsigner`. */
  name?: string;
  /** Write target; defaults to `process.stderr.write` (stdout is reserved for the MCP). */
  write?: (line: string) => void;
}

/**
 * Logger to stderr in the format `level name message key=value`.
 * Stdout is NOT used: with the stdio transport it belongs to the MCP protocol.
 */
export function createLogger(opts: ConsoleLoggerOptions = {}): Logger {
  const level = opts.level ?? 'info';
  const redactor = opts.redactor ?? new Redactor();
  const name = opts.name ?? 'vidsigner';
  const write = opts.write ?? ((line: string) => void process.stderr.write(`${line}\n`));

  const emit = (lvl: Exclude<LogLevel, 'silent'>, msg: string, fields?: LogFields): void => {
    if (LEVEL_ORDER[lvl] < LEVEL_ORDER[level]) return;
    const parts = [new Date().toISOString(), lvl.toUpperCase(), name, redactor.redact(msg)];
    if (fields) {
      for (const [k, v] of Object.entries(fields)) {
        if (v === undefined) continue;
        parts.push(`${k}=${redactor.redact(String(v))}`);
      }
    }
    write(parts.join(' '));
  };

  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
  };
}
