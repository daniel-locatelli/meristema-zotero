import type { RelatedWorkMetadata } from "../domain/citationTypes";
import type { CitationGraphNode } from "../domain/graphTypes";
import {
  normalizeDOI,
  stableExternalWorkIdentity,
} from "../domain/workIdentity";
import type { GraphViewTransform } from "./citationGraphRenderer";
import {
  allCollectionsTicked,
  onlyCollectionsTicked,
  type GraphViewCollectionTicks,
} from "./graphScopeModel";
import { externalWorkToFocusNode } from "./graphFocusService";
import {
  clampHopDepth,
  MAX_HOP_DEPTH,
  type HopDirection,
} from "./graphHopModel";
import {
  defaultPaperListFilterState,
  type PaperListFilterState,
} from "./paperListViewService";
import { emptySwatchLedger, type SwatchLedgerState } from "./graphSwatchLedger";

export type { GraphViewCollectionTicks };

/**
 * A graph as a recipe: what to seed it with and how to show it. Neighbours
 * are never part of it; they are recomputed from the current citation data
 * whenever the state is applied, so a state made today still describes the
 * same graph after the library has moved on.
 *
 * Plain data, no DOM, so it serialises to JSON, survives a view rebuild, and
 * can be stored.
 */
export const GRAPH_VIEW_STATE_VERSION = 6;

/**
 * Which view (D4) the graph is on. `null` is "never chosen", which shows
 * the gallery; `"blank"` is the reader's Start blank; otherwise the id of a
 * shipped view or of a saved one (`user:…`). "(edited)" is never stored: the
 * chip recomputes it by comparing the live settings with the view.
 */
export type GraphViewRef = { id: string } | "blank" | null;

/** At most this many folder regions are drawn at once. */

export type GraphViewSeed =
  /** A Zotero item, by key rather than ID: keys survive sync, IDs do not. */
  | { kind: "item"; itemKey: string }
  /**
   * A paper outside Zotero, with its metadata inline so the seed still
   * renders after the external work cache has been cleared.
   */
  | { kind: "external"; identityKey: string; work: RelatedWorkMetadata };

export interface GraphViewHopsSettings {
  direction: HopDirection;
  /** The deepest hop opened, 1..6. */
  depth: number;
  /** By hop, length 7; index 0 is the seeds and is always true. */
  enabled: boolean[];
}

export function defaultHopEnabled(): boolean[] {
  return Array.from({ length: MAX_HOP_DEPTH + 1 }, () => true);
}

export interface GraphViewState {
  version: typeof GRAPH_VIEW_STATE_VERSION;
  /** Ordered. The first entry is the primary seed. Empty means library graph. */
  seeds: GraphViewSeed[];
  hops: GraphViewHopsSettings;
  filters: PaperListFilterState;
  /** Which of the library's folders are drawn. */
  collections: GraphViewCollectionTicks;
  /** Papers in no folder are drawn. */
  includeUnfiled: boolean;
  /** Papers outside Zotero are drawn. */
  includeExternal: boolean;
  /** Papers the reader removed one by one. */
  hiddenKeys: string[];
  /** The citation floor, 0 when off (spec: the citation floor). Since version 6. */
  floor: number;
  /**
   * The folders drawn as regions, oldest selection first. Uncapped since
   * 2026-09-11 (F14): overlapping translucent hulls do stop being readable
   * past a handful, but the reader can see that and untick, whereas a folder
   * silently released by a later selection was invisible.
   */
  regions: number[];
  /**
   * Which swatch each *collection ID* holds, stringified. Despite the name,
   * this never holds a category assignment: `graphViewService.ts` only ever
   * writes stringified collection IDs into it. The category ledger the spec
   * describes (publication type, provider, ...) is `categorySwatches`, a
   * field of its own rather than a namespace inside this one: a collection
   * ID and a category value can both be the string `"12"`, and an
   * unnamespaced merge would let one silently clobber the other. Never
   * dealt by rank; see B12.
   */
  swatches: SwatchLedgerState;
  /** Which seed-palette index each seed key holds. */
  seedSwatches: SwatchLedgerState;
  /**
   * Which categorical swatch each category key holds — a publication type,
   * a provider, "Open access", "Retracted". Draws from the same pool as
   * `swatches`, deliberately (a region is a large translucent hull and a
   * category a small solid disc, so a shared swatch is never confusable),
   * but is kept apart from it because the keys can collide. Persisted so a
   * category that came and went in one session opens on the same swatch it
   * had (B25); a version 3 record saved before the field existed parses to
   * an empty ledger, which reallocates deterministically.
   */
  categorySwatches: SwatchLedgerState;
  camera: GraphViewTransform | null;
  /** The custom tab title, or null when the title is derived. */
  title: string | null;
  view: GraphViewRef;
  /**
   * True when the ticks came out of the version 1 migration and still name
   * only the folders that recipe listed. The view expands them once through
   * the library's folder tree, because version 1 drew a scoped parent's whole
   * subtree. Never serialised: it is a fact about this parse, not about the
   * graph, and ticks the rail wrote must never be expanded — a child unticked
   * under a ticked parent would come back.
   */
  ticksNeedDescendants?: boolean;
  /**
   * True when this parse mapped a version 4 `explore.direction` of `both`
   * to Citers. The view shows a one-time status for it. Never serialised.
   */
  migratedFromBothDirections?: boolean;
}

