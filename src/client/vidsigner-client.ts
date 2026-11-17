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
import {
  DOCUMENT_LIST_FILTERS,
  DOCUMENT_LIST_ORDER_BY,
  DOCUMENT_LIST_ORDER_TYPES,
  DOCUMENT_LIST_ORDER_TYPE_WIRE,
  SEARCH_TEXT_LENGTH,
  type DocumentListAll,
  type Attachment,
  type AttachmentGuid,
  type BatchGuid,
  type BioEvidence,
  type BioSignatureMetadata,
  type DocGuid,
  type Device,
  type DocumentBatchInfo,
  type DocumentContent,
  type DocumentInfo,
  type DocumentListFilter,
  type DocumentListItem,
  type DocumentListOptions,
  type DocumentPage,
  type DocumentReport,
  type DocumentTrace,
  type EDeliveryGuid,
  type EDeliveryInfo,
  type EDeliveryInput,
  type EDeliveryReminderChannel,
  type EDeliveryReport,
  type EDeliverySummary,
  type FileContent,
  type ReportLanguage,
  type SearchTerms,
  type SendBatchDocumentInput,
  type SendBatchRequest,
  type SendDocumentInput,
  type SignXmlRequest,
  type SignXmlResponse,
  type SignatureRemoteUrl,
  type SignatureRemoteUrlChannel,
  type SignedDocument,
  type SignedDocumentRef,
  type VidMobileSignatureRequestCms,
} from './types.js';

/** Base URLs documented in the manual (section 1). They include `/api/v3.0`. */
export const VIDSIGNER_BASE_URLS = {
  pre: 'https://pre-vidsignercloud.validatedid.com/api/v3.0',
  pro: 'https://vidsignercloud.validatedid.com/api/v3.0',
} as const;

export type VidSignerEnvironment = keyof typeof VIDSIGNER_BASE_URLS;

/** Maximum number of pages `listAllDocuments` walks (guard against loops). */
const MAX_PAGES_DEFAULT = 200;
/** Default page size when pagination is requested without specifying one. */
const DEFAULT_PAGE_SIZE = 50;

export type AuthMode = 'auto' | 'jwt' | 'basic';

export interface VidSignerClientOptions {
  /** `pre` (default) or `pro`. Only selects the base URL. */
  environment?: VidSignerEnvironment;
  /** Base URL override (includes `/api/v3.0`). */
  baseUrl?: string;
  /** OAuth client issued by Validated ID. Without it only reads work (Basic). */
  clientId?: string;
  clientSecret?: string;
  /** `SubscriptionName` / `SubscriptionPass`. */
  subscriptionName: string;
  subscriptionPass: string;
  /**
   * - `auto` (default): JWT if there is a ClientID/Secret; otherwise Basic for reads only.
   * - `jwt`: requires ClientID/Secret.
   * - `basic`: never JWT (writes fail before being sent).
   */
  authMode?: AuthMode;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  /** Margin in seconds before expiry at which the JWT is renewed (default 60). */
  tokenSkewSeconds?: number;
  logger?: Logger;
  /** For tests: injectable `fetch`, clock and sleep. */
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

/** Metadata of an operation. */
interface Op {
  /** Logical name (logged instead of the route). */
  name: string;
  method: RequestSpec['method'];
  /** True if the API requires a JWT (writes). */
  jwt: boolean;
  retry: RetryPolicy;
  /** When a 404 means "empty list" (see `EmptyListRule`). Without a value, every 404 is an error. */
  emptyList?: EmptyListRule;
}

const READ: Pick<Op, 'jwt' | 'retry'> = { jwt: false, retry: 'safe' };
/** Idempotent write (PUT/DELETE): requires a JWT and can be retried. */
const WRITE_SAFE: Pick<Op, 'jwt' | 'retry'> = { jwt: true, retry: 'safe' };
/** Creation (POST): requires a JWT and is NOT retried (risk of duplicating documents and notices). */
const CREATE: Pick<Op, 'jwt' | 'retry'> = { jwt: true, retry: 'never' };

/** PUT that triggers an external notice (email/SMS): requires a JWT and is not retried so the notice is not duplicated. */
const WRITE_SAFE_NO_RETRY: Pick<Op, 'jwt' | 'retry'> = { jwt: true, retry: 'never' };

/**
 * Typed client of the VIDsigner signing API (VIDcloud 3.0). One function per
 * OpenAPI operation (34, excluding `POST /oauth/token`, which is internal) plus
 * `DELETE /documentbatch/{id}` from Annex III: 35 in total.
 *
 * It is independent of the MCP server: it can be imported from other applications.
 * It does not log credentials, bodies or personal data.
 *
 * @example
 * const client = new VidSignerClient({
 *   environment: 'pre',
 *   subscriptionName: process.env.VIDSIGNER_SUBSCRIPTION_NAME!,
 *   subscriptionPass: process.env.VIDSIGNER_SUBSCRIPTION_PASS!,
 * });
 * const pending = await client.listAllDocuments('unsigned');
 */
export class VidSignerClient {
  readonly baseUrl: string;
  readonly environment: VidSignerEnvironment;
  private readonly transport: HttpTransport;
  private readonly basic: AuthStrategy;
  private readonly jwt: AuthStrategy | undefined;
  private readonly mode: AuthMode;
  private readonly provider: TokenProvider | undefined;

