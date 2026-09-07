# Refresh Preserves State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A graph view refresh rebuilds the same graph instead of an empty one, and the Explore controls shrink to direction and scope behind the Key rail's gear.

**Architecture:** A plain-data `GraphViewState` (seeds, Explore settings, filters, camera, title) lives in a new DOM-free module. The view exposes it through its controller (`getState`, `applyState`), accepts it as `initialState`, and reports changes through `onStateChange`. The window service keeps the state on the instance and passes it back on every render, so the refresh that follows a citation update or a preference change is a restore. Ranking and the per-seed limit are removed from the product first, so the state only has to carry what stays.

**Tech Stack:** TypeScript, Zotero 7 plugin, hand-built DOM, `node --test` with chai for unit tests, the Zotero visual harness for view tests.

This is phase 1 of `docs/superpowers/specs/2026-09-07-durable-graphs-design.md`. Saved graphs and the context menu wording are phase 2 and are not in this plan.

## Global Constraints

- `npm run check` (lint, typecheck, unit tests) is the gate for every task. Never run `npm test` and never start or stop Zotero; `test/zotero/*` runs only inside Zotero and is the user's to run.
- Commit messages: sentence-case subject, no type prefix, trailers `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa`.
- Run prettier on any `docs/` or `README.md` file you change before committing.
- `GraphFocusState` keeps `ranking` and `maxPerDirection` as fields. The view sets `ranking: "relevance"` and `maxPerDirection: Number.POSITIVE_INFINITY` everywhere; no UI shows them.
- Explore settings the state carries: `direction` (`"both" | "references" | "cited-by"`) and `locality` (`"all" | "local"`) only.
- Item seeds are stored by Zotero item key (`itemKey`), never by numeric `itemID`. External seeds carry `identityKey` = `stableExternalWorkIdentity(work)` and the work inline; a work with no stable identity is dropped on serialization.
- `parseGraphViewState` never throws; it returns `null` for a wrong version or malformed input and fills missing optional fields with defaults.
- `onStateChange` fires debounced by one animation frame after a change to seeds, Explore settings, filters or title; never for camera moves.
- `initialState` is applied after the initial request (`initialFocusItemIDs`, `initialCollectionIDs`, `initialItemIDs`…) has been consumed; the request wins for the parts it names.
- The toolbar order after this plan: Filter, Seeds, Similar, Export, Refresh (the Graph menu is phase 2).
- `test/unit` has no DOM shim; DOM behaviour is tested in `test/zotero/graphViewVisual.test.ts`.

---

### Task 1: Remove ranking and the per-seed limit; move direction and scope behind the gear

**Files:**

- Modify: `src/services/graphViewService.ts` (Explore controls around lines 543–642, `closeFocusSettingsPopover` and its listeners around 1283–1567, `focusStateFromControls` ~1103, the two `focusRanking.value`/`focusLimit.value` sync blocks ~1415 and ~1672, `enterFocusSeeds` default state ~1948, the change listener loop ~3090, cleanup ~3680, `updateSummary` "more available" ~1098)
- Modify: `test/zotero/graphViewVisual.test.ts:262-273` (view 5)
- Modify: `README.md:47`

**Interfaces:**

- Consumes: `createAxesAppearance` from `src/services/graphViewControls.ts` returns `{ root, button, panel, setLayout, getLayout, close }`; `panel` is the gear's dialog and `panel.append(tabs, xPane, yPane, nodesPane)` builds it, so `panel.prepend(section)` puts a section above the axis tabs.
- Produces: two `<select>` elements `focusDirection` and `focusLocality` that Task 3 reads and writes; a `<fieldset class="cm-appearance-section cm-explore-section">` that is hidden while the graph is seedless. No exported signatures change.

- [ ] **Step 1: Update the visual test first so it describes the new toolbar**

In `test/zotero/graphViewVisual.test.ts`, view 5, replace the block that starts with `// A seedless graph has no seeds to show` and ends with the `explore.disabled` assertion with:

```ts
// A seedless graph has no seeds to show, but the Seeds button is how the
// first one is added, so it stays live. Direction and scope wait behind
// the gear, and only appear once there is a seed to explore from.
const seeds = active.root.querySelector(
  'button[aria-controls="meristema-focus-seed-popover"]',
) as HTMLButtonElement;
expect(seeds, "there is a Seeds button").to.not.equal(null);
expect(seeds.disabled, "and it is enabled while seedless").to.equal(false);
expect(
  active.root.querySelector(
    'button[aria-controls="meristema-focus-settings-popover"]',
  ),
  "the toolbar has no Explore button",
).to.equal(null);
const explore = active.root.querySelector(
  ".cm-appearance-panel .cm-explore-section",
) as HTMLElement;
expect(explore, "the gear panel has the Explore section").to.not.equal(null);
expect(explore.hidden, "hidden while seedless").to.equal(true);
expect(
  explore.querySelectorAll("select").length,
  "with direction and scope only",
).to.equal(2);
```

