import { z, type ZodRawShape } from 'zod';
import { ALIASES, applyAliases } from './aliases.js';

/**
 * Utilities for the tool schemas: STRICT objects (an unknown key is a clear error, not a silent
 * drop) and normalization of alternative spellings.
 */

/** Levenshtein distance (case-insensitive). */
export function distance(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  const prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    let diag = prev[0] as number;
    prev[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const tmp = prev[j] as number;
      prev[j] = Math.min(
        (prev[j] as number) + 1,
        (prev[j - 1] as number) + 1,
        diag + (x[i - 1] === y[j - 1] ? 0 : 1),
      );
      diag = tmp;
    }
  }
  return prev[y.length] as number;
}

/** The known spelling closest to `unknownKey`, if any is reasonably close. */
export function closestKey(unknownKey: string, known: readonly string[]): string | undefined {
  let best: { key: string; d: number } | undefined;
  for (const key of known) {
    const d = distance(unknownKey, key);
    if (!best || d < best.d) best = { key, d };
  }
  const limit = Math.max(2, Math.floor(unknownKey.length / 3));
  return best && best.d <= limit ? best.key : undefined;
}

/** Unknown-key error message, with a suggestion or with the list of known keys. */
export function unknownKeyMessage(keys: readonly string[], known: readonly string[]): string {
  const parts = keys.map((k) => {
    const hint = closestKey(k, known);
    return hint ? `Unknown field "${k}": did you mean "${hint}"?` : `Unknown field "${k}"`;
  });
  const anyHint = keys.some((k) => closestKey(k, known));
  const list = known.length <= 40 ? known.join(', ') : `${known.slice(0, 40).join(', ')}...`;
  return anyHint ? parts.join(' ') : `${parts.join(' ')}. Known fields: ${list}`;
}

/** `error` options of a strict object: customizes only the `unrecognized_keys` issue. */
export function strictParams(known: readonly string[]) {
  return {
    error: (iss: { code: string; keys?: string[] }): string | undefined =>
      iss.code === 'unrecognized_keys' && iss.keys ? unknownKeyMessage(iss.keys, known) : undefined,
  };
}

/** Strict object with a useful unknown-key message. */
export function strictObject<S extends ZodRawShape>(shape: S) {
  return z.strictObject(shape, strictParams(Object.keys(shape)));
}

/**
 * Strict object for an API body (used by `generated/body-schemas.ts`). If the schema has
 * alternative spellings in {@link ALIASES}, they are normalized after validation.
 */
export function obj<S extends ZodRawShape>(
  name: string,
  shape: S,
): z.ZodType<Record<string, unknown>> {
  const base = strictObject(shape);
  const rules = ALIASES[name];
  return rules
    ? base.transform((value, ctx) => applyAliases(rules, value as Record<string, unknown>, ctx))
    : (base as unknown as z.ZodType<Record<string, unknown>>);
}
