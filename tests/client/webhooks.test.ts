import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  WEBHOOK_EVENT_TYPES,
  parseWebhookPath,
  type DocumentNotificationPayload,
  type WebhookEvent,
} from '../../src/client/webhooks.js';

describe('webhooks: types and helpers', () => {
  it('lists the nine events of Annex I', () => {
    expect([...WEBHOOK_EVENT_TYPES].sort()).toEqual(
      [
        'approverstatus',
        'batchstatus',
        'createddocstatus',
        'docstatus',
        'edeliverystatus',
        'emailstatus',
        'expireddocstatus',
        'mingroupstatus',
        'signerstatus',
      ].sort(),
    );
  });

  it('parseWebhookPath extracts the event and GUID', () => {
    expect(parseWebhookPath('/vidsigner/hooks/signerstatus/e95dd99d-6401')).toEqual({
      event: 'signerstatus',
      guid: 'e95dd99d-6401',
    });
    expect(parseWebhookPath('/docstatus/')).toEqual({ event: 'docstatus' });
    expect(parseWebhookPath('/x/BatchStatus/b1?x=1')).toEqual({ event: 'batchstatus', guid: 'b1' });
    expect(parseWebhookPath('/other/path')).toBeUndefined();
  });

  it('the manual example payload fits the type', () => {
    const payload: DocumentNotificationPayload = {
      FileName: 'DocFileName.pdf',
      DocGUI: 'doc-1',
      DocStatus: 'Signed',
      Downloaded: false,
      AdditionalData: 'x',
      OrderedGroups: false,
      SignersGroups: [
        {
          Min: 1,
          Max: 1,
          OrderedSignatures: false,
          Signers: [
            {
              SignerGUI: 's1',
              SignatureStatus: 'Signed',
              SignatureType: 'emailandsms',
              OperationTime: '2026-11-16 10:00:00',
              Evidences: [{ EvidenceType: 'SMS_SENT', EvidenceDate: '2026-11-16 09:59:00' }],
              FormInfo: {
                Sections: [
                  { Groups: [{ Title: 'g', TextBoxes: [{ Id: 't', Response: 'hola' }] }] },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(payload.SignersGroups?.[0]?.Signers[0]?.SignatureStatus).toBe('Signed');
  });

  it('WebhookEvent discriminates the payload by event', () => {
    const ev = {
      event: 'batchstatus',
      payload: { BatchStatus: 'Completed', Docs: [{ DocGUI: 'a', Status: 'Signed' }] },
    } as WebhookEvent;
    if (ev.event === 'batchstatus') expectTypeOf(ev.payload.Docs).toBeArray();
    if (ev.event === 'emailstatus') expectTypeOf(ev.payload.SignerGUID).toBeString();
    expect(ev.event).toBe('batchstatus');
  });
});
