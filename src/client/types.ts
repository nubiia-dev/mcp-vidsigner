/**
 * Types of the signing API (VIDcloud 3.0).
 *
 * The base DTOs are generated with `npm run gen:types` from
 * `spec/VIDsignerOpenAPI_Lastest.json` (openapi-typescript). This file only
 * gives them short names and adds what the REST manual documents but the
 * OpenAPI spec does not cover (signer fields such as `SkipSignatureEmail`).
 */
import type { components } from './generated/vidsigner-api.js';
import type {
  ManualCentralizedCertificateDTOExtras,
  ManualDocAppearanceDTOExtras,
  ManualDocumentRecipientDTOExtras,
  ManualFormsFormAttachmentResponseDTOExtras,
  ManualRejectionOptionDTO,
  ManualSendDocumentBatchDTOExtras,
  ManualSendDocumentDTOExtras,
  ManualSignerBatchSignerDTOExtras,
  ManualSignerSignerDataDtoExtras,
  ManualSignerSignerV2DTOExtras,
} from './generated/manual-extras.js';

type S = components['schemas'];

type P = 'VIDCloudRestPubDTOs.DTOs.';

// ---------------------------------------------------------------------------
// Statuses and constants from the manual (sections 7 and 8)
// ---------------------------------------------------------------------------

export type DocStatus = 'Unsigned' | 'Signed' | 'Rejected';
export type SignatureStatus = 'Unsigned' | 'Signed' | 'Rejected';
export type BatchStatus = 'Pending' | 'Completed';
export type ApproverStatus = 'Pending' | 'Approved' | 'Rejected';
export type EDeliveryStatus = 'pending' | 'delivered' | 'expired';

/** Signature channels: BIO, VIDmobile (centralized), SmartCard, VIDremote and Stamper. */
export type SignatureType = 'bio' | 'mobile' | 'smartcard' | 'emailandsms' | 'stamp';

/** Values of `GET /documentlist/{id}`. */
export const DOCUMENT_LIST_FILTERS = [
  'all',
  'unsigned',
  'signed',
  'rejected',
  'signeddownloaded',
  'signednotdownloaded',
] as const;
export type DocumentListFilter = (typeof DOCUMENT_LIST_FILTERS)[number];

/**
 * `orderBy` values of `GET /documentlist/{filter}` verified in pre (2026-11-16).
 * The server also advertises `DocGUI` (400/10520 lists it), but using it answers
 * 400/10500 "Malformed filter", so it is not accepted.
 */
export const DOCUMENT_LIST_ORDER_BY = [
  'FileName',
  'DocStatus',
  'Downloaded',
  'AdditionalData',
  'UploadTime',
] as const;

/**
 * `orderType` values the client accepts in documentlist. The server ONLY supports `asc` and
 * `des` (verified in pre on 2026-11-16 with GET: `desc` answers 400/10521 "Values allowed:
 * [asc, desc]", even though the message itself advertises `desc`; `asc`, `des`, `DES` and `ASC` answer 200
 * or the 404/50002 of an empty list). `desc` is accepted for convenience and sent as `des`.
 */
export const DOCUMENT_LIST_ORDER_TYPES = ['asc', 'des', 'desc'] as const;

/** Value sent to the server for each accepted `orderType` (`desc` -> `des`). */
export const DOCUMENT_LIST_ORDER_TYPE_WIRE = { asc: 'asc', des: 'des', desc: 'des' } as const;

/** Allowed length of `searchText` in documentlist (400/10601). */
export const SEARCH_TEXT_LENGTH = { min: 3, max: 10 } as const;

/** Languages of the evidence report (`GET /documents/{id}/report/{lang}`). */
export const REPORT_LANGUAGES = [
  'ar',
  'br',
  'ca',
  'cs',
  'de',
  'es',
  'en',
  'eu',
  'fi',
  'fr',
  'gl',
  'hu',
  'it',
  'ko',
  'nl',
  'no',
  'pl',
  'pt',
  'ro',
] as const;
export type ReportLanguage = (typeof REPORT_LANGUAGES)[number];

