import { z } from 'zod';
import { appendReturnUrl } from '../../client/vidsigner-client.js';
import { defineTool, type AnyToolDefinition } from '../define.js';
import { PDF } from '../files.js';
import { fileInputShape, id, signerGuid } from '../schemas.js';
import { strictObject } from '../schema-kit.js';

const getSignatureUrl = defineTool({
  name: 'vidsigner_get_signature_url',
  title: 'Get VIDremote signing link',
  domain: 'signature',
  api: 'rest',
  risk: 'sensitive_read',
  endpoint: 'GET /signature/{SignerGUID}/vidremoteurl',
  whenToUse:
    'a remote signer was created with SkipSignatureEmail=true and you need their signing link to hand over by your own means.',
  docSummary:
    'Returns the VIDremote signing link of a signer, to hand over through your own channel.',
  notes: [
    'Only works if the signer was created with SkipSignatureEmail=true (otherwise 409/16601) and the subscription has the AllowSkipEmail permission (otherwise 409/40111).',
    'Every call records the evidence SIGNATUREURL_RETRIEVED in the report of the document (not documented by the vendor): do not call it exploratively or repeatedly.',
    'The URL is stable per signer (it is the same one the resend email carries) and it cannot be rotated.',
    'ORDERED signing (OrderedGroups=true): the link of a signer who is not next in line answers 409 with code 0 "Is no next signature" until the signer before them has signed (verified in pre-production: the first signer gets the URL, the second one the 409). Ask again once the previous signer has signed; the error carries a hint.',
    'EXPIRED document: the API still returns a URL for it (verified in pre-production after vidsigner_expire_document; the document stays Unsigned, see that tool). Whether the link still lets someone sign was NOT verified because links are never opened here: do not hand out the link of an expired document.',
    'With emailandsms the signer must also pass the OTP: the link is the first factor, not the only one, unless the signer was created with AllowEmptyPhoneNumber.',
    'The link is a bearer credential: anyone who opens it can start the signing. Hand it only to the signer.',
    'returnUrl is validated against the notification destination policy.',
  ],
  example: { signerGuid: '5c1e8a42-7d3b-4f10-8b6a-2e9d0c4a7f13' },
  description: [
    'Returns the VIDremote signing link of a signer (GET /signature/{SignerGUID}/vidremoteurl).',
    'Only works if the signer was created with SkipSignatureEmail=true; otherwise 409/16601. The subscription also needs AllowSkipEmail (otherwise 409/40111).',
    'Each call leaves the evidence SIGNATUREURL_RETRIEVED in the report of the document (undocumented by the vendor), so never call it exploratively or repeatedly.',
    'The URL is stable per signer (the same one as in the resend email) and cannot be rotated.',
    'In an ordered flow the second signer gets 409 "Is no next signature" until the first has signed. On an expired document the API still returns a URL (not opened, so its usability is unverified): do not hand it out.',
    'With emailandsms the signer must also pass the OTP, so the link is the first factor, not the only one (except with AllowEmptyPhoneNumber).',
    'Optionally appends url_return (Base64) so the signer is redirected there afterwards.',
    'The link is a bearer credential: anyone who opens it can start the signing. Never open it from here; hand it only to the intended signer.',
  ].join(' '),
  inputSchema: {
    signerGuid,
    returnUrl: z
      .string()
      .url()
      .optional()
      .describe('URL to redirect the signer to when finished or rejected.'),
  },
  handler: async ({ signerGuid, returnUrl }, { rest, policy }) => {
    policy.assertUrl(returnUrl, 'returnUrl');
    const res = await rest.getSignatureRemoteUrl(signerGuid);
    const url = res.SignatureViDRemoteURL;
    if (!url) return { url: null, note: 'The response has no URL.' };
    return {
      url: returnUrl ? appendReturnUrl(url, returnUrl) : url,
      returnUrlAppended: !!returnUrl,
    };
  },
});

