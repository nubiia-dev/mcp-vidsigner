import { defineTool, type AnyToolDefinition } from '../define.js';
import { id } from '../schemas.js';

const listDevices = defineTool({
  name: 'vidsigner_list_devices',
  title: 'List signature devices',
  domain: 'devices',
  api: 'rest',
  risk: 'read',
  endpoint: 'GET /devices',
  whenToUse:
    'you need the signature tablets enrolled in the subscription, for example to pick DeviceName for a signer.',
  docSummary: 'Lists the signature tablets enrolled in the subscription.',
  notes: [
    'A subscription without tablets answers 404/70001, which is returned as an empty list.',
    'Works with Basic credentials.',
  ],
  description:
    'Lists the signature devices (tablets) enrolled in the subscription (GET /devices). A subscription without tablets answers 404/70001, which is returned as an empty list. Works with Basic credentials.',
  inputSchema: {},
  handler: async (_args, { rest }) => {
    const items = await rest.getDevices();
    return { count: items.length, items };
  },
});

const listEnrollmentCodeDevices = defineTool({
  name: 'vidsigner_list_enrollment_code_devices',
  title: 'List devices of an enrollment code',
  domain: 'devices',
  api: 'rest',
  risk: 'read',
  endpoint: 'GET /enrollmentcodes/{id}/devices',
  whenToUse: 'you need the devices enrolled with one enrollment code.',
  docSummary: 'Lists the devices enrolled with a specific enrollment code.',
  notes: [
    'Only in the OpenAPI.',
    'Passing the enrollment code TEXT (e.g. "enrollxxxx") answered 403/20301 "has no access to EnrollmentCode" in pre-production: the id probably has to be the GUID of the enrollment code, which only the management API (partner credentials) returns. Not verified with a GUID.',
  ],
  description:
    'Lists the devices enrolled with a given enrollment code (GET /enrollmentcodes/{id}/devices). Only in the OpenAPI. Called with the enrollment code text it answered 403/20301 in pre-production; the id is probably the GUID of the code (from the management API, partner credentials), not verified.',
  inputSchema: { enrollmentCodeId: id('Enrollment code identifier.') },
  handler: async ({ enrollmentCodeId }, { rest }) => {
    const items = await rest.listEnrollmentCodeDevices(enrollmentCodeId);
    return { count: items.length, items };
  },
});

export const deviceTools: AnyToolDefinition[] = [listDevices, listEnrollmentCodeDevices];
