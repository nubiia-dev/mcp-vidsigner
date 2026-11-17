import { defineTool, type AnyToolDefinition } from '../define.js';
import { withExtension } from '../files.js';
import { docGuid, outputFileName } from '../schemas.js';

const listSignedDocuments = defineTool({
  name: 'vidsigner_list_signed_documents',
  title: 'List signed documents not yet downloaded',
  domain: 'signeddocuments',
  api: 'rest',
  risk: 'read',
  endpoint: 'GET /signeddocuments',
  whenToUse: 'you need the queue of signed documents that nobody has downloaded yet.',
  docSummary: 'Lists the GUIDs of signed documents that have not been downloaded yet.',
  notes: [
    'It is a pure read: it does not mark anything as downloaded.',
    'An empty queue is returned as an empty list.',
  ],
  description:
    'Lists the GUIDs of signed documents that have not been downloaded yet (GET /signeddocuments). This is a pure read: it does not mark anything as downloaded. An empty queue is returned as an empty array.',
  inputSchema: {},
  handler: async (_args, { rest }) => {
    const items = await rest.listSignedDocuments();
    return { count: items.length, items };
  },
});

const downloadSignedDocument = defineTool({
  name: 'vidsigner_download_signed_document',
  title: 'Download signed document (MARKS AS DOWNLOADED)',
  domain: 'signeddocuments',
  api: 'rest',
  risk: 'mark_downloaded',
  endpoint: 'GET /signeddocuments/{id}',
  whenToUse:
    'you must consume the signed-and-not-downloaded queue on purpose; otherwise prefer vidsigner_get_document.',
  docSummary:
    'Downloads the signed PDF and saves it to disk. MARKS THE DOCUMENT AS DOWNLOADED and removes it from the signed-not-downloaded queue.',
  notes: [
    'Side effect: if another system shares the subscription and consumes that queue, in production it will no longer see the document.',
    'An unsigned document answers 409/50008.',
    'Alternative without side effects: vidsigner_get_document.',
  ],
  example: { docGuid: '0b6f1d0e-1c2a-4c55-9d8e-3a1f5b7c9e21' },
  description: [
    'WARNING: this call MARKS THE DOCUMENT AS DOWNLOADED in VIDsigner (manual 14.7/14.8) and removes it from the "signed, not downloaded" queue.',
    'If another system (for example your ERP) shares the subscription and consumes that queue, running this against production makes it miss the document.',
    'Prefer vidsigner_get_document, which reads any document without that side effect.',
    'Downloads the signed PDF and saves it to disk (GET /signeddocuments/{id}); returns the path, never the base64. An unsigned document answers 409/50008.',
  ].join(' '),
  inputSchema: { docGuid, outputFileName },
  handler: async ({ docGuid, outputFileName }, { rest, files }) => {
    const doc = await rest.getSignedDocument(docGuid);
    if (!doc.DocContent)
      return { savedTo: null, markedAsDownloaded: true, note: 'The response has no DocContent.' };
    const saved = await files.saveBase64(
      doc.DocContent,
      withExtension(outputFileName ?? doc.FileName ?? `${docGuid}-signed.pdf`, '.pdf'),
    );
    return {
      savedTo: saved.path,
      bytes: saved.bytes,
      sha256: saved.sha256,
      fileName: doc.FileName,
      additionalData: doc.AdditionalData,
      markedAsDownloaded: true,
    };
  },
});

const deleteSignedDocument = defineTool({
  name: 'vidsigner_delete_signed_document',
  title: 'Delete signed document',
  domain: 'signeddocuments',
  api: 'rest',
  risk: 'destructive',
  endpoint: 'DELETE /signeddocuments/{id}',
  whenToUse: 'a fully signed document must be removed from VIDsigner.',
  docSummary:
    'Marks a fully signed document as deleted. The physical removal is done later by a scheduled process.',
  notes: [
    'Between the logical and the physical deletion it can still be downloaded.',
    'An unsigned document answers 409/50008.',
  ],
  example: { docGuid: '0b6f1d0e-1c2a-4c55-9d8e-3a1f5b7c9e21' },
  description:
    'Marks a fully signed document as deleted (DELETE /signeddocuments/{id}). The physical removal runs later in a cron job, so it can still be downloaded in between. An unsigned document answers 409/50008.',
  inputSchema: { docGuid },
  handler: async ({ docGuid }, { rest }) => {
    await rest.deleteSignedDocument(docGuid);
    return { deleted: true, docGuid };
  },
});

export const signedDocumentTools: AnyToolDefinition[] = [
  listSignedDocuments,
  downloadSignedDocument,
  deleteSignedDocument,
];
