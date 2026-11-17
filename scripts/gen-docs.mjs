#!/usr/bin/env node
/**
 * Generates docs/TOOLS.md (tool table with risk and the coverage matrix
 * operation -> client method -> tool) from the compiled catalog.
 * Usage: npm run gen:docs   (= npm run build && node scripts/gen-docs.mjs)
 */
import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import { ALL_TOOLS, selectTools } from '../dist/tools/index.js';
import { allAliasRows } from '../dist/tools/aliases.js';
import { strictObject } from '../dist/tools/schema-kit.js';

/** tool -> client method (VidSignerClient | VidSignerMgmtClient). */
const METHOD = {
  vidsigner_create_document: 'createDocument',
  vidsigner_get_document: 'getDocument',
  vidsigner_delete_document: 'deleteDocument',
  vidsigner_get_document_log: 'getDocumentLog',
  vidsigner_expire_document: 'expireDocument',
  vidsigner_get_document_report: 'getDocumentReport',
  vidsigner_get_document_info: 'getDocumentInfo',
  vidsigner_list_documents: 'listDocuments / listAllDocuments',
  vidsigner_list_documents_by_device: 'listDocumentsByDevice',
  vidsigner_list_signed_documents: 'listSignedDocuments',
  vidsigner_download_signed_document: 'getSignedDocument',
  vidsigner_delete_signed_document: 'deleteSignedDocument',
  vidsigner_get_signature_url: 'getSignatureRemoteUrl',
  vidsigner_send_signature_url: 'sendSignatureRemoteUrl',
  vidsigner_add_signature_attachment: 'addSignatureAttachment',
  vidsigner_update_signer_data: 'updateSignerData',
  vidsigner_get_signature_metadata: 'getSignatureMetadata',
  vidsigner_get_signature_evidence: 'getSignatureEvidence',
  vidsigner_get_vidmobile_signature_request: 'getVidMobileSignatureRequest',
  vidsigner_create_batch: 'createBatch',
  vidsigner_add_document_to_batch: 'addDocumentToBatch',
  vidsigner_close_batch: 'closeBatch',
  vidsigner_get_batch_info: 'getBatchInfo',
  vidsigner_delete_batch: 'deleteBatch',
  vidsigner_create_edelivery: 'createEDelivery',
  vidsigner_list_edeliveries: 'listEDeliveries',
  vidsigner_get_edelivery: 'getEDelivery',
  vidsigner_delete_edelivery: 'deleteEDelivery',
  vidsigner_get_edelivery_report: 'getEDeliveryReport',
  vidsigner_send_edelivery_reminder: 'sendEDeliveryReminder',
  vidsigner_search_edeliveries: 'searchEDeliveries',
  vidsigner_list_devices: 'getDevices',
  vidsigner_list_enrollment_code_devices: 'listEnrollmentCodeDevices',
  vidsigner_search: 'search',
  vidsigner_sign_xml: 'signXml',
  vidsigner_mgmt_list_partners: 'listPartners',
  vidsigner_mgmt_get_partner: 'getPartner',
  vidsigner_mgmt_list_customers: 'listCustomers',
  vidsigner_mgmt_create_customer: 'createCustomer',
  vidsigner_mgmt_get_customer: 'getCustomer',
  vidsigner_mgmt_update_customer: 'updateCustomer',
  vidsigner_mgmt_delete_customer: 'deleteCustomer',
  vidsigner_mgmt_list_subscriptions: 'listCustomerSubscriptions',
  vidsigner_mgmt_create_subscription: 'createSubscription',
  vidsigner_mgmt_get_subscription: 'getSubscription',
  vidsigner_mgmt_update_subscription: 'updateSubscription',
  vidsigner_mgmt_set_subscription_status: 'setSubscriptionStatus',
  vidsigner_mgmt_delete_subscription: 'deleteSubscription',
  vidsigner_mgmt_list_enrollment_codes: 'listEnrollmentCodes',
  vidsigner_mgmt_create_enrollment_code: 'createEnrollmentCode',
  vidsigner_mgmt_update_enrollment_code: 'updateEnrollmentCode',
  vidsigner_mgmt_delete_enrollment_code: 'deleteEnrollmentCode',
  vidsigner_mgmt_list_subscription_vidmobile_users: 'listSubscriptionVidMobileUsers',
  vidsigner_mgmt_list_subscription_vidstamper_users: 'listSubscriptionVidStamperUsers',
  vidsigner_mgmt_list_vidmobile_users: 'listVidMobileUsers',
  vidsigner_mgmt_get_vidmobile_user: 'getVidMobileUser',
  vidsigner_mgmt_get_vidmobile_user_token: 'getVidMobileUserToken',
  vidsigner_mgmt_get_vidmobile_user_personal_data: 'getVidMobileUserPersonalData',
  vidsigner_mgmt_create_vidmobile_user: 'createVidMobileUser',
  vidsigner_mgmt_delete_vidmobile_user: 'deleteVidMobileUser',
  vidsigner_mgmt_update_vidmobile_user_name: 'updateVidMobileUserName',
  vidsigner_mgmt_update_vidmobile_user_signature_image: 'updateVidMobileUserSignatureImage',
  vidsigner_mgmt_update_vidmobile_user_password: 'updateVidMobileUserPassword',
  vidsigner_mgmt_update_vidmobile_user_email: 'updateVidMobileUserEmail',
  vidsigner_mgmt_send_vidmobile_user_password_reminder: 'requestVidMobileUserPasswordReminder',
  vidsigner_mgmt_set_vidmobile_user_state: 'setVidMobileUserState',
  vidsigner_mgmt_list_vidmobile_user_certificates: 'listVidMobileUserCertificates',
  vidsigner_mgmt_add_vidmobile_user_certificate: 'addVidMobileUserCertificate',
  vidsigner_mgmt_delete_vidmobile_user_certificate: 'deleteVidMobileUserCertificate',
  vidsigner_mgmt_set_vidmobile_user_cert_types: 'setVidMobileUserCertTypes',
  vidsigner_mgmt_list_stamp_certificates: 'listStampCertificates',
  vidsigner_mgmt_add_stamp_certificate: 'addStampCertificate',
  vidsigner_mgmt_search_statistics: 'searchStatistics',
  vidsigner_mgmt_update_device: 'updateDevice',
  vidsigner_mgmt_delete_device: 'deleteDevice',
  vidsigner_mgmt_list_tsystems_doctypes: 'listTSystemsDocTypes',
  vidsigner_mgmt_create_tsystems_doctype: 'createTSystemsDocType',
  vidsigner_mgmt_delete_tsystems_doctype: 'deleteTSystemsDocType',
  vidsigner_mgmt_list_tsystems_bookcodes: 'listTSystemsBookCodes',
  vidsigner_mgmt_create_tsystems_bookcode: 'createTSystemsBookCode',
  vidsigner_mgmt_delete_tsystems_bookcode: 'deleteTSystemsBookCode',
};

