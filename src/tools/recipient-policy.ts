import { VidSignerError } from '../client/errors.js';
import type { RecipientRules } from '../config.js';

/**
 * Optional allowlists for recipients and notification destinations.
 *
 * Rationale: a prompt injection could make the model send a signed document (or a signing link)
 * to a foreign address, or register a webhook on an external host. If a list is defined, any
 * value that does not match is rejected BEFORE calling the API. An empty list restricts nothing.
 * Defining all four is recommended in `pro`.
 *
 * Entry syntax:
 * - Domains and hosts: `example.com` (exact) or `*.example.com` / `.example.com` (any subdomain).
 * - Phones: prefix with `+`, e.g. `+34`.
 * - Resources (logos, `CustomerURL`): own host list, `VIDSIGNER_ALLOWED_ASSET_HOSTS`.
 */
export class RecipientPolicy {
  private readonly rules: RecipientRules;

  constructor(rules: Partial<RecipientRules> = {}) {
    // A key present with an `undefined` value must not override the default.
    const defined = Object.fromEntries(
      Object.entries(rules).filter(([, v]) => v !== undefined),
    ) as Partial<RecipientRules>;
    this.rules = { ...EMPTY_RULES, ...defined };
  }

  /** True if any list is defined. */
  get restricted(): boolean {
    return (
      this.rules.emailDomains.length > 0 ||
      this.rules.phonePrefixes.length > 0 ||
      this.rules.notificationHosts.length > 0 ||
      this.rules.assetHosts.length > 0
    );
  }

  /**
   * REQUIRED email: format ALWAYS checked (a single address) and, if a list is set, its domain
   * against `VIDSIGNER_ALLOWED_EMAIL_DOMAINS`. Empty, `null`, `undefined` and the text "null" are
   * REJECTED. Returns the trimmed, validated address: it is the one that must be sent.
   */
  assertRequiredEmail(value: unknown, field: string): string {
    if (isAbsent(value) || isNullText(value)) {
      throw denied(field, 'is required and must not be empty or "null"');
    }
    return this.checkEmail(value, field);
  }

  /**
   * OPTIONAL email: `undefined` is accepted (not sent); any present value is validated as
   * required (empty and "null" are rejected). Returns the trimmed address, or `undefined`.
   */
  assertOptionalEmail(value: unknown, field: string): string | undefined {
    if (value === undefined) return undefined;
    return this.assertRequiredEmail(value, field);
  }

  /**
   * NULLABLE email, only where the manual documents it (the signer's email, 14.5 / 14.20: if the
   * signer has no email, send "null" or ""): `undefined`, `null`, `''` and "null" count as
   * absent and are returned as-is; any other value is validated and returned trimmed.
   */
  assertEmail(value: unknown, field: string): unknown {
    if (isAbsent(value) || isNullText(value)) return value;
    return this.checkEmail(value, field);
  }

  private checkEmail(value: unknown, field: string): string {
    const original = String(value).trim();
    const email = original.toLowerCase();
    if (!isSingleEmail(email)) {
      throw denied(
        field,
        'must be a single email address (no commas, semicolons, spaces, line breaks, "<", ">" or quotes, and exactly one "@")',
      );
    }
    if (this.rules.emailDomains.length > 0) {
      const domain = email.slice(email.lastIndexOf('@') + 1).replace(/\.+$/, '');
      if (!domain || !matchesHost(domain, this.rules.emailDomains)) {
        throw denied(
          field,
          `the email domain is not in VIDSIGNER_ALLOWED_EMAIL_DOMAINS (${this.rules.emailDomains.join(', ')})`,
        );
      }
    }
    return original;
  }

  /**
   * Checks a phone number: format ALWAYS checked (a single number, `^\+?\d{6,15}$` after
   * stripping the visual separators space, hyphen, dot and parentheses) and, if a list is set,
   * its prefix against `VIDSIGNER_ALLOWED_PHONE_PREFIXES`. `undefined`, `null` and `''` count as
   * absent and are returned as-is (the manual allows an empty phone with
   * `AllowEmptyPhoneNumber`). A present value is returned WITHOUT separators: it is the one that
   * must be sent.
   */
  assertPhone(value: unknown, field: string): unknown {
    if (isAbsent(value)) return value;
    const phone = String(value).replace(/[\s().-]/g, '');
    if (!PHONE_RE.test(phone)) {
      throw denied(
        field,
        'must be a single phone number (6 to 15 digits, with an optional leading "+"; no commas, semicolons or multiple numbers)',
      );
    }
    if (
      this.rules.phonePrefixes.length > 0 &&
      !this.rules.phonePrefixes.some((p) => phone.startsWith(p.replace(/\s/g, '')))
    ) {
      throw denied(
        field,
        `the phone prefix is not in VIDSIGNER_ALLOWED_PHONE_PREFIXES (${this.rules.phonePrefixes.join(', ')})`,
      );
    }
    return phone;
  }