This test runs only inside Zotero; you cannot run it. Keep going.

- [ ] **Step 2: Delete the ranking and limit selects and the Explore popover**

In `src/services/graphViewService.ts`, delete the `focusRanking` block and the `focusLimit` block (from `const focusRanking = element(document, "select", "cm-select");` through `focusLimit.appendChild(option);\n  }`).

Replace everything from the comment `// The four Explore settings, in a popover…` through `focusSettingsMenu.append(focusSettingsButton, focusSettingsPopover);` with:

```ts
// Direction and scope are settings of the graph, so they live with the
// graph display settings behind the Key rail's gear, as that panel's first
// section. They mean nothing without a seed, so the section is hidden
// while the graph is seedless. Ranking and the per-seed limit are gone:
// every neighbour a seed has is shown.
const exploreSection = element(
  document,
  "fieldset",
  "cm-appearance-section cm-explore-section",
);
exploreSection.hidden = true;
exploreSection.style.display = "none";
exploreSection.appendChild(text(document, "legend", "Explore"));
for (const [label, control] of [
  ["Direction", focusDirection],
  ["Scope", focusLocality],
] as const) {
  const row = element(document, "label", "cm-appearance-row");
  row.append(text(document, "span", label), control);
  exploreSection.appendChild(row);
}
```

In the `toolbar.append(...)` call that follows, remove `focusSettingsMenu,` so it reads:

```ts
toolbar.append(
  graphFilter.root,
  focusSeedMenu,
  similarButton,
  exportWrap,
  refreshButton,
);
```

Replace the comment above `setSeeded` and the first lines of `setSeeded` so it reads:

```ts
  // The Seeds button stays in the toolbar on every path so the view keeps one
  // shape: it is how the first seed is added, so it is always live. The
  // Explore section behind the gear has nothing to set until there is a seed,
  // so it is hidden rather than disabled.
  const setSeeded = (seeded: boolean): void => {
    root.dataset.seeded = seeded ? "true" : "false";
    exploreSection.hidden = !seeded;
    exploreSection.style.display = seeded ? "" : "none";
```

Keep the rest of `setSeeded` as it is.

- [ ] **Step 3: Mount the section in the gear panel**

Directly after the `const appearance = createAxesAppearance(...)` statement (it ends with the `resetLayout` callback and `);`), add:

```ts
appearance.panel.prepend(exploreSection);
```

- [ ] **Step 4: Remove the popover's closer and listeners**

Delete `closeFocusSettingsPopover` (the whole `const closeFocusSettingsPopover = (restoreFocus = false): void => {...};`) and every call to it: in `updateFocusBar` (`closeFocusSettingsPopover();` in the `!focusProjection` branch), in the Seeds button click handler (`if (opening) closeFocusSettingsPopover();`), and in `openNodeMenu` (`closeFocusSettingsPopover();`).

Delete the `focusSettingsButton.addEventListener("click", ...)` block, the `closeFocusSettingsOnOutsidePointer` and `closeFocusSettingsOnEscape` functions with the comment above them (`// A pointer on an option of one of the popover's <select>s…`), their two `document.addEventListener` calls, and their two `document.removeEventListener` calls in `cleanup`.

`insideSelectDropdown` is still used by the appearance panel closer (`if (insideSelectDropdown(target)) return;` around line 849), so its import stays.

- [ ] **Step 5: Fix the state everywhere ranking and limit were read**

`focusStateFromControls`:

```ts
const focusStateFromControls = (seedKeys: string[]): GraphFocusState => ({
  seedKeys: [...new Set(seedKeys)],
  direction: focusDirection.value as GraphFocusDirection,
  locality: focusLocality.value as GraphFocusLocality,
  ranking: "relevance",
  maxPerDirection: Number.POSITIVE_INFINITY,
});
```

In `updateFocusBar` and in `activateFocusState`, delete the two lines `focusRanking.value = ...;` and `focusLimit.value = String(...);`, leaving the direction and locality lines.

In `enterFocusSeeds`, the default state becomes:

```ts
const state = options.state ?? {
  seedKeys: seeds.map((seed) => seed.key),
  direction: "both",
  locality: "all",
  ranking: "relevance",
  maxPerDirection: Number.POSITIVE_INFINITY,
};
```

The change listener loop becomes:

```ts
for (const control of [focusDirection, focusLocality]) {
  control.addEventListener("change", () => {
    if (!focusProjection) return;
    scheduleFocusRebuild();
  });
}
```

In `updateSummary`, the seeded branch no longer has hidden neighbours. Replace:

```ts
const hidden =
  focusProjection.hidden.references + focusProjection.hidden.citedBy;
summary.textContent = hidden ? `${base} - ${hidden} more available` : base;
```

