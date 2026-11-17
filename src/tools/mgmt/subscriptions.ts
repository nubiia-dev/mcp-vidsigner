import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { VidSignerError } from '../../client/errors.js';
import type { SignatureChannels, Subscription } from '../../client/mgmt-types.js';
import { defineTool, type AnyToolDefinition } from '../define.js';
import { id } from '../schemas.js';
import { strictObject } from '../schema-kit.js';
import { hideSecrets, requireMgmt } from '../util.js';

const limits = {
  Enabled: z.boolean().describe('Whether the channel is enabled.'),
  SignaturesLimit: z
    .number()
    .int()
    .min(-1)
    .describe('0 if the channel is disabled; positive or -1 (unlimited) if enabled.'),
  SignaturesLimitPeriod: z
    .number()
    .int()
    .min(0)
    .describe('Months: 1 monthly, 12 yearly. 0 if disabled.'),
};

const SignatureChannelsSchema = strictObject({
  BIO: strictObject({
    ...limits,
    DevicesLimit: z.number().int().min(0).describe('Tablets allowed.'),
  }).describe('Biometric (tablet) channel.'),
  Remote: strictObject(limits).describe('VIDremote channel (link + OTP).'),
  ViDMobile: strictObject({
    ...limits,
    Domain: z.string().describe('Domain of the VIDmobile users.'),
    UsersLimit: z.number().int().min(0).describe('VIDmobile users allowed.'),
  }).describe('VIDmobile (centralized certificate) channel.'),
  Stamper: strictObject({
    ...limits,
    CertificatesLimit: z.number().int().min(0).describe('Stamp certificates allowed.'),
  }).describe('Automatic stamp channel.'),
}).describe('Configuration of the four signature channels.');

const subscriptionGuid = id('Subscription GUID.');
const customerGuid = id('Customer GUID.');

const subscriptionFields = {
  SubscriptionName: z.string().min(8).max(255).describe('Subscription name, 8-255 characters.'),
  NotificationURL: z.string().nullable().optional().describe('Webhook URL for notifications.'),
  Software: z
    .string()
    .nullable()
    .optional()
    .describe('Software or integration of the subscription.'),
  SignatureChannels: SignatureChannelsSchema,
};

const listSubscriptions = defineTool({
  name: 'vidsigner_mgmt_list_subscriptions',
  title: 'List subscriptions of a customer',
  domain: 'subscriptions',
  api: 'mgmt',
  risk: 'read',
  endpoint: 'GET /customers/{customerguid}/subscriptions',
  whenToUse: 'you need the subscriptions of a customer with their channel limits.',
  docSummary:
    'Lists the subscriptions of a customer with the limits of each channel. The subscription password is never shown ([hidden]).',
  description:
    'Lists the subscriptions of a customer with their channel limits (MGMT API). SubscriptionPass is never shown (replaced by [hidden]).',
  inputSchema: { customerGuid },
  handler: async ({ customerGuid }, ctx) => {
    const items = await requireMgmt(ctx).listCustomerSubscriptions(customerGuid);
    return { count: items.length, items: hideSecrets(items) };
  },
});