const HOP_DIRECTIONS: readonly HopDirection[] = ["cited-by", "references"];

export function emptyGraphViewState(): GraphViewState {
  return {
    version: GRAPH_VIEW_STATE_VERSION,
    seeds: [],
    hops: { direction: "cited-by", depth: 1, enabled: defaultHopEnabled() },
    filters: defaultPaperListFilterState(),
    collections: allCollectionsTicked(),
    includeUnfiled: true,
    includeExternal: true,
    hiddenKeys: [],
    floor: 0,
    regions: [],
    swatches: emptySwatchLedger(),
    seedSwatches: emptySwatchLedger(),
    categorySwatches: emptySwatchLedger(),
    camera: null,
    title: null,
    view: null,
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

/**
 * The seed whose identity is `identityKey` learns the library item it was
 * imported as. The next resolve then finds that item instead of building an
 * external node, which is how an imported seed turns local. Pure: the input
 * seeds are left as they were.
 */
export function markExternalSeedImported(
  seeds: readonly GraphViewSeed[],
  identityKey: string,
  itemKey: string,
): GraphViewSeed[] {
  return seeds.map((seed) =>
    seed.kind === "external" && seed.identityKey === identityKey
      ? { ...seed, work: { ...seed.work, inLibraryItemKey: itemKey } }
      : seed,
  );
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
    const importedKey = seed.work.inLibraryItemKey ?? seed.work.zoteroItemKey;
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
  const {
    ticksNeedDescendants: _migrated,
    migratedFromBothDirections: _both,
    ...persisted
  } = state;
  return JSON.stringify(persisted);
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

function parseViewRef(value: unknown): GraphViewRef {
  if (value === "blank") return "blank";
  if (isRecord(value) && typeof value.id === "string" && value.id.trim()) {
    return { id: value.id };
  }
  return null;
}

function parseTicks(value: unknown): GraphViewCollectionTicks | null {
  if (!isRecord(value)) return null;
  if (value.base !== "all" && value.base !== "none") return null;
  if (!Array.isArray(value.except)) return null;
  const except = value.except.filter(
    (id): id is number => Number.isInteger(id) && (id as number) > 0,
  );
  return value.base === "all"
    ? { base: "all", except }
    : { base: "none", except };
}

/** A stored floor: a finite number at or above 0, floored; anything else is off. */
function parseFloor(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

function parseKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter((key): key is string => typeof key === "string" && !!key),
    ),
  ];
}

function normalizedRegions(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const ids = raw.filter(
    (id): id is number => Number.isInteger(id) && (id as number) > 0,
  );
  return [...new Set(ids)];
}

/**
 * A version 2 graph carried no regions, because folder membership was a node
 * fill and the colour metric defaulted to Collection. A graph made from
 * folders keeps showing those folders, now as regions; a whole-library graph
 * takes none, since picking folders the reader never singled out would
 * be noise dressed as continuity.
 *
 * The ticks are all there is to go on: `parseGraphViewState` holds a recipe
 * and no nodes, so it cannot rank folders by how many papers they hold and
 * must not pretend to. Ascending ID order is arbitrary but stable.
 */
function migratedRegions(ticks: GraphViewCollectionTicks): number[] {
  if (ticks.base !== "none") return [];
  return [...ticks.except].sort((a, b) => a - b);
}

/**
 * Parsed defensively: a hand-edited, truncated or hostile record must not
 * throw. A version 2 record has neither field, which yields an empty ledger
 * here — correct, since it carried none.
 *
 * `assigned` must be a plain object, not an array: `Object.entries` would
 * otherwise walk an array's indices as if they were keys, producing a
 * plausible-looking but nonsensical map.
 */
function parsedLedger(raw: unknown): SwatchLedgerState {
  const record = (isRecord(raw) ? raw : {}) as Partial<SwatchLedgerState>;
  const assigned: Record<string, number> = {};
  const assignedSource = isRecord(record.assigned) ? record.assigned : {};
  for (const [key, value] of Object.entries(assignedSource)) {
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
      assigned[key] = value;
    }
  }
  const releasedOrder = Array.isArray(record.releasedOrder)
    ? record.releasedOrder.filter(
        (key): key is string => typeof key === "string",
      )
    : [];
  return { assigned, releasedOrder };
}

