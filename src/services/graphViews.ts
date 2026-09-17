import type {
  CitationGraphNode,
  GraphAxisMetric,
  GraphLayoutOptions,
  GraphNodeColorMetric,
  GraphNodeLabelMode,
  GraphNodeSizeMetric,
  GraphScaleType,
  MetricID,
} from "../domain/graphTypes";
import { clampHopDepth, type HopDirection } from "./graphHopModel";
import { normaliseLayoutFor } from "./graphLayoutAvailability";
import { getMetricDefinition } from "./metricRegistry";
import {
  defaultPaperListFilterState,
  type PaperListFilterState,
} from "./paperListViewService";
import type { IconName } from "./uiIconService";

/*
 * D4, graph views. A view is a named
 * bundle of appearance, regions and filters, applied once; it never touches
 * Scope (seeds, ticks). Everything here is pure: the DOM is in
 * graphViewsMenu.ts and the wiring in graphViewService.ts.
 */

export const GRAPH_VIEW_WIRE_VERSION = 1;

export type GraphViewNeeds = "shared-citers" | "reading-state";
export type GraphViewAvailability = "ready" | { needs: GraphViewNeeds };
export type GraphViewRequires = "none" | "seed" | "two-seeds";
/** Folder names, every ticked subtree top, or leave the regions alone. */
export type GraphViewRegions = string[] | "ticked" | null;
/** Scope (`collectionIDs`) and the selection-relative `relation` never travel. */
export type GraphViewFilters = Partial<
  Omit<PaperListFilterState, "collectionIDs" | "relation">
>;

/** Stage 3: the direction and the depth a view opens. Stage 4 adds `floor`. */
export interface GraphViewExplore {
  direction: HopDirection;
  hops: number;
}

export interface GraphViewLiveHops {
  direction: HopDirection;
  depth: number;
  enabled: readonly boolean[];
}

export interface GraphViewDefinition {
  id: string;
  name: string;
  summary: string;
  paragraph: string;
  icon: IconName;
  appearance: GraphLayoutOptions;
  regions: GraphViewRegions;
  filters: GraphViewFilters | null;
  explore: GraphViewExplore | null;
  requires: GraphViewRequires;
  availability: GraphViewAvailability;
}

const BASE: GraphLayoutOptions = {
  xMetric: "year",
  xScale: "linear",
  yMetric: "citations",
  yScale: "linear",
  nodeSizeMetric: "citations",
  nodeColorMetric: "uniform",
  nodeLabelMode: "author-year",
};

export const SHIPPED_GRAPH_VIEWS: readonly GraphViewDefinition[] = [
  {
    id: "overview",
    name: "Overview",
    summary: "Year × citations, uniform fill. Where things are.",
    // draft: reconcile with boards 3a/3b
    paragraph:
      "Every paper by the year it came out and how often it has been cited, all in one colour, so the shape of the field shows before anything else does. Seeds and collections are untouched.",
    icon: "view-overview",
    appearance: { ...BASE },
    regions: null,
    filters: null,
    explore: null,
    requires: "none",
    availability: "ready",
  },
  {
    id: "cornerstones",
    name: "Cornerstones",
    summary:
      "Seeds, 2 hops of references, colour citations. What the field rests on.",
    paragraph:
      "Starts from your seeds and follows their references two steps out, so what remains is the work the field rests on. Colour is citations. Seeds and collections are untouched.",
    icon: "view-cornerstones",
    appearance: { ...BASE, nodeColorMetric: "citations" },
    regions: null,
    filters: null,
    explore: { direction: "references", hops: 2 },
    requires: "seed",
    availability: "ready",
  },
  {
    id: "reading-plan",
    name: "Reading plan",
    summary: "Unread frontier, shape = read state. What to read next.",
    // verbatim from board 3a
    paragraph:
      "Shows the unread papers that your own reading already points at: diamonds are unread, circles read, and only papers cited by at least 3 things you have annotated stay lit. Fill is citations, so the big yellow diamonds are the week's list. Raise N in Filter to shorten it. Seeds and collections are untouched.",
    icon: "view-reading-plan",
    appearance: { ...BASE, nodeColorMetric: "citations" },
    regions: null,
    filters: null,
    explore: null,
    requires: "none",
    availability: { needs: "reading-state" },
  },
  {
    id: "who-cites-whom",
    name: "Who cites whom",
    summary: "Shared citers graded, 1 hop. Bridges between your seeds.",
    // draft: reconcile with boards 3a/3b
    paragraph:
      "One citation step out from each seed, with the papers that cite more than one of your seeds drawn darker, so the bridges between your starting points stand out from the rest. Seeds and collections are untouched.",
    icon: "view-who-cites-whom",
    appearance: { ...BASE },
    regions: null,
    filters: null,
    explore: null,
    requires: "two-seeds",
    availability: { needs: "shared-citers" },
  },
  {
    id: "folder-map",
    name: "Folder map",
    summary: "Free layout, folder regions. How your collections overlap.",
    // draft: reconcile with boards 3a/3b
    paragraph:
      "Lets the papers settle where their citations pull them and draws each of your ticked folders as a region, so the folders that share papers overlap and the ones that do not sit apart. Size is references. Seeds and collections are untouched.",
    icon: "view-folder-map",
    appearance: {
      ...BASE,
      xMetric: "free",
      yMetric: "free",
      nodeSizeMetric: "references",
    },
    regions: "ticked",
    filters: null,
    explore: null,
    requires: "none",
    availability: "ready",
  },
];

