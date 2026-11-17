import { z } from 'zod';
import { defineTool, type AnyToolDefinition } from '../define.js';
import { id } from '../schemas.js';
import { requireMgmt } from '../util.js';

const searchStatistics = defineTool({
  name: 'vidsigner_mgmt_search_statistics',
  title: 'Signature statistics',
  domain: 'statistics',
  api: 'mgmt',
  risk: 'read',
  endpoint: 'POST /subscription/{guid}/stats/search',
  whenToUse:
    'you need how many signatures a VIDmobile user, VIDstamper user or device made in a date range.',
  docSummary:
    'Counts the signatures made in a date range per VIDmobile user, VIDstamper user or device. It is read-only even though it uses POST.',
  notes: ['Dates use the yyyy/MM/dd format.'],
  example: {
    subscriptionGuid: '0b6f1d0e-1c2a-4c55-9d8e-3a1f5b7c9e21',
    From: '2026/01/01',
    To: '2026/01/31',
    Type: 'vidmobileuser',
  },
  description:
    'Counts the signatures done in a date range per VIDmobile user, VIDstamper user or device (MGMT API, POST /subscription/{guid}/stats/search). Read-only despite using POST. Dates use yyyy/MM/dd.',
  inputSchema: {
    subscriptionGuid: id('Subscription GUID.'),
    From: z
      .string()
      .regex(/^\d{4}\/\d{2}\/\d{2}$/)
      .describe('Start date, yyyy/MM/dd.'),
    To: z
      .string()
      .regex(/^\d{4}\/\d{2}\/\d{2}$/)
      .describe('End date, yyyy/MM/dd.'),
    Type: z
      .enum(['vidmobileuser', 'vidstamperuser', 'device'])
      .optional()
      .describe('Omit to search all types.'),
    Id: z
      .string()
      .optional()
      .describe(
        'ViDMobileUserGUID, ViDStamperUserGUID or DeviceName, depending on Type. Omit for all.',
      ),
  },
  handler: async ({ subscriptionGuid, ...search }, ctx) => {
    const items = await requireMgmt(ctx).searchStatistics(subscriptionGuid, search);
    return { count: items.length, items };
  },
});

export const statisticsTools: AnyToolDefinition[] = [searchStatistics];
