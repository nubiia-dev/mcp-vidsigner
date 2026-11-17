/**
 * Generator of the zod schemas for the signature API request bodies.
 *
 * Inputs (all versioned in the repository):
 * - `data/openapi-surface.json`: structure and types of the bodies (extracted from the vendor
 *   OpenAPI document by `npm run gen:schemas`, see `scripts/lib/surface.ts`).
 * - `data/manual-extras.json`: fields that only the manual documents.
 * - `data/field-docs.json`: descriptions, enumerations and limits.
 * - `src/tools/aliases.ts`: alternative spellings (eMail, APP...).
 *
 * Outputs:
 * - `src/tools/generated/body-schemas.ts`: STRICT zod schemas (an unknown key is an error) with
 *   every documented field and its description, for the write tools.
 * - `src/client/generated/manual-extras.ts`: client types with the manual-only fields and the
 *   alternative spellings.
 *
 * Usage: `npm run gen:schemas`. `tests/tools/body-schemas.test.ts` checks that the generated files
 * are up to date with the versioned inputs.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import prettier from 'prettier';
import { ALIASES } from '../../src/tools/aliases.js';
import { ROOT, loadSurface, type Surface, type SurfaceProperty } from './surface.js';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

interface FieldDoc {
  description?: string;
  enum?: string[];
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  format?: 'url';
  required?: boolean;
  /** The manual documents `null` as a valid value (e.g. `SignerFullNameOrNULL`). */
  nullable?: boolean;
  default?: unknown;
}
interface ExtraField {
  schemas: string[];
  field: string;
  type: string;
  items?: { $ref: string };
  manual: string;
}
interface ExtrasFile {
  version: string;
  newSchemas: Record<string, { fields: Record<string, { type: string; manual: string }> }>;
  fields: ExtraField[];
}
interface DocsFile {
  fields: Record<string, FieldDoc>;
}

/** Simplified field type. */
type Ty =
  | { kind: 'string' | 'integer' | 'number' | 'boolean' | 'unknown' | 'map' }
  | { kind: 'ref'; name: string }
  | { kind: 'array'; items: Ty };

interface Field {
  name: string;
  ty: Ty;
  doc: FieldDoc;
  /** Origin: the OpenAPI surface, the manual (extras) or an alternative spelling of another field. */
  origin: 'openapi' | 'manual' | 'alias';
  manual?: string;
  aliasOf?: string;
}

/** Root schemas: the tool bodies. `DocContent` comes from filePath/contentBase64. */
const ROOTS: Array<{ schema: string; exportName: string; omit: string[] }> = [
  { schema: 'SendDocumentDTO', exportName: 'sendDocumentShape', omit: ['DocContent'] },
  { schema: 'SendBatchDTO', exportName: 'sendBatchShape', omit: [] },
  { schema: 'SendDocumentBatchDTO', exportName: 'sendDocumentBatchShape', omit: ['DocContent'] },
  { schema: 'EDeliveries.EDeliveryDTO', exportName: 'eDeliveryShape', omit: ['DocContent'] },
];

function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(resolve(ROOT, rel), 'utf8')) as T;
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

function tyOf(prop: SurfaceProperty): Ty {
  if (prop.ref) return { kind: 'ref', name: prop.ref };
  switch (prop.type) {
    case 'string':
      return { kind: 'string' };
    case 'integer':
      return { kind: 'integer' };
    case 'number':
      return { kind: 'number' };
    case 'boolean':
      return { kind: 'boolean' };
    case 'array':
      return { kind: 'array', items: prop.items ? tyOf(prop.items) : { kind: 'unknown' } };
    case 'object':
      return prop.map ? { kind: 'map' } : { kind: 'unknown' };
    default:
      return { kind: 'unknown' };
  }
}