with:

```ts
summary.textContent = base;
```

Remove the now-unused `GraphFocusRanking` type import from the `graphFocusService` import list if lint reports it.

- [ ] **Step 6: Run the gate**

Run: `npm run check`
Expected: lint clean, typecheck clean, 188 unit tests pass. If lint flags an unused identifier (`GraphFocusRanking`, `focusSettingsMenu`), remove it.

- [ ] **Step 7: README**

In `README.md` line 47 replace `include papers outside Zotero, and rank and limit neighbours.` with `include papers outside Zotero, and choose the direction and scope behind the gear.` Then run `npx prettier --write README.md`.

- [ ] **Step 8: Commit**

```bash
git add src/services/graphViewService.ts test/zotero/graphViewVisual.test.ts README.md
git commit -F - <<'MSG'
Move direction and scope behind the gear and drop ranking and the limit

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa
MSG
```

---

### Task 2: `GraphViewState` module

**Files:**

- Create: `src/services/graphViewState.ts`
- Modify: `src/services/paperListViewService.ts:685` (export the default filter state)
- Test: `test/unit/graphViewState.test.ts`

**Interfaces:**

- Consumes: `stableExternalWorkIdentity(work)` from `src/domain/workIdentity.ts`; `externalWorkToFocusNode(work, role)` from `src/services/graphFocusService.ts`; `PaperListFilterState` and the new `defaultPaperListFilterState()` from `src/services/paperListViewService.ts`; `GraphViewTransform` from `src/services/citationGraphRenderer.ts`; `CitationGraphNode` from `src/domain/graphTypes.ts`.
- Produces, all exported from `src/services/graphViewState.ts`:

```ts
export const GRAPH_VIEW_STATE_VERSION = 1;
export type GraphViewSeed =
  | { kind: "item"; itemKey: string }
  | { kind: "external"; identityKey: string; work: RelatedWorkMetadata };
export interface GraphViewExploreSettings {
  direction: GraphFocusDirection;
  locality: GraphFocusLocality;
}
export interface GraphViewState {
  version: 1;
  seeds: GraphViewSeed[];
  explore: GraphViewExploreSettings;
  filters: PaperListFilterState;
  camera: GraphViewTransform | null;
  title: string | null;
}
export function emptyGraphViewState(): GraphViewState;
export function seedFromNode(node: CitationGraphNode): GraphViewSeed | null;
export function resolveGraphViewSeeds(
  seeds: readonly GraphViewSeed[],
  libraryNodeForKey: (itemKey: string) => CitationGraphNode | null,
): { nodes: CitationGraphNode[]; dropped: number };
export function serializeGraphViewState(state: GraphViewState): string;
export function parseGraphViewState(json: string): GraphViewState | null;
```

- [ ] **Step 1: Export the default filter state**

In `src/services/paperListViewService.ts`, rename `function defaultFilterState()` to an exported function and keep a local alias so the file's other uses do not change:

```ts
export function defaultPaperListFilterState(): PaperListFilterState {
  return {
    collectionIDs: [],
    tag: null,
    relation: "all",
    itemType: null,
    yearMin: null,
    yearMax: null,
    includeMissingYear: true,
    includeMissingCitations: true,
    includeMissingReferences: true,
    excludeRetracted: false,
    openAccessOnly: false,
  };
}

const defaultFilterState = defaultPaperListFilterState;
```

- [ ] **Step 2: Write the failing tests**

Create `test/unit/graphViewState.test.ts`:

