import { z } from 'zod';
import { defineTool, type AnyToolDefinition } from '../define.js';
import { IMAGE } from '../files.js';
import { fileInputShape, id } from '../schemas.js';
import { hideSecrets, requireMgmt } from '../util.js';

const legalId = id('Legal id (NIF/NIE) of the VIDmobile user: the identifier used in the URL.');
const subscriptionGuid = id('Subscription GUID.');
const BASIC = 'Uses the subscription credentials (Basic), no OAuth client needed.';

const listBySubscription = defineTool({
  name: 'vidsigner_mgmt_list_subscription_vidmobile_users',
  title: 'List VIDmobile users of a subscription (partner)',
  domain: 'vidmobileusers',
  api: 'mgmt',
  risk: 'read',
  endpoint: 'GET /subscription/{guid}/vidmobileusers',
  whenToUse: 'you need the VIDmobile users of a subscription from the partner scope.',
  docSummary:
    'Lists the VIDmobile users of a subscription (partner scope). Contains personal data; secrets are hidden.',
  description:
    'Lists the VIDmobile users of a subscription (MGMT API, partner scope). Contains personal data.',
  inputSchema: { subscriptionGuid },
  handler: async ({ subscriptionGuid }, ctx) => {
    const items = await requireMgmt(ctx).listSubscriptionVidMobileUsers(subscriptionGuid);
    return { count: items.length, items: hideSecrets(items) };
  },
});

const listStamperUsers = defineTool({
  name: 'vidsigner_mgmt_list_subscription_vidstamper_users',
  title: 'List VIDstamper users of a subscription',
  domain: 'vidmobileusers',
  api: 'mgmt',
  risk: 'read',
  endpoint: 'GET /subscription/{guid}/vidstamperusers',
  whenToUse: 'you need the VIDstamper (automatic stamp) users of a subscription.',
  docSummary: 'Lists the VIDstamper users of a subscription (partner scope).',
  description: 'Lists the VIDstamper users of a subscription (MGMT API, partner scope).',
  inputSchema: { subscriptionGuid },
  handler: async ({ subscriptionGuid }, ctx) => {
    const items = await requireMgmt(ctx).listSubscriptionVidStamperUsers(subscriptionGuid);
    return { count: items.length, items: hideSecrets(items) };
  },
});

const listUsers = defineTool({
  name: 'vidsigner_mgmt_list_vidmobile_users',
  title: 'List VIDmobile users',
  domain: 'vidmobileusers',
  api: 'mgmt',
  risk: 'read',
  endpoint: 'GET /vidmobileusers',
  whenToUse: 'you need the VIDmobile users of the configured subscription.',
  docSummary:
    'Lists the VIDmobile users of the configured subscription. Uses subscription credentials (Basic). Passwords are not shown.',
  description: `Lists the VIDmobile users of the configured subscription (MGMT API). ${BASIC} Passwords are never shown. Contains personal data.`,
  inputSchema: {},
  handler: async (_a, ctx) => {
    const items = await requireMgmt(ctx).listVidMobileUsers();
    return { count: items.length, items: hideSecrets(items) };
  },
});

const getUser = defineTool({
  name: 'vidsigner_mgmt_get_vidmobile_user',
  title: 'Get VIDmobile user',
  domain: 'vidmobileusers',
  api: 'mgmt',
  risk: 'read',
  endpoint: 'GET /vidmobileusers/{legalid}',
  whenToUse: 'you need the data of one VIDmobile user by legal id.',
  docSummary: 'Returns a VIDmobile user. The token and password in the response are not shown.',
  description: `Returns a VIDmobile user (MGMT API). ${BASIC} The token and password in the response are never shown.`,
  inputSchema: { legalId },
  handler: async ({ legalId }, ctx) =>
    hideSecrets(await requireMgmt(ctx).getVidMobileUser(legalId)),
});