// ---------------------------------------------------------------------------
// OpenAPI DTOs with short names
// ---------------------------------------------------------------------------

export type Device = S[`${P}DeviceDTO`];
export type DocGuid = S[`${P}DocGuiDTO`];
export type DocumentContent = S[`${P}DocumentContentDTO`];
export type SignedDocument = S[`${P}SignedDocumentDTO`];
export type DocumentReport = S[`${P}DocumentReportDTO`];
export type DocumentTrace = S[`${P}DocumentTraceDTO`];
type DocumentInfoSpec = S[`${P}DocumentInfo.DocumentInfoV30DTO`];

/**
 * Detailed status of a document (`GET /documentinfo/{guid}`).
 *
 * The OpenAPI spec calls the list of groups `SignerGroups` and the manual (14.x) `SignersGroups`.
 * The client accepts either spelling in the response and ALWAYS returns both
 * (same reference), so it can be read with either spelling.
 */
export type DocumentInfo = DocumentInfoSpec & {
  /** Manual spelling of `SignerGroups`. */
  SignersGroups?: DocumentInfoSpec['SignerGroups'];
};
export type DocumentListItem = S[`${P}DocumentListItemDTO`];
export type DocumentGroup = S[`${P}Signer.SignerGroupDTO`];
export type SendDocumentRequestBase = S[`${P}SendDocumentDTO`];
export type NotificationConfig = S[`${P}NotificationConfigDTO`];
export type DocAppearance = S[`${P}DocAppearanceDTO`];
export type DocumentRecipient = S[`${P}DocumentRecipientDTO`];

/** Body of `POST /documentbatch`, with the manual's fields (see {@link BatchSignerInput}). */
export type SendBatchRequest = Omit<S[`${P}SendBatchDTO`], 'SignersGroups' | 'Appearance'> & {
  SignersGroups: BatchSignerGroupInput[];
  Appearance?: DocAppearanceInput;
};
export type SendDocumentBatchRequestBase = S[`${P}SendDocumentBatchDTO`];
export type BatchGuid = S[`${P}DocBatchGuidDTO`];
type DocumentBatchInfoSpec = S[`${P}DocumentBatchInfoDTO`];

/** Document of a batch in `GET /documentbatchinfo/{guid}` (the manual uses `DocGUI`; the OpenAPI spec `Guid`). */
export type DocumentBatchInfoDoc = NonNullable<DocumentBatchInfoSpec['Docs']>[number] & {
  DocGUI?: string;
};

/**
 * Status of a batch (`GET /documentbatchinfo/{guid}`).
 *
 * The OpenAPI spec uses `Guid` and `Docs[].Guid`; the manual `BatchGUI` and `Docs[].DocGUI`. The client
 * accepts both and always returns both.
 */
export type DocumentBatchInfo = Omit<DocumentBatchInfoSpec, 'Docs'> & {
  /** Manual spelling of `Guid`. */
  BatchGUI?: string;
  Docs?: DocumentBatchInfoDoc[];
};

export type EDeliveryRequest = S[`${P}EDeliveries.EDeliveryDTO`];
/**
 * Response of `POST /edeliveries`. The OpenAPI spec calls it `GUID`; the manual (14.25) `DocGUI`.
 * The client always returns both.
 */
export type EDeliveryGuid = S[`${P}EDeliveries.EDeliveryGuidDTO`] & { DocGUI?: string };
export type EDeliverySummary = S[`${P}EDeliveries.EDeliverySummaryDTO`];
export type EDeliveryInfo = S[`${P}EDeliveries.EDeliveryInfoDTO`];
export type EDeliveryReport = S[`${P}EDeliveries.EDeliveryReportDTO`];
export type EDeliveryReminderChannel = S[`${P}EDeliveries.EDeliveryReminderChannelDTO`];

export type SignatureRemoteUrl = S[`${P}SignatureViDRemoteURLDTO`];
export type SignatureRemoteUrlChannel = S[`${P}SignatureViDRemoteURLChannelDTO`];
export type Attachment = S[`${P}AttachmentDTO`];
export type AttachmentGuid = S[`${P}AttachmentGuidDTO`];
export type BioSignatureMetadata = S[`${P}Signature.BIOSignatureMetaDataDTO`];
export type BioEvidence = S[`${P}Signature.Evidence.GetBioEvidenceDTO`];
export type VidMobileSignatureRequestCms = S[`${P}Swisscom.SigantureRequestCMSDTO`];