```ts
import { describe, it } from "node:test";
import { expect } from "chai";
import type { CitationGraphNode } from "../../src/domain/graphTypes";
import type { RelatedWorkMetadata } from "../../src/domain/citationTypes";
import {
  emptyGraphViewState,
  parseGraphViewState,
  resolveGraphViewSeeds,
  seedFromNode,
  serializeGraphViewState,
  type GraphViewState,
} from "../../src/services/graphViewState";

function work(
  overrides: Partial<RelatedWorkMetadata> = {},
): RelatedWorkMetadata {
  return {
    provider: "openalex",
    providerWorkID: null,
    doi: "10.1000/seed",
    title: "An external seed",
    year: 2020,
    authors: ["Ada Lovelace"],
    ...overrides,
  };
}

function localNode(itemID: number, itemKey: string): CitationGraphNode {
  return {
    key: `item:${itemID}`,
    itemID,
    itemKey,
    title: `Paper ${itemKey}`,
    abstract: null,
    sourceTitle: null,
    authors: [],
    year: 2021,
    publicationDate: null,
    citationSequence: null,
    doi: null,
    tags: [],
    collectionIDs: [],
    citationCount: null,
    referenceCount: null,
    resolvedReferenceCount: 0,
  } as unknown as CitationGraphNode;
}

describe("seedFromNode", function () {
  it("stores a library paper by its Zotero key", function () {
    expect(seedFromNode(localNode(7, "ABCD1234"))).to.deep.equal({
      kind: "item",
      itemKey: "ABCD1234",
    });
  });

  it("stores an external paper by its stable identity with the work inline", function () {
    const node = {
      ...localNode(0, "focus:doi:10.1000/seed"),
      kind: "external",
      externalWork: work(),
    } as unknown as CitationGraphNode;
    const seed = seedFromNode(node);
    expect(seed?.kind).to.equal("external");
    if (seed?.kind !== "external") return;
    expect(seed.identityKey).to.equal("doi:10.1000/seed");
    expect(seed.work.title).to.equal("An external seed");
  });

  it("drops an external paper with no stable identity", function () {
    const node = {
      ...localNode(0, "focus:candidate"),
      kind: "external",
      externalWork: work({ doi: null, title: "Only a title" }),
    } as unknown as CitationGraphNode;
    expect(seedFromNode(node)).to.equal(null);
  });
});

describe("resolveGraphViewSeeds", function () {
  it("resolves item seeds through the library and keeps their order", function () {
    const library = new Map([
      ["AAAA0001", localNode(1, "AAAA0001")],
      ["BBBB0002", localNode(2, "BBBB0002")],
    ]);
    const result = resolveGraphViewSeeds(
      [
        { kind: "item", itemKey: "BBBB0002" },
        { kind: "item", itemKey: "AAAA0001" },
      ],
      (itemKey) => library.get(itemKey) ?? null,
    );
    expect(result.dropped).to.equal(0);
    expect(result.nodes.map((node) => node.itemID)).to.deep.equal([2, 1]);
  });

  it("drops a seed whose item is gone and counts it", function () {
    const result = resolveGraphViewSeeds(
      [
        { kind: "item", itemKey: "GONE0000" },
        { kind: "item", itemKey: "AAAA0001" },
      ],
      (itemKey) => (itemKey === "AAAA0001" ? localNode(1, itemKey) : null),
    );
    expect(result.dropped).to.equal(1);
    expect(result.nodes.map((node) => node.itemKey)).to.deep.equal([
      "AAAA0001",
    ]);
  });

  it("builds an external seed node from the inline work", function () {
    const result = resolveGraphViewSeeds(
      [{ kind: "external", identityKey: "doi:10.1000/seed", work: work() }],
      () => null,
    );
    expect(result.dropped).to.equal(0);
    const node = result.nodes[0]!;
    expect(node.kind).to.equal("external");
    expect(node.itemID).to.equal(0);
    expect(node.title).to.equal("An external seed");
    expect(node.externalWork?.doi).to.equal("10.1000/seed");
  });
});

describe("serializeGraphViewState / parseGraphViewState", function () {
  const state: GraphViewState = {
    ...emptyGraphViewState(),
    seeds: [
      { kind: "item", itemKey: "AAAA0001" },
      { kind: "external", identityKey: "doi:10.1000/seed", work: work() },
    ],
    explore: { direction: "references", locality: "local" },
    filters: {
      ...emptyGraphViewState().filters,
      collectionIDs: [3, 4],
      tag: "read",
    },
    camera: { x: 12, y: -4, scale: 1.5 },
    title: "My graph",
  };

  it("round-trips through JSON", function () {
    expect(parseGraphViewState(serializeGraphViewState(state))).to.deep.equal(
      state,
    );
  });

  it("returns null for malformed input without throwing", function () {
    expect(parseGraphViewState("not json")).to.equal(null);
    expect(parseGraphViewState("42")).to.equal(null);
    expect(parseGraphViewState("null")).to.equal(null);
  });

  it("returns null for another version", function () {
    const other = JSON.stringify({ ...state, version: 2 });
    expect(parseGraphViewState(other)).to.equal(null);
  });

  it("fills missing optional fields with defaults", function () {
    const sparse = JSON.stringify({ version: 1, seeds: [] });
    expect(parseGraphViewState(sparse)).to.deep.equal(emptyGraphViewState());
  });

  it("drops malformed seeds and unknown Explore values", function () {
    const messy = JSON.stringify({
      version: 1,
      seeds: [
        { kind: "item", itemKey: "AAAA0001" },
        { kind: "item" },
        { kind: "external", identityKey: "x" },
        { kind: "mystery" },
      ],
      explore: { direction: "sideways", locality: "local" },
      filters: { tag: 5, excludeRetracted: true },
      camera: { x: 1, y: "two", scale: 1 },
      title: 9,
    });
    const parsed = parseGraphViewState(messy);
    expect(parsed?.seeds).to.deep.equal([
      { kind: "item", itemKey: "AAAA0001" },
    ]);
    expect(parsed?.explore).to.deep.equal({
      direction: "both",
      locality: "local",
    });
    expect(parsed?.filters.tag).to.equal(null);
    expect(parsed?.filters.excludeRetracted).to.equal(true);
    expect(parsed?.camera).to.equal(null);
    expect(parsed?.title).to.equal(null);
  });
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `node --import ./test/nodeResolve.mjs --test test/unit/graphViewState.test.ts`
Expected: FAIL, cannot find module `../../src/services/graphViewState`.

- [ ] **Step 4: Write the module**

Create `src/services/graphViewState.ts`:

```ts
import type { RelatedWorkMetadata } from "../domain/citationTypes";
import type { CitationGraphNode } from "../domain/graphTypes";
import { stableExternalWorkIdentity } from "../domain/workIdentity";
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

