import { createHash, randomBytes } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { access, mkdir, open, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, sep } from 'node:path';
import { VidSignerError } from '../client/errors.js';

export interface FileServiceOptions {
  /** Folder where downloads are saved. */
  outputDir: string;
  /**
   * Folders from which files can be read by path. Mandatory: if empty, no file is read by path
   * (only `contentBase64`). Never "the whole disk".
   */
  allowedInputDirs: string[];
  maxUploadBytes: number;
  /** Tests only: source of the random suffix and of the clock used in output file names. */
  nameSuffix?: () => string;
  now?: () => Date;
}

/** Which kind of file is expected on upload (extensions and content signature). */
export interface InputKind {
  /** Label for messages: "PDF", "XML"... */
  label: string;
  /** Allowed extensions, lowercase with a dot (`.pdf`). */
  extensions: string[];
  /** If set, the first bytes must start with this text (e.g. `%PDF-`). */
  magic?: string;
  /** Additional content check; returns `false` if the content is not of the expected type. */
  matches?: (buf: Buffer) => boolean;
}

export const PDF: InputKind = { label: 'PDF', extensions: ['.pdf'], magic: '%PDF-' };
/** XML: after an optional BOM and whitespace it must open a tag or a declaration (`<`). */
export const XML: InputKind = {
  label: 'XML',
  extensions: ['.xml'],
  matches: (buf) => /^(?:\uFEFF)?\s*</.test(buf.subarray(0, 64).toString('utf8')),
};
/** PKCS#12: DER structure that starts with a SEQUENCE (`0x30`) with a valid length. */
export const P12: InputKind = {
  label: 'PKCS#12 certificate',
  extensions: ['.p12', '.pfx'],
  matches: (buf) => buf.length > 4 && buf[0] === 0x30 && buf[1] !== undefined && buf[1] >= 0x80,
};
/** Image: PNG, JPEG or GIF signature. */
export const IMAGE: InputKind = {
  label: 'image',
  extensions: ['.png', '.jpg', '.jpeg', '.gif'],
  matches: (buf) =>
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
    buf.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ||
    buf.subarray(0, 4).toString('latin1') === 'GIF8',
};

export interface LoadedInput {
  /** Base64 content ready to send. */
  base64: string;
  /** File name derived from the path (if read from disk). */
  fileName?: string;
  bytes: number;
}

export interface SavedFile {
  path: string;
  fileName: string;
  bytes: number;
  sha256: string;
}

/**
 * File reading and writing for the tools, with safeguards:
 *
 * - Upload tools accept a local path or base64. The path is only read inside the allowed folders
 *   (mandatory; resolved with `realpath` so they cannot be bypassed with symlinks) and is limited
 *   by extension (checked against the REAL path), size and content signature. This way a
 *   malicious prompt cannot send `~/.ssh/id_rsa` or someone else's `.p12` to VIDsigner.
 * - Downloads are saved in `outputDir` with 0600 permissions, a sanitized name and without
 *   overwriting (`wx`); the tool response carries the path, never the base64.
 */
export class FileService {
  constructor(private readonly opts: FileServiceOptions) {}

  /** Reads an input file from a path or base64 (exactly one of the two). */
  async loadInput(
    input: { filePath?: string | undefined; contentBase64?: string | undefined },
    kind: InputKind,
  ): Promise<LoadedInput> {
    const hasPath = !!input.filePath?.trim();
    const hasB64 = !!input.contentBase64?.trim();
    if (hasPath === hasB64) {
      throw validation(`Provide exactly one of filePath or contentBase64 (${kind.label}).`);
    }
    return hasPath
      ? this.fromPath((input.filePath as string).trim(), kind)
      : this.fromBase64((input.contentBase64 as string).trim(), kind);
  }