/** Field documentation: the most specific key wins. */
function docFor(docs: DocsFile, schema: string, field: string): FieldDoc {
  const last = schema.split('.').at(-1) as string;
  const ns = schema.split('.')[0] as string;
  const candidates = [`${schema}.${field}`, `${last}.${field}`, `${ns}.*.${field}`, `*.${field}`];
  for (const key of candidates) {
    const doc = docs.fields[key];
    if (doc) return doc;
  }
  return {};
}

interface Model {
  /** Schemas in dependency order (leaves first). */
  order: string[];
  schemas: Map<string, Field[]>;
}

function buildModel(surface: Surface): Model {
  const extras = readJson<ExtrasFile>('data/manual-extras.json');
  const docs = readJson<DocsFile>('data/field-docs.json');

  const schemas = new Map<string, Field[]>();
  const order: string[] = [];

  const fieldsOf = (name: string): Field[] => {
    const fields: Field[] = [];
    const add = (f: Field) => {
      if (fields.some((x) => x.name === f.name)) {
        throw new Error(`Duplicate field ${name}.${f.name}`);
      }
      fields.push(f);
    };
    const oa = surface.schemas[name];
    const created = extras.newSchemas[name];
    if (!oa && !created) throw new Error(`Unknown schema: ${name}`);
    for (const [prop, def] of Object.entries(oa ?? {})) {
      add({ name: prop, ty: tyOf(def), doc: docFor(docs, name, prop), origin: 'openapi' });
    }
    for (const [prop, def] of Object.entries(created?.fields ?? {})) {
      add({
        name: prop,
        ty: { kind: def.type as 'string' },
        doc: docFor(docs, name, prop),
        origin: 'manual',
        manual: def.manual,
      });
    }
    for (const extra of extras.fields.filter((e) => e.schemas.includes(name))) {
      const ty: Ty =
        extra.type === 'array' && extra.items
          ? { kind: 'array', items: { kind: 'ref', name: extra.items.$ref } }
          : { kind: extra.type as 'string' };
      add({
        name: extra.field,
        ty,
        doc: docFor(docs, name, extra.field),
        origin: 'manual',
        manual: extra.manual,
      });
    }
    // Alternative key spellings (eMail, APP...): same type as the canonical one.
    for (const rule of ALIASES[name]?.keys ?? []) {
      const canonical = fields.find((f) => f.name === rule.canonical);
      if (!canonical) {
        throw new Error(`aliases.ts: ${name}.${rule.canonical} does not exist in the schema`);
      }
      // With an alias, "required" means "one of the two": applyAliases enforces it.
      if (canonical.doc.required && !rule.required) {
        throw new Error(
          `aliases.ts: ${name}.${rule.canonical} is required: mark the rule as required`,
        );
      }
      if (rule.required) canonical.doc = { ...canonical.doc, required: false };
      add({
        name: rule.alias,
        ty: canonical.ty,
        doc: {
          description: `Alias of \`${rule.canonical}\` (spelling used by the manual). Accepted and normalised to \`${rule.canonical}\`${rule.send === 'both' ? '; both spellings are sent to VIDsigner until the right one is verified in pre-production' : ''}. Do not send both with different values.`,
        },
        origin: 'alias',
        aliasOf: rule.canonical,
      });
    }
    // Alternative value spellings (WhatsApp): added to the enum.
    for (const rule of ALIASES[name]?.values ?? []) {
      const f = fields.find((x) => x.name === rule.field);
      if (!f) throw new Error(`aliases.ts: ${name}.${rule.field} does not exist in the schema`);
      const base = f.doc.enum;
      if (!base)
        throw new Error(`aliases.ts: ${name}.${rule.field} has no enum in field-docs.json`);
      f.doc = { ...f.doc, enum: [...base, ...rule.aliases] };
    }
    return fields;
  };

  const visit = (name: string): void => {
    if (schemas.has(name)) return;
    const fields = fieldsOf(name);
    schemas.set(name, fields);
    const visitTy = (ty: Ty): void => {
      if (ty.kind === 'ref') visit(ty.name);
      else if (ty.kind === 'array') visitTy(ty.items);
    };
    for (const f of fields) visitTy(f.ty);
    order.push(name);
  };
  for (const root of ROOTS) visit(root.schema);
  return { order, schemas };
}

