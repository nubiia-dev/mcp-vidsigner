import { z } from 'zod';
import { defineTool, type AnyToolDefinition } from '../define.js';
import { id } from '../schemas.js';
import { requireMgmt } from '../util.js';

/** Optional pagination shared by partners and customers. */
export const paginationShape = {
  pageNumber: z.number().int().min(1).optional().describe('Page number, starting at 1.'),
  pageSize: z
    .number()
    .int()
    .min(1)
    .max(99)
    .optional()
    .describe(
      'Items per page, 1-99 (the signature API rejects 100 or more; assumed for management).',
    ),
  orderBy: z.string().optional().describe('Field to order by (see the tool description).'),
  orderType: z
    .enum(['asc', 'des'])
    .optional()
    .describe('asc or des (the manual spells descending "des").'),
  searchText: z.string().optional().describe('Filter results containing this text.'),
};

const listPartners = defineTool({
  name: 'vidsigner_mgmt_list_partners',
  title: 'List partners',
  domain: 'partners',
  api: 'mgmt',
  risk: 'read',
  endpoint: 'GET /partners',
  whenToUse: 'you need the partners visible to the management credentials (admin partners only).',
  docSummary: 'Lists the VIDsigner partners (management API). Only for "admin" partners.',
  notes: [
    'orderBy: PartnerGUID, PartnerName or PartnerLegalId.',
    'An empty list (404) is returned as an empty list.',
    'pageSize between 1 and 99.',
  ],
  description:
    'Lists the VIDsigner partners (MGMT API, GET /partners). Only for "admin" partners. orderBy: PartnerGUID, PartnerName or PartnerLegalId. An empty list (404) is returned as an empty array.',
  inputSchema: paginationShape,
  handler: async (args, ctx) => requireMgmt(ctx).listPartners(args),
});

const getPartner = defineTool({
  name: 'vidsigner_mgmt_get_partner',
  title: 'Get partner',
  domain: 'partners',
  api: 'mgmt',
  risk: 'read',
  endpoint: 'GET /partners/{partnerguid}',
  whenToUse: 'you need the data of one partner.',
  docSummary: 'Returns the data of a partner. A non-admin partner can only read itself.',
  description:
    'Returns the data of a partner (MGMT API, GET /partners/{partnerguid}). A non-admin partner can only read itself.',
  inputSchema: { partnerGuid: id('Partner GUID.') },
  handler: async ({ partnerGuid }, ctx) => requireMgmt(ctx).getPartner(partnerGuid),
});

export const partnerTools: AnyToolDefinition[] = [listPartners, getPartner];