export type SignXmlRequest = S[`${P}Signature.SignXmlDTO`];
export type SignXmlResponse = S[`${P}Signature.SignXmlResponseDTO`];

/** Terms of `POST /search` and `POST /edeliveries/search` (`additionaldata`, `elementtype`...). */
export interface SearchTerms {
  Terms: Record<string, string | null>;
}

export type OauthResponse = S[`${P}OauthResponseDTO`];

// ---------------------------------------------------------------------------
// Fields the manual documents and the OpenAPI spec does not include
// ---------------------------------------------------------------------------
//
// The `Manual*Extras` interfaces are GENERATED from `spec/manual-extras.json` and
// `src/tools/aliases.ts` (`npm run gen:schemas`). Here they are combined with the OpenAPI DTOs.
// There is no index signature: a typo in a field name does not compile.

/** Rejection reason the signer picks from a dropdown (manual 14.5). */
export type RejectionOption = ManualRejectionOptionDTO;

type FormAttachmentResponseInput = S[`${P}Forms.FormAttachmentResponseDTO`] &
  ManualFormsFormAttachmentResponseDTOExtras;
type FormAttachmentInput = Omit<S[`${P}Forms.FormAttachmentDTO`], 'Response'> & {
  Response?: FormAttachmentResponseInput;
};
type FormGroupInput = Omit<S[`${P}Forms.FormGroupDTO`], 'Attachments'> & {
  Attachments?: FormAttachmentInput[];
};
type FormSectionInput = Omit<S[`${P}Forms.FormSectionDTO`], 'Groups'> & {
  Groups?: FormGroupInput[];
};

/** Signer form, with the manual's `Attachments[].Response.Text`. */
export type FormInput = Omit<S[`${P}Forms.FormDTO`], 'Sections'> & {
  Sections?: FormSectionInput[];
};

/** Signer `SignerData`, with the manual's `Display` (`BeforePreview` or `AfterPreview`). */
export type SignerDataInput = S[`${P}Signer.SignerDataDto`] & ManualSignerSignerDataDtoExtras;

/** Centralized certificate; the manual sometimes writes `CertificateGUI`. */
export type CentralizedCertificateInput =
  S['VIDCloudRestPubDTOs.DTOEntities.CentralizedCertificateDTO'] &
    ManualCentralizedCertificateDTOExtras;

/**
 * Signer of `POST /documents`.
 *
 * Extends `SignerV2DTO` (OpenAPI) with the REST manual fields the OpenAPI spec does not cover:
 * `SkipSignatureEmail` (does not send the signing email; the link is obtained with
 * `GET /signature/{SignerGUID}/vidremoteurl`; requires `AllowSkipEmail` on the subscription, otherwise
 * 409 / 40111), `SendSignedDoc`, `AllowEmptyPhoneNumber`, `DownloadDocument`,
 * `AllowSignatureDelegation`, `SendCentralizedSignerEmailNotification`, `RejectionOptions`,
 * `SignerData.Display` and `Form...Attachments.Response.Text`. The manual writes `eMail`; the OpenAPI spec
 * `Email`.
 */
export type SignerInput = Omit<
  S[`${P}Signer.SignerV2DTO`],
  'Form' | 'SignerData' | 'CentralizedCertificate'
> &
  ManualSignerSignerV2DTOExtras & {
    Form?: FormInput;
    SignerData?: SignerDataInput;
    CentralizedCertificate?: CentralizedCertificateInput;
  };

/** Signer of `POST /documentbatch` (without `Visible`, `Form` or `AdditionalSignatures`: those go per document). */
export type BatchSignerInput = Omit<
  S[`${P}Signer.BatchSignerDTO`],
  'SignerData' | 'CentralizedCertificate'
> &
  ManualSignerBatchSignerDTOExtras & {
    SignerData?: SignerDataInput;
    CentralizedCertificate?: CentralizedCertificateInput;
  };

