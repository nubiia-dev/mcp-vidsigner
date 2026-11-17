import { chmodSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../src/client/logger.js';
import { prepareDirectories } from '../../src/startup.js';
import { ensureOutputDir, FileService } from '../../src/tools/files.js';

function capture(): { logger: Logger; warns: string[]; infos: string[] } {
  const warns: string[] = [];
  const infos: string[] = [];
  const noop = () => undefined;
  return {
    warns,
    infos,
    logger: { debug: noop, error: noop, info: (m) => infos.push(m), warn: (m) => warns.push(m) },
  };
}

describe('prepareDirectories at startup', () => {
  it('creates the output folder with 0700 and does not warn', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vs-start-'));
    const out = join(root, 'a', 'out');
    const input = join(root, 'in');
    const c = capture();
    mkdirSync(input);
    const r = await prepareDirectories(
      { outputDir: out, allowedInputDirs: [input], maxUploadBytes: 1 },
      c.logger,
    );
    expect(r).toEqual({ outputDir: 'created', missingInputDirs: [] });
    expect(statSync(out).mode & 0o777).toBe(0o700);
    expect(c.warns).toHaveLength(0);
  });

  it('warns about a missing input folder and does NOT create it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vs-start-'));
    const missing = join(root, 'missing');
    const c = capture();
    const r = await prepareDirectories(
      { outputDir: join(root, 'out'), allowedInputDirs: [missing], maxUploadBytes: 1 },
      c.logger,
    );
    expect(r.missingInputDirs).toEqual([missing]);
    expect(c.warns.join(' ')).toMatch(/VIDSIGNER_ALLOWED_INPUT_DIRS/);
    expect(() => statSync(missing)).toThrow();
  });

  it('warns (without throwing) if the output folder cannot be created', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vs-start-'));
    const blocker = join(root, 'file');
    writeFileSync(blocker, 'x');
    const c = capture();
    const r = await prepareDirectories(
      { outputDir: join(blocker, 'out'), allowedInputDirs: [root], maxUploadBytes: 1 },
      c.logger,
    );
    expect(r.outputDir).toBe('unusable');
    expect(c.warns.join(' ')).toMatch(/VIDSIGNER_OUTPUT_DIR/);
  });
});

describe('S-d: the output folder must be owned by the user and 0700', () => {
  const dirs = (out: string, input: string) => ({
    outputDir: out,
    allowedInputDirs: [input],
    maxUploadBytes: 1,
  });

  it('an existing folder with group or other permissions is marked unusable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vs-perm-'));
    const input = join(root, 'in');
    mkdirSync(input);
    for (const mode of [0o755, 0o750, 0o707, 0o777]) {
      const out = join(root, `out-${mode.toString(8)}`);
      mkdirSync(out);
      chmodSync(out, mode);
      const c = capture();
      const r = await prepareDirectories(dirs(out, input), c.logger);
      expect(r.outputDir, mode.toString(8)).toBe('unusable');
      expect(c.warns.join(' ')).toMatch(/permissions 0/);
      expect(c.warns.join(' ')).toMatch(/chmod 700/);
    }
  });

  it('an existing 0700 folder owned by the user is valid and no warning is raised', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vs-perm-'));
    const out = join(root, 'out');
    const input = join(root, 'in');
    mkdirSync(out, { mode: 0o700 });
    mkdirSync(input);
    const c = capture();
    expect((await prepareDirectories(dirs(out, input), c.logger)).outputDir).toBe('ok');
    expect(c.warns).toHaveLength(0);
  });

  it('a folder owned by another user is rejected', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vs-perm-'));
    const out = join(root, 'out');
    mkdirSync(out, { mode: 0o700 });
    const spy = vi.spyOn(process, 'getuid').mockReturnValue((statSync(out).uid + 1) as never);
    try {
      const c = capture();
      const r = await prepareDirectories(dirs(out, root), c.logger);
      expect(r.outputDir).toBe('unusable');
      expect(c.warns.join(' ')).toMatch(/another user/);
      await expect(ensureOutputDir(out)).rejects.toThrow(/another user/);
    } finally {
      spy.mockRestore();
    }
  });

  it('a path that is a file is rejected; a missing one is created with 0700 (including intermediate folders)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vs-perm-'));
    const file = join(root, 'file');
    writeFileSync(file, 'x');
    await expect(ensureOutputDir(file)).rejects.toThrow(/is not a folder/);
    const deep = join(root, 'a', 'b', 'out');
    expect(await ensureOutputDir(deep)).toBe('created');
    expect(statSync(deep).mode & 0o777).toBe(0o700);
    expect(statSync(join(root, 'a')).mode & 0o077).toBe(0);
    expect(await ensureOutputDir(deep)).toBe('ok');
  });

  it('FileService saves nothing in a folder with broad permissions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vs-perm-'));
    const out = join(root, 'out');
    mkdirSync(out);
    chmodSync(out, 0o755);
    const files = new FileService({ outputDir: out, allowedInputDirs: [root], maxUploadBytes: 1 });
    await expect(files.saveBuffer(Buffer.from('secret'), 'x.txt')).rejects.toThrow(
      /permissions 0755/,
    );
    await expect(files.assertOutputWritable()).rejects.toThrow(/No changes were made/);
    expect(readdirSync(out)).toHaveLength(0);
    chmodSync(out, 0o700);
    await expect(files.saveBuffer(Buffer.from('ok'), 'x.txt')).resolves.toMatchObject({ bytes: 2 });
  });
});
