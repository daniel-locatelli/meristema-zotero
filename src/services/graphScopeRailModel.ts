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
import { MAX_HOP_DEPTH, type HopDirection } from "./graphHopModel";
import type { CitationProviderID } from "../domain/citationTypes";
import { citationDataSourceLabel } from "./providerPresentation";
import { AUTOMATIC_RELATIONSHIP_MEMBERSHIP_LIMIT } from "./relationshipRefreshPolicy";
import type { RelationshipCutOrder } from "../providers/types";

export interface ScopeSeedRow {
  /** The seed's node key. */
  key: string;
  label: string;
  /** The seed's own colour, so the rail's bullseye and the plot's agree. */
  color: string;
  /** The seed is the plot's selected node (F11). */
  selected: boolean;
}

/** A seed as the view knows it; the model decides `selected`. */
export type ScopeSeedInput = Omit<ScopeSeedRow, "selected">;

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

export interface ScopeCutInput {
  mostCited: number;
  arrival: number;
  intent: RelationshipCutOrder;
}

export interface ScopeHopsInput {
  direction: HopDirection;
  depth: number;
  enabled: readonly boolean[];
  shownByHop: readonly number[];
  availableByHop: readonly number[];
  /**
   * Per hop, the visible papers one hop up whose list in the direction is
   * stored: the parents the hop came from. Index 0 is 0.
   */
  expandedByHop: readonly number[];
  /** Per hop, whether the plan still holds parents one hop up to expand. */
  growingByHop: readonly boolean[];
  /** Visible papers whose expansion failed in this direction (D12). */
  failed: number;
  /** Visible hop papers drawn without details (`lacksDetails`, D12). */
  lacksDetails: number;
  /** The hop category colours by hop while the colouring is Citation hop, else null. */
  colours: readonly (string | null)[] | null;
  /** The runner's state, or null while it has nothing to do and nothing waits. */
  fill: {
    remaining: number;
    waiting: number;
    paused: boolean;
    /** Papers the deferral limit failed; only Resume brings them back (B72). */
    gaveUp?: number;
    /** Set while the fill cools down: who is refusing, and when it tries again. */
    refusal?: {
      providers: readonly CitationProviderID[];
      retryAt: number;
    } | null;
  } | null;
  /**
   * Per hop: nothing at it is left to expand, waiting on the cap, deferred
   * or failed this session (the runner's `drainedByHop`). Decides whether an
   * empty hop below reads `none yet` or `0/0`.
   */
  drainedByHop: readonly boolean[];
  /** How the shown expanded papers' stored lists were cut, and what the fill would cut in. */
  cut: ScopeCutInput;
}

export interface ScopeHopRow {
  hop: number;
  label: string;
  /** `{shown} papers`, the seed count, `not fetched`, `none yet` or `none found`. */
  count: string;
  /** `from {n}` while some parents one hop up are expanded, else null. */
  from: string | null;
  /** The hop still grows: its parents are in a running plan. */
  spinning: boolean;
  /** Shown and stored at the hop: the row's data attributes, not its text. */
  shown: number;
  available: number;
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
  /** Expanding; cooling down on a refusal; or at rest with something missing. */
  kind: "running" | "refusing" | "rest";
  /** Empty while running: the spinners and `from N` say it. */
  text: string;
  /** At rest only: `{n} without details`, on its own line. */
  details: string | null;
  action: "stop" | "resume" | "more" | null;
  actionLabel: "Stop" | "Resume" | "Fetch more" | null;
  /**
   * Set while the fill cools down. `retryAt` is fixed for the cool-down, so
   * the model does not change from second to second; the rail counts down to
   * it in place.
   */
  countdown: { retryAt: number } | null;
  /** The refusing providers' names, when the line counts them. */
  title: string | null;
  /** The parents still queued while running, else 0: the line's `data-left`. */
  left: number;
}

export interface ScopeHopsBlock {
  direction: HopDirection;
  rows: ScopeHopRow[];
  progress: ScopeHopsProgress | null;
  cutLine: string;
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
  floor: ScopeFloorRow;
  /** The Shared by row, or null with fewer than two seeds. */
  shared: ScopeSharedRow | null;
}