export function resolveGraphViewSeeds(
  seeds: readonly GraphViewSeed[],
  libraryNodeForKey: (itemKey: string) => CitationGraphNode | null,
): { nodes: CitationGraphNode[]; dropped: number } {
  const nodes: CitationGraphNode[] = [];
  let dropped = 0;
  for (const seed of seeds) {
    if (seed.kind === "item") {
      const node = libraryNodeForKey(seed.itemKey);
      if (node) nodes.push(node);
      else dropped += 1;
      continue;
    }
    nodes.push(externalWorkToFocusNode(seed.work, "seed"));
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
    if (!isRecord(value.work)) return null;
    const work = value.work as unknown as RelatedWorkMetadata;
    return {
      kind: "external",
      identityKey: value.identityKey,
      work: {
        ...work,
        authors: Array.isArray(work.authors) ? work.authors : [],
      },
    };
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
```

Note on `relation`: `PaperRelationFilter` is a string union; `sameType("relation")` accepts any string. If the union has a known list in `paperListViewService.ts`, prefer checking against it; otherwise this is acceptable because the filter controller ignores unknown values.

- [ ] **Step 5: Run the tests to see them pass**

Run: `node --import ./test/nodeResolve.mjs --test test/unit/graphViewState.test.ts`
Expected: 11 passing. If the external identity in the second test comes out with a different prefix than `doi:10.1000/seed`, read `stableWorkAliases` in `src/domain/workIdentity.ts` and set the expectation to what it produces for a DOI; the point of the test is that the key is stable and derived from the DOI.

- [ ] **Step 6: Run the gate and commit**

Run: `npm run check`
Expected: clean, 199 unit tests.

```bash
git add src/services/graphViewState.ts src/services/paperListViewService.ts test/unit/graphViewState.test.ts
git commit -F - <<'MSG'
Describe a graph as serialisable state

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa
MSG
```

---

### Task 3: The view hands its state out and accepts it

**Files:**

- Modify: `src/services/paperListViewService.ts` (`PaperFilterController` interface ~82–91 and the returned object ~1199–1223)
- Modify: `src/services/graphViewService.ts` (`GraphViewController` ~159–169, `GraphViewOptions` ~192–207, `scheduleFocusFit` ~737, `applyFocusProjection` ~1569, `exitFocus` ~2074, the Explore change listeners, the `graphFilter` `onChange`, the controller object ~3520, the initial request block ~3562, cleanup)
- Test: `test/zotero/graphViewVisual.test.ts` (new view 13)

**Interfaces:**

- Consumes: everything Task 2 exports; `focusDirection`/`focusLocality` selects from Task 1; existing closures `focusProjection`, `focusSeedRegistry`, `addFocusSeeds`, `exitFocus`, `graphFilter`, `renderer`, `libraryModel`, `scheduleCameraAction`, `libraryCollectionFilterBeforeFocus`.
- Produces:

```ts
// PaperFilterController
setState(state: PaperListFilterState): void;
// GraphViewController
getState(): GraphViewState;
applyState(state: GraphViewState): GraphFocusResult;
// GraphViewOptions
initialState?: GraphViewState | null;
title?: string | null;
onStateChange?: (state: GraphViewState) => void;
```

- [ ] **Step 1: Write the failing visual test**

Append to `test/zotero/graphViewVisual.test.ts`, before the final `});`:

```ts
it("view 13 — a view rebuilt from its own state keeps its seeds, settings and filters", async function () {
  this.timeout(90_000);
  const first = await open(60);
  const controller = getGraphViewController(first.mount)!;
  const [a, b] = first.model.nodes as [
    (typeof first.model.nodes)[number],
    (typeof first.model.nodes)[number],
  ];
  expect(controller.openFocusItems([a.itemID, b.itemID])).to.equal("selected");
  await settle(first.window, 6);

  const direction = first.root.querySelector(
    ".cm-explore-section select",
  ) as HTMLSelectElement;
  direction.value = "references";
  direction.dispatchEvent(new (first.window as any).Event("change"));
  await settle(first.window, 6);

  const state = controller.getState();
  expect(state.seeds, "both seeds, by key, in order").to.deep.equal([
    { kind: "item", itemKey: a.itemKey },
    { kind: "item", itemKey: b.itemKey },
  ]);
  expect(state.explore.direction).to.equal("references");
  expect(state.camera, "the camera is read on demand").to.not.equal(null);
  first.close();

  // A rebuilt view: the same corpus, handed the state the first one gave.
  stage = await openViewStage(first.model, {
    initialState: {
      ...state,
      filters: { ...state.filters, excludeRetracted: true },
    },
  });
  const second = stage;
  await settle(second.window, 12);
  const rebuilt = getGraphViewController(second.mount)!;
  const restored = rebuilt.getState();
  expect(restored.seeds).to.deep.equal(state.seeds);
  expect(restored.explore).to.deep.equal(state.explore);
  expect(restored.filters.excludeRetracted).to.equal(true);
  const seedsButton = second.root.querySelector(
    'button[aria-controls="meristema-focus-seed-popover"]',
  ) as HTMLButtonElement;
  expect(seedsButton.textContent?.trim()).to.equal("2 seeds");
  const filterButton = second.root.querySelector(
    '.cm-plot-toolbar button[aria-label^="Filter papers"]',
  ) as HTMLButtonElement;
  expect(filterButton.getAttribute("aria-label")).to.equal(
    "Filter papers (1 active)",
  );
  expect(second.errors, "nothing threw in the background").to.deep.equal([]);
});
```

`stage` is the suite-level variable the existing `open` helper assigns so `afterEach` can close it; assigning the second view to it keeps that cleanup. Check the top of the `describe` for its exact name and use that. If `openViewStage`'s first parameter needs a corpus rather than a model, pass `first.model` all the same: `makeSnapshot` builds the snapshot from the model's nodes.

This test runs only inside Zotero; you cannot run it. Keep going.

- [ ] **Step 2: Filter controller `setState`**

In `src/services/paperListViewService.ts`, add to the `PaperFilterController` interface after `setCollectionIDs`:

```ts
  /** Replaces every filter at once, then fires `onChange` once. */
  setState(state: PaperListFilterState): void;