  constructor(opts: VidSignerClientOptions) {
    if (!opts.subscriptionName || !opts.subscriptionPass) {
      throw new VidSignerError({
        kind: 'config',
        message: 'subscriptionName and subscriptionPass are required.',
      });
    }
    this.environment = opts.environment ?? 'pre';
    this.baseUrl = (opts.baseUrl ?? VIDSIGNER_BASE_URLS[this.environment]).replace(/\/+$/, '');
    this.mode = opts.authMode ?? 'auto';

    const redactor = new Redactor();
    redactor.addBasicPair(opts.subscriptionName, opts.subscriptionPass);
    redactor.addBasicPair(opts.clientId, opts.clientSecret);
    redactor.addSecret(opts.clientSecret);

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

    const subName = opts.subscriptionName;
    const subPass = opts.subscriptionPass;
    this.basic = { getAuthorization: async () => basicHeader(subName, subPass) };

    const hasClient = !!(opts.clientId && opts.clientSecret);
    if (this.mode === 'jwt' && !hasClient) {
      throw new VidSignerError({
        kind: 'config',
        message: 'authMode=jwt requires clientId and clientSecret.',
      });
    }
    if (hasClient && this.mode !== 'basic') {
      this.provider = new TokenProvider({
        label: 'signing',
        tokenUrl: `${this.baseUrl}/oauth/token`,
        clientId: opts.clientId as string,
        clientSecret: opts.clientSecret as string,
        grant: { username: subName, password: subPass, scope: 'subscription' },
        request: (req) => this.transport.requestToken(req, 'oauth.token'),
        now: opts.now,
        skewSeconds: opts.tokenSkewSeconds,
      });
      const provider = this.provider;
      this.jwt = {
        getAuthorization: async () => `Bearer ${await provider.getToken()}`,
        invalidate: () => provider.invalidate(),
      };
    }
  }

  /** True if the client can perform writes (it has ClientID/Secret and is not in basic mode). */
  get canWrite(): boolean {
    return this.jwt !== undefined;
  }

  // -------------------------------------------------------------------------
  // Devices
  // -------------------------------------------------------------------------

  /** `GET /devices`. Empty list (404/70001) -> `[]`. */
  async getDevices(): Promise<Device[]> {
    return this.call<Device[]>(
      { name: 'devices.list', method: 'GET', ...READ, emptyList: 'codes' },
      '/devices',
    );
  }

  /** `GET /enrollmentcodes/{id}/devices` (OpenAPI only). */
  async listEnrollmentCodeDevices(enrollmentCodeId: string): Promise<Device[]> {
    return this.call<Device[]>(
      { name: 'enrollmentcodes.devices', method: 'GET', ...READ, emptyList: 'codes' },
      `/enrollmentcodes/${seg(enrollmentCodeId)}/devices`,
    );
  }

