# The Scope Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the graph's focus projection with one additive model whose
visibility is a pure function, and gather the controls that feed it into a
Scope section at the top of the left rail.

**Architecture:** Two new DOM-free modules carry the logic —
`graphScopeModel.ts` decides which papers are drawn and what the rail counts,
`graphScopeRailModel.ts` decides which rows the Scope section draws. The focus
projection stops being the graph and becomes a lookup of what each seed
reached plus the external nodes it brought in, which are merged into the model
rather than replacing it. `graphViewService.ts` keeps the DOM and the wiring;
every decision it used to make inline moves into one of the two pure modules
so the tests can reach it.

**Tech Stack:** TypeScript, Zotero 9 plugin (zotero-plugin-scaffold),
`node --test` with chai for unit tests, Mocha inside a live Zotero for
`test/zotero`, plain CSS in `addon/content/graph.css`, Fluent for locale.

**Spec:** `docs/superpowers/specs/2026-09-08-graph-scope-rail-design.md`,
approved 2026-09-08. Its decisions are settled; do not re-open them.

## Global Constraints

- Branch `graph-scope-rail`. One commit per task, message ending with the
  attribution block used in Task 1's commit step.
- `npm run check` (prettier, eslint, `tsc --noEmit` twice, unit tests) is the
  gate for **every** task. A task is not done until it passes.
- `npm test` launches the dev Zotero and runs `test/zotero`; the user has said
  it may be run from a session. Three cases already fail or flake on `main` —
  "view 10", "view 15", and `savedGraphMenu.test.ts` "lists the saved graphs
  on the first showing". They are not regressions and are not fixed here.
- **No colour literal may appear outside `src/services/graphTheme.ts`.** An
  ESLint rule enforces it. New colours go into both `LIGHT_THEME` and
  `DARK_THEME`, and through `graphThemeCustomProperties` when CSS needs them.
- `src/services/graphScopeModel.ts` and `src/services/graphScopeRailModel.ts`
  are DOM-free: no `document`, no `Zotero`, and no import of a module that has
  either. They are what the unit tests reach.
- Prettier: `printWidth: 80`, `tabWidth: 2`, `endOfLine: lf`. Run
  `npm run lint:fix` before committing if formatting drifts.
- `GRAPH_VIEW_STATE_VERSION` becomes `2`. `parseGraphViewState` must never
  throw, and must still return `null` for malformed input and for a version it
  does not know.
- The Key section of the rail is unchanged in this stage: it emphasises and
  never filters. Scope must not be built out of `KeySection`.
- Out of scope; do not build: citation hops and their fetching, the citation
  floor, shared citers, the Scope presets (Full/Balanced/Core), the Key's
  shared-citer tiers, F3, B7.

---

### Task 1: State version 2 and its migration

`GraphViewState` gains the fields the rail needs, the tick shape, and a
migration, before anything reads them. `parseGraphViewState` returns `null`
for any version but the current one, so shipping version 2 without the
migration would silently destroy every saved graph. That is why this is first.

**Files:**

- Create: `src/services/graphScopeModel.ts` (the tick type and its helpers
  only; the visibility order arrives in Task 2)
- Modify: `src/services/graphViewState.ts`
- Test: `test/unit/graphScopeModel.test.ts` (create),
  `test/unit/graphViewState.test.ts` (extend)

**Interfaces:**

- Consumes: `PaperListFilterState` and `defaultPaperListFilterState` from
  `paperListViewService.ts`, unchanged.
- Produces, from `graphScopeModel.ts`:
  `type GraphViewCollectionTicks = { base: "all"; except: number[] } | { base: "none"; except: number[] }`;
  `allCollectionsTicked(): GraphViewCollectionTicks`;
  `onlyCollectionsTicked(collectionIDs: readonly number[]): GraphViewCollectionTicks`;
  `isCollectionTicked(ticks: GraphViewCollectionTicks, collectionID: number): boolean`;
  `setCollectionTicks(ticks: GraphViewCollectionTicks, collectionIDs: readonly number[], ticked: boolean): GraphViewCollectionTicks`;
  `expandTicksThroughDescendants(ticks: GraphViewCollectionTicks, descendantsByID: ReadonlyMap<number, readonly number[]>): GraphViewCollectionTicks`;
  `type CollectionTickState = "on" | "off" | "mixed"`;
  `collectionTickState(ticks: GraphViewCollectionTicks, collectionID: number, descendantIDs: readonly number[]): CollectionTickState`.
- Produces, from `graphViewState.ts`: `GRAPH_VIEW_STATE_VERSION = 2` and a
  `GraphViewState` carrying `collections: GraphViewCollectionTicks`,
  `includeUnfiled: boolean`, `includeExternal: boolean`,
  `hiddenKeys: string[]`, and the non-persisted `ticksNeedDescendants?: boolean`.

- [x] **Step 1: Write the failing tick tests**

Create `test/unit/graphScopeModel.test.ts`:

```ts
import { describe, it } from "node:test";
import { expect } from "chai";
import {
  allCollectionsTicked,
  collectionTickState,
  expandTicksThroughDescendants,
  isCollectionTicked,
  onlyCollectionsTicked,
  setCollectionTicks,
} from "../../src/services/graphScopeModel";

describe("collection ticks", function () {
  it("ticks every folder under the all base, including one made later", function () {
    const ticks = allCollectionsTicked();
    expect(isCollectionTicked(ticks, 1)).to.equal(true);
    expect(isCollectionTicked(ticks, 999)).to.equal(true);
  });

  it("ticks only the named folders under the none base", function () {
    const ticks = onlyCollectionsTicked([2, 3]);
    expect(isCollectionTicked(ticks, 2)).to.equal(true);
    expect(isCollectionTicked(ticks, 4)).to.equal(false);
    expect(isCollectionTicked(ticks, 999)).to.equal(false);
  });

  it("writes a parent's tick to every descendant", function () {
    const off = setCollectionTicks(allCollectionsTicked(), [1, 11, 12], false);
    expect(isCollectionTicked(off, 1)).to.equal(false);
    expect(isCollectionTicked(off, 11)).to.equal(false);
    expect(isCollectionTicked(off, 12)).to.equal(false);
    const on = setCollectionTicks(off, [1, 11, 12], true);
    expect(isCollectionTicked(on, 11)).to.equal(true);
  });

  it("leaves a parent mixed when a descendant is unticked afterwards", function () {
    const off = setCollectionTicks(allCollectionsTicked(), [11], false);
    expect(collectionTickState(off, 1, [11, 12])).to.equal("mixed");
    expect(collectionTickState(off, 11, [])).to.equal("off");
    expect(collectionTickState(allCollectionsTicked(), 1, [11, 12])).to.equal(
      "on",
    );
  });

  it("never mutates the ticks it is given", function () {
    const ticks = onlyCollectionsTicked([2]);
    setCollectionTicks(ticks, [3], true);
    expect(ticks.except).to.deep.equal([2]);
  });

  it("expands each exception through its descendants", function () {
    const descendants = new Map<number, readonly number[]>([
      [1, [11, 12]],
      [11, []],
    ]);
    const expanded = expandTicksThroughDescendants(
      onlyCollectionsTicked([1]),
      descendants,
    );
    expect(expanded).to.deep.equal({ base: "none", except: [1, 11, 12] });
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '../../src/services/graphScopeModel'`.

- [x] **Step 3: Write the tick module**

Create `src/services/graphScopeModel.ts`:

```ts
/**
 * Which papers a graph draws, and what the Scope rail counts.
 *
 * DOM-free and pure on purpose. Stages 3 and 4 insert the hop toggles, the
 * citation floor and the shared-citer filter into the same order, so this is
 * one function with tests rather than a sequence of early returns inside
 * `applyFilters`.
 */

/**
 * Folder ticks as a base and its exceptions, never as a list of ticked
 * folders. A library graph is `all`, so a folder created next week has its
 * papers on the plot as the rest of the library does; a graph opened on two
 * folders is `none`, so that same new folder does not quietly appear in a
 * graph that was never about it. The base is set when the graph is created,
 * and unticking rows never flips it.
 */
export type GraphViewCollectionTicks =
  /** Every folder is ticked except these. A folder made later is ticked. */
  | { base: "all"; except: number[] }
  /** No folder is ticked except these. A folder made later is not. */
  | { base: "none"; except: number[] };

export type CollectionTickState = "on" | "off" | "mixed";

function normalizedIDs(ids: readonly number[]): number[] {
  return [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))].sort(
    (a, b) => a - b,
  );
}

export function allCollectionsTicked(): GraphViewCollectionTicks {
  return { base: "all", except: [] };
}

export function onlyCollectionsTicked(
  collectionIDs: readonly number[],
): GraphViewCollectionTicks {
  return { base: "none", except: normalizedIDs(collectionIDs) };
}

export function isCollectionTicked(
  ticks: GraphViewCollectionTicks,
  collectionID: number,
): boolean {
  const listed = ticks.except.includes(collectionID);
  return ticks.base === "all" ? !listed : listed;
}

/**
 * Tick or untick a set of folders at once. The caller passes the folder and
 * every descendant of it, because toggling a parent writes the same tick to
 * its whole subtree: `collectionScopeIDs` already expands a selected folder
 * that way, so a tree where a parent left its children alone would quietly
 * shrink every saved folder graph the first time it was opened.
 */
export function setCollectionTicks(
  ticks: GraphViewCollectionTicks,
  collectionIDs: readonly number[],
  ticked: boolean,
): GraphViewCollectionTicks {
  // Under `all` an exception is an unticked folder; under `none` it is a
  // ticked one. One expression, so the two halves cannot drift apart.
  const isException = ticked !== (ticks.base === "all");
  const except = new Set(ticks.except);
  for (const collectionID of normalizedIDs(collectionIDs)) {
    if (isException) except.add(collectionID);
    else except.delete(collectionID);
  }
  return ticks.base === "all"
    ? { base: "all", except: normalizedIDs([...except]) }
    : { base: "none", except: normalizedIDs([...except]) };
}

/**
 * Every exception grows to cover its descendants. Used once, on a recipe
 * migrated from version 1: that recipe named the folders the graph was scoped
 * to, and version 1 drew each of them through `descendants()`, so the ticks it
 * becomes have to say the same thing. Never applied to ticks the rail wrote —
 * a child unticked under a ticked parent would come back.
 */
export function expandTicksThroughDescendants(
  ticks: GraphViewCollectionTicks,
  descendantsByID: ReadonlyMap<number, readonly number[]>,
): GraphViewCollectionTicks {
  const except = new Set(ticks.except);
  for (const collectionID of ticks.except) {
    for (const descendant of descendantsByID.get(collectionID) ?? []) {
      except.add(descendant);
    }
  }
  return ticks.base === "all"
    ? { base: "all", except: normalizedIDs([...except]) }
    : { base: "none", except: normalizedIDs([...except]) };
}

/**
 * What the folder's checkbox draws. A parent whose descendants disagree with
 * it is mixed; each child still owns a checkbox of its own.
 */
export function collectionTickState(
  ticks: GraphViewCollectionTicks,
  collectionID: number,
  descendantIDs: readonly number[],
): CollectionTickState {
  const own = isCollectionTicked(ticks, collectionID);
  const disagrees = descendantIDs.some(
    (id) => isCollectionTicked(ticks, id) !== own,
  );
  if (disagrees) return "mixed";
  return own ? "on" : "off";
}
```

- [x] **Step 4: Run the tick tests**

Run: `npm run test:unit`
Expected: PASS, with the six new cases green.

- [x] **Step 5: Write the failing state tests**

In `test/unit/graphViewState.test.ts`, add `GRAPH_VIEW_STATE_VERSION` to the
import from `graphViewState`, and append these cases inside the existing
`describe("serializeGraphViewState / parseGraphViewState")` block:

```ts
it("round-trips a version 2 state", function () {
  const state: GraphViewState = {
    ...emptyGraphViewState(),
    collections: { base: "none", except: [4, 7] },
    includeUnfiled: false,
    includeExternal: false,
    hiddenKeys: ["item:9"],
    ticksNeedDescendants: false,
  };
  expect(parseGraphViewState(serializeGraphViewState(state))).to.deep.equal(
    state,
  );
});

it("migrates a version 1 recipe with no folder filter to the all base", function () {
  const v1 = JSON.stringify({
    version: 1,
    seeds: [],
    explore: { direction: "both", locality: "all" },
    filters: { collectionIDs: [] },
    camera: null,
    title: null,
  });
  const parsed = parseGraphViewState(v1);
  expect(parsed?.version).to.equal(GRAPH_VIEW_STATE_VERSION);
  expect(parsed?.collections).to.deep.equal({ base: "all", except: [] });
  expect(parsed?.includeUnfiled).to.equal(true);
  expect(parsed?.includeExternal).to.equal(true);
  expect(parsed?.hiddenKeys).to.deep.equal([]);
  // Nothing to expand: the whole library was already ticked.
  expect(parsed?.ticksNeedDescendants).to.equal(false);
});

it("migrates a version 1 recipe naming folders to the none base", function () {
  const v1 = JSON.stringify({
    version: 1,
    seeds: [],
    explore: { direction: "both", locality: "all" },
    filters: { collectionIDs: [7, 4] },
    camera: null,
    title: null,
  });
  const parsed = parseGraphViewState(v1);
  expect(parsed?.collections).to.deep.equal({ base: "none", except: [4, 7] });
  // Version 1 drew a scoped parent's whole subtree, so the view expands
  // these once against the library's folder tree.
  expect(parsed?.ticksNeedDescendants).to.equal(true);
  expect(parsed?.filters.collectionIDs).to.deep.equal([]);
});

it("keeps the migration flag out of the serialised recipe", function () {
  const state: GraphViewState = {
    ...emptyGraphViewState(),
    ticksNeedDescendants: true,
  };
  expect(serializeGraphViewState(state)).to.not.contain("ticksNeedDescendants");
});

it("still returns null for a version it does not know", function () {
  const future = JSON.stringify({ ...emptyGraphViewState(), version: 3 });
  expect(parseGraphViewState(future)).to.equal(null);
});
```

The existing "parses a sparse object into the empty state" case compares
against `emptyGraphViewState()`; a sparse version 2 object now parses with
`ticksNeedDescendants: false`, so change that expectation to
`{ ...emptyGraphViewState(), ticksNeedDescendants: false }`.

- [x] **Step 6: Run them and watch them fail**

Run: `npm run test:unit`
Expected: FAIL — the round-trip case reports `collections` missing, and both
migration cases get `null` because version 1 is rejected.

- [x] **Step 7: Take `graphViewState.ts` to version 2**

Add the import and the re-export near the top of
`src/services/graphViewState.ts`:

```ts
import {
  allCollectionsTicked,
  onlyCollectionsTicked,
  type GraphViewCollectionTicks,
} from "./graphScopeModel";

export type { GraphViewCollectionTicks };
```

Replace the version constant and the interface:

```ts
export const GRAPH_VIEW_STATE_VERSION = 2;

export interface GraphViewState {
  version: typeof GRAPH_VIEW_STATE_VERSION;
  /** Ordered. The first entry is the primary seed. Empty means library graph. */
  seeds: GraphViewSeed[];
  explore: GraphViewExploreSettings;
  filters: PaperListFilterState;
  /** Which of the library's folders are drawn. */
  collections: GraphViewCollectionTicks;
  /** Papers in no folder are drawn. */
  includeUnfiled: boolean;
  /** Papers outside Zotero are drawn. */
  includeExternal: boolean;
  /** Papers the reader removed one by one. */
  hiddenKeys: string[];
  camera: GraphViewTransform | null;
  /** The custom tab title, or null when the title is derived. */
  title: string | null;
  /**
   * True when the ticks came out of the version 1 migration and still name
   * only the folders that recipe listed. The view expands them once through
   * the library's folder tree, because version 1 drew a scoped parent's whole
   * subtree. Never serialised: it is a fact about this parse, not about the
   * graph, and ticks the rail wrote must never be expanded — a child unticked
   * under a ticked parent would come back.
   */
  ticksNeedDescendants?: boolean;
}
```