export interface SignerGroupInput {
  Min?: number;
  Max?: number;
  OrderedSignatures?: boolean;
  Signers: SignerInput[];
}

export interface BatchSignerGroupInput {
  Min?: number;
  Max?: number;
  OrderedSignatures?: boolean;
  Signers: BatchSignerInput[];
}

/** Recipient of the signed or rejected document notices (`eMail` is the manual's spelling). */
export type DocumentRecipientInput = S[`${P}DocumentRecipientDTO`] &
  ManualDocumentRecipientDTOExtras;

/** Branding of the app and the emails (`APP` is the manual's spelling of `App`). */
export type DocAppearanceInput = S[`${P}DocAppearanceDTO`] &
  Omit<ManualDocAppearanceDTOExtras, 'APP'> & { APP?: S[`${P}AppAppearanceDTO`] };

/** Body of `POST /documents` (without `DocContent`, which the client fills in from a buffer). */
export type SendDocumentInput = Omit<
  SendDocumentRequestBase,
  | 'SignersGroups'
  | 'DocContent'
  | 'SignedDocumentRecipients'
  | 'RejectedDocumentRecipients'
  | 'Appearance'
> &
  ManualSendDocumentDTOExtras & {
    SignersGroups: SignerGroupInput[];
    SignedDocumentRecipients?: DocumentRecipientInput[];
    RejectedDocumentRecipients?: DocumentRecipientInput[];
    Appearance?: DocAppearanceInput;
  };

type SignatureDataInput = Omit<S['VIDCloudRestPubDTOs.DTOEntities.SignatureDataDTO'], 'Form'> & {
  Form?: FormInput;
};

/** Body of `POST /documentbatch/{id}/document` (without `DocContent`). */
export type SendBatchDocumentInput = Omit<
  SendDocumentBatchRequestBase,
  'DocContent' | 'SignaturesGroups' | 'SignedDocumentRecipients' | 'RejectedDocumentRecipients'
> &
  ManualSendDocumentBatchDTOExtras & {
    SignaturesGroups?: Array<{ Signatures?: SignatureDataInput[] }>;
    SignedDocumentRecipients?: DocumentRecipientInput[];
    RejectedDocumentRecipients?: DocumentRecipientInput[];
  };

/** Body of `POST /edeliveries` (without `DocContent`). */
export type EDeliveryInput = Omit<EDeliveryRequest, 'DocContent'>;

// ---------------------------------------------------------------------------
// Lists and pagination
// ---------------------------------------------------------------------------

/**
 * Pagination parameters of `GET /documentlist/{id}`.
 *
 * Constraints verified in pre-production (2026-11-16):
 * `pageNumber` starts at 1 (0 -> 400 / 12006) and `pageSize` must be > 0 and < 100
 * (200 -> 400 / 10510).
 */
export interface DocumentListOptions {
  pageNumber?: number;
  pageSize?: number;
  /** Text filter: between 3 and 10 characters (otherwise 400 / 10601). */
  searchText?: string;
  /** One of {@link DOCUMENT_LIST_ORDER_BY}. */
  orderBy?: string;
  /** `asc` or `desc`. */
  orderType?: string;
}

/** Result of walking all the pages of documentlist. */
export interface DocumentListAll {
  items: DocumentListItem[];
  /** Pages requested from the server. */
  pagesFetched: number;
  /** True if it stopped at `maxPages` although the server had more pages: the list is incomplete. */
  truncated: boolean;
}

/** Normalized page of documents (the server may return a flat array or a paginated object). */
export interface DocumentPage {
  items: DocumentListItem[];
  pageNumber?: number;
  pageSize?: number;
  totalPages?: number;
  hasNext?: boolean;
  /** True if the server returned a list without pagination metadata. */
  unpaginated: boolean;
}

export interface SignedDocumentRef {
  DocGUI?: string;
}

/**
 * Content of a file to upload: already base64-encoded (`string`) or bytes
 * (`Uint8Array`/`Buffer`, which the client encodes to base64).
 */
export type FileContent = string | Uint8Array;
