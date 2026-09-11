/**
 * The rows the rail's Scope section draws, as data.
 *
 * Scope is not the Key, and is deliberately not built out of `KeySection`. A
 * Key entry emphasises on hover and carries no state; a Scope row owns a
 * checkbox that changes what is drawn. Putting a filtering control inside the
 * module whose header says it never filters would reverse that decision by
 * accident.
 */
import type { LibraryCollectionFilter } from "../domain/types";
import {
  collectionTickState,
  type CollectionTickState,
  type GraphScopeResult,
  type GraphViewCollectionTicks,
} from "./graphScopeModel";

export interface ScopeSeedRow {
  /** The seed's node key. */
  key: string;
  label: string;
  /** The seed's own colour, so the rail's bullseye and the plot's agree. */
  color: string;
}

export interface ScopeCollectionRow {
  kind: "collection";
  collectionID: number;
  /** Indented by depth, the way the filter popover's list was. */
  label: string;
  depth: number;
  /** That folder's own papers currently in the graph. */
  count: number;
  state: CollectionTickState;
  /** The folder and every descendant: what one toggle writes. */
  cascadeIDs: number[];
  /** Drawn as a region on the plot. */
  selected: boolean;
  /** The folder's colour while it is selected, else null. */
  color: string | null;
}

export interface ScopeToggleRow {
  kind: "unfiled" | "external";
  label: string;
  count: number;
  state: "on" | "off";
  /** Never true: only a folder is drawn as a region. */
  selected: false;
  color: null;
}

export type ScopeRow = ScopeCollectionRow | ScopeToggleRow;

export interface ScopeRailModel {
  /** `{shown} of {total} papers`, before the search box. */
  countLine: string;
  seedsHeading: string;
  seeds: ScopeSeedRow[];
  rows: ScopeRow[];
  /** `{n} hidden`, or null while nothing is hidden. */
  hiddenLine: string | null;
}

export interface ScopeRailInput {
  collections: readonly LibraryCollectionFilter[];
  ticks: GraphViewCollectionTicks;
  includeUnfiled: boolean;
  includeExternal: boolean;
  seeds: readonly ScopeSeedRow[];
  scope: GraphScopeResult;
  /** The folders currently drawn as regions, oldest selection first. */
  regions: readonly number[];
  /** Each selected folder's colour, by collection ID. */
  regionColors: ReadonlyMap<number, string>;
}

const COUNT_FORMAT = new Intl.NumberFormat(undefined, { useGrouping: true });
const INDENT = "    ";

/** The label a Seeds row carries: `Author (year)`, ellipsised by the rail. */
export function seedRowLabel(paper: {
  authors: readonly string[];
  year: number | null;
  title: string;
}): string {
  const first = paper.authors[0]?.trim();
  const surname = first ? (first.split(/\s+/).at(-1) ?? first) : "";
  const name = surname || paper.title.trim() || "Untitled";
  return paper.year === null ? name : `${name} (${paper.year})`;
}

/**
 * The regions after clicking one folder. Selection is a toggle and holds more
 * than one, because seeing two folders' territories at once — where they
 * overlap, which papers sit in neither — is the comparison a hull is best at.
 * Past the cap the oldest selection is released: overlapping translucent
 * hulls stop being readable past a handful.
 */
export function nextRegionSelection(
  current: readonly number[],
  collectionID: number,
  cap: number,
): number[] {
  if (current.includes(collectionID)) {
    return current.filter((id) => id !== collectionID);
  }
  return [...current, collectionID].slice(-cap);
}

/**
 * The regions whose folder the library still has (backlog B23). A saved
 * graph's `regions` can name a collection deleted since it was saved; such
 * an ID gets no rail row, so no checkbox to untick it with, draws an empty
 * region and holds one of the `MAX_GRAPH_REGIONS` slots. It is dropped the
 * moment the library no longer has it, the way `toggleRow` drops an
 * unticked one, and the survivors keep their order.
 */
export function regionsStillInLibrary(
  regions: readonly number[],
  collections: readonly LibraryCollectionFilter[],
): number[] {
  const known = new Set(collections.map((entry) => entry.collectionID));
  return regions.filter((id) => known.has(id));
}

function descendantsOf(collection: LibraryCollectionFilter): number[] {
  // `includedCollectionIDs` is the folder plus its subtree, as the snapshot
  // recorded it; a folder with no children lists only itself.
  return collection.includedCollectionIDs.filter(
    (id) => id !== collection.collectionID,
  );
}

export function buildScopeRailModel(input: ScopeRailInput): ScopeRailModel {
  const rows: ScopeRow[] = input.collections.map((collection) => {
    const descendants = descendantsOf(collection);
    const selected = input.regions.includes(collection.collectionID);
    return {
      kind: "collection",
      collectionID: collection.collectionID,
      label: `${INDENT.repeat(Math.max(0, collection.depth))}${collection.name}`,
      depth: collection.depth,
      count: input.scope.countByCollection.get(collection.collectionID) ?? 0,
      state: collectionTickState(
        input.ticks,
        collection.collectionID,
        descendants,
      ),
      cascadeIDs: [collection.collectionID, ...descendants],
      selected,
      color: selected
        ? (input.regionColors.get(collection.collectionID) ?? null)
        : null,
    };
  });
  // Every paper on the plot answers to exactly one tick the reader can find,
  // which is what makes unticking read as subtraction.
  rows.push({
    kind: "unfiled",
    label: "Unfiled",
    count: input.scope.unfiledCount,
    state: input.includeUnfiled ? "on" : "off",
    selected: false,
    color: null,
  });
  rows.push({
    kind: "external",
    label: "Not in Zotero",
    count: input.scope.externalCount,
    state: input.includeExternal ? "on" : "off",
    selected: false,
    color: null,
  });
  return {
    countLine: `${COUNT_FORMAT.format(input.scope.shown)} of ${COUNT_FORMAT.format(input.scope.total)} papers`,
    seedsHeading: `Seeds · ${COUNT_FORMAT.format(input.seeds.length)}`,
    seeds: input.seeds.map((seed) => ({ ...seed })),
    rows,
    hiddenLine: input.scope.hiddenCount
      ? `${COUNT_FORMAT.format(input.scope.hiddenCount)} hidden`
      : null,
  };
}
