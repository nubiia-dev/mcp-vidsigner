import { VidSignerError } from '../../client/errors.js';
import type { SendBatchDocumentInput, SendBatchRequest } from '../../client/types.js';
import { defineTool, type AnyToolDefinition } from '../define.js';
import { PDF } from '../files.js';
import { omitKeys } from '../util.js';
import { sendBatchShape, sendDocumentBatchShape } from '../generated/body-schemas.js';
import { batchGuid, fileInputShape } from '../schemas.js';

const createBatch = defineTool({
  name: 'vidsigner_create_batch',
  title: 'Create document batch',
  domain: 'batch',
  api: 'rest',
  risk: 'write',
  endpoint: 'POST /documentbatch',
  whenToUse:
    'several PDFs must be signed together by the same signers with a single signature action (one email and one OTP).',
  docSummary:
    'Creates a batch of documents with the same signers and workflow. It is the first step of create batch, add documents, close batch.',
  notes: [
    'Requires JWT.',
    'NotificationEmailMessage: required for emailandsms signers unless SkipSignatureEmail=true, and must be omitted/null when SkipSignatureEmail=true (API errors 12541/12544). Verified in pre-production for POST /documentbatch as well as for POST /documents (17/11/2026).',
    'NotificationURL: every document of the batch must carry the same NotificationURL (or none); otherwise adding a document fails with 400/12205. See vidsigner_add_document_to_batch.',
    'The emails are sent when the batch is closed (vidsigner_close_batch), not when it is created.',
    'Body fields are the VIDsigner API ones (PascalCase).',
  ],
  example: {
    IssuerName: 'Acme',
    SignersGroups: [
      {
        Signers: [
          {
            SignatureType: 'emailandsms',
            SignerName: 'Jane Doe',
            Email: 'ana@example.test',
            PhoneNumber: '+34600111222',
            Language: 'es',
          },
        ],
      },
    ],
  },
  description: [
    'Creates a batch of documents that share the same signers and workflow (POST /documentbatch).',
    'With remote signing the signer gets ONE email and ONE OTP for the whole batch.',
    'Flow: create_batch -> add_document_to_batch (once per document) -> close_batch. The emails are sent when the batch is closed.',
    'Requires JWT. Field names are those of the VIDsigner API.',
    'Rule for NotificationEmailMessage on emailandsms signers: required unless SkipSignatureEmail=true, and must be omitted/null when SkipSignatureEmail=true (API errors 12541/12544; verified in pre-production for POST /documentbatch and POST /documents).',
    'In a batch the NotificationURL must be the same in every document you add (error 12205).',
  ].join(' '),
  inputSchema: sendBatchShape,
  handler: async (args, { rest, policy }) => {
    const clean = policy.normalizeBody(args);
    const res = await rest.createBatch(clean as unknown as SendBatchRequest);
    return {
      DocBatchGUI: res.DocBatchGUI,
      next: 'Add documents with vidsigner_add_document_to_batch, then close the batch.',
    };
  },
});

const addDocumentToBatch = defineTool({
  name: 'vidsigner_add_document_to_batch',
  title: 'Add document to batch',
  domain: 'batch',
  api: 'rest',
  risk: 'write',
  endpoint: 'POST /documentbatch/{batchGuid}/document',
  whenToUse: 'a batch is open and you must add one more PDF to it (once per document).',
  docSummary:
    'Adds a PDF to an open batch, indicating where each signer signs. Nothing is sent to the signers until the batch is closed.',
  notes: [
    'SignaturesGroups[].Signatures[] follows the same order as the signers of the batch.',
    'The NotificationEmailMessage / SkipSignatureEmail rule (12541/12544) applies to the signers of the batch (see vidsigner_create_batch); verified in pre-production for POST /documentbatch too.',
    'NotificationURL must be IDENTICAL in every document of the batch (or absent in all of them): a document whose NotificationURL differs from the others is rejected with 400/12205 "Notification URL must match the list of documents" (verified in pre-production).',
    'Adding to a batch that is already closed answers 409/52001; to a batch that does not exist (or was deleted), 404/52000.',
    'Accepts filePath or contentBase64.',
  ],
  example: {
    batchGuid: '0b6f1d0e-1c2a-4c55-9d8e-3a1f5b7c9e21',
    filePath: '/Users/me/vidsigner-mcp/in/contract.pdf',
    SignaturesGroups: [
      { Signatures: [{ Visible: { Page: 1, PosX: 100, PosY: 200, SizeX: 60, SizeY: 20 } }] },
    ],
  },
  description:
    'Adds a PDF to an open batch (POST /documentbatch/{batchGuid}/document). Each entry in SignaturesGroups[].Signatures[] places the signature box of the matching signer of the batch. Accepts a local path or base64. Nothing is sent to the signers until the batch is closed. If an emailandsms signer has SkipSignatureEmail=false, NotificationEmailMessage must be set; with SkipSignatureEmail=true it must be omitted (errors 12541/12544, verified in pre-production for POST /documentbatch). The NotificationURL must be the same in every document of the batch (or absent in all): otherwise 400/12205.',
  inputSchema: {
    batchGuid,
    ...fileInputShape,
    ...sendDocumentBatchShape,
  },
  handler: async (
    { batchGuid, filePath, contentBase64, FileName, ...doc },
    { rest, files, policy },
  ) => {
    const clean = policy.normalizeBody(doc);
    const input = await files.loadInput({ filePath, contentBase64 }, PDF);
    const body = {
      ...clean,
      FileName: FileName ?? input.fileName ?? 'document.pdf',
    } as unknown as SendBatchDocumentInput;
    const res = await rest.addDocumentToBatch(batchGuid, body, input.base64);
    return { DocGUI: res.DocGUI, uploadedBytes: input.bytes };
  },
});

