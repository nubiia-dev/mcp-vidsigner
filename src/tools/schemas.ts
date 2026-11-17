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

/**
 * Terms of `POST /search`. Both are mandatory: pre-production answers 400/10608 ("Search pattern
 * not supported for terms") to `additionaldata` alone and to `elementtype` alone, and only the
 * pair `additionaldata` + `elementtype: "document"` is served (verified 17/11/2026).
 */
export const SEARCH_ELEMENT_TYPES = ['document'] as const;

export const SearchTermsShape = {
  additionaldata: z
    .string()
    .min(1)
    .describe(
      'Value of the AdditionalData field sent when the document was created. The match is EXACT and case-sensitive (verified in pre-production): a partial value or a different case returns an empty list.',
    ),
  elementtype: z
    .enum(SEARCH_ELEMENT_TYPES)
    .describe(
      'Type of element to search. Mandatory, together with additionaldata: the API rejects either term alone (400/10608). The only value the API allows is "document" (others answer 400/10604).',
    ),
};
