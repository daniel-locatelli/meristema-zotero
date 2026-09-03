/**
 * What the graph is currently saying, as data.
 *
 * The complaint this redesign answers is that the graph encoded four things at
 * once — colour, size, link direction, state — and named none of them. This
 * module is the answer's first half: a description of the active encoding with
 * no DOM in it, which `graphKeyRail.ts` renders and the PNG export can reuse.
 *
 * Two rules shape it. A section for an encoding that is not in use is absent
 * rather than empty, because a Key that lists things the plot is not doing is
 * noise. And an entry that stands for a set of papers carries the predicate
 * that finds them, so hovering it can emphasise exactly those — while an entry
 * that describes *how* the graph draws, like the ramp or a link colour, carries
 * no predicate at all and emphasises nothing.
 */
import type {
  CitationGraphNode,
  GraphLayoutOptions,
  GraphNodeColorMetric,
  MetricID,
} from "../domain/graphTypes";
import type { CategoryAssignment } from "./graphCategoryAssignment";
import { formatMetricValue, getMetricDefinition } from "./metricRegistry";
import { metricExtent, metricNumber } from "./graphMetricScale";
import type { GraphTheme } from "./graphTheme";

/**
 * The names of the colourings that are categories rather than numbers. Shared
 * with the appearance controls so the Key and the dropdown never disagree about
 * what a colouring is called.
 */
export const CATEGORICAL_COLOR_LABELS: Record<string, string> = {
  collection: "Collection",
  "publication-type": "Publication type",
  provider: "Provider",
  "open-access": "Open Access",
  retraction: "Retraction",
};

export function isCategoricalColorMetric(
  metric: GraphNodeColorMetric,
): boolean {
  return metric in CATEGORICAL_COLOR_LABELS;
}

export type KeySectionKind = "color" | "size" | "links" | "states";

export type KeyMarkKind = "swatch" | "ramp" | "circles" | "arrow" | "ring";

export interface KeyMark {
  kind: KeyMarkKind;
  /** The colours the mark paints, in the order it paints them. */
  colors: string[];
  /** Drawn as an outline rather than a fill — the ghosted and no-data marks. */
  dashed?: boolean;
}

export interface KeyEntry {
  /** Stable within its section, so the rail can key its buttons by it. */
  id: string;
  label: string;
  /** How many nodes this entry covers, or null where it counts nothing. */
  count: number | null;
  /** A range or value shown after the label. */
  detail: string | null;
  mark: KeyMark;
  /**
   * The nodes this entry stands for, or null when it stands for none. Null is
   * the difference between "these papers" and "this is how papers are drawn".
   */
  matches: ((node: CitationGraphNode) => boolean) | null;
}

export interface KeySection {
  kind: KeySectionKind;
  heading: string;
  /** The metric the section describes, where it describes one. */
  subheading: string | null;
  entries: KeyEntry[];
  /** A qualification under the entries, such as the split-disc note. */
  note: string | null;
}

export interface KeyModel {
  sections: KeySection[];
}

/**
 * The graph's current state, as far as the Key is concerned. `visibleKeys` is
 * null when nothing is filtered — an empty set would mean the opposite.
 */
export interface KeyStates {
  selectedKey: string | null;
  seedKeys: ReadonlySet<string>;
  searchMatches: ReadonlySet<string> | null;
  visibleKeys: ReadonlySet<string> | null;
}

export interface KeyModelInput {
  layout: GraphLayoutOptions;
  assignment: CategoryAssignment;
  /**
   * The nodes the graph is drawing — the filter's scope, not the whole library.
   *
   * A graph opened on one folder is a library-wide model with a filter over it,
   * so handing the Key every node made it name folders whose papers were not on
   * screen. Everything the Key counts is counted here.
   */
  nodes: CitationGraphNode[];
  /**
   * The nodes the numeric scales were built from, where that is a wider set
   * than `nodes`.
   *
   * The canvas derives its ramp and its radii from the whole model so that
   * filtering moves nothing, which means the ends of a ramp belong to the model
   * and not to the scope. Reading them off `nodes` would print a range the plot
   * is not using. Counts still come from `nodes`: how many papers *on screen*
   * have a value is a fact about the scope.
   */
  scaleNodes?: CitationGraphNode[];
  theme: GraphTheme;
  /** How many links are drawn. Zero means there is no link encoding to name. */
  edgeCount: number;
  states: KeyStates;
}

