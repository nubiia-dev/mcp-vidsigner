import { stat } from 'node:fs/promises';
import { VidSignerError } from './client/errors.js';
import type { Logger } from './client/logger.js';
import type { Config } from './config.js';
import { ensureOutputDir } from './tools/files.js';

/** Result of {@link prepareDirectories}, for tests and diagnostics. */
export interface DirectoryReport {
  outputDir: 'ok' | 'created' | 'unusable';
  /** Input folders that do not exist or are not folders. */
  missingInputDirs: string[];
}

/**
 * Prepares the working folders at startup, without preventing startup:
 *
 * - OUTPUT folder: created with 0700 permissions if it does not exist. If it exists, it must be
 *   owned by your user and have no group or other permissions (0700); if it cannot be created,
 *   is not writable, is owned by someone else or is readable by others, a warning is logged
 *   (downloads and password rotation will fail with a clear message before making any change).
 * - INPUT folders: never created (they are the anti-exfiltration perimeter and are populated by
 *   the operator); if they do not exist a warning is logged so that configuration mistakes (e.g.
 *   a mistyped `~`) surface at startup rather than on the first upload.
 */
export async function prepareDirectories(
  files: Config['files'],
  logger: Logger,
): Promise<DirectoryReport> {
  let outputDir: DirectoryReport['outputDir'] = 'ok';
  try {
    if ((await ensureOutputDir(files.outputDir)) === 'created') {
      outputDir = 'created';
      logger.info('output folder created (0700)', { dir: files.outputDir });
    }
  } catch (err) {
    outputDir = 'unusable';
    const reason =
      err instanceof VidSignerError
        ? err.message
        : 'The output folder (VIDSIGNER_OUTPUT_DIR) does not exist and cannot be created, or is not writable.';
    logger.warn(`${reason} Downloads and password rotation will fail until you fix it.`, {
      dir: files.outputDir,
    });
  }

  const missingInputDirs: string[] = [];
  for (const dir of files.allowedInputDirs) {
    const isDir = await stat(dir).then(
      (s) => s.isDirectory(),
      () => false,
    );
    if (!isDir) {
      missingInputDirs.push(dir);
      logger.warn(
        'A folder in VIDSIGNER_ALLOWED_INPUT_DIRS does not exist: uploads by path from it will fail until you create it (or fix the variable).',
        { dir },
      );
    }
  }
  return { outputDir, missingInputDirs };
}