const getPersonalData = defineTool({
  name: 'vidsigner_mgmt_get_vidmobile_user_personal_data',
  title: 'Get VIDmobile user enrollment data',
  domain: 'vidmobileusers',
  api: 'mgmt',
  risk: 'read',
  endpoint: 'GET /vidmobileusers/{legalid}/personaldata',
  whenToUse:
    'you must audit the enrollment data of a VIDmobile user (name, legal id and ID-card images).',
  docSummary:
    'Returns the enrollment data of a VIDmobile user: full name, legal id and the two images of the ID document, which are saved to disk (0600).',
  notes: [
    'Highly sensitive personal data.',
    'Not available in pre-production: the route answers the IIS 404 page ("The resource you are looking for has been removed...") for every user, including with variants (trailing slash, singular, GUID in place of legal id). Listed in the manual, UNCONFIRMED in this environment.',
  ],
  description: `Returns the enrollment data of a VIDmobile user: full name, legal id and the ID-card images (MGMT API). ${BASIC} The two images are saved to disk (0600) and only their paths are returned. Highly sensitive personal data. Not available in pre-production: the route answers the IIS 404 page ("The resource you are looking for has been removed...") for every user, including with variants (trailing slash, singular, GUID in place of legal id). Listed in the manual, UNCONFIRMED in this environment.`,
  inputSchema: { legalId },
  handler: async ({ legalId }, ctx) => {
    const data = await requireMgmt(ctx).getVidMobileUserPersonalData(legalId);
    const a = data.DocIdImageSideA
      ? await ctx.files.saveBase64(data.DocIdImageSideA, `idcard-${legalId}-A.jpg`)
      : undefined;
    const b = data.DocIdImageSideB
      ? await ctx.files.saveBase64(data.DocIdImageSideB, `idcard-${legalId}-B.jpg`)
      : undefined;
    return {
      fullname: data.fullname,
      legalidNumber: data.legalidNumber,
      idCardSideA: a?.path ?? null,
      idCardSideB: b?.path ?? null,
    };
  },
});

const createUser = defineTool({
  name: 'vidsigner_mgmt_create_vidmobile_user',
  title: 'Create VIDmobile user',
  domain: 'vidmobileusers',
  api: 'mgmt',
  risk: 'write',
  endpoint: 'POST /vidmobileusers',
  whenToUse: 'a person needs a VIDmobile (centralized certificate) account to sign.',
  docSummary:
    'Creates a VIDmobile user and returns its GUID. Unless skipEnrollEmail=true it sends a real enrollment email.',
  notes: [
    '409 if the userid or the legalid already exist.',
    'The email is mandatory and validated (empty and "null" are rejected).',
    'The password goes through the arguments of the call (it ends up in the model context).',
    'The API REQUIRES a handwritten signature image: send filePath or contentBase64 (exactly one, max 100 KB). Without it the call is refused before reaching the API.',
    'The API enforces a password policy (verified in pre-production): at least 8 characters, an uppercase letter, a number and one of the special characters @ # $ (! - _ . are NOT accepted as the special one); otherwise 400 "password must be contains at least an uppercase / a number / an special char like @#$".',
  ],
  example: {
    userid: 'jane@example.test',
    username: 'Jane Doe',
    legalid: '12345678Z',
    email: 'jane@example.test',
    password: 'Change-me#1234',
    skipEnrollEmail: true,
    filePath: '/Users/me/vidsigner-mcp/in/signature.png',
  },
  description: `Creates a VIDmobile user (centralized-certificate signer) and returns its GUID (MGMT API). ${BASIC} Unless skipEnrollEmail=true it SENDS A REAL ENROLLMENT EMAIL. 409 if the userid or legalid already exists. A handwritten signature image is REQUIRED (filePath or base64, max 100 KB) and the password needs 8+ characters, an uppercase letter, a number and one of @ # $ (400 otherwise).`,
  inputSchema: {
    userid: z.string().describe('Unique user id (usually the email).'),
    username: z.string().describe('Display name of the user.'),
    legalid: z.string().describe('Legal id (NIF/NIE) of the user; unique in the subscription.'),
    email: z.string().describe('Email of the user (VIDSIGNER_ALLOWED_EMAIL_DOMAINS restricts it).'),
    password: z
      .string()
      .min(4)
      .max(100)
      .describe(
        'Password of the user, 4-100 characters (a secret). The API requires 8+ characters, an uppercase letter, a number and one of @ # $: otherwise 400.',
      ),
    skipEnrollEmail: z.boolean().describe('true to NOT send the enrollment email.'),
    PhoneNumber: z.string().optional().describe('E.164.'),
    Language: z
      .enum(['ca', 'de', 'en', 'es'])
      .optional()
      .describe('Language of the enrollment email.'),
    ...fileInputShape,
  },
  handler: async ({ filePath, contentBase64, ...user }, ctx) => {
    const email = ctx.policy.assertRequiredEmail(user.email, 'email');
    const phone = ctx.policy.assertPhone(user.PhoneNumber, 'PhoneNumber') as string | undefined;
    const img = await ctx.files.loadInput({ filePath, contentBase64 }, IMAGE);
    return requireMgmt(ctx).createVidMobileUser({
      ...user,
      email,
      ...(phone !== undefined ? { PhoneNumber: phone } : {}),
      signatureimage: img.base64,
    });
  },
});

