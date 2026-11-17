/**
 * Types of the notifications (webhooks) that VIDsigner sends to your endpoint.
 *
 * Source: REST manual, Annex I (Notification Rest Service Requirements). The MCP server
 * does NOT receive webhooks; these types are meant for the backend service that does
 * receive them. Field names match the manual exactly.
 *
 * Common behavior (15.4-15.13):
 * - VIDsigner issues `POST {BaseURL}/{event}/{GUID}` with a JSON body.
 * - The endpoint must answer 200; any other code is treated as a failure and alerts the admin.
 * - The notification does NOT include the document: it is downloaded afterwards with
 *   `GET /signeddocuments/{DocGUI}` (which marks it as downloaded) or `GET /documents/{DocGUI}` (which does not).
 * - With `ExcludeParams` the GUID is not part of the URL; with `UseNotificationUrlAsIs` the event type
 *   travels in (undocumented) headers and the URL is left untouched.
 * - If the URL is set on the subscription and also on `POST /documents`, two notifications are sent.
 */

/** IPs from which VIDsigner sends the notifications (manual, section 2). */
export const VIDSIGNER_NOTIFICATION_SOURCE_IPS = {
  pro: '40.118.19.23',
  pre: '52.166.168.111',
} as const;

/** Path segment that identifies each notification type. */
export const WEBHOOK_EVENT_TYPES = [
  'createddocstatus',
  'docstatus',
  'signerstatus',
  'expireddocstatus',
  'mingroupstatus',
  'approverstatus',
  'batchstatus',
  'emailstatus',
  'edeliverystatus',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/** Extended properties: key -> list of strings pairs. */
export type WebhookExtendedProperties = Record<string, string[]>;

export interface WebhookApprover {
  LegalId?: string;
  Name?: string;
  Email?: string;
  /** `Pending` | `Approved` | `Rejected`. */
  Status?: string;
  OperationTime?: string | null;
}

export interface WebhookEvidence {
  Ip?: string | null;
  Location?: string | null;
  Destination?: string | null;
  From?: string | null;
  EvidenceType?: string;
  EvidenceDate?: string;
  ExtendedProperties?: WebhookExtendedProperties;
}

export interface WebhookFormField {
  Id?: string;
  Title?: string;
  /** RadioButtons/CheckBoxes: chosen option (number). TextBoxes: entered text. */
  Response?: string | number;
}

export interface WebhookFormInfo {
  Sections?: Array<{
    Groups?: Array<{
      Title?: string;
      RadioButtons?: WebhookFormField[];
      CheckBoxes?: WebhookFormField[];
      TextBoxes?: WebhookFormField[];
    }>;
  }>;
}

export interface WebhookSigner {
  SignerGUI: string;
  SignerName?: string | null;
  /** `Unsigned` | `Signed` | `Rejected`. */
  SignatureStatus: 'Unsigned' | 'Signed' | 'Rejected' | string;
  Language?: string;
  /** `bio` | `mobile` | `smartcard` | `emailandsms` | `stamp`. */
  SignatureType?: string;
  DeviceName?: string | null;
  CertificateGUI?: string | null;
  Email?: string | null;
  PhoneNumber?: string | null;
  SendSignedDoc?: boolean;
  SkipSignatureEmail?: boolean;
  /** Only if the signature was rejected with a reason. */
  RejectionReason?: string | null;
  SignatureReason?: string | null;
  TypeOfID?: string | null;
  NumberID?: string | null;
  /** UTC `yyyy-MM-dd HH:mm:ss`; `null` if not yet signed or rejected. */
  OperationTime?: string | null;
  Approvers?: WebhookApprover[];
  ExtendedProperties?: WebhookExtendedProperties;
  Evidences?: WebhookEvidence[];
  FormInfo?: WebhookFormInfo | null;
}

export interface WebhookSignerGroup {
  Min?: number;
  Max?: number;
  OrderedSignatures?: boolean;
  Signers: WebhookSigner[];
}

/**
 * Common body of `createddocstatus`, `docstatus`, `signerstatus`,
 * `expireddocstatus`, `mingroupstatus` y `approverstatus` (15.4–15.6, 15.8, 15.11–15.13).
 */
export interface DocumentNotificationPayload {
  FileName?: string;
  DocGUI: string;
  /** `Unsigned` | `Signed` | `Rejected`. */
  DocStatus: 'Unsigned' | 'Signed' | 'Rejected' | string;
  /** Only signed documents can be downloaded. */
  Downloaded?: boolean;
  AdditionalData?: string | null;
  UploadTime?: string;
  Tag?: string | null;
  IssuerName?: string | null;
  ExpirationTime?: string | null;
  NotificationURL?: string | null;
  ExtendedProperties?: WebhookExtendedProperties;
  OrderedGroups?: boolean;
  SignersGroups?: WebhookSignerGroup[];
}

/** `batchstatus` (15.7). The manual calls the batch identifier `DocGUI` in the example and `BatchGUI` in the table. */
export interface BatchNotificationPayload {
  BatchGUI?: string;
  DocGUI?: string;
  /** `Pending` | `Completed`. */
  BatchStatus: 'Pending' | 'Completed' | string;
  Docs: Array<{ DocGUI: string; Status: string }>;
}

/** `emailstatus` (15.9): status changes of the email sent to the signer (e.g. `EMAIL_OPENED`). */
export interface EmailStatusNotificationPayload {
  DocGUID: string;
  SignerGUID: string;
  Status: string;
  /** UTC `yyyy-MM-dd HH:mm:ss`. */
  DateTime: string;
  ExtendedInformation?: Record<string, string>;
}

/** `edeliverystatus` (15.10). Enabled per subscription. */
export interface EDeliveryNotificationPayload {
  GUID: string;
  RecipientEmail?: string;
  RecipientPhoneNumber?: string;
  Language?: string;
  /** `pending` | `delivered` | `expired`. */
  Status: string;
  SendingDate?: string;
  DeliveryDate?: string | null;
  ExpirationDate?: string;
  Docs?: Array<{
    GUID: string;
    FileName?: string;
    AdditionalData?: string | null;
    Delivered?: boolean;
    Downloaded?: boolean;
    DeliveryDate?: string | null;
    DownloadDate?: string | null;
    eDeliveryEvidences?: Array<{ EvidenceType: string; EvidenceDate: string }>;
  }>;
  Reminder?: { Frequency: number; MaxRetries: number; CurrentRetries: number };
}

/** Event -> body type mapping. */
export interface WebhookPayloadMap {
  createddocstatus: DocumentNotificationPayload;
  docstatus: DocumentNotificationPayload;
  signerstatus: DocumentNotificationPayload;
  expireddocstatus: DocumentNotificationPayload;
  mingroupstatus: DocumentNotificationPayload;
  approverstatus: DocumentNotificationPayload;
  batchstatus: BatchNotificationPayload;
  emailstatus: EmailStatusNotificationPayload;
  edeliverystatus: EDeliveryNotificationPayload;
}

/** Identified notification: `event` discriminates the type of `payload`. */
export type WebhookEvent = {
  [K in WebhookEventType]: { event: K; guid?: string; payload: WebhookPayloadMap[K] };
}[WebhookEventType];

/**
 * Derives the event type and the GUID from the notification path
 * (`/{BaseURL}/{event}/{GUID}`). With `ExcludeParams` there is no GUID.
 *
 * @example
 * parseWebhookPath('/vidsigner/hooks/signerstatus/e95dd99d-6401-4418')
 * // => { event: 'signerstatus', guid: 'e95dd99d-6401-4418' }
 */
export function parseWebhookPath(
  pathname: string,
): { event: WebhookEventType; guid?: string } | undefined {
  const parts = pathname.split('?')[0]!.split('/').filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    const candidate = parts[i]!.toLowerCase() as WebhookEventType;
    if ((WEBHOOK_EVENT_TYPES as readonly string[]).includes(candidate)) {
      const guid = parts[i + 1];
      return guid ? { event: candidate, guid: decodeURIComponent(guid) } : { event: candidate };
    }
  }
  return undefined;
}
