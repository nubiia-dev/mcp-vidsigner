import { z } from 'zod';
import { defineTool, type AnyToolDefinition } from '../define.js';
import { IMAGE, P12 } from '../files.js';
import { fileInputShape, id } from '../schemas.js';
import { hideSecrets, requireMgmt } from '../util.js';
import { BASIC_NOTE, legalIdParam, subscriptionGuidParam } from './vidmobileusers.js';

const listUserCerts = defineTool({
  name: 'vidsigner_mgmt_list_vidmobile_user_certificates',
  title: 'List VIDmobile user certificates',
  domain: 'certificates',
  api: 'mgmt',
  risk: 'read',
  endpoint: 'GET /vidmobileusers/{legalid}/certs',
  whenToUse: 'you need the certificates of a VIDmobile user (alias, type, DN, expiration).',
  docSummary:
    'Lists the certificates of a VIDmobile user: alias, type (Software, KeyVault, FirmaRemota), DN and expiration.',
  description: `Lists the certificates of a VIDmobile user: alias, type (Software, KeyVault, FirmaRemota), DN, expiration (MGMT API). ${BASIC_NOTE}`,
  inputSchema: { legalId: legalIdParam },
  handler: async ({ legalId }, ctx) => {
    const items = await requireMgmt(ctx).listVidMobileUserCertificates(legalId);
    return { count: items.length, items };
  },
});

const addUserCert = defineTool({
  name: 'vidsigner_mgmt_add_vidmobile_user_certificate',
  title: 'Upload certificate to a VIDmobile user',
  domain: 'certificates',
  api: 'mgmt',
  risk: 'write',
  endpoint: 'POST /vidmobileusers/{legalid}/certs',
  whenToUse: 'a PKCS#12 certificate must be uploaded to a VIDmobile user.',
  docSummary: 'Uploads a PKCS#12 certificate (.p12 or .pfx) to a VIDmobile user.',
  notes: ['The PIN travels in the arguments of the call.', 'Accepts filePath or contentBase64.'],
  example: {
    legalId: '12345678Z',
    filePath: '/Users/me/vidsigner-mcp/in/certificate.p12',
    certalias: 'Jane Doe certificate',
    pin: '1234',
    certtype: 'Software',
  },
  description: `Uploads a PKCS#12 (.p12/.pfx) certificate to a VIDmobile user (MGMT API). ${BASIC_NOTE} The PIN travels in the arguments of this call. Accepts a local file or base64.`,
  inputSchema: {
    legalId: legalIdParam,
    ...fileInputShape,
    certalias: z.string().describe('Certificate alias.'),
    pin: z.string().describe('PIN of the private key.'),
    certtype: z.enum(['Software', 'KeyVault']).optional().describe('Default Software.'),
    dynamicpin: z.boolean().optional().describe('KeyVault only: send an OTP to the user mobile.'),
  },
  handler: async ({ legalId, filePath, contentBase64, ...cert }, ctx) => {
    const p12 = await ctx.files.loadInput({ filePath, contentBase64 }, P12);
    return hideSecrets(
      await requireMgmt(ctx).addVidMobileUserCertificate(legalId, { ...cert, p12: p12.base64 }),
    );
  },
});

const deleteUserCert = defineTool({
  name: 'vidsigner_mgmt_delete_vidmobile_user_certificate',
  title: 'Delete VIDmobile user certificate',
  domain: 'certificates',
  api: 'mgmt',
  risk: 'destructive',
  endpoint: 'DELETE /vidmobileusers/{legalid}/certs/{certid}',
  whenToUse: 'a certificate of a VIDmobile user must be removed.',
  docSummary: 'Deletes a certificate of a VIDmobile user.',
  notes: ['It is irreversible.'],
  example: { legalId: '12345678Z', certId: '0b6f1d0e-1c2a-4c55-9d8e-3a1f5b7c9e21' },
  description: `Deletes a certificate of a VIDmobile user (MGMT API). ${BASIC_NOTE} Irreversible.`,
  inputSchema: { legalId: legalIdParam, certId: id('Certificate GUID, as returned by the list.') },
  handler: async ({ legalId, certId }, ctx) => {
    await requireMgmt(ctx).deleteVidMobileUserCertificate(legalId, certId);
    return { deleted: true };
  },
});

