import { z } from 'zod';
import type { EDeliveryInput } from '../../client/types.js';
import { defineTool, type AnyToolDefinition } from '../define.js';
import { PDF, withExtension } from '../files.js';
import { strictObject } from '../schema-kit.js';
import { eDeliveryShape } from '../generated/body-schemas.js';
import { edeliveryGuid, fileInputShape, outputFileName, reportLang } from '../schemas.js';

const createEDelivery = defineTool({
  name: 'vidsigner_create_edelivery',
  title: 'Send certified e-delivery',
  domain: 'edelivery',
  api: 'rest',
  risk: 'write',
  endpoint: 'POST /edeliveries',
  whenToUse:
    'you must send a PDF as a certified notification with delivery evidence (the recipient gets an email and an OTP by SMS).',
  docSummary:
    'Sends a document as a certified notification (e-delivery) with evidence of delivery to the recipient.',
  notes: [
    'Sends a real email and SMS (OTP) to the recipient.',
    'Requires JWT and the E-Delivery product on the subscription.',
    'RecipientEmailAddress is mandatory and validated (empty and "null" are rejected).',
    'Accepts filePath or contentBase64.',
  ],
  example: {
    filePath: '/Users/me/vidsigner-mcp/in/notification.pdf',
    RecipientEmailAddress: 'recipient@example.test',
    RecipientPhoneNumber: '+34600111222',
    Language: 'es',
    IssuerName: 'Acme',
  },
  description: [
    'Sends a document as a certified notification (E-Delivery) with delivery evidence (POST /edeliveries).',
    'SENDS A REAL EMAIL (and an OTP by SMS) to the recipient. Use only test recipients in pre-production.',
    'Requires JWT and the E-Delivery product on the subscription. Accepts a local PDF path or base64.',
  ].join(' '),
  inputSchema: {
    ...fileInputShape,
    ...eDeliveryShape,
  },
  handler: async ({ filePath, contentBase64, FileName, ...rest_ }, { rest, files, policy }) => {
    const clean = policy.normalizeBody(rest_);
    const input = await files.loadInput({ filePath, contentBase64 }, PDF);
    const body = {
      ...clean,
      FileName: FileName ?? input.fileName ?? 'document.pdf',
    } as unknown as EDeliveryInput;
    const res = await rest.createEDelivery(body, input.base64);
    // The OpenAPI answers `GUID` and the manual (14.25) `DocGUI`: the client returns both.
    return { ...res, GUID: res.GUID ?? res.DocGUI, uploadedBytes: input.bytes };
  },
});

const listEDeliveries = defineTool({
  name: 'vidsigner_list_edeliveries',
  title: 'List e-deliveries',
  domain: 'edelivery',
  api: 'rest',
  risk: 'read',
  endpoint: 'GET /edeliveries',
  whenToUse: 'you need an overview of the e-deliveries sent from the subscription.',
  docSummary:
    'Lists the e-deliveries sent from the subscription: GUID, recipient, status and dates.',
  description:
    'Lists the e-deliveries sent from the subscription (GET /edeliveries): GUID, recipient, status and dates.',
  inputSchema: {},
  handler: async (_args, { rest }) => {
    const items = await rest.listEDeliveries();
    return { count: items.length, items };
  },
});

const getEDelivery = defineTool({
  name: 'vidsigner_get_edelivery',
  title: 'Get e-delivery information',
  domain: 'edelivery',
  api: 'rest',
  risk: 'read',
  endpoint: 'GET /edeliveries/{guid}',
  whenToUse: 'you need the status, documents, evidences and reminders of one e-delivery.',
  docSummary:
    'Returns the full information of an e-delivery: status (pending, delivered, expired), documents, evidences and reminders.',
  example: { edeliveryGuid: '0b6f1d0e-1c2a-4c55-9d8e-3a1f5b7c9e21' },
  description:
    'Returns the full information of an e-delivery: status (pending, delivered, expired), documents, evidences and reminder state (GET /edeliveries/{guid}).',
  inputSchema: { edeliveryGuid },
  handler: async ({ edeliveryGuid }, { rest }) => rest.getEDelivery(edeliveryGuid),
});

const deleteEDelivery = defineTool({
  name: 'vidsigner_delete_edelivery',
  title: 'Delete e-delivery',
  domain: 'edelivery',
  api: 'rest',
  risk: 'destructive',
  endpoint: 'DELETE /edeliveries/{guid}',
  whenToUse: 'an e-delivery must be removed for good.',
  docSummary: 'Permanently deletes an e-delivery.',
  notes: ['It is irreversible.'],
  example: { edeliveryGuid: '0b6f1d0e-1c2a-4c55-9d8e-3a1f5b7c9e21' },
  description: 'Permanently deletes an e-delivery (DELETE /edeliveries/{guid}).',
  inputSchema: { edeliveryGuid },
  handler: async ({ edeliveryGuid }, { rest }) => {
    await rest.deleteEDelivery(edeliveryGuid);
    return { deleted: true, edeliveryGuid };
  },
});

