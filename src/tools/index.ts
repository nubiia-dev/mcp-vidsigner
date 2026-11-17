import type { SecurityConfig } from '../config.js';
import type { AnyToolDefinition } from './define.js';
import { partitionByPolicy } from './policy.js';
import { batchTools } from './rest/batch.js';
import { deviceTools } from './rest/devices.js';
import { documentTools } from './rest/documents.js';
import { edeliveryTools } from './rest/edelivery.js';
import { searchTools } from './rest/search.js';
import { signatureTools } from './rest/signature.js';
import { signedDocumentTools } from './rest/signeddocuments.js';
import { xmlTools } from './rest/xml.js';
import { certificateTools } from './mgmt/certificates.js';
import { customerTools } from './mgmt/customers.js';
import { mgmtDeviceTools } from './mgmt/devices.js';
import { enrollmentCodeTools } from './mgmt/enrollmentcodes.js';
import { partnerTools } from './mgmt/partners.js';
import { statisticsTools } from './mgmt/statistics.js';
import { subscriptionTools } from './mgmt/subscriptions.js';
import { tsystemsTools } from './mgmt/tsystems.js';
import { vidMobileUserTools } from './mgmt/vidmobileusers.js';

/** All tools of the signature API (VIDcloud 3.0). */
export const REST_TOOLS: AnyToolDefinition[] = [
  ...documentTools,
  ...signedDocumentTools,
  ...signatureTools,
  ...batchTools,
  ...edeliveryTools,
  ...deviceTools,
  ...searchTools,
  ...xmlTools,
];

/** All tools of the management API (MGMT 1.0). */
export const MGMT_TOOLS: AnyToolDefinition[] = [
  ...partnerTools,
  ...customerTools,
  ...subscriptionTools,
  ...enrollmentCodeTools,
  ...vidMobileUserTools,
  ...certificateTools,
  ...statisticsTools,
  ...mgmtDeviceTools,
  ...tsystemsTools,
];

/** Full catalog, not filtered by policy. */
export const ALL_TOOLS: AnyToolDefinition[] = [...REST_TOOLS, ...MGMT_TOOLS];

/** Tools that would be registered with the given security configuration, and the skipped ones with their reason. */
export function selectTools(
  security: SecurityConfig,
  tools: readonly AnyToolDefinition[] = ALL_TOOLS,
) {
  return partitionByPolicy(tools, security);
}