const deleteUser = defineTool({
  name: 'vidsigner_mgmt_delete_vidmobile_user',
  title: 'Delete VIDmobile user',
  domain: 'vidmobileusers',
  api: 'mgmt',
  risk: 'destructive',
  endpoint: 'DELETE /vidmobileusers/{legalid}',
  whenToUse: 'a VIDmobile user must be removed for good.',
  docSummary: 'Deletes a VIDmobile user.',
  notes: [
    'Refused (409) if it still has certificates or pending signatures.',
    'It is irreversible.',
  ],
  example: { legalId: '12345678Z' },
  description: `Deletes a VIDmobile user (MGMT API). ${BASIC} Refused (409) if it still has certificates or pending signatures. Irreversible.`,
  inputSchema: { legalId },
  handler: async ({ legalId }, ctx) => {
    await requireMgmt(ctx).deleteVidMobileUser(legalId);
    return { deleted: true };
  },
});

const updateName = defineTool({
  name: 'vidsigner_mgmt_update_vidmobile_user_name',
  title: 'Update VIDmobile user name',
  domain: 'vidmobileusers',
  api: 'mgmt',
  risk: 'write',
  endpoint: 'PUT /vidmobileusers/{id}/username',
  whenToUse: 'the display name of a VIDmobile user must change.',
  docSummary: 'Changes the display name of a VIDmobile user (max 255 characters).',
  example: { legalId: '12345678Z', userName: 'Jane Q. Doe' },
  description: `Changes the display name of a VIDmobile user, max 255 chars (MGMT API). ${BASIC}`,
  inputSchema: {
    legalId,
    userName: z.string().min(1).max(255).describe('New display name, max 255 characters.'),
  },
  handler: async ({ legalId, userName }, ctx) => {
    await requireMgmt(ctx).updateVidMobileUserName(legalId, userName);
    return { updated: true };
  },
});

const updateImage = defineTool({
  name: 'vidsigner_mgmt_update_vidmobile_user_signature_image',
  title: 'Update VIDmobile user signature image',
  domain: 'vidmobileusers',
  api: 'mgmt',
  risk: 'write',
  endpoint: 'PUT /vidmobileusers/{id}/signatureimage',
  whenToUse: 'the handwritten signature image of a VIDmobile user must be replaced.',
  docSummary: 'Replaces the handwritten signature image of a VIDmobile user (max 100 KB).',
  notes: ['Accepts filePath or contentBase64.'],
  example: { legalId: '12345678Z', filePath: '/Users/me/vidsigner-mcp/in/signature.png' },
  description: `Replaces the handwritten signature image of a VIDmobile user, max 100 KB (MGMT API). ${BASIC} Accepts a local file or base64.`,
  inputSchema: { legalId, ...fileInputShape },
  handler: async ({ legalId, filePath, contentBase64 }, ctx) => {
    const img = await ctx.files.loadInput({ filePath, contentBase64 }, IMAGE);
    await requireMgmt(ctx).updateVidMobileUserSignatureImage(legalId, img.base64);
    return { updated: true, bytes: img.bytes };
  },
});

