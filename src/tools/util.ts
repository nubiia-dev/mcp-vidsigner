import { VidSignerError } from '../client/errors.js';
import type { VidSignerMgmtClient } from '../client/mgmt-client.js';
import type { ToolContext } from './define.js';

/** Returns the management client or fails with a clear message (should not happen if the policy filters). */
export function requireMgmt(ctx: ToolContext): VidSignerMgmtClient {
  if (!ctx.mgmt) {
    throw new VidSignerError({
      kind: 'config',
      message: 'The management API is not enabled (VIDSIGNER_ENABLE_MGMT=true).',
    });
  }
  return ctx.mgmt;
}

/** Shallow copy without the given keys. */
export function omitKeys<T extends object>(value: T, keys: readonly string[]): Partial<T> {
  const out = { ...value } as Record<string, unknown>;
  for (const k of keys) delete out[k];
  return out as Partial<T>;
}

/** Keys whose value is a secret and must never reach the model context. */
const SECRET_KEYS = new Set(['password', 'subscriptionpass', 'token', 'pin', 'access_token']);

/**
 * Deep copy without the secret values (subscription and VIDmobile user passwords, tokens).
 * It replaces them with `[hidden]` so it is visible that they existed.
 */
export function hideSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => hideSecrets(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.has(k.toLowerCase()) && v ? '[hidden]' : hideSecrets(v);
    }
    return out as T;
  }
  return value;
}
