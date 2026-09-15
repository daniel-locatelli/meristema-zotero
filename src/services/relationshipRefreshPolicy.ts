import type { CitationProviderID } from "../domain/citationTypes";

export type RelationshipRefreshMode = "automatic" | "manual";
export type RelationshipProviderStrategy = "native-first" | "aggregate";

export interface RelationshipRefreshPolicy {
  mode: RelationshipRefreshMode;
  membershipLimit: number;
  metadataLimit: number;
  metadataBatchSize: number;
  providerStrategy: RelationshipProviderStrategy;
  providerLimit: number;
  maxAgeMs: number;
}

export const RELATIONSHIP_CACHE_MAX_AGE_MS = 30 * 86400000;
export const AUTOMATIC_RELATIONSHIP_MEMBERSHIP_LIMIT = 50;
export const AUTOMATIC_RELATIONSHIP_METADATA_LIMIT = 25;
export const AUTOMATIC_RELATIONSHIP_METADATA_BATCH_SIZE = 10;
export const MANUAL_RELATIONSHIP_METADATA_LIMIT = 50;
export const MANUAL_RELATIONSHIP_METADATA_BATCH_SIZE = 50;
export const LARGE_RELATIONSHIP_SET_THRESHOLD = 300;

export function relationshipRefreshPolicy(
  mode: RelationshipRefreshMode,
  overrides: Partial<RelationshipRefreshPolicy> = {},
): RelationshipRefreshPolicy {
  const base: RelationshipRefreshPolicy =
    mode === "automatic"
      ? {
          mode,
          membershipLimit: AUTOMATIC_RELATIONSHIP_MEMBERSHIP_LIMIT,
          metadataLimit: AUTOMATIC_RELATIONSHIP_METADATA_LIMIT,
          metadataBatchSize: AUTOMATIC_RELATIONSHIP_METADATA_BATCH_SIZE,
          providerStrategy: "aggregate",
          providerLimit: Number.POSITIVE_INFINITY,
          maxAgeMs: RELATIONSHIP_CACHE_MAX_AGE_MS,
        }
      : {
          mode,
          membershipLimit: Number.POSITIVE_INFINITY,
          // Relationship membership is useful immediately. Do not make a
          // manual refresh wait for every optional neighbour field when a
          // paper has hundreds or thousands of relationships.
          metadataLimit: MANUAL_RELATIONSHIP_METADATA_LIMIT,
          metadataBatchSize: MANUAL_RELATIONSHIP_METADATA_BATCH_SIZE,
          providerStrategy: "aggregate",
          providerLimit: Number.POSITIVE_INFINITY,
          maxAgeMs: RELATIONSHIP_CACHE_MAX_AGE_MS,
        };
  return { ...base, ...overrides, mode };
}

/**
 * Relationship size must not silently reduce the provider set selected in
 * Settings. Large lists are made responsive through bounded concurrency,
 * cooperative processing, and one final commit instead.
 */
export function relationshipProviderPolicyForSize(
  mode: RelationshipRefreshMode,
  reportedCount: number | null | undefined,
  overrides: {
    providerStrategy?: RelationshipProviderStrategy;
    providerLimit?: number;
  } = {},
): Pick<RelationshipRefreshPolicy, "providerStrategy" | "providerLimit"> {
  void mode;
  void reportedCount;
  // Size never reduces the provider set (B9). A caller may still narrow it
  // on purpose: a hop expansion asks the paper's own provider and no other.
  return {
    providerStrategy: overrides.providerStrategy ?? "aggregate",
    providerLimit: overrides.providerLimit ?? Number.POSITIVE_INFINITY,
  };
}

export function relationshipForegroundMetadataLimit(
  mode: RelationshipRefreshMode,
  relationshipCount: number,
  configuredLimit: number,
): number {
  if (
    mode === "manual" &&
    relationshipCount >= LARGE_RELATIONSHIP_SET_THRESHOLD
  ) {
    return 0;
  }
  return Number.isFinite(configuredLimit)
    ? Math.max(0, Math.floor(configuredLimit))
    : Math.max(0, relationshipCount);
}

