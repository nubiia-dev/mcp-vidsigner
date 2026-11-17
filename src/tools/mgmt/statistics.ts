import { z } from 'zod';
import { VidSignerError } from '../../client/errors.js';
import { defineTool, type AnyToolDefinition } from '../define.js';
import { id } from '../schemas.js';
import { requireMgmt } from '../util.js';

/**
 * dd/MM/yyyy (what the API parses), yyyy/MM/dd (the manual) or yyyy-MM-dd (ISO). One separator per
 * date: `2026/11-01` is rejected instead of being guessed.
 */
const statsDate = z.string().regex(/^(\d{2}\/\d{2}\/\d{4}|\d{4}\/\d{2}\/\d{2}|\d{4}-\d{2}-\d{2})$/);

/**
 * Converts a statistics date to the dd/MM/yyyy form the API parses (a `yyyy/MM/dd` value, which is the
 * manual's, is rejected by pre-production with 400 "Date From is not correct"). Rejects dates that do
 * not exist (31/02/2026, 13th month...) before calling the API.
 */
export function toApiDate(value: string, field: string): string {
  const m = /^(\d{4})[/-](\d{2})[/-](\d{2})$/.exec(value);
  const [d, mo, y] = m
    ? [m[3] as string, m[2] as string, m[1] as string]
    : (value.split('/') as [string, string, string]);
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (
    date.getUTCFullYear() !== Number(y) ||
    date.getUTCMonth() !== Number(mo) - 1 ||
    date.getUTCDate() !== Number(d)
  ) {
    throw new VidSignerError({
      kind: 'validation',
      message: `${field} is not a real date: ${value}.`,
    });
  }
  return `${d}/${mo}/${y}`;
}

/**
 * Rejects a range whose start is after its end. Both arguments are already in the dd/MM/yyyy form
 * that {@link toApiDate} returns, so they are compared as yyyyMMdd numbers.
 */
export function assertDateRange(from: string, to: string): void {
  const key = (v: string): string => v.split('/').reverse().join('');
  if (key(from) > key(to)) {
    throw new VidSignerError({
      kind: 'validation',
      message: `From (${from}) must not be after To (${to}).`,
    });
  }
}

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
  notes: [
    'Dates: the API of pre-production only accepts dd/MM/yyyy (verified on 17/11/2026: "01/11/2026" answers 200, while the manual example format "2017/01/01" and ISO "2026-11-01" answer 400 "Date From is not correct"). The tool also accepts yyyy/MM/dd and yyyy-MM-dd and converts them to dd/MM/yyyy before sending.',
    'An empty range returns an empty list. subscriptionGuid must be the GUID of your own subscription (403 otherwise, and the name is not accepted).',
  ],
  example: {
    subscriptionGuid: '0b6f1d0e-1c2a-4c55-9d8e-3a1f5b7c9e21',
    From: '01/01/2026',
    To: '31/01/2026',
    Type: 'vidmobileuser',
  },
  description:
    'Counts the signatures done in a date range per VIDmobile user, VIDstamper user or device (MGMT API, POST /subscription/{guid}/stats/search). Read-only despite using POST. Dates must be dd/MM/yyyy (verified in pre-production; the yyyy/MM/dd of the manual is rejected with 400): yyyy/MM/dd and yyyy-MM-dd are accepted here and converted to dd/MM/yyyy.',
  inputSchema: {
    subscriptionGuid: id('Subscription GUID.'),
    From: statsDate.describe(
      'Start date, dd/MM/yyyy (the format the API accepts; yyyy/MM/dd and yyyy-MM-dd are converted).',
    ),
    To: statsDate.describe(
      'End date, dd/MM/yyyy (the format the API accepts; yyyy/MM/dd and yyyy-MM-dd are converted).',
    ),
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
  handler: async ({ subscriptionGuid, From, To, ...rest }, ctx) => {
    const search = { ...rest, From: toApiDate(From, 'From'), To: toApiDate(To, 'To') };
    assertDateRange(search.From, search.To);
    const items = await requireMgmt(ctx).searchStatistics(subscriptionGuid, search);
    return { count: items.length, items };
  },
});

export const statisticsTools: AnyToolDefinition[] = [searchStatistics];
