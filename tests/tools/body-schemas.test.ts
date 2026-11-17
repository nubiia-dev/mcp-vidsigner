import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generate, describeSchema } from '../../scripts/lib/body-schemas.js';
import { ROOT, SURFACE_PATH, extractSurface, renderSurface } from '../../scripts/lib/surface.js';
import { ALIASES, allAliasRows } from '../../src/tools/aliases.js';
import { closestKey, distance, unknownKeyMessage } from '../../src/tools/schema-kit.js';
import { startHarness } from '../helpers/mcp.js';
import { json, mockFetch, token } from '../helpers/mock-fetch.js';
import { NEEDS_SPEC, OPENAPI_PATH } from '../helpers/spec-dir.js';

describe('schema generator: the generated files are up to date', () => {
  it('src/tools/generated and src/client/generated match the versioned inputs (surface + extras + field docs + aliases)', async () => {
    const { files } = await generate();
    for (const [rel, content] of Object.entries(files)) {
      const onDisk = readFileSync(join(ROOT, rel), 'utf8');
      expect(
        onDisk === content,
        `${rel} is out of date: run npm run gen:schemas -- --from-surface`,
      ).toBe(true);
    }
  });

  it.skipIf(!OPENAPI_PATH)(
    `data/openapi-surface.json matches the Validated ID OpenAPI document${NEEDS_SPEC}`,
    async () => {
      const surface = extractSurface(readFileSync(OPENAPI_PATH as string, 'utf8'));
      const onDisk = readFileSync(join(ROOT, SURFACE_PATH), 'utf8');
      expect(
        onDisk === (await renderSurface(surface)),
        `${SURFACE_PATH} is out of date: run npm run gen:schemas`,
      ).toBe(true);
      // The generated files derived from a fresh extraction are the versioned ones.
      const { files } = await generate(surface);
      for (const [rel, content] of Object.entries(files)) {
        expect(readFileSync(join(ROOT, rel), 'utf8') === content, rel).toBe(true);
      }
    },
  );

  it('the alternative spellings of the table appear in the schemas as aliases', () => {
    const signer = describeSchema('Signer.SignerV2DTO');
    expect(signer.find((f) => f.name === 'eMail')?.origin).toBe('alias');
    expect(signer.find((f) => f.name === 'SkipSignatureEmail')?.origin).toBe('manual');
    expect(describeSchema('DocAppearanceDTO').find((f) => f.name === 'APP')?.origin).toBe('alias');
    expect(describeSchema('CentralizedCertificateDTO').map((f) => f.name)).toContain(
      'CertificateGUI',
    );
    expect(describeSchema('Forms.FormAttachmentResponseDTO').map((f) => f.name)).toContain('Text');
  });

  it('every alias decision has a valid status and evidence, and is consistent with what is sent', () => {
    const rows = allAliasRows();
    expect(rows.length).toBeGreaterThanOrEqual(6);
    for (const r of rows) {
      const label = `${r.schema}.${String(r['canonical'])}`;
      // A decision may move from pending to verified without breaking this test; what it cannot do
      // is lack evidence or be verified with an open doubt (sending both spellings).
      expect(['pending', 'verified'], label).toContain(r['status']);
      expect(String(r['evidence']).length, label).toBeGreaterThan(20);
      if (r['status'] === 'verified' && r.kind === 'key') {
        expect(r['send'], `${label}: verified but still sends both spellings`).toBe('canonical');
      }
    }
    expect(Object.keys(ALIASES)).toContain('Signer.SignerV2DTO');
  });
});