function metricLabel(metric: GraphNodeColorMetric | MetricID): string {
  return (
    CATEGORICAL_COLOR_LABELS[metric] ??
    getMetricDefinition(metric as MetricID).label
  );
}

/**
 * The ends of the scale, formatted in the metric's own units, and how many of
 * the drawn nodes sit on it. The two come from different sets on purpose — see
 * `scaleNodes` above.
 */
function extentDetail(
  input: KeyModelInput,
  metric: MetricID,
): { detail: string; count: number } | null {
  const extent = metricExtent(input.scaleNodes ?? input.nodes, metric);
  if (!extent) return null;
  const count = input.nodes.filter(
    (node) => metricNumber(node, metric) !== null,
  ).length;
  return {
    detail: `${formatMetricValue(metric, extent[0])} – ${formatMetricValue(metric, extent[1])}`,
    count,
  };
}

function colorSection(input: KeyModelInput): KeySection {
  const { assignment, nodes, theme, layout } = input;
  const metric = layout.nodeColorMetric;
  const heading = "Color";
  const subheading = metricLabel(metric);

  if (!isCategoricalColorMetric(metric)) {
    const entries: KeyEntry[] = [];
    const extent = extentDetail(input, metric as MetricID);
    entries.push({
      id: "ramp",
      // The section's subheading already names the metric; repeating it here
      // pushed the range off the end of the rail. The row carries the ends.
      label: extent?.detail ?? "No values",
      count: extent?.count ?? 0,
      detail: null,
      mark: { kind: "ramp", colors: [...theme.ramp] },
      // A position on a ramp is not a group of papers.
      matches: null,
    });
    const missing = nodes.filter(
      (node) => metricNumber(node, metric as MetricID) === null,
    );
    if (missing.length) {
      entries.push({
        id: "no-value",
        label: "No value",
        count: missing.length,
        detail: null,
        mark: {
          kind: "swatch",
          colors: [theme.categorical.noValue],
          dashed: true,
        },
        matches: (node) => metricNumber(node, metric as MetricID) === null,
      });
    }
    return { kind: "color", heading, subheading, entries, note: null };
  }

  const assignedKeys = new Set(assignment.entries.map((entry) => entry.key));
  const entries: KeyEntry[] = assignment.entries.map((entry) => ({
    id: entry.key,
    label: entry.label,
    count: entry.count,
    detail: null,
    mark: { kind: "swatch", colors: [entry.color] },
    matches: (node) => assignment.keysFor(node).includes(entry.key),
  }));

  if (assignment.other) {
    const other = assignment.other;
    entries.push({
      id: other.key,
      label: other.label,
      count: other.count,
      detail: null,
      mark: { kind: "swatch", colors: [other.color] },
      matches: (node) =>
        assignment.keysFor(node).some((key) => !assignedKeys.has(key)),
    });
  }

  if (assignment.noValue) {
    const noValue = assignment.noValue;
    entries.push({
      id: noValue.key,
      label: noValue.label,
      count: noValue.count,
      detail: null,
      mark: { kind: "swatch", colors: [noValue.color], dashed: true },
      matches: (node) => assignment.keysFor(node).length === 0,
    });
  }

  // The swatch a category gets is decided across the whole graph, so colours do
  // not shuffle as the view changes. The counts are not: they are recounted
  // over the nodes handed in, and a category with nothing left in it is dropped
  // rather than named. "Every colour on screen is named" has to hold in both
  // directions, or the Key starts listing colours that are not there.
  const counted = entries
    .map((entry) => ({
      ...entry,
      count: nodes.filter((node) => entry.matches!(node)).length,
    }))
    .filter((entry) => entry.count > 0);

  // Only worth saying when it is happening: a paper in two folders is drawn as
  // two slices, and without the note its disc looks like a colour of its own.
  const split = nodes.some((node) => assignment.keysFor(node).length > 1);
  return {
    kind: "color",
    heading,
    subheading,
    entries: counted,
    note: split
      ? "A paper in several categories is split between their colours."
      : null,
  };
}

function sizeSection(input: KeyModelInput): KeySection | null {
  const metric = input.layout.nodeSizeMetric;
  if (metric === "uniform") return null;
  const extent = extentDetail(input, metric);
  return {
    kind: "size",
    heading: "Size",
    subheading: metricLabel(metric),
    entries: [
      {
        id: "scale",
        label: extent?.detail ?? "No values",
        count: extent?.count ?? 0,
        detail: null,
        mark: { kind: "circles", colors: [input.theme.inks.muted] },
        matches: null,
      },
    ],
    note: null,
  };
}