const updatePassword = defineTool({
  name: 'vidsigner_mgmt_update_vidmobile_user_password',
  title: 'Update VIDmobile user password',
  domain: 'vidmobileusers',
  api: 'mgmt',
  risk: 'destructive',
  endpoint: 'PUT /vidmobileusers/{id}/password',
  whenToUse: 'the password of a VIDmobile user must be reset.',
  docSummary:
    'Sets a new password (4 to 100 characters) for a VIDmobile user. It can lock the user out of their account.',
  notes: ['The password travels in the arguments of the call.'],
  example: { legalId: '12345678Z', password: 'new-password-1234' },
  description: `Sets a new password (4-100 chars) for a VIDmobile user (MGMT API). DESTRUCTIVE: it can lock the user out of their account. ${BASIC} The password travels in the arguments of this call.`,
  inputSchema: {
    legalId,
    password: z.string().min(4).max(100).describe('New password, 4-100 characters (a secret).'),
  },
  handler: async ({ legalId, password }, ctx) => {
    await requireMgmt(ctx).updateVidMobileUserPassword(legalId, password);
    return { updated: true };
  },
});

const updateEmail = defineTool({
  name: 'vidsigner_mgmt_update_vidmobile_user_email',
  title: 'Update VIDmobile user email',
  domain: 'vidmobileusers',
  api: 'mgmt',
  risk: 'destructive',
  endpoint: 'PUT /vidmobileusers/{id}/email',
  whenToUse: 'the email of a VIDmobile user must change.',
  docSummary:
    'Changes the email of a VIDmobile user. Whoever owns the new address receives the notifications and can recover the account.',
  notes: [
    'The email is mandatory and validated (empty and "null" are rejected); it is sent trimmed.',
  ],
  example: { legalId: '12345678Z', email: 'new@example.test' },
  description: `Changes the email of a VIDmobile user (MGMT API). DESTRUCTIVE: whoever owns the new address receives the account notifications and can recover the account. ${BASIC}`,
  inputSchema: {
    legalId,
    email: z
      .string()
      .describe('New email of the user (VIDSIGNER_ALLOWED_EMAIL_DOMAINS restricts it).'),
  },
  handler: async ({ legalId, email }, ctx) => {
    const clean = ctx.policy.assertRequiredEmail(email, 'email');
    await requireMgmt(ctx).updateVidMobileUserEmail(legalId, clean);
    return { updated: true };
  },
});

const remindPassword = defineTool({
  name: 'vidsigner_mgmt_send_vidmobile_user_password_reminder',
  title: 'Send VIDmobile account info by email',
  domain: 'vidmobileusers',
  api: 'mgmt',
  risk: 'write',
  endpoint: 'PUT /vidmobileusers/{legalid}/remindpasswordrequest',
  whenToUse:
    'a VIDmobile user forgot how to access and must receive their account information again.',
  docSummary: 'Emails the VIDmobile user their account information.',
  notes: ['Sends a real email.'],
  example: { legalId: '12345678Z' },
  description: `Emails the account information of a VIDmobile user to them (MGMT API). SENDS A REAL EMAIL. ${BASIC}`,
  inputSchema: { legalId },
  handler: async ({ legalId }, ctx) => {
    await requireMgmt(ctx).requestVidMobileUserPasswordReminder(legalId);
    return { sent: true };
  },
});

