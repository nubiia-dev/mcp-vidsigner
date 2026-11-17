/**
 * Parameter completeness.
 *
 * Cross-checks, for the 81 tools, three things:
 *   1. What is DOCUMENTED: the versioned OpenAPI surface (`data/openapi-surface.json`) + the table of
 *      manual-only extras (`data/manual-extras.json`) for the signature API, and the management
 *      manual (`tests/fixtures/mgmt-params.ts`) for the management API.
 *   2. What is VISIBLE: the JSON Schema that the model receives in `tools/list`.
 *   3. What is SENT: the HTTP request that reaches the wire when the tool is called with every
 *      parameter filled in.
 * It fails if a documented parameter is not visible in the schema (with its description) or does
 * not reach the wire. It replaces the manual check of the code review (parameter matrix).
 *
 * With `VIDSIGNER_MATRIX_OUT=<file.json>` it also writes the coverage summary per API.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_TOOLS } from '../../src/tools/index.js';
import { MGMT_PARAMS } from '../fixtures/mgmt-params.js';
import {
  documentedRestOps,
  manualOnlyFields,
  type DocumentedOp,
} from '../helpers/param-sources.js';
import { REST_MANUAL_FIELDS } from '../fixtures/rest-manual-fields.js';
import { extractManualFields, renderFixture } from '../../scripts/lib/manual-fields.js';
import { ALIASES } from '../../src/tools/aliases.js';
import { sample, visibleProps, wirePaths, type JsonSchema } from '../helpers/schema-walk.js';
import { clientTypePaths } from '../helpers/ts-type-paths.js';
import { startHarness } from '../helpers/mcp.js';
import { json, mockFetch, token } from '../helpers/mock-fetch.js';
import { MANUAL_PATH, NEEDS_SPEC } from '../helpers/spec-dir.js';

// ---------------------------------------------------------------------------
// Running the 81 tools with every parameter
// ---------------------------------------------------------------------------

interface Captured {
  method: string;
  url: URL;
  body: unknown;
}
interface ToolRun {
  schema: JsonSchema;
  args: Record<string, unknown>;
  calls: Captured[];
}

const PDF_B64 = Buffer.from('%PDF-1.4\n%test\n').toString('base64');
const XML_B64 = Buffer.from('<a/>').toString('base64');
const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]).toString(
  'base64',
);
const P12_B64 = Buffer.from([0x30, 0x82, 0x01, 0x00, 0x02, 0x01, 0x03]).toString('base64');

const runs = new Map<string, ToolRun>();

/** Fills the file fields with valid content for the type each tool expects. */
function withFiles(tool: string, args: Record<string, unknown>): Record<string, unknown> {
  const a = { ...args };
  for (const k of ['filePath', 'certFilePath', 'imageFilePath']) delete a[k];
  if ('contentBase64' in a) {
    a['contentBase64'] = tool.includes('sign_xml')
      ? XML_B64
      : /signature_image|create_vidmobile_user$/.test(tool)
        ? PNG_B64
        : /add_vidmobile_user_certificate/.test(tool)
          ? P12_B64
          : PDF_B64;
  }
  if ('certBase64' in a) a['certBase64'] = P12_B64;
  if ('imageBase64' in a) a['imageBase64'] = PNG_B64;
  return a;
}

