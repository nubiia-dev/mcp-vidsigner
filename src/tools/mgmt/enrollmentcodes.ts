import { z } from 'zod';
import { defineTool, type AnyToolDefinition } from '../define.js';
import { id } from '../schemas.js';
import { requireMgmt } from '../util.js';

const subscriptionGuid = id('Subscription GUID.');
const enrollmentGuid = id('Enrollment code GUID.');
const numberOfDevices = z
  .number()
  .int()
  .min(1)
  .describe('Number of devices that can enroll with the code.');

const listEnrollmentCodes = defineTool({
  name: 'vidsigner_mgmt_list_enrollment_codes',
  title: 'List enrollment codes',
  domain: 'enrollmentcodes',
  api: 'mgmt',
  risk: 'credential_read',
  endpoint: 'GET /subscription/{guid}/enrollmentcode',
  whenToUse:
    'you need the device enrollment codes of a subscription and how many devices each one still allows.',
  docSummary:
    'Lists the enrollment codes of a subscription with the available and enrolled devices.',
  notes: [
    'The codes are bearer credentials: whoever has one can enroll a device in the subscription.',
    'It requires VIDSIGNER_ALLOW_CREDENTIAL_READS, which is separate from VIDSIGNER_ALLOW_SIGNING_LINKS.',
  ],
  description:
    'Lists the enrollment codes of a subscription with available and enrolled devices (MGMT API). The codes are bearer credentials: whoever has one can enroll a device in the subscription.',
  inputSchema: { subscriptionGuid },
  handler: async ({ subscriptionGuid }, ctx) => {
    const items = await requireMgmt(ctx).listEnrollmentCodes(subscriptionGuid);
    return { count: items.length, items };
  },
});

const createEnrollmentCode = defineTool({
  name: 'vidsigner_mgmt_create_enrollment_code',
  title: 'Create enrollment code',
  domain: 'enrollmentcodes',
  api: 'mgmt',
  risk: 'write',
  endpoint: 'POST /subscription/{guid}/enrollmentcode',
  whenToUse: 'new signature devices (tablets) must be linked to a subscription.',
  docSummary:
    'Creates an enrollment code to link signature devices to a subscription. Returns the code and its GUID.',
  example: { subscriptionGuid: '0b6f1d0e-1c2a-4c55-9d8e-3a1f5b7c9e21', numberOfDevices: 2 },
  description:
    'Creates an enrollment code used to link signature devices to a subscription (MGMT API). Returns the code and its GUID.',
  inputSchema: { subscriptionGuid, numberOfDevices },
  handler: async ({ subscriptionGuid, numberOfDevices }, ctx) =>
    requireMgmt(ctx).createEnrollmentCode(subscriptionGuid, numberOfDevices),
});

const updateEnrollmentCode = defineTool({
  name: 'vidsigner_mgmt_update_enrollment_code',
  title: 'Update enrollment code',
  domain: 'enrollmentcodes',
  api: 'mgmt',
  risk: 'write',
  endpoint: 'PUT /enrollmentcodes/{guid}',
  whenToUse: 'the number of devices an enrollment code allows must change.',
  docSummary: 'Changes the number of devices an enrollment code allows.',
  example: { enrollmentGuid: '0b6f1d0e-1c2a-4c55-9d8e-3a1f5b7c9e21', numberOfDevices: 5 },
  description: 'Changes the number of devices allowed by an enrollment code (MGMT API).',
  inputSchema: { enrollmentGuid, numberOfDevices },
  handler: async ({ enrollmentGuid, numberOfDevices }, ctx) => {
    await requireMgmt(ctx).updateEnrollmentCode(enrollmentGuid, numberOfDevices);
    return { updated: true, enrollmentGuid, numberOfDevices };
  },
});

const deleteEnrollmentCode = defineTool({
  name: 'vidsigner_mgmt_delete_enrollment_code',
  title: 'Delete enrollment code',
  domain: 'enrollmentcodes',
  api: 'mgmt',
  risk: 'destructive',
  endpoint: 'DELETE /enrollmentcodes/{guid}',
  whenToUse: 'an enrollment code must stop being usable.',
  docSummary: 'Deletes an enrollment code.',
  notes: ['It is irreversible.'],
  example: { enrollmentGuid: '0b6f1d0e-1c2a-4c55-9d8e-3a1f5b7c9e21' },
  description: 'Deletes an enrollment code (MGMT API). Irreversible.',
  inputSchema: { enrollmentGuid },
  handler: async ({ enrollmentGuid }, ctx) => {
    await requireMgmt(ctx).deleteEnrollmentCode(enrollmentGuid);
    return { deleted: true, enrollmentGuid };
  },
});

export const enrollmentCodeTools: AnyToolDefinition[] = [
  listEnrollmentCodes,
  createEnrollmentCode,
  updateEnrollmentCode,
  deleteEnrollmentCode,
];