  // -------------------------------------------------------------------------
  // Documents
  // -------------------------------------------------------------------------

  /**
   * `POST /documents`. Uploads a document to be signed. `content` can be base64 or bytes.
   * NOT retried: a retry after an ambiguous failure would duplicate the document and the notices.
   */
  async createDocument(doc: SendDocumentInput, content: FileContent): Promise<DocGuid> {
    return this.call<DocGuid>(
      { name: 'documents.create', method: 'POST', ...CREATE },
      '/documents',
      { body: { ...doc, DocContent: toBase64(content) } },
    );
  }

  /**
   * `GET /documents/{id}`. Document in any status. On a SIGNED document it MARKS IT AS DOWNLOADED
   * (`Downloaded=true`, it leaves the signed-not-downloaded queue), contrary to what manual 14.18
   * says; verified in pre-production on 17/11/2026. On unsigned or rejected documents the flag does
   * not change.
   */
  async getDocument(docGuid: string): Promise<DocumentContent> {
    return this.call(
      { name: 'documents.get', method: 'GET', ...READ },
      `/documents/${seg(docGuid)}`,
    );
  }

  /** `DELETE /documents/{id}`. Only documents that are not fully signed. */
  async deleteDocument(docGuid: string): Promise<void> {
    await this.call(
      { name: 'documents.delete', method: 'DELETE', ...WRITE_SAFE },
      `/documents/${seg(docGuid)}`,
    );
  }

  /** `GET /documents/{id}/loginfo` (OpenAPI only): trace of the document's operations. */
  async getDocumentLog(docGuid: string): Promise<DocumentTrace[]> {
    return this.call(
      { name: 'documents.loginfo', method: 'GET', ...READ },
      `/documents/${seg(docGuid)}/loginfo`,
    );
  }

  /** `PUT /documents/{docGuid}/expire`. Marks an unsigned document as expired. */
  async expireDocument(docGuid: string): Promise<void> {
    await this.call(
      { name: 'documents.expire', method: 'PUT', ...WRITE_SAFE },
      `/documents/${seg(docGuid)}/expire`,
    );
  }

  /**
   * `GET /documents/{id}/report/{lang}`. Evidence report PDF in base64.
   * Available for signed, rejected or expired documents.
   */
  async getDocumentReport(docGuid: string, lang: ReportLanguage | string): Promise<DocumentReport> {
    return this.call(
      { name: 'documents.report', method: 'GET', ...READ },
      `/documents/${seg(docGuid)}/report/${seg(lang)}`,
    );
  }

  /** `GET /documentinfo/{guid}`. Detailed status of the document and of each signature. */
  async getDocumentInfo(docGuid: string): Promise<DocumentInfo> {
    const raw = await this.call<DocumentInfo>(
      { name: 'documentinfo.get', method: 'GET', ...READ },
      `/documentinfo/${seg(docGuid)}`,
    );
    return normalizeDocumentInfo(raw);
  }

  /**
   * `GET /documentlist/{filter}` with pagination (`paginationDTO.*`).
   *
   * - Validates client-side `pageNumber >= 1` and `0 < pageSize < 100` (the API answers 400).
   * - Empty list (404/50002) -> empty page.
   * - Accepts both the manual's flat array and the OpenAPI paginated object.
   */
  async listDocuments(
    filter: DocumentListFilter,
    opts: DocumentListOptions = {},
  ): Promise<DocumentPage> {
    if (!(DOCUMENT_LIST_FILTERS as readonly string[]).includes(filter)) {
      throw new VidSignerError({
        kind: 'validation',
        operation: 'documentlist.list',
        message: `Invalid filter: ${filter}. Allowed: ${DOCUMENT_LIST_FILTERS.join(', ')}.`,
      });
    }
    validatePagination(opts);
    // Verified in pre (2026-11-16): if any pagination parameter is sent, the API
    // requires a valid pageNumber >= 1 and pageSize (without them it answers 400/12006 or 400/10510).
    const paginated = Object.values(opts).some((v) => v !== undefined);
    const effective: DocumentListOptions = paginated
      ? { ...opts, pageNumber: opts.pageNumber ?? 1, pageSize: opts.pageSize ?? DEFAULT_PAGE_SIZE }
      : opts;
    const raw = await this.call<unknown>(
      { name: 'documentlist.list', method: 'GET', ...READ, emptyList: 'codes' },
      `/documentlist/${seg(filter)}`,
      {
        query: {
          'paginationDTO.pageNumber': effective.pageNumber,
          'paginationDTO.pageSize': effective.pageSize,
          'paginationDTO.searchText': effective.searchText,
          'paginationDTO.orderBy': effective.orderBy,
          'paginationDTO.orderType':
            effective.orderType === undefined
              ? undefined
              : DOCUMENT_LIST_ORDER_TYPE_WIRE[
                  effective.orderType as keyof typeof DOCUMENT_LIST_ORDER_TYPE_WIRE
                ],
        },
      },
    );
    return normalizeDocumentPage(raw);
  }