const RISK = {
  read: 'read',
  write: 'write',
  destructive: 'destructive',
  mark_downloaded: 'marks as downloaded',
  sensitive_read: 'sensitive read',
  credential_read: 'credential read',
};
const missing = ALL_TOOLS.filter((t) => !METHOD[t.name]).map((t) => t.name);
if (missing.length) throw new Error(`Missing client methods for: ${missing.join(', ')}`);

const rows = (api) =>
  ALL_TOOLS.filter((t) => t.api === api)
    .map((t) => `| \`${t.endpoint}\` | \`${METHOD[t.name]}\` | \`${t.name}\` | ${RISK[t.risk]} |`)
    .join('\n');

const header = '| Operation | Client method | MCP tool | Risk |\n|---|---|---|---|';
const aliasRows = allAliasRows()
  .map((r) =>
    r.kind === 'key'
      ? `| \`${r.schema}\` | \`${r.canonical}\` / \`${r.alias}\` | ${r.send === 'both' ? 'both' : 'canonical only'} | ${r.status === 'pending' ? 'pending' : 'verified'} |`
      : `| \`${r.schema}\` | \`${r.field}\`: \`${r.canonical}\` / ${r.aliases.map((a) => `\`${a}\``).join(', ')} | canonical only | ${r.status === 'pending' ? 'pending' : 'verified'} |`,
  )
  .join('\n');

/** Flags that each risk requires and their default in pre and in pro. */
const FLAGS = {
  read: { env: [], pre: 'yes', pro: 'yes' },
  write: { env: ['VIDSIGNER_ALLOW_WRITE'], pre: 'yes', pro: 'no' },
  destructive: {
    env: ['VIDSIGNER_ALLOW_WRITE', 'VIDSIGNER_ALLOW_DESTRUCTIVE'],
    pre: 'no',
    pro: 'no',
  },
  mark_downloaded: { env: ['VIDSIGNER_ALLOW_MARK_DOWNLOADED'], pre: 'yes', pro: 'no' },
  sensitive_read: { env: ['VIDSIGNER_ALLOW_SIGNING_LINKS'], pre: 'yes', pro: 'no' },
  credential_read: { env: ['VIDSIGNER_ALLOW_CREDENTIAL_READS'], pre: 'yes', pro: 'no' },
};

/** Flags of a tool, including the activation of the management API. */
function flagsOf(t) {
  const env = [...(t.api === 'mgmt' ? ['VIDSIGNER_ENABLE_MGMT'] : []), ...FLAGS[t.risk].env];
  return env.length ? env.map((e) => `\`${e}=true\``).join(' + ') : 'none';
}