const getEDeliveryReport = defineTool({
  name: 'vidsigner_get_edelivery_report',
  title: 'Download e-delivery evidence report',
  domain: 'edelivery',
  api: 'rest',
  risk: 'read',
  endpoint: 'GET /edeliveries/{guid}/report/{lang}',
  whenToUse: 'you need the PDF evidence report of an e-delivery.',
  docSummary:
    'Generates the PDF evidence report of an e-delivery in the chosen language and saves it to disk.',
  notes: ['Returns the path, never the base64.'],
  description:
    'Generates the PDF evidence report of an e-delivery in the chosen language and saves it to disk (GET /edeliveries/{guid}/report/{lang}). Returns the path, never the base64.',
  inputSchema: { edeliveryGuid, lang: reportLang, outputFileName },
  handler: async ({ edeliveryGuid, lang, outputFileName }, { rest, files }) => {
    const report = await rest.getEDeliveryReport(edeliveryGuid, lang);
    if (!report.DocContent) return { savedTo: null, note: 'The response has no DocContent.' };
    const saved = await files.saveBase64(
      report.DocContent,
      withExtension(outputFileName ?? `edelivery-report-${edeliveryGuid}-${lang}`, '.pdf'),
    );
    return { savedTo: saved.path, bytes: saved.bytes, sha256: saved.sha256, lang };
  },
});

const sendEDeliveryReminder = defineTool({
  name: 'vidsigner_send_edelivery_reminder',
  title: 'Send e-delivery reminder',
  domain: 'edelivery',
  api: 'rest',
  risk: 'write',
  endpoint: 'PUT /edeliveries/{guid}/reminders',
  whenToUse: 'the recipient of a pending e-delivery must be reminded by email or SMS.',
  docSummary: 'Sends a new reminder to the recipient of an e-delivery by email or SMS.',
  notes: [
    'Sends a real message.',
    'It is not retried automatically.',
    'The destination and texts go through the recipient policy.',
  ],
  example: {
    edeliveryGuid: '0b6f1d0e-1c2a-4c55-9d8e-3a1f5b7c9e21',
    Channel: 'email',
    Destination: 'recipient@example.test',
  },
  description:
    'Sends a new reminder to the e-delivery recipient by email or SMS (PUT /edeliveries/{guid}/reminders). SENDS A REAL MESSAGE. Not retried automatically.',
  inputSchema: {
    edeliveryGuid,
    Channel: z.enum(['email', 'sms']).describe('Delivery channel of the reminder.'),
    Destination: z
      .string()
      .optional()
      .describe('Email address or E.164 phone. Defaults to the one stored for the e-delivery.'),
    EmailNotification: strictObject({
      Body: z.string().optional().describe('Custom body of the reminder email.'),
      Subject: z.string().optional().describe('Custom subject of the reminder email.'),
    })
      .optional()
      .describe('Custom subject/body of the reminder email.'),
  },
  handler: async ({ edeliveryGuid, ...channel }, { rest, policy }) => {
    const clean = policy.normalizeBody(channel);
    const destination = policy.assertChannelDestination(channel.Channel, channel.Destination);
    await rest.sendEDeliveryReminder(edeliveryGuid, {
      ...clean,
      ...(destination !== undefined ? { Destination: destination } : {}),
    });
    return { sent: true, channel: channel.Channel };
  },
});

const searchEDeliveries = defineTool({
  name: 'vidsigner_search_edeliveries',
  title: 'Search e-deliveries',
  domain: 'edelivery',
  api: 'rest',
  risk: 'read',
  endpoint: 'POST /edeliveries/search',
  whenToUse: 'you need to filter e-deliveries by status or other terms, for example pending ones.',
  docSummary:
    'Searches e-deliveries by terms, for example {"status":"pending"}. It is a read-only search even though it uses POST.',
  notes: [
    'Unsupported term combinations answer 400/10608.',
    'Not verified with Basic credentials.',
  ],
  description:
    'Searches e-deliveries by terms, e.g. {"status":"pending"} (POST /edeliveries/search). It is a read-only search despite using POST. Unsupported term combinations answer 400/10608. Not verified with Basic credentials.',
  inputSchema: {
    terms: z
      .record(z.string(), z.string())
      .describe(
        'Search terms as key/value pairs, e.g. {"status":"pending"}. See manual section 14.31 for combinations.',
      ),
  },
  handler: async ({ terms }, { rest }) => {
    const items = await rest.searchEDeliveries({ Terms: terms });
    return { count: items.length, items };
  },
});

export const edeliveryTools: AnyToolDefinition[] = [
  createEDelivery,
  listEDeliveries,
  getEDelivery,
  deleteEDelivery,
  getEDeliveryReport,
  sendEDeliveryReminder,
  searchEDeliveries,
];
