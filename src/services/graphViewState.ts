import type { RelatedWorkMetadata } from "../domain/citationTypes";
import type { CitationGraphNode } from "../domain/graphTypes";
import {
  normalizeDOI,
  stableExternalWorkIdentity,
} from "../domain/workIdentity";
import type { GraphViewTransform } from "./citationGraphRenderer";
import {
  externalWorkToFocusNode,
  type GraphFocusDirection,
  type GraphFocusLocality,
} from "./graphFocusService";
import {
  defaultPaperListFilterState,
  type PaperListFilterState,
} from "./paperListViewService";

/**
 * A graph as a recipe: what to seed it with and how to show it. Neighbours
 * are never part of it; they are recomputed from the current citation data
 * whenever the state is applied, so a state made today still describes the
 * same graph after the library has moved on.
 *
 * Plain data, no DOM, so it serialises to JSON, survives a view rebuild, and
 * can be stored.
 */
export const GRAPH_VIEW_STATE_VERSION = 1;

export type GraphViewSeed =
  /** A Zotero item, by key rather than ID: keys survive sync, IDs do not. */
  | { kind: "item"; itemKey: string }
  /**
   * A paper outside Zotero, with its metadata inline so the seed still
   * renders after the external work cache has been cleared.
   */
  | { kind: "external"; identityKey: string; work: RelatedWorkMetadata };

export interface GraphViewExploreSettings {
  direction: GraphFocusDirection;
  locality: GraphFocusLocality;
}

export interface GraphViewState {
  version: typeof GRAPH_VIEW_STATE_VERSION;
  /** Ordered. The first entry is the primary seed. Empty means library graph. */
  seeds: GraphViewSeed[];
  explore: GraphViewExploreSettings;
  filters: PaperListFilterState;
  camera: GraphViewTransform | null;
  /** The custom tab title, or null when the title is derived. */
  title: string | null;
}

const DIRECTIONS: readonly GraphFocusDirection[] = [
  "both",
  "references",
  "cited-by",
];
const LOCALITIES: readonly GraphFocusLocality[] = ["all", "local"];

export function emptyGraphViewState(): GraphViewState {
  return {
    version: GRAPH_VIEW_STATE_VERSION,
    seeds: [],
    explore: { direction: "both", locality: "all" },
    filters: defaultPaperListFilterState(),
    camera: null,
    title: null,
  };
}

export function seedFromNode(node: CitationGraphNode): GraphViewSeed | null {
  if (node.itemID > 0 && node.itemKey) {
    return { kind: "item", itemKey: node.itemKey };
  }
  const work = node.externalWork;
  if (!work) return null;
  const identityKey = stableExternalWorkIdentity(work);
  if (!identityKey) return null;
  return {
    kind: "external",
    identityKey,
    work: { ...work, authors: [...work.authors] },
  };
}

export interface GraphViewSeedResolvers {
  /** A library node by Zotero item key, or null when the item is gone. */
  nodeForItemKey: (itemKey: string) => CitationGraphNode | null;
  /** A library node whose DOI matches (already normalised), or null. */
  nodeForDOI?: (doi: string) => CitationGraphNode | null;
}

export function resolveGraphViewSeeds(
  seeds: readonly GraphViewSeed[],
  resolvers: GraphViewSeedResolvers,
): { nodes: CitationGraphNode[]; dropped: number } {
  const nodes: CitationGraphNode[] = [];
  let dropped = 0;
  for (const seed of seeds) {
    if (seed.kind === "item") {
      const node = resolvers.nodeForItemKey(seed.itemKey);
      if (node) nodes.push(node);
      else dropped += 1;
      continue;
    }
    // A paper that was outside Zotero when the state was written may have
    // been imported since; the seed is then that library item, not a copy.
    const importedKey = (seed.work as { inLibraryItemKey?: string | null })
      .inLibraryItemKey;
    const imported = importedKey ? resolvers.nodeForItemKey(importedKey) : null;
    if (imported) {
      nodes.push(imported);
      continue;
    }
    const doi = normalizeDOI(seed.work.doi);
    const byDOI =
      doi && resolvers.nodeForDOI ? resolvers.nodeForDOI(doi) : null;
    nodes.push(byDOI ?? externalWorkToFocusNode(seed.work, "seed"));
  }
  return { nodes, dropped };
}

