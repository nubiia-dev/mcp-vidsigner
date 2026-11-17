/**
 * Sources of truth for the documented parameters of the signature API: the versioned API surface
 * (`data/openapi-surface.json`, extracted from the vendor OpenAPI document) plus the versioned table
 * of manual-only extras (`data/manual-extras.json`). Independent of the schema generator: here the
 * field paths are only flattened.
 */
import { readFileSync } from 'node:fs';
import { loadSurface } from '../../scripts/lib/surface.js';
import { REST_MANUAL_FIELDS } from '../fixtures/rest-manual-fields.js';

interface Extras {
  newSchemas: Record<string, { fields: Record<string, unknown> }>;
  fields: Array<{ schemas: string[]; field: string; type: string; items?: { $ref: string } }>;
}

const surface = loadSurface();
const extras = JSON.parse(readFileSync('data/manual-extras.json', 'utf8')) as Extras;

/** Dotted field paths (no array indexes) of a schema body, plus the manual-only extras. */
function flattenSchema(
  shortName: string,
  prefix: string,
  out: Set<string>,
  seen: string[],
  withExtras = true,
): void {
  if (seen.includes(shortName)) return;
  const props: Record<string, { ref?: string }> = {};
  for (const [k, v] of Object.entries(surface.schemas[shortName] ?? {})) {
    const ref = v.ref ?? v.items?.ref;
    props[k] = { ...(ref ? { ref } : {}) };
  }
  if (withExtras) {
    for (const k of Object.keys(extras.newSchemas[shortName]?.fields ?? {})) props[k] = {};
    for (const e of extras.fields.filter((x) => x.schemas.includes(shortName))) {
      props[e.field] = e.items ? { ref: e.items.$ref } : {};
    }
  }
  for (const [name, def] of Object.entries(props)) {
    const path = prefix ? `${prefix}.${name}` : name;
    out.add(path);
    if (def.ref) flattenSchema(def.ref, path, out, [...seen, shortName], withExtras);
  }
}

export interface DocumentedOp {
  method: string;
  /** Path with `{}` for each path parameter, without `/api/v{version}`. */
  path: string;
  pathParams: number;
  query: string[];
  body: string[];
}

/** Manual-only keys that are in neither the OpenAPI surface nor the extras table (dictionary keys). */
const MAP_KEYS: Record<string, string[]> = {
  'POST /search': ['Terms.additionaldata', 'Terms.elementtype'],
  'POST /edeliveries/search': ['Terms.status'],
  'PUT /signature/{}/signerdata': ['SignerData.email', 'SignerData.phonenumber'],
};

/** All documented operations (35 in the OpenAPI), with path, query and body parameters. */
export function documentedRestOps(withExtras = true): DocumentedOp[] {
  return surface.operations.map((op) => {
    const path = op.path.replace(/\{[^}]+\}/g, '{}');
    const body = new Set<string>();
    if (op.bodyRef) flattenSchema(op.bodyRef, '', body, [], withExtras);
    for (const k of MAP_KEYS[`${op.method} ${path}`] ?? []) body.add(k);
    return {
      method: op.method,
      path,
      pathParams: op.params.filter((p) => p.in === 'path').length,
      query: op.params.filter((p) => p.in === 'query').map((p) => p.name),
      body: [...body],
    };
  });
}

/**
 * Fields that ONLY the manual documents (they are not in the OpenAPI surface), per operation
 * (`POST /documents`...). Derived from `tests/fixtures/rest-manual-fields.ts` (versioned extraction
 * of the manual, regenerable with `npm run gen:manual-fields`) minus the OpenAPI surface fields WITHOUT
 * extras: it is not a fixed snapshot. The comparison ignores case (the manual writes `eMail` and `APP`).
 */
export function manualOnlyFields(): Record<string, string[]> {
  const openApi = new Map(
    documentedRestOps(false).map((o) => [
      `${o.method} ${o.path}`,
      new Set(o.body.map((b) => b.toLowerCase())),
    ]),
  );
  const out: Record<string, string[]> = {};
  for (const { operation, fields } of Object.values(REST_MANUAL_FIELDS)) {
    const known = openApi.get(operation) ?? new Set<string>();
    const only = fields.filter((f) => !known.has(f.toLowerCase()));
    if (only.length > 0) out[operation] = only;
  }
  return out;
}