beforeAll(async () => {
  let current = '';
  const calls: Array<Captured & { tool: string }> = [];
  const m = mockFetch((c) => {
    if (c.url.endsWith('/oauth/token')) return token('T');
    calls.push({
      tool: current,
      method: c.method,
      url: new URL(c.url),
      body: c.body ? (JSON.parse(c.body) as unknown) : undefined,
    });
    return json(200, {});
  });
  const h = await startHarness({
    fetch: m.fetch,
    env: {
      VIDSIGNER_ENV: 'pre',
      VIDSIGNER_CLIENT_ID: 'cid',
      VIDSIGNER_CLIENT_SECRET: 'csecret-xyz',
      VIDSIGNER_ALLOW_DESTRUCTIVE: 'true',
      VIDSIGNER_ENABLE_MGMT: 'true',
      VIDSIGNER_MGMT_PARTNER_USER: 'padmin',
      VIDSIGNER_MGMT_PARTNER_PASS: 'partner-pass-1',
    },
  });
  expect(h.registered).toHaveLength(81);
  const listed = (await h.client.listTools()).tools;
  for (const t of ALL_TOOLS) {
    const schema = listed.find((x) => x.name === t.name)?.inputSchema as JsonSchema;
    const args = withFiles(t.name, sample(schema) as Record<string, unknown>);
    current = t.name;
    await h.call(t.name, args);
    runs.set(t.name, {
      schema,
      args,
      calls: calls
        .filter((c) => c.tool === t.name)
        .map(({ method, url, body }) => ({ method, url, body })),
    });
  }
});

// ---------------------------------------------------------------------------
// Check rules
// ---------------------------------------------------------------------------

const norm = (e: string): string => e.replace(/\{[^}]+\}|<[^>]+>/g, '{}').replace(/\/+$/, '');
const toolByOp = new Map(ALL_TOOLS.map((t) => [norm(t.endpoint), t.name]));

/** Documented fields that the tool receives as a file (`filePath` / `contentBase64`). */
const FILE_FIELDS: Record<string, string[]> = {
  'POST /documents': ['DocContent'],
  'POST /documentbatch/{}/document': ['DocContent'],
  'POST /edeliveries': ['DocContent'],
  'POST /signature/{}/attachments': ['DocContent'],
  'POST /xml/sign': ['XmlDocument'],
  'POST /vidmobileusers': ['signatureimage'],
  'PUT /vidmobileusers/{}/signatureimage': ['SignatureImage'],
  'POST /vidmobileusers/{}/certs': ['p12'],
  'POST /subscription/{}/stampcertificates': ['CertificateBase64', 'Image'],
};

/** Documented field -> tool argument name, when they differ (null: container or fixed value). */
const RENAMES: Record<string, Record<string, string | null>> = {
  'POST /search': {
    Terms: null,
    'Terms.additionaldata': 'additionaldata',
    'Terms.elementtype': 'elementtype',
  },
  'POST /edeliveries/search': { Terms: 'terms', 'Terms.status': 'terms' },
  'PUT /signature/{}/signerdata': {
    SignerData: null,
    'SignerData.email': 'email',
    'SignerData.phonenumber': 'phonenumber',
  },
  'PUT /documentbatch/{}/status': { Status: null },
  'POST /xml/sign': {
    Certificate: null,
    'Certificate.CertificateGUI': 'CertificateGUI',
    'Certificate.Pin': 'Pin',
  },
};

/** Dictionary keys whose concrete value cannot be filled with a generic sample. */
const WIRE_SKIP: Record<string, string[]> = { 'POST /edeliveries/search': ['Terms.status'] };

/** Secrets that the server manages: they are sent, but are not a visible argument. */
const SERVER_MANAGED: Record<string, string[]> = { 'PUT /subscription/{}': ['SubscriptionPass'] };

/** Documented queries with a different argument name in the tool. */
const QUERY_RENAMES: Record<string, Record<string, string>> = {
  'GET /documentsbydevice': { filter: 'minutesOlderThan' },
};

export interface Gaps {
  notVisible: string[];
  noDescription: string[];
  notOnWire: string[];
}

/**
 * Compares the documented parameters of an operation with what is visible and what is sent.
 * Pure function: the negative test uses it with tampered data.
 */