export function isShippedViewName(name: string): boolean {
  const wanted = name.trim().toLowerCase();
  return SHIPPED_GRAPH_VIEWS.some((v) => v.name.toLowerCase() === wanted);
}

const NEEDS_LINE: Record<GraphViewNeeds, string> = {
  "shared-citers": "Arrives with shared citers",
  "reading-state": "Arrives with reading state",
};

export function graphViewAvailabilityLine(
  view: GraphViewDefinition,
): string | null {
  return view.availability === "ready"
    ? null
    : NEEDS_LINE[view.availability.needs];
}

export function graphViewRequirementLine(
  view: GraphViewDefinition,
): string | null {
  if (view.requires === "seed") return "needs a seed";
  if (view.requires === "two-seeds") return "needs 2 seeds";
  return null;
}

export function graphViewIsAvailable(view: GraphViewDefinition): boolean {
  return view.availability === "ready";
}

// ---------------------------------------------------------------- regions

export interface ViewFolder {
  collectionID: number;
  name: string;
  parentCollectionID: number | null;
  orderIndex: number;
  ticked: "on" | "off" | "mixed";
}

export interface ResolvedRegions {
  collectionIDs: number[];
  notFound: string[];
  unticked: string[];
  ambiguous: Array<{ name: string; count: number }>;
}

/** Depth-first tree order: parents before children, siblings by orderIndex. */
function treeOrder(folders: readonly ViewFolder[]): ViewFolder[] {
  const byParent = new Map<number | null, ViewFolder[]>();
  for (const f of folders) {
    const list = byParent.get(f.parentCollectionID) ?? [];
    list.push(f);
    byParent.set(f.parentCollectionID, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.orderIndex - b.orderIndex);
  }
  const out: ViewFolder[] = [];
  const visit = (parent: number | null): void => {
    for (const f of byParent.get(parent) ?? []) {
      out.push(f);
      visit(f.collectionID);
    }
  };
  visit(null);
  // Folders whose parent is not in the list (should not happen) go last.
  for (const f of folders) if (!out.includes(f)) out.push(f);
  return out;
}

