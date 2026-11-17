/**
 * Public entry point of the VIDsigner client (without the MCP server).
 *
 * @example
 * import { VidSignerClient } from '@nubiia/mcp-vidsigner';
 */
export {
  VidSignerClient,
  VIDSIGNER_BASE_URLS,
  appendReturnUrl,
  normalizeDocumentPage,
  toBase64,
  type AuthMode,
  type VidSignerClientOptions,
  type VidSignerEnvironment,
} from './vidsigner-client.js';
export {
  VidSignerMgmtClient,
  VIDSIGNER_MGMT_BASE_URLS,
  normalizePage,
  type MgmtAuthKind,
  type VidSignerMgmtClientOptions,
} from './mgmt-client.js';
export {
  VidSignerError,
  VID_ERROR_CATALOG,
  EMPTY_LIST_CODES,
  hintFor,
  type VidErrorCatalogEntry,
  type VidSignerErrorKind,
} from './errors.js';
export { createLogger, silentLogger, Redactor, type LogLevel, type Logger } from './logger.js';
export * from './types.js';
export * from './mgmt-types.js';
export * from './webhooks.js';
export type {
  components as VidSignerOpenApiComponents,
  paths as VidSignerOpenApiPaths,
} from './generated/vidsigner-api.js';