// ---------------------------------------------------------------------------
// zod emission
// ---------------------------------------------------------------------------

const constName = (schema: string): string => `S_${schema.replace(/[^A-Za-z0-9]/g, '_')}`;
const lit = (v: unknown): string => JSON.stringify(v);

function zodFor(f: Field, requiredOverride: boolean): string {
  const d = f.doc;
  const base = (ty: Ty): string => {
    switch (ty.kind) {
      case 'string': {
        if (d.enum) return `z.enum([${d.enum.map(lit).join(', ')}])`;
        let s = 'z.string()';
        if (d.format === 'url') s += '.url()';
        if (d.minLength !== undefined) s += `.min(${d.minLength})`;
        if (d.maxLength !== undefined) s += `.max(${d.maxLength})`;
        return s;
      }
      case 'integer': {
        let s = 'z.number().int()';
        if (d.min !== undefined) s += `.min(${d.min})`;
        if (d.max !== undefined) s += `.max(${d.max})`;
        return s;
      }
      case 'number':
        return 'z.number()';
      case 'boolean':
        return 'z.boolean()';
      case 'map':
        return 'z.record(z.string(), z.string())';
      case 'unknown':
        return 'z.record(z.string(), z.unknown())';
      case 'ref':
        return constName(ty.name);
      case 'array': {
        let s = `z.array(${base(ty.items)})`;
        if (d.minItems !== undefined) s += `.min(${d.minItems})`;
        return s;
      }
    }
  };
  let expr = base(f.ty);
  if (d.nullable) expr += '.nullable()';
  if (d.default !== undefined) expr += `.default(${lit(d.default)})`;
  else if (!requiredOverride) expr += '.optional()';
  if (d.description) expr += `.describe(${lit(d.description)})`;
  return expr;
}

function shapeSource(fields: Field[], omit: string[] = []): string {
  const lines: string[] = [];
  for (const f of fields) {
    if (omit.includes(f.name)) continue;
    const required = f.doc.required === true;
    lines.push(`  ${lit(f.name)}: ${zodFor(f, required)},`);
  }
  return `{\n${lines.join('\n')}\n}`;
}