const setState = defineTool({
  name: 'vidsigner_mgmt_set_vidmobile_user_state',
  title: 'Set VIDmobile user state',
  domain: 'vidmobileusers',
  api: 'mgmt',
  risk: 'destructive',
  endpoint: 'PUT /vidmobileusers/{legalid}/state/{state}',
  whenToUse:
    'a VIDmobile user must be activated or deactivated; try it only in pre-production because the valid states are undocumented.',
  docSummary: 'Changes the state of a VIDmobile user. Deactivating it blocks their signatures.',
  notes: [
    'The operation appears in the manual table with no detail: the valid values of state are undocumented (probably active and inactive).',
    'Not available in pre-production: PUT /vidmobileusers/{legalid}/state/{state} answers the IIS 404 page for active, inactive, Active, 1, 0, true and false, with and without trailing slash. UNCONFIRMED in this environment: it may not be deployed.',
  ],
  example: { legalId: '12345678Z', state: 'inactive' },
  description: `Changes the state of a VIDmobile user (MGMT API). DESTRUCTIVE: deactivating the user blocks their signatures. The operation appears in the manual's table with no detail: the valid values of state are undocumented. NOT AVAILABLE in pre-production: every attempt (active, inactive, 1, 0, true, false) answered the IIS 404 page, so the route is unconfirmed. ${BASIC}`,
  inputSchema: {
    legalId,
    state: z.string().min(1).describe('Undocumented; probably active / inactive.'),
  },
  handler: async ({ legalId, state }, ctx) => {
    await requireMgmt(ctx).setVidMobileUserState(legalId, state);
    return { updated: true, state };
  },
});

const getUserToken = defineTool({
  name: 'vidsigner_mgmt_get_vidmobile_user_token',
  title: 'Get VIDmobile user token (saved to file)',
  domain: 'vidmobileusers',
  api: 'mgmt',
  risk: 'credential_read',
  endpoint: 'GET /vidmobileusers/{legalid}/token',
  whenToUse:
    'you must obtain the token of a VIDmobile user for a trusted integration; it is saved to a 0600 file, never shown.',
  docSummary:
    'Requests the token of a VIDmobile user. The token is a secret: it is never returned; the response is saved to a 0600 file and only its path is returned.',
  notes: [
    'The manual lists it without a detail section: the response format is undocumented.',
    'Not available in pre-production: the route answers the IIS 404 page ("The resource you are looking for has been removed...") for every user, including with variants (trailing slash, singular, GUID in place of legal id). Listed in the manual, UNCONFIRMED in this environment.',
    'It requires VIDSIGNER_ALLOW_CREDENTIAL_READS, which is separate from VIDSIGNER_ALLOW_SIGNING_LINKS.',
  ],
  description: `Requests the token of a VIDmobile user (MGMT API). The manual lists it without a detail section, so the response format is undocumented. NOT AVAILABLE in pre-production: the route answers the IIS 404 page for every user (unconfirmed in this environment). ${BASIC} The token is a secret: it is NEVER returned; the raw response is saved to a 0600 file and only its path is returned.`,
  inputSchema: { legalId },
  handler: async ({ legalId }, ctx) => {
    const raw = await requireMgmt(ctx).getVidMobileUserToken(legalId);
    const saved = await ctx.files.saveBuffer(
      Buffer.from(typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2)),
      `vidmobileuser-${legalId}-token.json`,
    );
    return { tokenSavedTo: saved.path, bytes: saved.bytes };
  },
});

export const vidMobileUserTools: AnyToolDefinition[] = [
  listBySubscription,
  listStamperUsers,
  listUsers,
  getUser,
  getUserToken,
  getPersonalData,
  createUser,
  deleteUser,
  updateName,
  updateImage,
  updatePassword,
  updateEmail,
  remindPassword,
  setState,
];

// Reused by certificates.ts
export { legalId as legalIdParam, subscriptionGuid as subscriptionGuidParam, BASIC as BASIC_NOTE };