  /**
   * Walks all pages of `GET /documentlist/{filter}` and returns only the items.
   * If you need to know whether the list is incomplete (due to `maxPages`), use {@link listAllDocumentsPaged}.
   */
  async listAllDocuments(
    filter: DocumentListFilter,
    opts: Omit<DocumentListOptions, 'pageNumber'> & { maxPages?: number } = {},
  ): Promise<DocumentListItem[]> {
    return (await this.listAllDocumentsPaged(filter, opts)).items;
  }

  /**
   * Walks all pages of `GET /documentlist/{filter}`.
   * Stops when `HasNext` is false, the page comes back incomplete or `maxPages` is reached.
   * `truncated` is `true` only if it stopped at `maxPages` while more pages were available.
   */
  async listAllDocumentsPaged(
    filter: DocumentListFilter,
    opts: Omit<DocumentListOptions, 'pageNumber'> & { maxPages?: number } = {},
  ): Promise<DocumentListAll> {
    const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
    const maxPages = opts.maxPages ?? MAX_PAGES_DEFAULT;
    const all: DocumentListItem[] = [];
    const seen = new Set<string>();
    let pagesFetched = 0;
    let truncated = false;
    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber++) {
      const page = await this.listDocuments(filter, { ...opts, pageSize, pageNumber });
      pagesFetched += 1;
      let added = 0;
      for (const item of page.items) {
        const key = item.DocGUI ?? JSON.stringify(item);
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(item);
        added += 1;
      }
      // Without pagination metadata, more pages are assumed as long as the page comes back full.
      const more = page.hasNext ?? page.items.length === pageSize;
      // `added === 0`: the server ignored pagination and is repeating the same list.
      if (!more || added === 0) break;
      if (pageNumber === maxPages) truncated = true;
    }
    return { items: all, pagesFetched, truncated };
  }

  /**
   * `GET /documentsbydevice?device=...&filter=minutesold gt X`.
   * @param minutesOlderThan If given, only documents pending for more than X minutes.
   */
  async listDocumentsByDevice(
    device: string,
    minutesOlderThan?: number,
  ): Promise<DocumentListItem[]> {
    if (
      minutesOlderThan !== undefined &&
      (!Number.isInteger(minutesOlderThan) || minutesOlderThan < 0)
    ) {
      throw new VidSignerError({
        kind: 'validation',
        operation: 'documentsbydevice.list',
        message: 'minutesOlderThan must be an integer >= 0.',
      });
    }
    return this.call(
      { name: 'documentsbydevice.list', method: 'GET', ...READ, emptyList: 'codes' },
      '/documentsbydevice',
      {
        query: {
          device,
          filter: minutesOlderThan !== undefined ? `minutesold gt ${minutesOlderThan}` : undefined,
        },
      },
    );
  }

  // -------------------------------------------------------------------------
  // Signed documents
  // -------------------------------------------------------------------------

  /** `GET /signeddocuments`. GUIDs of signed documents not yet downloaded (marks nothing). */
  async listSignedDocuments(): Promise<SignedDocumentRef[]> {
    return this.call(
      { name: 'signeddocuments.list', method: 'GET', ...READ, emptyList: 'codes-or-empty-body' },
      '/signeddocuments',
    );
  }

