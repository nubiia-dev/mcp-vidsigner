import { z } from 'zod';
import { defineTool, type AnyToolDefinition } from '../define.js';
import { id } from '../schemas.js';
import { requireMgmt } from '../util.js';

const subscriptionGuid = id('Subscription GUID.');
const NOTE =
  'Only for subscriptions configured to work with T-Systems Registra (otherwise 409). Needs subscription-scope credentials.';

const listDocTypes = defineTool({
  name: 'vidsigner_mgmt_list_tsystems_doctypes',
  title: 'List T-Systems document types',
  domain: 'tsystems',
  api: 'mgmt',
  risk: 'read',
  endpoint: 'GET /subscription/{guid}/tsystemsdoctypes',
  whenToUse: 'the subscription works with T-Systems Registra and you need its document types.',
  docSummary: 'Lists the T-Systems document types configured in a subscription.',
  notes: ['Only for subscriptions configured with T-Systems Registra (otherwise 409).'],
  description: `Lists the T-Systems document types configured in a subscription (MGMT API). ${NOTE}`,
  inputSchema: { subscriptionGuid },
  handler: async ({ subscriptionGuid }, ctx) => {
    const items = await requireMgmt(ctx).listTSystemsDocTypes(subscriptionGuid);
    return { count: items.length, items };
  },
});

const createDocType = defineTool({
  name: 'vidsigner_mgmt_create_tsystems_doctype',
  title: 'Create T-Systems document type',
  domain: 'tsystems',
  api: 'mgmt',
  risk: 'write',
  endpoint: 'POST /subscription/{guid}/tsystemsdoctype',
  whenToUse: 'a T-Systems document type must be added to the subscription.',
  docSummary: 'Adds a T-Systems document type to a subscription.',
  notes: [
    'Only for subscriptions configured with T-Systems Registra (otherwise 409).',
    'The route is the SINGULAR /tsystemsdoctype, not the plural of the manual: in pre-production POST on /tsystemsdoctypes answers 405 and on /tsystemsdoctype reaches the T-Systems check (409). Only the route is verified: the demo subscription has no T-Systems, so a successful creation has not been seen.',
  ],
  example: {
    subscriptionGuid: '0b6f1d0e-1c2a-4c55-9d8e-3a1f5b7c9e21',
    DocumentType: 'Contract',
    Code: 'DBOID-1234',
  },
  description: `Adds a T-Systems document type to a subscription (MGMT API, POST /subscription/{guid}/tsystemsdoctype). The route is the singular one, not the plural written in the manual (which answers 405 in pre-production); only the route is verified, as the demo has no T-Systems. ${NOTE}`,
  inputSchema: {
    subscriptionGuid,
    DocumentType: z.string().describe('Document type description.'),
    Code: z.string().describe('Document type DBOID as defined by T-Systems.'),
  },
  handler: async ({ subscriptionGuid, ...input }, ctx) =>
    requireMgmt(ctx).createTSystemsDocType(subscriptionGuid, input),
});

const deleteDocType = defineTool({
  name: 'vidsigner_mgmt_delete_tsystems_doctype',
  title: 'Delete T-Systems document type',
  domain: 'tsystems',
  api: 'mgmt',
  risk: 'destructive',
  endpoint: 'DELETE /tsystemsdocumenttype/{guid}',
  whenToUse: 'a T-Systems document type must be removed.',
  docSummary: 'Deletes a T-Systems document type.',
  notes: ['It is irreversible.'],
  example: { docTypeGuid: '0b6f1d0e-1c2a-4c55-9d8e-3a1f5b7c9e21' },
  description: `Deletes a T-Systems document type (MGMT API). ${NOTE}`,
  inputSchema: { docTypeGuid: id('Document type GUID.') },
  handler: async ({ docTypeGuid }, ctx) => {
    await requireMgmt(ctx).deleteTSystemsDocType(docTypeGuid);
    return { deleted: true, docTypeGuid };
  },
});

const listBookCodes = defineTool({
  name: 'vidsigner_mgmt_list_tsystems_bookcodes',
  title: 'List T-Systems book codes',
  domain: 'tsystems',
  api: 'mgmt',
  risk: 'read',
  endpoint: 'GET /subscription/{guid}/tsystemsbookcodes',
  whenToUse: 'the subscription works with T-Systems Registra and you need its book codes.',
  docSummary: 'Lists the T-Systems book codes configured in a subscription.',
  notes: ['Only for subscriptions configured with T-Systems Registra (otherwise 409).'],
  description: `Lists the T-Systems book codes configured in a subscription (MGMT API). ${NOTE}`,
  inputSchema: { subscriptionGuid },
  handler: async ({ subscriptionGuid }, ctx) => {
    const items = await requireMgmt(ctx).listTSystemsBookCodes(subscriptionGuid);
    return { count: items.length, items };
  },
});

const createBookCode = defineTool({
  name: 'vidsigner_mgmt_create_tsystems_bookcode',
  title: 'Create T-Systems book code',
  domain: 'tsystems',
  api: 'mgmt',
  risk: 'write',
  endpoint: 'POST /subscription/{guid}/tsystemsbookcode',
  whenToUse: 'a T-Systems book code must be added to the subscription.',
  docSummary: 'Adds a T-Systems book code to a subscription.',
  notes: ['Only for subscriptions configured with T-Systems Registra (otherwise 409).'],
  example: {
    subscriptionGuid: '0b6f1d0e-1c2a-4c55-9d8e-3a1f5b7c9e21',
    Code: '1234',
    Description: 'Contracts book',
  },
  description: `Adds a T-Systems book code to a subscription (MGMT API). ${NOTE}`,
  inputSchema: {
    subscriptionGuid,
    Code: z.string().describe('Book code defined by T-Systems (numeric).'),
    Description: z.string().describe('Description of the book code.'),
  },
  handler: async ({ subscriptionGuid, ...input }, ctx) =>
    requireMgmt(ctx).createTSystemsBookCode(subscriptionGuid, input),
});

const deleteBookCode = defineTool({
  name: 'vidsigner_mgmt_delete_tsystems_bookcode',
  title: 'Delete T-Systems book code',
  domain: 'tsystems',
  api: 'mgmt',
  risk: 'destructive',
  endpoint: 'DELETE /tsystemsbookcodes/{guid}',
  whenToUse: 'a T-Systems book code must be removed.',
  docSummary: 'Deletes a T-Systems book code.',
  notes: ['It is irreversible.'],
  example: { bookCodeGuid: '0b6f1d0e-1c2a-4c55-9d8e-3a1f5b7c9e21' },
  description: `Deletes a T-Systems book code (MGMT API). ${NOTE}`,
  inputSchema: { bookCodeGuid: id('Book code GUID.') },
  handler: async ({ bookCodeGuid }, ctx) => {
    await requireMgmt(ctx).deleteTSystemsBookCode(bookCodeGuid);
    return { deleted: true, bookCodeGuid };
  },
});

export const tsystemsTools: AnyToolDefinition[] = [
  listDocTypes,
  createDocType,
  deleteDocType,
  listBookCodes,
  createBookCode,
  deleteBookCode,
];
