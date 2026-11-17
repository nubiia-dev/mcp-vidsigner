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
    'NotificationEmailMessage: required for emailandsms signers unless SkipSignatureEmail=true, and must be omitted/null when SkipSignatureEmail=true (API errors 12541/12544). Verified for POST /documents only; assumed, not verified, for the batch endpoints.',
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
    'Rule for NotificationEmailMessage on emailandsms signers: required unless SkipSignatureEmail=true, and must be omitted/null when SkipSignatureEmail=true (API errors 12541/12544; verified in pre-production for POST /documents, not yet for the batch endpoints).',
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
    'The NotificationEmailMessage / SkipSignatureEmail rule (12541/12544) applies to the signers of the batch (see vidsigner_create_batch); verified for POST /documents only.',
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
    'Adds a PDF to an open batch (POST /documentbatch/{batchGuid}/document). Each entry in SignaturesGroups[].Signatures[] places the signature box of the matching signer of the batch. Accepts a local path or base64. Nothing is sent to the signers until the batch is closed. If an emailandsms signer has SkipSignatureEmail=false, NotificationEmailMessage must be set; with SkipSignatureEmail=true it must be omitted (errors 12541/12544, verified in pre-production for POST /documents only).',
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
  notes: ['Sends real emails and SMS.', 'It is not retried automatically, to avoid duplicates.'],
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
  whenToUse: 'you need the status of a batch (Pending or Completed) and of each document in it.',
  docSummary:
    'Returns the status of a batch (Pending or Completed) and the GUID and status of each document.',
  notes: [
    'The batch id is always under Guid and each document id under Docs[].Guid, even if the server spells them BatchGUI or DocGUI as in the manual.',
  ],
  example: { batchGuid: '0b6f1d0e-1c2a-4c55-9d8e-3a1f5b7c9e21' },
  description:
    'Returns the status of a batch (Pending / Completed) and the GUID and status of each document in it (GET /documentbatchinfo/{batchGuid}). The batch id is always under Guid and each document id under Docs[].Guid, even if the server spells them BatchGUI / DocGUI like the manual.',
  inputSchema: { batchGuid },
  handler: async ({ batchGuid }, { rest }) => {
    const info = await rest.getBatchInfo(batchGuid);
    return {
      ...omitKeys(info, ['BatchGUI', 'Docs']),
      ...(info.Docs ? { Docs: info.Docs.map((d) => omitKeys(d, ['DocGUI'])) } : {}),
    };
  },
});

const deleteBatch = defineTool({
  name: 'vidsigner_delete_batch',
  title: 'Delete batch (unconfirmed endpoint)',
  domain: 'batch',
  api: 'rest',
  risk: 'destructive',
  endpoint: 'DELETE /documentbatch/{batchGuid}',
  whenToUse:
    'a batch must be deleted and you accept that the endpoint is unconfirmed in this VIDsigner version.',
  docSummary:
    'Deletes a batch. The endpoint appears only in the error annex (Annex III) of the manual: it may not exist in your version.',
  notes: [
    'It is irreversible.',
    'A 404 or 405 may mean the endpoint does not exist; verify with vidsigner_get_batch_info.',
  ],
  example: { batchGuid: '0b6f1d0e-1c2a-4c55-9d8e-3a1f5b7c9e21' },
  description:
    'Deletes a batch (DELETE /documentbatch/{batchGuid}). The endpoint appears only in the error annex (Annex III) of the manual, not in the OpenAPI or the list of operations: it may not exist in your VIDsigner version. Irreversible.',
  inputSchema: { batchGuid },
  handler: async ({ batchGuid }, { rest }) => {
    try {
      await rest.deleteBatch(batchGuid);
    } catch (err) {
      // A 404/405 here may mean "the endpoint does not exist", not "the batch does not exist".
      if (err instanceof VidSignerError && (err.httpStatus === 404 || err.httpStatus === 405)) {
        throw new VidSignerError({
          kind: err.kind,
          httpStatus: err.httpStatus,
          code: err.code,
          operation: err.operation,
          message: `${err.message} (warning: DELETE /documentbatch/{id} is unconfirmed, it only appears in Annex III of the manual; this endpoint may not exist in your VIDsigner version)`,
        });
      }
      throw err;
    }
    return {
      deleted: true,
      batchGuid,
      warning: 'Unconfirmed endpoint (Annex III only): verify with vidsigner_get_batch_info.',
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
