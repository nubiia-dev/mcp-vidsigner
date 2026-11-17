import { z } from 'zod';
import { defineTool, type AnyToolDefinition } from '../define.js';
import { id } from '../schemas.js';
import { requireMgmt } from '../util.js';

const deviceName = id('Device name, as returned by vidsigner_list_devices.');

const updateDevice = defineTool({
  name: 'vidsigner_mgmt_update_device',
  title: 'Update device description',
  domain: 'mgmt-devices',
  api: 'mgmt',
  risk: 'write',
  endpoint: 'PUT /devices/{DeviceName}',
  whenToUse: 'the description of a signature tablet must change.',
  docSummary: 'Changes the description of a signature device. Only the description can be updated.',
  example: { deviceName: 'Tablet-Reception', deviceDescription: 'Reception tablet, floor 1' },
  description:
    'Changes the description of a signature device (MGMT API). Only the description can be updated.',
  inputSchema: {
    deviceName,
    deviceDescription: z.string().min(1).describe('New description of the device.'),
  },
  handler: async ({ deviceName, deviceDescription }, ctx) => {
    await requireMgmt(ctx).updateDevice(deviceName, deviceDescription);
    return { updated: true, deviceName };
  },
});

const deleteDevice = defineTool({
  name: 'vidsigner_mgmt_delete_device',
  title: 'Delete device',
  domain: 'mgmt-devices',
  api: 'mgmt',
  risk: 'destructive',
  endpoint: 'DELETE /devices/{DeviceName}',
  whenToUse: 'a signature tablet must be removed from the subscription.',
  docSummary: 'Deletes a signature device.',
  notes: ['Only if it has no assigned documents (otherwise 409).', 'It is irreversible.'],
  example: { deviceName: 'Tablet-Reception' },
  description:
    'Deletes a signature device (MGMT API). Only if it has no assigned documents (otherwise 409). Irreversible.',
  inputSchema: { deviceName },
  handler: async ({ deviceName }, ctx) => {
    await requireMgmt(ctx).deleteDevice(deviceName);
    return { deleted: true, deviceName };
  },
});

export const mgmtDeviceTools: AnyToolDefinition[] = [updateDevice, deleteDevice];
