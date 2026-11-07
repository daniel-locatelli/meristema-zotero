import type {
  CitationGraphNode,
  GraphNodeColorMetric,
} from "../domain/graphTypes";
import {
  categoricalSwatchAt,
  GRAPH_ASSIGNED_CATEGORY_LIMIT,
  type GraphTheme,
} from "./graphTheme";
import {
  allocateSwatches,
  swatchIndexFor,
  type SwatchLedgerState,
} from "./graphSwatchLedger";
import type { ReadState } from "../readingFormat/readState";
import {
  seedLinkRampIndex,
  seedLinkTierKey,
  seedLinkTierLabel,
  type SeedLinkSource,
} from "./graphSeedLinks";

/**
 * Which categories a colour metric can split nodes into, and which swatch
 * each one holds.
 *
 * Colour used to be dealt by **rank**: categories were ordered by how many
 * nodes carried them and took the theme's swatches in that order, so ticking
 * one folder changed the counts and repainted every other folder (backlog
 * B12). Now a category's swatch is held in a `SwatchLedgerState` (see
 * `graphSwatchLedger.ts`) keyed by category identity, not position, so a
 * category keeps its colour for as long as it is present regardless of what
 * else comes and goes. Rank still decides which categories are named in the
 * key and which collapse into "Other"; it decides no colour at all.
 *
 * A node now carries at most one category under any metric — folder
 * membership no longer paints the node's fill at all, so the case of a node
 * split across several colours does not arise here any more.
 */

/**
 * The prefix that makes the two reserved keys below impossible to collide
 * with a real category key, which is a provider ID or a type name and so can
 * be anything a record holds. It is built rather than written as a literal
 * because an escape in a string literal keeps getting normalised back into a
 * raw NUL byte in this file, and a file holding one is binary to git, which
 * prints no diff for it and has already cost this module one code review.
 */
const RESERVED_PREFIX = String.fromCharCode(0);

/**
 * Nodes with no value are grouped under this reserved key. The U+0000 prefix
 * is what keeps it from ever colliding with a real category key, which is a
 * provider ID or a type name and can be anything a record holds — a leading
 * space is not the guarantee a leading NUL is. It is written as an escape
 * rather than embedded as a raw byte so the file stays text: git calls a file
 * with a NUL byte in it binary and prints no diff for it at all.
 */
const NO_VALUE_KEY = `${RESERVED_PREFIX}no-value`;
/** The collapsed remainder is grouped under this reserved key. */
const OTHER_KEY = `${RESERVED_PREFIX}other`;
/** Seeds linked's no-value label: seeds and papers past hop 1 are not graded. */
const NOT_GRADED = "Not graded";

const READ_STATE_ORDER: readonly ReadState[] = ["unread", "reading", "read"];
const READ_STATE_LABELS: Record<ReadState, string> = {
  unread: "Unread",
  reading: "Reading",
  read: "Read",
};
/** Fixed ramp stops, so a state is the same colour on every graph (user, 2026-11-07). */
const READ_STATE_RAMP: Record<ReadState, number> = {
  unread: 0,
  reading: 2,
  read: 4,
};
const NOT_IN_LIBRARY = "Not in library";

export interface CategoryEntry {
  /** Stable identity — a provider ID, a type name. */
  key: string;
  /** What the Key rail shows. */
  label: string;
  /** How many nodes carry this category. */
  count: number;
  color: string;
}

export interface CategoryAssignment {
  metric: GraphNodeColorMetric;
  /** The categories that got a swatch, largest first. */
  entries: CategoryEntry[];
  /** Everything past the limit, or null when nothing was collapsed. */
  other: CategoryEntry | null;
  /** Nodes with no value for the metric, or null when every node had one. */
  noValue: CategoryEntry | null;
  /** The ledger after this call, carried forward into the next one. */
  ledger: SwatchLedgerState;
  /** The node's fill. */
  colorFor(node: CitationGraphNode): string;
  /** The node's category label. */
  labelFor(node: CitationGraphNode): string;
  /**
   * The node's category key, or null when it has no value.
   *
   * Labels are what a person reads and are not unique — two categories can
   * share a name — so anything deciding which entry a node belongs to has to
   * compare keys. The Key rail's emphasis does exactly that.
   */
  keyFor(node: CitationGraphNode): string | null;
}

/**
 * Display name for a collection ID, or null when it is not in scope.
 *
 * Not consulted by this module any more — folder membership no longer picks
 * a node colour — but kept here as a type for Task 8's region legend, which
 * still needs to turn a collection ID into a label.
 */
export interface CategoryLabelSource {
  labelFor(collectionID: number): string | null;
}

interface CategoryRef {
  key: string;
  label: string;
}

