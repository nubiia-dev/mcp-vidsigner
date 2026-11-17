export const OPENAPI_FILE: string;
export const MANUAL_FILE: string;
export const SPEC_DIR_ENV: string;
export class SpecMissingError extends Error {
  constructor(detail: string);
}
export function missingMessage(what: string, detail?: string): string;
export function specLocation(
  argv?: string[],
  env?: Record<string, string | undefined>,
): string | undefined;
export function requireSpecFile(file: string, what: string, location?: string): string;
export function requireOpenApi(location?: string): string;
export function requireManual(location?: string): string;
export function runScript(main: () => unknown): Promise<void>;