  /**
   * Checks a notification URL (`NotificationURL`, `returnUrl`). ALWAYS requires `https:`
   * (or `http:` on `localhost`/`127.0.0.1` with `VIDSIGNER_ALLOW_LOCAL_HOSTS=true`) and rejects
   * username/password in the URL and the backslash; with `VIDSIGNER_ALLOWED_NOTIFICATION_HOSTS`
   * defined, its host must also be in the list.
   */
  assertUrl(value: unknown, field: string): void {
    this.assertHostList(
      value,
      field,
      this.rules.notificationHosts,
      'VIDSIGNER_ALLOWED_NOTIFICATION_HOSTS',
      true,
    );
  }

  /**
   * Checks the host of a resource URL (logos, `CustomerURL`) against
   * `VIDSIGNER_ALLOWED_ASSET_HOSTS`. This is a SEPARATE list from the notification one: VIDsigner
   * downloads or shows these URLs to signers, and a logo CDN is not a webhook destination.
   * The value `n/a` (which the manual allows in `CustomerURL`) is treated as absent. With the list
   * defined, it also requires `https:` and no username or backslash; with no list it restricts
   * nothing.
   */
  assertAssetUrl(value: unknown, field: string): void {
    if (typeof value === 'string' && value.trim().toLowerCase() === 'n/a') return;
    this.assertHostList(
      value,
      field,
      this.rules.assetHosts,
      'VIDSIGNER_ALLOWED_ASSET_HOSTS',
      false,
    );
  }

  /**
   * Checks free text that VIDsigner shows to the signer (email body and subject, descriptions,
   * reasons...). If any host list is defined (notification or assets), every URL in the text
   * (`http(s)://...` and `www....`) must have its host in one of the two. With no lists it
   * restricts nothing.
   */
  assertFreeText(value: unknown, field: string): void {
    const hosts = [...this.rules.notificationHosts, ...this.rules.assetHosts];
    if (hosts.length === 0 || typeof value !== 'string') return;
    for (const match of value.matchAll(TEXT_URL_RE)) {
      const raw = match[0].replace(/[.,;:!?]+$/, '');
      let host: string;
      try {
        host = normalizeUrlHost(new URL(/^www\./i.test(raw) ? `https://${raw}` : raw));
      } catch {
        throw denied(field, `contains an invalid URL ("${raw.slice(0, 60)}")`);
      }
      if (this.isLocal(host)) continue;
      if (!matchesHost(host, hosts)) {
        throw denied(
          field,
          `contains a URL whose host ("${host}") is in neither VIDSIGNER_ALLOWED_NOTIFICATION_HOSTS nor VIDSIGNER_ALLOWED_ASSET_HOSTS (${hosts.join(', ')})`,
        );
      }
    }
  }

  private isLocal(host: string): boolean {
    return this.rules.allowLocalHosts && LOCAL_HOSTS.includes(host);
  }

