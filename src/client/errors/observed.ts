import type { VidErrorCatalogEntry } from './catalog.generated.js';

/**
 * Catalog entry for an error that is NOT in the vendor manual: it was observed while calling the
 * API. Kept apart from `catalog.generated.ts` (which is regenerated from the manual and never
 * edited by hand) so that `npm run gen:errors` cannot erase it.
 */
export interface ObservedErrorEntry extends VidErrorCatalogEntry {
  /** Always `observed`: the entry does not come from the manual. */
  source: 'observed';
  /** Date of the observation (YYYY-MM-DD). */
  observedAt: string;
  /** Environment where it was observed. */
  environment: 'pre' | 'pro';
}

/**
 * Errors observed in practice and absent from Annex III of the manual. Messages are as returned
 * by the API (placeholders `{0}` left unreplaced). Diagnostic aid only: never used to decide
 * business logic, and the client does not validate these rules before sending.
 */
export const OBSERVED_ERRORS: Readonly<Record<number, ObservedErrorEntry>> = {
  12541: {
    http: 400,
    message: 'NotificationEmailMessage cannot be null for Signer: {0}',
    endpoints: ['POST /documents'],
    source: 'observed',
    observedAt: '2026-11-17',
    environment: 'pre',
  },
  12544: {
    http: 400,
    message: 'NotificationEmailMessage must be null if SkipSignatureEmail is true for Signer: {0}',
    endpoints: ['POST /documents'],
    source: 'observed',
    observedAt: '2026-11-17',
    environment: 'pre',
  },
  12305: {
    http: 400,
    message: 'The image width is not valid value. Value: {0}',
    endpoints: ['POST /documents'],
    source: 'observed',
    observedAt: '2026-11-17',
    environment: 'pre',
  },
  15600: {
    http: 400,
    message: '{0} cannot be null or empty',
    endpoints: ['POST /documents'],
    source: 'observed',
    observedAt: '2026-11-17',
    environment: 'pre',
  },
  50403: {
    http: 400,
    message: 'Xml document type not supported. Allowed: 3.2,3.2.1,3.2.2',
    endpoints: ['POST /xml/sign'],
    source: 'observed',
    observedAt: '2026-11-17',
    environment: 'pre',
  },
  90140: {
    http: 400,
    message: 'Pin cannot be null or empty',
    endpoints: ['POST /documents'],
    source: 'observed',
    observedAt: '2026-11-17',
    environment: 'pre',
  },
};