/** Default availability: management is never enabled by default. */
function defaultsOf(t, env) {
  if (t.api === 'mgmt') return 'no (management must be enabled)';
  return FLAGS[t.risk][env];
}

/** First sentence of a description, truncated. */
function brief(text, max = 150) {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  const first = clean.split(/(?<=[.!?])\s/)[0] ?? clean;
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}

/** Readable type of a JSON Schema node. */
function typeOf(node) {
  if (node.enum) return node.enum.map((v) => `\`${v}\``).join(' \\| ');
  const variants = node.anyOf ?? node.oneOf;
  if (variants) {
    return variants
      .map(typeOf)
      .filter((v) => v !== 'null')
      .join(' or ');
  }
  if (node.type === 'array') return `list of ${node.items ? typeOf(node.items) : 'values'}`;
  return Array.isArray(node.type)
    ? node.type.filter((v) => v !== 'null').join(' or ')
    : (node.type ?? 'value');
}

/** Main parameters: required ones first, up to `max` in total. */
function paramsOf(t, max = 12) {
  const schema = z.toJSONSchema(strictObject(t.inputSchema), { io: 'input' });
  const required = new Set(schema.required ?? []);
  const entries = Object.entries(schema.properties ?? {});
  entries.sort(([a], [b]) => Number(required.has(b)) - Number(required.has(a)));
  const shown = entries.slice(0, max).map(([name, node]) => {
    const where = required.has(name) ? 'required' : 'optional';
    return `  - \`${name}\` (${typeOf(node)}, ${where}): ${brief(node.description)}`;
  });
  if (entries.length > max) {
    shown.push(`  - … and ${entries.length - max} more (see the tool schema).`);
  }
  return shown.length ? shown.join('\n') : '  - No parameters.';
}

/** One section per tool with everything needed to decide whether to enable it. */
function section(t) {
  const lines = [
    `#### \`${t.name}\``,
    '',
    `- **Operation:** \`${t.endpoint}\``,
    `- **Risk:** ${RISK[t.risk]}`,
    `- **Flags:** ${flagsOf(t)} (default in pre: ${defaultsOf(t, 'pre')}; in pro: ${defaultsOf(t, 'pro')})`,
    `- **Description:** ${t.docSummary}`,
    '- **Main parameters:**',
    paramsOf(t),
  ];
  if (t.notes?.length) {
    lines.push('- **Notes and restrictions:**', ...t.notes.map((n) => `  - ${n}`));
  }
  if (t.example) lines.push(`- **Example:** \`${JSON.stringify(t.example)}\``);
  return lines.join('\n');
}

const DOMAIN_TITLE = {
  documents: 'Documents',
  signeddocuments: 'Signed documents',
  signature: 'Signatures and signers',
  batch: 'Batches',
  edelivery: 'E-Delivery',
  devices: 'Devices',
  search: 'Search',
  xml: 'XML sealing',
  partners: 'Partners',
  customers: 'Customers',
  subscriptions: 'Subscriptions',
  enrollmentcodes: 'Enrollment codes',
  vidmobileusers: 'VIDmobile and VIDstamper users',
  certificates: 'Certificates',
  statistics: 'Statistics',
  'mgmt-devices': 'Devices (management)',
  tsystems: 'T-Systems',
};

