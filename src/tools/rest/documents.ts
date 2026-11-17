import { z } from 'zod';
import {
  DOCUMENT_LIST_FILTERS,
  DOCUMENT_LIST_ORDER_BY,
  DOCUMENT_LIST_ORDER_TYPES,
  SEARCH_TEXT_LENGTH,
} from '../../client/types.js';
import type { SendDocumentInput } from '../../client/types.js';
import { defineTool, type AnyToolDefinition } from '../define.js';
import { PDF, withExtension } from '../files.js';
import { omitKeys } from '../util.js';
import { sendDocumentShape } from '../generated/body-schemas.js';
import { docGuid, fileInputShape, id, outputFileName, reportLang } from '../schemas.js';

const createDocument = defineTool({
  name: 'vidsigner_create_document',
  title: 'Create document to sign',
  domain: 'documents',
  api: 'rest',
  risk: 'write',
  endpoint: 'POST /documents',
  whenToUse:
    'you must send a PDF to be signed by one or more signers (remote link by email/SMS, tablet, VIDmobile or stamp).',
  docSummary:
    'Uploads a PDF to be signed by one or more groups of signers (remote link by email and SMS, tablet, VIDmobile or stamp). Returns the DocGUI.',
  notes: [
    'Requires JWT (VIDSIGNER_CLIENT_ID and VIDSIGNER_CLIENT_SECRET); with Basic credentials it answers 401 "Token not found".',
    'Depending on SignatureType and SkipSignatureEmail it sends real emails and SMS to the signers: in pre-production use test signers only.',
    'For a signing link without email: SkipSignatureEmail=true on the signer (the subscription needs AllowSkipEmail, otherwise 409/40111) and then vidsigner_get_signature_url.',
    'NotificationEmailMessage is required for every emailandsms signer unless SkipSignatureEmail=true, and must be omitted (null) when SkipSignatureEmail=true. Otherwise the API answers 400/12541 ("NotificationEmailMessage cannot be null for Signer") or 400/12544 ("NotificationEmailMessage must be null if SkipSignatureEmail is true"). Verified in pre-production on 17/11/2026; the client does not enforce it.',
    'The signer email accepts null, empty or "null"; all other emails (recipients, notifications) are mandatory and validated.',
    'The signer Email/eMail spellings are both accepted (verified in pre-production: if the values differ, the last key wins, so the tool rejects different values). APP/App, CertificateGUI/CertificateGUID and WhatsApp/whatsapp are also ACCEPTED by the API (verified in pre-production); which spelling it reads when the values differ is not determined (the tools never send different values).',
    'Appearance: Appearance.App needs Logo (a URL the API downloads) AND all four colours (PrimaryColor, PrimaryTextColor, SecondaryColor, SecondaryTextColor): without Logo the API answers 400/12200 "Logo URL cannot be null or empty", and each missing colour 400/15600 "PrimaryTextColor cannot be null or empty". Appearance.EmailNotification needs CorporateLogo and a CorporateLogoWidth greater than 0 (otherwise 400/12305 "The image width is not valid value. Value: 0"). Verified in pre-production.',
    'NotificationURL: the API stores it with a trailing "/" added (a value sent as https://host/path is read back by get_document_info as https://host/path/). Verified in pre-production.',
    'get_document_info does not echo Reminder, OTPChannel, Appearance or the centralized certificate: they are accepted on creation but cannot be read back, so you cannot confirm them afterwards (verified in pre-production).',
    'Accepts the PDF via filePath (inside VIDSIGNER_ALLOWED_INPUT_DIRS) or contentBase64; exactly one.',
  ],
  example: {
    filePath: '/Users/me/vidsigner-mcp/in/contract.pdf',
    IssuerName: 'Acme',
    SignersGroups: [
      {
        Signers: [
          {
            SignatureType: 'emailandsms',
            SignerName: 'Jane Doe',
            Email: 'jane@example.test',
            PhoneNumber: '+34600111222',
            Language: 'es',
            NotificationEmailMessage: {
              eMailSubject: 'Contract to sign',
              eMailBody: '<p>Hello Jane, please sign the contract.</p>',
            },
          },
        ],
      },
    ],
  },
  description: [
    'Uploads a PDF to be signed by one or more groups of signers (POST /documents).',
    'This is a REAL operation: depending on SignatureType and SkipSignatureEmail, VIDsigner emails/SMSes the signers. Use only test signers in pre-production.',
    'Requires a JWT (VIDSIGNER_CLIENT_ID/SECRET); with Basic credentials VIDsigner answers 401 "Token not found".',
    'Provide the PDF as a local path (filePath, preferred) or base64 (contentBase64).',
    'For a signing link without email use SkipSignatureEmail=true on the signer (needs AllowSkipEmail on the subscription), then call vidsigner_get_signature_url.',
    'NotificationEmailMessage is required for emailandsms signers unless SkipSignatureEmail=true, and must be omitted/null when SkipSignatureEmail=true (API errors 12541/12544, verified in pre-production).',
    'Field names of the body are exactly those of the VIDsigner API (PascalCase). Returns the DocGUI; use vidsigner_get_document_info to get the SignerGUIDs.',
  ].join(' '),
  inputSchema: {
    ...fileInputShape,
    // All documented body fields (OpenAPI + manual extras), generated.
    ...sendDocumentShape,
  },
  handler: async (args, { rest, files, policy }) => {
    const { filePath, contentBase64, FileName, ...rest_ } = args;
    const clean = policy.normalizeBody(rest_);
    const input = await files.loadInput({ filePath, contentBase64 }, PDF);
    const body = {
      ...clean,
      FileName: FileName ?? input.fileName ?? 'document.pdf',
    } as unknown as SendDocumentInput;
    const res = await rest.createDocument(body, input.base64);
    return {
      DocGUI: res.DocGUI,
      uploadedBytes: input.bytes,
      next: 'Call vidsigner_get_document_info with this DocGUI to read the SignerGUIDs and statuses.',
    };
  },
});