const closeBatch = defineTool({
  name: 'vidsigner_close_batch',
  title: 'Close batch and send to signers',
  domain: 'batch',
  api: 'rest',
  risk: 'write',
  endpoint: 'PUT /documentbatch/{batchGuid}/status',
  whenToUse:
    'every document of the batch has been added and the signers must now receive the signing request.',
  docSummary: 'Closes the batch: VIDsigner sends the signing request to the signers.',
  notes: [
    'Sends real emails and SMS (none if every signer has SkipSignatureEmail=true).',
    'It is not retried automatically, to avoid duplicates.',
    'This is the only operation on PUT /documentbatch/{batchGuid}/status: there is no separate "set batch status" tool.',
    'Closing a batch with no documents answers 409/52063; a batch already closed, 409/52001.',
  ],
  example: { batchGuid: '0b6f1d0e-1c2a-4c55-9d8e-3a1f5b7c9e21' },
  description:
    'Closes a batch so VIDsigner sends the signing email to the signers (PUT /documentbatch/{batchGuid}/status with {"Status":"close"}). SENDS REAL MESSAGES. Not retried automatically to avoid duplicate emails.',
  inputSchema: { batchGuid },
  handler: async ({ batchGuid }, { rest }) => {
    await rest.closeBatch(batchGuid);
    return { closed: true, batchGuid };
  },
});

const getBatchInfo = defineTool({
  name: 'vidsigner_get_batch_info',
  title: 'Get batch information',
  domain: 'batch',
  api: 'rest',
  risk: 'read',
  endpoint: 'GET /documentbatchinfo/{batchGuid}',
  whenToUse:
    'a batch has been CLOSED and you need its status (Pending or Completed) and that of each document in it.',
  docSummary:
    'Returns the status of a CLOSED batch (Pending or Completed) and the GUID and status of each document. For an open, empty or unknown batch it returns { listed: false } instead of an error.',
  notes: [
    'It only lists a batch once it has been closed (vidsigner_close_batch). While the batch is open the API answers 404/52002 even if it already holds documents (verified in pre-production, 17/11/2026), so you cannot check an open batch with this tool.',
    '404/52002 ("Documents on Batch {0} not found") is the same answer for a batch that does not exist, one that has no documents and one that is still open: the API gives no way to tell them apart. The tool returns { listed: false, code: 52002, ... } instead of an error so the answer is explicit.',
    'The listing survives vidsigner_delete_batch for a closed batch: its documents are independent of the batch record.',
    'The batch id is always under Guid and each document id under Docs[].Guid, even if the server spells them BatchGUI or DocGUI as in the manual.',
  ],
  example: { batchGuid: '0b6f1d0e-1c2a-4c55-9d8e-3a1f5b7c9e21' },
  description:
    'Returns the status of a batch (Pending / Completed) and the GUID and status of each document in it (GET /documentbatchinfo/{batchGuid}). It only works once the batch has been CLOSED: while it is open the API answers 404/52002 even if it has documents (verified in pre-production). That 404/52002 is also what a batch with no documents or an unknown batch returns, so the tool reports it as { listed: false, code: 52002, meaning } rather than as an error. The batch id is always under Guid and each document id under Docs[].Guid, even if the server spells them BatchGUI / DocGUI like the manual.',
  inputSchema: { batchGuid },
  handler: async ({ batchGuid }, { rest }) => {
    try {
      const info = await rest.getBatchInfo(batchGuid);
      return {
        ...omitKeys(info, ['BatchGUI', 'Docs']),
        ...(info.Docs ? { Docs: info.Docs.map((d) => omitKeys(d, ['DocGUI'])) } : {}),
      };
    } catch (err) {
      if (err instanceof VidSignerError && err.httpStatus === 404 && err.code === 52002) {
        return {
          listed: false,
          batchGuid,
          code: 52002,
          apiMessage: err.message,
          meaning:
            'The API lists no documents for this batch. It answers the same for a batch that is still OPEN (even with documents), one that has no documents and one that does not exist. If the batch is open, close it with vidsigner_close_batch and ask again.',
        };
      }
      throw err;
    }
  },
});