export function relationshipSnapshotIsFresh(
  fetchedAt: string | null | undefined,
  maxAgeMs = RELATIONSHIP_CACHE_MAX_AGE_MS,
  now = Date.now(),
): boolean {
  if (!fetchedAt) return false;
  const timestamp = Date.parse(fetchedAt);
  return Number.isFinite(timestamp) && now - timestamp < maxAgeMs;
}

export function relationshipRefreshRequiresFollowUp(
  active: Pick<RelationshipRefreshPolicy, "mode" | "membershipLimit">,
  requested: Pick<RelationshipRefreshPolicy, "mode" | "membershipLimit">,
  refreshMembership: boolean,
): boolean {
  return (
    refreshMembership &&
    ((requested.mode === "manual" && active.mode !== "manual") ||
      requested.membershipLimit > active.membershipLimit)
  );
}

export function orderRelationshipProviders(
  available: readonly CitationProviderID[],
  preferred: readonly (CitationProviderID | null | undefined)[],
  strategy: RelationshipProviderStrategy,
  maximum: number,
): CitationProviderID[] {
  if (strategy === "aggregate") {
    return Number.isFinite(maximum)
      ? [...available].slice(0, Math.max(0, maximum))
      : [...available];
  }
  const availableSet = new Set(available);
  const ordered: CitationProviderID[] = [];
  for (const provider of preferred) {
    if (
      !provider ||
      !availableSet.has(provider) ||
      ordered.includes(provider)
    ) {
      continue;
    }
    ordered.push(provider);
  }
  for (const provider of available) {
    if (!ordered.includes(provider)) ordered.push(provider);
  }
  return Number.isFinite(maximum)
    ? ordered.slice(0, Math.max(0, maximum))
    : ordered;
}

/**
 * Truncate an ordered relationship plan to `maximum` providers, keeping at
 * least one that can page the direction whenever the plan holds one.
 *
 * A merged plan may carry a provider that only reads an embedded list off its
 * work record — Crossref's reference array is a legitimate references source
 * beside the others. Truncated to a single provider it is not: a hop
 * expansion that asks Crossref alone gets an empty or DOI-less list, stores
 * nothing, and the paper is marked failed for the session. The head is left
 * exactly as it was ordered whenever it already contains a paging provider,
 * so a wider plan keeps its native-first order and its metadata source.
 */
export function limitRelationshipProviders(
  ordered: readonly CitationProviderID[],
  maximum: number,
  canPage: (providerID: CitationProviderID) => boolean,
): CitationProviderID[] {
  if (!Number.isFinite(maximum)) return [...ordered];
  const limit = Math.max(0, Math.floor(maximum));
  const head = ordered.slice(0, limit);
  if (!limit || head.some(canPage)) return head;
  const promoted = ordered.slice(limit).find(canPage);
  if (!promoted) return head;
  return [promoted, ...head.slice(0, limit - 1)];
}

/**
 * Keep a stable display/progress order without excluding any enabled
 * provider. Aggregate refreshes consume the complete available list.
 */
export function preferredRelationshipProviders(
  direction: "references" | "cited-by",
  available: readonly CitationProviderID[],
  nodeProvider: CitationProviderID | null | undefined,
  countProvider: CitationProviderID | null | undefined,
  hasDOI: boolean,
): Array<CitationProviderID | null | undefined> {
  void direction;
  void hasDOI;
  return [nodeProvider, countProvider, ...available];
}

/** What a provider lookup's status means for a relationship refresh. */
export type LookupStep = "accept" | "refuse" | "search";

/**
 * A match is used; a refusal (HTTP 429) ends the provider's part in the
 * refresh, because a title search straight after it is a second request to a
 * provider that just refused (B50); anything else may still be found by title.
 */
