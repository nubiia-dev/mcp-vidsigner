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
    'The signer Email/eMail spellings are both accepted (verified in pre-production: if the values differ, the last key wins, so the tool rejects different values). The other alternative spellings (APP/App, CertificateGUI/CertificateGUID...) are still pending verification.',
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
  risk: 'read',
  endpoint: 'GET /documents/{id}',
  whenToUse:
    'you need the PDF of a document in any status (unsigned, signed or rejected), including a signed one, without changing its Downloaded flag.',
  docSummary:
    'Downloads the PDF of a document in any status and saves it to disk. Unlike vidsigner_download_signed_document, it does not mark the document as downloaded.',
  notes: [
    'Returns the file path, never the base64 content.',
    'It does not change the Downloaded flag (the call is recorded in the document log), so it is the safe way to read a signed PDF on a subscription shared with another system.',
  ],
  example: { docGuid: '0b6f1d0e-1c2a-4c55-9d8e-3a1f5b7c9e21' },
  description: [
    'Downloads the PDF of a document in ANY status (unsigned, signed or rejected) and saves it to disk (GET /documents/{id}).',
    'Returns the saved path, never the base64 content.',
    'Per the manual (14.18) this does NOT mark the document as downloaded, unlike vidsigner_download_signed_document: it does not change the Downloaded flag, so it is the safe way to read a signed PDF on a shared subscription. The call is still recorded in the document log ("Downloaded document. Current Status = ..."), which is visible with vidsigner_get_document_log.',
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
    'The evidence report of an expired document is available 30 days after expiration.',
  ],
  example: { docGuid: '0b6f1d0e-1c2a-4c55-9d8e-3a1f5b7c9e21' },
  description:
    'Marks an unsigned document as expired so nobody can sign it any more (PUT /documents/{docGuid}/expire). Irreversible.',
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
    'searchText has 3 to 10 characters.',
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
    'searchText must have 3-10 characters. orderBy accepts FileName, DocStatus, Downloaded, AdditionalData or UploadTime (verified in pre-production; the server also advertises DocGUI but answers 400/10500 to it). orderType: asc, des or desc (the server only understands asc and des, verified in pre-production: desc is accepted here and sent as des).',
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
      .describe('Free text filter, 3-10 characters (the fields searched are not documented).'),
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