function bodySchemasSource(model: Model): string {
  const out: string[] = [
    '/**',
    ' * GENERATED by scripts/gen-body-schemas.ts. DO NOT EDIT BY HAND: `npm run gen:schemas`.',
    ' *',
    ' * Strict zod schemas of the signature API request bodies: API surface (data/openapi-surface.json)',
    ' * + manual-only fields (data/manual-extras.json) + descriptions (data/field-docs.json) +',
    ' * alternative spellings (src/tools/aliases.ts). An unknown key is an error with a suggestion.',
    ' */',
    "import { z } from 'zod';",
    "import { obj } from '../schema-kit.js';",
    '',
  ];
  for (const name of model.order) {
    // Roots are only exported as a shape: nothing else references them.
    if (ROOTS.some((r) => r.schema === name)) continue;
    const fields = model.schemas.get(name) as Field[];
    out.push(`const ${constName(name)} = obj(${lit(name)}, ${shapeSource(fields)});`, '');
  }
  for (const root of ROOTS) {
    const fields = model.schemas.get(root.schema) as Field[];
    out.push(
      `/** Body fields of ${root.schema} (without ${root.omit.join(', ') || 'exclusions'}). */`,
      `export const ${root.exportName} = ${shapeSource(fields, root.omit)};`,
      '',
    );
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Client types emission
// ---------------------------------------------------------------------------

const NEW_SCHEMA_NAMES = new Set(
  Object.keys(readJson<ExtrasFile>('data/manual-extras.json').newSchemas),
);

function tsType(ty: Ty): string {
  switch (ty.kind) {
    case 'string':
      return 'string';
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'map':
      return 'Record<string, string>';
    case 'unknown':
      return 'Record<string, unknown>';
    case 'ref':
      // Manual-only schemas get their own interface; types.ts types the rest from the OpenAPI types.
      return NEW_SCHEMA_NAMES.has(ty.name)
        ? `Manual${ty.name.replace(/[^A-Za-z0-9]/g, '')}`
        : 'Record<string, unknown>';
    case 'array':
      return `${tsType(ty.items)}[]`;
  }
}

function clientTypesSource(model: Model): string {
  const out: string[] = [
    '/**',
    ' * GENERATED by scripts/gen-body-schemas.ts. DO NOT EDIT BY HAND: `npm run gen:schemas`.',
    ' *',
    ' * REST manual fields that the OpenAPI does not cover (data/manual-extras.json) and alternative',
    ' * spellings (src/tools/aliases.ts). `types.ts` combines them with the OpenAPI DTOs.',
    ' */',
    '',
  ];
  // New manual-only schemas (RejectionOptionDTO) as a full interface.
  const extras = readJson<ExtrasFile>('data/manual-extras.json');
  for (const name of Object.keys(extras.newSchemas)) {
    const fields = model.schemas.get(name) ?? [];
    out.push(
      `/** ${name} (manual only). */`,
      `export interface Manual${name.replace(/[^A-Za-z0-9]/g, '')} {`,
    );
    for (const f of fields.filter((x) => x.origin !== 'alias')) {
      out.push(`  ${f.name}: ${tsType(f.ty)};`);
    }
    for (const f of fields.filter((x) => x.origin === 'alias')) {
      out.push(`  /** Alias of \`${f.aliasOf}\`. */`, `  ${f.name}?: ${tsType(f.ty)};`);
    }
    out.push('}', '');
  }
  for (const name of model.order) {
    const fields = (model.schemas.get(name) as Field[]).filter((f) => f.origin !== 'openapi');
    if (fields.length === 0 || extras.newSchemas[name]) continue;
    out.push(
      `/** Fields of ${name} that the OpenAPI does not cover (REST manual) and their alternative spellings. */`,
      `export interface Manual${name.replace(/[^A-Za-z0-9]/g, '')}Extras {`,
    );
    for (const f of fields) {
      const note =
        f.origin === 'alias'
          ? `Alias of \`${f.aliasOf}\` (spelling used by the manual).`
          : `Manual REST ${f.manual}.`;
      out.push(`  /** ${note} */`, `  ${f.name}?: ${tsType(f.ty)};`);
    }
    out.push('}', '');
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GeneratedFiles {
  /** Path relative to the repository root -> already formatted content. */
  files: Record<string, string>;
}

async function format(path: string, source: string): Promise<string> {
  const config = (await prettier.resolveConfig(resolve(ROOT, path))) ?? {};
  return prettier.format(source, { ...config, parser: 'typescript' });
}

/** Generates the content of the files (without writing them) from the given API surface. */
export async function generate(surface: Surface = loadSurface()): Promise<GeneratedFiles> {
  const model = buildModel(surface);
  const schemasPath = 'src/tools/generated/body-schemas.ts';
  const typesPath = 'src/client/generated/manual-extras.ts';
  return {
    files: {
      [schemasPath]: await format(schemasPath, bodySchemasSource(model)),
      [typesPath]: await format(typesPath, clientTypesSource(model)),
    },
  };
}

/** Fields (name and origin) of a schema, for tests. */
export function describeSchema(
  name: string,
  surface: Surface = loadSurface(),
): Array<{ name: string; origin: string }> {
  const model = buildModel(surface);
  return (model.schemas.get(name) ?? []).map((f) => ({ name: f.name, origin: f.origin }));
}

export { ROOT };
