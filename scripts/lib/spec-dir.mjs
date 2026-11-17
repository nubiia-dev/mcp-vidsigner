/**
 * Locates the vendor documentation that the code generators read.
 *
 * The VIDsigner OpenAPI document and the REST manual belong to Validated ID and are NOT
 * redistributed with this repository. Customers of Validated ID can obtain them from the vendor
 * and point the generators at a local directory that holds:
 *
 *   - VIDsignerOpenAPI_Lastest.json   (OpenAPI 3 document of the signature API)
 *   - VIDsignerAPI_Rest_Lastest.txt   (text of the REST manual, e.g. `pdftotext -layout`)
 *
 * The directory is read from, in order of priority:
 *   1. `--spec-dir <dir>` / `--spec-dir=<dir>` on the command line,
 *   2. the first positional argument (a directory, or the file itself),
 *   3. the `VIDSIGNER_SPEC_DIR` environment variable.
 *
 * Nothing is ever copied into the repository: the generated artifacts (types, zod schemas, error
 * catalog, API surface and manual-field fixtures) are the only things that are versioned.
 */
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** File name of the OpenAPI document inside the spec directory. */
export const OPENAPI_FILE = 'VIDsignerOpenAPI_Lastest.json';
/** File name of the REST manual (plain text) inside the spec directory. */
export const MANUAL_FILE = 'VIDsignerAPI_Rest_Lastest.txt';

/** Environment variable that points at the directory with the vendor documentation. */
export const SPEC_DIR_ENV = 'VIDSIGNER_SPEC_DIR';

/**
 * Error raised when the vendor documentation needed by a generator is not available.
 * `message` is the user-facing text the scripts print before exiting.
 */
export class SpecMissingError extends Error {
  /** @param {string} detail */
  constructor(detail) {
    super(detail);
    this.name = 'SpecMissingError';
  }
}

/**
 * Builds the "documentation not available" message.
 * @param {string} what Human-readable name of the missing document.
 * @param {string} [detail] Extra context (the path that was looked up).
 */
export function missingMessage(what, detail) {
  return [
    `This generator requires the VIDsigner ${what}, available to Validated ID customers.`,
    detail ? `  ${detail}` : null,
    `  Put ${OPENAPI_FILE} and ${MANUAL_FILE} in a directory and set ${SPEC_DIR_ENV}=<directory>,`,
    '  or pass it as an argument: --spec-dir <directory>.',
    '  The vendor documentation is not redistributed with this repository.',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Reads the spec location from the command line and the environment.
 * @param {string[]} [argv] Arguments without the node and script paths.
 * @param {Record<string, string | undefined>} [env]
 * @returns {string | undefined} Absolute path (a directory, or a file given directly) or undefined.
 */
export function specLocation(argv = process.argv.slice(2), env = process.env) {
  const flagIndex = argv.findIndex((a) => a === '--spec-dir' || a.startsWith('--spec-dir='));
  let raw;
  if (flagIndex >= 0) {
    const flag = argv[flagIndex];
    raw = flag.includes('=') ? flag.slice(flag.indexOf('=') + 1) : argv[flagIndex + 1];
  } else {
    raw = argv.find((a) => !a.startsWith('--'));
  }
  raw = raw || env[SPEC_DIR_ENV];
  return raw ? resolve(raw) : undefined;
}

/**
 * Resolves one vendor document.
 * @param {string} file One of {@link OPENAPI_FILE} or {@link MANUAL_FILE}.
 * @param {string} what Human-readable name, used in the error message.
 * @param {string | undefined} location Result of {@link specLocation}.
 * @returns {string} Absolute path of an existing file.
 * @throws {SpecMissingError} When the location is not set or the file does not exist.
 */
export function requireSpecFile(file, what, location = specLocation()) {
  if (!location) throw new SpecMissingError(missingMessage(what, `${SPEC_DIR_ENV} is not set.`));
  const path =
    existsSync(location) && statSync(location).isFile() ? location : join(location, file);
  if (!existsSync(path)) {
    throw new SpecMissingError(missingMessage(what, `File not found: ${path}`));
  }
  return path;
}

/** Path of the OpenAPI document (throws {@link SpecMissingError} when unavailable). */
export function requireOpenApi(location = specLocation()) {
  return requireSpecFile(OPENAPI_FILE, 'OpenAPI document', location);
}

/** Path of the REST manual text (throws {@link SpecMissingError} when unavailable). */
export function requireManual(location = specLocation()) {
  return requireSpecFile(MANUAL_FILE, 'REST manual', location);
}

/**
 * Runs `main` and turns a {@link SpecMissingError} into a clean message and exit code 1.
 * @param {() => unknown | Promise<unknown>} main
 */
export async function runScript(main) {
  try {
    await main();
  } catch (error) {
    if (error instanceof SpecMissingError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}