```

In the returned object, after `setCollectionIDs`, add:

```ts
    setState: (state) => {
      filters = {
        ...defaultFilterState(),
        ...state,
        collectionIDs: [
          ...new Set(
            state.collectionIDs.filter((id) => Number.isInteger(id) && id > 0),
          ),
        ],
      };
      updateFilterButton();
      filterPopup.close();
      options.onChange();
    },
```

The popup rebuilds its menu from `filters` when it next opens, so no rebuild is needed here.

- [ ] **Step 3: Controller and options types**

In `src/services/graphViewService.ts`, import from the new module:

```ts
import {
  emptyGraphViewState,
  resolveGraphViewSeeds,
  seedFromNode,
  type GraphViewState,
} from "./graphViewState";
```

Extend `GraphViewController`:

```ts
  /** The graph as a recipe: seeds, Explore settings, filters, camera, title. */
  getState(): GraphViewState;
  /** Rebuilds the graph from a recipe. Seeds whose item is gone are dropped. */
  applyState(state: GraphViewState): GraphFocusResult;
```

Extend `GraphViewOptions`:

```ts
  /** Applied after the initial request, so a request wins where both speak. */
  initialState?: GraphViewState | null;
  /** The custom title the host gave this view, reported back in `getState`. */
  title?: string | null;
  /**
   * Fires after seeds, Explore settings, filters or the title change, once
   * per animation frame. Camera moves never fire it; read `getState()` for
   * the camera when it is needed.
   */
  onStateChange?: (state: GraphViewState) => void;
```

- [ ] **Step 4: A restored camera beats the post-refresh fit**

Near `let cameraFrame = 0;` add:

```ts
/**
 * A camera handed in with a state. The seeds' automatic relationship check
 * ends with a fit, which would throw a restored camera away; while this is
 * set, that fit places the camera here instead.
 */