const createSubscription = defineTool({
  name: 'vidsigner_mgmt_create_subscription',
  title: 'Create subscription',
  domain: 'subscriptions',
  api: 'mgmt',
  risk: 'write',
  endpoint: 'POST /customers/{customerguid}/subscriptions',
  whenToUse:
    'a customer needs a new subscription (it starts INACTIVE and must be activated afterwards).',
  docSummary:
    'Creates a subscription for a customer; it starts INACTIVE. The generated password is not returned: it is saved to a 0600 file and the path is returned.',
  notes: [
    '409 if SubscriptionName already exists.',
    'SubscriptionName has 8 to 255 characters.',
    'If a channel is enabled its limits cannot be 0; if it is disabled they must be 0.',
    'NotificationURL goes through the destination policy (https is mandatory).',
  ],
  example: {
    customerGuid: '0b6f1d0e-1c2a-4c55-9d8e-3a1f5b7c9e21',
    SubscriptionName: 'Acme-Test-01',
    SignatureChannels: {
      BIO: { Enabled: false, SignaturesLimit: 0, SignaturesLimitPeriod: 0, DevicesLimit: 0 },
      Remote: { Enabled: true, SignaturesLimit: 100, SignaturesLimitPeriod: 12 },
      ViDMobile: {
        Enabled: false,
        Domain: '',
        SignaturesLimit: 0,
        SignaturesLimitPeriod: 0,
        UsersLimit: 0,
      },
      Stamper: {
        Enabled: false,
        SignaturesLimit: 0,
        SignaturesLimitPeriod: 0,
        CertificatesLimit: 0,
      },
    },
  },
  description: [
    'Creates a subscription for a customer; it starts INACTIVE (MGMT API).',
    'The generated SubscriptionPass is a secret: it is NOT returned in the answer but saved to a 0600 file whose path is returned (credentialsSavedTo).',
    '409 if the SubscriptionName already exists.',
  ].join(' '),
  inputSchema: { customerGuid, ...subscriptionFields },
  handler: async ({ customerGuid, ...input }, ctx) => {
    ctx.policy.assertUrl(input.NotificationURL, 'NotificationURL');
    const sub: Subscription = await requireMgmt(ctx).createSubscription(customerGuid, {
      ...input,
      SignatureChannels: input.SignatureChannels as SignatureChannels,
    });
    const saved = await ctx.files.saveBuffer(
      Buffer.from(
        JSON.stringify(
          {
            SubscriptionGUID: sub.SubscriptionGUID,
            SubscriptionName: sub.SubscriptionName,
            SubscriptionPass: sub.SubscriptionPass,
          },
          null,
          2,
        ),
      ),
      `subscription-${sub.SubscriptionGUID}-credentials.json`,
    );
    return { subscription: hideSecrets(sub), credentialsSavedTo: saved.path };
  },
});

const getSubscription = defineTool({
  name: 'vidsigner_mgmt_get_subscription',
  title: 'Get subscription',
  domain: 'subscriptions',
  api: 'mgmt',
  risk: 'read',
  endpoint: 'GET /subscriptions/{id}',
  whenToUse: 'you need one subscription with its channel limits.',
  docSummary:
    'Returns a subscription with the limits of its channels. The password is never shown.',
  description:
    'Returns a subscription with its channel limits (MGMT API, GET /subscriptions/{id}). SubscriptionPass is never shown.',
  inputSchema: { subscriptionId: id('Subscription GUID (or id).') },
  handler: async ({ subscriptionId }, ctx) =>
    hideSecrets(await requireMgmt(ctx).getSubscription(subscriptionId)),
});

/** Alphabet of the generated subscription passwords (no symbols that are ambiguous in URLs and JSON). */
const PASS_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** Random password of exactly 20 characters (the length required by `PUT /subscription/{guid}`). */
function generateSubscriptionPass(): string {
  let out = '';
  for (let i = 0; i < 20; i++) out += PASS_ALPHABET[randomInt(PASS_ALPHABET.length)];
  return out;
}