const getDocument = defineTool({
  name: 'vidsigner_get_document',
  title: 'Download document (any status)',
  domain: 'documents',
  api: 'rest',
  risk: 'mark_downloaded',
  endpoint: 'GET /documents/{id}',
  whenToUse:
    'you need the PDF of a document in any status (unsigned, signed or rejected) and accept that, on a SIGNED document, the call marks it as downloaded.',
  docSummary:
    'Downloads the PDF of a document in any status and saves it to disk. On a SIGNED document it MARKS IT AS DOWNLOADED (verified in pre-production), exactly like vidsigner_download_signed_document, contrary to what the manual says; on an unsigned document it does not change the flag.',
  notes: [
    'Returns the file path, never the base64 content.',
    'SIDE EFFECT verified in pre-production (17/11/2026, a document signed through VIDremote): GET /documents/{id} on a SIGNED document sets Downloaded=true and removes it from the signed-not-downloaded queue (vidsigner_list_signed_documents), although manual 14.18 says it does not. Other integrations of the same subscription that consume that queue will no longer see the document. That is why this tool needs VIDSIGNER_ALLOW_MARK_DOWNLOADED=true, like vidsigner_download_signed_document.',
    'On an unsigned or rejected document it does not change the Downloaded flag (verified). The call is recorded in the document log ("Downloaded document. Current Status = ...").',
    'There is NO side-effect-free way to read the PDF of a signed document through this API; vidsigner_get_document_report (the evidence report) and vidsigner_get_document_info do not mark it.',
  ],
  example: { docGuid: '0b6f1d0e-1c2a-4c55-9d8e-3a1f5b7c9e21' },
  description: [
    'Downloads the PDF of a document in ANY status (unsigned, signed or rejected) and saves it to disk (GET /documents/{id}).',
    'Returns the saved path, never the base64 content.',
    'WARNING: the manual (14.18) says this does NOT mark the document as downloaded, but in pre-production, on a SIGNED document, it DOES: Downloaded becomes true and the document leaves the signed-not-downloaded queue, like vidsigner_download_signed_document (on unsigned or rejected documents the flag does not change). It therefore needs VIDSIGNER_ALLOW_MARK_DOWNLOADED=true. The call is recorded in the document log ("Downloaded document. Current Status = ...").',
  ].join(' '),
  inputSchema: { docGuid, outputFileName },
  handler: async ({ docGuid, outputFileName }, { rest, files }) => {
    const doc = await rest.getDocument(docGuid);
    if (!doc.DocContent)
      return { found: true, savedTo: null, note: 'The response has no DocContent.' };
    const saved = await files.saveBase64(
      doc.DocContent,
      withExtension(outputFileName ?? doc.FileName ?? `${docGuid}.pdf`, '.pdf'),
    );
    return {
      savedTo: saved.path,
      bytes: saved.bytes,
      sha256: saved.sha256,
      fileName: doc.FileName,
      additionalData: doc.AdditionalData,
    };
  },
});