describe('signer Email/eMail decision (verified in pre with POST /documents, 17/11/2026)', () => {
  const emailRow = (schema: string) =>
    allAliasRows().find(
      (r) => r.schema === schema && r.kind === 'key' && r['canonical'] === 'Email',
    );

  it('is verified and sends only Email for the signer of POST /documents', () => {
    expect(emailRow('Signer.SignerV2DTO')).toMatchObject({ status: 'verified', send: 'canonical' });
  });

  it('stays pending for the batch signer, the recipients and the other spellings', () => {
    expect(emailRow('Signer.BatchSignerDTO')?.['status']).toBe('pending');
    expect(emailRow('DocumentRecipientDTO')?.['status']).toBe('pending');
    const pending = allAliasRows()
      .filter((r) => r['status'] === 'pending')
      .map((r) => `${r.schema}:${String(r['canonical'])}`);
    expect(pending).toEqual(
      expect.arrayContaining([
        'DocAppearanceDTO:App',
        'CentralizedCertificateDTO:CertificateGUID',
        'Signer.SignerV2DTO:whatsapp',
        'DocumentRecipientDTO:Email',
      ]),
    );
  });
});

describe('typo suggestions', () => {
  it('distance and closest spelling', () => {
    expect(distance('Emial', 'Email')).toBe(2);
    expect(closestKey('Emial', ['Email', 'Language'])).toBe('Email');
    expect(closestKey('issuername', ['IssuerName', 'SenderName'])).toBe('IssuerName');
    expect(closestKey('zzzzzz', ['Email', 'Language'])).toBeUndefined();
  });

  it('without a close match it lists the known keys', () => {
    expect(unknownKeyMessage(['zzzz'], ['A', 'B'])).toMatch(/Known fields: A, B/);
    expect(unknownKeyMessage(['Emial'], ['Email'])).toMatch(/did you mean "Email"/);
  });
});