  /**
   * `GET /signeddocuments/{id}`.
   *
   * WARNING: this operation MARKS THE DOCUMENT AS DOWNLOADED (manual 14.7/14.8).
   * If the subscription is shared with another system that consumes the "signed, not
   * yet downloaded" queue, you would remove the document from it. To read a document
   * without side effects use {@link getDocument}.
   */
  async getSignedDocument(docGuid: string): Promise<SignedDocument> {
    return this.call(
      { name: 'signeddocuments.get', method: 'GET', ...READ },
      `/signeddocuments/${seg(docGuid)}`,
    );
  }

  /** `DELETE /signeddocuments/{id}`. Soft delete of a signed document. */
  async deleteSignedDocument(docGuid: string): Promise<void> {
    await this.call(
      { name: 'signeddocuments.delete', method: 'DELETE', ...WRITE_SAFE },
      `/signeddocuments/${seg(docGuid)}`,
    );
  }

  // -------------------------------------------------------------------------
  // Signature
  // -------------------------------------------------------------------------

  /**
   * `GET /signature/{SignerGUID}/vidremoteurl`. VIDremote signing link.
   * Only if the signer was created with `SkipSignatureEmail=true` (otherwise 409/16601) and the
   * subscription has `AllowSkipEmail` (otherwise 409/40111). See {@link appendReturnUrl}.
   */
  async getSignatureRemoteUrl(signerGuid: string): Promise<SignatureRemoteUrl> {
    return this.call(
      { name: 'signature.vidremoteurl.get', method: 'GET', ...READ },
      `/signature/${seg(signerGuid)}/vidremoteurl`,
    );
  }

  /** `PUT /signature/{SignerGUID}/vidremoteurl`. Resends the link by email or SMS (sends a real notice). */
  async sendSignatureRemoteUrl(
    signerGuid: string,
    channel: SignatureRemoteUrlChannel,
  ): Promise<void> {
    await this.call(
      { name: 'signature.vidremoteurl.send', method: 'PUT', ...WRITE_SAFE_NO_RETRY },
      `/signature/${seg(signerGuid)}/vidremoteurl`,
      { body: channel },
    );
  }

  /** `POST /signature/{SignerGUID}/attachments`. Attaches a context document to a signer. */
  async addSignatureAttachment(
    signerGuid: string,
    attachment: { FileName: string; content: FileContent },
  ): Promise<AttachmentGuid> {
    const body: Attachment = {
      FileName: attachment.FileName,
      DocContent: toBase64(attachment.content),
    };
    return this.call(
      { name: 'signature.attachments.add', method: 'POST', ...CREATE },
      `/signature/${seg(signerGuid)}/attachments`,
      { body },
    );
  }

  /** `PUT /signature/{SignerGUID}/signerdata`. Changes email or phone (remote signing, unsigned only). */
  async updateSignerData(
    signerGuid: string,
    data: { email?: string; phonenumber?: string },
  ): Promise<void> {
    if (!data.email?.trim() && !data.phonenumber?.trim()) {
      throw new VidSignerError({
        kind: 'validation',
        operation: 'signature.signerdata.update',
        message:
          'Provide at least email or phonenumber: with no fields there is nothing to update.',
      });
    }
    await this.call(
      { name: 'signature.signerdata.update', method: 'PUT', ...WRITE_SAFE },
      `/signature/${seg(signerGuid)}/signerdata`,
      {
        body: {
          SignerData: {
            ...(data.email?.trim() ? { email: data.email.trim() } : {}),
            ...(data.phonenumber?.trim() ? { phonenumber: data.phonenumber.trim() } : {}),
          },
        },
      },
    );
  }

  /** `GET /signature/{SignerGUID}/signaturedata` (OpenAPI only): image and biometric metadata. */
  async getSignatureMetadata(signerGuid: string): Promise<BioSignatureMetadata> {
    return this.call(
      { name: 'signature.signaturedata.get', method: 'GET', ...READ },
      `/signature/${seg(signerGuid)}/signaturedata`,
    );
  }

