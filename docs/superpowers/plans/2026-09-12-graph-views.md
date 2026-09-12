# Graph Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five named views (Overview, Cornerstones, Reading plan, Who cites whom, Folder map) a reader applies in one click from a View chip in the plot toolbar, with a tutorial card, a gallery on first open, and saved views shared as JSON.

**Architecture:** A view is a patch applied once through the setters that already exist (the gear's `appearance.setLayout`, the region list, the filter controller); the saved graph records only the active view's id in a new version 4 field. Every rule is a pure function in `src/services/graphViews.ts` with unit tests; `graphViewService.ts` gains the chip, the card, the gallery and the save panel as DOM built the way the File menu and the gear panel are built.

**Tech Stack:** TypeScript, Zotero 7 plugin (zotero-plugin-scaffold), `node:test` + chai for unit tests, the plugin's Zotero suite (`npm test`, launches Zotero) for UI paths.

Spec: `docs/superpowers/specs/2026-09-12-graph-views-design.md`. Read it once before starting; each task below names the section it implements.

## Global Constraints

- Colour literals only in `src/services/graphTheme.ts`; CSS in `addon/content/graph.css`, never inline (memory: design-canvas rule). Icons are drawn paths in `src/services/uiIconService.ts`, never typed glyphs.
- `npm run check` (prettier, eslint, tsc for `src` and `test`, 423+ unit cases) must be green at every commit. Run a single unit file with `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/<file>.test.ts`.
- The Zotero suite (`npm test`) may be run by the agent; it launches Zotero, takes minutes, and deletes `.scaffold/build/meristema.xpi`. Never stop a running Zotero or the user's `zotero-plugin serve`. Run `npm run build` last.
- The Zotero test bundle is a second copy of the plugin: tests drive the plugin's own menus and read the rendered DOM; stubs on `Services` are made by redefining the property.
- Every user-visible string in this plan is final copy unless marked `draft`; four tutorial paragraphs are `draft` until the Claude Design handoff package `design_handoff_feature_artboards` is in `docs/`.
- Commit messages end with the two attribution lines given in the session's system reminder.
- A view never writes seeds, ticks, `includeUnfiled`, `includeExternal` or `hiddenKeys`. `filters.collectionIDs` stays `[]`.

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/services/graphViewState.ts` (modify) | Version 4: the `view` field; the parser keeps version 3 regions |
| `src/services/graphLayoutAvailability.ts` (create) | `metricHasData` (moved out of the controls) and `normaliseLayoutFor`: which metrics this graph can show |
| `src/services/graphViewControls.ts` (modify) | Imports `metricHasData` from the new file; nothing else |
| `src/services/graphViews.ts` (create) | The view type, the five shipped views, region resolution, apply, "(edited)", the wire codec, the availability line, tutorial chips. Pure. |
| `src/services/graphViewsStore.ts` (create) | The two profile preferences: saved views, dismissed tutorials |
| `src/services/graphViewsMenu.ts` (create) | DOM for the chip + dropdown, the tutorial card, the gallery, the save panel. Takes callbacks; no graph state. |
| `src/services/graphViewService.ts` (modify) | Wires the menu into the toolbar, applies a view, plumbs `view` through `getState`/`applyState` |
| `src/services/exportService.ts` (modify) | `chooseOpenPath` beside `chooseSavePath` |
| `src/services/uiIconService.ts` (modify) | Six icon names: `view`, `view-overview`, `view-cornerstones`, `view-reading-plan`, `view-who-cites-whom`, `view-folder-map`, `view-user` |
| `addon/content/graph.css` (modify) | Chip, dropdown rows, card, gallery, save panel |
| `test/unit/graphViewState.test.ts` (modify) | Version 3 keeps regions; version 4 round-trips `view` |
| `test/unit/graphLayoutAvailability.test.ts` (create) | Normalisation reproduces the gear's substitutions |
| `test/unit/graphViews.test.ts` (create) | Everything pure in `graphViews.ts` |
| `test/unit/graphViewsStore.test.ts` (create) | Preferences parse-or-empty |
| `test/zotero/graphViews.test.ts` (create) | Chip, gallery, save, greyed row, reopen |
| `docs/superpowers/handoffs/2026-09-08-roadmap.md` (modify) | Tick D4, manual batch, Log |

---

### Task 1: Version 4 of the graph state carries the active view

**Spec:** "The active view, in the graph state".

**Files:**
- Modify: `src/services/graphViewState.ts` (the `GraphViewState` interface near line 53, `GRAPH_VIEW_STATE_VERSION` at line 35, `emptyGraphViewState` at line 119, `parseGraphViewState` at line 427)
- Test: `test/unit/graphViewState.test.ts`

**Interfaces:**
- Produces: `export type GraphViewRef = { id: string } | "blank" | null;` and `GraphViewState.view: GraphViewRef`. `GRAPH_VIEW_STATE_VERSION` becomes `4`.

- [ ] **Step 1: Write the failing tests**

Append to `test/unit/graphViewState.test.ts`, inside the existing top-level `describe` (find the `it("gives a version 2 whole-library graph no regions"` case and add after that block):

```ts
  it("keeps a version 3 record's regions and ledgers", function () {
    // Bumping the version constant must not send a version 3 graph through
    // the version 2 migration, which discards regions and rebuilds them from
    // the ticks.
    const v3 = {
      ...emptyGraphViewState(),
      version: 3,
      collections: { base: "none", except: [4, 12] },
      regions: [12],
      swatches: { assigned: { "12": 3 }, releasedOrder: [] },
      seedSwatches: { assigned: { "k1": 1 }, releasedOrder: [] },
      categorySwatches: { assigned: { article: 0 }, releasedOrder: [] },
    };
    const parsed = parseGraphViewState(JSON.stringify(v3));
    expect(parsed?.version).to.equal(GRAPH_VIEW_STATE_VERSION);
    expect(parsed?.regions).to.deep.equal([12]);
    expect(parsed?.swatches.assigned).to.deep.equal({ "12": 3 });
    expect(parsed?.seedSwatches.assigned).to.deep.equal({ k1: 1 });
    expect(parsed?.categorySwatches.assigned).to.deep.equal({ article: 0 });
    expect(parsed?.view).to.equal(null);
  });

  it("round-trips the active view in version 4", function () {
    for (const view of [null, "blank", { id: "overview" }] as const) {
      const state = { ...emptyGraphViewState(), view };
      const parsed = parseGraphViewState(serializeGraphViewState(state));
      expect(parsed?.view, JSON.stringify(view)).to.deep.equal(view);
    }
  });

  it("parses a malformed view as never chosen", function () {
    for (const view of [42, "other", { id: 7 }, { name: "x" }]) {
      const parsed = parseGraphViewState(
        JSON.stringify({ ...emptyGraphViewState(), view }),
      );
      expect(parsed?.view, JSON.stringify(view)).to.equal(null);
    }
  });
```

- [ ] **Step 2: Run the file to see the three cases fail**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/graphViewState.test.ts`
Expected: the three new cases fail (`view` is undefined; version 3 is rejected once the constant moves).

- [ ] **Step 3: Implement**

In `src/services/graphViewState.ts`:

```ts
export const GRAPH_VIEW_STATE_VERSION = 4;

/**
 * Which view (D4) the graph is on. `null` is "never chosen", which shows
 * the gallery; `"blank"` is the reader's Start blank; otherwise the id of a
 * shipped view or of a saved one (`user:…`). "(edited)" is never stored: the
 * chip recomputes it by comparing the live settings with the view.
 */
export type GraphViewRef = { id: string } | "blank" | null;
```

Add to the `GraphViewState` interface, after `title`:

```ts
  view: GraphViewRef;
```

Add to `emptyGraphViewState()` return, after `title: null,`:

```ts
    view: null,
```

Add a parser near `parseCamera`:

```ts
function parseViewRef(value: unknown): GraphViewRef {
  if (value === "blank") return "blank";
  if (isRecord(value) && typeof value.id === "string" && value.id.trim()) {
    return { id: value.id };
  }
  return null;
}
```

In `parseGraphViewState`, change the version gate and the regions branch:

```ts
  if (
    raw.version !== GRAPH_VIEW_STATE_VERSION &&
    raw.version !== 3 &&
    raw.version !== 2 &&
    raw.version !== 1
  ) {
    return null;
  }
  ...
  // Regions have been stored since version 3; older records rebuild them
  // from the ticks. Version 4 only added `view`.
  const regions =
    typeof raw.version === "number" && raw.version >= 3
      ? normalizedRegions(raw.regions)
      : migratedRegions(scope.collections);
```

And add to the returned object, after `title`:

```ts
    view: parseViewRef(raw.view),
```

- [ ] **Step 4: Run the file, then the whole check**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/graphViewState.test.ts`
Expected: all pass. Then `npm run check` — expected green. If `tsc` reports a missing `view` in an object literal typed `GraphViewState` (search `test/` and `src/` for literals built without the spread of `emptyGraphViewState()`), add `view: null` there.

- [ ] **Step 5: Commit**

```bash
git add src/services/graphViewState.ts test/unit/graphViewState.test.ts
git commit -m "D4: graph state version 4 carries the active view; version 3 keeps its regions"
```

---

### Task 2: Which metrics this graph can show, as one pure function

**Spec:** "Metrics the graph cannot show".

**Files:**
- Create: `src/services/graphLayoutAvailability.ts`
- Modify: `src/services/graphViewControls.ts` (delete `metricHasData` at lines 226-235; import it)
- Test: `test/unit/graphLayoutAvailability.test.ts`

**Interfaces:**
- Produces: `metricHasData(nodes: CitationGraphNode[], metric: MetricID): boolean` and `normaliseLayoutFor(nodes: readonly CitationGraphNode[], layout: GraphLayoutOptions): GraphLayoutOptions`.

- [ ] **Step 1: Write the failing test**

Create `test/unit/graphLayoutAvailability.test.ts`:

```ts
import { describe, it } from "node:test";
import { expect } from "chai";
import type { CitationGraphNode } from "../../src/domain/graphTypes";
import { normaliseLayoutFor } from "../../src/services/graphLayoutAvailability";

function node(overrides: Partial<CitationGraphNode>): CitationGraphNode {
  return {
    key: "k",
    itemID: 1,
    itemKey: "K",
    title: "t",
    authors: [],
    year: 2020,
    citationCount: null,
    referenceCount: null,
    collectionIDs: [],
    provider: null,
    publicationType: null,
    ...overrides,
  } as CitationGraphNode;
}

const layout = {
  xMetric: "year",
  xScale: "log",
  yMetric: "citations",
  yScale: "log",
  nodeSizeMetric: "citations",
  nodeColorMetric: "citations",
  nodeLabelMode: "author-year",
} as const;

describe("normaliseLayoutFor", function () {
  it("keeps every field the graph can show", function () {
    const nodes = [node({ citationCount: 10 })];
    expect(normaliseLayoutFor(nodes, layout)).to.deep.equal({
      ...layout,
      xScale: "linear", // year is not logarithmic
    });
  });

  it("substitutes the first available metric when the graph lacks one", function () {
    const nodes = [node({ citationCount: null, referenceCount: 3 })];
    const out = normaliseLayoutFor(nodes, layout);
    expect(out.yMetric).to.not.equal("citations");
    expect(out.nodeSizeMetric).to.not.equal("citations");
    expect(out.nodeColorMetric).to.not.equal("citations");
  });

  it("forces a free axis to linear and keeps log where the metric allows it", function () {
    const nodes = [node({ citationCount: 10 })];
    const out = normaliseLayoutFor(nodes, { ...layout, xMetric: "free" });
    expect(out.xScale).to.equal("linear");
    expect(out.yScale).to.equal("log");
  });

  it("is idempotent", function () {
    const nodes = [node({ citationCount: null, referenceCount: 3 })];
    const once = normaliseLayoutFor(nodes, layout);
    expect(normaliseLayoutFor(nodes, once)).to.deep.equal(once);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/graphLayoutAvailability.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Create `src/services/graphLayoutAvailability.ts`:

```ts
import type {
  CitationGraphNode,
  GraphAxisMetric,
  GraphLayoutOptions,
  GraphNodeColorMetric,
  GraphNodeSizeMetric,
  MetricID,
} from "../domain/graphTypes";
import {
  axisMetricDefinitions,
  getMetricDefinition,
  metricValue,
  nodeColorMetricDefinitions,
  nodeSizeMetricDefinitions,
} from "./metricRegistry";

/**
 * The gear's selects list only metrics with data in the loaded nodes, and a
 * view is applied and compared by the same rule (spec, "Metrics the graph
 * cannot show"), so the rule lives here once.
 */
export function metricHasData(
  nodes: readonly CitationGraphNode[],
  metric: MetricID,
): boolean {
  // Focus projections derive this metric after the appearance controls are
  // created, so it must remain selectable even when the initial library graph
  // has no precise publication dates.
  if (metric === "citation-sequence") return true;
  return nodes.some((node) => {
    const value = metricValue(node, metric);
    return typeof value === "number" && Number.isFinite(value);
  });
}

const NON_METRIC_COLOURS = new Set<string>([
  "uniform",
  "publication-type",
  "provider",
  "open-access",
  "retraction",
]);

function firstAvailable<T extends string>(
  nodes: readonly CitationGraphNode[],
  requested: T,
  candidates: readonly { id: MetricID }[],
  passthrough: (value: T) => boolean,
): T {
  if (passthrough(requested)) return requested;
  if (metricHasData(nodes, requested as MetricID)) return requested;
  const fallback = candidates.find((c) => metricHasData(nodes, c.id));
  return (fallback?.id ?? requested) as T;
}

/**
 * What the gear would land on if asked for `layout` on this graph: a metric
 * with no data becomes the first that has some, a scale goes linear where
 * the metric is not logarithmic, and a free axis is always linear.
 */
export function normaliseLayoutFor(
  nodes: readonly CitationGraphNode[],
  layout: GraphLayoutOptions,
): GraphLayoutOptions {
  const axes = axisMetricDefinitions();
  const xMetric = firstAvailable<GraphAxisMetric>(
    nodes,
    layout.xMetric,
    axes,
    (v) => v === "free",
  );
  const yMetric = firstAvailable<GraphAxisMetric>(
    nodes,
    layout.yMetric,
    axes,
    (v) => v === "free",
  );
  const scaleFor = (
    metric: GraphAxisMetric,
    scale: GraphLayoutOptions["xScale"],
  ): GraphLayoutOptions["xScale"] =>
    metric !== "free" &&
    scale === "log" &&
    getMetricDefinition(metric).graph.logarithmic
      ? "log"
      : "linear";
  return {
    xMetric,
    xScale: scaleFor(xMetric, layout.xScale),
    yMetric,
    yScale: scaleFor(yMetric, layout.yScale),
    nodeSizeMetric: firstAvailable<GraphNodeSizeMetric>(
      nodes,
      layout.nodeSizeMetric,
      nodeSizeMetricDefinitions(),
      (v) => v === "uniform",
    ),
    nodeColorMetric: firstAvailable<GraphNodeColorMetric>(
      nodes,
      layout.nodeColorMetric,
      nodeColorMetricDefinitions(),
      (v) => NON_METRIC_COLOURS.has(v),
    ),
    nodeLabelMode: layout.nodeLabelMode,
  };
}
```

Check the three definition helpers exist in `src/services/metricRegistry.ts` (`grep -n "export function axisMetricDefinitions\|nodeSizeMetricDefinitions\|nodeColorMetricDefinitions" src/services/metricRegistry.ts`); `graphViewControls.ts` line 19-22 imports them from there, so they do. If `nodeColorMetricDefinitions` returns non-metric entries (uniform, provider…) with an `id` that is not a `MetricID`, filter them in `normaliseLayoutFor` with `NON_METRIC_COLOURS` before calling `metricHasData`: `candidates.filter((c) => !NON_METRIC_COLOURS.has(c.id))`.

In `src/services/graphViewControls.ts`: delete the local `metricHasData` function (lines 226-235) and add to the imports:

```ts
import { metricHasData } from "./graphLayoutAvailability";
```

- [ ] **Step 4: Run the file, then the whole check**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/graphLayoutAvailability.test.ts` — expected PASS. Then `npm run check` — expected green (the controls file compiles with the import).

- [ ] **Step 5: Commit**

```bash
git add src/services/graphLayoutAvailability.ts src/services/graphViewControls.ts test/unit/graphLayoutAvailability.test.ts
git commit -m "D4: the gear's metric availability rule as one pure function"
```

---

### Task 3: The view model, the five shipped views, and the pure rules

**Spec:** "A view definition", "The five shipped views", "JSON on the wire", "Applying a view" (the pure half), "Tutorial card" (the chips).

**Files:**
- Create: `src/services/graphViews.ts`
- Test: `test/unit/graphViews.test.ts`

**Interfaces (produced, used by Tasks 4 to 9):**

```ts
export type GraphViewNeeds = "citation-hops" | "shared-citers" | "reading-state";
export type GraphViewAvailability = "ready" | { needs: GraphViewNeeds };
export type GraphViewRequires = "none" | "seed" | "two-seeds";
export type GraphViewRegions = string[] | "ticked" | null;
export type GraphViewFilters = Partial<Omit<PaperListFilterState, "collectionIDs" | "relation">>;
export interface GraphViewDefinition { id; name; summary; paragraph; icon: IconName; appearance: GraphLayoutOptions; regions: GraphViewRegions; filters: GraphViewFilters | null; explore: null; requires; availability }
export const SHIPPED_GRAPH_VIEWS: readonly GraphViewDefinition[];
export function isShippedViewName(name: string): boolean;
export function graphViewAvailabilityLine(view): string | null;   // "Arrives with citation hops"
export function graphViewRequirementLine(view): string | null;    // "needs a seed"
export interface ViewFolder { collectionID: number; name: string; parentCollectionID: number | null; orderIndex: number; ticked: "on" | "off" | "mixed" }
export interface ResolvedRegions { collectionIDs: number[]; notFound: string[]; unticked: string[]; ambiguous: Array<{ name: string; count: number }> }
export function resolveViewRegions(regions: GraphViewRegions, folders: readonly ViewFolder[]): ResolvedRegions | null;
export interface GraphViewApplication { layout: GraphLayoutOptions; regions: number[] | null; filters: PaperListFilterState; substituted: Array<keyof GraphLayoutOptions>; regionReport: ResolvedRegions | null }
export function planGraphView(view, input: { nodes; layout; filters; folders }): GraphViewApplication;
export function graphViewIsEdited(view, live: { layout; regions: number[]; filters; folders; nodes }): boolean;
export function tutorialChips(view, application, swatchCount: number): string[];
export function encodeGraphView(view): string;
export function decodeGraphView(json: string): { ok: true; view: GraphViewDefinition } | { ok: false; field: string };
export function captureGraphView(input: { name; paragraph; layout; regions: number[]; filters; folders }): GraphViewDefinition;
export function draftParagraph(layout, regionCount: number, filters): string;
```

- [ ] **Step 1: Write the failing tests**

Create `test/unit/graphViews.test.ts`:

```ts
import { describe, it } from "node:test";
import { expect } from "chai";
import type { CitationGraphNode } from "../../src/domain/graphTypes";
import { defaultPaperListFilterState } from "../../src/services/paperListViewService";
import {
  captureGraphView,
  decodeGraphView,
  encodeGraphView,
  graphViewAvailabilityLine,
  graphViewIsEdited,
  graphViewRequirementLine,
  isShippedViewName,
  planGraphView,
  resolveViewRegions,
  SHIPPED_GRAPH_VIEWS,
  tutorialChips,
  type GraphViewDefinition,
  type ViewFolder,
} from "../../src/services/graphViews";

function node(overrides: Partial<CitationGraphNode>): CitationGraphNode {
  return {
    key: "k",
    itemID: 1,
    itemKey: "K",
    title: "t",
    authors: [],
    year: 2020,
    citationCount: 4,
    referenceCount: 9,
    collectionIDs: [],
    provider: null,
    publicationType: null,
    ...overrides,
  } as CitationGraphNode;
}

const nodes = [node({ key: "a" }), node({ key: "b", citationCount: 40 })];

const folders: ViewFolder[] = [
  { collectionID: 1, name: "Timber", parentCollectionID: null, orderIndex: 0, ticked: "on" },
  { collectionID: 2, name: "Gridshells", parentCollectionID: 1, orderIndex: 0, ticked: "on" },
  { collectionID: 3, name: "Archive", parentCollectionID: null, orderIndex: 1, ticked: "off" },
  { collectionID: 4, name: "To read", parentCollectionID: null, orderIndex: 2, ticked: "mixed" },
  { collectionID: 5, name: "Old", parentCollectionID: 4, orderIndex: 0, ticked: "on" },
  { collectionID: 6, name: "To read", parentCollectionID: null, orderIndex: 3, ticked: "off" },
];

const overview = SHIPPED_GRAPH_VIEWS.find((v) => v.id === "overview")!;
const folderMap = SHIPPED_GRAPH_VIEWS.find((v) => v.id === "folder-map")!;

const liveLayout = {
  xMetric: "year",
  xScale: "linear",
  yMetric: "citations",
  yScale: "linear",
  nodeSizeMetric: "citations",
  nodeColorMetric: "uniform",
  nodeLabelMode: "author-year",
} as const;

describe("the shipped views", function () {
  it("are five, with unique ids and full appearance records", function () {
    expect(SHIPPED_GRAPH_VIEWS.map((v) => v.id)).to.deep.equal([
      "overview",
      "cornerstones",
      "reading-plan",
      "who-cites-whom",
      "folder-map",
    ]);
    for (const view of SHIPPED_GRAPH_VIEWS) {
      expect(Object.keys(view.appearance).sort(), view.id).to.deep.equal([
        "nodeColorMetric",
        "nodeLabelMode",
        "nodeSizeMetric",
        "xMetric",
        "xScale",
        "yMetric",
        "yScale",
      ]);
      expect(view.explore, view.id).to.equal(null);
    }
  });

  it("names what a greyed view waits on, and what a view needs", function () {
    expect(graphViewAvailabilityLine(overview)).to.equal(null);
    expect(
      graphViewAvailabilityLine(
        SHIPPED_GRAPH_VIEWS.find((v) => v.id === "cornerstones")!,
      ),
    ).to.equal("Arrives with citation hops");
    expect(
      graphViewAvailabilityLine(
        SHIPPED_GRAPH_VIEWS.find((v) => v.id === "reading-plan")!,
      ),
    ).to.equal("Arrives with reading state");
    expect(
      graphViewAvailabilityLine(
        SHIPPED_GRAPH_VIEWS.find((v) => v.id === "who-cites-whom")!,
      ),
    ).to.equal("Arrives with shared citers");
    expect(graphViewRequirementLine(overview)).to.equal(null);
    expect(
      graphViewRequirementLine(
        SHIPPED_GRAPH_VIEWS.find((v) => v.id === "who-cites-whom")!,
      ),
    ).to.equal("needs 2 seeds");
    expect(isShippedViewName("overview")).to.equal(true);
    expect(isShippedViewName("Thesis")).to.equal(false);
  });
});

describe("resolveViewRegions", function () {
  it("leaves regions alone for null", function () {
    expect(resolveViewRegions(null, folders)).to.equal(null);
  });

  it("resolves names, skips unknown and unticked ones, counts ambiguous ones", function () {
    const out = resolveViewRegions(
      ["Gridshells", "Nope", "To read", "Archive"],
      folders,
    )!;
    // "To read" is two folders: 4 is mixed (kept), 6 is unticked (skipped);
    // a name counts as unticked only when every match is.
    expect(out.collectionIDs).to.deep.equal([2, 4]);
    expect(out.notFound).to.deep.equal(["Nope"]);
    expect(out.unticked).to.deep.equal(["Archive"]);
    expect(out.ambiguous).to.deep.equal([{ name: "To read", count: 2 }]);
  });

  it("takes the top of each ticked subtree for \"ticked\", in tree order", function () {
    const out = resolveViewRegions("ticked", folders)!;
    // 1 (on, top) covers 2; 3 and 6 are off; 4 (mixed, top) covers 5.
    expect(out.collectionIDs).to.deep.equal([1, 4]);
    expect(out.notFound).to.deep.equal([]);
  });
});

describe("planGraphView", function () {
  const filters = defaultPaperListFilterState();

  it("applies Overview: appearance whole, regions and filters untouched", function () {
    const plan = planGraphView(overview, {
      nodes,
      layout: { ...liveLayout, xScale: "log" },
      filters: { ...filters, collectionIDs: [9], openAccessOnly: true },
      folders,
    });
    expect(plan.layout).to.deep.equal(overview.appearance);
    expect(plan.regions).to.equal(null);
    expect(plan.filters.openAccessOnly).to.equal(true);
    expect(plan.filters.collectionIDs).to.deep.equal([]);
    expect(plan.substituted).to.deep.equal([]);
  });

  it("reports the fields it had to substitute", function () {
    const plan = planGraphView(overview, {
      nodes: [node({ citationCount: null })],
      layout: liveLayout,
      filters,
      folders,
    });
    expect(plan.substituted).to.include("yMetric");
    expect(plan.substituted).to.include("nodeSizeMetric");
  });

  it("resolves Folder map's regions and never carries collectionIDs", function () {
    const plan = planGraphView(folderMap, {
      nodes,
      layout: liveLayout,
      filters: { ...filters, collectionIDs: [9] },
      folders,
    });
    expect(plan.regions).to.deep.equal([1, 4]);
    expect(plan.filters.collectionIDs).to.deep.equal([]);
  });
});

describe("graphViewIsEdited", function () {
  const filters = defaultPaperListFilterState();
  it("is false right after apply, even with a substituted metric", function () {
    const poor = [node({ citationCount: null })];
    const plan = planGraphView(overview, { nodes: poor, layout: liveLayout, filters, folders });
    expect(
      graphViewIsEdited(overview, {
        layout: plan.layout,
        regions: [2],
        filters,
        folders,
        nodes: poor,
      }),
    ).to.equal(false);
  });

  it("is true once an owned field changes, and ignores regions the view does not own", function () {
    expect(
      graphViewIsEdited(overview, {
        layout: { ...overview.appearance, nodeColorMetric: "citations" },
        regions: [],
        filters,
        folders,
        nodes,
      }),
    ).to.equal(true);
    expect(
      graphViewIsEdited(overview, {
        layout: overview.appearance,
        regions: [1, 2, 3],
        filters,
        folders,
        nodes,
      }),
    ).to.equal(false);
  });

  it("compares owned regions by resolved id", function () {
    const saved: GraphViewDefinition = {
      ...overview,
      id: "user:1",
      regions: ["Gridshells"],
      filters: { ...filters },
    };
    const live = { layout: overview.appearance, filters, folders, nodes };
    expect(graphViewIsEdited(saved, { ...live, regions: [2] })).to.equal(false);
    expect(graphViewIsEdited(saved, { ...live, regions: [] })).to.equal(true);
  });
});

describe("the wire form", function () {
  it("round-trips a saved view and drops what is not on the wire", function () {
    const saved = captureGraphView({
      name: "Thesis ch. 2 figure",
      paragraph: "Year × references.",
      layout: { ...liveLayout, yMetric: "references" },
      regions: [2],
      filters: { ...defaultPaperListFilterState(), collectionIDs: [2], relation: "related" },
      folders,
    });
    expect(saved.id.startsWith("user:")).to.equal(true);
    expect(saved.regions).to.deep.equal(["Gridshells"]);
    const json = encodeGraphView(saved);
    const parsed = JSON.parse(json);
    expect(parsed.meristemaView).to.equal(1);
    expect(parsed).to.not.have.property("id");
    expect(parsed.filters).to.not.have.property("collectionIDs");
    expect(parsed.filters).to.not.have.property("relation");
    const back = decodeGraphView(json);
    expect(back.ok).to.equal(true);
    if (back.ok) {
      expect(back.view.name).to.equal("Thesis ch. 2 figure");
      expect(back.view.appearance).to.deep.equal(saved.appearance);
      expect(back.view.regions).to.deep.equal(["Gridshells"]);
      expect(back.view.id).to.not.equal(saved.id);
      expect(back.view.availability).to.equal("ready");
    }
  });

  it("names the first failing field", function () {
    const good = JSON.parse(encodeGraphView(captureGraphView({
      name: "n", paragraph: "p", layout: liveLayout, regions: [], filters: defaultPaperListFilterState(), folders,
    })));
    const cases: Array<[string, unknown]> = [
      ["meristemaView", { ...good, meristemaView: 2 }],
      ["name", { ...good, name: "" }],
      ["appearance.xMetric", { ...good, appearance: { ...good.appearance, xMetric: "bogus" } }],
      ["appearance.nodeLabelMode", { ...good, appearance: { ...good.appearance, nodeLabelMode: 3 } }],
      ["regions", { ...good, regions: "ticked" }],
      ["regions", { ...good, regions: [1] }],
      ["filters.collectionIDs", { ...good, filters: { ...good.filters, collectionIDs: [1] } }],
      ["filters.relation", { ...good, filters: { ...good.filters, relation: "all" } }],
      ["filters.openAccessOnly", { ...good, filters: { ...good.filters, openAccessOnly: "yes" } }],
    ];
    for (const [field, value] of cases) {
      const out = decodeGraphView(JSON.stringify(value));
      expect(out.ok, field).to.equal(false);
      if (!out.ok) expect(out.field).to.equal(field);
    }
    expect(decodeGraphView("not json").ok).to.equal(false);
  });
});

describe("tutorialChips", function () {
  it("lists what was applied in the reader's words", function () {
    const plan = planGraphView(folderMap, {
      nodes, layout: liveLayout, filters: defaultPaperListFilterState(), folders,
    });
    const chips = tutorialChips(folderMap, plan, 12);
    expect(chips).to.deep.equal([
      "x free",
      "y free",
      "size references",
      "colour uniform",
      "labels author-year",
      "regions 2 folders",
    ]);
  });

  it("names a substitution and a swatch overflow", function () {
    const poor = [node({ citationCount: null })];
    const plan = planGraphView(overview, {
      nodes: poor, layout: liveLayout, filters: defaultPaperListFilterState(), folders,
    });
    const chips = tutorialChips(overview, plan, 12);
    expect(chips.some((c) => c.startsWith("y ") && c.endsWith("(no citation data)"))).to.equal(true);
    const many = planGraphView(folderMap, {
      nodes, layout: liveLayout, filters: defaultPaperListFilterState(), folders,
    });
    expect(tutorialChips(folderMap, { ...many, regions: Array.from({ length: 14 }, (_, i) => i + 1) }, 12))
      .to.include("14 regions, 12 colours");
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/graphViews.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/services/graphViews.ts`**

```ts
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
import { normaliseLayoutFor } from "./graphLayoutAvailability";
import { getMetricDefinition } from "./metricRegistry";
import {
  defaultPaperListFilterState,
  type PaperListFilterState,
} from "./paperListViewService";
import type { IconName } from "./uiIconService";

/*
 * D4, graph views (spec 2026-09-12-graph-views-design.md). A view is a named
 * bundle of appearance, regions and filters, applied once; it never touches
 * Scope (seeds, ticks). Everything here is pure: the DOM is in
 * graphViewsMenu.ts and the wiring in graphViewService.ts.
 */

export const GRAPH_VIEW_WIRE_VERSION = 1;

export type GraphViewNeeds = "citation-hops" | "shared-citers" | "reading-state";
export type GraphViewAvailability = "ready" | { needs: GraphViewNeeds };
export type GraphViewRequires = "none" | "seed" | "two-seeds";
/** Folder names, every ticked subtree top, or leave the regions alone. */
export type GraphViewRegions = string[] | "ticked" | null;
/** Scope (`collectionIDs`) and the selection-relative `relation` never travel. */
export type GraphViewFilters = Partial<
  Omit<PaperListFilterState, "collectionIDs" | "relation">
>;

export interface GraphViewDefinition {
  id: string;
  name: string;
  summary: string;
  paragraph: string;
  icon: IconName;
  appearance: GraphLayoutOptions;
  regions: GraphViewRegions;
  filters: GraphViewFilters | null;
  /** Reserved for Stage 3 and 4: hops, floor, shared citers. */
  explore: null;
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
    summary: "Seeds, 2 citation hops, floor ≥ 5, colour citations. What the field rests on.",
    // draft: reconcile with boards 3a/3b
    paragraph:
      "Starts from your seeds, follows citations two steps out, and drops anything cited fewer than five times, so what remains is the work the field keeps coming back to. Colour is citations. Seeds and collections are untouched.",
    icon: "view-cornerstones",
    appearance: { ...BASE, nodeColorMetric: "citations" },
    regions: null,
    filters: null,
    explore: null,
    requires: "seed",
    availability: { needs: "citation-hops" },
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
  "citation-hops": "Arrives with citation hops",
  "shared-citers": "Arrives with shared citers",
  "reading-state": "Arrives with reading state",
};

export function graphViewAvailabilityLine(
  view: GraphViewDefinition,
): string | null {
  return view.availability === "ready" ? null : NEEDS_LINE[view.availability.needs];
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
  const { collectionIDs: _c, relation: _r, ...rest } = (patch ??
    {}) as PaperListFilterState;
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
    for (const key of Object.keys(view.filters) as Array<keyof GraphViewFilters>) {
      if (expectedFilters[key] !== live.filters[key]) return true;
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
  const chips = [
    `x ${metricWord(l.xMetric)}${sub.has("xMetric") ? noDataNote(a.xMetric) : ""}`,
    `y ${metricWord(l.yMetric)}${sub.has("yMetric") ? noDataNote(a.yMetric) : ""}`,
    `size ${metricWord(l.nodeSizeMetric)}${sub.has("nodeSizeMetric") ? noDataNote(a.nodeSizeMetric) : ""}`,
    `colour ${metricWord(l.nodeColorMetric)}${sub.has("nodeColorMetric") ? noDataNote(a.nodeColorMetric) : ""}`,
    `labels ${l.nodeLabelMode}`,
  ];
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

function filterWord(key: keyof GraphViewFilters, value: unknown): string | null {
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
    default:
      return null;
  }
}

/** The last line of the card: what the view did not touch, and what it could not do. */
export function tutorialFootnote(application: GraphViewApplication): string {
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
  if (regionCount) bits.push(`${regionCount} folder${regionCount === 1 ? "" : "s"} as regions`);
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
  explore: null;
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
    explore: null,
  };
  return JSON.stringify(wire, null, 2);
}

function stripScopeFilters(filters: GraphViewFilters): GraphViewFilters {
  const { collectionIDs: _c, relation: _r, ...rest } = filters as Record<
    string,
    unknown
  >;
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
  | { ok: true; view: GraphViewDefinition }
  | { ok: false; field: string };

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
  if (!SCALES.has(a.xScale as string)) return { ok: false, field: "appearance.xScale" };
  if (!axis(a.yMetric)) return { ok: false, field: "appearance.yMetric" };
  if (!SCALES.has(a.yScale as string)) return { ok: false, field: "appearance.yScale" };
  if (!(SIZE_METRICS.has(a.nodeSizeMetric as string) || isMetricID(a.nodeSizeMetric))) {
    return { ok: false, field: "appearance.nodeSizeMetric" };
  }
  if (!(COLOUR_METRICS.has(a.nodeColorMetric as string) || isMetricID(a.nodeColorMetric))) {
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
    if (!Array.isArray(raw.regions) || !raw.regions.every((r) => typeof r === "string")) {
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
      if (!(key in defaults)) return { ok: false, field: `filters.${key}` };
      const fallback = defaults[key as keyof PaperListFilterState];
      const okType =
        fallback === null
          ? value === null || typeof value === "string" || typeof value === "number"
          : typeof value === typeof fallback;
      if (!okType) return { ok: false, field: `filters.${key}` };
      out[key] = value;
    }
    filters = out as GraphViewFilters;
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
      explore: null,
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
    explore: null,
    requires: "none",
    availability: "ready",
  };
}
```

`IconName` must include the six new names; Task 5 adds them. Until then add the names to the union in `src/services/uiIconService.ts` now (paths come in Task 5) or `tsc` fails here: append `| "view" | "view-overview" | "view-cornerstones" | "view-reading-plan" | "view-who-cites-whom" | "view-folder-map" | "view-user"` to `IconName` and give each an empty array `[]` in `ICON_PATHS` with a `// D4: drawn in Task 5` comment.

- [ ] **Step 4: Run the file, then `npm run check`**

Expected: all unit cases pass; check green. If `getMetricDefinition(...).label` capitalisation differs (e.g. "Citations"), `metricWord` lowercases it, so "size citations" holds; adjust the expected chip strings only if a label is multi-word (e.g. "reference count"): then the expected chip is `size reference count` and the test's expectation changes to match the registry, not the other way round.

- [ ] **Step 5: Commit**

```bash
git add src/services/graphViews.ts src/services/uiIconService.ts test/unit/graphViews.test.ts
git commit -m "D4: the view model, the five shipped views, and the pure apply, edited and wire rules"
```

---

### Task 4: The two profile preferences

**Spec:** "User views".

**Files:**
- Create: `src/services/graphViewsStore.ts`
- Test: `test/unit/graphViewsStore.test.ts`

**Interfaces (produced):**

```ts
export function listSavedGraphViews(): GraphViewDefinition[];
export function saveGraphView(view: GraphViewDefinition): void;      // insert or replace by id
export function deleteGraphView(id: string): void;                   // also un-dismisses its tutorial
export function isTutorialDismissed(id: string): boolean;
export function dismissTutorial(id: string): void;
```

- [ ] **Step 1: Write the failing test**

Create `test/unit/graphViewsStore.test.ts`:

```ts
import { afterEach, beforeEach, describe, it } from "node:test";
import { expect } from "chai";
import { config } from "../../package.json";
import {
  deleteGraphView,
  dismissTutorial,
  isTutorialDismissed,
  listSavedGraphViews,
  saveGraphView,
} from "../../src/services/graphViewsStore";
import { captureGraphView, type GraphViewDefinition } from "../../src/services/graphViews";
import { defaultPaperListFilterState } from "../../src/services/paperListViewService";

const prefKey = (name: string): string => `${config.prefsPrefix}.${name}`;
let store: Record<string, unknown> = {};
let previousZotero: unknown;

beforeEach(function () {
  previousZotero = (globalThis as Record<string, unknown>).Zotero;
  store = {};
  (globalThis as Record<string, unknown>).Zotero = {
    Prefs: {
      get: (name: string) => store[name],
      set: (name: string, value: unknown) => {
        store[name] = value;
      },
    },
  };
});

afterEach(function () {
  (globalThis as Record<string, unknown>).Zotero = previousZotero;
});

function view(name: string): GraphViewDefinition {
  return captureGraphView({
    name,
    paragraph: "p",
    layout: {
      xMetric: "year", xScale: "linear", yMetric: "citations", yScale: "linear",
      nodeSizeMetric: "citations", nodeColorMetric: "uniform", nodeLabelMode: "author-year",
    },
    regions: [],
    filters: defaultPaperListFilterState(),
    folders: [],
  });
}

describe("the saved views preference", function () {
  it("is empty when absent or unparseable, and is rewritten on save", function () {
    expect(listSavedGraphViews()).to.deep.equal([]);
    store[prefKey("graphViews")] = "{not json";
    expect(listSavedGraphViews()).to.deep.equal([]);
    const v = view("A");
    saveGraphView(v);
    expect(listSavedGraphViews().map((x) => x.name)).to.deep.equal(["A"]);
    expect(JSON.parse(String(store[prefKey("graphViews")]))[0].id).to.equal(v.id);
  });

  it("replaces by id, deletes by id, and forgets a deleted view's dismissal", function () {
    const v = view("A");
    saveGraphView(v);
    saveGraphView({ ...v, name: "A2" });
    expect(listSavedGraphViews().map((x) => x.name)).to.deep.equal(["A2"]);
    dismissTutorial(v.id);
    expect(isTutorialDismissed(v.id)).to.equal(true);
    deleteGraphView(v.id);
    expect(listSavedGraphViews()).to.deep.equal([]);
    expect(isTutorialDismissed(v.id)).to.equal(false);
  });

  it("skips a stored record that no longer decodes", function () {
    store[prefKey("graphViews")] = JSON.stringify([
      { meristemaView: 1, id: "user:x", name: "bad", appearance: { xMetric: "bogus" } },
    ]);
    expect(listSavedGraphViews()).to.deep.equal([]);
  });
});
```

- [ ] **Step 2: Run to see it fail** — module not found.

- [ ] **Step 3: Implement `src/services/graphViewsStore.ts`**

```ts
import { config } from "../../package.json";
import {
  decodeGraphViewRecord,
  encodeGraphView,
  type GraphViewDefinition,
} from "./graphViews";

/*
 * D4: the reader's own views, stored in the Zotero profile beside
 * graphAppearance. The record on disk is the wire form plus `id`, one array;
 * the wire field `meristemaView` versions each record, so there is no
 * separate version preference. Unparseable is empty, never thrown.
 */

const key = (name: string): string => `${config.prefsPrefix}.${name}`;
const VIEWS = "graphViews";
const DISMISSED = "graphViewTutorialsDismissed";

function readRaw(name: string): unknown {
  try {
    return JSON.parse(String(Zotero.Prefs.get(key(name), true) ?? ""));
  } catch {
    return null;
  }
}

export function listSavedGraphViews(): GraphViewDefinition[] {
  const raw = readRaw(VIEWS);
  if (!Array.isArray(raw)) return [];
  const out: GraphViewDefinition[] = [];
  for (const record of raw) {
    const id =
      typeof record === "object" && record && typeof (record as { id?: unknown }).id === "string"
        ? (record as { id: string }).id
        : null;
    if (!id || !id.startsWith("user:")) continue;
    const decoded = decodeGraphViewRecord(record, id);
    if (decoded.ok) out.push(decoded.view);
  }
  return out;
}

function writeViews(views: readonly GraphViewDefinition[]): void {
  const records = views.map((v) => ({ ...JSON.parse(encodeGraphView(v)), id: v.id }));
  Zotero.Prefs.set(key(VIEWS), JSON.stringify(records), true);
}

export function saveGraphView(view: GraphViewDefinition): void {
  const others = listSavedGraphViews().filter((v) => v.id !== view.id);
  writeViews([...others, view]);
}

export function deleteGraphView(id: string): void {
  writeViews(listSavedGraphViews().filter((v) => v.id !== id));
  writeDismissed(readDismissed().filter((d) => d !== id));
}

function readDismissed(): string[] {
  const raw = readRaw(DISMISSED);
  return Array.isArray(raw) ? raw.filter((d): d is string => typeof d === "string") : [];
}

function writeDismissed(ids: readonly string[]): void {
  Zotero.Prefs.set(key(DISMISSED), JSON.stringify([...new Set(ids)]), true);
}

export function isTutorialDismissed(id: string): boolean {
  return readDismissed().includes(id);
}

export function dismissTutorial(id: string): void {
  writeDismissed([...readDismissed(), id]);
}
```

- [ ] **Step 4: Run the file, then `npm run check`** — expected green.

- [ ] **Step 5: Commit**

```bash
git add src/services/graphViewsStore.ts test/unit/graphViewsStore.test.ts
git commit -m "D4: saved views and dismissed tutorials in the profile"
```

---

### Task 5: Seven drawn icons

**Spec:** "Gallery" (static icon per view), "Toolbar chip".

**Files:**
- Modify: `src/services/uiIconService.ts` (`IconName` union near line 5, `ICON_PATHS` near line 24)

No unit test: the icon table is data, and `createIcon` is already covered. The manual batch checks the set (Task 10).

- [ ] **Step 1: Replace the empty placeholders from Task 3 with paths**

Each path is on the 24-box, filled even-odd, hollow where a subpath nests. Draw them simply; they read at 16px.

```ts
  // D4. The chip: a framed viewfinder.
  view: [
    "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm1 2v10h14V7H5Z",
  ],
  // Overview: three discs rising to the right, an axis under them.
  "view-overview": [
    "M4 19h16v1.5H4V19Z",
    "M6.5 15.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm6-3a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm6-4a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  ],
  // Cornerstones: one large disc with two hops fanning out.
  "view-cornerstones": [
    "M6 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0-1.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z",
    "M8 9.5l6-2 .5 1.4-6 2-.5-1.4Zm0 1l6 3-.6 1.3-6-3 .6-1.3Z",
    "M16 9a1.7 1.7 0 1 0 0-3.4A1.7 1.7 0 0 0 16 9Zm0 8a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4Zm4-4a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8Z",
  ],
  // Reading plan: a diamond (unread) beside a disc (read).
  "view-reading-plan": [
    "M8 4l5 8-5 8-5-8 5-8Zm0 3.2L5.2 12 8 16.8 10.8 12 8 7.2Z",
    "M17 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z",
  ],
  // Who cites whom: two seeds joined through a bridge paper.
  "view-who-cites-whom": [
    "M5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm14 0a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
    "M12 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
    "M6 8.5l5.3 6.6-1.2 1L4.8 9.5l1.2-1Zm12 0l1.2 1-5.3 6.6-1.2-1L18 8.5Z",
  ],
  // Folder map: two overlapping rounded regions.
  "view-folder-map": [
    "M9 5a5 5 0 1 0 0 10A5 5 0 0 0 9 5Zm0 1.6a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8Z",
    "M15 9a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0 1.6a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8Z",
  ],
  // A saved view: a bookmark.
  "view-user": [
    "M7 3h10a1 1 0 0 1 1 1v17l-6-4-6 4V4a1 1 0 0 1 1-1Zm1 2v12.3l4-2.7 4 2.7V5H8Z",
  ],
```

- [ ] **Step 2: Render them once**

Run: `npm run check` (green), then write a scratch HTML that inlines the seven paths in 16px and 24px boxes and open it in a browser, or ask the reviewer to. Fix any glyph that reads wrong. Add "the seven view icons at 16px in the dropdown, both themes" to the manual batch (Task 10 collects the list).

- [ ] **Step 3: Commit**

```bash
git add src/services/uiIconService.ts
git commit -m "D4: seven drawn icons for the View chip and the five views"
```

---

### Task 6: The chip, the dropdown, the card, the gallery and the save panel as DOM

**Spec:** "Toolbar chip and dropdown", "Tutorial card", "Gallery", "Save dialog".

**Files:**
- Create: `src/services/graphViewsMenu.ts`
- Modify: `addon/content/graph.css`

**Interfaces (produced, consumed by Task 7):**

```ts
export interface GraphViewsMenuOptions {
  document: Document;
  shipped: readonly GraphViewDefinition[];
  listSaved: () => GraphViewDefinition[];
  onChoose: (view: GraphViewDefinition) => void;
  onEdit: (view: GraphViewDefinition) => void;
  onSaveCurrent: () => void;
  onImport: () => void;
  onOpenGallery: () => void;
}
export interface GraphViewsMenu {
  wrap: HTMLElement;            // the toolbar cell, a `cm-menu-wrapper`
  button: HTMLButtonElement;    // the chip
  setLabel(name: string | null, edited: boolean): void;
  close(): void;
  refresh(activeID: string | null): void;   // rebuilds rows
}
export function createGraphViewsMenu(o: GraphViewsMenuOptions): GraphViewsMenu;

export interface TutorialCard { root: HTMLElement; show(view, chips: string[], footnote: string): void; hide(): void; }
export function createTutorialCard(document, onDismissForever: (id: string) => void): TutorialCard;

export interface ViewGallery { root: HTMLElement; show(count: number): void; hide(): void; }
export function createViewGallery(document, o: { shipped; onChoose; onBlank: () => void; onImport: () => void }): ViewGallery;

export interface SavePanelResult { name: string; paragraph: string }
export interface SavePanel { root: HTMLElement; open(o: { name; paragraph; captures: { regions: number; filters: boolean }; existing: GraphViewDefinition | null; nameTaken: (name: string) => boolean; onCopyJSON: (r: SavePanelResult) => void; onSave: (r: SavePanelResult) => void; onDelete: (() => void) | null }): void; close(): void; }
export function createSavePanel(document): SavePanel;
```

- [ ] **Step 1: Implement `src/services/graphViewsMenu.ts`**

```ts
import {
  graphViewAvailabilityLine,
  graphViewIsAvailable,
  graphViewRequirementLine,
  type GraphViewDefinition,
} from "./graphViews";
import { createIcon } from "./uiIconService";
import { element, text } from "./graphViewControls";

/*
 * D4's DOM: the View chip and its dropdown (a sibling of the File menu, same
 * family), the tutorial card, the gallery, and the save panel. No graph
 * state lives here; every decision arrives through a callback.
 */

export interface GraphViewsMenuOptions {
  document: Document;
  shipped: readonly GraphViewDefinition[];
  listSaved: () => GraphViewDefinition[];
  onChoose: (view: GraphViewDefinition) => void;
  onEdit: (view: GraphViewDefinition) => void;
  onSaveCurrent: () => void;
  onImport: () => void;
  onOpenGallery: () => void;
}

export interface GraphViewsMenu {
  wrap: HTMLElement;
  button: HTMLButtonElement;
  menu: HTMLElement;
  setLabel(name: string | null, edited: boolean): void;
  close(): void;
  open(): void;
  refresh(activeID: string | null): void;
}

function row(
  document: Document,
  view: GraphViewDefinition,
  active: boolean,
  onChoose: () => void,
  onEdit: (() => void) | null,
): HTMLElement {
  const available = graphViewIsAvailable(view);
  const button = element(document, "button", "cm-view-row");
  button.type = "button";
  button.dataset.viewId = view.id;
  button.setAttribute("role", "menuitemradio");
  button.setAttribute("aria-checked", String(active));
  if (!available) {
    button.classList.add("cm-view-row--unavailable");
    button.setAttribute("aria-disabled", "true");
  }
  button.append(createIcon(document, view.icon, 16));
  const body = element(document, "span", "cm-view-row-body");
  body.append(
    text(document, "span", view.name, "cm-view-row-name"),
    text(document, "span", view.summary, "cm-view-row-summary"),
  );
  button.append(body);
  const note = graphViewAvailabilityLine(view) ?? graphViewRequirementLine(view);
  if (note) button.append(text(document, "span", note, "cm-view-row-note"));
  if (active) button.append(text(document, "span", "✓", "cm-view-row-tick"));
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!available) return;
    onChoose();
  });
  if (!onEdit) return button;
  const wrap = element(document, "div", "cm-view-row-wrap");
  const edit = element(document, "button", "cm-view-row-edit");
  edit.type = "button";
  edit.textContent = "edit";
  edit.title = `Edit ${view.name}`;
  edit.addEventListener("click", (event) => {
    event.stopPropagation();
    onEdit();
  });
  wrap.append(button, edit);
  return wrap;
}

export function createGraphViewsMenu(o: GraphViewsMenuOptions): GraphViewsMenu {
  const { document } = o;
  const wrap = element(document, "div", "cm-menu-wrapper cm-view-menu-wrap");
  const button = element(document, "button", "cm-toolbar-button cm-view-chip");
  button.type = "button";
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", "meristema-view-menu");
  button.title = "Choose a named way to look at this graph.";
  button.append(createIcon(document, "view", 16));
  const label = text(document, "span", "View", "cm-view-chip-label");
  const name = text(document, "span", "", "cm-view-chip-name");
  const caret = text(document, "span", "▾", "cm-view-chip-caret");
  button.append(label, name, caret);
  const menu = element(document, "div", "cm-export-menu cm-view-menu");
  menu.id = "meristema-view-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  wrap.append(button, menu);

  const refresh = (activeID: string | null): void => {
    menu.replaceChildren();
    for (const view of o.shipped) {
      menu.append(
        row(document, view, view.id === activeID, () => {
          close();
          o.onChoose(view);
        }, null),
      );
    }
    const saved = o.listSaved();
    if (saved.length) {
      menu.append(text(document, "div", "My views", "cm-graph-menu-heading"));
      for (const view of saved) {
        menu.append(
          row(
            document,
            view,
            view.id === activeID,
            () => {
              close();
              o.onChoose(view);
            },
            () => {
              close();
              o.onEdit(view);
            },
          ),
        );
      }
    }
    menu.append(text(document, "div", "", "cm-graph-menu-heading cm-view-menu-rule"));
    for (const [labelText, handler] of [
      ["Save current as view…", o.onSaveCurrent],
      ["Import view JSON…", o.onImport],
      ["Choose a view…", o.onOpenGallery],
    ] as const) {
      const action = element(document, "button", "cm-view-action");
      action.type = "button";
      action.setAttribute("role", "menuitem");
      action.textContent = labelText;
      action.addEventListener("click", (event) => {
        event.stopPropagation();
        close();
        handler();
      });
      menu.append(action);
    }
  };

  const close = (): void => {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
  };
  const open = (): void => {
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
  };
  button.addEventListener("click", () => {
    if (menu.hidden) open();
    else close();
  });

  return {
    wrap,
    button,
    menu,
    setLabel(viewName, edited) {
      name.textContent = viewName ? `${viewName}${edited ? " (edited)" : ""}` : "";
      name.hidden = !viewName;
      button.setAttribute(
        "aria-label",
        viewName ? `View: ${viewName}${edited ? ", edited" : ""}` : "View",
      );
    },
    close,
    open,
    refresh,
  };
}

// ----------------------------------------------------------- tutorial card

export interface TutorialCard {
  root: HTMLElement;
  show(view: GraphViewDefinition, chips: string[], footnote: string): void;
  hide(): void;
}

export function createTutorialCard(
  document: Document,
  onDismissForever: (id: string) => void,
): TutorialCard {
  const root = element(document, "aside", "cm-view-card");
  root.hidden = true;
  root.setAttribute("role", "note");
  const head = element(document, "div", "cm-view-card-head");
  const title = text(document, "span", "", "cm-view-card-title");
  const closeButton = element(document, "button", "cm-view-card-close");
  closeButton.type = "button";
  closeButton.textContent = "×";
  closeButton.setAttribute("aria-label", "Close");
  head.append(title, closeButton);
  const body = text(document, "p", "", "cm-view-card-body");
  const chipRow = element(document, "div", "cm-view-card-chips");
  const foot = text(document, "p", "", "cm-view-card-foot");
  const actions = element(document, "div", "cm-view-card-actions");
  const never = element(document, "button", "cm-link-button");
  never.type = "button";
  never.textContent = "Don't show for this view again";
  const got = element(document, "button", "cm-secondary-button");
  got.type = "button";
  got.textContent = "Got it";
  actions.append(never, got);
  root.append(head, body, chipRow, foot, actions);
  let current: string | null = null;
  const hide = (): void => {
    root.hidden = true;
    current = null;
  };
  closeButton.addEventListener("click", hide);
  got.addEventListener("click", hide);
  never.addEventListener("click", () => {
    if (current) onDismissForever(current);
    hide();
  });
  return {
    root,
    show(view, chips, footnote) {
      current = view.id;
      title.textContent = view.name;
      body.textContent = view.paragraph;
      chipRow.replaceChildren(
        ...chips.map((chip) => text(document, "span", chip, "cm-view-chip-tag")),
      );
      foot.textContent = footnote;
      root.hidden = false;
    },
    hide,
  };
}

// ----------------------------------------------------------------- gallery

export interface ViewGallery {
  root: HTMLElement;
  show(count: number): void;
  hide(): void;
}

export function createViewGallery(
  document: Document,
  o: {
    shipped: readonly GraphViewDefinition[];
    onChoose: (view: GraphViewDefinition) => void;
    onBlank: () => void;
    onImport: () => void;
  },
): ViewGallery {
  const root = element(document, "section", "cm-view-gallery");
  root.hidden = true;
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", "Choose a view");
  const heading = text(document, "h2", "", "cm-view-gallery-heading");
  const sub = text(document, "p", "Scope stays as it is.", "cm-view-gallery-sub");
  const grid = element(document, "div", "cm-view-gallery-grid");
  for (const view of o.shipped) {
    const card = element(document, "button", "cm-view-gallery-card");
    card.type = "button";
    card.dataset.viewId = view.id;
    const available = graphViewIsAvailable(view);
    if (!available) {
      card.classList.add("cm-view-gallery-card--unavailable");
      card.setAttribute("aria-disabled", "true");
    }
    card.append(createIcon(document, view.icon, 28));
    card.append(text(document, "span", view.name, "cm-view-gallery-name"));
    card.append(text(document, "span", view.paragraph, "cm-view-gallery-para"));
    const note = graphViewAvailabilityLine(view) ?? graphViewRequirementLine(view);
    if (note) card.append(text(document, "span", note, "cm-view-gallery-note"));
    card.addEventListener("click", () => {
      if (available) o.onChoose(view);
    });
    grid.append(card);
  }
  const last = element(document, "div", "cm-view-gallery-card cm-view-gallery-last");
  const blank = element(document, "button", "cm-secondary-button");
  blank.type = "button";
  blank.textContent = "Start blank";
  blank.addEventListener("click", o.onBlank);
  const importButton = element(document, "button", "cm-link-button");
  importButton.type = "button";
  importButton.textContent = "Import view JSON…";
  importButton.addEventListener("click", o.onImport);
  last.append(blank, importButton);
  grid.append(last);
  root.append(heading, sub, grid);
  return {
    root,
    show(count) {
      heading.textContent = `How do you want to look at these ${count.toLocaleString()} papers?`;
      root.hidden = false;
    },
    hide() {
      root.hidden = true;
    },
  };
}

// -------------------------------------------------------------- save panel

export interface SavePanelResult {
  name: string;
  paragraph: string;
}

export interface SavePanelOpenOptions {
  name: string;
  paragraph: string;
  captures: { regions: number; filters: boolean };
  existing: GraphViewDefinition | null;
  nameTaken: (name: string) => boolean;
  onCopyJSON: (result: SavePanelResult) => void;
  onSave: (result: SavePanelResult) => void;
  onDelete: (() => void) | null;
}

export interface SavePanel {
  root: HTMLElement;
  open(o: SavePanelOpenOptions): void;
  close(): void;
}

export function createSavePanel(document: Document): SavePanel {
  const root = element(document, "div", "cm-view-save");
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Save view");
  const title = text(document, "h2", "Save current as view", "cm-view-save-title");
  const nameLabel = element(document, "label", "cm-view-save-field");
  nameLabel.append(text(document, "span", "Name"));
  const nameInput = element(document, "input", "cm-view-save-input");
  nameInput.type = "text";
  nameInput.maxLength = 80;
  nameLabel.append(nameInput);
  const nameError = text(document, "p", "", "cm-view-save-error");
  nameError.hidden = true;
  const explainLabel = element(document, "label", "cm-view-save-field");
  explainLabel.append(text(document, "span", "Explain it"));
  const explain = element(document, "textarea", "cm-view-save-textarea");
  explain.rows = 4;
  explainLabel.append(explain);
  const captures = element(document, "ul", "cm-view-save-captures");
  const footer = element(document, "div", "cm-view-save-footer");
  const note = text(document, "span", "Views are stored in your Zotero profile.", "cm-view-save-note");
  const copyButton = element(document, "button", "cm-secondary-button");
  copyButton.type = "button";
  copyButton.textContent = "Copy JSON";
  const deleteButton = element(document, "button", "cm-secondary-button cm-view-save-delete");
  deleteButton.type = "button";
  deleteButton.textContent = "Delete";
  const cancel = element(document, "button", "cm-secondary-button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  const save = element(document, "button", "cm-primary-button");
  save.type = "button";
  save.textContent = "Save";
  footer.append(note, copyButton, deleteButton, cancel, save);
  root.append(title, nameLabel, nameError, explainLabel, text(document, "p", "Captures", "cm-view-save-captures-title"), captures, footer);

  let current: SavePanelOpenOptions | null = null;
  const result = (): SavePanelResult => ({
    name: nameInput.value.trim(),
    paragraph: explain.value.trim(),
  });
  const validate = (): boolean => {
    const { name } = result();
    let error = "";
    if (!name) error = "Give the view a name.";
    else if (
      current?.nameTaken(name) &&
      !(current.existing && current.existing.name.toLowerCase() === name.toLowerCase())
    ) {
      error = "A view with that name already exists.";
    }
    nameError.textContent = error;
    nameError.hidden = !error;
    save.disabled = Boolean(error);
    return !error;
  };
  nameInput.addEventListener("input", validate);
  const close = (): void => {
    root.hidden = true;
    current = null;
  };
  cancel.addEventListener("click", close);
  copyButton.addEventListener("click", () => {
    if (current && validate()) current.onCopyJSON(result());
  });
  save.addEventListener("click", () => {
    if (!current || !validate()) return;
    const o = current;
    close();
    o.onSave(result());
  });
  deleteButton.addEventListener("click", () => {
    const o = current;
    close();
    o?.onDelete?.();
  });
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });

  const captureRow = (label: string, ticked: boolean, dashed = false): HTMLElement => {
    const li = element(document, "li", "cm-view-save-capture");
    if (dashed) li.classList.add("cm-view-save-capture--never");
    const box = element(document, "input");
    box.type = "checkbox";
    box.checked = ticked;
    box.disabled = true;
    li.append(box, text(document, "span", label));
    return li;
  };

  return {
    root,
    open(o) {
      current = o;
      title.textContent = o.existing ? `Edit ${o.existing.name}` : "Save current as view";
      nameInput.value = o.name;
      explain.value = o.paragraph;
      captures.replaceChildren(
        captureRow("Axes", true),
        captureRow("Colour", true),
        captureRow("Size", true),
        captureRow("Labels", true),
        captureRow(
          o.captures.regions ? `Regions: ${o.captures.regions} folder${o.captures.regions === 1 ? "" : "s"}` : "Regions: none",
          true,
        ),
        captureRow("Filters", true),
        captureRow("Explore (hops, floor, shared citers) — not yet available", false),
        captureRow("Scope (seeds, collections) — never saved", false, true),
      );
      deleteButton.hidden = !o.onDelete;
      root.hidden = false;
      validate();
      nameInput.focus();
      nameInput.select();
    },
    close,
  };
}
```

`text(document, "span", label)` with three arguments: check the helper's signature at `graphViewControls.ts:41`; it takes `(document, tag, content, className?)`. If `className` is required, pass `""`.

`cm-primary-button` and `cm-link-button`: check `graph.css` for existing classes (`grep -n "cm-primary-button\|cm-link-button\|cm-secondary-button" addon/content/graph.css`). Use whatever exists for the primary and link looks; if none, `cm-link-button` is defined in Step 2.

- [ ] **Step 2: The CSS**

Append to `addon/content/graph.css`, after the `.cm-graph-menu-heading` block:

```css
/*
 * D4, views. The chip and its menu are the File menu's siblings and take its
 * popup; the rows are two-line so a name and its one-liner read together.
 */
.cm-view-menu {
  right: auto;
  left: 0;
  min-width: 320px;
  max-width: 380px;
}
.cm-view-chip-name {
  font-weight: 600;
}
.cm-view-chip-name[hidden] {
  display: none;
}
.cm-view-chip-caret {
  color: var(--cm-muted);
  font-size: 10px;
}
.cm-view-row-wrap {
  display: flex;
  align-items: stretch;
}
.cm-view-row {
  display: grid;
  grid-template-columns: 16px 1fr auto;
  gap: 4px 10px;
  align-items: start;
  width: 100%;
  padding: 6px 8px;
  text-align: left;
  border-color: transparent;
}
.cm-view-row-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.cm-view-row-summary,
.cm-view-row-note {
  color: var(--cm-muted);
  font-size: 11px;
  line-height: 1.35;
}
.cm-view-row-note {
  grid-column: 3;
  white-space: nowrap;
}
.cm-view-row-tick {
  grid-column: 3;
  color: var(--cm-accent);
}
.cm-view-row--unavailable {
  opacity: 0.55;
  cursor: default;
}
.cm-view-row-edit {
  flex: 0 0 auto;
  padding: 0 8px;
  border-color: transparent;
  color: var(--cm-link);
  font-size: 11px;
}
.cm-view-menu-rule {
  margin: 4px 6px 0;
  padding: 0;
}
.cm-view-action {
  justify-content: flex-start;
  border-color: transparent;
}
.cm-link-button {
  padding: 0;
  border: 0;
  background: none;
  color: var(--cm-link);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
/* The tutorial card, in the plot's corner, under popovers and above the canvas. */
.cm-view-card {
  position: absolute;
  right: 14px;
  bottom: 14px;
  z-index: 6;
  width: 300px;
  max-width: calc(100% - 28px);
  padding: 12px 14px;
  border: 1px solid var(--cm-border-soft);
  border-radius: 10px;
  background: color-mix(in srgb, Canvas 92%, transparent);
  backdrop-filter: blur(8px);
  box-shadow: 0 6px 18px color-mix(in srgb, black 18%, transparent);
  font-size: 11.5px;
  line-height: 1.45;
}
.cm-view-card[hidden] {
  display: none;
}
.cm-view-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
}
.cm-view-card-close {
  border: 0;
  background: none;
  color: var(--cm-muted);
  font-size: 14px;
  cursor: pointer;
}
.cm-view-card-body,
.cm-view-card-foot {
  margin: 6px 0 0;
}
.cm-view-card-foot {
  color: var(--cm-muted);
}
.cm-view-card-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
}
.cm-view-chip-tag {
  padding: 1px 6px;
  border: 1px solid var(--cm-border-soft);
  border-radius: 4px;
  font-size: 10.5px;
}
.cm-view-card-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
}
/* The gallery: a non-modal inset; the toolbar and the rail stay live behind it. */
.cm-view-gallery {
  position: absolute;
  inset: 24px;
  z-index: 5;
  overflow: auto;
  padding: 18px 20px;
  border: 1px solid var(--cm-border-soft);
  border-radius: 12px;
  background: color-mix(in srgb, Canvas 94%, transparent);
  backdrop-filter: blur(10px);
  box-shadow: 0 12px 32px color-mix(in srgb, black 28%, transparent);
}
.cm-view-gallery[hidden] {
  display: none;
}
.cm-view-gallery-heading {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.cm-view-gallery-sub {
  margin: 4px 0 14px;
  color: var(--cm-muted);
  font-size: 11.5px;
}
.cm-view-gallery-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.cm-view-gallery-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 12px;
  text-align: left;
  border: 1px solid var(--cm-border-soft);
  border-radius: 10px;
  background: var(--cm-surface-raised);
  font: inherit;
  cursor: pointer;
}
.cm-view-gallery-card:hover:not([aria-disabled="true"]) {
  border-color: var(--cm-accent);
}
.cm-view-gallery-card--unavailable {
  opacity: 0.5;
  cursor: default;
}
.cm-view-gallery-name {
  font-weight: 600;
}
.cm-view-gallery-para,
.cm-view-gallery-note {
  color: var(--cm-muted);
  font-size: 11px;
  line-height: 1.4;
}
.cm-view-gallery-last {
  justify-content: center;
  align-items: center;
  gap: 10px;
  cursor: default;
}
/* The save panel: an in-page dialog centred over the plot. */
.cm-view-save {
  position: absolute;
  left: 50%;
  top: 50%;
  z-index: 9;
  width: min(440px, calc(100% - 40px));
  transform: translate(-50%, -50%);
  padding: 16px 18px;
  border: 1px solid var(--cm-border);
  border-radius: 10px;
  background: Canvas;
  box-shadow: 0 12px 32px color-mix(in srgb, black 28%, transparent);
  font-size: 12px;
}
.cm-view-save[hidden] {
  display: none;
}
.cm-view-save-title {
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 600;
}
.cm-view-save-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
}
.cm-view-save-input,
.cm-view-save-textarea {
  font: inherit;
  padding: 4px 6px;
  border: 1px solid var(--cm-border);
  border-radius: 4px;
  background: var(--cm-surface-raised);
  color: CanvasText;
}
.cm-view-save-error {
  margin: -6px 0 8px;
  color: var(--cm-state-retracted, #a44c00);
  font-size: 11px;
}
.cm-view-save-error[hidden] {
  display: none;
}
.cm-view-save-captures-title {
  margin: 0 0 4px;
  color: var(--cm-muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.cm-view-save-captures {
  margin: 0 0 12px;
  padding: 0;
  list-style: none;
}
.cm-view-save-capture {
  display: flex;
  align-items: center;
  gap: 6px;
}
.cm-view-save-capture--never {
  color: var(--cm-muted);
  text-decoration: line-through;
  text-decoration-style: dashed;
}
.cm-view-save-footer {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cm-view-save-note {
  flex: 1 1 auto;
  color: var(--cm-muted);
  font-size: 11px;
}
.cm-view-save-delete[hidden] {
  display: none;
}
```

The error colour: B40 removed `--cm-state-retracted` from the emitter, so the fallback `#a44c00` is what renders. Colour literals belong in `graphTheme.ts` per the global rule, but graph.css already carries hex fallbacks for Zotero tokens (see its header block); this one follows that precedent. Note it in the commit message.

- [ ] **Step 3: `npm run check`** — expected green (prettier may rewrap; run `npm run lint:fix` then re-check).

- [ ] **Step 4: Commit**

```bash
git add src/services/graphViewsMenu.ts addon/content/graph.css
git commit -m "D4: the View chip, its dropdown, the tutorial card, the gallery and the save panel as DOM"
```

---

### Task 7: Wire the views into the graph view

**Spec:** "Toolbar chip and dropdown" (placement), "Applying a view", "The active view, in the graph state" (plumbing), "Gallery" (when), "Tutorial card" (when), "Save dialog" (behaviour), "What does not change".

**Files:**
- Modify: `src/services/graphViewService.ts`

Anchors are given as code to search for; line numbers drift. Read the file's regions named in each step before editing.

**Interfaces:**
- Consumes: everything from Tasks 1, 3, 4, 6.
- Produces: the controller's `getState()` returns `view`; `applyState` reads it.

- [ ] **Step 1: Imports**

Add near the other service imports:

```ts
import {
  captureGraphView,
  draftParagraph,
  encodeGraphView,
  graphViewIsEdited,
  isShippedViewName,
  planGraphView,
  SHIPPED_GRAPH_VIEWS,
  tutorialChips,
  tutorialFootnote,
  type GraphViewDefinition,
  type ViewFolder,
} from "./graphViews";
import {
  deleteGraphView,
  dismissTutorial,
  isTutorialDismissed,
  listSavedGraphViews,
  saveGraphView,
} from "./graphViewsStore";
import {
  createGraphViewsMenu,
  createSavePanel,
  createTutorialCard,
  createViewGallery,
} from "./graphViewsMenu";
import { importGraphViewFile } from "./exportService";
import type { GraphViewRef } from "./graphViewState";
```

(`importGraphViewFile` arrives in Task 8; until then stub the import handler with `() => undefined` and add the real call in Task 8.)

- [ ] **Step 2: State**

Next to `let regions: number[] = ...` (search `let regions: number[]`), add:

```ts
  /** D4: the view this graph is on; null shows the gallery once. */
  let view: GraphViewRef = null;
```

- [ ] **Step 3: Build the DOM and place the chip**

After the block that builds `graphWrap` (search `graphWrap.append(graphButton, graphMenu);`), add:

```ts
  // D4: the View chip, File's sibling. It sits after File (B21: File leads
  // the bar) and before Filter, the first control on the document.
  const collectionTickStateOf = (
    collection: LibraryCollectionFilter,
  ): "on" | "off" | "mixed" =>
    collectionTickState(
      collectionTicks,
      collection.collectionID,
      collection.includedCollectionIDs.filter(
        (id) => id !== collection.collectionID,
      ),
    );
  const viewFolders = (): ViewFolder[] =>
    snapshot.collections.map((c) => ({
      collectionID: c.collectionID,
      name: c.name,
      parentCollectionID: c.parentCollectionID,
      orderIndex: c.orderIndex,
      ticked: collectionTickStateOf(c),
    }));
  const allViews = (): GraphViewDefinition[] => [
    ...SHIPPED_GRAPH_VIEWS,
    ...listSavedGraphViews(),
  ];
  const viewByID = (id: string): GraphViewDefinition | null =>
    allViews().find((v) => v.id === id) ?? null;
  const viewsMenu = createGraphViewsMenu({
    document,
    shipped: SHIPPED_GRAPH_VIEWS,
    listSaved: listSavedGraphViews,
    onChoose: (chosen) => applyGraphView(chosen),
    onEdit: (chosen) => openSavePanel(chosen),
    onSaveCurrent: () => openSavePanel(null),
    onImport: () => void importView(),
    onOpenGallery: () => showGallery(),
  });
  const tutorialCard = createTutorialCard(document, (id) => dismissTutorial(id));
  const viewGallery = createViewGallery(document, {
    shipped: SHIPPED_GRAPH_VIEWS,
    onChoose: (chosen) => applyGraphView(chosen),
    onBlank: () => {
      view = "blank";
      viewGallery.hide();
      refreshViewChip();
      notifyStateChange();
    },
    onImport: () => void importView(),
  });
  const savePanel = createSavePanel(document);
```

`collectionTickState` is exported from `./graphScopeModel` (line 101); import it if the file does not already. `LibraryCollectionFilter` is in `../domain/types`.

Change the toolbar composition:

```ts
  toolbar.append(
    graphWrap,
    viewsMenu.wrap,
    graphFilter.root,
    similarButton,
    exportWrap,
    refreshButton,
  );
```

After `graphArea.appendChild(emptyState);` add:

```ts
  graphArea.append(tutorialCard.root, viewGallery.root, savePanel.root);
```

- [ ] **Step 4: Open and close like File's menu**

Next to `closeGraphMenu` (search `const closeGraphMenu = (): void =>`), add the same three handlers for the views menu and make each menu close the others:

```ts
  const closeViewsMenuOnOutsidePointer = (event: Event): void => {
    if (viewsMenu.menu.hidden) return;
    const target = event.target as Node | null;
    if (target && viewsMenu.wrap.contains(target)) return;
    viewsMenu.close();
  };
  const closeViewsMenuOnEscape = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || viewsMenu.menu.hidden) return;
    viewsMenu.close();
    viewsMenu.button.focus();
  };
  document.addEventListener("pointerdown", closeViewsMenuOnOutsidePointer, true);
  document.addEventListener("keydown", closeViewsMenuOnEscape, true);
  viewsMenu.button.addEventListener("click", () => {
    closeGraphMenu();
    closeExportMenu();
  }, true);
```

In `openGraphMenu` and the export button's click handler add `viewsMenu.close();`. In `cleanup` (search `document.removeEventListener("keydown", closeGraphMenuOnEscape, true);`) add the two matching `removeEventListener` calls.

- [ ] **Step 5: The chip's label and the gallery's timing**

Add, after the DOM block of Step 3:

```ts
  const activeView = (): GraphViewDefinition | null =>
    view && view !== "blank" ? viewByID(view.id) : null;
  const refreshViewChip = (): void => {
    const active = activeView();
    if (!active) {
      viewsMenu.setLabel(null, false);
      viewsMenu.refresh(null);
      return;
    }
    const edited = graphViewIsEdited(active, {
      nodes: model.nodes,
      layout: appearance.getLayout(),
      regions,
      filters: graphFilter.state(),
      folders: viewFolders(),
    });
    viewsMenu.setLabel(active.name, edited);
    viewsMenu.refresh(active.id);
  };
  /** The gallery shows once, for a graph that has never chosen and has papers. */
  const maybeShowGallery = (): void => {
    if (view !== null) return viewGallery.hide();
    const shown = visibleNodeCount();
    if (shown > 0) viewGallery.show(shown);
    else viewGallery.hide();
  };
  const showGallery = (): void => viewGallery.show(visibleNodeCount());
```

`visibleNodeCount()`: the number the rail's Scope line shows as "shown". Find how `updateSummary` computes it (search `cm-scope-count` or `shownCount`) and reuse that variable; if it is local to `updateSummary`, hoist it to a `let shownCount = 0` updated there.

`appearance` is created later in the file than the toolbar (search `const appearance = createAxesAppearance(`). Because `refreshViewChip` is only called from event handlers and after mount, referencing `appearance` inside a function body is fine; do not call it before `appearance` exists.

Call `refreshViewChip()` at the end of `updateSummary` (the summary refreshes after every filter and layout change, so the "(edited)" label follows the gear), and `maybeShowGallery()` at the end of `applyFilters` (search `applyFilters = (): void =>` and its closing). Also call `refreshViewChip()` in the appearance `onChange` callback (`currentLayout = layout;` block).

- [ ] **Step 6: Applying a view**

Add after `refreshViewChip`:

```ts
  const applyGraphView = (chosen: GraphViewDefinition): void => {
    const plan = planGraphView(chosen, {
      nodes: model.nodes,
      layout: appearance.getLayout(),
      filters: graphFilter.state(),
      folders: viewFolders(),
    });
    // Appearance goes through the gear's own controller, so its selects, the
    // instance's live layout and the preference all move together.
    appearance.setLayout(plan.layout);
    if (plan.regions !== null) {
      regions = [...plan.regions];
      ensureSwatchesFor();
    }
    graphFilter.setState({ ...plan.filters, collectionIDs: [] });
    view = { id: chosen.id };
    viewGallery.hide();
    applyFilters();
    notifyStateChange();
    refreshScopeRail();
    refreshViewChip();
    if (!isTutorialDismissed(chosen.id)) {
      const swatchCount = (renderer?.getTheme() ?? graphThemeFor("light"))
        .categorical.swatches.length;
      tutorialCard.show(
        chosen,
        tutorialChips(chosen, plan, swatchCount),
        tutorialFootnote(plan),
      );
    }
  };
```

`graphFilter.setState` fires `onChange` → `applyFilters` + `notifyStateChange` already (see `createPaperFilterController` at line 632); if so the explicit `applyFilters()` call is redundant but harmless. Check `ensureSwatchesFor` and `refreshScopeRail` are declared before this point or are `let` bindings assigned later (they are: lines 515-528 declare `applyFilters`, `notifyStateChange`, `refreshScopeRail` as `let`; `ensureSwatchesFor` is a `const` at line 1842, so place `applyGraphView` after it or convert the call into a deferred lookup). Simplest: place this whole block (Steps 5 to 7) right after `ensureSwatchesFor`'s definition.

- [ ] **Step 7: Save, edit, delete, copy, import**

```ts
  const savedNames = (): string[] => listSavedGraphViews().map((v) => v.name);
  const nameTaken = (name: string, except: GraphViewDefinition | null): boolean => {
    const wanted = name.trim().toLowerCase();
    if (isShippedViewName(wanted)) return true;
    return listSavedGraphViews().some(
      (v) => v.id !== except?.id && v.name.toLowerCase() === wanted,
    );
  };
  const copyText = (value: string): void => {
    (
      Zotero.Utilities.Internal as unknown as {
        copyTextToClipboard: (text: string) => void;
      }
    ).copyTextToClipboard(value);
    controller.setStatus("Copied");
  };
  const openSavePanel = (existing: GraphViewDefinition | null): void => {
    const layout = appearance.getLayout();
    const filters = graphFilter.state();
    const folders = viewFolders();
    const capture = (r: { name: string; paragraph: string }): GraphViewDefinition => {
      const captured = captureGraphView({
        name: r.name,
        paragraph: r.paragraph,
        layout,
        regions,
        filters,
        folders,
      });
      return existing ? { ...captured, id: existing.id } : captured;
    };
    savePanel.open({
      name: existing?.name ?? "",
      paragraph:
        existing?.paragraph ??
        draftParagraph(layout, regions.length, stripForDraft(filters)),
      captures: { regions: regions.length, filters: true },
      existing,
      nameTaken: (name) => nameTaken(name, existing),
      onCopyJSON: (r) => copyText(encodeGraphView(capture(r))),
      onSave: (r) => {
        const saved = capture(r);
        saveGraphView(saved);
        view = { id: saved.id };
        viewGallery.hide();
        notifyStateChange();
        refreshViewChip();
        const plan = planGraphView(saved, {
          nodes: model.nodes, layout, filters, folders,
        });
        const swatchCount = (renderer?.getTheme() ?? graphThemeFor("light"))
          .categorical.swatches.length;
        tutorialCard.show(saved, tutorialChips(saved, plan, swatchCount), tutorialFootnote(plan));
      },
      onDelete: existing
        ? () => {
            deleteGraphView(existing.id);
            if (view && view !== "blank" && view.id === existing.id) {
              view = "blank";
              notifyStateChange();
            }
            refreshViewChip();
          }
        : null,
    });
  };
  const stripForDraft = (filters: PaperListFilterState) => {
    const { collectionIDs: _c, relation: _r, ...rest } = filters;
    return rest;
  };
  const importView = async (): Promise<void> => {
    const decoded = await importGraphViewFile(document);
    if (!decoded) return;
    if (!decoded.ok) {
      Services.prompt.alert(
        document.defaultView,
        "Import view",
        `This file is not a Meristema view: the field "${decoded.field}" is missing or invalid.`,
      );
      return;
    }
    let imported = decoded.view;
    if (nameTaken(imported.name, null)) {
      let n = 2;
      while (nameTaken(`${imported.name} (${n})`, null)) n += 1;
      imported = { ...imported, name: `${imported.name} (${n})` };
    }
    saveGraphView(imported);
    applyGraphView(imported);
  };
```

`controller.setStatus` exists on the controller object built later (`controllerByMount.set(mount, controller)`); if `controller` is not in scope at this point, use the local status helper the toolbar uses (search `setStatus` or `toolbarStatus.textContent`). `Services.prompt.alert` matches the existing prompt use (B1).

- [ ] **Step 8: Plumb `view` through the state**

In `getState()` add `view,` after `title: options.title ?? null,`.

In `applyState`, after `categorySwatches = state.categorySwatches;`, add:

```ts
      view = state.view;
```

and at the end of `applyState` (after seeds are resolved and the projection rebuilt; search where it returns), add `refreshViewChip(); maybeShowGallery();`. In the request branch (search `// The request already shaped the graph; the state fills in what the`) add `view = options.initialState.view;` after `graphFilter.setState(...)`.

After `updateSummary();` at the mount's end (search `updateSummary();\n  const localCitationWarmupItemIDs`), add `refreshViewChip(); maybeShowGallery();`.

- [ ] **Step 9: `npm run check`**

Expected green. Type errors to expect and fix: `GraphViewDefinition["icon"]` vs `IconName` (Task 3 made them the same union); `PaperListFilterState` import in this file (add to the existing import from `./paperListViewService`); `LibraryCollectionFilter` import.

- [ ] **Step 10: Build and look**

Run `npm run build`. If the user's `zotero-plugin serve` is running, the plugin reloads in their Zotero; do not stop or restart it. If Zotero is not open, skip and rely on Task 9's suite.

- [ ] **Step 11: Commit**

```bash
git add src/services/graphViewService.ts
git commit -m "D4: the View chip applies a view, the gallery shows once, and the state carries the view"
```

---

### Task 8: Import through a file picker the suite can stub

**Spec:** "Import".

**Files:**
- Modify: `src/services/exportService.ts` (beside `chooseSavePath` at line 21)
- Modify: `src/services/graphViewService.ts` (Task 7's `importView` already calls `importGraphViewFile`)

**Interfaces (produced):**

```ts
export type PickOpenPath = (document: Document) => Promise<string | null>;
export async function chooseOpenPath(document: Document, o: { title: string; extension: string; filterLabel: string }): Promise<string | null>;
export async function importGraphViewFile(document: Document, pick: PickOpenPath = defaultViewPicker): Promise<ReturnType<typeof decodeGraphView> | null>;
```

- [ ] **Step 1: Implement in `exportService.ts`**

```ts
import { decodeGraphView } from "./graphViews";

export async function chooseOpenPath(
  document: Document,
  options: { title: string; extension: string; filterLabel: string },
): Promise<string | null> {
  const parentWindow = document.defaultView;
  if (!parentWindow) throw new Error("Unable to open the file dialog.");
  const picker = Components.classes["@mozilla.org/filepicker;1"].createInstance(
    Components.interfaces.nsIFilePicker,
  );
  picker.init((parentWindow as any).browsingContext, options.title, picker.modeOpen);
  picker.appendFilter(options.filterLabel, `*.${options.extension}`);
  picker.appendFilters(picker.filterAll);
  const result = await new Promise<number>((resolve) => picker.open(resolve));
  if (result !== picker.returnOK) return null;
  return String(picker.file?.path ?? "").trim() || null;
}

export type PickOpenPath = (document: Document) => Promise<string | null>;

const defaultViewPicker: PickOpenPath = (document) =>
  chooseOpenPath(document, {
    title: "Import view",
    extension: "json",
    filterLabel: "Meristema view (JSON)",
  });

/**
 * D4 import. The picker is a parameter so the Zotero suite can hand in a
 * temp file: an XPCOM picker built inside the function cannot be stubbed.
 * Returns null when the reader cancelled.
 */
export async function importGraphViewFile(
  document: Document,
  pick: PickOpenPath = defaultViewPicker,
): Promise<ReturnType<typeof decodeGraphView> | null> {
  const path = await pick(document);
  if (!path) return null;
  const contents = await Zotero.File.getContentsAsync(path);
  return decodeGraphView(String(contents));
}
```

For the suite (Task 9) the graph view needs a seam to inject the picker. Add to `GraphViewOptions` in `graphViewService.ts`:

```ts
  /** D4 import's file picker; the suite injects one that answers a temp path. */
  pickViewFile?: PickOpenPath;
```

and in Task 7's `importView` call `importGraphViewFile(document, options.pickViewFile)`. The host (`windowService.ts`) does not set it; the suite reaches it through the same test-only global the other suites use, if one exists (`grep -n "__meristemaTest\|testHooks" src/services/windowService.ts`). If none exists, add one: in `windowService.ts` where `createGraphView(...)` is called with the options object (line 633 area), spread `...(globalThis as any).__meristemaGraphViewOptions ?? {}` last, and document it in a comment as the suite's seam.

- [ ] **Step 2: `npm run check`** — green.

- [ ] **Step 3: Commit**

```bash
git add src/services/exportService.ts src/services/graphViewService.ts src/services/windowService.ts
git commit -m "D4: import a view from a JSON file through an injectable picker"
```

---

### Task 9: The Zotero suite

**Spec:** "Testing", Zotero suite.

**Files:**
- Create: `test/zotero/graphViews.test.ts`

The harness is `test/zotero/graphScopeRail.test.ts`: copy its `shown`, `customMenu`, `waitFor`, `command`, `graphTabs`, `tabContent`, `graphRoot` helpers and its `before` (which makes a collection with two items and opens New Graph from Tools › Meristema). Keep the fixture names distinct (`"D4 views"`).

- [ ] **Step 1: Write the cases**

```ts
/// <reference types="mocha" />
import { expect } from "chai";
import { config } from "../../package.json";
import {
  createSavedGraph,
  deleteSavedGraph,
} from "../../src/services/savedGraphService";
import { emptyGraphViewState } from "../../src/services/graphViewState";
import { delay } from "./visualHarness";

// … the helpers copied from graphScopeRail.test.ts …

describe("Graph views (D4)", function () {
  // … before/after as in graphScopeRail.test.ts, opening one graph from Tools › Meristema › New Graph
  //     with a collection "D4 views" holding two items dated 2020 and 2021 …

  function chip(): HTMLButtonElement {
    return graphRoot().querySelector(".cm-view-chip") as HTMLButtonElement;
  }
  function chipText(): string {
    return chip().textContent?.replace(/\s+/g, " ").trim() ?? "";
  }
  function viewRow(id: string): HTMLButtonElement {
    return graphRoot().querySelector(
      `.cm-view-row[data-view-id="${id}"]`,
    ) as HTMLButtonElement;
  }
  function gallery(): HTMLElement {
    return graphRoot().querySelector(".cm-view-gallery") as HTMLElement;
  }

  it("shows the gallery for a graph that never chose, and hides it on Start blank", async function () {
    this.timeout(30_000);
    await waitFor(() => gallery() && !gallery().hidden, 10_000);
    expect(gallery().hidden, "gallery shown").to.equal(false);
    expect(gallery().textContent).to.contain("How do you want to look at these");
    (Array.from(gallery().querySelectorAll("button")) as HTMLButtonElement[])
      .find((b) => b.textContent?.trim() === "Start blank")!
      .click();
    await delay(100);
    expect(gallery().hidden).to.equal(true);
    expect(chipText()).to.equal("View ▾");
  });

  it("applies Overview from the chip, labels it, and marks a gear edit", async function () {
    this.timeout(30_000);
    chip().click();
    await delay(50);
    viewRow("overview").click();
    await waitFor(() => chipText().includes("Overview"), 5_000);
    expect(chipText()).to.contain("View Overview");
    expect(chipText()).to.not.contain("(edited)");
    const card = graphRoot().querySelector(".cm-view-card") as HTMLElement;
    expect(card.hidden, "tutorial card").to.equal(false);
    expect(card.textContent).to.contain("Overview");
    // A gear change on an owned field: the label gains (edited).
    const gear = graphRoot().querySelector(".cm-appearance-button") as HTMLButtonElement;
    gear.click();
    await delay(50);
    const labels = graphRoot().querySelector(
      '.cm-appearance-panel select[data-role="labels"], .cm-appearance-panel select:last-of-type',
    ) as HTMLSelectElement;
    labels.value = "none";
    labels.dispatchEvent(new (graphRoot().ownerDocument.defaultView as any).Event("change", { bubbles: true }));
    await waitFor(() => chipText().includes("(edited)"), 5_000);
    expect(chipText()).to.contain("(edited)");
    gear.click();
  });

  it("ignores a click on a greyed view", async function () {
    this.timeout(30_000);
    const before = chipText();
    chip().click();
    await delay(50);
    const row = viewRow("cornerstones");
    expect(row.getAttribute("aria-disabled")).to.equal("true");
    expect(row.textContent).to.contain("Arrives with citation hops");
    row.click();
    await delay(200);
    expect(chipText()).to.equal(before);
    chip().click();
  });

  it("saves the current settings as a view and lists it under My views", async function () {
    this.timeout(30_000);
    chip().click();
    await delay(50);
    (Array.from(graphRoot().querySelectorAll(".cm-view-action")) as HTMLButtonElement[])
      .find((b) => b.textContent === "Save current as view…")!
      .click();
    await delay(50);
    const panel = graphRoot().querySelector(".cm-view-save") as HTMLElement;
    expect(panel.hidden).to.equal(false);
    const name = panel.querySelector(".cm-view-save-input") as HTMLInputElement;
    name.value = "D4 suite view";
    name.dispatchEvent(new (panel.ownerDocument.defaultView as any).Event("input", { bubbles: true }));
    (Array.from(panel.querySelectorAll("button")) as HTMLButtonElement[])
      .find((b) => b.textContent === "Save")!
      .click();
    await waitFor(() => chipText().includes("D4 suite view"), 5_000);
    chip().click();
    await delay(50);
    expect(graphRoot().querySelector(".cm-view-menu")?.textContent).to.contain("My views");
    expect(graphRoot().querySelector(".cm-view-menu")?.textContent).to.contain("D4 suite view");
    chip().click();
    const stored = String(Zotero.Prefs.get(`${config.prefsPrefix}.graphViews`, true) ?? "[]");
    expect(JSON.parse(stored).map((v: { name: string }) => v.name)).to.include("D4 suite view");
  });

  it("reopens a version 3 graph with the gallery and a version 4 one on its view", async function () {
    this.timeout(60_000);
    // A version 3 row, inserted raw: the store always writes the current version.
    const libraryID = Zotero.Libraries.userLibraryID;
    const v3 = { ...emptyGraphViewState(), version: 3 } as Record<string, unknown>;
    delete v3.view;
    const summary = await createSavedGraph(libraryID, "D4 v3 graph", emptyGraphViewState());
    const db = (Zotero as any).DB;
    await db.queryAsync(
      "UPDATE saved_graphs_v1 SET state = ? WHERE id = ?",
      [JSON.stringify(v3), summary.id],
    );
    // Open it from File › Open in the graph already on screen.
    const fileButton = Array.from(
      graphRoot().querySelectorAll(".cm-toolbar-button"),
    ).find((b) => b.textContent?.includes("File")) as HTMLButtonElement;
    fileButton.click();
    const entry = await waitFor(
      () =>
        Array.from(graphRoot().querySelectorAll(".cm-graph-menu-list button")).find(
          (b) => b.textContent?.includes("D4 v3 graph"),
        ) as HTMLButtonElement | undefined,
      10_000,
    );
    entry!.click();
    await waitFor(() => gallery() && !gallery().hidden, 15_000);
    expect(gallery().hidden, "gallery on a version 3 graph").to.equal(false);
    await deleteSavedGraph(summary.id);
  });
});
```

The saved-graph database handle: `savedGraphService.ts` takes a `connection`; find what the plugin passes (`grep -n "createSavedGraphStore\|pluginDatabase" src/services/savedGraphService.ts src/services/pluginDatabase.ts`) and use the same exported handle in the test (the raw `UPDATE` must hit the same SQLite file). If the store is behind `pluginDatabase.ts`, import its connection getter.

The labels select selector: read `createAxesAppearance` in `graphViewControls.ts` and give the label select `dataset.role = "labels"` if it has no stable hook; that is a one-line addition to Task 6's scope, allowed here.

Cleanup: in `after`, delete the `graphViews` preference (`Zotero.Prefs.clear(`${config.prefsPrefix}.graphViews`, true)`) and the dismissed one.

- [ ] **Step 2: Run the suite twice, keep the logs**

Run: `npm test 2>&1 | tee "$SCRATCH/npm-test-1.log"` then again to `npm-test-2.log`, where `$SCRATCH` is the scratchpad directory. Expected: `passing` counts equal to the previous run plus 5, `0 failing`, both runs. Timing-shaped failures (gallery not yet shown) get a longer `waitFor`, not a `delay`.

- [ ] **Step 3: Commit**

```bash
git add test/zotero/graphViews.test.ts src/services/graphViewControls.ts
git commit -m "D4: the Zotero suite walks the chip, the gallery, a save, a greyed row and a version 3 reopen"
```

---

### Task 10: Roadmap, manual batch, build

**Files:**
- Modify: `docs/superpowers/handoffs/2026-09-08-roadmap.md`
- Modify: `docs/superpowers/specs/2026-09-12-graph-views-design.md` (status line)

- [ ] **Step 1: Tick and log**

Tick D4's entry in the roadmap's "Design items from the Stage 2 walk-through" and append to it: "Built 2026-09-12 as `2026-09-12-graph-views.md`; three views greyed until Stage 3, Stage 4 and reading state." Add to the Log:

```
- 2026-09-12: D4 built. Views: five shipped (two live), chip after File,
  tutorial card, gallery once per graph, saved views in the profile, JSON
  import and export. Graph state is version 4 (`view`); version 3 records
  keep their regions. B41 stays open. Unit N cases; Zotero suite M passed,
  0 failed, two runs, logs kept.
```

Append to the Manual verification section:

```
- [ ] D4: the plot toolbar reads File, View, Filter, Similar, Export,
      Refresh, then the search box, on both themes. Supersedes B21's order
      check
- [ ] D4: open the View dropdown. Five rows with icon, name, one-liner; the
      three greyed ones read "Arrives with citation hops / reading state /
      shared citers" in muted text and do nothing on click; contrast is
      readable on both themes
- [ ] D4: apply Overview. The chip reads "View Overview"; the tutorial card
      sits bottom-right of the plot, 300px, with chips "x year", "y
      citations", "size citations", "colour uniform", "labels author-year"
      and a last line "Seeds and collections are untouched."; narrow the
      window until the plot is under 400px and the card still fits
- [ ] D4: change the y axis in the gear: the chip gains "(edited)"; reapply
      Overview from the dropdown: it goes back
- [ ] D4: open a folder graph of 300+ papers: the gallery covers the plot
      inset, the rail and toolbar stay usable behind it, the heading counts
      the visible papers; Start blank removes it and reopening the same
      graph shows no gallery
- [ ] D4: apply Folder map on a library with nested folders: one region per
      ticked subtree top, not one per child; with more than twelve, the card
      says "N regions, 12 colours"
- [ ] D4: Save current as view: the panel's Captures list ticks Axes,
      Colour, Size, Labels, Regions, Filters; Explore reads unavailable;
      Scope is unticked and dashed; a name that matches "Overview" is
      refused inline; Copy JSON shows "Copied" in the toolbar
- [ ] D4: the seven view icons at 16px in the dropdown and 28px in the
      gallery, both themes
```

Update the spec's Status line to "Built 2026-09-12; manual checks queued".

- [ ] **Step 2: Verify, build, commit**

Run `npm run check` (green), then `npm run build` last (the XPI must exist at `.scaffold/build/meristema.xpi` after the suite deleted it).

```bash
git add docs
git commit -m "Tick D4: graph views built; eight checks in the manual batch"
```

Push only if the roadmap's Stage rule applies (it does for every finished item): `git push origin main`.

---

## Self-review against the spec

- **Model, five views, user views, active view, migration, plumbing, wire form:** Tasks 1, 3, 4, 7.
- **Toolbar chip and dropdown, family, placement:** Tasks 6, 7.
- **Applying a view through the gear, normalisation, substituted chips:** Tasks 2, 3, 7.
- **Regions by name, unticked, ambiguous, "ticked" tops, overflow line:** Task 3 (`resolveViewRegions`, `tutorialFootnote`, `tutorialChips`).
- **Filters without collectionIDs and relation, decoder rejects:** Task 3.
- **Tutorial card, dismissal, shown after Save:** Tasks 4, 6, 7.
- **Gallery when null and papers > 0, Start blank, reopen from dropdown:** Tasks 6, 7.
- **Save panel, name collision, edit, delete, Copy JSON:** Tasks 6, 7.
- **Import with injected picker, " (2)" suffix, error dialog naming the field:** Tasks 7, 8.
- **Two tabs, reopen restores label only:** Task 7 (`applyState` sets `view` and refreshes the chip; nothing reapplies).
- **B41 stays a bug:** not touched; Task 7's `applyGraphView` uses `appearance.setLayout`, which persists as the gear does.
- **Tests listed in the spec:** Task 1 (v3 regions, v4 round-trip), Task 2 (normalise), Task 3 (apply, edited, codec, availability, chips), Task 4 (store), Task 9 (five Zotero cases).
- **Manual batch:** Task 10.

Type names used across tasks: `GraphViewRef` (Task 1), `normaliseLayoutFor`/`metricHasData` (Task 2), `GraphViewDefinition`, `ViewFolder`, `planGraphView`, `graphViewIsEdited`, `tutorialChips`, `tutorialFootnote`, `captureGraphView`, `draftParagraph`, `encodeGraphView`, `decodeGraphView`, `decodeGraphViewRecord`, `isShippedViewName`, `SHIPPED_GRAPH_VIEWS` (Task 3), the five store functions (Task 4), `createGraphViewsMenu`/`createTutorialCard`/`createViewGallery`/`createSavePanel` (Task 6), `importGraphViewFile`/`PickOpenPath` (Task 8). Task 7 consumes exactly those names.
