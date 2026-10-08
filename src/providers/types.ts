import type {
  CitationProviderID,
  ProviderLookupResult,
  RelatedWorkMetadata,
  SourceMetrics,
  WorkIdentifiers,
} from "../domain/citationTypes";
import type { CancellationSignal } from "../services/cancellationScope";

/** How a relationship list was cut to its limit: most cited first, or as the provider returns it. */
export type RelationshipCutOrder = "most-cited" | "arrival";

export interface ProviderRequestOptions {
  signal?: CancellationSignal;
  /**
   * Passed to `requestJSON`: false when the caller backs off from refusals
   * itself (the hop fill, ADR 0013), so a 429 comes back at once.
   */
  retryRefusals?: boolean;
  /**
   * The order a page fetcher is asked to cut in. Only OpenAlex honours
   * `most-cited`; every other provider returns arrival order whatever is
   * asked, so the snapshot records what it got, not what it wanted.
   */
  order?: RelationshipCutOrder;
}

export interface ProviderCapabilities {
  identifiers: {
    doi: boolean;
    pmid: boolean;
    arxiv: boolean;
    isbn: boolean;
    titleSearch: boolean;
  };
  citationCount: boolean;
  referenceCount: boolean;
  citingWorks: boolean;
  referencedWorks: boolean;
  abstract: boolean;
  openAccess: boolean;
  retraction: boolean;
  sourceMetrics: boolean;
}

export interface CitationProvider {
  readonly id: CitationProviderID;
  readonly label: string;
  readonly capabilities: ProviderCapabilities;
  supports(identifiers: WorkIdentifiers): boolean;
  lookup(
    identifiers: WorkIdentifiers,
    options?: ProviderRequestOptions,
  ): Promise<ProviderLookupResult>;
  lookupForRelations?(
    identifiers: WorkIdentifiers,
    options?: ProviderRequestOptions,
  ): Promise<ProviderLookupResult>;
  searchExactTitle?(
    identifiers: WorkIdentifiers,
    options?: ProviderRequestOptions,
  ): Promise<ProviderLookupResult>;
  fetchCitingWorks?(
    providerWorkID: string,
    maximum: number,
    offset?: number,
    options?: ProviderRequestOptions,
  ): Promise<RelatedWorkMetadata[]>;
  fetchReferencedWorks?(
    providerWorkID: string,
    maximum: number,
    offset?: number,
    options?: ProviderRequestOptions,
  ): Promise<RelatedWorkMetadata[]>;
  fetchSourceMetrics?(
    sourceID: string,
    options?: ProviderRequestOptions,
  ): Promise<SourceMetrics | null>;
}

export function failureStatusFromHTTP(
  status: number,
): "not-found" | "rate-limited" | "network-error" | "provider-error" {
  if (status === 400 || status === 404) return "not-found";
  if (status === 429) return "rate-limited";
  if (status === 0 || status >= 500) return "network-error";
  return "provider-error";
}

/**
 * A relationship page's body, or null for a miss (a 404 or 400, as the
 * lookups read one), which the caller answers as an empty list. Any other
 * failure, a server error, a dropped connection or an empty body, throws.
 * Answered as `[]`, a fault reads as the end of the list and, with no total
 * to hold it against, was stored as the paper's complete list (B80, B84). A
 * 429 is the caller's to throw as a refusal first.
 */
export function relationPageBody<T>(
  page: string,
  response: { ok: boolean; status: number; data: T | null; message: string },
): T | null {
  if (response.ok && response.data) return response.data;
  if (!response.ok && failureStatusFromHTTP(response.status) === "not-found")
    return null;
  throw new Error(
    `${page} failed: ${response.message || `HTTP ${response.status}`}`,
  );
}

/**
 * A provider answered HTTP 429. A refusal is neither "no results" nor a
 * failure (ADR 0013): page fetchers throw this so a relationship refresh can
 * tell a refused page from an empty one.
 */
export class ProviderRefusedError extends Error {
  readonly provider: CitationProviderID;

  constructor(provider: CitationProviderID) {
    super(`${provider} refused the request (HTTP 429)`);
    this.name = "ProviderRefusedError";
    this.provider = provider;
  }
}

export function numberOrNull(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function stringOrNull(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}