  /** `GET /signature/{SignerGUID}/evidence` (OpenAPI only): biometric evidence of the BIO signature. */
  async getSignatureEvidence(signerGuid: string): Promise<BioEvidence> {
    return this.call(
      { name: 'signature.evidence.get', method: 'GET', ...READ },
      `/signature/${seg(signerGuid)}/evidence`,
    );
  }

  /** `GET /vidmobileuser/signaturerequest/{id}` (OpenAPI only, Swisscom integration). */
  async getVidMobileSignatureRequest(id: string): Promise<VidMobileSignatureRequestCms> {
    return this.call(
      { name: 'vidmobileuser.signaturerequest.get', method: 'GET', ...READ },
      `/vidmobileuser/signaturerequest/${seg(id)}`,
    );
  }

  // -------------------------------------------------------------------------
  // Batch
  // -------------------------------------------------------------------------

  /** `POST /documentbatch`. Creates a batch (a single email/OTP for several remote documents). */
  async createBatch(batch: SendBatchRequest): Promise<BatchGuid> {
    return this.call(
      { name: 'documentbatch.create', method: 'POST', ...CREATE },
      '/documentbatch',
      {
        body: batch,
      },
    );
  }

  /** `POST /documentbatch/{batchGuid}/document`. Adds a document to the batch. */
  async addDocumentToBatch(
    batchGuid: string,
    doc: SendBatchDocumentInput,
    content: FileContent,
  ): Promise<DocGuid> {
    return this.call(
      { name: 'documentbatch.document.add', method: 'POST', ...CREATE },
      `/documentbatch/${seg(batchGuid)}/document`,
      { body: { ...doc, DocContent: toBase64(content) } },
    );
  }

  /** `PUT /documentbatch/{batchGuid}/status` with `close`: closes the batch and sends the notices. */
  async closeBatch(batchGuid: string): Promise<void> {
    await this.call(
      { name: 'documentbatch.close', method: 'PUT', ...WRITE_SAFE_NO_RETRY },
      `/documentbatch/${seg(batchGuid)}/status`,
      { body: { Status: 'close' } },
    );
  }

  /** `GET /documentbatchinfo/{batchGuid}`. */
  async getBatchInfo(batchGuid: string): Promise<DocumentBatchInfo> {
    const raw = await this.call<DocumentBatchInfo>(
      { name: 'documentbatchinfo.get', method: 'GET', ...READ },
      `/documentbatchinfo/${seg(batchGuid)}`,
    );
    return normalizeBatchInfo(raw);
  }

  /**
   * `DELETE /documentbatch/{batchGuid}`. Only appears in Annex III (errors) of the
   * manual; it is not in the OpenAPI spec or the operations list. To be confirmed.
   */
  async deleteBatch(batchGuid: string): Promise<void> {
    await this.call(
      { name: 'documentbatch.delete', method: 'DELETE', ...WRITE_SAFE },
      `/documentbatch/${seg(batchGuid)}`,
    );
  }

  // -------------------------------------------------------------------------
  // E-Delivery
  // -------------------------------------------------------------------------

  /** `POST /edeliveries`. Sends a document with delivery receipt (sends a real email). */
  async createEDelivery(input: EDeliveryInput, content: FileContent): Promise<EDeliveryGuid> {
    const raw = await this.call<EDeliveryGuid>(
      { name: 'edeliveries.create', method: 'POST', ...CREATE },
      '/edeliveries',
      { body: { ...input, DocContent: toBase64(content) } },
    );
    return normalizeEDeliveryGuid(raw);
  }

  /** `GET /edeliveries`. */
  async listEDeliveries(): Promise<EDeliverySummary[]> {
    return this.call(
      { name: 'edeliveries.list', method: 'GET', ...READ, emptyList: 'codes' },
      '/edeliveries',
    );
  }

  /** `GET /edeliveries/{guid}`. */
  async getEDelivery(guid: string): Promise<EDeliveryInfo> {
    return this.call(
      { name: 'edeliveries.get', method: 'GET', ...READ },
      `/edeliveries/${seg(guid)}`,
    );
  }

