/**
 * Extraction of the fields that the VIDsigner REST manual documents per operation (the "Syntax" and
 * "Sample Request" blocks). Used by `scripts/extract-manual-fields.ts` to generate
 * `tests/fixtures/rest-manual-fields.ts` and by `tests/tools/param-completeness.test.ts` to check
 * that the fixture is up to date. See the script for usage.
 */

/** Manual section -> operation (method + path with `{}` per path parameter). */
export const OPERATIONS: Record<string, string> = {
  14.5: 'POST /documents',
  14.15: 'PUT /signature/{}/vidremoteurl',
  14.16: 'POST /signature/{}/attachments',
  14.17: 'PUT /signature/{}/signerdata',
  '14.20': 'POST /documentbatch',
  14.21: 'POST /documentbatch/{}/document',
  14.22: 'PUT /documentbatch/{}/status',
  14.24: 'POST /search',
  14.25: 'POST /edeliveries',
  '14.30': 'PUT /edeliveries/{}/reminders',
  14.31: 'POST /edeliveries/search',
  14.32: 'POST /xml/sign',
};

/** First segment that is not a body field (headers and hosts in the samples). */
const JUNK = new Set([
  'Authorization',
  'Connection',
  'Date',
  'Expires',
  'Host',
  'Pragma',
  'Server',
  'Expect',
  'charset',
  'localhost',
  'Content',
  'Accept',
  'Content-Type',
  'Cache',
]);

const KEY = /"?([A-Za-z_][A-Za-z0-9_]*)"?\s*[:=]|"([A-Za-z_][A-Za-z0-9_]*)"(?=\s*[{[])/y;

/** Field paths (dotted, no indexes) of a sample JSON block with line numbering. */
function parseBlock(block: string[]): Set<string> {
  const paths = new Set<string>();
  const stack: Array<string | null> = [];
  let pending: string | null = null;
  for (const text of block) {
    let i = 0;
    while (i < text.length) {
      const c = text[i] as string;
      if (c === '{' || c === '[') {
        stack.push(pending);
        pending = null;
        i += 1;
        continue;
      }
      if (c === '}' || c === ']') {
        stack.pop();
        pending = null;
        i += 1;
        continue;
      }
      const startsKey = c === '"' || /[A-Za-z_]/.test(c);
      if (startsKey) {
        KEY.lastIndex = i;
        const m = KEY.exec(text);
        if (m && (i === 0 || ' \t,{['.includes(text[i - 1] as string) || c === '"')) {
          const k = (m[1] ?? m[2]) as string;
          paths.add([...stack.filter((x): x is string => !!x), k].join('.'));
          pending = k;
          i = KEY.lastIndex;
          continue;
        }
      }
      i += 1;
    }
  }
  return paths;
}

/** Numbered lines of the `Syntax`/`Sample Request` block of a section, from the first `{` or `[`. */
function requestBlock(lines: string[], from: number, to: number): string[] {
  let inRequest = false;
  const block: string[] = [];
  for (let j = from; j < to; j++) {
    const l = lines[j] as string;
    if (/^\s*Syntax\s*$/.test(l) || /^\s*Sample Request/.test(l)) inRequest = true;
    if (/^\s*Sample Response\s*$/.test(l) || /^\s*Response Syntax/.test(l)) inRequest = false;
    if (
      /^\s*(Request Elements|Response Elements|Request headers|Response headers|Request Headers)/.test(
        l,
      )
    ) {
      inRequest = false;
    }
    const m = /^\s*(\d{1,4})\s{2,}(.*)$/.exec(l);
    if (inRequest && m) block.push(m[2] as string);
  }
  const first = block.findIndex((t) => t.trim() !== '' && '{['.includes(t.trim()[0] as string));
  return first >= 0 ? block.slice(first) : [];
}

/** Fields that the manual documents for each operation in {@link OPERATIONS}. */
export interface ManualFields {
  operation: string;
  fields: string[];
}

export function extractManualFields(text: string): Record<string, ManualFields> {
  const lines = text.split('\n');
  const heads: Array<{ i: number; section: string }> = [];
  lines.forEach((l, i) => {
    const m = /^(14\.\d+)\.\s+O\s*PERATION/.exec(l);
    if (m) heads.push({ i, section: m[1] as string });
  });
  const annex = lines.findIndex((l) => /^15\.1\.\s/.test(l));
  heads.push({ i: annex >= 0 ? annex : lines.length, section: 'END' });
  const out: Record<string, ManualFields> = {};
  for (let k = 0; k < heads.length - 1; k++) {
    const { i, section } = heads[k] as { i: number; section: string };
    if (!(section in OPERATIONS)) continue;
    const fields = [...parseBlock(requestBlock(lines, i, (heads[k + 1] as { i: number }).i))]
      .filter((p) => !JUNK.has(p.split('.')[0] as string))
      .sort();
    out[section] = { operation: OPERATIONS[section] as string, fields };
  }
  return out;
}

/** Content of `tests/fixtures/rest-manual-fields.ts`. */
export function renderFixture(fields: Record<string, ManualFields>): string {
  const body = Object.keys(OPERATIONS)
    .map((section) => {
      const f = fields[section];
      if (!f) throw new Error(`The manual does not contain section ${section}`);
      const list = f.fields.map((x) => `      ${JSON.stringify(x)},`).join('\n');
      return `  ${JSON.stringify(section)}: {\n    operation: ${JSON.stringify(f.operation)},\n    fields: [${list ? `\n${list}\n    ` : ''}],\n  },`;
    })
    .join('\n');
  return `/**
 * GENERATED by scripts/extract-manual-fields.ts. DO NOT EDIT BY HAND: \`npm run gen:manual-fields\`.
 *
 * Fields that the REST manual documents in the syntax and sample-request blocks of each operation
 * with a body (field names only, extracted from the manual; no documentation text). It is the
 * reference of the completeness test (the equivalent of tests/fixtures/mgmt-params.ts for the
 * management API). The manual-only fields are the ones here that are not in the OpenAPI surface.
 */
export interface ManualOperationFields {
  operation: string;
  /** Dotted field paths (arrays carry no index). They may use the manual's spelling. */
  fields: string[];
}

export const REST_MANUAL_FIELDS: Record<string, ManualOperationFields> = {
${body}
};
`;
}
