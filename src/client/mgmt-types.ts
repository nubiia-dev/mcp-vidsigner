/**
 * DTOs of the management API (MGMT 1.0).
 *
 * There is no OpenAPI spec for this API: the types are hand-written from the
 * "VIDsigner MGMT API 1.0" manual (changelog up to v1.22). Where the manual is
 * inconsistent (e.g. `SignatuesLimit` in the tables and `SignaturesLimit` in
 * the examples) the example is followed, since that is what the API returns.
 */

/** Optional pagination of partners and customers (`PageNumber`, `PageSize`...). */
export interface MgmtPaginationOptions {
  pageNumber?: number;
  pageSize?: number;
  /** Partners: PartnerGUID | PartnerName | PartnerLegalId. Customers: CustomerGUID | CustomerName | CustomerLegalId. */
  orderBy?: string;
  /** `asc` or `des` (the manual writes `des`, not `desc`). */
  orderType?: 'asc' | 'des';
  searchText?: string;
}

/** Normalized page (the API returns a flat array or `{List, Count, HasNext...}`). */
export interface MgmtPage<T> {
  items: T[];
  count?: number;
  hasNext?: boolean;
  hasPrevious?: boolean;
  totalPages?: number;
  pageNumber?: number;
  pageSize?: number;
}

export interface Partner {
  PartnerGUID: string;
  PartnerName: string;
  PartnerLegalId: string;
  Address?: string;
}

export interface CustomerSummary {
  CustomerGUID: string;
  CustomerName: string;
  CustomerLegalId: string;
}

export interface CustomerInput {
  CustomerName: string;
  CustomerLegalId: string;
  Address: string;
  City: string;
  State: string;
  PostalCode: string;
  /** ISO-2. */
  Country: string;
  CustomerEmail?: string;
  CustomerPhoneNumber?: string;
  Sector?: string | null;
  SubSector?: string | null;
  Software?: string | null;
  UseCase?: string | null;
  Referal?: string | null;
  Comments?: string | null;
  /** Must start with http or https; if there is none, `n/a`. */
  CustomerURL: string;
}

export interface Customer extends CustomerInput {
  CustomerGUID: string;
  PartnerGUID?: string;
}

/** Configuration of a signature channel. If disabled, the limits must be 0; if enabled: positive or -1 (unlimited). */
export interface ChannelLimits {
  Enabled: boolean;
  SignaturesLimit: number;
  /** Months: 1 monthly, 12 yearly. */
  SignaturesLimitPeriod: number;
}

export interface SignatureChannels {
  BIO: ChannelLimits & { DevicesLimit: number };
  Remote: ChannelLimits;
  ViDMobile: ChannelLimits & { Domain: string; UsersLimit: number };
  Stamper: ChannelLimits & { CertificatesLimit: number };
}

export interface SubscriptionInput {
  /** Minimum 8 characters, maximum 255. */
  SubscriptionName: string;
  NotificationURL?: string | null;
  Software?: string | null;
  SignatureChannels: SignatureChannels;
}

export interface SubscriptionUpdateInput extends SubscriptionInput {
  /** Exactly 20 characters. */
  SubscriptionPass: string;
  Active: boolean;
}

export interface Subscription extends SubscriptionInput {
  SubscriptionGUID: string;
  /** The API returns the subscription password: treat it as a secret. */
  SubscriptionPass?: string;
  Active: boolean;
}

export type SubscriptionStatus = 'active' | 'inactive';

export interface EnrollmentCode {
  EnrollmentCode: string;
  AvailableDevices: number;
  EnrolledDevices: number;
}

export interface EnrollmentCodeCreated {
  EnrollmentCode: string;
  GUID: string;
}

export interface SubscriptionVidMobileUser {
  ViDMobileUserGUID: string;
  ViDMobileUserName: string;
  ViDMobileUserLegalId: string;
  ViDMobileUserEmail: string;
}

export interface SubscriptionVidStamperUser {
  ViDStamperUserGUID: string;
  ViDStamperUserName: string;
  ViDStamperUserLegalId: string;
}

export interface StatsSearchInput {
  /** Format `yyyy/MM/dd` (changelog v1.18). */
  From: string;
  To: string;
  Type?: 'vidmobileuser' | 'vidstamperuser' | 'device';
  Id?: string;
}

export interface StatsResult {
  Id: string;
  Type: string;
  SignaturesDone: number;
}

export interface VidMobileUserInput {
  userid: string;
  username: string;
  legalid: string;
  email: string;
  password: string;
  /** Signature image in base64 (max. 100 KB). */
  signatureimage: string;
  /** True to skip the enrollment email. */
  skipEnrollEmail: boolean;
  /** E.164 format. */
  PhoneNumber?: string;
  /** ca, de, en, es. */
  Language?: 'ca' | 'de' | 'en' | 'es';
}

export interface VidMobileUserCreated {
  VIDmobileUserGUID: string;
}

export interface VidMobileUser {
  userid: string;
  username: string;
  legalid: string;
  email: string;
  active: boolean;
  /** The API returns `n/a`. */
  password?: string;
  vidmobileusertype: number;
  /** Only in `GET /vidmobileusers/{legalid}`. It is a secret: not exposed in tools. */
  token?: string;
}

export interface VidMobileUserPersonalData {
  fullname: string;
  legalidNumber: string;
  /** Identity document image, side A, in base64. */
  DocIdImageSideA?: string;
  DocIdImageSideB?: string;
  token?: string;
}

export type CertType = 'Software' | 'KeyVault' | 'FirmaRemota';

export interface VidMobileUserCertificate {
  certalias: string;
  GUID: string;
  CertType: CertType | string;
  DN: string;
  /** Format `dd/MM/yyyy HH:mm:ss` per the manual (the example uses `yyyy/MM/dd`). */
  ExpirationDate: string;
  AuthenticationType: string;
}

export interface VidMobileUserCertificateInput {
  /** PKCS#12 certificate in base64. */
  p12: string;
  certalias: string;
  pin: string;
  /** KeyVault only: send an OTP to the phone. */
  dynamicpin?: boolean;
  /** Defaults to `Software`. */
  certtype?: 'Software' | 'KeyVault';
}

export interface CertTypesInput {
  Software: boolean;
  KeyVault: boolean;
  FirmaRemota: boolean;
}

export interface TSystemsDocType {
  GUID: string;
  DocumentType: string;
  Code: string;
}

export interface TSystemsDocTypeInput {
  DocumentType: string;
  Code: string;
}

export interface TSystemsBookCode {
  GUID: string;
  Code: string;
  Description: string;
}

export interface TSystemsBookCodeInput {
  Code: string;
  Description: string;
}

export interface StampCertificateInfo {
  CertificateGUID: string;
  Description: string;
  /** Format `MM/DD/YYYY`. */
  ExpirationDate: string;
}

export interface StampCertificateInput {
  /** Certificate .p12/.pfx in base64. */
  CertificateBase64: string;
  Pin: string;
  Description: string;
  /** Signature image to stamp on the document, base64. */
  Image: string;
}