const deleteDocument = defineTool({
  name: 'vidsigner_delete_document',
  title: 'Delete unsigned document',
  domain: 'documents',
  api: 'rest',
  risk: 'destructive',
  endpoint: 'DELETE /documents/{id}',
  whenToUse: 'a document that is not fully signed (unsigned or rejected) must be removed for good.',
  docSummary: 'Permanently deletes an unsigned or rejected document with all its signatures.',
  notes: [
    'A fully signed document answers 409/50009: use vidsigner_delete_signed_document.',
    'It is irreversible.',
  ],
  example: { docGuid: '0b6f1d0e-1c2a-4c55-9d8e-3a1f5b7c9e21' },
  description:
    'Permanently deletes a document that is not fully signed (unsigned or rejected) with all its signatures (DELETE /documents/{id}). A fully signed document answers 409/50009: use vidsigner_delete_signed_document.',
  inputSchema: { docGuid },
  handler: async ({ docGuid }, { rest }) => {
    await rest.deleteDocument(docGuid);
    return { deleted: true, docGuid };
  },
});

const getDocumentLog = defineTool({
  name: 'vidsigner_get_document_log',
  title: 'Get document operation log',
  domain: 'documents',
  api: 'rest',
  risk: 'read',
  endpoint: 'GET /documents/{id}/loginfo',
  whenToUse:
    'you need the audit trail of operations on a document (who did what, from which IP and when).',
  docSummary:
    'Returns the trace of operations on a document: operation, result, message, IP and date.',
  notes: [
    'Only in the OpenAPI, not in the manual.',
    'It records ALL the API calls on the document, reads included, with the IP of the client that made them (verified in pre-production).',
    'Whoever can see this log sees the IPs of the machines that run this MCP.',
  ],
  description:
    'Returns the trace of operations performed on a document (operation, result, message, IP, timestamp) (GET /documents/{id}/loginfo). It records all the API calls on the document, reads included, with the IP of the client that made them: whoever can see this log sees the IPs of the machines that run this MCP. Only in the OpenAPI, not in the manual.',
  inputSchema: { docGuid },
  handler: async ({ docGuid }, { rest }) => ({ trace: await rest.getDocumentLog(docGuid) }),
});

const expireDocument = defineTool({
  name: 'vidsigner_expire_document',
  title: 'Expire unsigned document',
  domain: 'documents',
  api: 'rest',
  risk: 'destructive',
  endpoint: 'PUT /documents/{docGuid}/expire',
  whenToUse:
    'an unsigned document must stop being signable (for example it was sent by mistake) but you want to keep its record.',
  docSummary:
    'Marks an unsigned document as expired so nobody can sign it any more. The record is kept.',
  notes: [
    'It is irreversible.',
    'The document does NOT move to an "Expired" status: get_document_info keeps reporting DocStatus Unsigned, and what changes is ExpirationTime, which is brought forward to the moment of the call (verified in pre-production).',
    'The evidence report (vidsigner_get_document_report) is available straight away on the expired document; the manual says it stays available 30 days.',
    'Expiring again an already expired document answers 409 (code 0, "DocStatus: Unsigned is not valid for updating").',
    'vidsigner_get_signature_url still returns a URL for an expired document (not opened, so whether it still lets someone sign is unverified): treat the document as closed and do not hand out its links.',
  ],
  example: { docGuid: '0b6f1d0e-1c2a-4c55-9d8e-3a1f5b7c9e21' },
  description:
    'Marks an unsigned document as expired so nobody can sign it any more (PUT /documents/{docGuid}/expire). Irreversible. Observed in pre-production: the document does not get an "Expired" status (get_document_info still shows Unsigned; only ExpirationTime moves to the time of the call) and vidsigner_get_signature_url keeps returning a URL for it (not opened, usability unverified). The evidence report is available immediately.',
  inputSchema: { docGuid },
  handler: async ({ docGuid }, { rest }) => {
    await rest.expireDocument(docGuid);
    return { expired: true, docGuid };
  },
});

