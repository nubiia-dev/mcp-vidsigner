import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { VidSignerError } from './client/errors.js';
import type { Logger } from './client/logger.js';
import { silentLogger } from './client/logger.js';
import type { VidSignerMgmtClient } from './client/mgmt-client.js';
import type { VidSignerClient } from './client/vidsigner-client.js';
import type { RecipientRules, SecurityConfig } from './config.js';
import { riskNotice, type AnyToolDefinition, type ToolContext } from './tools/define.js';
import type { FileService } from './tools/files.js';
import { ALL_TOOLS, selectTools } from './tools/index.js';
import { RecipientPolicy } from './tools/recipient-policy.js';
import { strictObject } from './tools/schema-kit.js';
import { VERSION } from './version.js';

/** Maximum size (characters) of a tool response; anything beyond is truncated with a notice. */
const MAX_RESPONSE_CHARS = 150_000;

export const SERVER_INSTRUCTIONS = `
VIDsigner MCP: electronic signature (Validated ID). Tools are prefixed vidsigner_ (signature API) and vidsigner_mgmt_ (management API).
- Downloads (PDF, reports, images) are saved to disk and the tool returns the path; base64 is never returned.
- Uploads accept a local file path (filePath) or base64 (contentBase64).
- Only the tools allowed by the server's safety gates are listed. If a tool you expect is missing, it is disabled by configuration (production is read-only by default).
- vidsigner_download_signed_document marks the document as downloaded; prefer vidsigner_get_document.
- Creating documents, batches or e-deliveries may send real emails/SMS to the signers.
`.trim();

export interface CreateServerOptions {
  security: SecurityConfig;
  rest: VidSignerClient;
  mgmt?: VidSignerMgmtClient | undefined;
  files: FileService;
  /** Recipient and notification-host allowlists. No restriction by default. */
  recipients?: RecipientRules;
  logger?: Logger;
  /** Tool catalog; all tools by default. Injectable in tests. */
  tools?: readonly AnyToolDefinition[];
}

export interface CreatedServer {
  server: McpServer;
  registered: string[];
  skipped: Array<{ name: string; reason: string; enableWith?: string }>;
}

/**
 * Creates the MCP server registering ONLY the tools allowed by the security gates. A tool that
 * is not registered does not exist for the model: there is no way to call it even if it tries.
 */
export function createServer(opts: CreateServerOptions): CreatedServer {
  const logger = opts.logger ?? silentLogger;
  const server = new McpServer(
    { name: 'mcp-vidsigner', version: VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );
  const ctx: ToolContext = {
    rest: opts.rest,
    mgmt: opts.mgmt,
    files: opts.files,
    policy: new RecipientPolicy(opts.recipients),
  };

  const { enabled, skipped } = selectTools(opts.security, opts.tools ?? ALL_TOOLS);
  for (const tool of enabled) registerTool(server, tool, ctx, logger);

  return {
    server,
    registered: enabled.map((t) => t.name),
    skipped: skipped.map(({ tool, decision }) => ({
      name: tool.name,
      reason: decision.reason ?? 'disabled',
      enableWith: decision.enableWith,
    })),
  };
}

function registerTool(
  server: McpServer,
  tool: AnyToolDefinition,
  ctx: ToolContext,
  logger: Logger,
): void {
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: `${tool.description}\n\n${riskNotice(tool.risk, tool.api)}`,
      // Strict object: an unknown key (a typo) is rejected with a suggestion instead of being
      // silently dropped.
      inputSchema: strictObject(tool.inputSchema),
      annotations: {
        title: tool.title,
        // `sensitive_read` and `credential_read` are NOT read-only as far as the client is
        // concerned: they return (or store) a bearer credential. MCP clients may auto-approve
        // `readOnlyHint` tools.
        readOnlyHint: tool.risk === 'read',
        destructiveHint: tool.risk === 'destructive',
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args: unknown): Promise<CallToolResult> => {
      try {
        const data = await tool.handler(args as Record<string, unknown>, ctx);
        logger.info('tool ok', { tool: tool.name });
        return textResult(data);
      } catch (err) {
        if (err instanceof VidSignerError) {
          logger.warn('tool error', { tool: tool.name, kind: err.kind });
        } else {
          // The detail (which may include paths or internal data) goes only to the log, already redacted.
          logger.error('tool unexpected error', {
            tool: tool.name,
            name: err instanceof Error ? err.name : typeof err,
            message: err instanceof Error ? err.message.slice(0, 300) : undefined,
          });
        }
        return errorResult(err);
      }
    },
  );
}

/** Serializes the result as JSON, with a size cap. */
export function textResult(data: unknown): CallToolResult {
  let text = JSON.stringify(data ?? { ok: true }, null, 2);
  if (text.length > MAX_RESPONSE_CHARS) {
    text =
      text.slice(0, MAX_RESPONSE_CHARS) +
      `\n... [response truncated: ${text.length} characters. Narrow the query (filters, pagination)].`;
  }
  return { content: [{ type: 'text', text }] };
}

/**
 * Converts any error into an `isError` result without leaking traces or secrets.
 * Unexpected errors (not `VidSignerError`) do NOT return their message to the model: they may
 * contain disk paths or internal data. Only the error type is returned; the detail stays in the
 * server log.
 */
export function errorResult(err: unknown): CallToolResult {
  const body =
    err instanceof VidSignerError
      ? err.toJSON()
      : {
          error: 'unexpected',
          errorName: err instanceof Error ? err.name : undefined,
          message: 'Unexpected internal error. The details were written to the server log.',
        };
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(body, null, 2) }] };
}