const OPEN_ACCESS_LABELS = ["Open access", "Closed"] as const;

/** The node's single category under this metric, or null when it has none. */
export function nodeCategory(
  node: CitationGraphNode,
  metric: GraphNodeColorMetric,
  hopOf?: (key: string) => number | undefined,
  seedLinks?: SeedLinkSource,
  readStateOf?: (key: string) => ReadState | undefined,
): CategoryRef | null {
  if (metric === "read-state") {
    const state = readStateOf?.(node.key);
    return state
      ? { key: `read-state:${state}`, label: READ_STATE_LABELS[state] }
      : null;
  }
  if (metric === "seed-links") {
    const k = seedLinks?.of(node.key);
    if (k === undefined || !seedLinks) return null;
    return {
      key: seedLinkTierKey(k),
      label: seedLinkTierLabel(k, seedLinks.seedCount, seedLinks.direction),
    };
  }
  if (metric === "citation-hop") {
    const hop = hopOf ? hopOf(node.key) : (node.hop ?? undefined);
    if (hop === undefined || hop === null) return null;
    const label = hop === 0 ? "Seed" : `Hop ${hop}`;
    return { key: `hop:${hop}`, label };
  }
  if (metric === "publication-type") {
    return node.publicationType
      ? { key: node.publicationType, label: node.publicationType }
      : null;
  }
  if (metric === "open-access") {
    if (node.isOpenAccess === null || node.isOpenAccess === undefined)
      return null;
    const label = node.isOpenAccess
      ? OPEN_ACCESS_LABELS[0]
      : OPEN_ACCESS_LABELS[1];
    return { key: label, label };
  }
  return null;
}

export interface AssignCategoriesOptions {
  labels?: CategoryLabelSource;
  /** Colours are held by key, in this ledger, and never dealt by rank. */
  ledger: SwatchLedgerState;
  /**
   * The Citation hop colouring's source of truth. The plot's library nodes
   * never carry `hop` (additiveGraphModel keeps the library's own object),
   * so the view hands the hop map in and the node's stamp is only a fallback
   * for fixtures.
   */
  hopOf?: (key: string) => number | undefined;
  /**
   * The Seeds linked colouring's source: each hop-1 paper's seed links, the
   * seed count and the direction, from the seed marks (ADR 0008).
   */
  seedLinks?: SeedLinkSource;
  /**
   * The Read state colouring's source: the reading plan's state per library
   * paper.
   */
  readStateOf?: (key: string) => ReadState | undefined;
}

export function assignCategories(
  nodes: CitationGraphNode[],
  metric: GraphNodeColorMetric,
  theme: GraphTheme,
  options: AssignCategoriesOptions,
): CategoryAssignment {
  if (metric === "seed-links")
    return assignSeedLinkTiers(nodes, theme, options);
  if (metric === "read-state") return assignReadStates(nodes, theme, options);

  const counts = new Map<string, { label: string; count: number }>();
  let noValueCount = 0;

  for (const node of nodes) {
    const ref = nodeCategory(node, metric, options.hopOf);
    if (!ref) {
      noValueCount += 1;
      continue;
    }
    const existing = counts.get(ref.key);
    if (existing) existing.count += 1;
    else counts.set(ref.key, { label: ref.label, count: 1 });
  }

  // Largest first; ties by label so the order never depends on input order.
  // This rank decides which categories are named and which collapse into
  // Other — it decides no colour.
  const ranked = [...counts.entries()]
    .map(([key, value]) => ({ key, label: value.label, count: value.count }))
    .sort(
      (left, right) =>
        right.count - left.count || left.label.localeCompare(right.label),
    );

  const assigned = ranked.slice(0, GRAPH_ASSIGNED_CATEGORY_LIMIT);
  const collapsed = ranked.slice(GRAPH_ASSIGNED_CATEGORY_LIMIT);

  const ledger = allocateSwatches(
    options.ledger,
    assigned.map((entry) => entry.key),
    theme.categorical.swatches.length,
  );

  const entries: CategoryEntry[] = assigned.map((entry) => ({
    ...entry,
    color: categoricalSwatchAt(swatchIndexFor(ledger, entry.key), theme),
  }));

  const colorByKey = new Map(entries.map((entry) => [entry.key, entry.color]));

  const other: CategoryEntry | null = collapsed.length
    ? {
        key: OTHER_KEY,
        label: "Other",
        count: collapsed.reduce((sum, entry) => sum + entry.count, 0),
        color: theme.categorical.other,
      }
    : null;

  const noValue: CategoryEntry | null = noValueCount
    ? {
        key: NO_VALUE_KEY,
        label: "No value",
        count: noValueCount,
        color: theme.categorical.noValue,
      }
    : null;

  function firstCategory(node: CitationGraphNode): CategoryRef | null {
    return nodeCategory(node, metric, options.hopOf);
  }

  return {
    metric,
    entries,
    other,
    noValue,
    ledger,
    colorFor(node) {
      const ref = firstCategory(node);
      if (!ref) return theme.categorical.noValue;
      return colorByKey.get(ref.key) ?? theme.categorical.other;
    },
    labelFor(node) {
      return firstCategory(node)?.label ?? "No value";
    },
    keyFor(node) {
      return firstCategory(node)?.key ?? null;
    },
  };
}