const sendSignatureUrl = defineTool({
  name: 'vidsigner_send_signature_url',
  title: 'Send signing link reminder by email/SMS',
  domain: 'signature',
  api: 'rest',
  risk: 'write',
  endpoint: 'PUT /signature/{SignerGUID}/vidremoteurl',
  whenToUse: 'a remote signer has not signed yet and needs the signing link again by email or SMS.',
  docSummary: 'Resends the VIDremote signing link to the signer by email or SMS.',
  notes: [
    'Sends a real message to the signer.',
    'The evidence recorded on the document is EMAIL_RESENT for the email channel and REMINDER_SENT for the SMS channel (verified in pre-production).',
    'Only for pending remote signatures. It also works on documents created with SkipSignatureEmail=true (verified in pre-production: 200 without body, evidence EMAIL_RESENT).',
    'It is not retried automatically.',
    'The destination and texts go through the recipient policy.',
  ],
  example: {
    signerGuid: '5c1e8a42-7d3b-4f10-8b6a-2e9d0c4a7f13',
    Channel: 'email',
    Destination: 'jane@example.test',
  },
  description:
    'Resends the signing link (VIDremote) to the signer by email or SMS (PUT /signature/{SignerGUID}/vidremoteurl). SENDS A REAL MESSAGE to the signer. Only for remote signatures that are still unsigned; it also works on documents created with SkipSignatureEmail=true.',
  inputSchema: {
    signerGuid,
    Channel: z.enum(['email', 'sms']).describe('Delivery channel.'),
    Destination: z
      .string()
      .optional()
      .describe('Email address or E.164 phone. Defaults to the one stored for the signer.'),
    EmailNotification: strictObject({
      eMailBody: z.string().optional().describe('Custom body of the email.'),
      eMailSubject: z.string().optional().describe('Custom subject of the email.'),
    })
      .optional()
      .describe('Custom email subject/body.'),
  },
  handler: async ({ signerGuid, ...channel }, { rest, policy }) => {
    const clean = policy.normalizeBody(channel);
    const destination = policy.assertChannelDestination(channel.Channel, channel.Destination);
    await rest.sendSignatureRemoteUrl(signerGuid, {
      ...clean,
      ...(destination !== undefined ? { Destination: destination } : {}),
    });
    return { sent: true, channel: channel.Channel };
  },
});

const addSignatureAttachment = defineTool({
  name: 'vidsigner_add_signature_attachment',
  title: 'Attach a document to a signer',
  domain: 'signature',
  api: 'rest',
  risk: 'write',
  endpoint: 'POST /signature/{SignerGUID}/attachments',
  whenToUse:
    'a signer must read an extra PDF before signing (it is attached to the signature, not signed).',
  docSummary:
    'Attaches an extra PDF to a signer so they can read it before signing. Attachments are not signed.',
  notes: [
    'Available on the centralized (VIDmobile) and remote channels.',
    'Accepts filePath or contentBase64.',
  ],
  example: {
    signerGuid: '5c1e8a42-7d3b-4f10-8b6a-2e9d0c4a7f13',
    filePath: '/Users/me/vidsigner-mcp/in/attachment.pdf',
    FileName: 'attachment.pdf',
  },
  description:
    'Attaches an extra PDF to one signer so they can read it before signing (POST /signature/{SignerGUID}/attachments). Attachments are not signed. Supported on the centralized (VIDmobile) and remote channels. Accepts a local path or base64.',
  inputSchema: {
    signerGuid,
    ...fileInputShape,
    FileName: z
      .string()
      .optional()
      .describe('Attachment file name. Default: the name of filePath.'),
  },
  handler: async ({ signerGuid, filePath, contentBase64, FileName }, { rest, files }) => {
    const input = await files.loadInput({ filePath, contentBase64 }, PDF);
    const res = await rest.addSignatureAttachment(signerGuid, {
      FileName: FileName ?? input.fileName ?? 'attachment.pdf',
      content: input.base64,
    });
    return { GUID: res.GUID, uploadedBytes: input.bytes };
  },
});

const updateSignerData = defineTool({
  name: 'vidsigner_update_signer_data',
  title: 'Update signer email/phone',
  domain: 'signature',
  api: 'rest',
  risk: 'write',
  endpoint: 'PUT /signature/{SignerGUID}/signerdata',
  whenToUse:
    'the email or phone number of a remote signer who has not signed yet was wrong or changed.',
  docSummary: 'Changes the email and/or phone number of a remote signer who has not signed yet.',
  notes: [
    'The new email and phone are mandatory when provided (empty and "null" are rejected) and go through the recipient policy.',
    'The phone number is sent without separators.',
  ],
  example: {
    signerGuid: '5c1e8a42-7d3b-4f10-8b6a-2e9d0c4a7f13',
    email: 'jane@example.test',
    phonenumber: '+34600111222',
  },
  description:
    'Changes the email and/or phone number of a signer (PUT /signature/{SignerGUID}/signerdata). Only for remote signatures that have not signed yet.',
  inputSchema: {
    signerGuid,
    email: z.string().optional().describe('New email address.'),
    phonenumber: z.string().optional().describe('New phone number in E.164 format.'),
  },
  handler: async ({ signerGuid, email, phonenumber }, { rest, policy }) => {
    const cleanEmail = policy.assertOptionalEmail(email, 'email');
    const cleanPhone = policy.assertPhone(phonenumber, 'phonenumber') as string | undefined;
    await rest.updateSignerData(signerGuid, { email: cleanEmail, phonenumber: cleanPhone });
    return {
      updated: true,
      fields: [email ? 'email' : null, phonenumber ? 'phonenumber' : null].filter(Boolean),
    };
  },
});

