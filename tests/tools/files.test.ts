import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileService, IMAGE, P12, PDF, XML, sanitizeFileName } from '../../src/tools/files.js';

const dir = () => mkdtempSync(join(tmpdir(), 'vidsigner-files-'));
/** Allowed input folder for the tests (reading by path is always allowlisted). */
const IN = dir();
const svc = (over: Partial<ConstructorParameters<typeof FileService>[0]> = {}) =>
  new FileService({
    outputDir: join(dir(), 'out'),
    allowedInputDirs: [IN],
    maxUploadBytes: 1024,
    ...over,
  });
const PDF_BYTES = Buffer.from('%PDF-1.4\nhello');

describe('FileService.loadInput', () => {
  it('reads a PDF by path and returns base64 and name', async () => {
    const d = IN;
    writeFileSync(join(d, 'a.pdf'), PDF_BYTES);
    const r = await svc().loadInput({ filePath: join(d, 'a.pdf') }, PDF);
    expect(r.fileName).toBe('a.pdf');
    expect(Buffer.from(r.base64, 'base64').equals(PDF_BYTES)).toBe(true);
  });

  it('requires exactly one of the two sources', async () => {
    await expect(svc().loadInput({}, PDF)).rejects.toThrow(/exactly one/);
    await expect(
      svc().loadInput({ filePath: '/x.pdf', contentBase64: 'AAAA' }, PDF),
    ).rejects.toThrow(/exactly one/);
  });

  it('rejects wrong extension, content and size', async () => {
    const d = IN;
    writeFileSync(join(d, 'k.txt'), PDF_BYTES);
    writeFileSync(join(d, 'fake.pdf'), 'i am not a pdf');
    writeFileSync(join(d, 'big.pdf'), Buffer.concat([PDF_BYTES, Buffer.alloc(2000)]));
    await expect(svc().loadInput({ filePath: join(d, 'k.txt') }, PDF)).rejects.toThrow(
      /Expected a PDF file/,
    );
    await expect(svc().loadInput({ filePath: join(d, 'fake.pdf') }, PDF)).rejects.toThrow(
      /does not look like a valid PDF/,
    );
    await expect(svc().loadInput({ filePath: join(d, 'big.pdf') }, PDF)).rejects.toThrow(
      /maximum upload size/,
    );
    await expect(svc().loadInput({ filePath: join(d, 'nope.pdf') }, PDF)).rejects.toThrow(
      /does not exist, is not accessible or is outside/,
    );
  });

  it('respects the allowed folders, also against symlinks', async () => {
    const allowed = dir();
    const outside = dir();
    writeFileSync(join(allowed, 'ok.pdf'), PDF_BYTES);
    writeFileSync(join(outside, 'no.pdf'), PDF_BYTES);
    symlinkSync(join(outside, 'no.pdf'), join(allowed, 'link.pdf'));
    const s = svc({ allowedInputDirs: [allowed] });
    await expect(s.loadInput({ filePath: join(allowed, 'ok.pdf') }, PDF)).resolves.toBeTruthy();
    await expect(s.loadInput({ filePath: join(outside, 'no.pdf') }, PDF)).rejects.toThrow(
      /outside the allowed folders/,
    );
    await expect(s.loadInput({ filePath: join(allowed, 'link.pdf') }, PDF)).rejects.toThrow(
      /outside the allowed folders/,
    );
  });

  it('"does not exist" and "outside the folder" give EXACTLY the same message (no oracle)', async () => {
    const allowed = dir();
    const outside = dir();
    writeFileSync(join(outside, 'exists.pdf'), PDF_BYTES);
    const s = svc({ allowedInputDirs: [allowed] });
    const msg = async (p: string) =>
      s.loadInput({ filePath: p }, PDF).then(
        () => 'OK',
        (e: Error) => e.message,
      );
    const existsOutside = await msg(join(outside, 'exists.pdf'));
    const missingOutside = await msg(join(outside, 'missing.pdf'));
    const missingInside = await msg(join(allowed, 'missing.pdf'));
    expect(existsOutside).toBe(missingOutside);
    expect(existsOutside).toBe(missingInside);
    expect(existsOutside).not.toBe('OK');
    // It does not leak the real extension of a link pointing outside either.
    writeFileSync(join(outside, 'secret.p12'), Buffer.from([0x30, 0x82, 0x01, 0x00, 0x01]));
    symlinkSync(join(outside, 'secret.p12'), join(allowed, 'link.pdf'));
    expect(await msg(join(allowed, 'link.pdf'))).toBe(existsOutside);
  });

  it('rejects non-regular files (FIFO, folder) without blocking', async () => {
    const d = IN;
    const fifo = join(d, 'queue.pdf');
    execFileSync('mkfifo', [fifo]);
    mkdirSync(join(d, 'folder.pdf'));
    const s = svc();
    await expect(s.loadInput({ filePath: fifo }, PDF)).rejects.toThrow(/regular file/);
    await expect(s.loadInput({ filePath: join(d, 'folder.pdf') }, PDF)).rejects.toThrow(
      /regular file/,
    );
  }, 5000);

  it('with no allowed folders no file is read by path (fails closed)', async () => {
    const d = dir();
    writeFileSync(join(d, 'a.pdf'), PDF_BYTES);
    await expect(
      svc({ allowedInputDirs: [] }).loadInput({ filePath: join(d, 'a.pdf') }, PDF),
    ).rejects.toThrow(/disabled/);
    // base64 sigue funcionando.
    await expect(
      svc({ allowedInputDirs: [] }).loadInput({ contentBase64: PDF_BYTES.toString('base64') }, PDF),
    ).resolves.toBeTruthy();
  });

  it('checks the extension against the real path: a .pdf pointing to a .p12 does not pass', async () => {
    const d = IN;
    writeFileSync(join(d, 'key.p12'), Buffer.from([0x30, 0x82, 0x01, 0x00, 0x01]));
    symlinkSync(join(d, 'key.p12'), join(d, 'innocent.pdf'));
    await expect(svc().loadInput({ filePath: join(d, 'innocent.pdf') }, PDF)).rejects.toThrow(
      /Expected a PDF file/,
    );
  });

  it('XML, P12 and image also check their content', async () => {
    const d = IN;
    const p12 = Buffer.from([0x30, 0x82, 0x01, 0x00, 0x02, 0x01]);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    writeFileSync(join(d, 'ok.xml'), '<?xml version="1.0"?><a/>');
    writeFileSync(join(d, 'bad.xml'), 'this is not xml');
    writeFileSync(join(d, 'ok.p12'), p12);
    writeFileSync(join(d, 'bad.p12'), 'arbitrary text');
    writeFileSync(join(d, 'ok.png'), png);
    writeFileSync(join(d, 'bad.png'), 'i am not an image');
    const s = svc();
    await expect(s.loadInput({ filePath: join(d, 'ok.xml') }, XML)).resolves.toBeTruthy();
    await expect(s.loadInput({ filePath: join(d, 'bad.xml') }, XML)).rejects.toThrow(
      /does not look like/,
    );
    await expect(s.loadInput({ filePath: join(d, 'ok.p12') }, P12)).resolves.toBeTruthy();
    await expect(s.loadInput({ filePath: join(d, 'bad.p12') }, P12)).rejects.toThrow(
      /does not look like/,
    );
    await expect(s.loadInput({ filePath: join(d, 'ok.png') }, IMAGE)).resolves.toBeTruthy();
    await expect(s.loadInput({ filePath: join(d, 'bad.png') }, IMAGE)).rejects.toThrow(
      /does not look like/,
    );
    await expect(
      s.loadInput({ contentBase64: Buffer.from('garbage').toString('base64') }, P12),
    ).rejects.toThrow(/does not look like/);
  });

  it('validates base64', async () => {
    const s = svc();
    await expect(s.loadInput({ contentBase64: '%%%' }, PDF)).rejects.toThrow(/base64/);
    await expect(
      s.loadInput({ contentBase64: Buffer.from('xx').toString('base64') }, PDF),
    ).rejects.toThrow(/does not look like/);
    await expect(
      s.loadInput({ contentBase64: PDF_BYTES.toString('base64') }, PDF),
    ).resolves.toMatchObject({ bytes: PDF_BYTES.length });
    await expect(
      s.loadInput({ contentBase64: Buffer.from('<a/>').toString('base64') }, XML),
    ).resolves.toBeTruthy();
  });
});

