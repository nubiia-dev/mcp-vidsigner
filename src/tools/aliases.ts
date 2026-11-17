import type { z } from 'zod';

/**
 * Alternative spellings of fields and values in the signature API request bodies.
 *
 * The OpenAPI spec and the REST manual disagree on the spelling of some fields (`Email` versus
 * `eMail`, `App` versus `APP`...) and there is no way to know from the documentation which one
 * the server accepts, or whether it accepts both (.NET binders are usually case-insensitive,
 * but this is not documented). Until this is verified in pre-production with a ClientID (writes
 * require a JWT), this table decides what is done with each one:
 *
 * - Both spellings are ACCEPTED as tool input (both appear in the schema).
 * - They are NORMALIZED to a canonical form (the OpenAPI one, unless noted).
 * - `send: 'both'`: BOTH are SENT with the same value, because there is real doubt and sending
 *   only one might make the server silently ignore the field (for example, the signer's email).
 *   `send: 'canonical'`: only the canonical one.
 * - If the model sends both with different values, the request is rejected.
 *
 * VERIFICATION in pre with a ClientID: rows start as `status: 'pending'`; only the signer's
 * `Email`/`eMail` of `POST /documents` is verified so far (17/11/2026). Once one is
 * verified, change `status` to `'verified'`, set `send: 'canonical'` with the spelling the server
 * accepts and record the evidence in `evidence`. `scripts/gen-body-schemas.ts` takes the
 * spellings from here to add them to the generated schemas: after editing the table, run
 * `npm run gen:schemas`.
 *
 * The key is the short name of the OpenAPI schema (without `VIDCloudRestPubDTOs.DTOs.`).
 */

/** How the two spellings of a field are sent. */
export type AliasSend = 'canonical' | 'both';

/** Verification status of a decision. */
export type AliasStatus = 'pending' | 'verified';

/** A field with two spellings (`canonical` is the one the typed client uses). */
export interface KeyAlias {
  canonical: string;
  alias: string;
  /**
   * The field is required: one of the two spellings is enough (the generated schema leaves both
   * optional and {@link applyAliases} requires one).
   */
  required?: boolean;
  send: AliasSend;
  status: AliasStatus;
  /** Where each spelling appears and why it was decided this way. */
  evidence: string;
}

/** An enumeration value with two spellings. */
export interface ValueAlias {
  field: string;
  canonical: string;
  aliases: string[];
  status: AliasStatus;
  evidence: string;
}

export interface AliasRules {
  keys?: KeyAlias[];
  values?: ValueAlias[];
}

/** OTP channel spelling, shared by the signer of `POST /documents` and the batch signer. */
const OTP_CHANNEL_ALIAS: ValueAlias = {
  field: 'OTPChannel',
  canonical: 'whatsapp',
  aliases: ['WhatsApp'],
  status: 'pending',
  evidence:
    'Manual 14.5 table lists "sms, WhatsApp, smswhatsapp"; the syntax example uses lowercase smsORwhatsappORsmswhatsapp. An enumeration value cannot be sent twice, so whatsapp is sent.',
};

/**
 * Signer of `POST /documents`. `Email`/`eMail` verified in pre-production on 17/11/2026 with
 * `POST /documents` and `SkipSignatureEmail=true` (three documents): `Email` alone, `eMail` and
 * `Email` with the same value, and both with different values all answer 200. With different
 * values the LAST key of the JSON wins (documentinfo returned the value of `eMail`): the binder
 * of VIDsigner is case-insensitive and keeps the last occurrence. That is why this client rejects
 * two different values instead of leaving the outcome to the key order. Only `Email` is
 * sent, as the table requires for a verified decision.
 */
const SIGNER_V2_ALIASES: AliasRules = {
  keys: [
    {
      canonical: 'Email',
      alias: 'eMail',
      send: 'canonical',
      status: 'verified',
      evidence:
        'OpenAPI SignerV2DTO: Email. Manual 14.5 (syntax and table): eMail; manual 14.14 and the 14.x documentinfo sections: Email. Verified in pre on 17/11/2026 with POST /documents: both spellings are accepted (case-insensitive binder) and, if the values differ, the last key of the JSON wins; the response of documentinfo uses Email.',
    },
  ],
  values: [OTP_CHANNEL_ALIAS],
};