export function resolveViewRegions(
  regions: GraphViewRegions,
  folders: readonly ViewFolder[],
): ResolvedRegions | null {
  if (regions === null) return null;
  const ordered = treeOrder(folders);
  if (regions === "ticked") {
    const byID = new Map(folders.map((f) => [f.collectionID, f]));
    const hasTickedAncestor = (f: ViewFolder): boolean => {
      let parent = f.parentCollectionID;
      while (parent !== null) {
        const p = byID.get(parent);
        if (!p) return false;
        if (p.ticked !== "off") return true;
        parent = p.parentCollectionID;
      }
      return false;
    };
    return {
      collectionIDs: ordered
        .filter((f) => f.ticked !== "off" && !hasTickedAncestor(f))
        .map((f) => f.collectionID),
      notFound: [],
      unticked: [],
      ambiguous: [],
    };
  }
  const out: ResolvedRegions = {
    collectionIDs: [],
    notFound: [],
    unticked: [],
    ambiguous: [],
  };
  for (const name of regions) {
    const matches = ordered.filter((f) => f.name === name);
    if (!matches.length) {
      out.notFound.push(name);
      continue;
    }
    if (matches.length > 1) out.ambiguous.push({ name, count: matches.length });
    let anyTicked = false;
    for (const f of matches) {
      if (f.ticked === "off") continue;
      anyTicked = true;
      if (!out.collectionIDs.includes(f.collectionID)) {
        out.collectionIDs.push(f.collectionID);
      }
    }
    if (!anyTicked) out.unticked.push(name);
  }
  return out;
}

// ------------------------------------------------------------------ apply

export interface GraphViewApplication {
  layout: GraphLayoutOptions;
  /** null: the view leaves the region list alone. */
  regions: number[] | null;
  filters: PaperListFilterState;
  substituted: Array<keyof GraphLayoutOptions>;
  regionReport: ResolvedRegions | null;
}

export interface GraphViewLiveInput {
  nodes: readonly CitationGraphNode[];
  layout: GraphLayoutOptions;
  filters: PaperListFilterState;
  folders: readonly ViewFolder[];
  hops: GraphViewLiveHops;
}

const LAYOUT_KEYS: ReadonlyArray<keyof GraphLayoutOptions> = [
  "xMetric",
  "xScale",
  "yMetric",
  "yScale",
  "nodeSizeMetric",
  "nodeColorMetric",
  "nodeLabelMode",
];

function mergedFilters(
  live: PaperListFilterState,
  patch: GraphViewFilters | null,
): PaperListFilterState {
  const {
    collectionIDs: _c,
    relation: _r,
    ...rest
  } = (patch ?? {}) as PaperListFilterState;
  return { ...live, ...rest, collectionIDs: [] };
}

export function planGraphView(
  view: GraphViewDefinition,
  input: GraphViewLiveInput,
): GraphViewApplication {
  const layout = normaliseLayoutFor(input.nodes, view.appearance);
  const substituted = LAYOUT_KEYS.filter(
    (key) => layout[key] !== view.appearance[key],
  );
  const regionReport = resolveViewRegions(view.regions, input.folders);
  return {
    layout,
    regions: regionReport ? regionReport.collectionIDs : null,
    filters: mergedFilters(input.filters, view.filters),
    substituted,
    regionReport,
  };
}

function sameIDs(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  return sa.every((v, i) => v === sb[i]);
}

/**
 * The chip's "(edited)": the live settings differ from the view on a field
 * the view owns. Compared after normalising the view for this graph, so a
 * metric the graph lacks does not count as an edit.
 */
export function graphViewIsEdited(
  view: GraphViewDefinition,
  live: GraphViewLiveInput & { regions: readonly number[] },
): boolean {
  const expected = normaliseLayoutFor(live.nodes, view.appearance);
  const liveLayout = normaliseLayoutFor(live.nodes, live.layout);
  if (LAYOUT_KEYS.some((key) => expected[key] !== liveLayout[key])) return true;
  if (view.regions !== null) {
    const resolved = resolveViewRegions(view.regions, live.folders);
    if (resolved && !sameIDs(resolved.collectionIDs, live.regions)) return true;
  }
  if (view.filters !== null) {
    const expectedFilters = mergedFilters(live.filters, view.filters);
    for (const key of Object.keys(view.filters) as Array<
      keyof GraphViewFilters
    >) {
      // These never travel on a view (see GraphViewFilters), but a decoded
      // or persisted view is untrusted input and may still carry them at
      // runtime, so both must be skipped rather than diffed (collectionIDs
      // is also compared by reference here, which would false-positive).
      if (
        (key as string) === "collectionIDs" ||
        (key as string) === "relation"
      ) {
        continue;
      }
      if (expectedFilters[key] !== live.filters[key]) return true;
    }
  }
  if (view.explore !== null) {
    if (live.hops.direction !== view.explore.direction) return true;
    if (live.hops.depth !== view.explore.hops) return true;
    for (let hop = 1; hop <= view.explore.hops; hop += 1) {
      if (live.hops.enabled[hop] === false) return true;
    }
  }
  return false;
}