const updateSubscription = defineTool({
  name: 'vidsigner_mgmt_update_subscription',
  title: 'Update subscription',
  domain: 'subscriptions',
  api: 'mgmt',
  risk: 'destructive',
  endpoint: 'PUT /subscription/{subscriptionguid}',
  whenToUse:
    'the definition, limits or active flag of a subscription must change, or its password must be rotated.',
  docSummary:
    'Modifies a subscription (full definition). It can lock someone out, hence it is destructive. With rotatePassword=true it generates a new password and saves it to a 0600 file.',
  notes: [
    'The password is never an argument and never appears in the answer: by default the current one is re-sent (read server-side).',
    'With rotatePassword=true it is saved FIRST to a 0600 file (the folder is checked writable beforehand) and only then is the PUT sent.',
    'If the PUT fails with 4xx the file is renamed to .failed and can be deleted; if it fails by network, timeout or 5xx the error warns that it is NOT known whether it was applied and that the file must NOT be deleted.',
    'A rotated password invalidates the credentials of this MCP (if it is the same subscription) and those of other consumers of the same credentials (e.g. your backend) until their environment is updated.',
  ],
  example: {
    subscriptionGuid: '0b6f1d0e-1c2a-4c55-9d8e-3a1f5b7c9e21',
    SubscriptionName: 'Acme-Test-01',
    Active: true,
    SignatureChannels: {
      BIO: { Enabled: false, SignaturesLimit: 0, SignaturesLimitPeriod: 0, DevicesLimit: 0 },
      Remote: { Enabled: true, SignaturesLimit: 100, SignaturesLimitPeriod: 12 },
      ViDMobile: {
        Enabled: false,
        Domain: '',
        SignaturesLimit: 0,
        SignaturesLimitPeriod: 0,
        UsersLimit: 0,
      },
      Stamper: {
        Enabled: false,
        SignaturesLimit: 0,
        SignaturesLimitPeriod: 0,
        CertificatesLimit: 0,
      },
    },
  },
  description: [
    'Modifies a subscription (MGMT API, PUT /subscription/{guid}); send the full definition.',
    'It can lock someone out (deactivate it, cut channel limits, change its password), so it is DESTRUCTIVE.',
    'If a channel is enabled its limits must be non-zero; if disabled they must be 0.',
    'The SubscriptionPass is NEVER an argument and never appears in the answer: by default the current password is re-sent unchanged (read server-side); with rotatePassword=true a new random 20-character password is generated, saved FIRST to a 0600 file (checked writable beforehand) and only then sent; the path is returned (credentialsSavedTo). If the PUT fails the file is renamed to .failed and the error says so (on a network error, timeout or 5xx the error warns that it is unknown whether the password was applied and tells you NOT to delete the file). WARNING: a rotated password invalidates the credentials of this MCP (if it is the same subscription) and of any other consumer of the same credentials (e.g. your backend) until their environment is updated.',
  ].join(' '),
  inputSchema: {
    subscriptionGuid,
    ...subscriptionFields,
    Active: z.boolean().describe('true to activate, false to deactivate.'),
    rotatePassword: z
      .boolean()
      .default(false)
      .describe(
        'true: generate a new SubscriptionPass (20 chars) and save it to a 0600 file. false: keep the current one. The password is never an argument or part of the answer.',
      ),
  },
  handler: async ({ subscriptionGuid, rotatePassword, ...input }, ctx) => {
    ctx.policy.assertUrl(input.NotificationURL, 'NotificationURL');
    const mgmt = requireMgmt(ctx);
    const body = (pass: string) => ({
      ...input,
      SubscriptionPass: pass,
      SignatureChannels: input.SignatureChannels as SignatureChannels,
    });
    if (!rotatePassword) {
      // The current password is read server-side and travels only in the PUT: it never reaches the model.
      const current = (await mgmt.getSubscription(subscriptionGuid)).SubscriptionPass;
      if (!current || current.length !== 20) {
        throw new VidSignerError({
          kind: 'validation',
          message:
            'Could not read the current subscription password (20 characters). Use rotatePassword=true to set a new one.',
        });
      }
      return hideSecrets(await mgmt.updateSubscription(subscriptionGuid, body(current)));
    }

    // Rotation: first make sure there is somewhere to store the new password and store it; only
    // then send the PUT. That way a disk failure never leaves a password applied and lost.
    const pass = generateSubscriptionPass();
    await ctx.files.assertOutputWritable();
    const saved = await ctx.files.saveBuffer(
      Buffer.from(
        JSON.stringify(
          {
            SubscriptionGUID: subscriptionGuid,
            SubscriptionName: input.SubscriptionName,
            SubscriptionPass: pass,
          },
          null,
          2,
        ),
      ),
      `subscription-${subscriptionGuid}-credentials.json`,
    );
    let updated: Subscription;
    try {
      updated = await mgmt.updateSubscription(subscriptionGuid, body(pass));
    } catch (err) {
      // If the rename is not possible the file stays at its original path: the message must say so.
      const renamed = await ctx.files.markFailed(saved.path).then(
        (path) => ({ path, renamed: true }),
        () => ({ path: saved.path, renamed: false }),
      );
      throw withRotationFailure(err, renamed.path, renamed.renamed);
    }
    return {
      subscription: hideSecrets(updated),
      credentialsSavedTo: saved.path,
      warning: ROTATION_WARNING,
    };
  },
});

/** Warning that accompanies a successful password rotation. */
const ROTATION_WARNING =
  'The subscription password has changed. The previous credentials are no longer valid: ' +
  'update VIDSIGNER_SUBSCRIPTION_PASS of this MCP (if it is this subscription) and those of any ' +
  'other consumer of the same credentials (e.g. your backend) with the password saved in ' +
  'credentialsSavedTo; until then their calls will fail with 401.';

/**
 * Is the PUT failure ambiguous? With no response (network or timeout) or with a 5xx, the server
 * may have applied the password before failing. A 4xx (validation, 401, 409...) is a clear
 * rejection.
 */