function linkSection(input: KeyModelInput): KeySection | null {
  if (input.edgeCount <= 0) return null;
  const edges = input.theme.edges;
  return {
    kind: "links",
    heading: "Links",
    subheading: null,
    entries: [
      {
        id: "link",
        label: "Link",
        count: input.edgeCount,
        detail: null,
        mark: { kind: "arrow", colors: [edges.base] },
        matches: null,
      },
      {
        id: "reference",
        label: "Reference",
        count: null,
        detail: null,
        mark: { kind: "arrow", colors: [edges.outgoing] },
        matches: null,
      },
      {
        id: "cited-by",
        label: "Cited by",
        count: null,
        detail: null,
        mark: { kind: "arrow", colors: [edges.incoming] },
        matches: null,
      },
    ],
    note: null,
  };
}

/** A node parked in an axis lane: the canvas draws it under a NO DATA label. */
function hasNoAxisValue(
  node: CitationGraphNode,
  layout: GraphLayoutOptions,
): boolean {
  for (const axis of [layout.xMetric, layout.yMetric]) {
    if (axis === "free") continue;
    if (metricNumber(node, axis) === null) return true;
  }
  return false;
}

function stateSection(input: KeyModelInput): KeySection | null {
  const { nodes, theme, states, layout } = input;
  const entries: KeyEntry[] = [];
  const ring = (color: string, dashed = false): KeyMark => ({
    kind: "ring",
    colors: [color],
    dashed,
  });

  if (states.selectedKey !== null) {
    const selectedKey = states.selectedKey;
    entries.push({
      id: "selected",
      label: "Selected",
      count: 1,
      detail: null,
      mark: ring(theme.states.selected),
      matches: (node) => node.key === selectedKey,
    });
  }

  const seeds = nodes.filter((node) => states.seedKeys.has(node.key));
  if (seeds.length) {
    entries.push({
      id: "seed",
      label: "Seed",
      count: seeds.length,
      detail: null,
      mark: ring(theme.states.seed),
      matches: (node) => states.seedKeys.has(node.key),
    });
  }

  const searchMatches = states.searchMatches;
  if (searchMatches) {
    const matched = nodes.filter((node) => searchMatches.has(node.key));
    if (matched.length) {
      entries.push({
        id: "search-match",
        label: "Search match",
        count: matched.length,
        detail: null,
        mark: ring(theme.states.searchMatch),
        matches: (node) => searchMatches.has(node.key),
      });
    }
  }

  const retracted = nodes.filter((node) => node.isRetracted === true);
  if (retracted.length) {
    entries.push({
      id: "retracted",
      label: "Retracted",
      count: retracted.length,
      detail: null,
      mark: ring(theme.states.retracted),
      matches: (node) => node.isRetracted === true,
    });
  }

  const visibleKeys = states.visibleKeys;
  if (visibleKeys) {
    const hidden = nodes.filter((node) => !visibleKeys.has(node.key));
    if (hidden.length) {
      entries.push({
        id: "filtered-out",
        label: "Filtered out",
        count: hidden.length,
        detail: null,
        mark: ring(theme.inks.muted, true),
        matches: (node) => !visibleKeys.has(node.key),
      });
    }
  }

  const parked = nodes.filter((node) => hasNoAxisValue(node, layout));
  if (parked.length) {
    entries.push({
      id: "no-data",
      label: "No data",
      count: parked.length,
      detail: null,
      mark: ring(theme.categorical.noValue, true),
      matches: (node) => hasNoAxisValue(node, layout),
    });
  }

  return entries.length
    ? {
        kind: "states",
        heading: "States",
        subheading: null,
        entries,
        note: parked.length
          ? "A paper with no value for an axis is parked in a lane off the plot."
          : null,
      }
    : null;
}

/**
 * The Key for the graph as it currently stands. There is always a colour
 * encoding, so that section is always present; the other three appear only when
 * the graph is using them.
 */
export function buildKeyModel(input: KeyModelInput): KeyModel {
  const sections = [
    colorSection(input),
    sizeSection(input),
    linkSection(input),
    stateSection(input),
  ].filter((section): section is KeySection => section !== null);
  return { sections };
}