// ------------------------------------------------------- tutorial copy

function metricWord(metric: string): string {
  if (metric === "free") return "free";
  if (metric === "uniform") return "uniform";
  const special: Record<string, string> = {
    "publication-type": "publication type",
    provider: "provider",
    "open-access": "open access",
    retraction: "retraction",
    "citation-hop": "citation hop",
  };
  if (special[metric]) return special[metric];
  return getMetricDefinition(metric as MetricID).label.toLowerCase();
}

function noDataNote(metric: string): string {
  return ` (no ${metricWord(metric)} data)`;
}

export function tutorialChips(
  view: GraphViewDefinition,
  application: GraphViewApplication,
  swatchCount: number,
): string[] {
  const l = application.layout;
  const a = view.appearance;
  const sub = new Set(application.substituted);
  const chips: string[] = [
    `x ${metricWord(l.xMetric)}${sub.has("xMetric") ? noDataNote(a.xMetric) : ""}`,
    `y ${metricWord(l.yMetric)}${sub.has("yMetric") ? noDataNote(a.yMetric) : ""}`,
    `size ${metricWord(l.nodeSizeMetric)}${sub.has("nodeSizeMetric") ? noDataNote(a.nodeSizeMetric) : ""}`,
    `colour ${metricWord(l.nodeColorMetric)}${sub.has("nodeColorMetric") ? noDataNote(a.nodeColorMetric) : ""}`,
    `labels ${l.nodeLabelMode}`,
  ];
  if (view.explore) {
    chips.push(
      `hops ${view.explore.hops} · ${view.explore.direction === "references" ? "references" : "citers"}`,
    );
  }
  if (application.regions !== null) {
    const n = application.regions.length;
    chips.push(`regions ${n} folder${n === 1 ? "" : "s"}`);
    if (n > swatchCount) chips.push(`${n} regions, ${swatchCount} colours`);
  }
  if (view.filters) {
    for (const [key, value] of Object.entries(view.filters)) {
      const f = filterWord(key as keyof GraphViewFilters, value);
      if (f) chips.push(f);
    }
  }
  return chips;
}

function filterWord(
  key: keyof GraphViewFilters,
  value: unknown,
): string | null {
  switch (key) {
    case "openAccessOnly":
      return value ? "filter open access" : null;
    case "excludeRetracted":
      return value ? "filter no retractions" : null;
    case "yearMin":
      return value === null ? null : `filter from ${String(value)}`;
    case "yearMax":
      return value === null ? null : `filter to ${String(value)}`;
    case "tag":
      return value ? `filter tag ${String(value)}` : null;
    case "itemType":
      return value ? `filter type ${String(value)}` : null;
    // The three missing-value filters default to true (see
    // `defaultPaperListFilterState`), so only a false is worth a chip.
    case "includeMissingYear":
      return value === false ? "filter missing year hidden" : null;
    case "includeMissingCitations":
      return value === false ? "filter missing citations hidden" : null;
    case "includeMissingReferences":
      return value === false ? "filter missing references hidden" : null;
    default:
      return null;
  }
}

/** The last line of the card: what the view did not touch, and what it could not do. */
export function tutorialFootnote(
  application: GraphViewApplication,
  view?: GraphViewDefinition,
): string {
  const parts = ["Seeds and collections are untouched."];
  const r = application.regionReport;
  if (r) {
    if (r.notFound.length) parts.push(`Not found: ${r.notFound.join(", ")}.`);
    if (r.unticked.length) {
      parts.push(
        `Not shown: ${r.unticked.join(", ")} ${r.unticked.length === 1 ? "is" : "are"} unticked.`,
      );
    }
    for (const a of r.ambiguous) parts.push(`${a.name}: ${a.count} folders.`);
  }
  if (view?.explore) {
    parts.push("Opening hops fetches citations from the providers.");
  }
  return parts.join(" ");
}