Extend `emptyGraphViewState`:

```ts
export function emptyGraphViewState(): GraphViewState {
  return {
    version: GRAPH_VIEW_STATE_VERSION,
    seeds: [],
    explore: { direction: "both", locality: "all" },
    filters: defaultPaperListFilterState(),
    collections: allCollectionsTicked(),
    includeUnfiled: true,
    includeExternal: true,
    hiddenKeys: [],
    camera: null,
    title: null,
  };
}
```

Strip the flag on write:

```ts
export function serializeGraphViewState(state: GraphViewState): string {
  const { ticksNeedDescendants: _migrated, ...persisted } = state;
  return JSON.stringify(persisted);
}
```

Add these above `parseGraphViewState`:

```ts
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

function parseKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter((key): key is string => typeof key === "string" && !!key),
    ),
  ];
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
```

Replace `parseGraphViewState` with:

```ts
export function parseGraphViewState(json: string): GraphViewState | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  if (raw.version !== GRAPH_VIEW_STATE_VERSION && raw.version !== 1) {
    return null;
  }
  const empty = emptyGraphViewState();
  const explore = isRecord(raw.explore) ? raw.explore : {};
  const direction = DIRECTIONS.find((d) => d === explore.direction);
  const locality = LOCALITIES.find((l) => l === explore.locality);
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
    filters,
    ...scope,
    camera: parseCamera(raw.camera),
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title : null,
  };
}
```

- [x] **Step 8: Run the gate**

Run: `npm run check`
Expected: PASS. `tsc` flags any `GraphViewState` literal built without the new
fields; there should be none, because callers spread `emptyGraphViewState()`.
If one appears, spread `emptyGraphViewState()` there rather than listing
fields by hand.

- [x] **Step 9: Commit**

```bash
git add src/services/graphViewState.ts src/services/graphScopeModel.ts \
  test/unit/graphViewState.test.ts test/unit/graphScopeModel.test.ts
git commit -m "Take the graph recipe to version 2 with a migration

A version 1 recipe's collection filter becomes folder ticks: an empty list is
the all base, a non-empty one is the none base naming those folders. The
migration is exact because subfolders cascade, and the view expands migrated
ticks once through the library's tree.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa"
```

---

### Task 2: The visibility order

The spec's five rules, in one pure function with the counts the rail prints.
A seed is visible always; every other paper is admitted by one rule and can
then be removed by any of the rest.

**Files:**

- Modify: `src/services/graphScopeModel.ts`
- Test: `test/unit/graphScopeModel.test.ts`

**Interfaces:**

- Consumes: the tick helpers from Task 1.
- Produces:
  `interface ScopePaper { key: string; collectionIDs: readonly number[]; inLibrary: boolean }`;
  `interface GraphScopeInput { papers: readonly ScopePaper[]; seedKeys: ReadonlySet<string>; reachedKeys: ReadonlySet<string>; ticks: GraphViewCollectionTicks; includeUnfiled: boolean; includeExternal: boolean; hiddenKeys: ReadonlySet<string>; facetAdmits: (key: string) => boolean }`;
  `interface GraphScopeResult { visibleKeys: Set<string>; shown: number; total: number; countByCollection: Map<number, number>; unfiledCount: number; externalCount: number; hiddenCount: number }`;
  `computeGraphScope(input: GraphScopeInput): GraphScopeResult`.

- [x] **Step 1: Write the failing visibility tests**

Append to `test/unit/graphScopeModel.test.ts` (extend the import from
`graphScopeModel` with `computeGraphScope` and `type ScopePaper`):

```ts
function paper(
  key: string,
  collectionIDs: readonly number[] = [],
  inLibrary = true,
): ScopePaper {
  return { key, collectionIDs, inLibrary };
}

function scope(overrides: Partial<GraphScopeInput> = {}): GraphScopeResult {
  return computeGraphScope({
    papers: [],
    seedKeys: new Set(),
    reachedKeys: new Set(),
    ticks: allCollectionsTicked(),
    includeUnfiled: true,
    includeExternal: true,
    hiddenKeys: new Set(),
    facetAdmits: () => true,
    ...overrides,
  });
}

describe("computeGraphScope", function () {
  it("keeps a seed's neighbour filed in an unticked folder", function () {
    // D1: adding a seed to a folder graph must only ever add papers.
    const result = scope({
      papers: [paper("a", [1]), paper("b", [2])],
      seedKeys: new Set(["a"]),
      reachedKeys: new Set(["b"]),
      ticks: onlyCollectionsTicked([1]),
    });
    expect([...result.visibleKeys].sort()).to.deep.equal(["a", "b"]);
  });

  it("drops a library paper whose only folder is unticked", function () {
    const result = scope({
      papers: [paper("a", [1]), paper("b", [2])],
      ticks: onlyCollectionsTicked([1]),
    });
    expect([...result.visibleKeys]).to.deep.equal(["a"]);
  });

  it("keeps a paper filed in two folders while either is ticked", function () {
    const both = scope({
      papers: [paper("a", [1, 2])],
      ticks: onlyCollectionsTicked([2]),
    });
    expect([...both.visibleKeys]).to.deep.equal(["a"]);
    const neither = scope({
      papers: [paper("a", [1, 2])],
      ticks: onlyCollectionsTicked([3]),
    });
    expect([...neither.visibleKeys]).to.deep.equal([]);
  });

  it("draws an unfiled paper only while Unfiled is ticked", function () {
    expect([...scope({ papers: [paper("a")] }).visibleKeys]).to.deep.equal([
      "a",
    ]);
    const off = scope({ papers: [paper("a")], includeUnfiled: false });
    expect([...off.visibleKeys]).to.deep.equal([]);
  });

  it("hides external papers when Not in Zotero is unticked, but never a seed", function () {
    const result = scope({
      papers: [paper("s", [], false), paper("x", [], false)],
      seedKeys: new Set(["s"]),
      reachedKeys: new Set(["x"]),
      includeExternal: false,
    });
    expect([...result.visibleKeys]).to.deep.equal(["s"]);
  });

  it("keeps a seed past a hidden key and an unticked folder", function () {
    const result = scope({
      papers: [paper("s", [1])],
      seedKeys: new Set(["s"]),
      ticks: onlyCollectionsTicked([9]),
      hiddenKeys: new Set(["s"]),
      facetAdmits: () => false,
    });
    expect([...result.visibleKeys]).to.deep.equal(["s"]);
  });

  it("removes a hidden paper the folders admit", function () {
    const result = scope({
      papers: [paper("a", [1]), paper("b", [1])],
      hiddenKeys: new Set(["b"]),
    });
    expect([...result.visibleKeys]).to.deep.equal(["a"]);
    expect(result.hiddenCount).to.equal(1);
  });

  it("lets a facet reach a paper the seed brought in", function () {
    // A year range is a fact about the paper, so it is true of a citer too;
    // a folder is a fact about how you filed it, so it is not.
    const result = scope({
      papers: [paper("s", [1]), paper("old", [2]), paper("new", [2])],
      seedKeys: new Set(["s"]),
      reachedKeys: new Set(["old", "new"]),
      ticks: onlyCollectionsTicked([1]),
      facetAdmits: (key) => key !== "old",
    });
    expect([...result.visibleKeys].sort()).to.deep.equal(["new", "s"]);
  });

  it("counts what the rail prints", function () {
    const result = scope({
      papers: [
        paper("a", [1]),
        paper("b", [1, 2]),
        paper("c"),
        paper("x", [], false),
      ],
      ticks: onlyCollectionsTicked([1]),
    });
    expect(result.total).to.equal(4);
    expect(result.shown).to.equal(4);
    expect(result.countByCollection.get(1)).to.equal(2);
    expect(result.countByCollection.get(2)).to.equal(1);
    expect(result.unfiledCount).to.equal(1);
    expect(result.externalCount).to.equal(1);
  });
});
```

Add `GraphScopeInput` and `GraphScopeResult` to the type import at the top of
the file.

- [x] **Step 2: Run and watch it fail**

Run: `npm run test:unit`
Expected: FAIL — `computeGraphScope is not a function`.

- [x] **Step 3: Write the visibility order**

Append to `src/services/graphScopeModel.ts`:

```ts
/** A paper as the scope rules see it. Everything else about it is irrelevant. */
export interface ScopePaper {
  key: string;
  /** The library folders it is filed in. Empty means unfiled or external. */
  collectionIDs: readonly number[];
  /** False for a paper that is not in Zotero. */
  inLibrary: boolean;
}

export interface GraphScopeInput {
  /** Every paper the graph holds, library and external together. */
  papers: readonly ScopePaper[];
  seedKeys: ReadonlySet<string>;
  /** Every paper some seed reached, unioned across the seeds. */
  reachedKeys: ReadonlySet<string>;
  ticks: GraphViewCollectionTicks;
  includeUnfiled: boolean;
  includeExternal: boolean;
  hiddenKeys: ReadonlySet<string>;
  /**
   * The Filter popover's remaining facets: tags, item type, year, and the
   * data-quality switches. Not the search box, which narrows what is drawn
   * without changing a single count the rail prints.
   */
  facetAdmits: (key: string) => boolean;
}

export interface GraphScopeResult {
  visibleKeys: Set<string>;
  /** What survives every rule, before the search box. */
  shown: number;
  /** Every paper the graph holds. */
  total: number;
  /** Papers in the graph filed in each folder, counting its own members only. */
  countByCollection: Map<number, number>;
  unfiledCount: number;
  externalCount: number;
  hiddenCount: number;
}

/**
 * The spec's order, and the reason it is an order rather than a conjunction.
 *
 * A seed is visible, always, and no later rule can hide one. Every other paper
 * is admitted by rule 1 or rule 2 and can then be removed by rules 3 to 5.
 *
 * Rule 1 sits *beside* rule 2 rather than under it: adding a seed only ever
 * adds papers, and unticking a folder never removes a paper a seed brought in.
 * Folder ticks are a fact about how you filed a paper, so they say nothing
 * about one you have never filed; a year, an item type, a retraction and being
 * outside Zotero are facts about the paper itself, so they are true of a
 * citer exactly as they are of anything else.
 */
export function computeGraphScope(input: GraphScopeInput): GraphScopeResult {
  const visibleKeys = new Set<string>();
  const countByCollection = new Map<number, number>();
  let unfiledCount = 0;
  let externalCount = 0;
  let hiddenCount = 0;

  for (const paper of input.papers) {
    if (!paper.inLibrary) externalCount += 1;
    else if (!paper.collectionIDs.length) unfiledCount += 1;
    for (const collectionID of paper.collectionIDs) {
      countByCollection.set(
        collectionID,
        (countByCollection.get(collectionID) ?? 0) + 1,
      );
    }
    if (input.hiddenKeys.has(paper.key)) hiddenCount += 1;

    if (input.seedKeys.has(paper.key)) {
      visibleKeys.add(paper.key);
      continue;
    }
    const admitted =
      input.reachedKeys.has(paper.key) ||
      (paper.inLibrary &&
        (paper.collectionIDs.length
          ? paper.collectionIDs.some((collectionID) =>
              isCollectionTicked(input.ticks, collectionID),
            )
          : input.includeUnfiled));
    if (!admitted) continue;
    if (!paper.inLibrary && !input.includeExternal) continue;
    if (input.hiddenKeys.has(paper.key)) continue;
    if (!input.facetAdmits(paper.key)) continue;
    visibleKeys.add(paper.key);
  }

  return {
    visibleKeys,
    shown: visibleKeys.size,
    total: input.papers.length,
    countByCollection,
    unfiledCount,
    externalCount,
    hiddenCount,
  };
}
```

- [x] **Step 4: Run the tests**

Run: `npm run test:unit`
Expected: PASS, with the nine new cases green.

- [x] **Step 5: Run the gate and commit**

Run: `npm run check`
Expected: PASS.

```bash
git add src/services/graphScopeModel.ts test/unit/graphScopeModel.test.ts
git commit -m "Decide visibility once, as a pure order

A seed is visible always; every other paper is admitted by a seed's reach or
by a ticked folder, and can then be removed by Not in Zotero, a hidden key or
a facet. Folder ticks do not reach a paper a seed brought in; the facets do.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa"
```

---

### Task 3: The rows the Scope section draws

Scope is not the Key. A Key entry emphasises on hover and carries no state; a
Scope row owns a checkbox that changes what is drawn. It gets its own model
file so the rail can render both without the Key's module growing a filtering
control.

**Files:**

- Create: `src/services/graphScopeRailModel.ts`
- Test: `test/unit/graphScopeRailModel.test.ts`

**Interfaces:**

- Consumes: `GraphViewCollectionTicks`, `CollectionTickState`,
  `collectionTickState`, `GraphScopeResult` from `graphScopeModel.ts`;
  `LibraryCollectionFilter` from `../domain/types` (fields: `collectionID`,
  `parentCollectionID`, `key`, `name`, `path`, `depth`, `orderIndex`,
  `includedCollectionIDs`).
- Produces:
  `interface ScopeSeedRow { key: string; label: string; color: string }`;
  `interface ScopeCollectionRow { kind: "collection"; collectionID: number; label: string; depth: number; count: number; state: CollectionTickState; cascadeIDs: number[] }`;
  `interface ScopeToggleRow { kind: "unfiled" | "external"; label: string; count: number; state: "on" | "off" }`;
  `type ScopeRow = ScopeCollectionRow | ScopeToggleRow`;
  `interface ScopeRailModel { countLine: string; seedsHeading: string; seeds: ScopeSeedRow[]; rows: ScopeRow[]; hiddenLine: string | null }`;
  `interface ScopeRailInput { collections: readonly LibraryCollectionFilter[]; ticks: GraphViewCollectionTicks; includeUnfiled: boolean; includeExternal: boolean; seeds: readonly ScopeSeedRow[]; scope: GraphScopeResult }`;
  `buildScopeRailModel(input: ScopeRailInput): ScopeRailModel`;
  `seedRowLabel(paper: { authors: readonly string[]; year: number | null; title: string }): string`.

- [x] **Step 1: Write the failing tests**

Create `test/unit/graphScopeRailModel.test.ts`:

