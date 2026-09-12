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
import { HOP_EXPANSION_CAP } from "./graphHopFillModel";
import { MAX_HOP_DEPTH, type HopDirection } from "./graphHopModel";

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
  /** The folder's own name; the rail indents the row by `depth`. */
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

export interface ScopeHopsInput {
  direction: HopDirection;
  depth: number;
  enabled: readonly boolean[];
  shownByHop: readonly number[];
  availableByHop: readonly number[];
  /** The parents' reported totals summed per hop, or null when unknown. */
  reportedByHop: readonly (number | null)[];
  /** The hop category colours by hop while the colouring is Citation hop, else null. */
  colours: readonly (string | null)[] | null;
  /** The runner's state, or null while it has nothing to do and nothing waits. */
  fill: { remaining: number; waiting: number; paused: boolean } | null;
}

export interface ScopeHopRow {
  hop: number;
  label: string;
  /** `{shown}/{available}`, the seed count, or `not fetched`. */
  count: string;
  /** `of {reported}` when the parents reported more than is stored. */
  reported: string | null;
  /** The Fetch hop N button sits in this row instead of a count. */
  fetchButton: boolean;
  /** The row carries a checkbox: every hop, never Seeds. */
  checkbox: boolean;
  enabled: boolean;
  /** Past the depth or unticked: drawn at 0.45 opacity, checkbox inert past the depth. */
  dimmed: boolean;
  /** True while the hop is at or below the depth. */
  opened: boolean;
  swatch: string | null;
}

export interface ScopeHopsProgress {
  /** The row the line follows: the deepest open hop. */
  afterHop: number;
  text: string;
  action: "stop" | "resume" | "more";
  actionLabel: "Stop" | "Resume" | "Fetch more";
}

export interface ScopeHopsBlock {
  direction: HopDirection;
  rows: ScopeHopRow[];
  progress: ScopeHopsProgress | null;
}

export interface ScopeRailModel {
  /** `{shown} of {total} papers`, before the search box. */
  countLine: string;
  seedsHeading: string;
  seeds: ScopeSeedRow[];
  rows: ScopeRow[];
  /** `{n} hidden`, or null while nothing is hidden. */
  hiddenLine: string | null;
  /** The Citation hops block, or null on a seedless graph. */
  hops: ScopeHopsBlock | null;
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
  /** The Citation hops block's input, or null/undefined on a seedless graph. */
  hops?: ScopeHopsInput | null;
}

export type ScopeSquareFill = "off" | "on" | "mixed" | "region";

export interface ScopeSquare {
  fill: ScopeSquareFill;
  /** The white dash of a partly shown parent. */
  dash: boolean;
}

/**
 * What the square in front of a row shows (B31). The square is the native
 * checkbox's face: empty when the folder is off, the accent when it is shown,
 * grey with a dash when its descendants disagree. A folder drawn as a region
 * takes its swatch instead of the accent, because the row behind it is
 * already on the selected fill and the square is what tells two regions
 * apart; the dash survives on it, since the swatch says nothing about the
 * subtree.
 */
export function scopeSquare(row: ScopeRow): ScopeSquare {
  const dash = row.state === "mixed";
  if (row.selected && row.color) return { fill: "region", dash };
  if (dash) return { fill: "mixed", dash };
  return { fill: row.state === "on" ? "on" : "off", dash: false };
}

const COUNT_FORMAT = new Intl.NumberFormat(undefined, { useGrouping: true });

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
 * There is no cap (F14, 2026-09-11): a plot that turns to mud under many
 * hulls is something the reader can see and untick, while a folder released
 * silently by a later pick was not.
 */
export function nextRegionSelection(
  current: readonly number[],
  collectionID: number,
): number[] {
  if (current.includes(collectionID)) {
    return current.filter((id) => id !== collectionID);
  }
  return [...current, collectionID];
}

/**
 * The regions whose folder the library still has (backlog B23). A saved
 * graph's `regions` can name a collection deleted since it was saved; such
 * an ID gets no rail row, so no checkbox to untick it with, draws an empty
 * region. It is dropped the
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

export function buildScopeHopsBlock(input: ScopeHopsInput): ScopeHopsBlock {
  const rows: ScopeHopRow[] = [];
  for (let hop = 0; hop <= MAX_HOP_DEPTH; hop += 1) {
    const opened = hop <= input.depth;
    const enabled = hop === 0 ? true : input.enabled[hop] !== false;
    const shown = input.shownByHop[hop] ?? 0;
    const available = input.availableByHop[hop] ?? 0;
    const reported = input.reportedByHop[hop] ?? null;
    rows.push({
      hop,
      label: hop === 0 ? "Seeds" : `Hop ${hop}`,
      count:
        hop === 0
          ? COUNT_FORMAT.format(shown)
          : opened
            ? `${COUNT_FORMAT.format(shown)}/${COUNT_FORMAT.format(available)}`
            : "not fetched",
      reported:
        opened && hop > 0 && reported !== null && reported > available
          ? `of ${COUNT_FORMAT.format(reported)}`
          : null,
      fetchButton: hop === input.depth + 1,
      checkbox: hop > 0,
      enabled,
      dimmed: !opened || !enabled,
      opened,
      swatch: input.colours ? (input.colours[hop] ?? null) : null,
    });
  }
  const fill = input.fill;
  let progress: ScopeHopsProgress | null = null;
  if (fill && (fill.remaining > 0 || fill.waiting > 0)) {
    progress =
      fill.remaining === 0
        ? {
            afterHop: input.depth,
            text: `${COUNT_FORMAT.format(HOP_EXPANSION_CAP)} expanded · ${COUNT_FORMAT.format(fill.waiting)} waiting`,
            action: "more",
            actionLabel: "Fetch more",
          }
        : {
            afterHop: input.depth,
            text: `expanding · ${COUNT_FORMAT.format(fill.remaining)} left`,
            action: fill.paused ? "resume" : "stop",
            actionLabel: fill.paused ? "Resume" : "Stop",
          };
  }
  return { direction: input.direction, rows, progress };
}

export function buildScopeRailModel(input: ScopeRailInput): ScopeRailModel {
  const rows: ScopeRow[] = input.collections.map((collection) => {
    const descendants = descendantsOf(collection);
    const selected = input.regions.includes(collection.collectionID);
    return {
      kind: "collection",
      collectionID: collection.collectionID,
      label: collection.name,
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
    hops: input.hops ? buildScopeHopsBlock(input.hops) : null,
  };
}