/** Pre-fills the save panel's "Explain it" from the settings. */
export function draftParagraph(
  layout: GraphLayoutOptions,
  regionCount: number,
  filters: GraphViewFilters,
): string {
  const bits = [
    `${metricWord(layout.xMetric)} across, ${metricWord(layout.yMetric)} up`,
    `size ${metricWord(layout.nodeSizeMetric)}`,
    `colour ${metricWord(layout.nodeColorMetric)}`,
  ];
  if (regionCount)
    bits.push(
      `${regionCount} folder${regionCount === 1 ? "" : "s"} as regions`,
    );
  const f = Object.entries(filters)
    .map(([k, v]) => filterWord(k as keyof GraphViewFilters, v))
    .filter((x): x is string => Boolean(x));
  if (f.length) bits.push(f.join(", "));
  return `${bits.join("; ")}. Seeds and collections are untouched.`;
}

// ---------------------------------------------------------------- wire

interface WireView {
  meristemaView: 1;
  name: string;
  paragraph: string;
  appearance: GraphLayoutOptions;
  regions: string[] | null;
  filters: GraphViewFilters | null;
  explore: GraphViewExplore | null;
}

function userID(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `user:${Date.now().toString(36)}${rand}`;
}

export function encodeGraphView(view: GraphViewDefinition): string {
  const wire: WireView = {
    meristemaView: 1,
    name: view.name,
    paragraph: view.paragraph,
    appearance: { ...view.appearance },
    regions: view.regions === "ticked" ? null : view.regions,
    filters: view.filters ? stripScopeFilters(view.filters) : null,
    explore: view.explore ? { ...view.explore } : null,
  };
  return JSON.stringify(wire, null, 2);
}

function stripScopeFilters(filters: GraphViewFilters): GraphViewFilters {
  const {
    collectionIDs: _c,
    relation: _r,
    ...rest
  } = filters as Record<string, unknown>;
  return rest as GraphViewFilters;
}

const AXIS_METRICS = new Set<string>(["free"]);
const SIZE_METRICS = new Set<string>(["uniform"]);
const COLOUR_METRICS = new Set<string>([
  "uniform",
  "publication-type",
  "provider",
  "open-access",
  "retraction",
  "citation-hop",
]);
const SCALES = new Set<string>(["linear", "log"]);
const LABELS = new Set<string>(["title", "author-year", "none"]);

function isMetricID(value: unknown): value is MetricID {
  if (typeof value !== "string") return false;
  try {
    getMetricDefinition(value as MetricID);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type Decoded =
  { ok: true; view: GraphViewDefinition } | { ok: false; field: string };

export function decodeGraphView(json: string): Decoded {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, field: "json" };
  }
  return decodeGraphViewRecord(raw);
}