let restoredCamera: GraphViewTransform | null = null;
```

`GraphViewTransform` is already imported from the renderer; if not, add it to that import as a type.

In `scheduleFocusFit`, replace `renderer?.fitVisibleNodes();` inside `if (stableFrames >= 2 || attempts >= 24) {` with:

```ts
if (restoredCamera) {
  renderer?.setViewTransform(restoredCamera);
  restoredCamera = null;
} else {
  renderer?.fitVisibleNodes();
}
```

In `exitFocus`, after `focusSeedRegistry.clear();` add `restoredCamera = null;`.

- [ ] **Step 5: `getState`, `notifyStateChange`, `applyState`**

Directly after `const addFocusItems = ...` (just before `syncMapPinnedKeys(false); applyFilters();` that precede the controller), add:

```ts
const getState = (): GraphViewState => {
  const seeds = focusProjection
    ? focusProjection.state.seedKeys
        .map((key) => focusSeedRegistry.get(key) ?? null)
        .filter((node): node is CitationGraphNode => node !== null)
        .map(seedFromNode)
        .filter((seed): seed is NonNullable<typeof seed> => seed !== null)
    : [];
  // Entering Explore stashes the library's collection scope and clears the
  // control, so the scope a seeded graph belongs to is the stashed one.
  const filters = graphFilter.state();
  if (focusProjection && libraryCollectionFilterBeforeFocus !== undefined) {
    filters.collectionIDs = [...libraryCollectionFilterBeforeFocus];
  }
  return {
    ...emptyGraphViewState(),
    seeds,
    explore: {
      direction: focusDirection.value as GraphFocusDirection,
      locality: focusLocality.value as GraphFocusLocality,
    },
    filters,
    camera: renderer?.getViewTransform() ?? null,
    title: options.title ?? null,
  };
};

let stateChangeFrame = 0;
const notifyStateChange = (): void => {
  if (!options.onStateChange || stateChangeFrame || cleaned) return;
  const view = document.defaultView;
  const run = (): void => {
    stateChangeFrame = 0;
    if (!cleaned) options.onStateChange?.(getState());
  };
  stateChangeFrame = view
    ? view.requestAnimationFrame(run)
    : (setTimeout(run, 0) as unknown as number);
};

const applyState = (state: GraphViewState): GraphFocusResult => {
  focusDirection.value = state.explore.direction;
  focusLocality.value = state.explore.locality;
  // Filters first, collections included: entering Explore below stashes
  // the collection scope, so it comes back when the last seed goes.
  if (focusProjection) exitFocus();
  graphFilter.setState(state.filters);
  const paperByKey = localPaperByKey(snapshot);
  const { nodes } = resolveGraphViewSeeds(state.seeds, (itemKey) => {
    const paper = paperByKey.get(itemKey);
    return paper ? libraryNodeForItem(paper.itemID) : null;
  });
  if (nodes.length) {
    restoredCamera = state.camera;
    if (!addFocusSeeds(nodes)) {
      restoredCamera = null;
      return "not-found";
    }
    return "selected";
  }
  if (state.camera) {
    const camera = state.camera;
    scheduleCameraAction(() => renderer?.setViewTransform(camera));
  }
  return state.seeds.length ? "not-found" : "selected";
};
```

`localPaperByKey` already exists at module level (`function localPaperByKey(snapshot)`); `libraryNodeForItem` is the closure Task 2 of the seed entry points work forward-declared. If `libraryNodeForItem` is declared after this point, move this block below it or use the existing `libraryNodeForSeedRow` forward declaration, which is assigned to the same function.

Add the two methods to the controller object:

```ts
    getState,
    applyState,
```

- [ ] **Step 6: Fire `notifyStateChange` where the recipe changes**

- At the end of `applyFocusProjection`, after `updateFocusBar();`: `notifyStateChange();`
- At the end of `exitFocus` (after the selection restore is scheduled, before the closing `};`): `notifyStateChange();`
- In the Explore change listener loop, after `scheduleFocusRebuild();`: `notifyStateChange();` (the projection rebuild also fires it a frame later; the debounce collapses them).
- The `graphFilter` `onChange` becomes:

```ts
    onChange: () => {
      applyFilters();
      notifyStateChange();
    },
```

`applyFilters` is a `let` assigned later; calling it inside a closure is already how the code works, so keep that shape. `notifyStateChange` is a `const` defined after `graphFilter`, which is fine because the callback runs later; if lint complains about use-before-define, declare `let notifyStateChange: () => void = () => undefined;` near the top of `renderGraphView` and assign it in Step 5 instead of declaring it with `const`.

- [ ] **Step 7: Apply the initial state and clean up**

After the initial request block (the `if (options.initialFocusItemIDs?.length) {...} else if ... controller.replaceMapItems([options.initialItemID]); }` chain) and before `updateSummary();`, add:

```ts
if (options.initialState) {
  const request = Boolean(
    options.initialFocusItemIDs?.length ||
    options.initialFocusItemID ||
    options.initialCollectionIDs?.length ||
    options.initialItemIDs?.length ||
    options.initialItemID,
  );
  if (request) {
    // The request already shaped the graph; the state only fills in what
    // the request does not name.
    focusDirection.value = options.initialState.explore.direction;
    focusLocality.value = options.initialState.explore.locality;
    if (!focusProjection) graphFilter.setState(options.initialState.filters);
    else scheduleFocusRebuild();
  } else {
    applyState(options.initialState);
  }
}
```

In `cleanup`, after `cleaned = true;`, add:

```ts
if (stateChangeFrame) {
  const view = document.defaultView;
  if (view) view.cancelAnimationFrame(stateChangeFrame);
  else clearTimeout(stateChangeFrame);
  stateChangeFrame = 0;
}
```

- [ ] **Step 8: Run the gate and commit**

Run: `npm run check`
Expected: clean, 199 unit tests.

```bash
git add src/services/graphViewService.ts src/services/paperListViewService.ts test/zotero/graphViewVisual.test.ts
git commit -F - <<'MSG'
Let a graph view hand out its state and rebuild from it

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa
MSG
```

---

### Task 4: The window service keeps the state across refreshes

**Files:**

- Modify: `src/services/windowService.ts` (`GraphInstanceState` ~34–51, `createGraphInstance` ~71–104, `renderDetachedWindow` ~316–362, `renderTab` ~683–736, the tab `onClose` ~940–955, `renameGraphView` ~1009–1024)
- Modify: `docs/superpowers/specs/2026-09-07-durable-graphs-design.md` (Status)

**Interfaces:**

- Consumes: `getGraphViewController(mount).getState()`, `initialState`, `title`, `onStateChange` from Task 3; `GraphViewState` from Task 2.
- Produces: `GraphInstanceState.viewState: GraphViewState | null`, read by phase 2's Save.

- [ ] **Step 1: The instance field**

Add to `GraphInstanceState`:

```ts
/**
 * The graph as a recipe, kept across renders. A refresh rebuilds the view
 * from this rather than from nothing, and the view reports every change
 * back into it.
 */
