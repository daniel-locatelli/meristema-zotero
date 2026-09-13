import type { RelatedWorkMetadata } from "../domain/citationTypes";
import type {
  CitationGraphEdge,
  CitationGraphFocusRole,
  CitationGraphIndex,
  CitationGraphNode,
} from "../domain/graphTypes";
import {
  bibliographicWorkAliases,
  externalWorkLookupIdentity,
  graphNodeLookupAliases,
  matchRelatedWorkToGraphNode,
  normalizeDOI,
  relationshipStableAliases,
  stableExternalWorkIdentity,
} from "../domain/workIdentity";

/** The seed set. Direction and depth live on the hop state now. */
export interface GraphFocusState {
  /** Ordered seed keys. The first entry is the primary seed used for labels. */
  seedKeys: string[];
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dataAgeDays(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? Math.max(0, (Date.now() - timestamp) / 86400000)
    : null;
}

function completeness(work: RelatedWorkMetadata): number {
  const fields = [
    Boolean(work.title?.trim()),
    work.year !== null,
    work.authors.length > 0,
    Boolean(normalizeDOI(work.doi)),
    Boolean(work.sourceTitle?.trim()),
    Boolean(work.abstract?.trim()),
    work.citationCount != null,
    work.referenceCount != null,
  ];
  return fields.filter(Boolean).length / fields.length;
}

function providerForNode(
  provider: RelatedWorkMetadata["provider"],
): CitationGraphNode["provider"] {
  return provider === "manual" || provider === "zotero" ? null : provider;
}

function externalNodeKey(work: RelatedWorkMetadata): string {
  return `focus:${externalWorkLookupIdentity(work)}`;
}

export function externalWorkToFocusNode(
  work: RelatedWorkMetadata,
  role: CitationGraphFocusRole,
): CitationGraphNode {
  const key = externalNodeKey(work);
  const provider = providerForNode(work.provider);
  const referenceCount = finite(work.referenceCount);
  const resolvedReferenceCount = Math.max(
    0,
    Math.floor(
      finite(work.resolvedReferenceCount) ?? work.references?.length ?? 0,
    ),
  );
  const referenceCoverage =
    referenceCount === null
      ? null
      : referenceCount === 0
        ? resolvedReferenceCount === 0
          ? 1
          : null
        : resolvedReferenceCount / referenceCount;
  return {
    key,
    itemID: 0,
    itemKey: key,
    kind: "external",
    focusRole: role,
    externalWork: { ...work, authors: [...work.authors] },
    title: work.title?.trim() || "Title unavailable",
    abstract: work.abstract ?? null,
    sourceTitle: work.sourceTitle ?? null,
    authors: [...work.authors],
    year: work.year,
    publicationDate: work.publicationDate ?? null,
    citationSequence: null,
    doi: normalizeDOI(work.doi),
    tags: [],
    collectionIDs: [],
    citationCount: finite(work.citationCount),
    referenceCount,
    resolvedReferenceCount,
    referenceCoverage,
    metricsUpdatedAt: work.updatedAt ?? null,
    dataAgeDays: dataAgeDays(work.updatedAt),
    provider,
    citationCountProvider: work.citationCount == null ? null : provider,
    referenceCountProvider: work.referenceCount == null ? null : provider,
    providerWorkID: work.providerWorkID,
    matchedBy: null,
    matchConfidence: null,
    matchConfirmed: true,
    metricStatus: provider ? "success" : null,
    fwci: finite(work.fwci),
    citationPercentile: finite(work.citationPercentile),
    isTop1Percent: work.isTop1Percent ?? null,
    isTop10Percent: work.isTop10Percent ?? null,
    citationsLastYear: finite(work.citationsLastYear),
    citationVelocity: finite(work.citationVelocity),
    citationAcceleration: finite(work.citationAcceleration),
    influentialCitationCount: finite(work.influentialCitationCount),
    isRetracted: work.isRetracted ?? null,
    openAccessStatus: work.openAccessStatus ?? null,
    isOpenAccess: work.isOpenAccess ?? null,
    publicationType: work.publicationType ?? null,
    sourceMetrics: work.sourceMetrics ?? null,
    metadataCompleteness:
      finite(work.metadataCompleteness) ?? completeness(work),
    incomingLibraryCitations: 0,
    outgoingLibraryReferences: 0,
    libraryCoverage: null,
    localGlobalImpactRatio: null,
    isIsolated: false,
    referenceAgeMean: finite(work.referenceAgeMean),
    referenceAgeSpread: finite(work.referenceAgeSpread),
    selfCitationEstimate: finite(work.selfCitationEstimate),
    futureReferenceCount: finite(work.futureReferenceCount),
    references: [...(work.references ?? [])],
  };
}

/**
 * Enrich an existing external seed in place without changing its graph key.
 * The hop model and selection use `key`, while relationship persistence may
 * safely promote a provisional candidate `itemKey` to a stable external
 * identity once one becomes available.
 */
export function synchronizeExternalFocusNode(
  node: CitationGraphNode,
  work: RelatedWorkMetadata,
): boolean {
  if (node.itemID > 0) return true;
  const role = node.focusRole ?? "seed";
  const previousKey = node.key;
  const previousItemKey = node.itemKey;
  const previousSequence = node.citationSequence;
  const refreshed = externalWorkToFocusNode(work, role);
  const stableIdentity = stableExternalWorkIdentity(work);

  Object.assign(node, refreshed);
  node.key = previousKey;
  node.itemKey =
    stableIdentity && previousItemKey.startsWith("focus:candidate:")
      ? refreshed.itemKey
      : previousItemKey;
  node.focusRole = role;
  node.citationSequence = previousSequence;
  return Boolean(stableIdentity);
}

/** The library's nodes by key and alias, for matching a stored work to one. */
export function buildLocalWorkIndexes(
  nodes: CitationGraphNode[],
  graphIndex?: CitationGraphIndex,
) {
  const byKey = new Map<string, CitationGraphNode>();
  const byAlias = new Map<string, CitationGraphNode[]>();
  if (graphIndex) {
    for (const [key, node] of graphIndex.nodeByKey) {
      byKey.set(key.toLocaleUpperCase(), node);
    }
    for (const [alias, candidates] of graphIndex.nodesByAlias) {
      byAlias.set(alias, [...candidates]);
    }
  }
  for (const node of nodes) {
    byKey.set(node.itemKey.toLocaleUpperCase(), node);
    byKey.set(node.key.toLocaleUpperCase(), node);
    for (const alias of graphNodeLookupAliases(node)) {
      const group = byAlias.get(alias) ?? [];
      group.push(node);
      byAlias.set(alias, group);
    }
  }
  return { byKey, byAlias };
}

export type LocalWorkIndexes = ReturnType<typeof buildLocalWorkIndexes>;

/** The library's own node for a stored work, when exactly one matches it. */
export function localNodeForWork(
  work: RelatedWorkMetadata,
  indexes: LocalWorkIndexes,
): CitationGraphNode | null {
  const explicit = work.inLibraryItemKey ?? work.zoteroItemKey;
  if (explicit) {
    const local = indexes.byKey.get(explicit.toLocaleUpperCase());
    if (local) return local;
  }
  const stableAliases = relationshipStableAliases(work);
  const aliases = stableAliases.length
    ? stableAliases
    : bibliographicWorkAliases(work);
  const candidates = new Map<string, CitationGraphNode>();
  for (const alias of aliases) {
    for (const candidate of indexes.byAlias.get(alias) ?? []) {
      candidates.set(candidate.key, candidate);
    }
  }
  const matching = [...candidates.values()].filter(
    (candidate) =>
      matchRelatedWorkToGraphNode(work, candidate).decision === "same-work",
  );
  return matching.length === 1 ? matching[0] : null;
}

/**
 * The library graph plus what the seeds brought in. The library's own node
 * always wins: the hop model's copy carries a focus role and a cloned
 * identity, and the graph is already drawing the original.
 */
export function additiveGraphModel(
  base: {
    nodes: readonly CitationGraphNode[];
    edges: readonly CitationGraphEdge[];
  },
  hops: {
    nodes: readonly CitationGraphNode[];
    edges: readonly CitationGraphEdge[];
  } | null,
): { nodes: CitationGraphNode[]; edges: CitationGraphEdge[] } {
  const nodes = [...base.nodes];
  const edges = [...base.edges];
  if (!hops) return { nodes, edges };
  const nodeKeys = new Set(nodes.map((node) => node.key));
  for (const node of hops.nodes) {
    if (nodeKeys.has(node.key)) continue;
    nodeKeys.add(node.key);
    nodes.push(node);
  }
  const edgeKeys = new Set(edges.map((edge) => edge.key));
  for (const edge of hops.edges) {
    if (edgeKeys.has(edge.key)) continue;
    edgeKeys.add(edge.key);
    edges.push(edge);
  }
  return { nodes, edges };
}