describe('strict schemas in the tools (through the MCP protocol)', () => {
  const env = { VIDSIGNER_CLIENT_ID: 'cid', VIDSIGNER_CLIENT_SECRET: 'csecret-xyz' };
  const setup = async () => {
    const m = mockFetch((c) =>
      c.url.endsWith('/oauth/token') ? token('T') : json(200, { DocGUI: 'd1', DocBatchGUI: 'b1' }),
    );
    const h = await startHarness({ env, fetch: m.fetch });
    writeFileSync(join(h.inputDir, 'a.pdf'), '%PDF-1.4 x');
    const path = join(h.inputDir, 'a.pdf');
    const send = async (name: string, args: Record<string, unknown>) => {
      try {
        const r = await h.client.callTool({ name, arguments: args });
        const text = (r.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('');
        return { ok: r.isError !== true, text };
      } catch (e) {
        return { ok: false, text: (e as Error).message };
      }
    };
    const wire = () => {
      const c = m.calls
        .filter((x) => x.method === 'POST' && !x.url.endsWith('/oauth/token'))
        .at(-1);
      return JSON.parse(c?.body ?? '{}') as Record<string, unknown>;
    };
    return { h, m, path, send, wire };
  };
  const signer = { SignatureType: 'bio', DeviceName: 'tablet' };

  it('an unknown top-level key is rejected with a suggestion', async () => {
    const { send, path, m } = await setup();
    const r = await send('vidsigner_create_document', {
      filePath: path,
      IssuerNme: 'x',
      SignersGroups: [{ Signers: [signer] }],
    });
    expect(r.ok).toBe(false);
    expect(r.text).toContain('did you mean "IssuerName"');
    expect(m.calls.filter((c) => !c.url.endsWith('/oauth/token'))).toHaveLength(0);
  });

  it('a nested typo is rejected with its path (it is not forwarded to VIDsigner)', async () => {
    const { send, path } = await setup();
    const r = await send('vidsigner_create_document', {
      filePath: path,
      SignersGroups: [{ Signers: [{ ...signer, SkipSignatureEmial: true }] }],
    });
    expect(r.ok).toBe(false);
    expect(r.text).toContain('did you mean "SkipSignatureEmail"');
    expect(r.text).toContain('SignersGroups[0].Signers[0]');
  });

  it('also the signer of a batch and the fields that used to be dropped', async () => {
    const { send, path, wire } = await setup();
    const bad = await send('vidsigner_add_document_to_batch', {
      batchGuid: 'b1',
      filePath: path,
      SignaturesGroups: [{ Signatures: [{ Visible: { Page: 1 } }] }],
      RejectionOptions: [{ Id: '1', Txt: 'x' }],
    });
    expect(bad.ok).toBe(false);
    expect(bad.text).toContain('did you mean "Text"');
    const ok = await send('vidsigner_add_document_to_batch', {
      batchGuid: 'b1',
      filePath: path,
      SignaturesGroups: [{ Signatures: [{ Visible: { Page: 1 } }] }],
      RejectionOptions: [{ Id: '1', Text: 'Reason' }],
      SendSignedDoc: true,
    });
    expect(ok.ok).toBe(true);
    expect(wire()).toMatchObject({
      RejectionOptions: [{ Id: '1', Text: 'Reason' }],
      SendSignedDoc: true,
    });
  });

  it('manual aliases are accepted, normalised, and both spellings are sent only where the doubt remains', async () => {
    const { send, path, wire } = await setup();
    const r = await send('vidsigner_create_document', {
      filePath: path,
      IssuerName: 'S',
      SignersGroups: [
        {
          Signers: [
            {
              SignatureType: 'mobile',
              eMail: 'a@example.com',
              OTPChannel: 'WhatsApp',
              CentralizedCertificate: { CertificateGUI: 'cert-1' },
            },
          ],
        },
      ],
      SignedDocumentRecipients: [{ eMail: 'z@example.com' }],
      Appearance: { APP: { Logo: 'https://example.test/l.png' } },
    });
    expect(r.ok).toBe(true);
    const body = wire() as {
      SignersGroups: Array<{ Signers: Array<Record<string, unknown>> }>;
      SignedDocumentRecipients: Array<Record<string, unknown>>;
      Appearance: Record<string, unknown>;
    };
    const s = body.SignersGroups[0]?.Signers[0] as Record<string, unknown>;
    // Signer Email/eMail verified in pre (17/11/2026): only the canonical spelling is sent.
    expect(s).toMatchObject({ Email: 'a@example.com', OTPChannel: 'whatsapp' });
    expect(s).not.toHaveProperty('eMail');
    expect(s['CentralizedCertificate']).toEqual({
      CertificateGUI: 'cert-1',
      CertificateGUID: 'cert-1',
    });
    expect(body.SignedDocumentRecipients[0]).toEqual({
      Email: 'z@example.com',
      eMail: 'z@example.com',
    });
    expect(Object.keys(body.Appearance).sort()).toEqual(['APP', 'App']);
  });

  it('an alias with a different value than the canonical spelling is rejected', async () => {
    const { send, path } = await setup();
    const r = await send('vidsigner_create_document', {
      filePath: path,
      SignersGroups: [
        {
          Signers: [
            { SignatureType: 'emailandsms', Email: 'a@example.com', eMail: 'b@example.com' },
          ],
        },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/different values/);
  });

  it('a recipient with neither Email nor eMail is rejected (required with alias)', async () => {
    const { send, path } = await setup();
    const r = await send('vidsigner_create_document', {
      filePath: path,
      SignersGroups: [{ Signers: [signer] }],
      SignedDocumentRecipients: [{ Language: 'es' }],
    });
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/Email.*required/);
  });

  it('tools without a body also reject unknown arguments', async () => {
    const { send } = await setup();
    const r = await send('vidsigner_get_document', { docGuid: 'd1', outputFileNme: 'x' });
    expect(r.ok).toBe(false);
    expect(r.text).toContain('did you mean "outputFileName"');
  });

  it('the schema the model sees carries the full Form structure and the descriptions', async () => {
    const { h } = await setup();
    const tool = (await h.client.listTools()).tools.find(
      (t) => t.name === 'vidsigner_create_document',
    );
    const text = JSON.stringify(tool?.inputSchema);
    for (const key of [
      'FormDisplay',
      'TextBoxes',
      'Attachments',
      'FileInBase64',
      'SkipSignatureEmail',
      'Wallet',
      'NotificationConfig',
      'APIKey',
      'IssuerIdentifier',
      'ConvertFormToReadOnly',
    ]) {
      expect(text, key).toContain(`"${key}"`);
    }
    expect(text).toContain('"additionalProperties":false');
  });
});