const getDocumentReport = defineTool({
  name: 'vidsigner_get_document_report',
  title: 'Download evidence report',
  domain: 'documents',
  api: 'rest',
  risk: 'read',
  endpoint: 'GET /documents/{id}/report/{lang}',
  whenToUse:
    'you need the PDF evidence report (audit trail) of a signed, rejected or expired document.',
  docSummary:
    'Generates the PDF evidence report of a signed, rejected or expired document in the chosen language and saves it to disk.',
  notes: [
    'An unsigned document that has not expired answers 409/50013.',
    'Languages: es by default; see the lang enum in the schema.',
    'Returns the path, never the base64.',
  ],
  example: { docGuid: '0b6f1d0e-1c2a-4c55-9d8e-3a1f5b7c9e21', lang: 'es' },
  description: [
    'Generates the PDF evidence report (audit trail) of a signed, rejected or expired document in the chosen language and saves it to disk (GET /documents/{id}/report/{lang}).',
    'Returns the saved path, never the base64. An unsigned document that has not expired answers 409/50013; the report of an expired one is available 30 days after expiration.',
  ].join(' '),
  inputSchema: { docGuid, lang: reportLang, outputFileName },
  handler: async ({ docGuid, lang, outputFileName }, { rest, files }) => {
    const report = await rest.getDocumentReport(docGuid, lang);
    if (!report.DocContent) return { savedTo: null, note: 'The response has no DocContent.' };
    const saved = await files.saveBase64(
      report.DocContent,
      withExtension(outputFileName ?? `report-${docGuid}-${lang}`, '.pdf'),
    );
    return { savedTo: saved.path, bytes: saved.bytes, sha256: saved.sha256, lang };
  },
});

const getDocumentInfo = defineTool({
  name: 'vidsigner_get_document_info',
  title: 'Get document information',
  domain: 'documents',
  api: 'rest',
  risk: 'read',
  endpoint: 'GET /documentinfo/{guid}',
  whenToUse:
    'you need the status of a document and of each signature (SignerGUIDs, who signed, evidences, form answers).',
  docSummary:
    'Returns the status of a document and of each signature: signer groups, SignerGUID, SignatureStatus, evidences, form answers and approvers.',
  notes: [
    'Contains personal data of the signers.',
    'Groups are always returned under SignerGroups even if the server spells it SignersGroups, as in the manual.',
    'It does NOT return what was sent as Reminder, OTPChannel or Appearance, nor the centralized certificate (CertificateGUID) of a mobile signature: they cannot be read back (verified in pre-production).',
    'DocStatus of an expired document stays Unsigned; there is no Expired status (see vidsigner_expire_document).',
    'Verified on documents signed and rejected through VIDremote (17/11/2026): DocStatus is Signed or Rejected, the signer carries SignatureStatus and, when rejected, RejectionReason (the text the signer typed). Evidence types seen: SIGNATUREURL_RETRIEVED, EMAIL_CLICKED, OTP_SENT, OTP_VERIFIED, DOC_SIGNED, DOC_REJECTED, EMAIL_SENT, EMAIL_RESENT, REMINDER_SENT; each evidence is an object with EvidenceType and EvidenceDate.',
    'NotificationURL is read back with a trailing "/" added by the API.',
  ],
  example: { docGuid: '0b6f1d0e-1c2a-4c55-9d8e-3a1f5b7c9e21' },
  description:
    'Returns the status of a document and of each signature: signer groups (always under SignerGroups, even if the server spells it SignersGroups like the manual), SignerGUIDs, SignatureStatus, evidences, form answers, approvers (GET /documentinfo/{guid}). Contains personal data of the signers.',
  inputSchema: { docGuid },
  handler: async ({ docGuid }, { rest }) =>
    omitKeys(await rest.getDocumentInfo(docGuid), ['SignersGroups']),
});