/** Signer of `POST /documentbatch` (the `Email`/`eMail` decision is NOT verified for this endpoint). */
const BATCH_SIGNER_ALIASES: AliasRules = {
  keys: [
    {
      canonical: 'Email',
      alias: 'eMail',
      send: 'both',
      status: 'pending',
      evidence:
        'OpenAPI BatchSignerDTO: Email. Manual 14.20 (syntax and table): eMail. Verified only for POST /documents (SignerV2DTO), not for POST /documentbatch. Real doubt, so both are sent.',
    },
  ],
  values: [OTP_CHANNEL_ALIAS],
};

export const ALIASES: Record<string, AliasRules> = {
  'Signer.SignerV2DTO': SIGNER_V2_ALIASES,
  'Signer.BatchSignerDTO': BATCH_SIGNER_ALIASES,
  DocumentRecipientDTO: {
    keys: [
      {
        canonical: 'Email',
        alias: 'eMail',
        required: true,
        send: 'both',
        status: 'pending',
        evidence:
          'OpenAPI DocumentRecipientDTO: Email. Manual 14.5 and 14.21 (syntax): eMail; table: email. Real doubt, so both are sent.',
      },
    ],
  },
  DocAppearanceDTO: {
    keys: [
      {
        canonical: 'App',
        alias: 'APP',
        send: 'both',
        status: 'pending',
        evidence:
          'OpenAPI DocAppearanceDTO: App. Manual 14.5 and 14.20 (syntax and table): APP. Real doubt, so both are sent.',
      },
    ],
  },
  CentralizedCertificateDTO: {
    keys: [
      {
        canonical: 'CertificateGUID',
        alias: 'CertificateGUI',
        send: 'both',
        status: 'pending',
        evidence:
          'OpenAPI CentralizedCertificateDTO and the manual 14.5 table: CertificateGUID. Syntax examples in manual 14.5 and 14.20: CertificateGUI. Real doubt, so both are sent.',
      },
    ],
  },
  RejectionOptionDTO: {
    keys: [
      {
        canonical: 'Id',
        alias: 'id',
        send: 'canonical',
        status: 'pending',
        evidence:
          'Manual 14.5: syntax and example use Id; the table has RejectionOptions.id. The manual table writes fields lowercase that the example gives in PascalCase (email, language), so Id is sent.',
      },
      {
        canonical: 'Text',
        alias: 'text',
        send: 'canonical',
        status: 'pending',
        evidence:
          'Same as Id: the example uses Text, the table has RejectionOptions.text. Text is sent.',
      },
    ],
  },
};

/** All rows of the table, for tests and documentation. */
export function allAliasRows(): Array<
  { schema: string; kind: 'key' | 'value' } & Record<string, unknown>
> {
  const rows: Array<{ schema: string; kind: 'key' | 'value' } & Record<string, unknown>> = [];
  for (const [schema, rules] of Object.entries(ALIASES)) {
    for (const k of rules.keys ?? []) rows.push({ schema, kind: 'key', ...k });
    for (const v of rules.values ?? []) rows.push({ schema, kind: 'value', ...v });
  }
  return rows;
}

/**
 * Applies the alias rules to an already validated object: normalizes to the canonical form and
 * sends both spellings where the table says so. Rejects (with a zod issue) both spellings
 * carrying different values.
 */
export function applyAliases(
  rules: AliasRules,
  value: Record<string, unknown>,
  ctx: z.core.$RefinementCtx<Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...value };
  for (const rule of rules.keys ?? []) {
    const canonical = out[rule.canonical];
    const alias = out[rule.alias];
    if (canonical !== undefined && alias !== undefined) {
      if (JSON.stringify(canonical) !== JSON.stringify(alias)) {
        ctx.addIssue({
          code: 'custom',
          message: `"${rule.canonical}" and its alias "${rule.alias}" have different values: send only one`,
          path: [rule.alias],
        });
        continue;
      }
    }
    const chosen = canonical !== undefined ? canonical : alias;
    if (chosen === undefined) {
      if (rule.required) {
        ctx.addIssue({
          code: 'custom',
          message: `"${rule.canonical}" is required (or its alias "${rule.alias}")`,
          path: [rule.canonical],
        });
      }
      continue;
    }
    out[rule.canonical] = chosen;
    if (rule.send === 'both') out[rule.alias] = chosen;
    else delete out[rule.alias];
  }
  for (const rule of rules.values ?? []) {
    const current = out[rule.field];
    if (typeof current === 'string' && rule.aliases.includes(current))
      out[rule.field] = rule.canonical;
  }
  return out;
}