export function findGaps(
  opKey: string,
  body: readonly string[],
  visible: Map<string, { description: string }>,
  wire: Set<string>,
): Gaps {
  const files = new Set((FILE_FIELDS[opKey] ?? []).map((x) => x.toLowerCase()));
  const managed = new Set((SERVER_MANAGED[opKey] ?? []).map((x) => x.toLowerCase()));
  const renames = RENAMES[opKey] ?? {};
  const wireSkip = new Set((WIRE_SKIP[opKey] ?? []).map((x) => x.toLowerCase()));
  const gaps: Gaps = { notVisible: [], noDescription: [], notOnWire: [] };
  for (const path of body) {
    const key = path.toLowerCase();
    if (!wireSkip.has(key) && !wire.has(key) && renames[path] !== null) gaps.notOnWire.push(path);
    if (renames[path] === null || managed.has(key)) continue;
    const seen = files.has(key)
      ? visible.has('contentbase64') || visible.has('certbase64') || visible.has('imagebase64')
      : visible.has(renames[path] ? renames[path].toLowerCase() : key);
    if (!seen) {
      gaps.notVisible.push(path);
      continue;
    }
    if (!files.has(key)) {
      const d = visible.get(renames[path] ? renames[path].toLowerCase() : key)?.description ?? '';
      if (!d.trim()) gaps.noDescription.push(path);
    }
  }
  return gaps;
}

const restOps: DocumentedOp[] = [
  ...documentedRestOps().filter((o) => `${o.method} ${o.path}` !== 'POST /oauth/token'),
  // Only in Annex III of the manual, not in the OpenAPI.
  { method: 'DELETE', path: '/documentbatch/{}', pathParams: 1, query: [], body: [] },
];

function bodyOf(run: ToolRun): unknown {
  return run.calls[0]?.body;
}

// ---------------------------------------------------------------------------
// Signature API
// ---------------------------------------------------------------------------