const listDocuments = defineTool({
  name: 'vidsigner_list_documents',
  title: 'List documents by status',
  domain: 'documents',
  api: 'rest',
  risk: 'read',
  endpoint: 'GET /documentlist/{filter}',
  whenToUse:
    'you need to find documents by status (all, unsigned, signed, rejected, signed and downloaded or not) or to walk the pending ones page by page.',
  docSummary:
    'Lists the documents of the subscription filtered by status, paginated or walking every page with fetchAll.',
  notes: [
    'pageNumber starts at 1 and pageSize must be between 1 and 99: with 100 or more the API answers 400.',
    'searchText has 3 to 10 characters. Verified in pre-production: it matches by SUBSTRING and ignoring case against the file name (FileName) and AdditionalData; it does NOT search the signer name nor the Tag.',
    'orderBy accepts FileName, DocStatus, Downloaded, AdditionalData and UploadTime; DocGUI gives 400/10500 (verified in pre-production).',
    'orderType: asc, des or desc; the server only understands asc and des, so desc is sent as des (verified in pre-production).',
    'fetchAll=true walks all pages up to maxPages; if the cap is reached it returns truncated=true and the list is INCOMPLETE.',
    'An empty list (404/50002) is returned as an empty list.',
  ],
  example: {
    filter: 'unsigned',
    pageNumber: 1,
    pageSize: 50,
    orderBy: 'UploadTime',
    orderType: 'desc',
  },
  description: [
    'Lists the documents of the subscription filtered by status (GET /documentlist/{filter}): all, unsigned, signed, rejected, signeddownloaded or signednotdownloaded.',
    'Pagination: pageNumber starts at 1 and pageSize must be between 1 and 99 (the API answers 400 otherwise). An empty list is returned as an empty array (the API uses 404/50002).',
    'searchText must have 3-10 characters and matches by substring, ignoring case, in the file name and in AdditionalData (verified in pre-production; not in the signer name or the Tag). orderBy accepts FileName, DocStatus, Downloaded, AdditionalData or UploadTime (verified in pre-production; the server also advertises DocGUI but answers 400/10500 to it). orderType: asc, des or desc (the server only understands asc and des, verified in pre-production: desc is accepted here and sent as des).',
    'Set fetchAll=true to walk every page (bounded by maxPages). If the cap is reached the answer has truncated=true and the list is INCOMPLETE: raise maxPages or narrow the filter.',
  ].join(' '),
  inputSchema: {
    filter: z.enum(DOCUMENT_LIST_FILTERS).describe('Document status filter.'),
    pageNumber: z.number().int().min(1).optional().describe('Page number, starting at 1.'),
    pageSize: z
      .number()
      .int()
      .min(1)
      .max(99)
      .optional()
      .describe('Items per page, 1-99. Default 50 when fetchAll.'),
    searchText: z
      .string()
      .min(SEARCH_TEXT_LENGTH.min)
      .max(SEARCH_TEXT_LENGTH.max)
      .optional()
      .describe(
        'Free text filter, 3-10 characters. Matches by substring, ignoring case, in the file name and in AdditionalData (verified in pre-production); it does not search signer names or the Tag.',
      ),
    orderBy: z
      .enum(DOCUMENT_LIST_ORDER_BY)
      .optional()
      .describe('Field to order by (DocGUI is rejected by the server with 400/10500).'),
    orderType: z
      .enum(DOCUMENT_LIST_ORDER_TYPES)
      .optional()
      .describe('asc, des or desc. desc is sent to the server as des (the server rejects desc).'),
    fetchAll: z.boolean().default(false).describe('Fetch all pages and return every item.'),
    maxPages: z
      .number()
      .int()
      .min(1)
      .max(500)
      .default(50)
      .describe('Safety cap of pages when fetchAll=true.'),
  },
  handler: async ({ filter, fetchAll, maxPages, ...opts }, { rest }) => {
    if (fetchAll) {
      const all = await rest.listAllDocumentsPaged(filter, { ...opts, maxPages });
      return {
        filter,
        count: all.items.length,
        items: all.items,
        pagesFetched: all.pagesFetched,
        truncated: all.truncated,
        ...(all.truncated
          ? {
              warning: `Stopped at maxPages=${maxPages}: the list is incomplete. Raise maxPages or narrow the filter.`,
            }
          : {}),
      };
    }
    const page = await rest.listDocuments(filter, opts);
    return {
      filter,
      count: page.items.length,
      items: page.items,
      pageNumber: page.pageNumber,
      pageSize: page.pageSize,
      totalPages: page.totalPages,
      hasNext: page.hasNext,
      paginationMetadata: !page.unpaginated,
    };
  },
});

const listDocumentsByDevice = defineTool({
  name: 'vidsigner_list_documents_by_device',
  title: 'List unsigned documents of a tablet',
  domain: 'documents',
  api: 'rest',
  risk: 'read',
  endpoint: 'GET /documentsbydevice',
  whenToUse:
    'you need the unsigned documents assigned to a signature tablet, for example those stuck for more than N minutes.',
  docSummary:
    'Lists the unsigned documents assigned to a tablet, optionally only those pending for more than N minutes.',
  notes: ['The tablet name comes from vidsigner_list_devices.'],
  description:
    'Lists the unsigned documents assigned to a signature device (tablet), optionally only those pending for more than N minutes (GET /documentsbydevice?device=...&filter=minutesold gt N).',
  inputSchema: {
    device: id('Device name, as returned by vidsigner_list_devices.'),
    minutesOlderThan: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Only documents pending for more than this many minutes.'),
  },
  handler: async ({ device, minutesOlderThan }, { rest }) => {
    const items = await rest.listDocumentsByDevice(device, minutesOlderThan);
    return { device, count: items.length, items };
  },
});

export const documentTools: AnyToolDefinition[] = [
  createDocument,
  getDocument,
  deleteDocument,
  getDocumentLog,
  expireDocument,
  getDocumentReport,
  getDocumentInfo,
  listDocuments,
  listDocumentsByDevice,
];
