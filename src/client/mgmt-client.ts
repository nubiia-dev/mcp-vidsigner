import { TokenProvider, basicHeader } from './auth.js';
import { VidSignerError } from './errors.js';
import {
  HttpTransport,
  seg,
  type AuthStrategy,
  type EmptyListRule,
  type RequestSpec,
  type RetryPolicy,
} from './http.js';
import { Redactor, silentLogger, type Logger } from './logger.js';
import type { VidSignerEnvironment } from './vidsigner-client.js';
import type {
  CertTypesInput,
  Customer,
  CustomerInput,
  CustomerSummary,
  EnrollmentCode,
  EnrollmentCodeCreated,
  MgmtPage,
  MgmtPaginationOptions,
  Partner,
  StampCertificateInfo,
  StampCertificateInput,
  StatsResult,
  StatsSearchInput,
  Subscription,
  SubscriptionInput,
  SubscriptionStatus,
  SubscriptionUpdateInput,
  SubscriptionVidMobileUser,
  SubscriptionVidStamperUser,
  TSystemsBookCode,
  TSystemsBookCodeInput,
  TSystemsDocType,
  TSystemsDocTypeInput,
  VidMobileUser,
  VidMobileUserCertificate,
  VidMobileUserCertificateInput,
  VidMobileUserCreated,
  VidMobileUserInput,
  VidMobileUserPersonalData,
} from './mgmt-types.js';

/** Root URLs of the management API (MGMT manual, section 1). They include `/api`. */
export const VIDSIGNER_MGMT_BASE_URLS = {
  pre: 'https://pre-vidsignercloudmgmt.validatedid.com/api',
  pro: 'https://vidsignercloudmgmt.validatedid.com/api',
} as const;

/**
 * Credential used to authenticate each management operation (MGMT manual, section 6):
 *
 * - `partner`: JWT with `scope=partner` (partner user/password + ClientID/Secret).
 * - `subscription`: JWT with `scope=subscription`.
 * - `partner-or-subscription`: either of the two (e.g. statistics).
 * - `subscription-basic`: Basic `SubscriptionName:SubscriptionPass` ("SubscriptionCredentials");
 *   it does not need a ClientID. This is the case for `/vidmobileusers`.
 */
export type MgmtAuthKind =
  'partner' | 'subscription' | 'partner-or-subscription' | 'subscription-basic';

export interface VidSignerMgmtClientOptions {
  environment?: VidSignerEnvironment;
  /** Root URL override (includes `/api`). */
  baseUrl?: string;
  /** Management OAuth client (may be the same as the signing one; unconfirmed). */
  clientId?: string;
  clientSecret?: string;
  /** Partner credentials (`partner` scope). */
  partnerUser?: string;
  partnerPass?: string;
  /** Subscription credentials: Basic for `/vidmobileusers` and the JWT `subscription` scope. */
  subscriptionName?: string;
  subscriptionPass?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  tokenSkewSeconds?: number;
  logger?: Logger;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

interface MgmtOp {
  name: string;
  method: RequestSpec['method'];
  auth: MgmtAuthKind;
  retry: RetryPolicy;
  /** Empty management listings answer 404 without a body. */
  /** 404 without a body (or "list is empty") = empty list; a 404 with "not found/not exist" is an error. */
  emptyList?: EmptyListRule;
}

const R = { retry: 'safe' } as const;
const NO_RETRY = { retry: 'never' } as const;

/**
 * Client of the VIDsigner management API (MGMT 1.0): partners, customers,
 * subscriptions, enrollment codes, devices, VIDmobile users, certificates,
 * statistics and T-Systems configuration.
 *
 * It needs partner credentials (which you may not have) except for the
 * `/vidmobileusers` operations, which use the subscription credentials. Independent of the MCP.
 */
export class VidSignerMgmtClient {
  readonly baseUrl: string;
  private readonly transport: HttpTransport;
  private readonly strategies: Partial<Record<'partner' | 'subscription' | 'basic', AuthStrategy>> =
    {};