const getSignatureMetadata = defineTool({
  name: 'vidsigner_get_signature_metadata',
  title: 'Download biometric signature image and metadata',
  domain: 'signature',
  api: 'rest',
  risk: 'read',
  endpoint: 'GET /signature/{id}/signaturedata',
  whenToUse:
    'you need the handwritten signature image and the biometric metadata of a tablet (BIO) signature.',
  docSummary:
    'Downloads the handwritten signature image and the encrypted biometric XML of a BIO signature and saves them to disk.',
  notes: [
    'Only in the OpenAPI.',
    'Returns paths, never base64.',
    'BIO (tablet) signatures only: on a REMOTE signature, even one already signed through VIDremote, the API answers 409/50008 "is not yet signed" (verified in pre-production, 17/11/2026).',
  ],
  description:
    'Downloads the handwritten signature image and the encrypted biometric XML metadata of a BIO signature (GET /signature/{id}/signaturedata) and saves them to disk. Returns the paths, never the base64. Only in the OpenAPI.',
  inputSchema: { signerGuid },
  handler: async ({ signerGuid }, { rest, files }) => {
    const meta = await rest.getSignatureMetadata(signerGuid);
    const image = meta.SignatureImage
      ? await files.saveBase64(meta.SignatureImage, `signature-${signerGuid}.png`)
      : undefined;
    const xml = meta.EncriptedXmlMetadata
      ? await files.saveBase64(meta.EncriptedXmlMetadata, `signature-${signerGuid}-metadata.bin`)
      : undefined;
    return { signatureImage: image?.path ?? null, encryptedMetadata: xml?.path ?? null };
  },
});

const getSignatureEvidence = defineTool({
  name: 'vidsigner_get_signature_evidence',
  title: 'Get biometric signature evidence',
  domain: 'signature',
  api: 'rest',
  risk: 'read',
  endpoint: 'GET /signature/{id}/evidence',
  whenToUse:
    'you need the evidence of a tablet (BIO) signature: signer, device, geolocation and stylus profile.',
  docSummary:
    'Returns the evidence of a BIO signature: document, signer, tablet, geolocation and stylus profile. The signature image is saved to disk.',
  notes: [
    'Only in the OpenAPI.',
    'BIO (tablet) signatures only: on a REMOTE signature, even one already signed through VIDremote, the API answers 404/13500 "Signer not found" (verified in pre-production, 17/11/2026). For remote signatures use vidsigner_get_document_info (Evidences) and vidsigner_get_document_report.',
  ],
  description:
    'Returns the evidence of a BIO signature: document, signer, tablet device, geolocation and stylus/profile (GET /signature/{id}/evidence). The signature image is saved to disk and replaced by its path. Only in the OpenAPI.',
  inputSchema: { signerGuid },
  handler: async ({ signerGuid }, { rest, files }) => {
    const ev = await rest.getSignatureEvidence(signerGuid);
    const { SignatureImage, ...signature } = ev.Signature ?? {};
    const image = SignatureImage
      ? await files.saveBase64(SignatureImage, `evidence-${signerGuid}.png`)
      : undefined;
    return { ...ev, Signature: { ...signature, signatureImage: image?.path ?? null } };
  },
});

const getVidMobileSignatureRequest = defineTool({
  name: 'vidsigner_get_vidmobile_signature_request',
  title: 'Get VIDmobile signature request (CMS) - not usable with subscription tokens',
  domain: 'signature',
  api: 'rest',
  risk: 'read',
  endpoint: 'GET /vidmobileuser/signaturerequest/{id}',
  whenToUse: 'you need the CMS container of a VIDmobile signature request (Swisscom integration).',
  docSummary:
    'Not usable with subscription tokens (always 401 with the credentials of this MCP). Returns the CMS container of a VIDmobile signature request and saves it to disk.',
  notes: [
    'Only in the OpenAPI; the manual does not document it.',
    'It does NOT accept the subscription token this MCP uses: the API answers 401 "Invalid Authentication Token Role. Accepted Roles: vidmobilecert\\swisscom. Presented Role: subscription" (verified in pre-production). It needs the token of a VIDmobile user (role vidmobilecert), so with the credentials of this MCP it always fails.',
  ],
  description:
    'NOT USABLE WITH SUBSCRIPTION TOKENS: with the credentials of this MCP it always answers 401, so do not call it. Returns the CMS signature container of a VIDmobile signature request (GET /vidmobileuser/signaturerequest/{id}, Swisscom integration). The CMS is saved to disk. Only in the OpenAPI; undocumented in the manual. With the subscription token this MCP uses the API answers 401 (role "subscription" presented, only vidmobilecert/swisscom accepted): it needs a VIDmobile user token, which this MCP does not send.',
  inputSchema: { requestId: id('Signature request id.') },
  handler: async ({ requestId }, { rest, files }) => {
    const res = await rest.getVidMobileSignatureRequest(requestId);
    const saved = res.CMS
      ? await files.saveBase64(res.CMS, `signaturerequest-${requestId}.cms`)
      : undefined;
    return { savedTo: saved?.path ?? null, bytes: saved?.bytes };
  },
});

export const signatureTools: AnyToolDefinition[] = [
  getSignatureUrl,
  sendSignatureUrl,
  addSignatureAttachment,
  updateSignerData,
  getSignatureMetadata,
  getSignatureEvidence,
  getVidMobileSignatureRequest,
];