  private async fromPath(filePath: string, kind: InputKind): Promise<LoadedInput> {
    assertExtension(filePath, kind);
    if (this.opts.allowedInputDirs.length === 0) {
      throw validation(
        'Reading files by path is disabled (VIDSIGNER_ALLOWED_INPUT_DIRS is empty). Use contentBase64.',
      );
    }
    // A single message for "does not exist", "is not accessible" and "outside the allowed
    // folders": two different messages would be an oracle to probe which files exist outside them.
    let real: string;
    try {
      real = await realpath(filePath);
    } catch {
      throw validation(UNREADABLE);
    }
    const allowed = await this.resolvedAllowedDirs();
    if (!allowed.some((dir) => real === dir || real.startsWith(dir + sep))) {
      throw validation(UNREADABLE);
    }
    // The extension is also checked against the real path (and only once inside the allowed
    // folders): a link `a.pdf` pointing to `key.p12` must not pass as a PDF.
    assertExtension(real, kind);
    // Regular files only. There is no `stat` before the `open` (check-then-use race): the file is
    // opened first and the type is checked on the DESCRIPTOR (`handle.stat()`), which no later
    // path change can alter. `O_NONBLOCK` keeps a FIFO from blocking the open (and the FIFO or
    // device is then rejected by the `isFile()` check); `O_NOFOLLOW` makes the open fail if the
    // last component became a symlink after the `realpath` (ELOOP on Linux and macOS).
    const handle = await open(
      real,
      constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0),
    ).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ELOOP' || err.code === 'ENXIO') throw validation(UNREADABLE);
      throw err;
    });
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw validation(NOT_REGULAR);
      if (info.size > this.opts.maxUploadBytes) {
        throw validation(
          `The file exceeds the maximum upload size (${mb(this.opts.maxUploadBytes)} MB).`,
        );
      }
      const buf = await handle.readFile();
      assertContent(buf, kind);
      return { base64: buf.toString('base64'), fileName: basename(real), bytes: buf.length };
    } finally {
      await handle.close();
    }
  }

  private async fromBase64(b64: string, kind: InputKind): Promise<LoadedInput> {
    const clean = b64.replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean))
      throw validation('contentBase64 is not valid base64.');
    const approxBytes = Math.floor((clean.length * 3) / 4);
    if (approxBytes > this.opts.maxUploadBytes) {
      throw validation(
        `The content exceeds the maximum upload size (${mb(this.opts.maxUploadBytes)} MB).`,
      );
    }
    const buf = Buffer.from(clean, 'base64');
    assertContent(buf, kind);
    return { base64: clean, bytes: buf.length };
  }

  private async resolvedAllowedDirs(): Promise<string[]> {
    const out: string[] = [];
    for (const dir of this.opts.allowedInputDirs) {
      try {
        out.push(await realpath(dir));
      } catch {
        out.push(dir);
      }
    }
    return out;
  }

  /** Decodes base64 and saves it in the output folder. Returns the path, never the content. */
  async saveBase64(base64: string, fileName: string): Promise<SavedFile> {
    const buf = Buffer.from(base64, 'base64');
    return this.saveBuffer(buf, fileName);
  }

  /**
   * Checks that the output folder exists (creating it with 0700) and is writable. Fails with a
   * validation error without system path details. Use it BEFORE any irreversible operation whose
   * result must be saved (e.g. rotating a password).
   */
  async assertOutputWritable(): Promise<void> {
    try {
      await ensureOutputDir(this.opts.outputDir);
    } catch (err) {
      if (err instanceof VidSignerError) {
        throw validation(`${err.message} No changes were made.`);
      }
      throw validation(
        'The output folder does not exist or is not writable (VIDSIGNER_OUTPUT_DIR). No changes were made.',
      );
    }
  }

  /**
   * Renames a saved file to `<path>.failed` (it does not delete it: if the failure was
   * ambiguous, for example a timeout, the server may have applied the change and the file is the
   * only copy of the secret). Returns the new path.
   */
  async markFailed(path: string): Promise<string> {
    const failed = `${path}.failed`;
    await rename(path, failed);
    return failed;
  }

  /** Saves bytes in the output folder (0600 permissions, sanitized, unique name). */
  async saveBuffer(buf: Buffer, fileName: string): Promise<SavedFile> {
    await ensureOutputDir(this.opts.outputDir);
    const suffix = this.opts.nameSuffix?.() ?? randomBytes(4).toString('hex');
    const safe = `${stamp(this.opts.now?.() ?? new Date())}-${suffix}-${sanitizeFileName(fileName)}`;
    const path = join(this.opts.outputDir, safe);
    // `wx`: never overwrites nor follows a pre-existing symlink.
    await writeFile(path, buf, { mode: 0o600, flag: 'wx' });
    return {
      path,
      fileName: safe,
      bytes: buf.length,
      sha256: createHash('sha256').update(buf).digest('hex'),
    };
  }
}