```ts
import { describe, it } from "node:test";
import { expect } from "chai";
import type { LibraryCollectionFilter } from "../../src/domain/types";
import {
  allCollectionsTicked,
  computeGraphScope,
  onlyCollectionsTicked,
  setCollectionTicks,
  type GraphScopeResult,
} from "../../src/services/graphScopeModel";
import {
  buildScopeRailModel,
  seedRowLabel,
} from "../../src/services/graphScopeRailModel";

function collection(
  collectionID: number,
  name: string,
  depth: number,
  includedCollectionIDs: number[] = [collectionID],
  parentCollectionID: number | null = null,
): LibraryCollectionFilter {
  return {
    collectionID,
    parentCollectionID,
    key: `C${collectionID}`,
    name,
    path: name,
    depth,
    orderIndex: collectionID,
    includedCollectionIDs,
  };
}

const TREE: LibraryCollectionFilter[] = [
  collection(1, "PhD", 0, [1, 11, 12]),
  collection(11, "Reading", 1, [11], 1),
  collection(12, "Drafts", 1, [12], 1),
  collection(2, "Teaching", 0, [2]),
];

function emptyScope(): GraphScopeResult {
  return computeGraphScope({
    papers: [
      { key: "a", collectionIDs: [1], inLibrary: true },
      { key: "b", collectionIDs: [11], inLibrary: true },
      { key: "c", collectionIDs: [], inLibrary: true },
      { key: "x", collectionIDs: [], inLibrary: false },
    ],
    seedKeys: new Set(),
    reachedKeys: new Set(),
    ticks: allCollectionsTicked(),
    includeUnfiled: true,
    includeExternal: true,
    hiddenKeys: new Set(),
    facetAdmits: () => true,
  });
}

describe("buildScopeRailModel", function () {
  it("prints shown of total papers", function () {
    const model = buildScopeRailModel({
      collections: TREE,
      ticks: allCollectionsTicked(),
      includeUnfiled: true,
      includeExternal: true,
      seeds: [],
      scope: emptyScope(),
    });
    expect(model.countLine).to.equal("4 of 4 papers");
    expect(model.seedsHeading).to.equal("Seeds · 0");
    expect(model.hiddenLine).to.equal(null);
  });

  it("indents the tree, keeps its order, and closes it with the two rows", function () {
    const model = buildScopeRailModel({
      collections: TREE,
      ticks: allCollectionsTicked(),
      includeUnfiled: true,
      includeExternal: false,
      seeds: [],
      scope: emptyScope(),
    });
    expect(model.rows.map((row) => row.label)).to.deep.equal([
      "PhD",
      "    Reading",
      "    Drafts",
      "Teaching",
      "Unfiled",
      "Not in Zotero",
    ]);
    const last = model.rows.at(-1);
    expect(last?.kind).to.equal("external");
    expect(last?.state).to.equal("off");
    expect(last?.count).to.equal(1);
  });

  it("carries each folder's own count and its cascade", function () {
    const model = buildScopeRailModel({
      collections: TREE,
      ticks: allCollectionsTicked(),
      includeUnfiled: true,
      includeExternal: true,
      seeds: [],
      scope: emptyScope(),
    });
    const phd = model.rows[0];
    expect(phd.kind).to.equal("collection");
    if (phd.kind !== "collection") throw new Error("expected a folder row");
    expect(phd.count).to.equal(1);
    expect(phd.cascadeIDs).to.deep.equal([1, 11, 12]);
    expect(phd.depth).to.equal(0);
  });

  it("draws a parent mixed when a descendant disagrees", function () {
    const ticks = setCollectionTicks(allCollectionsTicked(), [11], false);
    const model = buildScopeRailModel({
      collections: TREE,
      ticks,
      includeUnfiled: true,
      includeExternal: true,
      seeds: [],
      scope: emptyScope(),
    });
    expect(model.rows[0].state).to.equal("mixed");
    expect(model.rows[1].state).to.equal("off");
    expect(model.rows[3].state).to.equal("on");
  });

  it("reads Unfiled and the folder rows off the none base", function () {
    const model = buildScopeRailModel({
      collections: TREE,
      ticks: onlyCollectionsTicked([2]),
      includeUnfiled: false,
      includeExternal: true,
      seeds: [],
      scope: emptyScope(),
    });
    expect(model.rows[0].state).to.equal("off");
    expect(model.rows[3].state).to.equal("on");
    const unfiled = model.rows.find((row) => row.kind === "unfiled");
    expect(unfiled?.state).to.equal("off");
    expect(unfiled?.count).to.equal(1);
  });

  it("shows the hidden line only when something is hidden", function () {
    const scope = computeGraphScope({
      papers: [
        { key: "a", collectionIDs: [1], inLibrary: true },
        { key: "b", collectionIDs: [1], inLibrary: true },
      ],
      seedKeys: new Set(),
      reachedKeys: new Set(),
      ticks: allCollectionsTicked(),
      includeUnfiled: true,
      includeExternal: true,
      hiddenKeys: new Set(["b"]),
      facetAdmits: () => true,
    });
    const model = buildScopeRailModel({
      collections: TREE,
      ticks: allCollectionsTicked(),
      includeUnfiled: true,
      includeExternal: true,
      seeds: [],
      scope,
    });
    expect(model.hiddenLine).to.equal("1 hidden");
    expect(model.countLine).to.equal("1 of 2 papers");
  });

  it("names a seed by its first author and year", function () {
    expect(
      seedRowLabel({ authors: ["Ada Lovelace"], year: 1843, title: "Notes" }),
    ).to.equal("Lovelace (1843)");
    expect(seedRowLabel({ authors: [], year: 2020, title: "Notes" })).to.equal(
      "Notes (2020)",
    );
    expect(seedRowLabel({ authors: [], year: null, title: "Notes" })).to.equal(
      "Notes",
    );
  });

  it("passes the seeds through in order with their heading", function () {
    const model = buildScopeRailModel({
      collections: TREE,
      ticks: allCollectionsTicked(),
      includeUnfiled: true,
      includeExternal: true,
      seeds: [
        { key: "s1", label: "Lovelace (1843)", color: "#111111" },
        { key: "s2", label: "Turing (1936)", color: "#222222" },
      ],
      scope: emptyScope(),
    });
    expect(model.seedsHeading).to.equal("Seeds · 2");
    expect(model.seeds.map((seed) => seed.key)).to.deep.equal(["s1", "s2"]);
  });
});
```

- [x] **Step 2: Run and watch it fail**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '../../src/services/graphScopeRailModel'`.

- [x] **Step 3: Write the rail model**

Create `src/services/graphScopeRailModel.ts`:

```ts
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
}

export interface ScopeToggleRow {
  kind: "unfiled" | "external";
  label: string;
  count: number;
  state: "on" | "off";
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
}