const BATCH_DELETE_500 = /value cannot be null|parameter name:\s*entity/i;

const deleteBatch = defineTool({
  name: 'vidsigner_delete_batch',
  title: 'Delete batch',
  domain: 'batch',
  api: 'rest',
  risk: 'destructive',
  endpoint: 'DELETE /documentbatch/{batchGuid}',
  whenToUse:
    'a batch must be removed: an open batch you no longer want to close, or the record of a closed one.',
  docSummary:
    'Deletes the batch record. On an OPEN batch it also removes the documents already added to it; on a CLOSED batch its documents stay and must be deleted one by one with vidsigner_delete_document. A second delete, or an unknown batch, answers 500.',
  notes: [
    'Verified in pre-production on 17/11/2026: after the delete the batch no longer exists for the API (adding a document or closing it answers 404/52000 "Batch not found").',
    'OPEN batch: the documents added to it are deleted too (they answer 404 afterwards).',
    'CLOSED batch: the batch record is gone but its documents keep existing as ordinary documents, and vidsigner_get_batch_info still lists them. Delete each one with vidsigner_delete_document.',
    'A batch that does not exist or was already deleted does NOT answer 404: the API answers 500 "Value cannot be null. Parameter name: entity" (documented in Annex III of the manual as an unhandled ArgumentNullException). The tool keeps the HTTP error and explains it.',
    'The operation does not appear in the OpenAPI or in the operations list of the manual, only in Annex III.',
    'It is irreversible.',
  ],
  example: { batchGuid: '0b6f1d0e-1c2a-4c55-9d8e-3a1f5b7c9e21' },
  description:
    'Deletes a batch (DELETE /documentbatch/{batchGuid}); irreversible. Verified in pre-production: afterwards the batch no longer exists for the API (add / close answer 404/52000). If the batch was OPEN, the documents already added are deleted too; if it was CLOSED, its documents remain and get_batch_info keeps listing them until you delete each with vidsigner_delete_document. A batch that does not exist or was already deleted answers HTTP 500 "Value cannot be null (entity)" (Annex III of the manual), not 404. The operation appears only in Annex III of the manual, not in the OpenAPI.',
  inputSchema: { batchGuid },
  handler: async ({ batchGuid }, { rest }) => {
    try {
      await rest.deleteBatch(batchGuid);
    } catch (err) {
      if (
        err instanceof VidSignerError &&
        err.httpStatus === 500 &&
        BATCH_DELETE_500.test(err.message)
      ) {
        throw new VidSignerError({
          kind: err.kind,
          httpStatus: err.httpStatus,
          code: err.code,
          operation: err.operation,
          message: `${err.message} (the API answers this 500 when the batch does not exist or was already deleted; Annex III of the manual documents it as an unhandled ArgumentNullException, not as a 404)`,
        });
      }
      throw err;
    }
    return {
      deleted: true,
      batchGuid,
      note: 'The batch record was removed (verified: adding to it or closing it now answers 404/52000). If it was open, its documents were removed too; if it was closed, its documents still exist and must be deleted with vidsigner_delete_document.',
    };
  },
});

export const batchTools: AnyToolDefinition[] = [
  createBatch,
  addDocumentToBatch,
  closeBatch,
  getBatchInfo,
  deleteBatch,
];