export function lookupStep(status: string | null): LookupStep {
  if (status === "success") return "accept";
  if (status === "rate-limited") return "refuse";
  return "search";
}

export interface PagingProviderFacts {
  enabled: boolean;
  /** The provider has the direction's fetcher (`providerPagesRelationships`). */
  pagesDirection: boolean;
  hasOpenAlexKey: boolean;
}

/**
 * A paging provider for a direction (CONTEXT.md): enabled, able to page the
 * direction, and for OpenAlex holding a key, since keyless OpenAlex returns an
 * empty page before making any request.
 */
export function isPagingProvider(
  providerID: CitationProviderID,
  facts: PagingProviderFacts,
): boolean {
  return (
    facts.enabled &&
    facts.pagesDirection &&
    (providerID !== "openalex" || facts.hasOpenAlexKey)
  );
}

export interface FillCandidateInput {
  /** The native-first order over the provider plan, register bypassed. */
  ordered: readonly CitationProviderID[];
  isPaging: (providerID: CitationProviderID) => boolean;
  supportsPaper: (providerID: CitationProviderID) => boolean;
  /** Providers sitting out a window in this fill. */
  excluded: readonly CitationProviderID[];
}

export interface FillCandidates {
  /** Who a fill expansion may ask, first first. */
  candidates: CitationProviderID[];
  /** Paging providers for the paper that a window left out. */
  skipped: CitationProviderID[];
}

/**
 * Who a fill expansion asks (ADR 0013): paging providers that can take the
 * paper, in the given order, never one sitting out a window. Only the refresh
 * knows which paging providers apply to a paper, so it reports `skipped`.
 */
export function fillRelationshipCandidates(
  input: FillCandidateInput,
): FillCandidates {
  const candidates: CitationProviderID[] = [];
  const skipped: CitationProviderID[] = [];
  for (const provider of input.ordered) {
    if (!input.isPaging(provider) || !input.supportsPaper(provider)) continue;
    if (input.excluded.includes(provider)) skipped.push(provider);
    else candidates.push(provider);
  }
  return { candidates, skipped };
}

/** The next provider a fill expansion asks: the first not yet seen refusing. */
export function nextFillProvider(
  candidates: readonly CitationProviderID[],
  refused: readonly CitationProviderID[],
): CitationProviderID | null {
  return candidates.find((provider) => !refused.includes(provider)) ?? null;
}

/**
 * A snapshot a refusal cut short. Before any work was collected it is no
 * answer at all and is never stored; after, the works already collected stand
 * as a partial list.
 */
export function refusedSnapshotState(collectedCount: number): {
  succeeded: boolean;
  complete: false;
} {
  return { succeeded: collectedCount > 0, complete: false };
}

/**
 * Whether a fill expansion stops at this snapshot (ADR 0013): an answer or a
 * failure always ends it, and so does a refusal that still collected a
 * usable partial list, keeping one answering provider per expansion. Only a
 * refusal with nothing usable moves the expansion on to the next candidate.
 */
export function fillStopsAt(snapshot: {
  refused: boolean;
  succeeded: boolean;
}): boolean {
  return !snapshot.refused || snapshot.succeeded;
}

/**
 * Whether an empty first page is a failure rather than an empty list. A fill
 * trusts an empty list only when a lookup match or a reported count stands
 * behind it: OpenCitations answers 200 with `[]` for a DOI it does not index,
 * and its lookup no longer matches at all (410 Gone, B63), so its DOI fallback
 * would otherwise store "no citers" for every paper it has never seen.
 * Manual paths keep today's rule.
 */
export function unbackedEmptyList(input: {
  fill: boolean;
  firstPageEmpty: boolean;
  matched: boolean;
  reportedCount: number | null;
}): boolean {
  return (
    input.fill &&
    input.firstPageEmpty &&
    !input.matched &&
    input.reportedCount === null
  );
}
