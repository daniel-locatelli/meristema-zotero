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
const RETRACTION_LABELS = ["Retracted", "Not retracted"] as const;

/** The node's single category under this metric, or null when it has none. */
export function nodeCategory(
  node: CitationGraphNode,
  metric: GraphNodeColorMetric,
): CategoryRef | null {
  if (metric === "publication-type") {
    return node.publicationType
      ? { key: node.publicationType, label: node.publicationType }
      : null;
  }
  if (metric === "provider") {
    return node.provider ? { key: node.provider, label: node.provider } : null;
  }
  if (metric === "open-access") {
    if (node.isOpenAccess === null || node.isOpenAccess === undefined)
      return null;
    const label = node.isOpenAccess
      ? OPEN_ACCESS_LABELS[0]
      : OPEN_ACCESS_LABELS[1];
    return { key: label, label };
  }
  if (metric === "retraction") {
    if (node.isRetracted === null || node.isRetracted === undefined)
      return null;
    const label = node.isRetracted
      ? RETRACTION_LABELS[0]
      : RETRACTION_LABELS[1];
    return { key: label, label };
  }
  return null;
}

export interface AssignCategoriesOptions {
  labels?: CategoryLabelSource;
  /** Colours are held by key, in this ledger, and never dealt by rank. */
  ledger: SwatchLedgerState;
}

export function assignCategories(
  nodes: CitationGraphNode[],
  metric: GraphNodeColorMetric,
  theme: GraphTheme,
  options: AssignCategoriesOptions,
): CategoryAssignment {
  const counts = new Map<string, { label: string; count: number }>();
  let noValueCount = 0;

  for (const node of nodes) {
    const ref = nodeCategory(node, metric);
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
    return nodeCategory(node, metric);
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