/** The Citation floor row: the field's value and the muted count beside it. */
export interface ScopeFloorRow {
  value: number;
  /** `{n} below`, or `off` while the floor is 0. */
  belowText: string;
}

/** The Shared by row: the field's value, its ceiling, and the count beside it. */
export interface ScopeSharedRow {
  /** Already clamped to 1..max. */
  value: number;
  /** The stored value, unclamped: what a typed number is compared against. */
  stored: number;
  /** The seed count. */
  max: number;
  /** `{n} below`, or `off` while the value is 1. */
  belowText: string;
}

export interface ScopeRailInput {
  collections: readonly LibraryCollectionFilter[];
  ticks: GraphViewCollectionTicks;
  includeUnfiled: boolean;
  includeExternal: boolean;
  seeds: readonly ScopeSeedInput[];
  /** The plot's selected node, which lights its seed row if it is a seed. */
  selectedKey?: string | null;
  scope: GraphScopeResult;
  /** The folders currently drawn as regions, oldest selection first. */
  regions: readonly number[];
  /** Each selected folder's colour, by collection ID. */
  regionColors: ReadonlyMap<number, string>;
  /** The Citation hops block's input, or null on a seedless graph. */
  hops: ScopeHopsInput | null;
  /** The citation floor, 0 when off. */
  floor: number;
  /** The shared rule and the seed count; absent on a seedless graph. */
  shared?: { value: number; seedCount: number };
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

/** The countdown's words: seconds below a minute, then minutes rounded up. */
export function formatRetryIn(ms: number): string {
  const seconds = Math.ceil(Math.max(0, ms) / 1000);
  if (seconds < 60) return `retry in ${seconds} s`;
  return `retry in ${Math.ceil(ms / 60_000)} min`;
}

/**
 * The cut line: how the shown lists were actually cut, never the fill's
 * intent once anything is stored, since a fallback provider cuts in arrival
 * order whatever was asked (spec, "The rail says so").
 */
export function cutLineText(
  cut: ScopeCutInput,
  direction: HopDirection,
): string {
  const limit = COUNT_FORMAT.format(AUTOMATIC_RELATIONSHIP_MEMBERSHIP_LIMIT);
  const word = direction === "cited-by" ? "citers" : "references";
  const total = cut.mostCited + cut.arrival;
  const mostCited = `Top ${limit} ${word} per paper, most cited first`;
  const arrival = `First ${limit} ${word} per paper, in the provider's order`;
  if (total === 0) return cut.intent === "most-cited" ? mostCited : arrival;
  if (cut.arrival === 0) return mostCited;
  if (cut.mostCited === 0) return arrival;
  return `${mostCited} for ${COUNT_FORMAT.format(cut.mostCited)} of ${COUNT_FORMAT.format(total)}`;
}

export function buildScopeHopsBlock(input: ScopeHopsInput): ScopeHopsBlock {
  const rows: ScopeHopRow[] = [];
  // The open hops, and one Fetch row while the deepest holds a paper: hops
  // that cannot exist yet are not drawn (spec, "The rail shows what exists").
  const deepestHasPapers = (input.availableByHop[input.depth] ?? 0) > 0;
  const lastRow = Math.min(
    MAX_HOP_DEPTH,
    deepestHasPapers ? input.depth + 1 : input.depth,
  );
  const emptyWord = input.direction === "cited-by" ? "none yet" : "none found";
  const fill = input.fill;
  const refusal = fill?.refusal ?? null;
  const running =
    fill !== null &&
    fill.remaining > 0 &&
    !fill.paused &&
    !(refusal && refusal.providers.length > 0);
  const papers = (n: number): string =>
    n === 1 ? "1 paper" : `${COUNT_FORMAT.format(n)} papers`;
  for (let hop = 0; hop <= lastRow; hop += 1) {
    const opened = hop <= input.depth;
    const enabled = hop === 0 ? true : input.enabled[hop] !== false;
    const shown = input.shownByHop[hop] ?? 0;
    const available = input.availableByHop[hop] ?? 0;
    const drainedAbove = hop > 0 && input.drainedByHop[hop - 1] === true;
    rows.push({
      hop,
      label: hop === 0 ? "Seeds" : `Hop ${hop}`,
      count:
        hop === 0
          ? COUNT_FORMAT.format(shown)
          : !opened
            ? "not fetched"
            : available === 0 && drainedAbove
              ? emptyWord
              : papers(shown),
      from:
        opened && hop > 0 && (input.expandedByHop[hop] ?? 0) > 0
          ? `from ${COUNT_FORMAT.format(input.expandedByHop[hop] ?? 0)}`
          : null,
      spinning:
        opened && hop > 0 && running && input.growingByHop[hop] === true,
      shown,
      available,
      fetchButton: hop === input.depth + 1,
      checkbox: hop > 0,
      enabled,
      dimmed: !opened || !enabled,
      opened,
      swatch: input.colours ? (input.colours[hop] ?? null) : null,
    });
  }
  let progress: ScopeHopsProgress | null = null;
  if (refusal && refusal.providers.length > 0) {
    // While every candidate refuses, raising the cap would only defer more
    // papers, so the refusal wins over Fetch more (ADR 0013).
    const names = refusal.providers.map((provider) =>
      citationDataSourceLabel(provider),
    );
    progress = {
      afterHop: input.depth,
      kind: "refusing",
      text:
        names.length === 1
          ? `${names[0]} refusing`
          : `${COUNT_FORMAT.format(names.length)} providers refusing`,
      details: null,
      action: "stop",
      actionLabel: "Stop",
      countdown: { retryAt: refusal.retryAt },
      title: names.length === 1 ? null : names.join(", "),
      left: 0,
    };
  } else if (running) {
    progress = {
      afterHop: input.depth,
      kind: "running",
      text: "",
      details: null,
      action: "stop",
      actionLabel: "Stop",
      countdown: null,
      title: null,
      left: fill?.remaining ?? 0,
    };
  } else {
    // At rest: name only what is missing, each with the button that recovers
    // it (D12). A Stop's papers come back with Resume, the cap's with Fetch
    // more, and the deferral limit's with Resume (ADR 0014).
    const stopped = fill?.paused === true && fill.remaining > 0;
    const notExpanded =
      (stopped ? (fill?.remaining ?? 0) : 0) + (fill?.waiting ?? 0);
    const parts: string[] = [];
    if (notExpanded > 0)
      parts.push(`${COUNT_FORMAT.format(notExpanded)} not expanded`);
    if (input.failed > 0)
      parts.push(`${COUNT_FORMAT.format(input.failed)} failed`);
    const details =
      input.lacksDetails > 0
        ? `${COUNT_FORMAT.format(input.lacksDetails)} without details`
        : null;
    const action: ScopeHopsProgress["action"] = stopped
      ? "resume"
      : (fill?.waiting ?? 0) > 0
        ? "more"
        : (fill?.gaveUp ?? 0) > 0
          ? "resume"
          : null;
    if (parts.length || details) {
      progress = {
        afterHop: input.depth,
        kind: "rest",
        text: parts.join(" · "),
        details,
        action,
        actionLabel:
          action === "resume"
            ? "Resume"
            : action === "more"
              ? "Fetch more"
              : null,
        countdown: null,
        title: null,
        left: 0,
      };
    }
  }
  return {
    direction: input.direction,
    rows,
    progress,
    cutLine: cutLineText(input.cut, input.direction),
  };
}

function sharedRow(
  shared: { value: number; seedCount: number },
  below: number,
): ScopeSharedRow {
  const stored = Math.max(1, Math.floor(shared.value));
  const value = Math.min(shared.seedCount, stored);
  return {
    value,
    stored,
    max: shared.seedCount,
    belowText: value >= 2 ? `${COUNT_FORMAT.format(below)} below` : "off",
  };
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
    seeds: input.seeds.map((seed) => ({
      ...seed,
      selected: seed.key === input.selectedKey,
    })),
    rows,
    hiddenLine: input.scope.hiddenCount
      ? `${COUNT_FORMAT.format(input.scope.hiddenCount)} hidden`
      : null,
    hops: input.hops ? buildScopeHopsBlock(input.hops) : null,
    floor: {
      value: input.floor,
      belowText:
        input.floor > 0
          ? `${COUNT_FORMAT.format(input.scope.belowFloorCount)} below`
          : "off",
    },
    shared:
      input.shared && input.shared.seedCount >= 2
        ? sharedRow(input.shared, input.scope.belowSharedCount)
        : null,
  };
}