describe('signature: API surface + manual extras -> schema -> wire', () => {
  it('the API surface has 35 operations (34 + oauth) and every one has a tool', () => {
    expect(documentedRestOps()).toHaveLength(35);
    for (const o of restOps)
      expect(toolByOp.has(`${o.method} ${o.path}`), `${o.method} ${o.path}`).toBe(true);
  });

  it.skipIf(!MANUAL_PATH)(
    `the manual fixture matches what the script extracts from the manual${NEEDS_SPEC}`,
    () => {
      const text = readFileSync(MANUAL_PATH as string, 'utf8');
      const extracted = extractManualFields(text);
      expect(Object.keys(extracted)).toEqual(Object.keys(REST_MANUAL_FIELDS));
      for (const [section, { operation, fields }] of Object.entries(REST_MANUAL_FIELDS)) {
        expect(extracted[section]?.operation, section).toBe(operation);
        expect(
          extracted[section]?.fields,
          `${section} ${operation}: npm run gen:manual-fields`,
        ).toEqual(fields);
      }
      expect(renderFixture(extracted)).toContain('REST_MANUAL_FIELDS');
    },
  );

  it('the manual extraction is substantial (not empty) and leaves manual-only fields', () => {
    expect(REST_MANUAL_FIELDS['14.5']?.fields.length).toBeGreaterThan(150);
    const manualOnly = manualOnlyFields();
    expect(Object.keys(manualOnly).sort()).toEqual([
      'POST /documentbatch',
      'POST /documentbatch/{}/document',
      'POST /documents',
    ]);
  });

  it('every field that the manual documents and the OpenAPI does not is in the extras table or is an alias', () => {
    const ops = new Map(
      restOps.map((o) => [`${o.method} ${o.path}`, new Set(o.body.map((b) => b.toLowerCase()))]),
    );
    const aliasNames = new Set(
      Object.values(ALIASES)
        .flatMap((r) => r.keys ?? [])
        .flatMap((k) => [k.canonical.toLowerCase(), k.alias.toLowerCase()]),
    );
    for (const [op, fields] of Object.entries(manualOnlyFields())) {
      for (const f of fields) {
        const inExtras = ops.get(op)?.has(f.toLowerCase()) === true;
        const leaf = (f.split('.').at(-1) as string).toLowerCase();
        expect(inExtras || aliasNames.has(leaf), `${op}: ${f}`).toBe(true);
      }
    }
  });

  for (const op of restOps) {
    const key = `${op.method} ${op.path}`;
    it(key, () => {
      const toolName = toolByOp.get(key) as string;
      const run = runs.get(toolName) as ToolRun;
      expect(run, toolName).toBeDefined();
      const call = run.calls[0];
      expect(call, `${toolName} made no request`).toBeDefined();
      expect(call?.method).toBe(op.method);
      // Path: each path parameter is replaced by a non-empty segment.
      const re = new RegExp(`^/api/v3\\.0${op.path.replace(/\{\}/g, '[^/]+')}$`);
      expect(call?.url.pathname, toolName).toMatch(re);
      // Query: every documented parameter reaches the URL.
      const query = new Set([...(call?.url.searchParams.keys() ?? [])].map((k) => k.toLowerCase()));
      const visible = visibleProps(run.schema);
      for (const q of op.query) {
        expect(query.has(q.toLowerCase()), `${key}: query ${q}`).toBe(true);
        const arg = QUERY_RENAMES[key]?.[q] ?? q.split('.').pop() ?? q;
        expect(visible.has(arg.toLowerCase()), `${key}: ${q} is not visible (${arg})`).toBe(true);
        expect(
          visible.get(arg.toLowerCase())?.description.trim(),
          `${key}: ${q} has no description`,
        ).toBeTruthy();
      }
      // Body.
      const gaps = findGaps(key, op.body, visible, wirePaths(bodyOf(run)));
      expect(gaps, `${key} (${toolName})`).toEqual({
        notVisible: [],
        noDescription: [],
        notOnWire: [],
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Management API
// ---------------------------------------------------------------------------

describe('management: MGMT manual -> schema -> wire', () => {
  it('46 documented operations, each with its tool', () => {
    expect(MGMT_PARAMS).toHaveLength(46);
    for (const o of MGMT_PARAMS) {
      expect(toolByOp.has(`${o.method} ${o.route ?? o.path}`), o.tool).toBe(true);
    }
  });

  for (const op of MGMT_PARAMS) {
    const key = `${op.method} ${op.path}`;
    it(`${key} (${op.tool})`, () => {
      const run = runs.get(op.tool) as ToolRun;
      expect(run, op.tool).toBeDefined();
      const call = run.calls[0];
      expect(call, `${op.tool} made no request`).toBeDefined();
      expect(call?.method).toBe(op.method);
      const re = new RegExp(`^/api${(op.route ?? op.path).replace(/\{\}/g, '[^/]+')}/?$`);
      expect(call?.url.pathname, op.tool).toMatch(re);
      const query = new Set([...(call?.url.searchParams.keys() ?? [])].map((k) => k.toLowerCase()));
      const visible = visibleProps(run.schema);
      for (const q of op.query) {
        expect(query.has(q.toLowerCase()), `${key}: query ${q}`).toBe(true);
        expect(visible.has(q.toLowerCase()), `${key}: ${q} is not visible`).toBe(true);
      }
      const gaps = findGaps(key, op.body, visible, wirePaths(bodyOf(run)));
      expect(gaps, `${key} (${op.tool})`).toEqual({
        notVisible: [],
        noDescription: [],
        notOnWire: [],
      });
    });
  }
});

// ---------------------------------------------------------------------------
// The test must fail when something is missing (negative check)
// ---------------------------------------------------------------------------

describe('detects the gaps', () => {
  const body = ['SignersGroups', 'SignersGroups.Signers.SkipSignatureEmail', 'IssuerName'];
  const vis = (names: string[], desc = 'x') =>
    new Map(names.map((n) => [n.toLowerCase(), { description: desc }]));
  const wire = (names: string[]) => new Set(names.map((n) => n.toLowerCase()));

  it('a parameter that is not visible is reported (schema that drops or does not declare the field)', () => {
    const g = findGaps('POST /documents', body, vis(['SignersGroups', 'IssuerName']), wire(body));
    expect(g.notVisible).toEqual(['SignersGroups.Signers.SkipSignatureEmail']);
  });

  it('a visible parameter that does not reach the wire is reported', () => {
    const g = findGaps('POST /documents', body, vis(body), wire(['SignersGroups', 'IssuerName']));
    expect(g.notOnWire).toEqual(['SignersGroups.Signers.SkipSignatureEmail']);
  });

  it('a visible parameter without a description is reported', () => {
    const g = findGaps('POST /documents', body, vis(body, ''), wire(body));
    expect(g.noDescription).toHaveLength(3);
  });

  it('complete and described reports nothing', () => {
    expect(findGaps('POST /documents', body, vis(body), wire(body))).toEqual({
      notVisible: [],
      noDescription: [],
      notOnWire: [],
    });
  });
});

// ---------------------------------------------------------------------------
// Client typing
// ---------------------------------------------------------------------------

/** Operation -> exported type of `src/client/types.ts` that describes its body. */
const CLIENT_BODY_TYPES: Record<string, string> = {
  'POST /documents': 'SendDocumentInput',
  'POST /documentbatch': 'SendBatchRequest',
  'POST /documentbatch/{}/document': 'SendBatchDocumentInput',
  'POST /edeliveries': 'EDeliveryInput',
  'PUT /edeliveries/{}/reminders': 'EDeliveryReminderChannel',
  'PUT /signature/{}/vidremoteurl': 'SignatureRemoteUrlChannel',
  'POST /signature/{}/attachments': 'Attachment',
  'POST /xml/sign': 'SignXmlRequest',
};

const typing: { documented: number; typed: number } = { documented: 0, typed: 0 };

describe('the client types every documented body field', () => {
  for (const [key, typeName] of Object.entries(CLIENT_BODY_TYPES)) {
    it(`${key} -> ${typeName}`, () => {
      const op = restOps.find((o) => `${o.method} ${o.path}` === key) as DocumentedOp;
      const paths = clientTypePaths(typeName);
      // The file content is provided by the client as a separate argument.
      const skip = new Set((FILE_FIELDS[key] ?? []).map((x) => x.toLowerCase()));
      const missing = op.body.filter(
        (p) => !skip.has(p.toLowerCase()) && !paths.has(p.toLowerCase()),
      );
      typing.documented += op.body.filter((p) => !skip.has(p.toLowerCase())).length;
      typing.typed += op.body.filter(
        (p) => !skip.has(p.toLowerCase()) && paths.has(p.toLowerCase()),
      ).length;
      expect(missing, `${typeName} does not type ${missing.join(', ')}`).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// Coverage summary (optional)
// ---------------------------------------------------------------------------

afterAll(() => {
  const out = process.env['VIDSIGNER_MATRIX_OUT'];
  if (!out) return;
  const summary: Record<string, { documented: number; visible: number; wire: number }> = {
    signature: { documented: 0, visible: 0, wire: 0 },
    management: { documented: 0, visible: 0, wire: 0 },
  };
  const tally = (
    api: 'signature' | 'management',
    key: string,
    body: readonly string[],
    query: readonly string[],
    pathParams: number,
    run: ToolRun,
  ) => {
    const visible = visibleProps(run.schema);
    const wire = wirePaths(bodyOf(run));
    const gaps = findGaps(key, body, visible, wire);
    const n = body.length + query.length + pathParams;
    summary[api]!.documented += n;
    summary[api]!.visible += n - gaps.notVisible.length;
    summary[api]!.wire += n - gaps.notOnWire.length;
  };
  for (const op of restOps) {
    const key = `${op.method} ${op.path}`;
    const run = runs.get(toolByOp.get(key) as string);
    if (run) tally('signature', key, op.body, op.query, op.pathParams, run);
  }
  for (const op of MGMT_PARAMS) {
    const run = runs.get(op.tool);
    if (run)
      tally(
        'management',
        `${op.method} ${op.path}`,
        op.body,
        op.query,
        (op.path.match(/\{\}/g) ?? []).length,
        run,
      );
  }
  writeFileSync(out, JSON.stringify({ ...summary, signatureClient: typing }, null, 2));
});
