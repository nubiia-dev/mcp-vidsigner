import { z } from 'zod';
import { REPORT_LANGUAGES } from '../client/types.js';

/** Identifier (GUID, device name, tax ID...) used as a path parameter. */
export const id = (description: string) =>
  z
    .string()
    .trim()
    .min(1)
    .max(256)
    .refine((v) => v !== '.' && v !== '..', {
      message: 'Identifier cannot be "." or ".." (path traversal).',
    })
    .describe(description);

export const docGuid = id('Document GUID (DocGUI), as returned when the document was created.');
export const signerGuid = id('Signer GUID (SignerGUID/SignerGUI) of one signature of a document.');
export const batchGuid = id('Batch GUID (DocBatchGUI) returned when the batch was created.');
export const edeliveryGuid = id('E-Delivery GUID returned when the e-delivery was created.');

export const reportLang = z
  .enum(REPORT_LANGUAGES)
  .default('es')
  .describe('Language of the evidence report (ISO-639-1 style code). Default: es.');

/** Optional name of the file saved on disk; the directory is decided by the server. */
export const outputFileName = z
  .string()
  .max(120)
  .optional()
  .describe(
    'Optional base file name for the downloaded file. It is sanitized; the directory is fixed by the server (VIDSIGNER_OUTPUT_DIR).',
  );

/** Fields for uploading a file: local path or base64 (exactly one). */
export const fileInputShape = {
  filePath: z
    .string()
    .optional()
    .describe(
      'Absolute path of a local file to upload. Preferred over contentBase64. Provide exactly one of filePath / contentBase64.',
    ),
  contentBase64: z
    .string()
    .optional()
    .describe('File content encoded in Base64. Provide exactly one of filePath / contentBase64.'),
};

export const SearchTermsShape = {
  additionaldata: z
    .string()
    .optional()
    .describe(
      'Value of the AdditionalData field sent when the document was created (exact or partial match not verified).',
    ),
  elementtype: z.string().optional().describe('Type of element to search, e.g. "document".'),
};