function detail(api) {
  const byDomain = new Map();
  for (const t of ALL_TOOLS.filter((x) => x.api === api)) {
    byDomain.set(t.domain, [...(byDomain.get(t.domain) ?? []), t]);
  }
  return [...byDomain.entries()]
    .map(
      ([domain, tools]) =>
        `### ${DOMAIN_TITLE[domain] ?? domain}\n\n${tools.map(section).join('\n\n')}`,
    )
    .join('\n\n');
}

/** Environment x flags -> visible tools matrix, computed with the real policy. */
const base = {
  environment: 'pre',
  allowWrite: true,
  allowDestructive: false,
  allowMarkDownloaded: true,
  allowSigningLinks: true,
  allowCredentialReads: true,
  enableMgmt: false,
};
const prod = {
  ...base,
  environment: 'pro',
  allowWrite: false,
  allowMarkDownloaded: false,
  allowSigningLinks: false,
  allowCredentialReads: false,
};
const MATRIX = [
  ['pre, default', base],
  ['pre + `VIDSIGNER_ENABLE_MGMT`', { ...base, enableMgmt: true }],
  [
    'pre + management + `VIDSIGNER_ALLOW_DESTRUCTIVE`',
    { ...base, enableMgmt: true, allowDestructive: true },
  ],
  ['pro, default (read-only)', prod],
  ['pro + `VIDSIGNER_ENABLE_MGMT`', { ...prod, enableMgmt: true }],
  ['pro + `VIDSIGNER_ALLOW_WRITE`', { ...prod, allowWrite: true }],
  [
    'pro + `ALLOW_WRITE` + `ALLOW_MARK_DOWNLOADED` + `ALLOW_SIGNING_LINKS`',
    { ...prod, allowWrite: true, allowMarkDownloaded: true, allowSigningLinks: true },
  ],
  [
    'pro + management + `ALLOW_CREDENTIAL_READS`',
    { ...prod, enableMgmt: true, allowCredentialReads: true },
  ],
  [
    'pro with every flag',
    {
      ...prod,
      allowWrite: true,
      allowDestructive: true,
      allowMarkDownloaded: true,
      allowSigningLinks: true,
      allowCredentialReads: true,
      enableMgmt: true,
    },
  ],
];
const matrixRows = MATRIX.map(([label, sec]) => {
  const { enabled } = selectTools(sec);
  const rest = enabled.filter((t) => t.api === 'rest').length;
  const mgmt = enabled.filter((t) => t.api === 'mgmt').length;
  return `| ${label} | ${rest} | ${mgmt} | ${rest + mgmt} |`;
}).join('\n');

const out = `# Tools and coverage

Generated by \`scripts/gen-docs.mjs\` (\`npm run gen:docs\`). Do not edit by hand.

The descriptions below come from the code itself (\`docSummary\`, \`notes\` and \`example\` of each tool). What the model sees is the English description of \`tools/list\`, with "Use when ...", the example and the risk notice with its flag; parameter names and descriptions are shown exactly as the model receives them.

## Visibility by configuration

How many tools the server registers in each configuration (computed with the real policy of \`src/tools/policy.ts\`).

| Configuration | Signature | Management | Total |
|---|---|---|---|
${matrixRows}

## Signature API (VIDcloud 3.0): ${ALL_TOOLS.filter((t) => t.api === 'rest').length} tools

${header}
${rows('rest')}

## Management API (MGMT 1.0): ${ALL_TOOLS.filter((t) => t.api === 'mgmt').length} tools (after \`VIDSIGNER_ENABLE_MGMT=true\`)

${header}
${rows('mgmt')}

## Tool details

### Signature API

${detail('rest')}

### Management API

${detail('mgmt')}

## Alternative spellings (OpenAPI versus manual)

The tools accept both spellings, normalize them to the canonical one and, where there is a real doubt, send both. The decision lives in \`src/tools/aliases.ts\`; **pending verification in pre-production with a ClientID**.

| Schema | Field | Sent | Status |
|---|---|---|---|
${aliasRows}

## Operations without a tool (client method only, or none)

| Operation | Reason |
|---|---|
| \`POST /oauth/token\` (signature and management) | Internal to the client (\`TokenProvider\`); it makes no sense as a tool. |
| \`POST /oauth/code\` (MGMT manual changelog v1.17) | Appears only in the change history of the MGMT manual, with no section or format: not implemented. |
`;
writeFileSync(new URL('../docs/TOOLS.md', import.meta.url), out);
console.log(`docs/TOOLS.md: ${ALL_TOOLS.length} tools`);