/**
 * A version 1 recipe stored the folders a graph was scoped to — a whitelist —
 * so an empty list is the whole library and a non-empty one is exactly those
 * folders. Nothing was hidden, and neither Unfiled nor Not in Zotero existed,
 * so both are on. The list is lifted out of `filters`, because a graph's
 * folders live in the ticks now.
 */
function migrateFromVersion1(
  filters: PaperListFilterState,
): Pick<
  GraphViewState,
  | "collections"
  | "includeUnfiled"
  | "includeExternal"
  | "hiddenKeys"
  | "ticksNeedDescendants"
> {
  const scoped = filters.collectionIDs;
  filters.collectionIDs = [];
  return {
    collections: scoped.length
      ? onlyCollectionsTicked(scoped)
      : allCollectionsTicked(),
    includeUnfiled: true,
    includeExternal: true,
    hiddenKeys: [],
    ticksNeedDescendants: scoped.length > 0,
  };
}

/**
 * Version 5 stores `hops`. Versions 1 to 4 stored `explore.direction` in
 * `both | references | cited-by`; `both` and `cited-by` become Citers, and
 * `both` is reported so the view can say so once. Locality is dropped.
 *
 * Which field is authoritative is decided by `version`, not by which key
 * happens to be present: a version 4 fixture built by spreading
 * `emptyGraphViewState()` carries the current default `hops`, and its own
 * `explore` override must still win.
 */
function parseHops(
  raw: Record<string, unknown>,
  version: unknown,
): { hops: GraphViewHopsSettings; migratedFromBoth: boolean } {
  const empty = emptyGraphViewState().hops;
  if (version === GRAPH_VIEW_STATE_VERSION && isRecord(raw.hops)) {
    const rawHops = raw.hops;
    const direction =
      HOP_DIRECTIONS.find((d) => d === rawHops.direction) ?? empty.direction;
    const enabledRaw = Array.isArray(rawHops.enabled) ? rawHops.enabled : [];
    const enabled = defaultHopEnabled().map((fallback, hop) =>
      hop === 0
        ? true
        : typeof enabledRaw[hop] === "boolean"
          ? enabledRaw[hop]
          : fallback,
    );
    return {
      hops: { direction, depth: clampHopDepth(rawHops.depth), enabled },
      migratedFromBoth: false,
    };
  }
  const explore = isRecord(raw.explore) ? raw.explore : {};
  const legacy = explore.direction;
  return {
    hops: {
      direction: legacy === "references" ? "references" : "cited-by",
      depth: 1,
      enabled: defaultHopEnabled(),
    },
    migratedFromBoth: legacy === "both",
  };
}

export function parseGraphViewState(json: string): GraphViewState | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  if (
    raw.version !== GRAPH_VIEW_STATE_VERSION &&
    raw.version !== 5 &&
    raw.version !== 4 &&
    raw.version !== 3 &&
    raw.version !== 2 &&
    raw.version !== 1
  ) {
    return null;
  }
  const empty = emptyGraphViewState();
  const hops = parseHops(raw, raw.version);
  const filters = parseFilters(raw.filters);
  const scope =
    raw.version === 1
      ? migrateFromVersion1(filters)
      : {
          collections: parseTicks(raw.collections) ?? empty.collections,
          includeUnfiled:
            typeof raw.includeUnfiled === "boolean" ? raw.includeUnfiled : true,
          includeExternal:
            typeof raw.includeExternal === "boolean"
              ? raw.includeExternal
              : true,
          hiddenKeys: parseKeys(raw.hiddenKeys),
          ticksNeedDescendants: false,
        };
  // Regions have been stored since version 3; older records rebuild them
  // from the ticks. Version 4 only added `view`. Version 5 replaced
  // `explore` with `hops`. Version 6 added `floor`.
  const regions =
    typeof raw.version === "number" && raw.version >= 3
      ? normalizedRegions(raw.regions)
      : migratedRegions(scope.collections);
  return {
    version: GRAPH_VIEW_STATE_VERSION,
    seeds: Array.isArray(raw.seeds)
      ? raw.seeds
          .map(parseSeed)
          .filter((seed): seed is GraphViewSeed => seed !== null)
      : [],
    hops: hops.hops,
    ...(isRecord(raw.explore)
      ? { migratedFromBothDirections: hops.migratedFromBoth }
      : {}),
    filters,
    ...scope,
    floor: parseFloor(raw.floor),
    regions,
    swatches: parsedLedger(raw.swatches),
    seedSwatches: parsedLedger(raw.seedSwatches),
    categorySwatches: parsedLedger(raw.categorySwatches),
    camera: parseCamera(raw.camera),
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title : null,
    view: parseViewRef(raw.view),
  };
}
