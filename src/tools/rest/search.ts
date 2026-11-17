import { defineTool, type AnyToolDefinition } from '../define.js';
import { SearchTermsShape } from '../schemas.js';

const search = defineTool({
  name: 'vidsigner_search',
  title: 'Search documents by AdditionalData',
  domain: 'search',
  api: 'rest',
  risk: 'read',
  endpoint: 'POST /search',
  whenToUse: 'you know the AdditionalData sent when the document was created and need its DocGUI.',
  docSummary:
    'Searches documents by AdditionalData and returns their DocGUIs. It is read-only even though it uses POST.',
  notes: [
    'elementtype alone is rejected with 400/10608: always send additionaldata (optionally with elementtype).',
    'An empty result is returned as an empty list.',
  ],
  example: { additionaldata: 'ORDER-2026-0001', elementtype: 'document' },
  description: [
    'Finds documents whose AdditionalData matches, returning their DocGUIs (POST /search).',
    'Allowed terms: additionaldata and elementtype (e.g. "document"). It is a read-only search despite using POST, so it is available in read-only production mode.',
    'Verified in pre-production: elementtype alone is rejected (400/10608 "Search pattern not supported"); always send additionaldata (optionally with elementtype). An empty result is returned as an empty array.',
  ].join(' '),
  inputSchema: SearchTermsShape,
  handler: async ({ additionaldata, elementtype }, { rest }) => {
    const terms: Record<string, string> = {};
    if (additionaldata !== undefined) terms['additionaldata'] = additionaldata;
    if (elementtype !== undefined) terms['elementtype'] = elementtype;
    if (Object.keys(terms).length === 0) {
      return {
        error: 'validation',
        message: 'Provide at least one of additionaldata or elementtype.',
      };
    }
    const items = await rest.search({ Terms: terms });
    return { count: items.length, items };
  },
});

export const searchTools: AnyToolDefinition[] = [search];