export function isAmbiguousFailure(err: unknown): boolean {
  if (!(err instanceof VidSignerError)) return true;
  if (err.kind === 'network' || err.kind === 'timeout') return true;
  return err.httpStatus !== undefined && err.httpStatus >= 500;
}

/**
 * Turns a failure of the rotation PUT into an error that says what happened to the password and to
 * the file that holds it:
 *
 * - Ambiguous failure (network, timeout or 5xx): "It is unknown whether the password was applied.
 *   Do NOT delete the file": it may be the only copy of the current password.
 * - Clear rejection (4xx): the new password was not applied; the file can be deleted.
 * - If renaming to `.failed` failed, the path is the original one and the message does not claim
 *   a rename.
 */
function withRotationFailure(err: unknown, path: string, renamed: boolean): Error {
  const where = renamed
    ? `The file with the candidate password has been renamed to "${path}".`
    : `The file with the candidate password is still at "${path}" (renaming it to .failed was not possible).`;
  const note = isAmbiguousFailure(err)
    ? `It is unknown whether the password was applied. Do NOT delete the file "${path}": it may contain the current password. ` +
      `${where} Check whether the API accepts the current credentials of the subscription; ` +
      `if it only accepts the one in the file, update the environment of this MCP and of the other consumers with it.`
    : `The new password was NOT applied (the API rejected the PUT). ${where} You can delete it.`;
  if (err instanceof VidSignerError) {
    return new VidSignerError({
      kind: err.kind,
      message: `${err.message} ${note}`,
      httpStatus: err.httpStatus,
      code: err.code,
      details: err.details,
      timestamp: err.timestamp,
      operation: err.operation,
      cause: err,
    });
  }
  return new VidSignerError({ kind: 'api', message: note, cause: err });
}

const setSubscriptionStatus = defineTool({
  name: 'vidsigner_mgmt_set_subscription_status',
  title: 'Activate or deactivate subscription',
  domain: 'subscriptions',
  api: 'mgmt',
  risk: 'destructive',
  endpoint: 'PUT /subscription/{guid}/status/{status}',
  whenToUse: 'a subscription must be activated or deactivated without touching its other settings.',
  docSummary:
    'Activates or deactivates a subscription. Deactivating it stops every signature of the customer.',
  notes: [
    'Needs subscription-scope credentials.',
    'The manual is inconsistent (status vs state in the example).',
  ],
  example: { subscriptionGuid: '0b6f1d0e-1c2a-4c55-9d8e-3a1f5b7c9e21', status: 'active' },
  description:
    'Activates or deactivates a subscription (MGMT API, PUT /subscription/{guid}/status/{status}). DESTRUCTIVE: deactivating it stops every signature of the customer. Needs subscription-scope credentials. The manual is inconsistent (status vs state in the example).',
  inputSchema: {
    subscriptionGuid,
    status: z
      .enum(['active', 'inactive'])
      .describe(
        'active to activate the subscription, inactive to deactivate it (stops all its signatures).',
      ),
  },
  handler: async ({ subscriptionGuid, status }, ctx) => {
    await requireMgmt(ctx).setSubscriptionStatus(subscriptionGuid, status);
    return { updated: true, subscriptionGuid, status };
  },
});

const deleteSubscription = defineTool({
  name: 'vidsigner_mgmt_delete_subscription',
  title: 'Delete subscription',
  domain: 'subscriptions',
  api: 'mgmt',
  risk: 'destructive',
  endpoint: 'DELETE /subscription/{subscriptionguid}',
  whenToUse: 'a subscription must be removed for good.',
  docSummary: 'Deletes a subscription.',
  notes: ['It is irreversible.'],
  example: { subscriptionGuid: '0b6f1d0e-1c2a-4c55-9d8e-3a1f5b7c9e21' },
  description: 'Deletes a subscription (MGMT API, DELETE /subscription/{guid}). Irreversible.',
  inputSchema: { subscriptionGuid },
  handler: async ({ subscriptionGuid }, ctx) => {
    await requireMgmt(ctx).deleteSubscription(subscriptionGuid);
    return { deleted: true, subscriptionGuid };
  },
});

export const subscriptionTools: AnyToolDefinition[] = [
  listSubscriptions,
  createSubscription,
  getSubscription,
  updateSubscription,
  setSubscriptionStatus,
  deleteSubscription,
];