  private assertHostList(
    value: unknown,
    field: string,
    hosts: readonly string[],
    envName: string,
    always: boolean,
  ): void {
    if ((!always && hosts.length === 0) || isAbsent(value)) return;
    const raw = String(value).trim();
    if (raw.includes('\\')) throw denied(field, 'the URL must not contain "\\"');
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw denied(field, 'is not a valid URL');
    }
    const host = normalizeUrlHost(url);
    const local = this.isLocal(host);
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
      throw denied(
        field,
        `must use https: (received "${url.protocol}")${this.rules.allowLocalHosts ? '' : '; http is only allowed on localhost with VIDSIGNER_ALLOW_LOCAL_HOSTS=true'}`,
      );
    }
    if (url.username || url.password) {
      throw denied(
        field,
        'the URL must not contain a username or password (https://user:pass@host)',
      );
    }
    if (hosts.length > 0 && !local && !matchesHost(host, hosts)) {
      throw denied(field, `the host is not in ${envName} (${hosts.join(', ')})`);
    }
  }

  /**
   * Walks a request body and checks every field that identifies a destination:
   * emails (`Email`, `eMail`, `CustomerEmail`, `RecipientEmailAddress`, `NotificationEmails`,
   * `EmailStatusNotification`), phones (`PhoneNumber`, `RecipientPhoneNumber`), notification
   * URLs (`NotificationURL`), resource URLs (`Logo`, `CorporateLogo`, `CustomerURL`) and free
   * text the signer sees (`eMailBody`, `eMailSubject`, `Description`, `Body`, `Subject`,
   * `SignatureReason`, `Text`).
   * Email and phone format is always validated; allowlists only if defined.
   * The SIGNER's email (`...Signers[].Email`) accepts `null`, `""` and "null" (manual 14.5);
   * anywhere else an empty or "null" email is rejected.
   */
  assertBody(body: unknown): void {
    this.normalizeBody(body);
  }

  /**
   * Like {@link assertBody}, but returns a COPY of the body with trimmed emails and phones
   * without separators: these are the validated values, and the ones that must be sent.
   */
  normalizeBody<T>(body: T): T {
    return this.walk(body, '', false) as T;
  }

  /** Checks a `Channel` + `Destination` target (link resend or reminder). */
  assertChannelDestination(channel: string, destination: string | undefined): string | undefined {
    if (destination === undefined) return undefined;
    return channel === 'email'
      ? this.assertRequiredEmail(destination, 'Destination')
      : (this.assertPhone(destination, 'Destination') as string | undefined);
  }

  private walk(node: unknown, path: string, inSigners: boolean): unknown {
    if (Array.isArray(node)) {
      return node.map((item, i) => this.walk(item, `${path}[${i}]`, inSigners));
    }
    if (!node || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const here = path ? `${path}.${key}` : key;
      const k = key.toLowerCase();
      if (k === 'email' || k === 'recipientemailaddress' || k === 'customeremail') {
        out[key] = this.emailField(k, value, here, inSigners);
      } else if (k === 'notificationemails' || k === 'emailstatusnotification') {
        out[key] = this.emailList(value, here);
      } else if (k === 'phonenumber' || k === 'recipientphonenumber') {
        out[key] = this.assertPhone(value, here);
      } else if (k === 'notificationurl') {
        this.assertUrl(value, here);
        out[key] = value;
      } else if (k === 'logo' || k === 'corporatelogo' || k === 'customerurl') {
        this.assertAssetUrl(value, here);
        out[key] = value;
      } else if (typeof value === 'string' && FREE_TEXT_KEYS.has(k)) {
        this.assertFreeText(value, here);
        out[key] = value;
      } else {
        out[key] = this.walk(value, here, inSigners || k === 'signers');
      }
    }
    return out;
  }

  /** `eMail` becomes `email` after `toLowerCase`: the signer's is nullable; the rest are not. */
  private emailField(k: string, value: unknown, here: string, inSigners: boolean): unknown {
    if (k === 'email' && inSigners) return this.assertEmail(value, here);
    if (k === 'customeremail') return this.assertOptionalEmail(value, here);
    return this.assertRequiredEmail(value, here);
  }

  /** List of emails (`NotificationEmails`, `EmailStatusNotification`), also when it arrives as a string. */
  private emailList(value: unknown, here: string): unknown {
    if (Array.isArray(value)) {
      return value.map((v, i) => this.assertRequiredEmail(v, `${here}[${i}]`));
    }
    if (typeof value === 'string') return this.assertRequiredEmail(value, here);
    return value;
  }
}

/** A single number: optional leading `+` and 6 to 15 digits (E.164 without separators). */
const PHONE_RE = /^\+?\d{6,15}$/;

/** Local hosts that `VIDSIGNER_ALLOW_LOCAL_HOSTS=true` (pre only) allows over `http:`. */
const LOCAL_HOSTS = ['localhost', '127.0.0.1'];

/** Free-text fields that VIDsigner shows to the signer (lowercase). */
const FREE_TEXT_KEYS = new Set([
  'emailbody',
  'emailsubject',
  'description',
  'body',
  'subject',
  'signaturereason',
  'text',
]);

/** URL inside a text: `http(s)://...` or `www....` up to a space, quote or parenthesis. */
const TEXT_URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`)\]]+/gi;

/** Host in lowercase and without the trailing dot. */
function normalizeUrlHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/\.+$/, '');
}

/** The text "null" (with spaces and any capitalization): the manual uses it for "no email". */
function isNullText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().toLowerCase() === 'null';
}

/** Absent: the field was not provided (the manual allows empty phone and email in some cases). */
function isAbsent(value: unknown): boolean {
  return (
    value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
  );
}

/** A single address: no list or display-name separators, and exactly one "@". */
function isSingleEmail(email: string): boolean {
  if (/[,;\s<>"\u0000-\u001f\u007f]/.test(email)) return false;
  const parts = email.split('@');
  return parts.length === 2 && !!parts[0] && !!parts[1];
}

const EMPTY_RULES: RecipientRules = {
  emailDomains: [],
  phonePrefixes: [],
  notificationHosts: [],
  assetHosts: [],
  allowLocalHosts: false,
};

/** Exact match or subdomain wildcard (`*.example.com` / `.example.com`). */
function matchesHost(host: string, patterns: readonly string[]): boolean {
  return patterns.some((raw) => {
    const p = raw.trim().toLowerCase().replace(/\.+$/, '');
    if (p.startsWith('*.') || p.startsWith('.')) {
      const suffix = p.replace(/^\*?/, '');
      return host.endsWith(suffix) && host.length > suffix.length;
    }
    return host === p;
  });
}

function denied(field: string, reason: string): VidSignerError {
  return new VidSignerError({
    kind: 'validation',
    message: `Destination rejected in "${field}": ${reason}.`,
  });
}
