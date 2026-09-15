import type {
  CitationProviderID,
  ProviderLookupResult,
  RelatedWorkMetadata,
  SourceMetrics,
  WorkIdentifiers,
} from "../domain/citationTypes";
import type { CancellationSignal } from "../services/cancellationScope";

export interface ProviderRequestOptions {
  signal?: CancellationSignal;
  /**
   * Passed to `requestJSON`: false when the caller backs off from refusals
   * itself (the hop fill, ADR 0013), so a 429 comes back at once.
   */
  retryRefusals?: boolean;
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
