import type { CitationProviderID } from "../domain/citationTypes";

export interface ProviderExecutionPolicy {
  batchSize: number;
  requestParallelism: number;
  minimumStartDelayMs: number;
  relationshipPageSize: number;
}

const STATIC_POLICY: Record<CitationProviderID, ProviderExecutionPolicy> = {
  crossref: {
    batchSize: 1,
    requestParallelism: 3,
    minimumStartDelayMs: 350,
    relationshipPageSize: 100,
  },
  // Semantic Scholar grants 1 request per second, cumulative across all
  // endpoints, keyed or keyless, and asks applicants to stay below it. A key
  // buys a private quota, never speed; the batch and page sizes below apply
  // either way.
  "semantic-scholar": {
    batchSize: 500,
    requestParallelism: 1,
    minimumStartDelayMs: 1100,
    relationshipPageSize: 200,
  },
  opencitations: {
    batchSize: 1,
    requestParallelism: 3,
    minimumStartDelayMs: 400,
    relationshipPageSize: 1000,
  },
  inspire: {
    batchSize: 25,
    requestParallelism: 2,
    minimumStartDelayMs: 400,
    relationshipPageSize: 250,
  },
  // OpenAlex returns 429 above 100 requests per second at every
  // authentication level, so ~8/s is an order of magnitude inside the rate.
  // Its real limit is a daily budget — roughly 10,000 list-and-filter calls
  // on a free key — which no per-second number can defend.
  openalex: {
    batchSize: 100,
    requestParallelism: 2,
    minimumStartDelayMs: 250,
    relationshipPageSize: 100,
  },
};

/**
 * Internal provider policy. These values are deliberately not user settings:
 * each API has different request, payload, and rate-limit characteristics.
 *
 * A stored API key does not appear here on purpose. It used to raise the rate
 * for Semantic Scholar and OpenAlex, which was backlog B9: Semantic Scholar's
 * authenticated plan is the same 1 request per second as its keyless one, and
 * OpenAlex refuses every request without a key, so it has no keyless path to
 * be slower than. Each entry of STATIC_POLICY is the rate its provider grants.
 */
export function providerExecutionPolicy(
  provider: CitationProviderID,
): ProviderExecutionPolicy {
  return STATIC_POLICY[provider];
}

export const LIBRARY_CORE_FALLBACK_PARALLELISM = 2;
/**
 * Relationship jobs combine network traffic with substantial synchronous
 * merging and JSON persistence. Keep this lower than ordinary request
 * parallelism so Zotero's main thread can continue painting during bulk work.
 */
export const RELATIONSHIP_ITEM_PARALLELISM = 1;
/**
 * Bulk updates hydrate exactly one bounded first hop. The returned neighbours
 * contain compact summaries only; their own relationships are never expanded.
 */
export const RELATIONSHIP_BULK_EAGER_LIMIT = 100;
export const RELATIONSHIP_SUMMARY_BACKGROUND_FALLBACK_LIMIT = 12;
export const RELATIONSHIP_SUMMARY_BATCH_SIZE = 200;
export const CITATION_RECORD_WRITE_CHUNK_SIZE = 100;
export const SOURCE_RECORD_WRITE_CHUNK_SIZE = 100;
