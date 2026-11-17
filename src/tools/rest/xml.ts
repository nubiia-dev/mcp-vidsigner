import { z } from 'zod';
import type { SignXmlRequest } from '../../client/types.js';
import { defineTool, type AnyToolDefinition } from '../define.js';
import { XML, withExtension } from '../files.js';
import { fileInputShape, outputFileName } from '../schemas.js';

const signXml = defineTool({
  name: 'vidsigner_sign_xml',
  title: 'Seal an XML (Facturae) with a stamp certificate',
  domain: 'xml',
  api: 'rest',
  risk: 'write',
  endpoint: 'POST /xml/sign',
  whenToUse:
    'an e-invoice XML (Facturae) must be sealed with an automatic stamp certificate of the subscription.',
  docSummary:
    'Signs an XML (Facturae e-invoice) with an automatic stamp certificate of the subscription and saves the signed XML to disk.',
  notes: [
    'The subscription needs the STAMP_XML channel.',
    'The certificate PIN travels in the request: provide it only when needed.',
    'Accepts filePath or contentBase64.',
  ],
  example: {
    filePath: '/Users/me/vidsigner-mcp/in/invoice.xml',
    CertificateGUI: '0b6f1d0e-1c2a-4c55-9d8e-3a1f5b7c9e21',
    Pin: '1234',
    XAdESSignatureFormat: 'EPES',
    SignaturePolicy: 'Facturae',
  },
  description: [
    'Signs an XML document (e-invoice, Facturae) with an automatic stamp certificate of the subscription (POST /xml/sign).',
    'The subscription needs the STAMP_XML channel. The Pin of the certificate travels in the request: provide it only when you must.',
    'Accepts a local XML path or base64. The signed XML is saved to disk and its path returned.',
  ].join(' '),
  inputSchema: {
    ...fileInputShape,
    CertificateGUI: z.string().describe('GUID of the stamp certificate.'),
    Pin: z.string().describe('PIN of the certificate private key.'),
    XAdESSignatureType: z.enum(['Enveloped', 'Detached']).optional().describe('Default Enveloped.'),
    XAdESSignatureFormat: z.enum(['EPES', 'BES']).describe('Signature format.'),
    DocumentType: z.string().default('Facturae').describe('Must be Facturae.'),
    SignaturePolicy: z
      .string()
      .nullable()
      .optional()
      .describe(
        'Facturae when the format is EPES; null otherwise (the manual spells FacturaeOrNull).',
      ),
    outputFileName,
  },
  handler: async (args, { rest, files }) => {
    const { filePath, contentBase64, CertificateGUI, Pin, outputFileName, ...opts } = args;
    const input = await files.loadInput({ filePath, contentBase64 }, XML);
    const req = {
      ...opts,
      XmlDocument: input.base64,
      Certificate: { CertificateGUI, Pin },
    } as SignXmlRequest;
    const res = await rest.signXml(req);
    if (!res.SignedXmlDocument)
      return { savedTo: null, note: 'The response has no SignedXmlDocument.' };
    const saved = await files.saveBase64(
      res.SignedXmlDocument,
      withExtension(outputFileName ?? input.fileName ?? 'signed.xml', '.xml'),
    );
    return { savedTo: saved.path, bytes: saved.bytes, sha256: saved.sha256 };
  },
});

export const xmlTools: AnyToolDefinition[] = [signXml];