const setCertTypes = defineTool({
  name: 'vidsigner_mgmt_set_vidmobile_user_cert_types',
  title: 'Set allowed certificate types of a VIDmobile user',
  domain: 'certificates',
  api: 'mgmt',
  risk: 'write',
  endpoint: 'PUT /vidmobileusers/{legalid}/certstype',
  whenToUse:
    'you must choose which certificate types (software, key vault, remote signature) a VIDmobile user may use.',
  docSummary: 'Chooses the certificate types a VIDmobile user may use.',
  example: { legalId: '12345678Z', Software: true, KeyVault: false, FirmaRemota: false },
  description: `Chooses which certificate types the VIDmobile user may use (MGMT API). ${BASIC_NOTE}`,
  inputSchema: {
    legalId: legalIdParam,
    Software: z.boolean().describe('Allow software certificates (.p12 uploaded to VIDsigner).'),
    KeyVault: z.boolean().describe('Allow key-vault certificates.'),
    FirmaRemota: z.boolean().describe('Allow remote-signature (qualified remote) certificates.'),
  },
  handler: async ({ legalId, ...types }, ctx) => {
    await requireMgmt(ctx).setVidMobileUserCertTypes(legalId, types);
    return { updated: true, types };
  },
});

const listStamp = defineTool({
  name: 'vidsigner_mgmt_list_stamp_certificates',
  title: 'List stamp certificates',
  domain: 'certificates',
  api: 'mgmt',
  risk: 'read',
  endpoint: 'GET /subscription/{guid}/stampcertificates',
  whenToUse: 'you need the automatic-stamp certificates configured in a subscription.',
  docSummary: 'Lists the automatic-stamp certificates of a subscription (subscription scope).',
  description:
    'Lists the automatic-stamp certificates configured in a subscription (MGMT API, subscription scope).',
  inputSchema: { subscriptionGuid: subscriptionGuidParam },
  handler: async ({ subscriptionGuid }, ctx) => {
    const items = await requireMgmt(ctx).listStampCertificates(subscriptionGuid);
    return { count: items.length, items };
  },
});

const addStamp = defineTool({
  name: 'vidsigner_mgmt_add_stamp_certificate',
  title: 'Upload stamp certificate',
  domain: 'certificates',
  api: 'mgmt',
  risk: 'write',
  endpoint: 'POST /subscription/{guid}/stampcertificates',
  whenToUse:
    'an automatic-stamp certificate and its stamp image must be uploaded to a subscription.',
  docSummary:
    'Uploads an automatic-stamp certificate (.p12 or .pfx) and the image stamped on the document.',
  notes: [
    'The subscription must be authorised to upload certificates (otherwise 400).',
    'The PIN travels in the arguments of the call.',
    'Certificate and image accept a local path or base64.',
  ],
  example: {
    subscriptionGuid: '0b6f1d0e-1c2a-4c55-9d8e-3a1f5b7c9e21',
    certFilePath: '/Users/me/vidsigner-mcp/in/seal.p12',
    imageFilePath: '/Users/me/vidsigner-mcp/in/seal.png',
    Pin: '1234',
    Description: 'Acme company seal',
  },
  description:
    'Uploads an automatic-stamp certificate (.p12/.pfx) and the image to stamp on the document (MGMT API, subscription scope). The subscription must be authorised to post certificates (else 400). The PIN travels in the arguments of this call. Certificate and image accept a local file or base64.',
  inputSchema: {
    subscriptionGuid: subscriptionGuidParam,
    certFilePath: z
      .string()
      .optional()
      .describe('Local .p12/.pfx path. Provide exactly one of certFilePath / certBase64.'),
    certBase64: z
      .string()
      .optional()
      .describe(
        'PKCS#12 certificate encoded in Base64. Provide exactly one of certFilePath / certBase64.',
      ),
    imageFilePath: z
      .string()
      .optional()
      .describe(
        'Local PNG/JPG path of the stamp image. Provide exactly one of imageFilePath / imageBase64.',
      ),
    imageBase64: z
      .string()
      .optional()
      .describe(
        'Stamp image (PNG/JPG) encoded in Base64. Provide exactly one of imageFilePath / imageBase64.',
      ),
    Pin: z.string().describe('PIN of the certificate private key (a secret).'),
    Description: z.string().describe('Friendly name of the certificate.'),
  },
  handler: async (
    { subscriptionGuid, certFilePath, certBase64, imageFilePath, imageBase64, Pin, Description },
    ctx,
  ) => {
    const cert = await ctx.files.loadInput(
      { filePath: certFilePath, contentBase64: certBase64 },
      P12,
    );
    const image = await ctx.files.loadInput(
      { filePath: imageFilePath, contentBase64: imageBase64 },
      IMAGE,
    );
    return hideSecrets(
      await requireMgmt(ctx).addStampCertificate(subscriptionGuid, {
        CertificateBase64: cert.base64,
        Image: image.base64,
        Pin,
        Description,
      }),
    );
  },
});

export const certificateTools: AnyToolDefinition[] = [
  listUserCerts,
  addUserCert,
  deleteUserCert,
  setCertTypes,
  listStamp,
  addStamp,
];