  /** `DELETE /edeliveries/{guid}`. */
  async deleteEDelivery(guid: string): Promise<void> {
    await this.call(
      { name: 'edeliveries.delete', method: 'DELETE', ...WRITE_SAFE },
      `/edeliveries/${seg(guid)}`,
    );
  }

  /** `GET /edeliveries/{guid}/report/{lang}`. Evidence report PDF in base64. */
  async getEDeliveryReport(guid: string, lang: ReportLanguage | string): Promise<EDeliveryReport> {
    return this.call(
      { name: 'edeliveries.report', method: 'GET', ...READ },
      `/edeliveries/${seg(guid)}/report/${seg(lang)}`,
    );
  }

  /** `PUT /edeliveries/{guid}/reminders`. Sends a reminder to the recipient (real notice). */
  async sendEDeliveryReminder(guid: string, channel: EDeliveryReminderChannel): Promise<void> {
    await this.call(
      { name: 'edeliveries.reminders', method: 'PUT', ...WRITE_SAFE_NO_RETRY },
      `/edeliveries/${seg(guid)}/reminders`,
      { body: channel },
    );
  }

  /**
   * `POST /edeliveries/search`. Read-only search (treated as a read even though it is a POST).
   * Uses a JWT if there is a ClientID; it is not verified to work with Basic.
   */
  async searchEDeliveries(terms: SearchTerms): Promise<EDeliverySummary[]> {
    return this.call(
      { name: 'edeliveries.search', method: 'POST', ...READ, emptyList: 'codes' },
      '/edeliveries/search',
      { body: terms },
    );
  }

  // -------------------------------------------------------------------------
  // Search / XML
  // -------------------------------------------------------------------------

  /**
   * `POST /search`. Returns the `DocGUI`s matching the terms
   * (`additionaldata`, `elementtype`). Read-only search.
   */
  async search(terms: SearchTerms): Promise<DocGuid[]> {
    return this.call(
      { name: 'search.search', method: 'POST', ...READ, emptyList: 'codes' },
      '/search',
      {
        body: terms,
      },
    );
  }

