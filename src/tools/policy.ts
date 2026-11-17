import type { SecurityConfig } from '../config.js';

/**
 * Risk level of a tool. It determines which security gates enable it.
 *
 * - `read`: read-only (GET and the searches `POST /search`, `POST /edeliveries/search`).
 * - `write`: creates or modifies data, or triggers real notifications (emails/SMS) to the signer.
 * - `destructive`: deletes or invalidates (any kind of DELETE, `PUT .../expire`).
 * - `mark_downloaded`: a GET with a side effect: `GET /signeddocuments/{id}` marks the document
 *   as downloaded and removes it from the "signed but not downloaded" queue.
 * - `sensitive_read`: a GET without side effects, but it returns a link that allows acting: the
 *   VIDremote signing link lets whoever opens it sign (`GET .../vidremoteurl`). Enabled with
 *   `VIDSIGNER_ALLOW_SIGNING_LINKS` and does NOT carry `readOnlyHint`.
 * - `credential_read`: a GET without side effects, but it returns a management bearer credential:
 *   a VIDmobile user token (`GET .../token`) and device enrollment codes
 *   (`GET .../enrollmentcode`) allow using the subscription. Enabled with
 *   `VIDSIGNER_ALLOW_CREDENTIAL_READS` (separate from the signing links flag) and does NOT
 *   carry `readOnlyHint`.
 */
export type Risk =
  'read' | 'write' | 'destructive' | 'mark_downloaded' | 'sensitive_read' | 'credential_read';

/** API family a tool belongs to. */
export type ToolApi = 'rest' | 'mgmt';

export interface Gated {
  name: string;
  api: ToolApi;
  risk: Risk;
}

export interface PolicyDecision {
  enabled: boolean;
  /** Reason for the denial (for the startup log). */
  reason?: string;
  /** Environment variable that would enable it. */
  enableWith?: string;
}

/**
 * Decides whether a tool is registered according to the gates:
 *
 * | risk              | condition                                                   |
 * |-------------------|-------------------------------------------------------------|
 * | read              | always                                                      |
 * | write             | `allowWrite` (pre: true by default; pro: false)             |
 * | destructive       | `allowWrite` **and** `allowDestructive` (false by default)  |
 * | mark_downloaded   | `allowMarkDownloaded` (pre: true by default; pro: false)   |
 * | sensitive_read    | `allowSigningLinks` (pre: true by default; pro: false)      |
 * | credential_read   | `allowCredentialReads` (pre: true by default; pro: false)   |
 * | any MGMT tool     | additionally `enableMgmt`                                   |
 */
export function evaluatePolicy(tool: Gated, sec: SecurityConfig): PolicyDecision {
  if (tool.api === 'mgmt' && !sec.enableMgmt) {
    return {
      enabled: false,
      reason: 'the management API is disabled',
      enableWith: 'VIDSIGNER_ENABLE_MGMT=true',
    };
  }
  switch (tool.risk) {
    case 'read':
      return { enabled: true };
    case 'write':
      return sec.allowWrite
        ? { enabled: true }
        : {
            enabled: false,
            reason: 'writes are not allowed',
            enableWith: 'VIDSIGNER_ALLOW_WRITE=true',
          };
    case 'destructive':
      if (!sec.allowWrite) {
        return {
          enabled: false,
          reason: 'writes are not allowed',
          enableWith: 'VIDSIGNER_ALLOW_WRITE=true',
        };
      }
      return sec.allowDestructive
        ? { enabled: true }
        : {
            enabled: false,
            reason: 'destructive operations are not allowed',
            enableWith: 'VIDSIGNER_ALLOW_DESTRUCTIVE=true',
          };
    case 'sensitive_read':
      return sec.allowSigningLinks
        ? { enabled: true }
        : {
            enabled: false,
            reason: 'returns a link that lets whoever holds it sign (signing link)',
            enableWith: 'VIDSIGNER_ALLOW_SIGNING_LINKS=true',
          };
    case 'credential_read':
      return sec.allowCredentialReads
        ? { enabled: true }
        : {
            enabled: false,
            reason:
              'returns a management credential that allows using the subscription (VIDmobile token, enrollment code)',
            enableWith: 'VIDSIGNER_ALLOW_CREDENTIAL_READS=true',
          };
    case 'mark_downloaded':
      return sec.allowMarkDownloaded
        ? { enabled: true }
        : {
            enabled: false,
            reason: 'would mark the document as downloaded',
            enableWith: 'VIDSIGNER_ALLOW_MARK_DOWNLOADED=true',
          };
  }
}

/** Splits tools into enabled and skipped (with reason) according to the policy. */
export function partitionByPolicy<T extends Gated>(
  tools: readonly T[],
  sec: SecurityConfig,
): { enabled: T[]; skipped: Array<{ tool: T; decision: PolicyDecision }> } {
  const enabled: T[] = [];
  const skipped: Array<{ tool: T; decision: PolicyDecision }> = [];
  for (const tool of tools) {
    const decision = evaluatePolicy(tool, sec);
    if (decision.enabled) enabled.push(tool);
    else skipped.push({ tool, decision });
  }
  return { enabled, skipped };
}