/**
 * Ensures the output folder, where downloads and rotated passwords are saved:
 *
 * - If it does NOT exist, it is created (with intermediate folders) with 0700 permissions.
 * - If it exists, it must be a folder owned by YOUR user with no group or other permissions
 *   (`(mode & 0o077) === 0`): a folder owned by someone else or readable by others would let
 *   another user on the machine read the signed PDFs or replace the folder with a link. By
 *   default it is `<tmp>/vidsigner-mcp`, a place where another user may have created it first.
 * - It must be writable.
 *
 * Messages do not include the path (they reach the model); startup logs it separately.
 * Returns `created` if it was created now.
 */
export async function ensureOutputDir(dir: string): Promise<'ok' | 'created'> {
  const existing = await stat(dir).then(
    (s) => s,
    (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return undefined;
      throw err;
    },
  );
  if (!existing) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    // Another process may have created it between the `stat` and the `mkdir`: check it anyway.
    assertOwnPrivateDir(await stat(dir));
    await access(dir, constants.W_OK);
    return 'created';
  }
  assertOwnPrivateDir(existing);
  await access(dir, constants.W_OK);
  return 'ok';
}

function assertOwnPrivateDir(st: Stats): void {
  if (!st.isDirectory()) {
    throw validation('The output folder (VIDSIGNER_OUTPUT_DIR) is not a folder.');
  }
  if (process.platform === 'win32') return;
  const uid = process.getuid?.();
  if (uid !== undefined && st.uid !== uid) {
    throw validation(
      'The output folder (VIDSIGNER_OUTPUT_DIR) belongs to another user. Use a folder of your own (with 0700) or fix the owner.',
    );
  }
  if ((st.mode & 0o077) !== 0) {
    throw validation(
      `The output folder (VIDSIGNER_OUTPUT_DIR) has permissions 0${(st.mode & 0o777).toString(8)}: group or others could read the downloaded files. Set it to 0700 (chmod 700 <folder>) or use another one.`,
    );
  }
}

/** Keeps only a safe file name (no paths or control characters). */
export function sanitizeFileName(name: string, fallback = 'document'): string {
  const base = basename(name.replace(/\\/g, '/'));
  const cleaned = base
    .replace(/[^\p{L}\p{N}._ -]/gu, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

/** Ensures an extension on the name (e.g. `.pdf` for reports). */
export function withExtension(name: string, ext: string): string {
  return name.toLowerCase().endsWith(ext) ? name : `${name}${ext}`;
}

function stamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
}

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(0);
}

function assertExtension(path: string, kind: InputKind): void {
  const ext = extname(path).toLowerCase();
  if (!kind.extensions.includes(ext)) {
    throw validation(
      `Expected a ${kind.label} file (${kind.extensions.join(', ')}), not "${ext || 'no extension'}".`,
    );
  }
}

function assertContent(buf: Buffer, kind: InputKind): void {
  if (buf.length === 0) throw validation('The file is empty.');
  const badMagic =
    kind.magic !== undefined &&
    buf.subarray(0, kind.magic.length).toString('latin1') !== kind.magic;
  if (badMagic || (kind.matches && !kind.matches(buf))) {
    throw validation(`The content does not look like a valid ${kind.label}.`);
  }
}

/** Single "cannot read" message: does not distinguish missing, inaccessible or outside the folders. */
const UNREADABLE =
  'Cannot read the file: it does not exist, is not accessible or is outside the allowed folders (VIDSIGNER_ALLOWED_INPUT_DIRS).';
const NOT_REGULAR = 'The path is not a regular file (folder, FIFO, device...).';

function validation(message: string): VidSignerError {
  return new VidSignerError({ kind: 'validation', message });
}