  /** `POST /xml/sign`. Automatic stamp of an XML (e.g. Facturae) with a subscription certificate. */
  async signXml(request: SignXmlRequest): Promise<SignXmlResponse> {
    return this.call({ name: 'xml.sign', method: 'POST', ...CREATE }, '/xml/sign', {
      body: request,
    });
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private authFor(op: Op): AuthStrategy {
    if (this.jwt) return this.jwt;
    if (op.jwt || this.mode === 'jwt') {
      throw new VidSignerError({
        kind: 'auth',
        operation: op.name,
        message:
          `The operation ${op.name} requires a JWT and no ClientID/ClientSecret is configured ` +
          '(with Basic only reads work). Request the OAuth client from Validated ID.',
      });
    }
    return this.basic;
  }

  private async call<T = unknown>(
    op: Op,
    path: string,
    extra: { query?: RequestSpec['query']; body?: unknown } = {},
  ): Promise<T> {
    const auth = this.authFor(op);
    return this.transport.request<T>({
      operation: op.name,
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

// ---------------------------------------------------------------------------
// Exported utilities
// ---------------------------------------------------------------------------

/** Converts bytes or base64 to base64. Strings are assumed to be already encoded. */
export function toBase64(content: FileContent): string {
  return typeof content === 'string' ? content : Buffer.from(content).toString('base64');
}

/**
 * Appends `url_return` (base64) to the VIDremote signing link, as the
 * manual states (14.14): when finished or rejecting, the signer is sent back to that URL.
 */
export function appendReturnUrl(signatureUrl: string, returnUrl: string): string {
  const encoded = Buffer.from(returnUrl, 'utf8').toString('base64');
  return `${signatureUrl}${signatureUrl.includes('?') ? '&' : '?'}url_return=${encoded}`;
}

/** Adds the manual's `SignersGroups` spelling to the documentinfo response (and vice versa). */
export function normalizeDocumentInfo(raw: DocumentInfo): DocumentInfo {
  if (!raw || typeof raw !== 'object') return raw;
  const groups = raw.SignerGroups ?? raw.SignersGroups;
  return groups === undefined ? raw : { ...raw, SignerGroups: groups, SignersGroups: groups };
}

/** Unifies `Guid`/`BatchGUI` and `Docs[].Guid`/`Docs[].DocGUI` in the documentbatchinfo response. */
export function normalizeBatchInfo(raw: DocumentBatchInfo): DocumentBatchInfo {
  if (!raw || typeof raw !== 'object') return raw;
  const guid = raw.Guid ?? raw.BatchGUI;
  const out: DocumentBatchInfo =
    guid === undefined ? { ...raw } : { ...raw, Guid: guid, BatchGUI: guid };
  if (Array.isArray(raw.Docs)) {
    out.Docs = raw.Docs.map((d) => {
      const g = d.Guid ?? d.DocGUI;
      return g === undefined ? d : { ...d, Guid: g, DocGUI: g };
    });
  }
  return out;
}

/** Unifies `GUID` (OpenAPI) and `DocGUI` (manual 14.25) in the `POST /edeliveries` response. */
export function normalizeEDeliveryGuid(raw: EDeliveryGuid): EDeliveryGuid {
  if (!raw || typeof raw !== 'object') return raw;
  const guid = raw.GUID ?? raw.DocGUI;
  return guid === undefined ? raw : { ...raw, GUID: guid, DocGUI: guid };
}

function validatePagination(opts: DocumentListOptions): void {
  const fail = (message: string): never => {
    throw new VidSignerError({ kind: 'validation', operation: 'documentlist.list', message });
  };
  if (
    opts.pageNumber !== undefined &&
    (!Number.isInteger(opts.pageNumber) || opts.pageNumber < 1)
  ) {
    fail('pageNumber must be an integer >= 1 (pagination starts at 1).');
  }
  if (
    opts.pageSize !== undefined &&
    (!Number.isInteger(opts.pageSize) || opts.pageSize < 1 || opts.pageSize > 99)
  ) {
    fail('pageSize must be an integer between 1 and 99 (greater than 0 and less than 100).');
  }
  if (opts.searchText !== undefined) {
    const n = opts.searchText.length;
    if (n < SEARCH_TEXT_LENGTH.min || n > SEARCH_TEXT_LENGTH.max) {
      fail(
        `searchText must be between ${SEARCH_TEXT_LENGTH.min} and ${SEARCH_TEXT_LENGTH.max} characters (otherwise 400 / 10601).`,
      );
    }
  }
  if (
    opts.orderBy !== undefined &&
    !(DOCUMENT_LIST_ORDER_BY as readonly string[]).includes(opts.orderBy)
  ) {
    fail(`Invalid orderBy: ${opts.orderBy}. Allowed: ${DOCUMENT_LIST_ORDER_BY.join(', ')}.`);
  }
  if (
    opts.orderType !== undefined &&
    !(DOCUMENT_LIST_ORDER_TYPES as readonly string[]).includes(opts.orderType)
  ) {
    fail(
      `Invalid orderType: ${opts.orderType}. Allowed: ${DOCUMENT_LIST_ORDER_TYPES.join(', ')} (sent as asc or des).`,
    );
  }
}

/** Unifies the two response shapes of `documentlist` into a {@link DocumentPage}. */
export function normalizeDocumentPage(raw: unknown): DocumentPage {
  if (Array.isArray(raw)) {
    return { items: raw as DocumentListItem[], unpaginated: true };
  }
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    const list = o['List'];
    if (Array.isArray(list)) {
      return {
        items: list as DocumentListItem[],
        pageNumber: numberOrUndef(o['PageNumber']),
        pageSize: numberOrUndef(o['PageSize']),
        totalPages: numberOrUndef(o['TotalPages']),
        hasNext: typeof o['HasNext'] === 'boolean' ? o['HasNext'] : undefined,
        unpaginated: false,
      };
    }
  }
  return { items: [], unpaginated: true };
}

function numberOrUndef(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}