const COUNT_FORMAT = new Intl.NumberFormat(undefined, { useGrouping: true });
const INDENT = "    ";

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
    };
  });
  // Every paper on the plot answers to exactly one tick the reader can find,
  // which is what makes unticking read as subtraction.
  rows.push({
    kind: "unfiled",
    label: "Unfiled",
    count: input.scope.unfiledCount,
    state: input.includeUnfiled ? "on" : "off",
  });
  rows.push({
    kind: "external",
    label: "Not in Zotero",
    count: input.scope.externalCount,
    state: input.includeExternal ? "on" : "off",
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
```

- [x] **Step 4: Run the tests**

Run: `npm run test:unit`
Expected: PASS.

- [x] **Step 5: Run the gate and commit**

Run: `npm run check`
Expected: PASS.

```bash
git add src/services/graphScopeRailModel.ts \
  test/unit/graphScopeRailModel.test.ts
git commit -m "Model the Scope rail's rows

The count line, the Seeds heading, the folder tree with its counts and
cascades, Unfiled and Not in Zotero, and the hidden line — as data, so the
rail only has to draw them.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa"
```

---

### Task 4: The projection becomes a lookup

`buildGraphFocusProjection` already computes what each seed reached. It stops
being the graph and becomes two things: a map of that reach, and the external
nodes to merge into the model.

**Files:**

- Modify: `src/services/graphFocusService.ts`
- Test: `test/unit/graphFocusService.test.ts` (create)

**Interfaces:**

- Consumes: `CitationGraphModel`, `CitationGraphNode`, `CitationGraphEdge`
  from `../domain/graphTypes`.
- Produces: `GraphFocusProjection` gains
  `reachedBySeed: Map<string, Set<string>>`;
  `reachedKeysOf(projection: GraphFocusProjection): Set<string>`;
  `additiveGraphModel(base: { nodes: readonly CitationGraphNode[]; edges: readonly CitationGraphEdge[] }, projection: GraphFocusProjection | null): { nodes: CitationGraphNode[]; edges: CitationGraphEdge[] }`.

- [x] **Step 1: Write the failing tests**

Create `test/unit/graphFocusService.test.ts`:

```ts
import { describe, it } from "node:test";
import { expect } from "chai";
import type {
  CitationGraphEdge,
  CitationGraphNode,
} from "../../src/domain/graphTypes";
import {
  additiveGraphModel,
  reachedKeysOf,
  type GraphFocusProjection,
} from "../../src/services/graphFocusService";

function node(key: string, kind: "local" | "external"): CitationGraphNode {
  return {
    key,
    itemID: kind === "local" ? 1 : 0,
    itemKey: key,
    kind,
    focusRole: null,
    externalWork: null,
    title: key,
    abstract: null,
    sourceTitle: null,
    authors: [],
    year: null,
    publicationDate: null,
    citationSequence: null,
    doi: null,
    tags: [],
    collectionIDs: [],
    citationCount: null,
    referenceCount: null,
    resolvedReferenceCount: 0,
    referenceCoverage: null,
    metricsUpdatedAt: null,
    dataAgeDays: null,
    provider: null,
    citationCountProvider: null,
    referenceCountProvider: null,
    providerWorkID: null,
    matchedBy: null,
    matchConfidence: null,
    matchConfirmed: true,
    metricStatus: null,
    fwci: null,
    citationPercentile: null,
    isTop1Percent: null,
    isTop10Percent: null,
    citationsLastYear: null,
    citationVelocity: null,
    citationAcceleration: null,
    influentialCitationCount: null,
    isRetracted: null,
    openAccessStatus: null,
    isOpenAccess: null,
    publicationType: null,
    sourceMetrics: null,
    metadataCompleteness: 0,
    incomingLibraryCitations: 0,
    outgoingLibraryReferences: 0,
    libraryCoverage: null,
    localGlobalImpactRatio: null,
    isIsolated: false,
    referenceAgeMean: null,
    referenceAgeSpread: null,
    selfCitationEstimate: null,
    futureReferenceCount: null,
    references: [],
  } as CitationGraphNode;
}

function edge(key: string, source: string, target: string): CitationGraphEdge {
  return { key, source, target, provenance: "test", manual: false };
}

function projection(): GraphFocusProjection {
  return {
    state: {
      seedKeys: ["s"],
      direction: "both",
      locality: "all",
      ranking: "relevance",
      maxPerDirection: 50,
    },
    seeds: [node("s", "local")],
    nodes: [node("s", "local"), node("lib", "local"), node("ext", "external")],
    edges: [edge("s>lib", "s", "lib"), edge("ext>s", "ext", "s")],
    seedKeys: new Set(["s"]),
    externalKeys: new Set(["ext"]),
    reachedBySeed: new Map([["s", new Set(["lib", "ext"])]]),
    hidden: { references: 0, citedBy: 0 },
  };
}

describe("seed reach", function () {
  it("unions what every seed reached", function () {
    expect([...reachedKeysOf(projection())].sort()).to.deep.equal([
      "ext",
      "lib",
    ]);
  });

  it("adds the projection to the library graph instead of replacing it", function () {
    const base = {
      nodes: [node("lib", "local"), node("other", "local")],
      edges: [edge("lib>other", "lib", "other")],
    };
    const merged = additiveGraphModel(base, projection());
    expect(merged.nodes.map((entry) => entry.key).sort()).to.deep.equal([
      "ext",
      "lib",
      "other",
      "s",
    ]);
    expect(merged.edges.map((entry) => entry.key).sort()).to.deep.equal([
      "ext>s",
      "lib>other",
      "s>lib",
    ]);
  });

  it("keeps the library's own node when the projection has one too", function () {
    const base = { nodes: [node("lib", "local")], edges: [] };
    const merged = additiveGraphModel(base, projection());
    // The library node is the one the graph already draws; the projection's
    // copy carries a focus role and would reset it.
    expect(merged.nodes.filter((entry) => entry.key === "lib")).to.have.length(
      1,
    );
    expect(merged.nodes[0]).to.equal(base.nodes[0]);
  });

  it("returns the library graph unchanged with no projection", function () {
    const base = { nodes: [node("lib", "local")], edges: [] };
    const merged = additiveGraphModel(base, null);
    expect(merged.nodes).to.deep.equal(base.nodes);
    expect(merged.edges).to.deep.equal([]);
  });
});
```

- [x] **Step 2: Run and watch it fail**

Run: `npm run test:unit`
Expected: FAIL — `reachedKeysOf is not a function`, and the projection literal
does not typecheck because `reachedBySeed` is not on `GraphFocusProjection`.

- [x] **Step 3: Record the reach while the projection is built**

In `src/services/graphFocusService.ts`, add the field to the interface:

```ts
export interface GraphFocusProjection {
  state: GraphFocusState;
  seeds: CitationGraphNode[];
  /**
   * The papers the seeds reached, as nodes. No longer the graph: the view
   * merges these into the library model rather than swapping the model for
   * them, so adding a seed only ever adds papers.
   */
  nodes: CitationGraphNode[];
  edges: CitationGraphEdge[];
  seedKeys: Set<string>;
  externalKeys: Set<string>;
  /** Which papers each seed reached, keyed by seed node key. */
  reachedBySeed: Map<string, Set<string>>;
  hidden: { references: number; citedBy: number };
}
```

Inside `buildGraphFocusProjection`, declare the map beside `nodes` and `edges`:

```ts
const reachedBySeed = new Map<string, Set<string>>();
for (const seed of seeds) reachedBySeed.set(seed.key, new Set<string>());
```

and record each addition inside `add`, next to the edge it already writes:

```ts
for (const seedKey of entry.seedKeys) {
  reachedBySeed.get(seedKey)?.add(node.key);
  const relation =
    role === "reference"
      ? edge(seedKey, node.key, [...entry.provenances][0] ?? "focus")
      : edge(node.key, seedKey, [...entry.provenances][0] ?? "focus");
  edges.set(`${relation.source}>${relation.target}`, relation);
}
```

and return it:

```ts
    reachedBySeed,
    hidden: {
```

- [x] **Step 4: Add the two helpers**

At the end of `src/services/graphFocusService.ts`:

```ts
/** Every paper some seed reached. Rule 1 of the scope order reads this. */
export function reachedKeysOf(projection: GraphFocusProjection): Set<string> {
  const keys = new Set<string>();
  for (const reached of projection.reachedBySeed.values()) {
    for (const key of reached) keys.add(key);
  }
  return keys;
}

/**
 * The library graph plus what the seeds brought in. The library's own node
 * always wins: the projection's copy carries a focus role and a cloned
 * identity, and the graph is already drawing the original.
 */
export function additiveGraphModel(
  base: {
    nodes: readonly CitationGraphNode[];
    edges: readonly CitationGraphEdge[];
  },
  projection: GraphFocusProjection | null,
): { nodes: CitationGraphNode[]; edges: CitationGraphEdge[] } {
  const nodes = [...base.nodes];
  const edges = [...base.edges];
  if (!projection) return { nodes, edges };
  const nodeKeys = new Set(nodes.map((node) => node.key));
  for (const node of projection.nodes) {
    if (nodeKeys.has(node.key)) continue;
    nodeKeys.add(node.key);
    nodes.push(node);
  }
  const edgeKeys = new Set(edges.map((edge) => edge.key));
  for (const edge of projection.edges) {
    if (edgeKeys.has(edge.key)) continue;
    edgeKeys.add(edge.key);
    edges.push(edge);
  }
  return { nodes, edges };
}
```

- [x] **Step 5: Run the tests and the gate**

Run: `npm run test:unit`
Expected: PASS.
Run: `npm run check`
Expected: PASS. `tsc` will flag any other construction of a
`GraphFocusProjection` literal; `graphViewService.ts` builds none directly, so
there should be none.

- [x] **Step 6: Commit**

```bash
git add src/services/graphFocusService.ts test/unit/graphFocusService.test.ts
git commit -m "Turn the focus projection into a lookup

It carries which papers each seed reached and the nodes to merge in, and
additiveGraphModel adds them to the library graph instead of replacing it.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa"
```

---

### Task 5: Per-seed colours and the in-library ring

The rail's bullseye and the plot's have to agree, so each seed takes a colour;
and a hop result you already own is told from one you do not by a thin ring in
a brighter tint of its own fill. Unfilled outlines are not used: stage 4
reserves them for papers below the citation floor.

**Files:**

- Modify: `src/services/graphTheme.ts`,
  `src/services/citationGraphRenderer.ts`
- Test: `test/unit/graphTheme.test.ts` (create)

**Interfaces:**

- Consumes: `GraphTheme` and `graphThemeFor` as they stand.
- Produces:
  `seedColorAt(index: number, theme: GraphTheme): string`;
  `inLibraryRingColor(fill: string, theme: GraphTheme): string`;
  `GraphStateTokens` gains `inLibraryRing: string`;
  renderer gains `setSeedColors(colors: ReadonlyMap<string, string>, draw?: boolean): void`
  and `setInLibraryReachedKeys(keys: ReadonlySet<string>, draw?: boolean): void`.

- [x] **Step 1: Write the failing theme tests**

Create `test/unit/graphTheme.test.ts`:

```ts
import { describe, it } from "node:test";
import { expect } from "chai";
import {
  graphThemeCustomProperties,
  graphThemeFor,
  inLibraryRingColor,
  seedColorAt,
} from "../../src/services/graphTheme";

describe("seed colours", function () {
  it("gives each seed the next swatch and wraps round", function () {
    const theme = graphThemeFor("light");
    const swatches = theme.categorical.swatches;
    expect(seedColorAt(0, theme)).to.equal(swatches[0]);
    expect(seedColorAt(1, theme)).to.equal(swatches[1]);
    expect(seedColorAt(swatches.length, theme)).to.equal(swatches[0]);
    expect(seedColorAt(-1, theme)).to.equal(swatches[0]);
  });
});

describe("the in-library ring", function () {
  it("brightens a hex fill", function () {
    const theme = graphThemeFor("light");
    const ring = inLibraryRingColor("#336699", theme);
    expect(ring).to.match(/^#[0-9a-f]{6}$/);
    expect(ring).to.not.equal("#336699");
    // Every channel moves towards white, none past it.
    expect(Number.parseInt(ring.slice(1, 3), 16)).to.be.greaterThan(0x33);
    expect(Number.parseInt(ring.slice(5, 7), 16)).to.be.at.most(0xff);
  });

  it("falls back to the theme token for a colour it cannot parse", function () {
    const theme = graphThemeFor("dark");
    expect(inLibraryRingColor("rgba(1, 2, 3, .4)", theme)).to.equal(
      theme.states.inLibraryRing,
    );
    expect(inLibraryRingColor("", theme)).to.equal(theme.states.inLibraryRing);
  });

  it("publishes the ring token to CSS", function () {
    const properties = graphThemeCustomProperties(graphThemeFor("light"));
    expect(properties.map(([name]) => name)).to.include(
      "--cm-state-in-library-ring",
    );
  });
});
```

- [x] **Step 2: Run and watch it fail**

Run: `npm run test:unit`
Expected: FAIL — `seedColorAt is not a function`.

- [x] **Step 3: Extend the theme**

In `src/services/graphTheme.ts`, add the token to the interface:

```ts
export interface GraphStateTokens {
  selected: string;
  seed: string;
  searchMatch: string;
  retracted: string;
  /**
   * The in-library ring's colour when a node's fill cannot be brightened —
   * a ramp stop given as `rgba(...)`, or a missing fill.
   */
  inLibraryRing: string;
}
```

Add the value to `LIGHT_THEME.states`:

```ts
    inLibraryRing: "#4f9a5e",
```

and to `DARK_THEME.states`:

```ts
    inLibraryRing: "#96bf54",
```

Publish it in `graphThemeCustomProperties`, after the seed line:

```ts
    ["--cm-state-in-library-ring", theme.states.inLibraryRing],
```

Add the two functions at the end of the file:

```ts
/**
 * Seeds are told apart by colour, and the rail's bullseye has to name the same
 * paper the plot's does. The categorical swatches are already validated for
 * separation, so seeds draw from them in order and wrap round.
 */
export function seedColorAt(index: number, theme: GraphTheme): string {
  const swatches = theme.categorical.swatches;
  const position = Number.isInteger(index) && index > 0 ? index : 0;
  return swatches[position % swatches.length];
}

function hexChannel(value: string, start: number): number | null {
  const parsed = Number.parseInt(value.slice(start, start + 2), 16);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * A brighter tint of a node's own fill: a hop result already in the library
 * wears a thin ring, so a paper you own is told from one you do not at a
 * glance while still reading as the same category. Only `#rrggbb` fills can be
 * brightened; anything else takes the theme's token.
 */
export function inLibraryRingColor(fill: string, theme: GraphTheme): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(fill)) return theme.states.inLibraryRing;
  const channels = [1, 3, 5].map((start) => hexChannel(fill, start));
  if (channels.some((channel) => channel === null)) {
    return theme.states.inLibraryRing;
  }
  const brightened = (channels as number[]).map((channel) =>
    Math.min(255, Math.round(channel + (255 - channel) * 0.45)),
  );
  return `#${brightened.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}
```

- [x] **Step 4: Run the theme tests**

Run: `npm run test:unit`
Expected: PASS.

- [x] **Step 5: Draw the two marks**

In `src/services/citationGraphRenderer.ts`, import the helper:

```ts
import { inLibraryRingColor } from "./graphTheme";
```

(If `graphTheme` is already imported, add `inLibraryRingColor` to that import.)

Beside `private seedKeys = new Set<string>();` add:

```ts
  /** Each seed's own colour, so the rail's bullseye and the plot's agree. */
  private seedColors = new Map<string, string>();
  /** Papers a seed reached that the library already holds. */
  private inLibraryReachedKeys = new Set<string>();
```

Beside `setSeedKeys`, add:

```ts
  public setSeedColors(
    colors: ReadonlyMap<string, string>,
    draw = true,
  ): void {
    this.seedColors = new Map(colors);
    if (draw) this.draw();
  }

  public setInLibraryReachedKeys(
    keys: ReadonlySet<string>,
    draw = true,
  ): void {
    this.inLibraryReachedKeys = new Set(keys);
    if (draw) this.draw();
  }
```

In `drawNode`, replace the seed block and insert the ring before it:

```ts
if (this.inLibraryReachedKeys.has(node.key) && !this.seedKeys.has(node.key)) {
  // A result you already own, told from one you do not. Thin, and a tint
  // of the node's own fill: stage 4 reserves unfilled outlines for papers
  // below the citation floor, and two outline meanings cannot be told
  // apart on one plot.
  context.save();
  context.beginPath();
  context.arc(position.x, position.y, radius + 2.5 * ratio, 0, Math.PI * 2);
  context.lineWidth = 1.4 * ratio;
  context.strokeStyle = inLibraryRingColor(
    colors[0] ?? this.theme.inks.primary,
    this.theme,
  );
  context.stroke();
  context.restore();
}
if (this.seedKeys.has(node.key)) {
  context.save();
  context.beginPath();
  context.arc(position.x, position.y, radius + 4 * ratio, 0, Math.PI * 2);
  context.lineWidth = 2.4 * ratio;
  if (ghosted) context.setLineDash([5 * ratio, 3 * ratio]);
  context.strokeStyle = this.seedColors.get(node.key) ?? this.theme.states.seed;
  context.stroke();
  context.restore();
}
```

Where `syncModel` prunes `seedKeys` against `validKeys`, prune the two new
collections the same way, so a node the model dropped leaves no mark behind:

```ts
this.seedColors = new Map(
  [...this.seedColors].filter(([key]) => validKeys.has(key)),
);
this.inLibraryReachedKeys = new Set(
  [...this.inLibraryReachedKeys].filter((key) => validKeys.has(key)),
);
```

- [x] **Step 6: Run the gate**

Run: `npm run check`
Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add src/services/graphTheme.ts src/services/citationGraphRenderer.ts \
  test/unit/graphTheme.test.ts
git commit -m "Give each seed a colour and ring the results you already own

Seeds take the validated categorical swatches in order, so the rail's bullseye
names the same paper the plot's does. A reached paper the library holds wears
a thin ring in a brighter tint of its own fill; unfilled outlines stay reserved
for stage 4's citation floor.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa"
```

---

### Task 6: The rail renders a Scope section

`graphKeyRail.ts` grows a second section above Key and one emphasis channel
that both use. The Key's own rendering does not change.

**Files:**

- Modify: `src/services/graphKeyRail.ts`, `addon/content/graph.css`
- Test: none new — the rail is DOM code; the model it draws is already tested
  in Task 3, and Task 14's Zotero tests drive the rendered rail.

**Interfaces:**

- Consumes: `ScopeRailModel`, `ScopeRow`, `ScopeCollectionRow` from
  `graphScopeRailModel.ts`; `KeyEntry`, `KeyModel`, `KeySection` from
  `graphKeyModel.ts`.
- Produces:
  `type RailEmphasis = { kind: "key"; entry: KeyEntry } | { kind: "seed"; seedKey: string } | { kind: "collection"; collectionID: number }`;
  `KeyRailOptions.onEmphasise: (emphasis: RailEmphasis | null) => void`;
  `KeyRailOptions.onScope: { toggleRow(row: ScopeRow, ticked: boolean): void; removeSeed(seedKey: string): void; addSeed(anchor: HTMLElement): void; showAllHidden(): void }`;
  `KeyRail.renderScope(model: ScopeRailModel | null): void`;
  `KeyRail.addSeedAnchor(): HTMLElement`.

- [x] **Step 1: Split the body into two hosts**

In `createKeyRail`, replace the single `body` with a body holding two
containers, so rendering the Key never wipes Scope:

```ts
const body = element(document, "div", "cm-key-body");
const scopeHost = element(document, "section", "cm-scope-section");
scopeHost.setAttribute("aria-label", "Scope");
scopeHost.hidden = true;
const keyHost = element(document, "div", "cm-key-sections");
body.append(scopeHost, keyHost);
```

In `render(model)`, replace `body.replaceChildren()` with
`keyHost.replaceChildren()`, append sections to `keyHost`, and change the
final hide to

```ts
body.hidden = model.sections.length === 0 && scopeHost.hidden;
```

In `destroy()`, replace `body.replaceChildren()` with the same on both hosts.

- [x] **Step 2: Make the emphasis channel a union**

Replace the `onEmphasise` type and every call. At the top of the file:

```ts
/**
 * One emphasis, whatever raised it. Scope adds a second source of hover to a
 * rail that had only the Key's, and two sources writing the same plot state is
 * how a highlight gets stranded when the pointer crosses quickly from a Seeds
 * row to a Key entry. Raising one clears the last.
 */
export type RailEmphasis =
  | { kind: "key"; entry: KeyEntry }
  | { kind: "seed"; seedKey: string }
  | { kind: "collection"; collectionID: number };
```

In `KeyRailOptions`:

```ts
  onEmphasise: (emphasis: RailEmphasis | null) => void;
```

In `entryRow`, the four hover/focus handlers and the click handler now send
`{ kind: "key", entry }` instead of `entry`, and `release()` still sends
`null`. `pinned` keeps its `KeyEntry | null` type: a Scope row cannot be
pinned, because a checkbox is already how a Scope row makes something stick.

- [x] **Step 3: Render the Scope section**

Add the handler bag to `KeyRailOptions`:

```ts
export interface ScopeRailHandlers {
  /** A folder, Unfiled or Not in Zotero was ticked or unticked. */
  toggleRow(row: ScopeRow, ticked: boolean): void;
  removeSeed(seedKey: string): void;
  /** The reader asked for the seed search panel; the anchor is the link. */
  addSeed(anchor: HTMLElement): void;
  showAllHidden(): void;
}
```

and `onScope: ScopeRailHandlers;` to `KeyRailOptions`.

Inside `createKeyRail`, build the section:

```ts
const addSeedLink = element(document, "button", "cm-scope-add-seed");
addSeedLink.type = "button";
addSeedLink.textContent = "+ Add seed";
addSeedLink.setAttribute("aria-haspopup", "dialog");
addSeedLink.setAttribute("aria-expanded", "false");
addSeedLink.addEventListener("click", () =>
  options.onScope.addSeed(addSeedLink),
);

function seedRow(seed: ScopeSeedRow): HTMLElement {
  const row = element(document, "div", "cm-scope-seed");
  const swatch = svg(document, "svg");
  swatch.setAttribute("viewBox", "0 0 20 20");
  swatch.setAttribute("width", "20");
  swatch.setAttribute("height", "20");
  swatch.setAttribute("aria-hidden", "true");
  swatch.setAttribute("focusable", "false");
  // A bullseye: a filled centre inside a ring with a gap, so it reads as a
  // different mark from the Key's plain swatch and from the in-library ring.
  for (const [radius, fill] of [
    [7, "none"],
    [3, seed.color],
  ] as const) {
    const circle = svg(document, "circle");
    circle.setAttribute("cx", "10");
    circle.setAttribute("cy", "10");
    circle.setAttribute("r", String(radius));
    circle.setAttribute("fill", fill);
    circle.setAttribute("stroke", seed.color);
    circle.setAttribute("stroke-width", "2");
    swatch.appendChild(circle);
  }
  const label = text(document, "span", seed.label, "cm-scope-seed-label");
  label.title = seed.label;
  const remove = element(document, "button", "cm-scope-seed-remove");
  remove.type = "button";
  remove.textContent = "×";
  remove.title = `Remove ${seed.label} as a seed`;
  remove.setAttribute("aria-label", remove.title);
  remove.addEventListener("click", () => options.onScope.removeSeed(seed.key));
  row.append(swatch, label, remove);
  row.addEventListener("pointerenter", () => {
    if (!pinned) options.onEmphasise({ kind: "seed", seedKey: seed.key });
  });
  row.addEventListener("pointerleave", () => {
    if (!pinned) options.onEmphasise(null);
  });
  return row;
}

function scopeRowElement(row: ScopeRow): HTMLElement {
  const label = element(document, "label", "cm-scope-row");
  const box = element(document, "input", "cm-scope-check") as HTMLInputElement;
  box.type = "checkbox";
  box.checked = row.state !== "off";
  // A parent whose descendants disagree draws mixed; clicking it commits to
  // ticked, which is what writes the same tick to the whole subtree.
  box.indeterminate = row.state === "mixed";
  box.addEventListener("change", () =>
    options.onScope.toggleRow(row, box.checked),
  );
  const name = text(document, "span", row.label, "cm-scope-row-label");
  name.title = row.label;
  const count = text(
    document,
    "span",
    COUNT_FORMAT.format(row.count),
    "cm-scope-row-count",
  );
  label.append(box, name, count);
  if (row.kind === "collection") {
    const collectionID = row.collectionID;
    label.addEventListener("pointerenter", () => {
      if (!pinned) options.onEmphasise({ kind: "collection", collectionID });
    });
    label.addEventListener("pointerleave", () => {
      if (!pinned) options.onEmphasise(null);
    });
  }
  return label;
}
```

Add the render method to the returned object:

```ts
    renderScope(model: ScopeRailModel | null): void {
      scopeHost.replaceChildren();
      scopeHost.hidden = model === null;
      if (!model) {
        body.hidden = keyHost.children.length === 0;
        return;
      }
      scopeHost.appendChild(text(document, "h2", "Scope", "cm-key-heading"));
      scopeHost.appendChild(
        text(document, "p", model.countLine, "cm-scope-count"),
      );
      const seedsHeader = element(document, "div", "cm-scope-seeds-header");
      seedsHeader.append(
        text(document, "span", model.seedsHeading, "cm-scope-seeds-heading"),
        addSeedLink,
      );
      scopeHost.appendChild(seedsHeader);
      for (const seed of model.seeds) scopeHost.appendChild(seedRow(seed));
      const rows = element(document, "div", "cm-scope-rows");
      for (const row of model.rows) rows.appendChild(scopeRowElement(row));
      scopeHost.appendChild(rows);
      if (model.hiddenLine) {
        const hidden = element(document, "p", "cm-scope-hidden");
        hidden.append(text(document, "span", model.hiddenLine));
        const showAll = element(document, "button", "cm-scope-show-all");
        showAll.type = "button";
        showAll.textContent = "Show all";
        showAll.addEventListener("click", () =>
          options.onScope.showAllHidden(),
        );
        hidden.append(text(document, "span", " · "), showAll);
        scopeHost.appendChild(hidden);
      }
      body.hidden = false;
    },
    addSeedAnchor: () => addSeedLink,
```

Declare both on the `KeyRail` interface:

```ts
  /** Draw the Scope section, or pass null to leave the column Key-only. */
  renderScope(model: ScopeRailModel | null): void;
  /** The "+ Add seed" link. The view anchors the seed search panel to it. */
  addSeedAnchor(): HTMLElement;
```

Import the types at the top:

```ts
import type {
  ScopeRailModel,
  ScopeRow,
  ScopeSeedRow,
} from "./graphScopeRailModel";
```

- [x] **Step 4: Style the section**

Append to `addon/content/graph.css`, after the Key rail block:

```css
/*
 * The Scope section. It sits above the Key and, unlike the Key, it filters:
 * every row here owns a checkbox that changes what the plot draws. The two
 * are separated by the same hairline that separates Key sections, so the
 * column still reads as one list.
 */
.cm-scope-section {
  padding-bottom: 12px;
  border-bottom: 1px solid var(--cm-border-soft);
  margin-bottom: 12px;
}
.cm-scope-section[hidden] {
  display: none;
}
.cm-scope-count {
  margin: 1px 0 8px;
  color: CanvasText;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.cm-scope-seeds-header {
  display: flex;
  gap: 6px;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 2px;
}
.cm-scope-seeds-heading {
  color: var(--cm-muted);
  font-size: 11px;
  font-weight: 600;
}
.meristema-root .cm-scope-add-seed,
.meristema-root .cm-scope-show-all {
  appearance: none;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
  color: var(--cm-accent);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.meristema-root .cm-scope-add-seed:hover,
.meristema-root .cm-scope-show-all:hover {
  text-decoration: underline;
}
.cm-scope-seed {
  display: flex;
  gap: 6px;
  align-items: center;
  min-width: 0;
  padding: 2px 4px;
  border-radius: 4px;
}
.cm-scope-seed:hover {
  background: color-mix(in srgb, CanvasText 8%, transparent);
}
.cm-scope-seed-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meristema-root .cm-scope-seed-remove {
  appearance: none;
  flex: 0 0 auto;
  min-width: 20px;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  box-shadow: none;
  color: var(--cm-muted);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}
.meristema-root .cm-scope-seed-remove:hover {
  background: color-mix(in srgb, CanvasText 12%, transparent);
  color: CanvasText;
}
.cm-scope-rows {
  display: grid;
  gap: 1px;
  max-height: 40vh;
  margin-top: 8px;
  overflow: auto;
  overscroll-behavior: contain;
}
.cm-scope-row {
  display: flex;
  gap: 6px;
  align-items: center;
  min-width: 0;
  padding: 2px 4px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
}
.cm-scope-row:hover {
  background: color-mix(in srgb, CanvasText 8%, transparent);
}
.meristema-root .cm-scope-check {
  flex: 0 0 auto;
  margin: 0;
}
.cm-scope-row-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  /* The indent is leading spaces in the label, so it must survive. */
  white-space: pre;
}
.cm-scope-row-count {
  flex: 0 0 auto;
  color: var(--cm-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.cm-scope-hidden {
  margin: 8px 0 0;
  color: var(--cm-muted);
  font-size: 11px;
}
```

- [x] **Step 5: Run the gate**

Run: `npm run check`
Expected: FAIL on `tsc` in `graphViewService.ts`: its `onEmphasise` callback
takes a `KeyEntry` and it passes no `onScope`. Fix it minimally here so the
build is green, and leave the real wiring to Task 8:

```ts
const keyRail = createKeyRail({
  document,
  onEmphasise: (emphasis) => {
    const entry = emphasis?.kind === "key" ? emphasis.entry : null;
    if (!entry?.matches) {
      railEmphasisKeys = null;
    } else {
      const matches = entry.matches;
      railEmphasisKeys = new Set(
        model.nodes.filter((node) => matches(node)).map((node) => node.key),
      );
    }
    applyEmphasis();
  },
  onScope: {
    toggleRow: () => undefined,
    removeSeed: () => undefined,
    addSeed: () => undefined,
    showAllHidden: () => undefined,
  },
  onCollapsedChange: (collapsed) => collectionsPane.setCollapsed(collapsed),
});
```

Run: `npm run check`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/services/graphKeyRail.ts src/services/graphViewService.ts \
  addon/content/graph.css
git commit -m "Give the rail a Scope section above the Key

Its own hosts, its own rows and its own stylesheet block, sharing one emphasis
channel with the Key so raising one clears the last. The Key still emphasises
and never filters; Scope is where the checkboxes live.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa"
```

---

### Task 7: The graph stops swapping its model

The projection stops being the graph. `model` always holds the library nodes
plus whatever the seeds brought in, and `applyFilters` asks
`computeGraphScope` what to draw. This is the task that answers D1.

**Files:**

- Modify: `src/services/graphViewService.ts`
- Test: none new — the decisions are already covered by Tasks 2 and 4; the
  behaviour is proved end to end by Task 14's Zotero test.

**Interfaces:**

- Consumes: `computeGraphScope`, `allCollectionsTicked`,
  `onlyCollectionsTicked`, `setCollectionTicks`,
  `expandTicksThroughDescendants`, `type GraphViewCollectionTicks`,
  `type ScopePaper`, `type GraphScopeResult` from `graphScopeModel.ts`;
  `additiveGraphModel`, `reachedKeysOf` from `graphFocusService.ts`;
  `collectionScopeIDs` from `paperListViewService.ts`.
- Produces (module-local, read by Task 8): `collectionTicks`,
  `includeUnfiled`, `includeExternal`, `hiddenKeys`, `lastScope`, and
  `descendantsByID`.

- [x] **Step 1: Declare the scope state**

Beside `let visibleKeys` and `let scopeKeys` in `renderGraphView`, add:

```ts
/** Folder tree lookups, built once: the snapshot's folders never move. */
const descendantsByID = new Map<number, readonly number[]>(
  snapshot.collections.map((collection) => [
    collection.collectionID,
    collection.includedCollectionIDs.filter(
      (id) => id !== collection.collectionID,
    ),
  ]),
);
/**
 * A graph opened on folders is `none`, so a folder made later does not
 * quietly appear in it; a library graph is `all`, so it does. The base is
 * set here, once, and unticking rows never flips it.
 */
let collectionTicks: GraphViewCollectionTicks = options.initialCollectionIDs
  ?.length
  ? onlyCollectionsTicked(
      collectionScopeIDs(options.initialCollectionIDs, snapshot.collections),
    )
  : allCollectionsTicked();
let includeUnfiled = true;
let includeExternal = true;
/** Papers the reader removed one by one, by node key. */
const hiddenKeys = new Set<string>();
/** What the last `applyFilters` decided, for the rail to print. */
let lastScope: GraphScopeResult | null = null;
```

Delete `mapScopeItemIDs` and `mapPinnedItemIDs` and their initialisers; Task
11 removes the last callers. Until then, leave `syncMapPinnedKeys` and
`publishMapScope` as no-ops if `tsc` still needs them, and delete them in
Task 11.

- [x] **Step 2: Merge instead of replace**

Rename `applyFocusProjection` to `applySeedProjection` and rewrite its body:

```ts
const applySeedProjection = (
  projection: GraphFocusProjection,
  projectionOptions: { fit?: boolean } = {},
): void => {
  setSeeded(true);
  focusProjection = projection;
  // The projection is an addition, not a replacement: the library graph
  // stays, and the seeds' external neighbours are merged into it. Unticking
  // a folder can then never remove a paper a seed brought in, and adding a
  // seed can never remove anything at all.
  const merged = additiveGraphModel(libraryModel, projection);
  model.nodes.splice(0, model.nodes.length, ...merged.nodes);
  model.edges.splice(0, model.edges.length, ...merged.edges);
  model.statistics.nodes = merged.nodes.length;
  model.statistics.edges = merged.edges.length;
  model.statistics.resolvedNodes = merged.nodes.filter(
    (node) => node.citationCount !== null || node.referenceCount !== null,
  ).length;
  model.statistics.isolatedNodes = merged.nodes.filter(
    (node) =>
      !merged.edges.some(
        (edge) => edge.source === node.key || edge.target === node.key,
      ),
  ).length;
  rebuildGraphFilterDescriptors();
  renderer?.syncModel({ draw: false });
  renderer?.setSeedKeys(projection.seedKeys, false);
  renderer?.setSeedColors(seedColorsFor(projection), false);
  renderer?.setInLibraryReachedKeys(inLibraryReachedKeys(projection), false);
  applyFilters();
  if (projectionOptions.fit) scheduleFocusFit();
  updateFocusBar();
  notifyStateChange();
};
```

Add the two helpers just above it:

```ts
/** Seeds take the categorical swatches in the order they were added. */
const seedColorsFor = (projection: GraphFocusProjection): Map<string, string> =>
  new Map(
    projection.state.seedKeys.map((key, index) => [
      key,
      seedColorAt(index, renderer?.getTheme() ?? graphThemeFor("light")),
    ]),
  );

/** Reached papers the library already holds; they wear the thin ring. */
const inLibraryReachedKeys = (
  projection: GraphFocusProjection,
): Set<string> => {
  const local = new Set(
    libraryModel.nodes
      .filter((node) => node.kind !== "external")
      .map((node) => node.key),
  );
  return new Set(
    [...reachedKeysOf(projection)].filter((key) => local.has(key)),
  );
};
```

Import `seedColorAt` and `graphThemeFor` from `./graphTheme` alongside the
existing theme imports.

- [x] **Step 3: Nothing is stashed, so nothing is restored**

Delete `libraryLayoutBeforeFocus`, `libraryViewBeforeFocus`,
`libraryCollectionFilterBeforeFocus` and `librarySelectedKeyBeforeFocus`, and
every read and write of them, including the `getFocusGraphAppearance` call and
the `graphFilter.setCollectionIDs([])` pair inside `enterFocusSeeds`. Entering
and leaving a seeded state no longer changes the layout, the camera or the
folders, because the old focus view is now just a position: untick every
folder and the seeds and their neighbours are all that is left.

Rename `exitFocus` to `clearSeeds` and reduce it to:

```ts
const clearSeeds = (): void => {
  resetFocusRefreshTracking();
  focusProjection = null;
  setSeeded(false);
  focusRelationships.clear();
  focusSeedRegistry.clear();
  restoredCamera = null;
  model.nodes.splice(0, model.nodes.length, ...libraryModel.nodes);
  model.edges.splice(0, model.edges.length, ...libraryModel.edges);
  Object.assign(model.statistics, libraryModel.statistics);
  rebuildGraphFilterDescriptors();
  renderer?.syncModel({ draw: false });
  renderer?.setSeedKeys(new Set(), false);
  renderer?.setSeedColors(new Map(), false);
  renderer?.setInLibraryReachedKeys(new Set(), false);
  updateFocusBar();
  applyFilters();
  notifyStateChange();
};
```

Rename every call site of `exitFocus` and `applyFocusProjection` accordingly.

- [x] **Step 4: Ask the scope model what is drawn**

Replace the body of `applyFilters` with:

```ts
applyFilters = (): void => {
  const tokens = normalizeSearch(search.value).split(/\s+/).filter(Boolean);
  const scope = computeGraphScope({
    papers: model.nodes.map((node): ScopePaper => ({
      key: node.key,
      collectionIDs: node.collectionIDs,
      inLibrary: node.kind !== "external",
    })),
    seedKeys: focusProjection?.seedKeys ?? new Set<string>(),
    reachedKeys: focusProjection
      ? reachedKeysOf(focusProjection)
      : new Set<string>(),
    ticks: collectionTicks,
    includeUnfiled,
    includeExternal,
    hiddenKeys,
    // Tags, item type, year and the data-quality switches. Not the search
    // box: it narrows what is drawn without moving a count the rail prints.
    facetAdmits: (key) => {
      const descriptor = graphFilterDescriptors.get(key);
      return descriptor ? graphFilter.matches(descriptor) : false;
    },
  });
  lastScope = scope;
  // Two sets, not one. `scopeKeys` is what the graph is a graph *of* — the
  // Key and the colour assignment are built from it. `visibleKeys` narrows
  // it by the search box, which is a transient lens and must not reshuffle
  // the swatches under the reader as they type.
  scopeKeys = scope.visibleKeys;
  const matchesSearch = (node: CitationGraphNode): boolean => {
    if (!tokens.length) return true;
    const searchable = graphNodeSearchText(node);
    return tokens.every((token) => searchable.includes(token));
  };
  visibleKeys = new Set(
    model.nodes
      .filter((node) => scopeKeys.has(node.key) && matchesSearch(node))
      .map((node) => node.key),
  );
  renderer?.setScopeKeys(scopeKeys);
  renderer?.setVisibleKeys(visibleKeys, false);
  if (libraryEmphasisKeys) {
    const kept = new Set(
      [...libraryEmphasisKeys].filter((key) => visibleKeys.has(key)),
    );
    libraryEmphasisKeys = kept.size ? kept : null;
    applyEmphasis();
  }
  const matches = tokens.length ? new Set(visibleKeys) : null;
  searchMatchKeys = matches;
  renderer?.setSearchMatches(matches);
  updateSummary();
  refreshKeyRail();
};
```

The `activeCollectionID` hack that fabricated collection membership for
external neighbours goes with it: rule 1 admits a reached paper whatever
folder it is filed in, so nothing has to be faked.

- [x] **Step 5: Carry the new fields in and out of the state**

In `getState`, replace the collection-stash block with the ticks:

```ts
const filters = graphFilter.state();
// The graph's folders live in the ticks now. The field stays on the type
// because the detail pane's relationship lists still filter by folder
// through the same controller.
filters.collectionIDs = [];
return {
  ...emptyGraphViewState(),
  seeds,
  explore: {
    direction: focusDirection.value as GraphFocusDirection,
    locality: focusLocality.value as GraphFocusLocality,
  },
  filters,
  collections: collectionTicks,
  includeUnfiled,
  includeExternal,
  hiddenKeys: [...hiddenKeys],
  camera: renderer?.getViewTransform() ?? null,
  title: options.title ?? null,
};
```

In `applyState`, adopt them before the seeds resolve:

```ts
focusDirection.value = state.explore.direction;
focusLocality.value = state.explore.locality;
if (focusProjection) clearSeeds();
graphFilter.setState({ ...state.filters, collectionIDs: [] });
// A version 1 recipe named the folders it was scoped to and drew each
// one's whole subtree, so its ticks are expanded once here — and only
// here. Ticks the rail wrote are already closed under the cascade, and
// expanding them would resurrect a child unticked under a ticked parent.
collectionTicks = state.ticksNeedDescendants
  ? expandTicksThroughDescendants(state.collections, descendantsByID)
  : state.collections;
includeUnfiled = state.includeUnfiled;
includeExternal = state.includeExternal;
hiddenKeys.clear();
for (const key of state.hiddenKeys) hiddenKeys.add(key);
applyFilters();
```

- [x] **Step 6: Re-scope from the folder menu through the ticks**

In the controller's `openCollections`, replace the body's scope work:

```ts
if (focusProjection) clearSeeds();
collectionTicks = onlyCollectionsTicked(
  collectionScopeIDs(known, snapshot.collections),
);
applyFilters();
scheduleCameraAction(() => renderer?.fitVisibleNodes());
return "selected";
```

`collectionScopeIDs` is what version 1 used, and it is what makes a folder
graph draw the parent's whole subtree; ticking the expansion keeps that exact.

- [x] **Step 7: Run the gate**

Run: `npm run check`
Expected: PASS once every renamed call site is updated. `tsc` will name each
one; work through them rather than guessing.

- [x] **Step 8: Prove D1 by hand before moving on**

Run: `npm test`
Expected: the suite runs; the three known failures listed in the Global
Constraints are the only ones. If a fourth appears, it is yours — fix it here.

- [x] **Step 9: Commit**

```bash
git add src/services/graphViewService.ts
git commit -m "Stop swapping the graph for a projection

The model always holds the library plus what the seeds brought in, and one
pure function decides what is drawn. Adding a seed to a folder graph now keeps
the folder's other papers on screen, which is D1; unticking a folder never
removes a paper a seed reached.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa"
```

---

### Task 8: The rail is wired to the graph

The Scope section starts drawing real rows and its checkboxes start changing
what is on screen.

**Files:**

- Modify: `src/services/graphViewService.ts`
- Test: none new; Task 14 drives the rendered rail.

**Interfaces:**

- Consumes: `buildScopeRailModel`, `seedRowLabel`, `type ScopeSeedRow` from
  `graphScopeRailModel.ts`; `setCollectionTicks` from `graphScopeModel.ts`;
  `RailEmphasis` from `graphKeyRail.ts`; `seedColorAt` from `graphTheme.ts`.
- Produces: `refreshScopeRail(): void`, called from `refreshKeyRail`.

- [x] **Step 1: Build the rail model beside the Key model**

Add, next to `refreshKeyRail`:

```ts
const scopeSeedRows = (): ScopeSeedRow[] => {
  const theme = renderer?.getTheme() ?? graphThemeFor("light");
  return (focusProjection?.state.seedKeys ?? []).map((key, index) => {
    const node =
      focusSeedRegistry.get(key) ??
      model.nodes.find((candidate) => candidate.key === key) ??
      null;
    return {
      key,
      label: node
        ? seedRowLabel({
            authors: node.authors,
            year: node.year,
            title: node.title,
          })
        : "Unknown paper",
      color: seedColorAt(index, theme),
    };
  });
};

const refreshScopeRail = (): void => {
  if (!lastScope) return;
  keyRail.renderScope(
    buildScopeRailModel({
      collections: snapshot.collections,
      ticks: collectionTicks,
      includeUnfiled,
      includeExternal,
      seeds: scopeSeedRows(),
      scope: lastScope,
    }),
  );
};
```

Call it from the end of `refreshKeyRail`, so one rebuild redraws the whole
column:

```ts
refreshScopeRail();
```

- [x] **Step 2: Wire the handlers**

Replace the placeholder `onScope` from Task 6 with:

```ts
    onScope: {
      toggleRow: (row, ticked) => {
        if (row.kind === "collection") {
          // The cascade: toggling a parent writes the same tick to its whole
          // subtree, because a graph scoped to a parent already drew it.
          collectionTicks = setCollectionTicks(
            collectionTicks,
            row.cascadeIDs,
            ticked,
          );
        } else if (row.kind === "unfiled") {
          includeUnfiled = ticked;
        } else {
          includeExternal = ticked;
        }
        applyFilters();
        notifyStateChange();
      },
      removeSeed: (seedKey) => removeFocusSeed(seedKey),
      addSeed: (anchor) => openFocusSeedPopover(anchor),
      showAllHidden: () => {
        if (!hiddenKeys.size) return;
        hiddenKeys.clear();
        applyFilters();
        notifyStateChange();
      },
    },
```

`openFocusSeedPopover` arrives in Task 9; until then, point `addSeed` at the
existing toolbar-button handler's body.

- [x] **Step 3: Resolve the two new emphasis cases**

Replace the `onEmphasise` callback:

```ts
    onEmphasise: (emphasis: RailEmphasis | null) => {
      railEmphasisKeys = emphasisKeys(emphasis);
      applyEmphasis();
    },
```

and add above `createKeyRail`:

```ts
/**
 * One emphasis, whatever raised it. A Seeds row lights that seed and the
 * papers it reached — which is the seed's edges, since every edge a seed
 * has runs to one of them.
 */
const emphasisKeys = (
  emphasis: RailEmphasis | null,
): ReadonlySet<string> | null => {
  if (!emphasis) return null;
  if (emphasis.kind === "key") {
    const matches = emphasis.entry.matches;
    if (!matches) return null;
    return new Set(
      model.nodes.filter((node) => matches(node)).map((node) => node.key),
    );
  }
  if (emphasis.kind === "seed") {
    const reached =
      focusProjection?.reachedBySeed.get(emphasis.seedKey) ?? new Set<string>();
    return new Set([emphasis.seedKey, ...reached]);
  }
  const collectionID = emphasis.collectionID;
  return new Set(
    model.nodes
      .filter((node) => node.collectionIDs.includes(collectionID))
      .map((node) => node.key),
  );
};
```

- [x] **Step 4: Run the gate and the suite**

Run: `npm run check`
Expected: PASS.
Run: `npm test`
Expected: only the three known failures.

- [x] **Step 5: Commit**

```bash
git add src/services/graphViewService.ts
git commit -m "Wire the Scope rail to the graph

The count line, the Seeds rows and the folder tree draw from the graph as it
stands, and their checkboxes go through the same pure scope model the plot
does. Hovering a Seeds row lights that seed and what it reached.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa"
```

---

### Task 9: The seed panel moves to the rail, and its rows get their spacing back

The panel's contents, its debounced search, its scoring and its fifty-result
cap are unchanged. It is anchored to `+ Add seed` and floats over the left
edge of the plot, and its rows stop touching.

**Files:**

- Modify: `src/services/graphViewService.ts`, `addon/content/graph.css`
- Test: none new; Task 14 asserts the link opens the panel.

**Interfaces:**

- Consumes: `popoverShouldAnchorEnd` from `popoverPlacement.ts`, unchanged.
- Produces: `openFocusSeedPopover(anchor: HTMLElement): void` inside the view.

- [x] **Step 1: Move the popover out of the toolbar**

Delete `focusSeedButton` and `focusSeedButtonLabel`, and every read of them
(including in `updateFocusBar`, which sets the seed count on the button; the
Seeds heading in the rail says it now). Keep `focusSeedMenu`,
`focusSeedPopover`, `focusSeedSearchWrap`, `focusSeedSearch` and
`focusSeedResults`.

Remove `focusSeedMenu` from the `toolbar.append(...)` call, leaving:

```ts
toolbar.append(
  graphFilter.root,
  similarButton,
  exportWrap,
  graphWrap,
  refreshButton,
);
```

Append the popover to the plot pane instead, so it floats over the plot's left
edge and keeps its 430px width:

```ts
focusSeedMenu.classList.add("cm-focus-seed-menu--rail");
plotPane.appendChild(focusSeedMenu);
```

- [x] **Step 2: Open it from the rail's link**

Replace the `focusSeedButton` click handler with:

```ts
const openFocusSeedPopover = (anchor: HTMLElement): void => {
  const opening = focusSeedPopover.hidden;
  focusSeedPopover.hidden = !opening;
  anchor.setAttribute("aria-expanded", String(opening));
  if (!opening) return;
  // Anchored to the rail's link, positioned over the plot: the pane is what
  // clips, so it is what the flip and the width bound are measured against,
  // exactly as when the anchor was a toolbar button.
  const pane = plotPane.getBoundingClientRect();
  const link = anchor.getBoundingClientRect();
  focusSeedMenu.style.top = `${Math.max(0, link.top - pane.top)}px`;
  renderFocusSeedResults();
  alignPopover(focusSeedMenu, focusSeedPopover);
  document.defaultView?.setTimeout(() => focusSeedSearch.focus(), 0);
};
```

In `closeFocusSeedPopover`, replace the
`focusSeedButton.setAttribute("aria-expanded", ...)` line with

```ts
keyRail.addSeedAnchor().setAttribute("aria-expanded", "false");
```

and in `closeFocusSeedPopoverOnOutsidePointer`, treat the link as inside:

```ts
if (target && focusSeedMenu.contains(target)) return;
if (target && keyRail.addSeedAnchor().contains(target)) return;
closeFocusSeedPopover();
```

Point Task 8's `addSeed` handler at `openFocusSeedPopover`.

- [x] **Step 3: Style the anchor and fix the rows**

In `addon/content/graph.css`, add the rail-anchored placement:

```css
/*
 * Anchored to the rail's "+ Add seed" link rather than a toolbar button, and
 * floating over the plot's left edge so it keeps its width. The plot pane is
 * `overflow: hidden`, so it is what clips and what the flip is measured
 * against; the view sets `top` from the link's position.
 */
.cm-focus-seed-menu--rail {
  position: absolute;
  z-index: 12;
  top: 0;
  left: 0;
}
.cm-focus-seed-menu--rail .cm-focus-seed-popover {
  top: 0;
}
```

Replace the result-row rules with ones that win on specificity rather than on
`!important`. The rows read as broken because
`.cm-focus-seed-result-main` is a `<button>` used as a grid container, so it
inherits Zotero's tight button line-height and its two spans sit 2px apart
with no line-height of their own:

```css
.meristema-root .cm-focus-seed-result-main {
  display: grid;
  flex: 1 1 auto;
  /* 4px, not 2px: the title and the metadata line were touching. */
  gap: 4px;
  min-width: 0;
  padding: 7px 8px;
  border-color: transparent;
  background: transparent;
  box-shadow: none;
  text-align: left;
  justify-items: start;
}
.meristema-root .cm-focus-seed-result-title,
.meristema-root .cm-focus-seed-result-meta {
  display: block;
  max-width: 100%;
  overflow: hidden;
  /* The spans had no line-height of their own and inherited the button's. */
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meristema-root .cm-focus-seed-result-remove,
.meristema-root .cm-focus-seed-result-add {
  align-self: center;
  flex: 0 0 auto;
  min-width: 28px;
  width: 28px;
  height: 28px;
  margin-right: 4px;
  padding: 0;
  justify-content: center;
  border-color: transparent;
  border-radius: 50%;
  background: transparent;
  box-shadow: none;
  font-size: 16px;
}
```

Delete the old `.cm-focus-seed-result-main`, `.cm-focus-seed-result-title`,
`.cm-focus-seed-result-meta`, `.cm-focus-seed-result-remove` and
`.cm-focus-seed-result-add` rules that carried the `!important` chain. Leave
`.cm-focus-seed-search`'s `padding-left: 30px !important` alone: that one
fights the shared search-field rule, not the button rule, and is out of scope.

- [x] **Step 4: Run the gate and look at it**

Run: `npm run check`
Expected: PASS.
Run: `npm test`
Expected: only the three known failures.

- [x] **Step 5: Commit**

```bash
git add src/services/graphViewService.ts addon/content/graph.css
git commit -m "Anchor the seed panel to the rail and unstick its rows

The panel keeps its search, its scoring and its width, and opens from the
rail's + Add seed link over the plot's left edge. Its rows get an explicit
line-height and a 4px gap, and the !important chain that was losing the same
fight goes with them.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa"
```

---

### Task 10: Remove from graph, and the end of Explore from this paper

D1 asks to delete nodes you do not need, and folders are too coarse for that.
D2 goes at the same time: with seeding additive, an action that replaces every
seed has no meaning.

**Files:**

- Modify: `src/services/graphViewService.ts`
- Test: `test/unit/graphScopeModel.test.ts` (one case for the purge)

**Interfaces:**

- Consumes: `hiddenKeys`, `applyFilters`, `notifyStateChange` from Task 7.
- Produces: `hideFromGraph(key: string): void` inside the view;
  `purgeHiddenKeys(hiddenKeys: ReadonlySet<string>, seedKeys: readonly string[]): Set<string>`
  in `graphScopeModel.ts`.

- [x] **Step 1: Write the failing purge test**

Append to `test/unit/graphScopeModel.test.ts` (add `purgeHiddenKeys` to the
import):

```ts
describe("purgeHiddenKeys", function () {
  it("forgets a hide once the paper is seeded", function () {
    // Precedence alone would draw it, since no rule hides a seed — but the key
    // would sit there waiting, and removing the seed later would make the
    // paper vanish for a reason taken weeks ago and shown nowhere.
    const purged = purgeHiddenKeys(new Set(["a", "b"]), ["b"]);
    expect([...purged]).to.deep.equal(["a"]);
  });

  it("leaves the set alone when no seed was hidden", function () {
    const purged = purgeHiddenKeys(new Set(["a"]), ["b"]);
    expect([...purged]).to.deep.equal(["a"]);
  });
});
```

- [x] **Step 2: Run and watch it fail**

Run: `npm run test:unit`
Expected: FAIL — `purgeHiddenKeys is not a function`.

- [x] **Step 3: Write it**

Append to `src/services/graphScopeModel.ts`:

```ts
/**
 * Seeding a paper is an instruction to look at it, so an earlier instruction
 * to hide it is spent. The same applies to a paper restored by Show all,
 * which empties the set outright.
 */
export function purgeHiddenKeys(
  hiddenKeys: ReadonlySet<string>,
  seedKeys: readonly string[],
): Set<string> {
  const seeds = new Set(seedKeys);
  return new Set([...hiddenKeys].filter((key) => !seeds.has(key)));
}
```

Run: `npm run test:unit`
Expected: PASS.

- [x] **Step 4: Add the node menu entry**

In `src/services/graphViewService.ts`, beside `nodeMenuSeed`, build the entry
and delete `nodeMenuExplore`:

```ts
const nodeMenuRemove = element(document, "button", "cm-node-menu-item");
nodeMenuRemove.type = "button";
nodeMenuRemove.setAttribute("role", "menuitem");
nodeMenuRemove.textContent = "Remove from graph";
nodeMenu.append(nodeMenuOpen, nodeMenuSeed, nodeMenuRemove);
```

Delete `nodeMenuExplore`, its `textContent`, its click handler, and its entry
in `nodeMenuItems()`:

```ts
const nodeMenuItems = (): HTMLButtonElement[] =>
  [nodeMenuOpen, nodeMenuSeed, nodeMenuRemove].filter((item) => !item.hidden);
```

In `openNodeMenu`, hide the entry on a seed — the Seeds row's `×` is how a
seed leaves:

```ts
const isSeed = Boolean(focusProjection?.seedKeys.has(node.key));
nodeMenuSeed.textContent = isSeed ? "Remove seed" : "Add as seed";
nodeMenuRemove.hidden = isSeed;
```

and wire the click:

```ts
nodeMenuRemove.addEventListener("click", () => {
  const node = nodeMenuTarget;
  closeNodeMenu(true);
  if (node) hideFromGraph(node.key);
});
```

Add the function beside `applyFilters`'s other callers:

```ts
/** A paper the reader does not need. Seeds cannot be hidden. */
const hideFromGraph = (key: string): void => {
  if (focusProjection?.seedKeys.has(key)) return;
  if (hiddenKeys.has(key)) return;
  hiddenKeys.add(key);
  applyFilters();
  notifyStateChange();
};
```

- [x] **Step 5: Purge a hide when the paper is seeded**

In `addFocusSeeds`, immediately after `missingSeeds` is computed and before
the state is activated, spend the hide:

```ts
const purged = purgeHiddenKeys(
  hiddenKeys,
  missingSeeds.map((seed) => seed.key),
);
hiddenKeys.clear();
for (const key of purged) hiddenKeys.add(key);
```

Do the same in `enterFocusSeeds`, after `seeds` is resolved, using
`seeds.map((seed) => seed.key)`.

- [x] **Step 6: Delete Explore from this paper**

In `graphHost.rowActions`, drop the first action so the array starts empty and
only Add as seed is pushed:

```ts
    rowActions: (work) => {
      const focusNode = focusNodeForWork(work);
      const actions: RowAction[] = [];
      if (focusProjection && !focusProjection.seedKeys.has(focusNode.key)) {
        actions.push({
          label: "Add as seed",
          title:
            "Add this paper as a seed of this graph without adding it to Zotero.",
          run: () => {
            addFocusSeed(focusNode);
          },
        });
      }
      return actions;
    },
```

Delete the detail pane's Explore button around line 2894 (the one whose
`textContent` is `"Explore from this paper"`) and its handler, and delete
`focusOnPaper` once nothing calls it. The detail pane keeps **Add as seed**
and **Remove seed** in every state, which it already does.

- [x] **Step 7: Run the gate and the suite**

Run: `npm run check`
Expected: PASS. `eslint` will report `focusOnPaper` as unused if a call site
was missed; delete it rather than silencing the rule.
Run: `npm test`
Expected: only the three known failures. Note that `test/zotero/graphViewVisual.test.ts`
"view 12" asserts the node menu's entries; update its expectations to
Open / Add as seed / Remove from graph in this task, not later.

- [x] **Step 8: Commit**

```bash
git add src/services/graphViewService.ts src/services/graphScopeModel.ts \
  test/unit/graphScopeModel.test.ts test/zotero/graphViewVisual.test.ts
git commit -m "Let the reader remove a paper, and retire Explore from here

Remove from graph adds a key to hiddenKeys and the rail offers Show all;
seeding a paper spends an earlier hide, so removing that seed later does not
resurrect it. Explore from this paper is deleted: with seeding additive, an
action that replaces every seed has no meaning. That is D2.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa"
```

---

### Task 11: Items become seeds

There is no longer a way to put a paper in a graph without it being a seed,
and therefore no second, invisible scope rule. Three ways to say which papers
are on screen become one.

**Files:**

- Modify: `src/services/graphScopePolicy.ts`,
  `src/services/graphViewService.ts`, `src/services/windowService.ts`,
  `src/services/paperListViewService.ts`
- Test: `test/unit/architecture.test.ts` (drop the assertions for the deleted
  helpers, if any name them)

**Interfaces:**

- Consumes: `addFocusSeeds` from the view; `collectionScopeIDs` stays where it
  is and keeps its callers.
- Produces: `GraphViewController` reduced to
  `applyLibrarySelection`, `addFocusItems`, `openCollections`, `getState`,
  `applyState`, `markExternalSeedImported`, `setStatus`, `setActive`.
  `GraphViewOptions` loses `initialItemIDs`, `initialItemMode`,
  `initialMapScopeItemIDs`, `initialMapPinnedItemIDs`, `onMapScopeChange`,
  `initialFocusItemID`, and keeps `initialFocusItemIDs` and
  `initialCollectionIDs`.

- [ ] **Step 1: Strip `graphScopePolicy.ts`**

Delete `replaceItemScope`, `extendItemScope` and `appendUniqueScopeKeys`. The
file keeps only `normalizedScopeItemIDs`, because the openers still normalise
the ids they are handed.

In `graphViewService.ts`, `addFocusSeeds` used `appendUniqueScopeKeys` to
extend the seed list; inline it:

```ts
const state = focusStateFromControls([
  ...new Set([
    ...focusProjection.state.seedKeys,
    ...missingSeeds.map((seed) => seed.key),
  ]),
]);
```

- [ ] **Step 2: Delete the item scope from the view**

Remove from `graphViewService.ts`: `mapNodesForItems`, `applyMapItems`,
`replaceMapItems`, `addMapItems`, `revealItems`, `revealItem`,
`mapPinnedKeys`, `syncMapPinnedKeys`, `publishMapScope`, and every call to
them, including the two `renderer?.setPinnedKeys(...)` calls that only existed
to pin map items. Remove the matching entries from `GraphViewController` and
from `GraphViewOptions`.

Rewrite the initial-open block at the end of `renderGraphView`:

```ts
  // Everything the host asked this view to open selects nodes of its own
  // accord: none of it is a click, so Zotero's list must not follow it.
  withoutSelectionReport(() => {
    if (options.initialFocusItemIDs?.length) {
      controller.addFocusItems(options.initialFocusItemIDs);
    } else if (options.initialCollectionIDs?.length) {
      controller.openCollections(options.initialCollectionIDs);
    }
    ...
  });
```

Keep the rest of that block as it stands.

- [ ] **Step 3: Delete the show path from `windowService.ts`**

Delete `openGraphAndSelectItems`, `openGraphAndSelectItemsInNewTab` and
`openGraphAndSelectItemsInView`; `selectionItemIDs` and `selectionMode` from
`PendingGraphRequest`, `consumePendingRequest`, `setPendingRequest`,
`emptyRequest` and the two literal request objects in `renderDetachedWindow`
and `openDetachedGraphWindow`; `pendingSelectionItemIDs` and
`pendingSelectionMode` from the instance state; `mapScopeItemIDs` and
`mapPinnedItemIDs` from the instance state and from both `renderGraphView`
option blocks; and the `"add-map"` arm of `activateGraphItems`, which becomes:

```ts
function activateGraphSeeds(
  win: _ZoteroTypes.MainWindow,
  instance: GraphInstanceState,
  itemIDs: readonly number[],
): boolean {
  const mount = instanceMount(win, instance);
  if (!mount) return false;
  const controller = getGraphViewController(mount);
  controller?.setActive(true);
  const result = controller?.addFocusItems(itemIDs);
  if (!result || result === "not-found") return false;
  activateInstance(win, instance);
  return true;
}
```

`firstRequestedItemID` loses its `selectionItemIDs` term:

```ts
function firstRequestedItemID(request: PendingGraphRequest): number | null {
  return request.focusItemIDs[0] ?? null;
}
```

`openFocusItems` keeps its shape and calls `activateGraphSeeds`.

Before deleting each export, confirm nothing else calls it:

```bash
grep -rn "openGraphAndSelectItems" src/ test/
```

Expected after the edit: no matches outside the deletion itself.

- [ ] **Step 4: Take the folder list out of the graph's filter popover**

In `paperListViewService.ts`, delete `setCollectionIDs` from the
`PaperFilterController` interface and from the returned object, and make the
folder control conditional so a controller built without `collections`
renders none:

```ts
const collections = options.collections ?? [];
if (collections.length) {
  const collectionSelect = element(document, "select");
  // ... unchanged body ...
  appendLabelledControl(
    document,
    menu,
    "Collections (none = whole library)",
    collectionSelect,
  );
}
```

In `graphViewService.ts`, construct the graph's controller without folders:

```ts
const graphFilter = createPaperFilterController({
  document,
  // The rail's tree is where a graph's folders live now; a second, silent
  // folder control inside the popover would be a way to say the same thing
  // twice and disagree.
  buttonClassName: "cm-toolbar-button",
  getDescriptors: () => [...graphFilterDescriptors.values()],
  onChange: () => {
    applyFilters();
    notifyStateChange();
  },
});
```

The detail pane's relationship lists keep their folder control: they pass
`collections` and are untouched.

- [ ] **Step 5: Run the gate and the suite**

Run: `npm run check`
Expected: PASS. `tsc` names every stale reference; work through them.
Run: `npm test`
Expected: only the three known failures. `test/zotero/graphVisual.test.ts` and
`graphViewVisual.test.ts` may drive a deleted controller method; update those
cases to seed instead.

- [ ] **Step 6: Commit**

```bash
git add src/services/graphScopePolicy.ts src/services/graphViewService.ts \
  src/services/windowService.ts src/services/paperListViewService.ts test/
git commit -m "Make every added paper a seed

The item scope, its pinned set and the show path are gone: a graph opened from
selected papers seeds itself with them, and one told to show papers adds them
as seeds. The filter popover loses its folder list, which the rail's tree
replaces.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa"
```

---

### Task 12: The File menu and its Tools mirror

The toolbar reads Filter · Similar · Export · File · Refresh · search, and
File and Tools › Meristema offer the same four commands in the same order
under the same names.

**Files:**

- Modify: `src/services/graphViewService.ts`, `src/services/menuService.ts`,
  `addon/locale/en-US/mainWindow.ftl`, `typings/i10n.d.ts`
- Test: none new; Task 14 asserts the toolbar's shape.

**Interfaces:**

- Consumes: `openNewGraphWindow`, `openSavedGraph`, `listSavedGraphs`,
  `getOpenGraphViews` from `windowService.ts` and `savedGraphService.ts`,
  unchanged; `GraphViewSavedGraphsHost` unchanged.
- Produces: locale ids `meristema-save-command`, `meristema-save-as-command`;
  `open-saved-graph-submenu` re-labelled "Open".

- [ ] **Step 1: Rename the toolbar's menu**

In `graphViewService.ts`, the Graph menu becomes File and keeps its place
before Refresh — it already does. Change the button:

```ts
graphButton.append(iconButtonContent(document, "document", "File"));
graphButton.title = "New, open, save, or save this graph as a new one.";
```

Give the popup a New Graph command above Save, so the four commands match
Tools' order — New Graph, Open, Save, Save as…:

```ts
const newGraphButton = element(document, "button");
newGraphButton.type = "button";
newGraphButton.dataset.action = "new";
newGraphButton.textContent = "New Graph";
graphMenu.append(
  newGraphButton,
  graphMenuHeading,
  graphMenuList,
  saveButton,
  saveAsButton,
);
```

Wire it to the host beside the existing Save handlers:

```ts
newGraphButton.addEventListener("click", () => {
  closeGraphMenu();
  void Promise.resolve(options.savedGraphs?.newGraph?.()).catch(
    (error: unknown) => {
      Zotero.logError(
        error instanceof Error ? error : new Error(String(error)),
      );
    },
  );
});
```

Add `newGraph(): Promise<void>;` to `GraphViewSavedGraphsHost`, and implement
it in `savedGraphsHost` in `windowService.ts`, alongside `save` and `saveAs`
(`libraryID` there is the local function, so it is called):

```ts
    newGraph: () => openNewGraphWindow(win, libraryID()),
```

- [ ] **Step 2: Mirror the four commands in Tools**

In `menuService.ts`, rewrite `toolsSubmenu` so the first four entries match
the File menu's order and names, with the library commands and Settings below
a separator:

```ts
function toolsSubmenu(): MenuData {
  return {
    menuType: "submenu",
    l10nID: `${config.addonRef}-tools-submenu`,
    icon: ICON,
    menus: [
      commandItem(`${config.addonRef}-new-graph-view-command`, (context) =>
        openNewGraphWindow(contextWindow(context), activeLibraryID(context)),
      ),
      openSavedGraphSubmenu(),
      graphStateCommand(`${config.addonRef}-save-command`, (view, win) =>
        saveGraphView(view.instanceID, win),
      ),
      graphStateCommand(`${config.addonRef}-save-as-command`, (view, win) =>
        saveGraphViewAs(view.instanceID, win),
      ),
      { menuType: "separator" },
      commandItem(
        `${config.addonRef}-refresh-library-command`,
        async (context) => {
          refreshItems(await activeLibraryRegularItems(context));
        },
      ),
      commandItem(`${config.addonRef}-refresh-command`, (context) => {
        refreshItems(contextRegularItems(context));
      }),
      { menuType: "separator" },
      commandItem(`${config.addonRef}-settings-command`, () => {
        openSettings();
      }),
    ],
  };
}
```

Note: `refresh-command` moves here from the item menu in Task 13 and acts on
the current list selection; keep it directly under Refresh Library.

Add the helper above it, which disables Save and Save as… when no graph tab is
active:

```ts
/**
 * Save and Save as… act on the active graph. With no graph tab open there is
 * nothing to save, so the entry is disabled rather than absent: a command that
 * comes and goes is harder to find than one that is greyed.
 */
function graphStateCommand(
  l10nID: string,
  run: (view: OpenGraphViewInfo, hostWindow: MainWindow) => Promise<unknown>,
): MenuData {
  return {
    menuType: "menuitem",
    l10nID,
    icon: ICON,
    onShowing: (_event: Event, context: any) => {
      const active = getOpenGraphViews(contextWindow(context)).find(
        (view) => view.active,
      );
      context.setEnabled(Boolean(active));
    },
    onCommand: (_event: Event, context: any) => {
      const hostWindow = contextWindow(context);
      const active = getOpenGraphViews(hostWindow).find((view) => view.active);
      if (!active) return;
      void Promise.resolve(run(active, hostWindow)).catch(report);
    },
  };
}
```

`saveGraphView` and `saveGraphViewAs` are new exports in `windowService.ts`.
They run exactly the code the toolbar's Save and Save as… run, by reaching the
same `savedGraphsHost` the view was handed — no duplication, so the two
surfaces can never drift:

```ts
/**
 * Save the graph an open view is showing, from outside that view. The Tools
 * menu offers the same four commands the toolbar's File menu does, and these
 * are how the two share one implementation.
 */
export async function saveGraphView(
  instanceID: string,
  hostWindow?: _ZoteroTypes.MainWindow,
): Promise<string | null> {
  const win = hostWindow ?? defaultMainWindow();
  const instance = graphState(win).instances.get(instanceID);
  if (!instance) return null;
  return savedGraphsHost(win, instance).save();
}

export async function saveGraphViewAs(
  instanceID: string,
  hostWindow?: _ZoteroTypes.MainWindow,
): Promise<string | null> {
  const win = hostWindow ?? defaultMainWindow();
  const instance = graphState(win).instances.get(instanceID);
  if (!instance) return null;
  return savedGraphsHost(win, instance).saveAs();
}
```

Add both to `menuService.ts`'s import from `./windowService`.

- [ ] **Step 3: Locale**

In `addon/locale/en-US/mainWindow.ftl`, re-label the submenu and add the two
commands:

```
open-saved-graph-submenu =
    .label = Open

save-command =
    .label = Save

save-as-command =
    .label = Save as…
```

Regenerate the typings:

Run: `npm run build` (the scaffold writes `typings/i10n.d.ts`), or add
`'save-command'` and `'save-as-command'` to the `FluentMessageId` union by
hand if the build is too slow to run here. The file is generated; do not hand-
edit anything else in it.

- [ ] **Step 4: Run the gate and the suite**

Run: `npm run check`
Expected: PASS.
Run: `npm test`
Expected: only the three known failures. `savedGraphMenu.test.ts` reads the
Tools submenu by l10n id; the Open submenu keeps its id, so it should still
pass — if it does not, the id changed and that is a mistake to undo.

- [ ] **Step 5: Commit**

```bash
git add src/services/graphViewService.ts src/services/windowService.ts \
  src/services/menuService.ts addon/locale/en-US/mainWindow.ftl \
  typings/i10n.d.ts
git commit -m "Rename the Graph menu to File and mirror it in Tools

Both offer New Graph, Open, Save and Save as… in that order under those names;
in Tools, Save and Save as… are disabled when no graph tab is active, and the
library commands and Settings stay below a separator.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa"
```

---

### Task 13: The item context menu

Two entries, which is B4's answer: showing and seeding are the same act now,
and the flat per-graph rows become one submenu.

**Files:**

- Modify: `src/services/menuService.ts`,
  `addon/locale/en-US/mainWindow.ftl`, `typings/i10n.d.ts`
- Test: none new; Task 14 asserts the menu's shape.

**Interfaces:**

- Consumes: `getOpenGraphViews`, `openFocusItemsInNewTab`,
  `openFocusItemsInView` from `windowService.ts`.
- Produces: locale id `meristema-add-to-submenu`;
  `show-items-new-tab-command` deleted.

- [ ] **Step 1: Replace `itemMenus`**

```ts
// The item context menu is deliberately flat: every Meristema action sits
// directly in Zotero's own menu, identified by its icon rather than by a
// parent labelled "Meristema". "Add to" is the one exception, because it
// groups a row per open graph and the count of those is not known until the
// menu is showing.
function itemMenus(): MenuData[] {
  const hasItems = (context: any): boolean =>
    contextRegularItems(context).length > 0;
  return [
    contextCommandItem(
      `${config.addonRef}-open-focus-view-new-tab-command`,
      hasItems,
      async (context) => {
        await openInNewFocusView(itemCommand(context), contextWindow(context));
      },
      (context) => {
        const command = itemCommand(context);
        context.setL10nArgs(JSON.stringify({ count: command.itemIDs.length }));
      },
    ),
    addToSubmenu(),
  ];
}

/**
 * One row per open graph. The rows cannot be declared up front — how many
 * graphs are open is only known while the menu is showing — so the popup is
 * filled on `onShowing` and emptied again on `popuphidden`, the same shape the
 * saved-graph submenu uses.
 */
function addToSubmenu(): MenuData {
  return {
    menuType: "submenu",
    l10nID: `${config.addonRef}-add-to-submenu`,
    icon: ICON,
    onShowing: (_event: Event, context: any) => {
      const available = contextRegularItems(context).length > 0;
      context.setVisible(available);
      context.setEnabled(available);
      if (!available) return;
      const menuElem = safeContextValue(context, "menuElem") as
        HTMLElement | undefined;
      const popup =
        menuElem?.localName === "menupopup"
          ? menuElem
          : (menuElem?.querySelector("menupopup") as HTMLElement | null);
      if (!popup) return;
      const hostWindow = contextWindow(context);
      const command = itemCommand(context);
      const document = popup.ownerDocument as any;
      popup
        .querySelectorAll(`[${OPEN_IN_DYNAMIC_ATTR}="add-to"]`)
        .forEach((node) => node.remove());
      for (const view of getOpenGraphViews(hostWindow)) {
        const item = document.createXULElement("menuitem");
        item.setAttribute(OPEN_IN_DYNAMIC_ATTR, "add-to");
        item.setAttribute("class", "menuitem-iconic");
        item.setAttribute("image", ICON);
        item.setAttribute(
          "label",
          view.active ? `✓ ${view.title}` : view.title,
        );
        item.setAttribute("acceltext", "adds as seeds");
        item.addEventListener(
          "command",
          () => {
            void exploreInExistingView(view, command, hostWindow).catch(report);
          },
          { once: true },
        );
        popup.appendChild(item);
      }
      popup.addEventListener(
        "popuphidden",
        () => {
          popup
            .querySelectorAll(`[${OPEN_IN_DYNAMIC_ATTR}="add-to"]`)
            .forEach((node) => node.remove());
        },
        { once: true },
      );
    },
    menus: [
      {
        menuType: "menuitem",
        l10nID: `${config.addonRef}-add-to-empty-command`,
        onShowing: (_event: Event, context: any) => {
          context.setEnabled(false);
          const entry = safeContextValue(context, "menuElem") as
            HTMLElement | undefined;
          const popup = entry?.parentElement;
          if (!popup) return;
          context.setVisible(
            popup.querySelectorAll(`[${OPEN_IN_DYNAMIC_ATTR}="add-to"]`)
              .length === 0,
          );
        },
      },
    ],
  };
}
```

Delete `openInNewMap`, `showInExistingView`, `injectViewItems` and the
`"show-items-new-tab-command"` entry in `MENU_HINTS`. `Refresh` leaves the
item menu; it is added to Tools in Task 12.

- [ ] **Step 2: Locale**

Delete `show-items-new-tab-command` from `addon/locale/en-US/mainWindow.ftl`
and add:

```
add-to-submenu =
    .label = Add to

add-to-empty-command =
    .label = No graphs are open.
```

`open-focus-view-new-tab-command` keeps its plural forms and its label
("New Graph from item" / "New Graph from { $count } items"), and
`open-existing-view-command` stays as the per-graph row. Regenerate
`typings/i10n.d.ts` as in Task 12: add `add-to-submenu` and
`add-to-empty-command`, remove `show-items-new-tab-command`.

- [ ] **Step 3: Run the gate and the suite**

Run: `npm run check`
Expected: PASS.
Run: `npm test`
Expected: only the three known failures.

- [ ] **Step 4: Commit**

```bash
git add src/services/menuService.ts addon/locale/en-US/mainWindow.ftl \
  typings/i10n.d.ts
git commit -m "Reduce the item menu to New Graph from N items and Add to

Showing and seeding are the same act now, so Show in New Graph and the flat
Show in / Add as seed rows go; the per-graph rows are grouped in one Add to
submenu, and Refresh moves to Tools. That is B4.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa"
```

---

### Task 14: The Zotero regression tests

Four behaviours the unit tests cannot reach, driven through the plugin's own
menus. The test bundle is a second copy of the plugin, so nothing here reaches
into a view directly: a graph is opened from Tools › Meristema, and the
outcome is read from the rendered DOM.

**Files:**

- Create: `test/zotero/graphScopeRail.test.ts`

**Interfaces:**

- Consumes: `delay` from `test/zotero/visualHarness.ts`;
  `createSavedGraph`, `deleteSavedGraph` from `savedGraphService.ts`;
  `emptyGraphViewState` from `graphViewState.ts`; the same
  `shown`/`customMenu`/`command`/`waitFor`/`buttonNamed` helpers
  `externalSeedImport.test.ts` defines — copy them, as that test did.

- [ ] **Step 1: Write the file**

Create `test/zotero/graphScopeRail.test.ts`. Structure it like
`externalSeedImport.test.ts`: a `before` that creates a collection named by

```ts
const COLLECTION_NAME = "Stage 2 scope";
```

and two `journalArticle` fixtures filed in it, then opens a graph through
Tools › Meristema › New Graph and waits for `.cm-scope-section` to appear; an
`after` that closes the tab and deletes both fixtures and the collection. The
four cases:

```ts
it("keeps a folder's other papers when one of them becomes a seed", async function () {
  // D1, directly: seeding a paper only ever adds. Before the additive
  // model, this dropped every unconnected paper in the folder.
  this.timeout(30_000);
  const before = scopeCount();
  expect(before).to.be.at.least(2);
  (await nodeMenuEntry("Add as seed")).click();
  await waitFor(() => seedRowCount() === 1, 10_000);
  expect(scopeCount()).to.be.at.least(before);
  expect(scopeTotal()).to.be.at.least(before);
});

it("removes a folder's papers when it is unticked and keeps the seed", async function () {
  // The old focus view as a position rather than a mode: untick the folder
  // and the seed and its neighbours are what is left.
  this.timeout(30_000);
  const before = scopeCount();
  const box = scopeRowLabelled(COLLECTION_NAME).querySelector(
    "input",
  ) as HTMLInputElement;
  box.click();
  await waitFor(() => scopeCount() < before, 5_000);
  expect(scopeCount()).to.be.lessThan(before);
  // No rule can hide a seed, so the seed row and its paper are still there.
  expect(seedRowCount()).to.equal(1);
  box.click();
  await waitFor(() => scopeCount() === before, 5_000);
  expect(scopeCount()).to.equal(before);
});

it("has File and no Seeds button, and opens the panel from the rail", async function () {
  this.timeout(30_000);
  const toolbar = graphRoot().querySelector(
    ".cm-command-actions",
  ) as HTMLElement;
  expect(toolbar.textContent).to.contain("File");
  expect(toolbar.textContent).to.not.contain("seeds");
  const add = graphRoot().querySelector(
    ".cm-scope-add-seed",
  ) as HTMLButtonElement;
  add.click();
  await delay(50);
  const popover = graphRoot().querySelector(
    ".cm-focus-seed-popover",
  ) as HTMLElement;
  expect(popover.hidden).to.equal(false);
});

it("hides a paper and brings it back with Show all", async function () {
  this.timeout(30_000);
  (await nodeMenuEntry("Remove from graph")).click();
  await waitFor(
    () => graphRoot().querySelector(".cm-scope-hidden") !== null,
    5_000,
  );
  const hidden = graphRoot().querySelector(".cm-scope-hidden");
  expect(hidden?.textContent).to.contain("1 hidden");
  (
    graphRoot().querySelector(".cm-scope-show-all") as HTMLButtonElement
  ).click();
  await delay(50);
  expect(graphRoot().querySelector(".cm-scope-hidden")).to.equal(null);
});
```

The helpers, above the `describe`:

```ts
/** The rendered graph in the active tab. There is exactly one. */
function graphRoot(): HTMLElement {
  const root = win.document.querySelector(
    ".meristema-root",
  ) as HTMLElement | null;
  expect(root, "the graph is rendered").to.exist;
  return root as HTMLElement;
}

/** The `shown` half of the rail's `{shown} of {total} papers`. */
function scopeCount(): number {
  const line = graphRoot().querySelector(".cm-scope-count")?.textContent ?? "";
  return Number(/^([\d,]+) of/.exec(line)?.[1]?.replace(/,/g, "") ?? "0");
}

/** The `total` half, which no tick and no search moves. */
function scopeTotal(): number {
  const line = graphRoot().querySelector(".cm-scope-count")?.textContent ?? "";
  return Number(/of ([\d,]+) papers/.exec(line)?.[1]?.replace(/,/g, "") ?? "0");
}

function scopeRowLabelled(name: string): HTMLElement {
  const rows = Array.from(
    graphRoot().querySelectorAll(".cm-scope-row"),
  ) as HTMLElement[];
  const row = rows.find(
    (candidate) =>
      candidate.querySelector(".cm-scope-row-label")?.textContent?.trim() ===
      name,
  );
  expect(row, `a Scope row for ${name}`).to.exist;
  return row as HTMLElement;
}

/** How many seed rows the rail lists. */
function seedRowCount(): number {
  return graphRoot().querySelectorAll(".cm-scope-seed").length;
}

/**
 * Right-click the plot at its centre and press one of the node menu's
 * entries. The canvas is what carries the context menu, and the menu is
 * ordinary DOM once it is open, so no test-only hook is needed.
 */
async function nodeMenuEntry(label: string): Promise<HTMLButtonElement> {
  const canvas = graphRoot().querySelector("canvas") as HTMLCanvasElement;
  const box = canvas.getBoundingClientRect();
  canvas.dispatchEvent(
    new win.MouseEvent("contextmenu", {
      bubbles: true,
      clientX: box.left + box.width / 2,
      clientY: box.top + box.height / 2,
    }),
  );
  const entry = await waitFor(
    () =>
      (
        Array.from(
          graphRoot().querySelectorAll(".cm-node-menu-item"),
        ) as HTMLButtonElement[]
      ).find(
        (button) => button.textContent?.trim() === label && !button.hidden,
      ) ?? null,
    5_000,
  );
  expect(entry, `a node menu entry reading ${label}`).to.exist;
  return entry as HTMLButtonElement;
}
```

Each case that needs a seed presses `await nodeMenuEntry("Add as seed")` and
then `.click()`; the hide case presses `Remove from graph`. Aim the
contextmenu at a node by first fitting the view — the `before` opens the graph
on a two-paper library, so the centre of the plot is over a node. If it is
not, pan is not worth fighting: assert on `scopeCount()` and `seedRowCount()`,
which move for the same reasons, rather than reaching into the renderer.

Do not add a test-only hook to `graphViewService.ts`. Two constraints learned
the hard way and recorded in the session memory apply here:

- the plugin under test is a **second copy**, so drive everything through the
  plugin's own menus and DOM rather than importing the live view's module;
- a stub must outlive an async `onCommand`; stub `Services.prompt` by
  redefining the property, never by assignment.

The four cases run in order against one graph, so the seed the first adds is
the seed the second and fourth rely on; keep them in one `describe` and do not
reorder them.

- [ ] **Step 2: Run the suite**

Run: `npm test`
Expected: the four new cases pass; the three known failures are unchanged.
If a new case is flaky, make it wait on a condition with `waitFor` rather than
on a fixed `delay`.

- [ ] **Step 3: Run the gate and commit**

Run: `npm run check`
Expected: PASS.

```bash
git add test/zotero/graphScopeRail.test.ts
git commit -m "Walk the Scope rail in a real Zotero

D1 directly: a folder graph plus a seed keeps the folder's other papers.
Unticking a folder on a seeded graph leaves the seed's neighbours; the toolbar
has File and no Seeds button; Remove from graph and Show all round-trip.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa"
```

---

### Task 15: The documentation, the roadmap and the manual batch

**Files:**

- Modify: `README.md`,
  `docs/superpowers/handoffs/2026-09-08-roadmap.md`,
  `docs/superpowers/specs/2026-09-08-graph-scope-rail-design.md`,
  `.superpowers/sdd/progress.md`

- [ ] **Step 1: Describe seeds as additive in the README**

Replace the Explore bullet:

```markdown
- **Explore outward from one or more papers**
  Add "seed" papers to a graph and it shows their references, citing papers, or both — alongside everything the graph was already drawing, not instead of it. Add a seed from the rail's Scope section, from a paper's detail pane, or by right-clicking its node; include papers outside Zotero, and choose the direction and scope behind the gear. Untick every folder and the seeds and their neighbours are all that is left; tick them back and the rest returns.
  ![Explore](docs/assets/FocusView.png)
```

and, in the multiple-views bullet, replace the sentence naming the old menu
entries:

```markdown
Rename views and use `New Graph from item` or `Add to ›` to create a new view or add papers to an existing one.
```

and replace "Save a graph from the toolbar's Graph menu" with "Save a graph
from the toolbar's File menu", and "reopens from the Graph menu" with
"reopens from the File menu".

- [ ] **Step 2: Mark the spec implemented**

Change the spec's status line to
`**Status:** Approved 2026-09-08, implemented 2026-09-08`.

- [ ] **Step 3: Tick the roadmap and append the manual checks**

In `docs/superpowers/handoffs/2026-09-08-roadmap.md`, tick Stage 2's plan and
implementation boxes (leave "manual walk-through by the user" unticked), and
append to the Manual verification section:

```markdown
- [ ] Stage 2: a folder graph plus a seed keeps the folder's other papers on
      screen. (Also covered by `test/zotero/graphScopeRail.test.ts`.)
- [ ] Stage 2: unticking every folder on a seeded graph leaves the seeds and
      their neighbours; ticking them back restores the rest.
- [ ] Stage 2: a seed's citer already in the library wears a thin ring; one
      that is not does not. Seeds keep their bullseye, in their own colour.
- [ ] Stage 2: hovering a Seeds row lights that seed and its edges, and moving
      to a Key entry strands no highlight.
- [ ] Stage 2: the seed search panel opens from the rail's "+ Add seed", keeps
      its width over the plot, and its rows have clear space between title and
      metadata.
- [ ] Stage 2: File and Tools › Meristema offer New Graph, Open, Save and
      Save as… in that order; in Tools the last two are greyed with no graph
      tab open.
- [ ] Stage 2: right-clicking papers offers "New Graph from N items" and an
      "Add to" submenu listing the open graphs, and no Refresh; Refresh is in
      Tools › Meristema.
- [ ] Stage 2: a graph saved before this release opens showing the same papers
      it drew before — in particular one scoped to a parent folder still draws
      that folder's whole subtree.
```

That last one is the migration, and it is the check that matters most: it is
the one that would lose the user's saved work.

- [ ] **Step 4: Add the log line**

Append to the roadmap's Log:

```markdown
- 2026-09-08: Stage 2 planned and implemented (`graph-scope-rail`): the focus
  projection is retired for one additive model plus a pure visibility order,
  items become seeds, folders move into the rail as a checkbox tree with
  Unfiled and Not in Zotero, Remove from graph and Show all arrive, the
  toolbar's Graph menu becomes File and is mirrored in Tools, and the item menu
  becomes New Graph from N items plus an Add to submenu. State version 2 with
  a migration. Resolves D1 and D2, decides B4.
```

- [ ] **Step 5: Record the plan in the ledger**

Append a line to `.superpowers/sdd/progress.md` in whatever shape that file
already uses, naming this plan and the branch.

- [ ] **Step 6: Run the gate and commit**

Run: `npm run check`
Expected: PASS (prettier checks the markdown too).

```bash
git add README.md docs/ .superpowers/sdd/progress.md
git commit -m "Tick Stage 2 and file its manual checks

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa"
```

- [ ] **Step 7: Build the XPI and push**

```bash
npm run build
git push -u gh-daniel-locatelli graph-scope-rail
```

Then fast-forward `main` to the branch, per the working rules, and rebuild so
`.scaffold/build/meristema.xpi` is the XPI the user installs for the manual
batch.
