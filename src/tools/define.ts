import type { ZodRawShape, z } from 'zod';
import type { VidSignerClient } from '../client/vidsigner-client.js';
import type { VidSignerMgmtClient } from '../client/mgmt-client.js';
import type { FileService } from './files.js';
import type { RecipientPolicy } from './recipient-policy.js';
import type { Risk, ToolApi } from './policy.js';

/** Tool domains (they group the code and the README table). */
export type ToolDomain =
  | 'documents'
  | 'signeddocuments'
  | 'signature'
  | 'batch'
  | 'edelivery'
  | 'devices'
  | 'search'
  | 'xml'
  | 'partners'
  | 'customers'
  | 'subscriptions'
  | 'enrollmentcodes'
  | 'vidmobileusers'
  | 'certificates'
  | 'statistics'
  | 'tsystems'
  | 'mgmt-devices';

/** Dependencies received by the handlers. */
export interface ToolContext {
  rest: VidSignerClient;
  /** Present only if the management API is enabled. */
  mgmt: VidSignerMgmtClient | undefined;
  files: FileService;
  /** Recipient and notification-host allowlists (empty = no restriction). */
  policy: RecipientPolicy;
}

export interface ToolDefinition<S extends ZodRawShape = ZodRawShape> {
  /** MCP name, `vidsigner_*` (REST) or `vidsigner_mgmt_*` (management). */
  name: string;
  /** Human-readable title. */
  title: string;
  domain: ToolDomain;
  api: ToolApi;
  risk: Risk;
  /** Endpoint it wraps, for the documentation (`GET /documents/{id}`). */
  endpoint: string;
  /**
   * Description for the model: what it does, the endpoint, the side effects (real emails or
   * SMS, marks as downloaded, irreversible...) and the known restrictions. `defineTool` appends
   * "Use when ..." and, if present, "Example: {...}"; the server additionally appends the risk
   * notice with the flag that enables it.
   */
  description: string;
  /**
   * When to use the tool, as the continuation of "Use when ": "you need the status of a
   * document and of each signer." Mandatory (checked by `tests/tools/tool-docs.test.ts`).
   */
  whenToUse: string;
  /** English summary for `docs/TOOLS.md` (what it does, in one or two sentences). */
  docSummary: string;
  /** Notes and known restrictions for `docs/TOOLS.md` (error codes, limits...). */
  notes?: string[];
  /**
   * Example arguments (JSON). Mandatory on tools that write: it is appended to the end of the
   * description and a test checks that it validates against the tool's own `inputSchema`.
   */
  example?: Record<string, unknown>;
  inputSchema: S;
  /** Returns JSON-serializable data. Never base64 file content. */
  handler: (args: z.infer<z.ZodObject<S>>, ctx: ToolContext) => Promise<unknown>;
}

/**
 * Type helper: infers `S` from the `inputSchema`. Builds the final description the model sees:
 * base text + "Use when ..." + "Example: {...}" (the example always goes last).
 */
export function defineTool<S extends ZodRawShape>(def: ToolDefinition<S>): ToolDefinition<S> {
  const parts = [def.description.trim(), `Use when ${def.whenToUse.trim()}`];
  if (def.example) parts.push(`Example: ${JSON.stringify(def.example)}`);
  return { ...def, description: parts.join(' ') };
}

/** Type-erased version for heterogeneous lists. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyToolDefinition = ToolDefinition<any>;

/** Standard text appended to each tool description according to its risk. */
export function riskNotice(risk: Risk, api: ToolApi): string {
  const mgmt =
    api === 'mgmt' ? ' Requires partner/subscription credentials for the management API.' : '';
  switch (risk) {
    case 'read':
      return `Risk: READ-ONLY.${mgmt}`;
    case 'write':
      return `Risk: WRITE. Changes data or may send real emails/SMS. In production it needs VIDSIGNER_ALLOW_WRITE=true.${mgmt}`;
    case 'destructive':
      return `Risk: DESTRUCTIVE and irreversible. Needs VIDSIGNER_ALLOW_WRITE=true and VIDSIGNER_ALLOW_DESTRUCTIVE=true.${mgmt}`;
    case 'sensitive_read':
      return 'Risk: SENSITIVE READ. Changes nothing, but the result is a bearer link: whoever holds the signing link can sign the document. In production it needs VIDSIGNER_ALLOW_SIGNING_LINKS=true.';
    case 'credential_read':
      return `Risk: CREDENTIAL READ. Changes nothing, but the result is a bearer credential of the subscription (a VIDmobile user token or a device enrollment code): whoever holds it can act on the subscription. In production it needs VIDSIGNER_ALLOW_CREDENTIAL_READS=true.${mgmt}`;
    case 'mark_downloaded':
      return 'Risk: SIDE EFFECT. Marks the document as downloaded (see warning above). In production it needs VIDSIGNER_ALLOW_MARK_DOWNLOADED=true.';
  }
}