/**
 * Seeds linked is categorical but ordered: tiers are named highest first and
 * coloured from the theme's sequential ramp by k of S, so a tier's colour is
 * fixed and the swatch ledger is neither read nor moved. No tier collapses
 * into Other; there are at most as many tiers as seeds.
 */
function assignSeedLinkTiers(
  nodes: CitationGraphNode[],
  theme: GraphTheme,
  options: AssignCategoriesOptions,
): CategoryAssignment {
  const source = options.seedLinks;
  const counts = new Map<number, number>();
  let noValueCount = 0;
  for (const node of nodes) {
    const k = source?.of(node.key);
    if (k === undefined) noValueCount += 1;
    else counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const seedCount = source?.seedCount ?? 0;
  const direction = source?.direction ?? "cited-by";
  const entries: CategoryEntry[] = [...counts.entries()]
    .sort((left, right) => right[0] - left[0])
    .map(([k, count]) => ({
      key: seedLinkTierKey(k),
      label: seedLinkTierLabel(k, seedCount, direction),
      count,
      color: theme.ramp[seedLinkRampIndex(k, seedCount, theme.ramp.length)],
    }));
  const colorByKey = new Map(entries.map((entry) => [entry.key, entry.color]));
  const noValue: CategoryEntry | null = noValueCount
    ? {
        key: NO_VALUE_KEY,
        label: NOT_GRADED,
        count: noValueCount,
        color: theme.categorical.noValue,
      }
    : null;
  const ref = (node: CitationGraphNode): CategoryRef | null =>
    nodeCategory(node, "seed-links", options.hopOf, source);
  return {
    metric: "seed-links",
    entries,
    other: null,
    noValue,
    ledger: options.ledger,
    colorFor(node) {
      const found = ref(node);
      return found
        ? (colorByKey.get(found.key) ?? theme.categorical.noValue)
        : theme.categorical.noValue;
    },
    labelFor(node) {
      return ref(node)?.label ?? NOT_GRADED;
    },
    keyFor(node) {
      return ref(node)?.key ?? null;
    },
  };
}

/**
 * Read state is categorical but fixed: Unread, Reading, Read in that order,
 * each from its own ramp stop, so the ledger is neither read nor moved and no
 * state collapses into Other. A paper with no state (not in the library) is
 * the no-value grey.
 */
function assignReadStates(
  nodes: CitationGraphNode[],
  theme: GraphTheme,
  options: AssignCategoriesOptions,
): CategoryAssignment {
  const ref = (node: CitationGraphNode): CategoryRef | null =>
    nodeCategory(node, "read-state", undefined, undefined, options.readStateOf);
  const counts = new Map<ReadState, number>();
  let noValueCount = 0;
  for (const node of nodes) {
    const state = options.readStateOf?.(node.key);
    if (state) counts.set(state, (counts.get(state) ?? 0) + 1);
    else noValueCount += 1;
  }
  const colorOf = (state: ReadState): string =>
    theme.ramp[Math.min(READ_STATE_RAMP[state], theme.ramp.length - 1)];
  const entries: CategoryEntry[] = READ_STATE_ORDER.filter((s) =>
    counts.has(s),
  ).map((state) => ({
    key: `read-state:${state}`,
    label: READ_STATE_LABELS[state],
    count: counts.get(state) ?? 0,
    color: colorOf(state),
  }));
  const noValue: CategoryEntry | null = noValueCount
    ? {
        key: NO_VALUE_KEY,
        label: NOT_IN_LIBRARY,
        count: noValueCount,
        color: theme.categorical.noValue,
      }
    : null;
  return {
    metric: "read-state",
    entries,
    other: null,
    noValue,
    ledger: options.ledger,
    colorFor(node) {
      const state = options.readStateOf?.(node.key);
      return state ? colorOf(state) : theme.categorical.noValue;
    },
    labelFor(node) {
      return ref(node)?.label ?? NOT_IN_LIBRARY;
    },
    keyFor(node) {
      return ref(node)?.key ?? null;
    },
  };
}
