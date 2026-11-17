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
    'Both additionaldata and elementtype are mandatory: either one alone is rejected by the API with 400/10608. The only elementtype value is "document": "documents", "edelivery" and "batch" answer 400/10604 "Not allowed value for search term ElementType" (verified in pre-production).',
    'The match on additionaldata is EXACT and case-sensitive (verified in pre-production): a prefix, a substring or a different case returns an empty list. To search by part of the value or ignoring the case use vidsigner_list_documents with searchText.',
    'An empty result is returned as an empty list.',
  ],
  example: { additionaldata: 'ORDER-2026-0001', elementtype: 'document' },
  description: [
    'Finds documents whose AdditionalData matches, returning their DocGUIs (POST /search).',
    'Send BOTH additionaldata and elementtype ("document"): the API rejects either term alone (400/10608 "Search pattern not supported"), as verified in pre-production.',
    'The match is exact and case-sensitive; an empty result is returned as an empty array. It is a read-only search despite using POST, so it is available in read-only production mode.',
  ].join(' '),
  inputSchema: SearchTermsShape,
  handler: async ({ additionaldata, elementtype }, { rest }) => {
    const items = await rest.search({ Terms: { additionaldata, elementtype } });
    return { count: items.length, items };
  },
});

export const searchTools: AnyToolDefinition[] = [search];