export function decodeGraphViewRecord(raw: unknown, id?: string): Decoded {
  if (!isRecord(raw)) return { ok: false, field: "json" };
  if (raw.meristemaView !== GRAPH_VIEW_WIRE_VERSION) {
    return { ok: false, field: "meristemaView" };
  }
  if (typeof raw.name !== "string" || !raw.name.trim()) {
    return { ok: false, field: "name" };
  }
  const paragraph = typeof raw.paragraph === "string" ? raw.paragraph : "";
  const a = raw.appearance;
  if (!isRecord(a)) return { ok: false, field: "appearance" };
  const axis = (v: unknown): v is GraphAxisMetric =>
    AXIS_METRICS.has(v as string) || isMetricID(v);
  if (!axis(a.xMetric)) return { ok: false, field: "appearance.xMetric" };
  if (!SCALES.has(a.xScale as string))
    return { ok: false, field: "appearance.xScale" };
  if (!axis(a.yMetric)) return { ok: false, field: "appearance.yMetric" };
  if (!SCALES.has(a.yScale as string))
    return { ok: false, field: "appearance.yScale" };
  if (!(
    SIZE_METRICS.has(a.nodeSizeMetric as string) || isMetricID(a.nodeSizeMetric)
  )) {
    return { ok: false, field: "appearance.nodeSizeMetric" };
  }
  if (!(
    COLOUR_METRICS.has(a.nodeColorMetric as string) ||
    isMetricID(a.nodeColorMetric)
  )) {
    return { ok: false, field: "appearance.nodeColorMetric" };
  }
  if (!LABELS.has(a.nodeLabelMode as string)) {
    return { ok: false, field: "appearance.nodeLabelMode" };
  }
  const appearance: GraphLayoutOptions = {
    xMetric: a.xMetric,
    xScale: a.xScale as GraphScaleType,
    yMetric: a.yMetric,
    yScale: a.yScale as GraphScaleType,
    nodeSizeMetric: a.nodeSizeMetric as GraphNodeSizeMetric,
    nodeColorMetric: a.nodeColorMetric as GraphNodeColorMetric,
    nodeLabelMode: a.nodeLabelMode as GraphNodeLabelMode,
  };
  let regions: string[] | null = null;
  if (raw.regions !== null && raw.regions !== undefined) {
    if (
      !Array.isArray(raw.regions) ||
      !raw.regions.every((r) => typeof r === "string")
    ) {
      return { ok: false, field: "regions" };
    }
    regions = raw.regions as string[];
  }
  let filters: GraphViewFilters | null = null;
  if (raw.filters !== null && raw.filters !== undefined) {
    if (!isRecord(raw.filters)) return { ok: false, field: "filters" };
    const defaults = defaultPaperListFilterState();
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw.filters)) {
      if (key === "collectionIDs" || key === "relation") {
        return { ok: false, field: `filters.${key}` };
      }
      if (!Object.prototype.hasOwnProperty.call(defaults, key)) {
        return { ok: false, field: `filters.${key}` };
      }
      const fallback = defaults[key as keyof PaperListFilterState];
      const okType =
        key === "yearMin" || key === "yearMax"
          ? value === null || typeof value === "number"
          : key === "tag" || key === "itemType"
            ? value === null || typeof value === "string"
            : typeof value === typeof fallback;
      if (!okType) return { ok: false, field: `filters.${key}` };
      out[key] = value;
    }
    filters = out as GraphViewFilters;
  }
  let explore: GraphViewExplore | null = null;
  if (raw.explore !== undefined && raw.explore !== null) {
    if (!isRecord(raw.explore)) return { ok: false, field: "explore" };
    const direction = raw.explore.direction;
    if (direction !== "cited-by" && direction !== "references") {
      return { ok: false, field: "explore.direction" };
    }
    explore = { direction, hops: clampHopDepth(raw.explore.hops) };
  }
  return {
    ok: true,
    view: {
      id: id ?? userID(),
      name: raw.name.trim(),
      summary: summaryFor(appearance),
      paragraph,
      icon: "view-user",
      appearance,
      regions,
      filters,
      explore,
      requires: "none",
      availability: "ready",
    },
  };
}

function summaryFor(layout: GraphLayoutOptions): string {
  return `${capitalise(metricWord(layout.xMetric))} × ${metricWord(layout.yMetric)}, ${metricWord(layout.nodeColorMetric)}.`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export interface CaptureInput {
  name: string;
  paragraph: string;
  layout: GraphLayoutOptions;
  regions: readonly number[];
  filters: PaperListFilterState;
  folders: readonly ViewFolder[];
  hops: GraphViewLiveHops;
}

/** A saved view is a snapshot: it always owns regions (by name) and filters. */
export function captureGraphView(input: CaptureInput): GraphViewDefinition {
  const byID = new Map(input.folders.map((f) => [f.collectionID, f.name]));
  const regions = input.regions
    .map((id) => byID.get(id))
    .filter((name): name is string => typeof name === "string");
  return {
    id: userID(),
    name: input.name.trim(),
    summary: summaryFor(input.layout),
    paragraph: input.paragraph.trim(),
    icon: "view-user",
    appearance: { ...input.layout },
    regions,
    filters: stripScopeFilters(input.filters),
    explore: { direction: input.hops.direction, hops: input.hops.depth },
    requires: "none",
    availability: "ready",
  };
}