describe('FileService.save*', () => {
  it('saves with 0600 permissions, a sanitized name and without overwriting', async () => {
    const s = svc();
    const a = await s.saveBase64(PDF_BYTES.toString('base64'), '../../etc/pass wd.pdf');
    const b = await s.saveBase64(PDF_BYTES.toString('base64'), '../../etc/pass wd.pdf');
    expect(a.path).not.toBe(b.path);
    expect(a.path).not.toContain('..');
    expect(statSync(a.path).mode & 0o777).toBe(0o600);
    expect(a.sha256).toHaveLength(64);
    expect(a.bytes).toBe(PDF_BYTES.length);
  });

  it('does not overwrite nor follow a pre-existing symlink (wx flag)', async () => {
    const out = join(dir(), 'out');
    const victim = join(dir(), 'victim.txt');
    writeFileSync(victim, 'original');
    const fixed = {
      outputDir: out,
      allowedInputDirs: [IN],
      maxUploadBytes: 1024,
      nameSuffix: () => 'fixed',
      now: () => new Date('2026-11-16T10:00:00Z'),
    };
    const s = new FileService(fixed);
    const first = await s.saveBuffer(Buffer.from('one'), 'x.txt');
    // Same timestamp and suffix: the second save collides and must NOT overwrite the first.
    await expect(s.saveBuffer(Buffer.from('two'), 'x.txt')).rejects.toThrow(/EEXIST/);
    expect(readFileSync(first.path, 'utf8')).toBe('one');
    // A symlink placed where the file would go is not followed either.
    const trap = first.path.replace('-x.txt', '-y.txt');
    symlinkSync(victim, trap);
    await expect(s.saveBuffer(Buffer.from('overwritten'), 'y.txt')).rejects.toThrow(/EEXIST/);
    expect(readFileSync(victim, 'utf8')).toBe('original');
  });

  it('sanitizeFileName', () => {
    expect(sanitizeFileName('../../x/café.pdf')).toBe('café.pdf');
    expect(sanitizeFileName('....')).toBe('document');
    expect(sanitizeFileName('a<b>|c.pdf')).toBe('a_b__c.pdf');
  });
});