  constructor(opts: VidSignerMgmtClientOptions = {}) {
    const env = opts.environment ?? 'pre';
    this.baseUrl = (opts.baseUrl ?? VIDSIGNER_MGMT_BASE_URLS[env]).replace(/\/+$/, '');

    const redactor = new Redactor();
    redactor.addBasicPair(opts.clientId, opts.clientSecret);
    redactor.addSecret(opts.clientSecret);
    redactor.addBasicPair(opts.partnerUser, opts.partnerPass);
    redactor.addBasicPair(opts.subscriptionName, opts.subscriptionPass);

    this.transport = new HttpTransport({
      timeoutMs: opts.timeoutMs,
      maxRetries: opts.maxRetries,
      retryBaseDelayMs: opts.retryBaseDelayMs,
      fetch: opts.fetch,
      logger: opts.logger ?? silentLogger,
      redactor,
      sleep: opts.sleep,
      random: opts.random,
    });

    if (opts.subscriptionName && opts.subscriptionPass) {
      const [n, p] = [opts.subscriptionName, opts.subscriptionPass];
      this.strategies.basic = { getAuthorization: async () => basicHeader(n, p) };
    }

    if (opts.clientId && opts.clientSecret) {
      const [clientId, clientSecret] = [opts.clientId, opts.clientSecret];
      const make = (
        scope: 'partner' | 'subscription',
        user: string,
        pass: string,
      ): AuthStrategy => {
        const provider = new TokenProvider({
          label: `mgmt-${scope}`,
          tokenUrl: `${this.baseUrl}/oauth/token`,
          clientId,
          clientSecret,
          grant: { username: user, password: pass, scope },
          request: (req) => this.transport.requestToken(req, 'oauth.token'),
          now: opts.now,
          skewSeconds: opts.tokenSkewSeconds,
        });
        return {
          getAuthorization: async () => `Bearer ${await provider.getToken()}`,
          invalidate: () => provider.invalidate(),
        };
      };
      if (opts.partnerUser && opts.partnerPass) {
        this.strategies.partner = make('partner', opts.partnerUser, opts.partnerPass);
      }
      if (opts.subscriptionName && opts.subscriptionPass) {
        this.strategies.subscription = make(
          'subscription',
          opts.subscriptionName,
          opts.subscriptionPass,
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // Partners
  // -------------------------------------------------------------------------

  /** `GET /partners`. Only for "admin" partners. */
  async listPartners(opts: MgmtPaginationOptions = {}): Promise<MgmtPage<Partner>> {
    const raw = await this.call(
      {
        name: 'partners.list',
        method: 'GET',
        auth: 'partner',
        ...R,
        emptyList: 'codes-or-empty-body',
      },
      '/partners',
      { query: paginationQuery(opts) },
    );
    return normalizePage<Partner>(raw);
  }

  /** `GET /partners/{partnerGuid}`. */
  async getPartner(partnerGuid: string): Promise<Partner> {
    return this.call(
      { name: 'partners.get', method: 'GET', auth: 'partner', ...R },
      `/partners/${seg(partnerGuid)}`,
    );
  }

  // -------------------------------------------------------------------------
  // Customers
  // -------------------------------------------------------------------------

  /** `GET /partners/{partnerGuid}/customers`. */
  async listCustomers(
    partnerGuid: string,
    opts: MgmtPaginationOptions = {},
  ): Promise<MgmtPage<CustomerSummary>> {
    const raw = await this.call(
      {
        name: 'customers.list',
        method: 'GET',
        auth: 'partner',
        ...R,
        emptyList: 'codes-or-empty-body',
      },
      `/partners/${seg(partnerGuid)}/customers`,
      { query: paginationQuery(opts) },
    );
    return normalizePage<CustomerSummary>(raw);
  }

  /** `POST /partners/{partnerGuid}/customers`. Returns the `CustomerGUID`. */
  async createCustomer(
    partnerGuid: string,
    customer: CustomerInput,
  ): Promise<{ CustomerGUID: string; CustomerName: string; CustomerLegalId: string }> {
    return this.call(
      { name: 'customers.create', method: 'POST', auth: 'partner', ...NO_RETRY },
      `/partners/${seg(partnerGuid)}/customers`,
      { body: customer },
    );
  }

  /** `GET /customers/{customerGuid}`. */
  async getCustomer(customerGuid: string): Promise<Customer> {
    return this.call(
      { name: 'customers.get', method: 'GET', auth: 'partner', ...R },
      `/customers/${seg(customerGuid)}`,
    );
  }

  /** `PUT /customers/{customerGuid}`. Cannot be modified once the contract has been sent or signed. */
  async updateCustomer(customerGuid: string, customer: CustomerInput): Promise<void> {
    await this.call(
      { name: 'customers.update', method: 'PUT', auth: 'partner', ...R },
      `/customers/${seg(customerGuid)}`,
      { body: customer },
    );
  }

  /** `DELETE /customers/{customerGuid}`. */
  async deleteCustomer(customerGuid: string): Promise<void> {
    await this.call(
      { name: 'customers.delete', method: 'DELETE', auth: 'partner', ...R },
      `/customers/${seg(customerGuid)}`,
    );
  }

  // -------------------------------------------------------------------------
  // Subscriptions
  // -------------------------------------------------------------------------

  /** `GET /customers/{customerGuid}/subscriptions`. */
  async listCustomerSubscriptions(customerGuid: string): Promise<Subscription[]> {
    return this.call(
      {
        name: 'subscriptions.list',
        method: 'GET',
        auth: 'partner',
        ...R,
        emptyList: 'codes-or-empty-body',
      },
      `/customers/${seg(customerGuid)}/subscriptions`,
    );
  }

  /**
   * `POST /customers/{customerGuid}/subscriptions`. The subscription is created inactive.
   * The manual's response is a one-element array; it is normalized to the object.
   */
  async createSubscription(customerGuid: string, input: SubscriptionInput): Promise<Subscription> {
    const raw = await this.call<Subscription | Subscription[]>(
      { name: 'subscriptions.create', method: 'POST', auth: 'partner', ...NO_RETRY },
      `/customers/${seg(customerGuid)}/subscriptions`,
      { body: input },
    );
    return Array.isArray(raw) ? (raw[0] as Subscription) : raw;
  }

  /**
   * `GET /subscriptions/{id}`. The manual states `partner` scope, but the 401 error
   * talks about the GUID of the subscription token: both are accepted.
   */
  async getSubscription(subscriptionId: string): Promise<Subscription> {
    return this.call(
      { name: 'subscriptions.get', method: 'GET', auth: 'partner-or-subscription', ...R },
      `/subscriptions/${seg(subscriptionId)}`,
    );
  }

  /** `PUT /subscription/{subscriptionGuid}`. */
  async updateSubscription(
    subscriptionGuid: string,
    input: SubscriptionUpdateInput,
  ): Promise<Subscription> {
    return this.call(
      { name: 'subscriptions.update', method: 'PUT', auth: 'partner', ...R },
      `/subscription/${seg(subscriptionGuid)}`,
      { body: input },
    );
  }

  /**
   * `PUT /subscription/{guid}/status/{active|inactive}` (`subscription` scope).
   * The manual writes `status` in the syntax and `state` in the example; `status` is used.
   */
  async setSubscriptionStatus(subscriptionGuid: string, status: SubscriptionStatus): Promise<void> {
    await this.call(
      { name: 'subscriptions.status', method: 'PUT', auth: 'subscription', ...R },
      `/subscription/${seg(subscriptionGuid)}/status/${seg(status)}`,
    );
  }

  /** `DELETE /subscription/{subscriptionGuid}`. */
  async deleteSubscription(subscriptionGuid: string): Promise<void> {
    await this.call(
      { name: 'subscriptions.delete', method: 'DELETE', auth: 'partner', ...R },
      `/subscription/${seg(subscriptionGuid)}`,
    );
  }

  // -------------------------------------------------------------------------
  // Enrollment codes
  // -------------------------------------------------------------------------

  /** `GET /subscription/{guid}/enrollmentcode`. */
  async listEnrollmentCodes(subscriptionGuid: string): Promise<EnrollmentCode[]> {
    return this.call(
      {
        name: 'enrollmentcodes.list',
        method: 'GET',
        auth: 'partner',
        ...R,
        emptyList: 'codes-or-empty-body',
      },
      `/subscription/${seg(subscriptionGuid)}/enrollmentcode`,
    );
  }

  /** `POST /subscription/{guid}/enrollmentcode`. */
  async createEnrollmentCode(
    subscriptionGuid: string,
    numberOfDevices: number,
  ): Promise<EnrollmentCodeCreated> {
    return this.call(
      { name: 'enrollmentcodes.create', method: 'POST', auth: 'partner', ...NO_RETRY },
      `/subscription/${seg(subscriptionGuid)}/enrollmentcode`,
      { body: { NumberOfDevices: numberOfDevices } },
    );
  }

  /** `PUT /enrollmentcodes/{guid}`. */
  async updateEnrollmentCode(guid: string, numberOfDevices: number): Promise<void> {
    await this.call(
      { name: 'enrollmentcodes.update', method: 'PUT', auth: 'partner', ...R },
      `/enrollmentcodes/${seg(guid)}`,
      { body: { NumberOfDevices: numberOfDevices } },
    );
  }

  /** `DELETE /enrollmentcodes/{guid}`. */
  async deleteEnrollmentCode(guid: string): Promise<void> {
    await this.call(
      { name: 'enrollmentcodes.delete', method: 'DELETE', auth: 'partner', ...R },
      `/enrollmentcodes/${seg(guid)}`,
    );
  }

  // -------------------------------------------------------------------------
  // Subscription users, statistics and devices
  // -------------------------------------------------------------------------

  /** `GET /subscription/{guid}/vidmobileusers`. */
  async listSubscriptionVidMobileUsers(
    subscriptionGuid: string,
  ): Promise<SubscriptionVidMobileUser[]> {
    return this.call(
      {
        name: 'subscription.vidmobileusers.list',
        method: 'GET',
        auth: 'partner',
        ...R,
        emptyList: 'codes-or-empty-body',
      },
      `/subscription/${seg(subscriptionGuid)}/vidmobileusers`,
    );
  }

  /** `GET /subscription/{guid}/vidstamperusers`. */
  async listSubscriptionVidStamperUsers(
    subscriptionGuid: string,
  ): Promise<SubscriptionVidStamperUser[]> {
    return this.call(
      {
        name: 'subscription.vidstamperusers.list',
        method: 'GET',
        auth: 'partner',
        ...R,
        emptyList: 'codes-or-empty-body',
      },
      `/subscription/${seg(subscriptionGuid)}/vidstamperusers`,
    );
  }

  /** `POST /subscription/{guid}/stats/search`. Signatures made per user or device (read-only). */
  async searchStatistics(
    subscriptionGuid: string,
    search: StatsSearchInput,
  ): Promise<StatsResult[]> {
    return this.call(
      {
        name: 'statistics.search',
        method: 'POST',
        auth: 'partner-or-subscription',
        ...R,
        emptyList: 'codes-or-empty-body',
      },
      `/subscription/${seg(subscriptionGuid)}/stats/search`,
      { body: search },
    );
  }

  /** `PUT /devices/{deviceName}`. Only changes the description. */
  async updateDevice(deviceName: string, deviceDescription: string): Promise<void> {
    await this.call(
      { name: 'devices.update', method: 'PUT', auth: 'partner', ...R },
      `/devices/${seg(deviceName)}`,
      { body: { DeviceDescription: deviceDescription } },
    );
  }

  /** `DELETE /devices/{deviceName}`. Only if it has no assigned documents (otherwise 409). */
  async deleteDevice(deviceName: string): Promise<void> {
    await this.call(
      { name: 'devices.delete', method: 'DELETE', auth: 'partner', ...R },
      `/devices/${seg(deviceName)}`,
    );
  }

  // -------------------------------------------------------------------------
  // VIDmobile users (subscription credentials)
  // -------------------------------------------------------------------------

  /** `POST /vidmobileusers`. Returns `VIDmobileUserGUID`. May send an enrollment email. */
  async createVidMobileUser(user: VidMobileUserInput): Promise<VidMobileUserCreated> {
    return this.call(
      { name: 'vidmobileusers.create', method: 'POST', auth: 'subscription-basic', ...NO_RETRY },
      '/vidmobileusers',
      { body: user },
    );
  }

  /** `DELETE /vidmobileusers/{legalid}`. Not deleted if it has certificates or pending signatures (409). */
  async deleteVidMobileUser(legalId: string): Promise<void> {
    await this.call(
      { name: 'vidmobileusers.delete', method: 'DELETE', auth: 'subscription-basic', ...R },
      `/vidmobileusers/${seg(legalId)}`,
    );
  }

  /** `GET /vidmobileusers`. */
  async listVidMobileUsers(): Promise<VidMobileUser[]> {
    return this.call(
      {
        name: 'vidmobileusers.list',
        method: 'GET',
        auth: 'subscription-basic',
        ...R,
        emptyList: 'codes-or-empty-body',
      },
      '/vidmobileusers',
    );
  }

  /** `GET /vidmobileusers/{legalid}`. */
  async getVidMobileUser(legalId: string): Promise<VidMobileUser> {
    return this.call(
      { name: 'vidmobileusers.get', method: 'GET', auth: 'subscription-basic', ...R },
      `/vidmobileusers/${seg(legalId)}`,
    );
  }

  /**
   * `GET /vidmobileusers/{legalid}/token`. Listed in the manual's operations table but has no
   * section of its own (response format undocumented). It returns a secret: the MCP does not expose it.
   */
  async getVidMobileUserToken(legalId: string): Promise<unknown> {
    return this.call(
      { name: 'vidmobileusers.token', method: 'GET', auth: 'subscription-basic', ...R },
      `/vidmobileusers/${seg(legalId)}/token`,
    );
  }

  /** `GET /vidmobileusers/{legalid}/personaldata`. Includes identity document images (base64). */
  async getVidMobileUserPersonalData(legalId: string): Promise<VidMobileUserPersonalData> {
    return this.call(
      { name: 'vidmobileusers.personaldata', method: 'GET', auth: 'subscription-basic', ...R },
      `/vidmobileusers/${seg(legalId)}/personaldata`,
    );
  }

  /** `PUT /vidmobileusers/{id}/username`. */
  async updateVidMobileUserName(legalId: string, userName: string): Promise<void> {
    await this.call(
      { name: 'vidmobileusers.username', method: 'PUT', auth: 'subscription-basic', ...R },
      `/vidmobileusers/${seg(legalId)}/username/`,
      { body: { UserName: userName } },
    );
  }

  /** `PUT /vidmobileusers/{id}/signatureimage`. Base64 image, max. 100 KB. */
  async updateVidMobileUserSignatureImage(legalId: string, imageBase64: string): Promise<void> {
    await this.call(
      { name: 'vidmobileusers.signatureimage', method: 'PUT', auth: 'subscription-basic', ...R },
      `/vidmobileusers/${seg(legalId)}/signatureimage/`,
      { body: { SignatureImage: imageBase64 } },
    );
  }

  /** `PUT /vidmobileusers/{id}/password`. 4 to 100 characters. */
  async updateVidMobileUserPassword(legalId: string, password: string): Promise<void> {
    await this.call(
      { name: 'vidmobileusers.password', method: 'PUT', auth: 'subscription-basic', ...R },
      `/vidmobileusers/${seg(legalId)}/password/`,
      { body: { Password: password } },
    );
  }

  /** `PUT /vidmobileusers/{id}/email`. */
  async updateVidMobileUserEmail(legalId: string, email: string): Promise<void> {
    await this.call(
      { name: 'vidmobileusers.email', method: 'PUT', auth: 'subscription-basic', ...R },
      `/vidmobileusers/${seg(legalId)}/email/`,
      { body: { Email: email } },
    );
  }

  /** `PUT /vidmobileusers/{legalid}/remindpasswordrequest`. Emails the account details. */
  async requestVidMobileUserPasswordReminder(legalId: string): Promise<void> {
    await this.call(
      {
        name: 'vidmobileusers.remindpassword',
        method: 'PUT',
        auth: 'subscription-basic',
        ...NO_RETRY,
      },
      `/vidmobileusers/${seg(legalId)}/remindpasswordrequest/`,
    );
  }

  /**
   * `PUT /vidmobileusers/{legalid}/state/{state}`. It is in the operations table (v1.4+) without a
   * section of its own: the valid values of `state` are undocumented.
   */
  async setVidMobileUserState(legalId: string, state: string): Promise<void> {
    await this.call(
      { name: 'vidmobileusers.state', method: 'PUT', auth: 'subscription-basic', ...R },
      `/vidmobileusers/${seg(legalId)}/state/${seg(state)}`,
    );
  }

  /** `PUT /vidmobileusers/{legalid}/certstype`. Certificate types the user may use. */
  async setVidMobileUserCertTypes(legalId: string, types: CertTypesInput): Promise<void> {
    await this.call(
      { name: 'vidmobileusers.certstype', method: 'PUT', auth: 'subscription-basic', ...R },
      `/vidmobileusers/${seg(legalId)}/certstype/`,
      { body: types },
    );
  }

  // -------------------------------------------------------------------------
  // VIDmobile user and stamping certificates
  // -------------------------------------------------------------------------

  /** `POST /vidmobileusers/{legalid}/certs`. Uploads a .p12. */
  async addVidMobileUserCertificate(
    legalId: string,
    cert: VidMobileUserCertificateInput,
  ): Promise<unknown> {
    return this.call(
      { name: 'vidmobileusers.certs.add', method: 'POST', auth: 'subscription-basic', ...NO_RETRY },
      `/vidmobileusers/${seg(legalId)}/certs`,
      { body: cert },
    );
  }

  /** `GET /vidmobileusers/{legalid}/certs`. */
  async listVidMobileUserCertificates(legalId: string): Promise<VidMobileUserCertificate[]> {
    return this.call(
      {
        name: 'vidmobileusers.certs.list',
        method: 'GET',
        auth: 'subscription-basic',
        ...R,
        emptyList: 'codes-or-empty-body',
      },
      `/vidmobileusers/${seg(legalId)}/certs`,
    );
  }

  /** `DELETE /vidmobileusers/{legalid}/certs/{certid}`. */
  async deleteVidMobileUserCertificate(legalId: string, certId: string): Promise<void> {
    await this.call(
      { name: 'vidmobileusers.certs.delete', method: 'DELETE', auth: 'subscription-basic', ...R },
      `/vidmobileusers/${seg(legalId)}/certs/${seg(certId)}`,
    );
  }

  /** `GET /subscription/{guid}/stampcertificates` (`subscription` scope). */
  async listStampCertificates(subscriptionGuid: string): Promise<StampCertificateInfo[]> {
    return this.call(
      {
        name: 'stampcertificates.list',
        method: 'GET',
        auth: 'subscription',
        ...R,
        emptyList: 'codes-or-empty-body',
      },
      `/subscription/${seg(subscriptionGuid)}/stampcertificates`,
    );
  }

  /** `POST /subscription/{guid}/stampcertificates` (`subscription` scope). Uploads a .p12/.pfx and the stamp image. */
  async addStampCertificate(
    subscriptionGuid: string,
    cert: StampCertificateInput,
  ): Promise<unknown> {
    return this.call(
      { name: 'stampcertificates.add', method: 'POST', auth: 'subscription', ...NO_RETRY },
      `/subscription/${seg(subscriptionGuid)}/stampcertificates`,
      { body: cert },
    );
  }

  // -------------------------------------------------------------------------
  // T-Systems (only subscriptions configured for Registra)
  // -------------------------------------------------------------------------

  /** `GET /subscription/{guid}/tsystemsdoctypes`. */
  async listTSystemsDocTypes(subscriptionGuid: string): Promise<TSystemsDocType[]> {
    return this.call(
      {
        name: 'tsystems.doctypes.list',
        method: 'GET',
        auth: 'subscription',
        ...R,
        emptyList: 'codes-or-empty-body',
      },
      `/subscription/${seg(subscriptionGuid)}/tsystemsdoctypes`,
    );
  }

  /** `POST /subscription/{guid}/tsystemsdoctypes`. */
  async createTSystemsDocType(
    subscriptionGuid: string,
    input: TSystemsDocTypeInput,
  ): Promise<TSystemsDocType> {
    return this.call(
      { name: 'tsystems.doctypes.create', method: 'POST', auth: 'subscription', ...NO_RETRY },
      `/subscription/${seg(subscriptionGuid)}/tsystemsdoctypes`,
      { body: input },
    );
  }

  /** `DELETE /tsystemsdocumenttype/{guid}` (the manual shows POST in the syntax and DELETE in the example). */
  async deleteTSystemsDocType(guid: string): Promise<void> {
    await this.call(
      { name: 'tsystems.doctypes.delete', method: 'DELETE', auth: 'subscription', ...R },
      `/tsystemsdocumenttype/${seg(guid)}`,
    );
  }

  /** `GET /subscription/{guid}/tsystemsbookcodes`. */
  async listTSystemsBookCodes(subscriptionGuid: string): Promise<TSystemsBookCode[]> {
    return this.call(
      {
        name: 'tsystems.bookcodes.list',
        method: 'GET',
        auth: 'subscription',
        ...R,
        emptyList: 'codes-or-empty-body',
      },
      `/subscription/${seg(subscriptionGuid)}/tsystemsbookcodes`,
    );
  }

  /** `POST /subscription/{guid}/tsystemsbookcode` (singular, per the manual). */
  async createTSystemsBookCode(
    subscriptionGuid: string,
    input: TSystemsBookCodeInput,
  ): Promise<TSystemsBookCode> {
    return this.call(
      { name: 'tsystems.bookcodes.create', method: 'POST', auth: 'subscription', ...NO_RETRY },
      `/subscription/${seg(subscriptionGuid)}/tsystemsbookcode`,
      { body: input },
    );
  }

  /** `DELETE /tsystemsbookcodes/{guid}`. */
  async deleteTSystemsBookCode(guid: string): Promise<void> {
    await this.call(
      { name: 'tsystems.bookcodes.delete', method: 'DELETE', auth: 'subscription', ...R },
      `/tsystemsbookcodes/${seg(guid)}`,
    );
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private authFor(op: MgmtOp): AuthStrategy {
    const s = this.strategies;
    let found: AuthStrategy | undefined;
    switch (op.auth) {
      case 'partner':
        found = s.partner;
        break;
      case 'subscription':
        found = s.subscription;
        break;
      case 'partner-or-subscription':
        found = s.partner ?? s.subscription;
        break;
      case 'subscription-basic':
        found = s.basic;
        break;
    }
    if (found) return found;
    throw new VidSignerError({
      kind: 'auth',
      operation: op.name,
      message: `The management operation ${op.name} needs "${op.auth}" credentials and they are not configured ${missingHint(op.auth)}.`,
    });
  }

  private async call<T = unknown>(
    op: MgmtOp,
    path: string,
    extra: { query?: RequestSpec['query']; body?: unknown } = {},
  ): Promise<T> {
    const auth = this.authFor(op);
    return this.transport.request<T>({
      operation: `mgmt.${op.name}`,
      method: op.method,
      url: `${this.baseUrl}${path}`,
      query: extra.query,
      body: extra.body,
      auth,
      retry: op.retry,
      emptyListOn404: op.emptyList,
    });
  }
}

function missingHint(kind: MgmtAuthKind): string {
  switch (kind) {
    case 'partner':
      return '(VIDSIGNER_MGMT_CLIENT_ID/SECRET and VIDSIGNER_MGMT_PARTNER_USER/PASS)';
    case 'subscription':
      return '(VIDSIGNER_MGMT_CLIENT_ID/SECRET and VIDSIGNER_SUBSCRIPTION_NAME/PASS)';
    case 'partner-or-subscription':
      return '(partner or subscription credentials with an OAuth client)';
    case 'subscription-basic':
      return '(VIDSIGNER_SUBSCRIPTION_NAME/PASS)';
  }
}

function paginationQuery(opts: MgmtPaginationOptions): Record<string, string | number | undefined> {
  if (
    opts.pageSize !== undefined &&
    (!Number.isInteger(opts.pageSize) || opts.pageSize < 1 || opts.pageSize > 99)
  ) {
    // The signing API rejects pageSize >= 100 (400/10510); absent evidence to the contrary the same is assumed.
    throw new VidSignerError({
      kind: 'validation',
      message: 'pageSize must be an integer between 1 and 99.',
    });
  }
  if (
    opts.pageNumber !== undefined &&
    (!Number.isInteger(opts.pageNumber) || opts.pageNumber < 1)
  ) {
    throw new VidSignerError({
      kind: 'validation',
      message: 'pageNumber must be an integer >= 1.',
    });
  }
  return {
    PageNumber: opts.pageNumber,
    PageSize: opts.pageSize,
    OrderBy: opts.orderBy,
    OrderType: opts.orderType,
    SearchText: opts.searchText,
  };
}

/** Unifies a flat array and `{List, Count, HasNext...}` into an {@link MgmtPage}. */
export function normalizePage<T>(raw: unknown): MgmtPage<T> {
  if (Array.isArray(raw)) return { items: raw as T[] };
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o['List'])) {
      const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
      const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);
      return {
        items: o['List'] as T[],
        count: num(o['Count']),
        hasNext: bool(o['HasNext']),
        hasPrevious: bool(o['HasPrevious']),
        totalPages: num(o['TotalPages']),
        pageNumber: num(o['PageNumber']),
        pageSize: num(o['PageSize']),
      };
    }
  }
  return { items: [] };
}