export function serializeGraphViewState(state: GraphViewState): string {
  return JSON.stringify(state);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * An inline work has to be trustworthy enough to render as a node without
 * further checks, so a seed carrying a malformed one is dropped whole.
 */
function parseInlineWork(value: unknown): RelatedWorkMetadata | null {
  if (!isRecord(value)) return null;
  if (typeof value.provider !== "string" || !value.provider) return null;
  const nullableString = (candidate: unknown): string | null | false =>
    typeof candidate === "string"
      ? candidate
      : candidate === null || candidate === undefined
        ? null
        : false;
  const title = nullableString(value.title);
  const doi = nullableString(value.doi);
  const providerWorkID = nullableString(value.providerWorkID);
  if (title === false || doi === false || providerWorkID === false) return null;
  const year =
    value.year === null || value.year === undefined
      ? null
      : finiteNumber(value.year);
  if (year === null && value.year !== null && value.year !== undefined) {
    return null;
  }
  if (!Array.isArray(value.authors)) return null;
  const authors = value.authors.filter(
    (author): author is string => typeof author === "string",
  );
  return {
    ...(value as unknown as RelatedWorkMetadata),
    provider: value.provider as RelatedWorkMetadata["provider"],
    providerWorkID,
    title,
    doi,
    year,
    authors,
  };
}

function parseSeed(value: unknown): GraphViewSeed | null {
  if (!isRecord(value)) return null;
  if (value.kind === "item") {
    return typeof value.itemKey === "string" && value.itemKey
      ? { kind: "item", itemKey: value.itemKey }
      : null;
  }
  if (value.kind === "external") {
    if (typeof value.identityKey !== "string" || !value.identityKey)
      return null;
    const work = parseInlineWork(value.work);
    return work
      ? { kind: "external", identityKey: value.identityKey, work }
      : null;
  }
  return null;
}

function parseFilters(value: unknown): PaperListFilterState {
  const filters = defaultPaperListFilterState();
  if (!isRecord(value)) return filters;
  const collectionIDs = Array.isArray(value.collectionIDs)
    ? value.collectionIDs.filter(
        (id): id is number => Number.isInteger(id) && (id as number) > 0,
      )
    : filters.collectionIDs;
  const sameType = <K extends keyof PaperListFilterState>(
    key: K,
  ): PaperListFilterState[K] => {
    const candidate = value[key];
    const fallback = filters[key];
    if (fallback === null) {
      return (
        typeof candidate === "string" || typeof candidate === "number"
          ? candidate
          : null
      ) as PaperListFilterState[K];
    }
    return (
      typeof candidate === typeof fallback ? candidate : fallback
    ) as PaperListFilterState[K];
  };
  return {
    collectionIDs,
    tag: typeof value.tag === "string" ? value.tag : null,
    relation: sameType("relation"),
    itemType: typeof value.itemType === "string" ? value.itemType : null,
    yearMin: finiteNumber(value.yearMin),
    yearMax: finiteNumber(value.yearMax),
    includeMissingYear: sameType("includeMissingYear"),
    includeMissingCitations: sameType("includeMissingCitations"),
    includeMissingReferences: sameType("includeMissingReferences"),
    excludeRetracted: sameType("excludeRetracted"),
    openAccessOnly: sameType("openAccessOnly"),
  };
}

function parseCamera(value: unknown): GraphViewTransform | null {
  if (!isRecord(value)) return null;
  const x = finiteNumber(value.x);
  const y = finiteNumber(value.y);
  const scale = finiteNumber(value.scale);
  return x === null || y === null || scale === null || scale <= 0
    ? null
    : { x, y, scale };
}

export function parseGraphViewState(json: string): GraphViewState | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.version !== GRAPH_VIEW_STATE_VERSION) return null;
  const empty = emptyGraphViewState();
  const explore = isRecord(raw.explore) ? raw.explore : {};
  const direction = DIRECTIONS.find((d) => d === explore.direction);
  const locality = LOCALITIES.find((l) => l === explore.locality);
  return {
    version: GRAPH_VIEW_STATE_VERSION,
    seeds: Array.isArray(raw.seeds)
      ? raw.seeds
          .map(parseSeed)
          .filter((seed): seed is GraphViewSeed => seed !== null)
      : [],
    explore: {
      direction: direction ?? empty.explore.direction,
      locality: locality ?? empty.explore.locality,
    },
    filters: parseFilters(raw.filters),
    camera: parseCamera(raw.camera),
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title : null,
  };
}