viewState: GraphViewState | null;
```

Import the type: `import type { GraphViewState } from "./graphViewState";`. In `createGraphInstance`, add `viewState: null,` after `mapPinnedItemIDs: [],`. In the tab `onClose`, after `instance.mapPinnedItemIDs = [];`, add `instance.viewState = null;`.

- [ ] **Step 2: Capture before every render, hand back on every render**

Add a helper above `renderDetachedWindow`:

```ts
/**
 * What the live view knows that the instance does not yet: the camera, which
 * the view never reports on its own, and any change still waiting for its
 * animation frame. Read just before the view is torn down for a render.
 */
function captureViewState(
  instance: GraphInstanceState,
  mount: Element | null,
): void {
  if (!mount) return;
  const live = getGraphViewController(mount)?.getState();
  if (live) instance.viewState = live;
}

function viewStateOptions(
  instance: GraphInstanceState,
  libraryID: number,
): Pick<GraphViewOptions, "initialState" | "title" | "onStateChange"> {
  // A view moving to another library keeps nothing: its seeds are that
  // library's items and its collections are that library's folders.
  if (instance.libraryID !== null && instance.libraryID !== libraryID) {
    instance.viewState = null;
  }
  return {
    initialState: instance.viewState,
    title: instance.customTitle ? instance.title : null,
    onStateChange: (state) => {
      instance.viewState = state;
    },
  };
}
```

Import `GraphViewOptions` as a type from `./graphViewService` (it is exported).

In `renderDetachedWindow`, before `instance.libraryID = snapshot.libraryID;`, add `captureViewState(instance, mount);` and compute `const stateOptions = viewStateOptions(instance, snapshot.libraryID);` before that assignment too. Spread `...stateOptions,` into the `renderGraphView` options after `initialCollectionIDs: request.collectionIDs,`.

In `renderTab`, before `instance.libraryID = snapshot.libraryID;`, add:

```ts
captureViewState(instance, container);
const stateOptions = viewStateOptions(instance, snapshot.libraryID);
```

and spread `...stateOptions,` into its `renderGraphView` options after `initialCollectionIDs: request.collectionIDs,`.

`renderTab` renders inside a `requestAnimationFrame`, and `prepareContainer` runs before it; neither destroys the previous view, `renderGraphView` does when it clears the mount, so capturing at the top of `renderTab` reads the live view.

- [ ] **Step 3: Rename keeps the state's title**

In `renameGraphView`, after `instance.customTitle = true;`, add:

```ts
if (instance.viewState)
  instance.viewState = { ...instance.viewState, title: normalized };
```

- [ ] **Step 4: Gate, spec status, commit**

Run: `npm run check`
Expected: clean.

In the spec, change `**Status:** Approved` to `**Status:** Phase 1 implemented` and run `npx prettier --write docs/superpowers/specs/2026-09-07-durable-graphs-design.md`.

```bash
git add src/services/windowService.ts docs/superpowers/specs/2026-09-07-durable-graphs-design.md
git commit -F - <<'MSG'
Keep a graph's state on its instance so a refresh restores it

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa
MSG
```

- [ ] **Step 5: Hand the manual check to the user**

Cannot be automated here. The user runs, in Zotero: New PhD Graph, add a seed, add a node that is not in Zotero as a seed, Add to Zotero from its detail pane. Expected: the graph keeps both seeds and the imported one turns local. Then change a preference in the Meristema settings pane: the graph keeps its seeds.
