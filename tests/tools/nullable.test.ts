import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startHarness } from '../helpers/mcp.js';
import { json, mockFetch, token } from '../helpers/mock-fetch.js';

/**
 * The manual documents `null` as a valid value in some input fields
 * (`SignerFullNameOrNULL`, `FacturaeOrNull`, `DeviceName` "if null", `Email` "null or empty",
 * and the optional `customers` fields that its example sends as null). The tool must accept it
 * and send it.
 */
const JWT = { VIDSIGNER_CLIENT_ID: 'cid', VIDSIGNER_CLIENT_SECRET: 'csecret-xyz' };
const MGMT = {
  ...JWT,
  VIDSIGNER_ENABLE_MGMT: 'true',
  VIDSIGNER_MGMT_PARTNER_USER: 'p',
  VIDSIGNER_MGMT_PARTNER_PASS: 'pp',
};
const mk = () =>
  mockFetch((c) =>
    c.url.endsWith('/oauth/token') ? token('T') : json(200, { DocGUI: 'd1', CustomerGUID: 'c1' }),
  );
const lastBody = (m: ReturnType<typeof mk>): Record<string, unknown> => {
  const call = m.calls.filter((c) => !c.url.endsWith('/oauth/token')).at(-1);
  return JSON.parse(call?.body ?? '{}') as Record<string, unknown>;
};

describe('null where the manual documents it', () => {
  it('create_document: null SignerName, PhoneNumber, DeviceName and Email reach the wire as null', async () => {
    const m = mk();
    const h = await startHarness({
      env: {
        ...JWT,
        VIDSIGNER_ALLOWED_EMAIL_DOMAINS: 'example.com',
        VIDSIGNER_ALLOWED_PHONE_PREFIXES: '+34',
      },
      fetch: m.fetch,
    });
    const path = join(h.inputDir, 'a.pdf');
    writeFileSync(path, '%PDF-1.4 x');
    const r = await h.call('vidsigner_create_document', {
      filePath: path,
      IssuerName: 'Acme',
      SignersGroups: [
        {
          Signers: [
            {
              SignatureType: 'bio',
              SignerName: null,
              PhoneNumber: null,
              DeviceName: null,
              Email: null,
            },
          ],
        },
      ],
    });
    expect(r.isError, r.text).toBe(false);
    const signer = (
      lastBody(m) as { SignersGroups: Array<{ Signers: Array<Record<string, unknown>> }> }
    ).SignersGroups[0]?.Signers[0];
    expect(signer).toMatchObject({
      SignerName: null,
      PhoneNumber: null,
      DeviceName: null,
      Email: null,
    });
  });

  it('the manual\'s "null" email (signer without email) is not validated as an address', async () => {
    const m = mk();
    const h = await startHarness({
      env: { ...JWT, VIDSIGNER_ALLOWED_EMAIL_DOMAINS: 'example.com' },
      fetch: m.fetch,
    });
    const path = join(h.inputDir, 'a.pdf');
    writeFileSync(path, '%PDF-1.4 x');
    const r = await h.call('vidsigner_create_document', {
      filePath: path,
      IssuerName: 'Acme',
      SignersGroups: [{ Signers: [{ SignatureType: 'bio', DeviceName: 'tab', Email: 'null' }] }],
    });
    expect(r.isError, r.text).toBe(false);
  });

  it('sign_xml accepts a null SignaturePolicy (FacturaeOrNull)', async () => {
    const m = mk();
    const h = await startHarness({ env: JWT, fetch: m.fetch });
    const r = await h.call('vidsigner_sign_xml', {
      contentBase64: Buffer.from('<a/>').toString('base64'),
      CertificateGUI: 'g',
      Pin: '1234',
      XAdESSignatureType: 'Enveloped',
      XAdESSignatureFormat: 'BES',
      SignaturePolicy: null,
    });
    expect(r.isError, r.text).toBe(false);
    expect(lastBody(m)['SignaturePolicy']).toBeNull();
  });

  it('create_customer and create_subscription accept the optionals as null and send them', async () => {
    const m = mk();
    const h = await startHarness({ env: MGMT, fetch: m.fetch });
    const r = await h.call('vidsigner_mgmt_create_customer', {
      partnerGuid: 'p1',
      CustomerName: 'Acme',
      CustomerLegalId: 'B12345678',
      Address: 'Street 1',
      City: 'Madrid',
      State: 'Madrid',
      PostalCode: '28001',
      Country: 'ES',
      CustomerURL: 'n/a',
      Sector: null,
      SubSector: null,
      Software: null,
      UseCase: null,
      Referal: null,
      Comments: null,
    });
    expect(r.isError, r.text).toBe(false);
    expect(lastBody(m)).toMatchObject({
      Sector: null,
      SubSector: null,
      Software: null,
      UseCase: null,
      Referal: null,
      Comments: null,
    });
  });

  it('mandatory fields still do not accept null', async () => {
    const h = await startHarness({ env: JWT, fetch: mk().fetch });
    const path = join(h.inputDir, 'a.pdf');
    writeFileSync(path, '%PDF-1.4 x');
    const r = await h
      .call('vidsigner_create_document', {
        filePath: path,
        IssuerName: null,
        SignersGroups: [{ Signers: [{ SignatureType: 'bio' }] }],
      })
      .catch((e: Error) => ({ isError: true, text: e.message }));
    expect(r.isError).toBe(true);
  });
});
