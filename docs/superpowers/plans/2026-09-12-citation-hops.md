# Citation Hops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-hop focus projection with a breadth-first hop model over one direction, fetched lazily by a priority-ordered runner, with a Citation hops block in the rail, a Citation hop colouring, hop opacity on the plot, graph state version 5 and the Cornerstones view lit.

**Architecture:** Three new pure modules carry the logic: `graphHopModel.ts` (the walk: entries, nodes, edges), `graphHopFillModel.ts` (the planner: which shown paper to expand next, under a per-hop cap) and the hop rule inside `graphScopeModel.ts` (visibility beside the folder rule). `graphViewService.ts` swaps its `GraphFocusProjection` for a `GraphHopModel`, keeps the same seed bookkeeping, and gains a runner with its own queue, epoch and counter that expands one paper at a time through `refreshExternalRelationships`. The renderer learns hops through a `setHops` map, never through a node field, because `additiveGraphModel` keeps the library's own node objects.

**Tech Stack:** TypeScript, Zotero 7 plugin (zotero-plugin-scaffold), `node --test` with chai for unit tests under `test/unit`, the Zotero suite under `test/zotero` (mocha, launched with `npm test`), prettier + eslint via `npm run check`.

**Spec:** `docs/superpowers/specs/2026-09-12-citation-hops-design.md`. Read it once before starting; each task names the spec section it implements.

## Global Constraints

- Branch `citation-hops`. Never push. `main` is ahead of `origin/main` and stays unpushed.
- `npm run check` (prettier, eslint, `tsc --noEmit` for `src` and `test`, unit tests) must pass before every commit. Run `npx prettier --write` on every file you touch, including docs.
- `npm test` launches Zotero; the user permits it. Wait for the previous run's process to exit before the next one (EBUSY on cert9.db otherwise). `npm test` deletes the XPI; the last step of the plan rebuilds it. Never `Stop-Process zotero` without asking.
- Commit messages end with the two attribution lines given in the session's system reminder (`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` and the `Claude-Session:` line).
- Numbers from the spec: hop depth 1..6 (`MAX_HOP_DEPTH = 6`); per-expansion membership limit is `AUTOMATIC_RELATIONSHIP_MEMBERSHIP_LIMIT` (50); the cap is 500 expansions per hop per direction per session, raised by 500 per Fetch more; hop opacity ramp `[1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4]`; runner-originated column refreshes and snapshot invalidations coalesce to one per 10 000 ms; `GRAPH_VIEW_STATE_VERSION = 5`.
- Copy, verbatim: rail block heading **Citation hops**; switch cells **Citers** | **References**; rows **Seeds**, **Hop 1** … **Hop 6**; count `{shown}/{available}`, muted suffix `of {reported}`, or **not fetched**; button **Fetch hop N**; progress line `expanding · {n} left` with **Stop** / **Resume**; cap line `500 expanded · {n} waiting` with **Fetch more**; colouring label **Citation hop** with categories `Seed`, `Hop 1` … `Hop 6`; migration status `Directions are now one at a time; showing Citers`; Cornerstones summary `Seeds, 2 hops of references, colour citations. What the field rests on.`; tutorial chip `hops 2 · references`.
- Zotero suite conventions: drive the plugin through its own menus, put evidence in assertion messages, and run timing-shaped cases twice. `Zotero.debug` never reaches the runner log.
- The design's presets, estimate, progress bar and hop-row-click-raises-depth are not built (spec, "What survives, moves, or goes").

---

### Task 1: The hop model

Spec: "The hop model". A pure walk from the seeds over stored lists.

**Files:**

- Create: `src/services/graphHopModel.ts`
- Modify: `src/domain/graphTypes.ts` (optional `hop` on a node)
- Test: `test/unit/graphHopModel.test.ts`

**Interfaces:**

- Consumes: `CitationGraphNode`, `CitationGraphEdge` from `src/domain/graphTypes.ts`; `assignFocusCitationSequence` from `src/services/citationSequenceService.ts`.
- Produces: `HopDirection`, `MAX_HOP_DEPTH`, `HopEntry`, `HopNeighbour`, `HopNeighbourhood`, `HopNeighbourLookup`, `GraphHopModel`, `buildGraphHopModel(input)`, `hopByKey(model)`, `reachedFromSeed(model, seedKey)`, `clampHopDepth(value)`. Tasks 2, 3, 8, 11 and 12 use these names exactly.

- [ ] **Step 1: Add the optional `hop` field to the node type**

In `src/domain/graphTypes.ts`, directly under `focusRole?: CitationGraphFocusRole | null;` (line 60) add:

```ts
  /**
   * Distance from the nearest seed along the graph's hop direction, stamped
   * by `graphHopModel.ts` on the external nodes it builds. Never read by the
   * renderer or the Key, which take the hop map from `setHops`, because
   * `additiveGraphModel` keeps the library's own node object and drops the
   * model's copy for a library paper.
   */
  hop?: number | null;
```

- [ ] **Step 2: Write the failing tests**

Create `test/unit/graphHopModel.test.ts`:

```ts
import { describe, it } from "node:test";
import { expect } from "chai";
import type { CitationGraphNode } from "../../src/domain/graphTypes";
import {
  buildGraphHopModel,
  clampHopDepth,
  hopByKey,
  reachedFromSeed,
  type HopNeighbourLookup,
  type HopNeighbourhood,
} from "../../src/services/graphHopModel";

function node(
  key: string,
  overrides: Partial<CitationGraphNode> = {},
): CitationGraphNode {
  return {
    key,
    itemID: overrides.kind === "external" ? 0 : 1,
    itemKey: key,
    kind: "local",
    focusRole: null,
    externalWork: null,
    title: key,
    authors: [],
    year: null,
    citationCount: null,
    referenceCount: null,
    references: [],
    tags: [],
    collectionIDs: [],
    ...overrides,
  } as unknown as CitationGraphNode;
}

/** `lists[key]` is the paper's stored list; a missing key is "not expanded". */
function lookup(
  lists: Record<string, string[]>,
  nodes: Record<string, CitationGraphNode> = {},
): HopNeighbourLookup {
  return (key): HopNeighbourhood => {
    const list = lists[key];
    if (!list) return { expanded: false, neighbours: [] };
    return {
      expanded: true,
      neighbours: list.map((k) => ({
        node: nodes[k] ?? node(k, { kind: "external", itemID: 0 }),
        provenance: "openalex",
      })),
    };
  };
}

describe("buildGraphHopModel", function () {
  it("gives a seed with two citers two hop-1 entries", function () {
    const model = buildGraphHopModel({
      seeds: [node("s")],
      direction: "cited-by",
      depth: 1,
      neighbours: lookup({ s: ["a", "b"] }),
    })!;
    expect(model.entries.get("a")).to.deep.include({ hop: 1, parents: ["s"] });
    expect(model.entries.get("b")).to.deep.include({ hop: 1, parents: ["s"] });
    expect(model.entries.get("s")).to.deep.include({ hop: 0, expanded: true });
    expect(model.availableByHop).to.deep.equal([1, 2]);
  });

  it("gives a paper cited by two hop-1 papers two parents and hop 2", function () {
    const model = buildGraphHopModel({
      seeds: [node("s")],
      direction: "cited-by",
      depth: 2,
      neighbours: lookup({ s: ["a", "b"], a: ["c"], b: ["c"] }),
    })!;
    expect(model.entries.get("c")).to.deep.include({ hop: 2 });
    expect([...model.entries.get("c")!.parents].sort()).to.deep.equal([
      "a",
      "b",
    ]);
  });

  it("sits a paper reachable at hops 1 and 3 at hop 1", function () {
    const model = buildGraphHopModel({
      seeds: [node("s")],
      direction: "cited-by",
      depth: 3,
      neighbours: lookup({ s: ["a", "x"], a: ["b"], b: ["x"] }),
    })!;
    expect(model.entries.get("x")!.hop).to.equal(1);
    expect([...model.entries.get("x")!.parents].sort()).to.deep.equal([
      "b",
      "s",
    ]);
  });

  it("keeps a seed reached from another seed at hop 0", function () {
    const model = buildGraphHopModel({
      seeds: [node("s"), node("t")],
      direction: "cited-by",
      depth: 1,
      neighbours: lookup({ s: ["t"], t: [] }),
    })!;
    expect(model.entries.get("t")!.hop).to.equal(0);
    // The seed-to-seed link is still an edge: t cites s.
    expect(
      model.edges.map((edge) => `${edge.source}>${edge.target}`),
    ).to.include("t>s");
  });

  it("stops at the depth and marks what is not expanded", function () {
    const model = buildGraphHopModel({
      seeds: [node("s")],
      direction: "cited-by",
      depth: 1,
      neighbours: lookup({ s: ["a"], a: ["b"] }),
    })!;
    expect(model.entries.has("b")).to.equal(false);
    expect(model.entries.get("a")!.expanded).to.equal(true);
    const unexpanded = buildGraphHopModel({
      seeds: [node("s")],
      direction: "cited-by",
      depth: 2,
      neighbours: lookup({ s: ["a"] }),
    })!;
    expect(unexpanded.entries.get("a")!.expanded).to.equal(false);
    expect(unexpanded.availableByHop).to.deep.equal([1, 1, 0]);
  });

  it("runs the edges the other way under references", function () {
    const cited = buildGraphHopModel({
      seeds: [node("s")],
      direction: "cited-by",
      depth: 1,
      neighbours: lookup({ s: ["a"] }),
    })!;
    expect(cited.edges[0]).to.include({ source: "a", target: "s" });
    const refs = buildGraphHopModel({
      seeds: [node("s")],
      direction: "references",
      depth: 1,
      neighbours: lookup({ s: ["a"] }),
    })!;
    expect(refs.edges[0]).to.include({ source: "s", target: "a" });
  });

  it("emits an external neighbour as an external node stamped with its hop", function () {
    const model = buildGraphHopModel({
      seeds: [node("s")],
      direction: "cited-by",
      depth: 1,
      neighbours: lookup({ s: ["a"] }),
    })!;
    const a = model.nodes.find((n) => n.key === "a")!;
    expect(a.kind).to.equal("external");
    expect(a.hop).to.equal(1);
    expect(a.focusRole).to.equal("cited-by");
    expect(model.externalKeys.has("a")).to.equal(true);
    expect(model.externalKeys.has("s")).to.equal(false);
  });

  it("treats a stored empty list as expanded", function () {
    const model = buildGraphHopModel({
      seeds: [node("s")],
      direction: "cited-by",
      depth: 2,
      neighbours: lookup({ s: ["a"], a: [] }),
    })!;
    expect(model.entries.get("a")!.expanded).to.equal(true);
  });

  it("returns null without seeds and clamps the depth", function () {
    expect(
      buildGraphHopModel({
        seeds: [],
        direction: "cited-by",
        depth: 1,
        neighbours: lookup({}),
      }),
    ).to.equal(null);
    expect(clampHopDepth(0)).to.equal(1);
    expect(clampHopDepth(9)).to.equal(6);
    expect(clampHopDepth("x")).to.equal(1);
    expect(clampHopDepth(3.7)).to.equal(3);
  });

  it("answers hopByKey and reachedFromSeed from the entries", function () {
    const model = buildGraphHopModel({
      seeds: [node("s"), node("t")],
      direction: "cited-by",
      depth: 2,
      neighbours: lookup({ s: ["a"], t: ["b"], a: ["c"], b: [] }),
    })!;
    expect(hopByKey(model).get("c")).to.equal(2);
    expect(hopByKey(model).get("s")).to.equal(0);
    expect([...reachedFromSeed(model, "s")].sort()).to.deep.equal(["a", "c"]);
    expect([...reachedFromSeed(model, "t")]).to.deep.equal(["b"]);
  });

  it("assigns the seed-relative citation sequence, the seeded graph's default X axis", function () {
    // The projection was the only caller of assignFocusCitationSequence; the
    // model takes that over. Citers sit after the seed, references before it.
    const citers = buildGraphHopModel({
      seeds: [node("s")],
      direction: "cited-by",
      depth: 1,
      neighbours: lookup({ s: ["a"] }),
    })!;
    expect(citers.nodes.find((n) => n.key === "s")!.citationSequence).to.equal(
      0,
    );
    expect(
      citers.nodes.find((n) => n.key === "a")!.citationSequence,
    ).to.be.greaterThan(0);
    const refs = buildGraphHopModel({
      seeds: [node("s")],
      direction: "references",
      depth: 1,
      neighbours: lookup({ s: ["a"] }),
    })!;
    expect(
      refs.nodes.find((n) => n.key === "a")!.citationSequence,
    ).to.be.lessThan(0);
    expect(refs.nodes.find((n) => n.key === "a")!.focusRole).to.equal(
      "reference",
    );
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/graphHopModel.test.ts`
Expected: FAIL, "Cannot find module '../../src/services/graphHopModel'".

- [ ] **Step 4: Write the module**

Create `src/services/graphHopModel.ts`:

```ts
/**
 * The hop model: a breadth-first walk from the seeds over the stored citation
 * lists in one direction. Pure and DOM-free. It never fetches; the runner in
 * graphViewService.ts fills the lists it reads (spec, "The hop model").
 */
import type {
  CitationGraphEdge,
  CitationGraphNode,
} from "../domain/graphTypes";
import { assignFocusCitationSequence } from "./citationSequenceService";

export type HopDirection = "cited-by" | "references";

export const MAX_HOP_DEPTH = 6;

export interface HopEntry {
  key: string;
  /** 0 for seeds, 1..depth otherwise. */
  hop: number;
  /** Every paper one hop shallower that links here. */
  parents: string[];
  /** Its own list in this direction is stored. */
  expanded: boolean;
}

export interface HopNeighbour {
  /** The library's own node, or an external node built from the stored work. */
  node: CitationGraphNode;
  provenance: string;
}

export interface HopNeighbourhood {
  /** A stored summary exists for this paper in this direction. */
  expanded: boolean;
  neighbours: readonly HopNeighbour[];
}

export type HopNeighbourLookup = (
  key: string,
  direction: HopDirection,
) => HopNeighbourhood;

export interface GraphHopModel {
  direction: HopDirection;
  depth: number;
  seeds: CitationGraphNode[];
  seedKeys: Set<string>;
  entries: Map<string, HopEntry>;
  /** Every paper reached, seeds first, each once. */
  nodes: CitationGraphNode[];
  /** One edge per parent link, citer → cited. */
  edges: CitationGraphEdge[];
  externalKeys: Set<string>;
  /** Papers reached at each hop; index 0 is the seeds. Length depth + 1. */
  availableByHop: number[];
}

export interface GraphHopInput {
  seeds: readonly CitationGraphNode[];
  direction: HopDirection;
  depth: number;
  neighbours: HopNeighbourLookup;
  /** Library edges between seeds, kept as they are. */
  seedEdges?: readonly CitationGraphEdge[];
}

export function clampHopDepth(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.min(MAX_HOP_DEPTH, Math.max(1, Math.floor(value)));
}

function hopEdge(
  source: string,
  target: string,
  provenance: string,
): CitationGraphEdge {
  return {
    key: `${source}>${target}:hop`,
    source,
    target,
    provenance,
    manual: false,
  };
}

function cloneNode(
  node: CitationGraphNode,
  role: CitationGraphNode["focusRole"],
  hop: number,
): CitationGraphNode {
  return {
    ...node,
    kind: node.kind ?? "local",
    focusRole: role,
    hop,
    authors: [...node.authors],
    tags: [...node.tags],
    collectionIDs: [...node.collectionIDs],
    references: [...node.references],
    externalWork: node.externalWork
      ? { ...node.externalWork, authors: [...node.externalWork.authors] }
      : null,
  };
}

export function buildGraphHopModel(input: GraphHopInput): GraphHopModel | null {
  const depth = clampHopDepth(input.depth);
  const seeds = [
    ...new Map(input.seeds.map((seed) => [seed.key, seed])).values(),
  ].map((seed) => cloneNode(seed, "seed", 0));
  if (!seeds.length) return null;
  const seedKeys = new Set(seeds.map((seed) => seed.key));
  const role = input.direction === "references" ? "reference" : "cited-by";

  const entries = new Map<string, HopEntry>();
  const nodes = new Map<string, CitationGraphNode>();
  const edges = new Map<string, CitationGraphEdge>();
  for (const edge of input.seedEdges ?? []) {
    if (seedKeys.has(edge.source) && seedKeys.has(edge.target)) {
      edges.set(edge.key, { ...edge });
    }
  }
  for (const seed of seeds) {
    nodes.set(seed.key, seed);
    entries.set(seed.key, {
      key: seed.key,
      hop: 0,
      parents: [],
      expanded: input.neighbours(seed.key, input.direction).expanded,
    });
  }

  let frontier = seeds.map((seed) => seed.key);
  for (let hop = 1; hop <= depth && frontier.length; hop += 1) {
    const next: string[] = [];
    for (const parentKey of frontier) {
      const neighbourhood = input.neighbours(parentKey, input.direction);
      for (const neighbour of neighbourhood.neighbours) {
        const key = neighbour.node.key;
        if (key === parentKey) continue;
        const edge =
          input.direction === "references"
            ? hopEdge(parentKey, key, neighbour.provenance)
            : hopEdge(key, parentKey, neighbour.provenance);
        if (!edges.has(edge.key)) edges.set(edge.key, edge);
        const existing = entries.get(key);
        if (existing) {
          // A seed is never reassigned; a paper keeps its shallowest hop and
          // gains the parent.
          if (!existing.parents.includes(parentKey)) {
            existing.parents.push(parentKey);
          }
          continue;
        }
        entries.set(key, {
          key,
          hop,
          parents: [parentKey],
          expanded: input.neighbours(key, input.direction).expanded,
        });
        nodes.set(key, cloneNode(neighbour.node, role, hop));
        next.push(key);
      }
    }
    frontier = next;
  }

  const availableByHop = Array.from({ length: depth + 1 }, () => 0);
  for (const entry of entries.values()) availableByHop[entry.hop] += 1;

  const projectedNodes = [...nodes.values()];
  const projectedEdges = [...edges.values()];
  assignFocusCitationSequence(projectedNodes, projectedEdges, seeds[0].key);
  return {
    direction: input.direction,
    depth,
    seeds,
    seedKeys,
    entries,
    nodes: projectedNodes,
    edges: projectedEdges,
    externalKeys: new Set(
      projectedNodes
        .filter((node) => node.kind === "external")
        .map((node) => node.key),
    ),
    availableByHop,
  };
}

/** The hop of every paper the model reached, for the renderer and the Key. */
export function hopByKey(model: GraphHopModel): Map<string, number> {
  return new Map(
    [...model.entries.values()].map((entry) => [entry.key, entry.hop]),
  );
}

/**
 * Every paper whose chain of parents leads back to this seed. The rail's seed
 * row emphasises these.
 */
export function reachedFromSeed(
  model: GraphHopModel,
  seedKey: string,
): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const entry of model.entries.values()) {
    for (const parent of entry.parents) {
      const list = childrenOf.get(parent) ?? [];
      list.push(entry.key);
      childrenOf.set(parent, list);
    }
  }
  const reached = new Set<string>();
  const stack = [...(childrenOf.get(seedKey) ?? [])];
  while (stack.length) {
    const key = stack.pop()!;
    if (reached.has(key) || model.seedKeys.has(key)) continue;
    reached.add(key);
    stack.push(...(childrenOf.get(key) ?? []));
  }
  return reached;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/graphHopModel.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/services/graphHopModel.ts src/domain/graphTypes.ts test/unit/graphHopModel.test.ts
git add src/services/graphHopModel.ts src/domain/graphTypes.ts test/unit/graphHopModel.test.ts
git commit -m "Stage 3: the hop model, a breadth-first walk over stored lists"
```

---

### Task 2: The hop rule in the scope model

Spec: "Visibility, in order". The hop rule sits beside the folder rule; a seed still only adds.

**Files:**

- Modify: `src/services/graphScopeModel.ts:118-215`
- Test: `test/unit/graphScopeModel.test.ts`, `test/unit/graphScopeRailModel.test.ts:44-60` (its `emptyScope` fixture)

**Interfaces:**

- Consumes: `HopEntry` from Task 1 (only `hop` and `parents` are read; the type below is structural so tests need no model).
- Produces: `GraphScopeHops`, `GraphScopeInput.hops` (replaces `reachedKeys`), `GraphScopeResult.shownByHop`, `GraphScopeResult.availableByHop`. Task 8 reads the two arrays; Task 11 builds `hops`.

- [ ] **Step 1: Write the failing tests**

Replace every `reachedKeys: new Set()` in `test/unit/graphScopeModel.test.ts` and `test/unit/graphScopeRailModel.test.ts` with `hops: noHops()`, and add at the top of each file, after the imports:

```ts
import type { GraphScopeHops } from "../../src/services/graphScopeModel";

function noHops(): GraphScopeHops {
  return { entries: new Map(), depth: 1, enabled: [true, true] };
}
```

Existing cases that passed `reachedKeys: new Set(["x"])` (grep them) become hop entries: `hops: { entries: new Map([["x", { hop: 1, parents: ["s"] }]]), depth: 1, enabled: [true, true] }` with `"s"` the seed those cases already pass in `seedKeys`. Keep their assertions.

Append to `test/unit/graphScopeModel.test.ts`:

```ts
function hops(
  spec: Record<string, [number, string[]]>,
  depth: number,
  enabled: boolean[] = [true, true, true, true, true, true, true],
): GraphScopeHops {
  return {
    entries: new Map(
      Object.entries(spec).map(([key, [hop, parents]]) => [
        key,
        { hop, parents },
      ]),
    ),
    depth,
    enabled,
  };
}

describe("computeGraphScope with hops", function () {
  // s → a (hop 1) → b (hop 2) → c (hop 3); every paper external, no folders.
  const chain = hops(
    { s: [0, []], a: [1, ["s"]], b: [2, ["a"]], c: [3, ["b"]] },
    3,
  );
  const external = [
    paper("s"),
    paper("a", [], false),
    paper("b", [], false),
    paper("c", [], false),
  ];

  it("disabling hop 2 hides a hop-3 external paper through its parent", function () {
    const result = scope({
      papers: external,
      seedKeys: new Set(["s"]),
      hops: { ...chain, enabled: [true, true, false, true] },
    });
    expect([...result.visibleKeys].sort()).to.deep.equal(["a", "s"]);
    expect(result.shownByHop).to.deep.equal([1, 1, 0, 0]);
    expect(result.availableByHop).to.deep.equal([1, 1, 1, 1]);
  });

  it("keeps a folder-admitted hop-3 library paper and its child when hop 2 is unticked", function () {
    const result = scope({
      papers: [
        paper("s"),
        paper("a", [], false),
        paper("b", [], false),
        paper("c", [1]),
        paper("d", [], false),
      ],
      seedKeys: new Set(["s"]),
      hops: hops(
        {
          s: [0, []],
          a: [1, ["s"]],
          b: [2, ["a"]],
          c: [3, ["b"]],
          d: [4, ["c"]],
        },
        4,
        [true, true, false, true, true],
      ),
    });
    // c is filed in a ticked folder: a seed only ever adds, a hop toggle never
    // removes it. d hangs off c, which is visible, so d stays too.
    expect([...result.visibleKeys].sort()).to.deep.equal(["a", "c", "d", "s"]);
  });

  it("hides the child when the folder holding its only parent is unticked", function () {
    const result = scope({
      papers: [paper("s"), paper("p", [7]), paper("q", [], false)],
      seedKeys: new Set(["s"]),
      ticks: setCollectionTicks(allCollectionsTicked(), [7], false),
      includeUnfiled: false,
      hops: hops({ s: [0, []], p: [1, ["s"]], q: [2, ["p"]] }, 2),
    });
    // p is reached by hop 1, so the hop rule admits it whatever the folder;
    // that is today's "unticking a folder never removes what a seed brought".
    expect(result.visibleKeys.has("p")).to.equal(true);
    const unreached = scope({
      papers: [paper("s"), paper("p", [7]), paper("q", [], false)],
      seedKeys: new Set(["s"]),
      ticks: setCollectionTicks(allCollectionsTicked(), [7], false),
      includeUnfiled: false,
      hops: hops({ s: [0, []], q: [2, ["p"]] }, 2),
    });
    // p has no hop entry here (its list is what made q hop 2 in another
    // direction); with its folder unticked it is gone, and so is q.
    expect(unreached.visibleKeys.has("p")).to.equal(false);
    expect(unreached.visibleKeys.has("q")).to.equal(false);
  });

  it("keeps a paper with one visible parent among two", function () {
    const result = scope({
      papers: [
        paper("s"),
        paper("a", [], false),
        paper("b", [], false),
        paper("c", [], false),
      ],
      seedKeys: new Set(["s"]),
      hiddenKeys: new Set(["a"]),
      hops: hops(
        { s: [0, []], a: [1, ["s"]], b: [1, ["s"]], c: [2, ["a", "b"]] },
        2,
      ),
    });
    expect(result.visibleKeys.has("c")).to.equal(true);
  });

  it("does not admit a hop past the depth", function () {
    const result = scope({
      papers: external,
      seedKeys: new Set(["s"]),
      hops: { ...chain, depth: 2 },
    });
    expect(result.visibleKeys.has("c")).to.equal(false);
    expect(result.availableByHop).to.deep.equal([1, 1, 1]);
  });

  it("leaves a library paper no hop reaches to the folder rule", function () {
    const result = scope({
      papers: [paper("s"), paper("lib", [3])],
      seedKeys: new Set(["s"]),
      ticks: setCollectionTicks(allCollectionsTicked(), [3], false),
      hops: hops({ s: [0, []] }, 3, [true, false, false, false]),
    });
    expect(result.visibleKeys.has("lib")).to.equal(false);
  });
});
```

The `scope(overrides)` helper already in the file spreads defaults; add `hops: noHops()` to its defaults where `reachedKeys` was.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/graphScopeModel.test.ts`
Expected: FAIL to compile (`hops` is not a known property; `reachedKeys` missing).

- [ ] **Step 3: Implement the hop rule**

In `src/services/graphScopeModel.ts`, replace the `reachedKeys` field of `GraphScopeInput` with:

```ts
/** The hop model's entries, depth and per-hop toggles; empty when seedless. */
hops: GraphScopeHops;
```

and add above `GraphScopeInput`:

```ts
/** What the hop rule needs of an entry; structurally `HopEntry` from graphHopModel.ts. */
export interface ScopeHopEntry {
  hop: number;
  parents: readonly string[];
}

export interface GraphScopeHops {
  entries: ReadonlyMap<string, ScopeHopEntry>;
  /** The deepest hop opened, 1..6. */
  depth: number;
  /** By hop; index 0 is the seeds and is always treated as true. */
  enabled: readonly boolean[];
}
```

Add to `GraphScopeResult`:

```ts
  /** Papers that survived every rule at each hop; index 0 is the seeds. */
  shownByHop: number[];
  /** Papers the walk reached at each hop, whatever the rules said. */
  availableByHop: number[];
```

Replace the doc comment and body of `computeGraphScope` with:

```ts
/**
 * The spec's order, and the reason it is an order rather than a conjunction.
 *
 * A seed is visible, always, and no later rule can hide one. Every other paper
 * is admitted by the folder rule or by the hop rule and can then be removed by
 * the rules after them.
 *
 * The two admitting rules sit *beside* each other: adding a seed only ever
 * adds papers, unticking a folder never removes a paper a hop brought in, and
 * unticking a hop never removes a paper you filed and ticked. Folder ticks are
 * a fact about how you filed a paper, so they say nothing about one you have
 * never filed; a year, an item type, a retraction and being outside Zotero
 * are facts about the paper itself, so they are true of a citer exactly as
 * they are of anything else.
 *
 * The hop rule reads a parent's visibility, so papers are walked in hop
 * order: a parent is settled before its children ask about it.
 */
export function computeGraphScope(input: GraphScopeInput): GraphScopeResult {
  const visibleKeys = new Set<string>();
  const countByCollection = new Map<number, number>();
  let unfiledCount = 0;
  let externalCount = 0;
  let hiddenCount = 0;
  const depth = input.hops.depth;
  const shownByHop = Array.from({ length: depth + 1 }, () => 0);
  const availableByHop = Array.from({ length: depth + 1 }, () => 0);

  const hopOf = (key: string): number =>
    input.hops.entries.get(key)?.hop ?? Number.POSITIVE_INFINITY;
  const ordered = [...input.papers].sort((a, b) => hopOf(a.key) - hopOf(b.key));

  for (const paper of ordered) {
    if (!paper.inLibrary) externalCount += 1;
    else if (!paper.collectionIDs.length) unfiledCount += 1;
    for (const collectionID of paper.collectionIDs) {
      countByCollection.set(
        collectionID,
        (countByCollection.get(collectionID) ?? 0) + 1,
      );
    }
    if (input.hiddenKeys.has(paper.key)) hiddenCount += 1;
    const entry = input.hops.entries.get(paper.key);
    if (entry && entry.hop <= depth) availableByHop[entry.hop] += 1;

    if (input.seedKeys.has(paper.key)) {
      visibleKeys.add(paper.key);
      shownByHop[0] += 1;
      continue;
    }
    const folderAdmitted =
      paper.inLibrary &&
      (paper.collectionIDs.length
        ? paper.collectionIDs.some((collectionID) =>
            isCollectionTicked(input.ticks, collectionID),
          )
        : input.includeUnfiled);
    const hopAdmitted =
      entry !== undefined &&
      entry.hop <= depth &&
      input.hops.enabled[entry.hop] !== false &&
      entry.parents.some((parent) => visibleKeys.has(parent));
    if (!folderAdmitted && !hopAdmitted) continue;
    if (!paper.inLibrary && !input.includeExternal) continue;
    if (input.hiddenKeys.has(paper.key)) continue;
    if (!input.facetAdmits(paper.key)) continue;
    visibleKeys.add(paper.key);
    if (entry && entry.hop <= depth) shownByHop[entry.hop] += 1;
  }

  return {
    visibleKeys,
    shown: visibleKeys.size,
    total: input.papers.length,
    countByCollection,
    unfiledCount,
    externalCount,
    hiddenCount,
    shownByHop,
    availableByHop,
  };
}
```

Also update the module header comment's first paragraph to say Stage 3 has inserted the hop rule and Stage 4 will insert the floor and the shared-citer filter.

- [ ] **Step 4: Run both test files**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/graphScopeModel.test.ts test/unit/graphScopeRailModel.test.ts`
Expected: PASS. (`graphViewService.ts` no longer compiles; Task 11 fixes it. `npm run check` is not expected to pass until then, so this task and the next ones commit on the unit tests of their own files.)

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/services/graphScopeModel.ts test/unit/graphScopeModel.test.ts test/unit/graphScopeRailModel.test.ts
git add src/services/graphScopeModel.ts test/unit/graphScopeModel.test.ts test/unit/graphScopeRailModel.test.ts
git commit -m "Stage 3: the hop rule sits beside the folder rule in the scope order"
```

---

### Task 3: The fill planner

Spec: "The fill" (planner and cap).

**Files:**

- Create: `src/services/graphHopFillModel.ts`
- Test: `test/unit/graphHopFillModel.test.ts`

**Interfaces:**

- Consumes: `HopEntry` from Task 1.
- Produces: `HOP_EXPANSION_CAP`, `HopFillInput`, `HopFillPlan`, `planHopFill(input)`. Task 12 calls `planHopFill`.

- [ ] **Step 1: Write the failing tests**

Create `test/unit/graphHopFillModel.test.ts`:

```ts
import { describe, it } from "node:test";
import { expect } from "chai";
import type { HopEntry } from "../../src/services/graphHopModel";
import {
  HOP_EXPANSION_CAP,
  planHopFill,
  type HopFillInput,
} from "../../src/services/graphHopFillModel";

function entry(
  key: string,
  hop: number,
  parents: string[] = [],
  expanded = false,
): [string, HopEntry] {
  return [key, { key, hop, parents, expanded }];
}

function input(overrides: Partial<HopFillInput> = {}): HopFillInput {
  return {
    entries: new Map([
      entry("s", 0, [], true),
      entry("a", 1, ["s"]),
      entry("b", 1, ["s"]),
      entry("c", 1, ["s"]),
      entry("d", 1, ["s"]),
    ]),
    visibleKeys: new Set(["s", "a", "b", "c", "d"]),
    depth: 2,
    selectedKey: null,
    hoveredKey: null,
    onScreenKeys: new Set(),
    failedKeys: new Set(),
    expandedByHop: [0, 0, 0],
    capByHop: [HOP_EXPANSION_CAP, HOP_EXPANSION_CAP, HOP_EXPANSION_CAP],
    reportedCountOf: () => null,
    ...overrides,
  };
}

describe("planHopFill", function () {
  it("leaves hidden papers out: scope gates the fill", function () {
    const plan = planHopFill(input({ visibleKeys: new Set(["s", "a"]) }));
    expect(plan.order).to.deep.equal(["a"]);
  });

  it("orders seeds, then selected, hovered, on screen, the rest", function () {
    const plan = planHopFill(
      input({
        entries: new Map([
          entry("s", 0),
          entry("a", 1, ["s"]),
          entry("b", 1, ["s"]),
          entry("c", 1, ["s"]),
          entry("d", 1, ["s"]),
        ]),
        selectedKey: "c",
        hoveredKey: "b",
        onScreenKeys: new Set(["d"]),
      }),
    );
    expect(plan.order).to.deep.equal(["s", "c", "b", "d", "a"]);
  });

  it("lets the camera reorder but never add or remove", function () {
    const before = planHopFill(input());
    const after = planHopFill(input({ onScreenKeys: new Set(["d"]) }));
    expect([...after.order].sort()).to.deep.equal([...before.order].sort());
    expect(after.order[0]).to.equal("d");
  });

  it("skips expanded and failed papers", function () {
    const plan = planHopFill(
      input({
        entries: new Map([
          entry("s", 0, [], true),
          entry("a", 1, ["s"], true),
          entry("b", 1, ["s"]),
        ]),
        failedKeys: new Set(["b"]),
      }),
    );
    expect(plan.order).to.deep.equal([]);
  });

  it("skips papers at the depth", function () {
    const plan = planHopFill(
      input({
        depth: 1,
        entries: new Map([entry("s", 0, [], true), entry("a", 1, ["s"])]),
      }),
    );
    expect(plan.order).to.deep.equal([]);
  });

  it("breaks ties by the parent's reported count, then key", function () {
    const plan = planHopFill(
      input({
        entries: new Map([
          entry("s", 0, [], true),
          entry("t", 0, [], true),
          entry("a", 1, ["s"]),
          entry("b", 1, ["t"]),
          entry("c", 1, ["t"]),
        ]),
        visibleKeys: new Set(["s", "t", "a", "b", "c"]),
        reportedCountOf: (key) => (key === "t" ? 900 : key === "s" ? 10 : null),
      }),
    );
    expect(plan.order).to.deep.equal(["b", "c", "a"]);
  });

  it("holds a hop at its cap and counts what waits", function () {
    const plan = planHopFill(
      input({ expandedByHop: [0, 2, 0], capByHop: [500, 2, 500] }),
    );
    expect(plan.order).to.deep.equal([]);
    expect(plan.waitingByHop).to.deep.equal([0, 4, 0]);
    const raised = planHopFill(
      input({ expandedByHop: [0, 2, 0], capByHop: [500, 502, 500] }),
    );
    expect(raised.order.length).to.equal(4);
    expect(raised.waitingByHop).to.deep.equal([0, 0, 0]);
  });

  it("reports how many remain per hop", function () {
    const plan = planHopFill(input());
    expect(plan.remainingByHop).to.deep.equal([0, 4, 0]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/graphHopFillModel.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the planner**

Create `src/services/graphHopFillModel.ts`:

```ts
/**
 * Which shown paper the runner expands next. Pure. Scope gates: a paper is in
 * the plan only while it is visible. The camera orders: it moves papers up the
 * list and never adds or removes one (spec, "The fill").
 */
import type { HopEntry } from "./graphHopModel";

/** Expansions per hop per direction per session before Fetch more is needed. */
export const HOP_EXPANSION_CAP = 500;

export interface HopFillInput {
  entries: ReadonlyMap<string, HopEntry>;
  visibleKeys: ReadonlySet<string>;
  depth: number;
  selectedKey: string | null;
  hoveredKey: string | null;
  onScreenKeys: ReadonlySet<string>;
  failedKeys: ReadonlySet<string>;
  /** Expansions landed this session, by hop. */
  expandedByHop: readonly number[];
  /** The cap in force, by hop. */
  capByHop: readonly number[];
  /** The paper's reported count in the direction, or null when unknown. */
  reportedCountOf: (key: string) => number | null;
}

export interface HopFillPlan {
  /** Keys to expand, first first. */
  order: string[];
  /** Qualifying papers not yet expanded, by hop, cap or no cap. */
  remainingByHop: number[];
  /** Qualifying papers a hop's cap holds back, by hop. */
  waitingByHop: number[];
}

function rank(key: string, entry: HopEntry, input: HopFillInput): number {
  if (entry.hop === 0) return 0;
  if (key === input.selectedKey) return 1;
  if (key === input.hoveredKey) return 2;
  if (input.onScreenKeys.has(key)) return 3;
  return 4;
}

function parentCount(entry: HopEntry, input: HopFillInput): number {
  let best = -1;
  for (const parent of entry.parents) {
    const count = input.reportedCountOf(parent);
    if (count !== null && count > best) best = count;
  }
  return best;
}

export function planHopFill(input: HopFillInput): HopFillPlan {
  const remainingByHop = Array.from({ length: input.depth + 1 }, () => 0);
  const waitingByHop = Array.from({ length: input.depth + 1 }, () => 0);
  const candidates: Array<{ key: string; entry: HopEntry }> = [];
  for (const [key, entry] of input.entries) {
    if (entry.hop >= input.depth) continue;
    if (!input.visibleKeys.has(key)) continue;
    if (entry.expanded || input.failedKeys.has(key)) continue;
    remainingByHop[entry.hop] += 1;
    const expanded = input.expandedByHop[entry.hop] ?? 0;
    const cap = input.capByHop[entry.hop] ?? HOP_EXPANSION_CAP;
    if (expanded >= cap) {
      waitingByHop[entry.hop] += 1;
      continue;
    }
    candidates.push({ key, entry });
  }
  candidates.sort((left, right) => {
    const byRank =
      rank(left.key, left.entry, input) - rank(right.key, right.entry, input);
    if (byRank) return byRank;
    const byParent =
      parentCount(right.entry, input) - parentCount(left.entry, input);
    if (byParent) return byParent;
    return left.key.localeCompare(right.key);
  });
  return {
    order: candidates.map((candidate) => candidate.key),
    remainingByHop,
    waitingByHop,
  };
}
```

Note on the cap: `expanded >= cap` counts landings, so a plan may name more papers than the cap allows; the runner re-plans after every landing (Task 12), so at most one expansion past the cap can be in flight.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/graphHopFillModel.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/services/graphHopFillModel.ts test/unit/graphHopFillModel.test.ts
git add src/services/graphHopFillModel.ts test/unit/graphHopFillModel.test.ts
git commit -m "Stage 3: the fill planner orders what is shown, under a per-hop cap"
```

---

### Task 4: Graph state version 5

Spec: "State".

**Files:**

- Modify: `src/services/graphViewState.ts`
- Test: `test/unit/graphViewState.test.ts`

**Interfaces:**

- Consumes: `HopDirection`, `MAX_HOP_DEPTH`, `clampHopDepth` from Task 1.
- Produces: `GraphViewHopsSettings`, `GraphViewState.hops`, `GraphViewState.migratedFromBothDirections?`, `defaultHopEnabled()`. Tasks 11 and 13 read them.

- [ ] **Step 1: Update the tests**

In `test/unit/graphViewState.test.ts`:

- Change every fixture object literal with `version: 4` (or `GRAPH_VIEW_STATE_VERSION`) and an `explore:` field so that the ones asserting a _current_ record use `hops: { direction: "cited-by", depth: 1, enabled: [true, true, true, true, true, true, true] }` in place of `explore`. Records deliberately written as version 3 or 4 keep `explore` as migration input.
- Replace the existing `explore` assertions (lines around 170, 215, 224, 278, 297, 424, 441) with the cases below, and add:

```ts
describe("hops in the state", function () {
  const enabledAll = [true, true, true, true, true, true, true];

  it("defaults to Citers, depth 1, every hop enabled", function () {
    expect(emptyGraphViewState().hops).to.deep.equal({
      direction: "cited-by",
      depth: 1,
      enabled: enabledAll,
    });
  });

  it("migrates a version 4 explore, mapping both to Citers and reporting it", function () {
    const migrate = (direction: string) =>
      parseGraphViewState(
        JSON.stringify({
          ...emptyGraphViewState(),
          version: 4,
          explore: { direction, locality: "local" },
        }),
      )!;
    expect(migrate("both").hops).to.deep.equal({
      direction: "cited-by",
      depth: 1,
      enabled: enabledAll,
    });
    expect(migrate("both").migratedFromBothDirections).to.equal(true);
    expect(migrate("cited-by").hops.direction).to.equal("cited-by");
    expect(migrate("cited-by").migratedFromBothDirections).to.equal(false);
    expect(migrate("references").hops.direction).to.equal("references");
    expect(migrate("sideways").hops.direction).to.equal("cited-by");
  });

  it("round-trips a version 5 record and clamps the depth", function () {
    const state = {
      ...emptyGraphViewState(),
      hops: {
        direction: "references" as const,
        depth: 4,
        enabled: [true, true, false, true, true, true, true],
      },
    };
    const parsed = parseGraphViewState(serializeGraphViewState(state))!;
    expect(parsed.hops).to.deep.equal(state.hops);
    expect(parsed.version).to.equal(5);
    expect("migratedFromBothDirections" in parsed).to.equal(false);
    const clamped = parseGraphViewState(
      JSON.stringify({
        ...state,
        hops: { direction: "references", depth: 42, enabled: [] },
      }),
    )!;
    expect(clamped.hops.depth).to.equal(6);
    expect(clamped.hops.enabled).to.deep.equal(enabledAll);
    expect(
      parseGraphViewState(
        serializeGraphViewState({ ...state, migratedFromBothDirections: true }),
      ),
    ).to.not.have.property("migratedFromBothDirections");
  });

  it("still migrates versions 1 to 3 and then applies the same mapping", function () {
    const v3 = parseGraphViewState(
      JSON.stringify({
        version: 3,
        seeds: [],
        explore: { direction: "references", locality: "all" },
        filters: {},
      }),
    )!;
    expect(v3.hops.direction).to.equal("references");
    expect(v3.version).to.equal(5);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/graphViewState.test.ts`
Expected: FAIL to compile (`hops` unknown).

- [ ] **Step 3: Implement version 5**

In `src/services/graphViewState.ts`:

1. Replace the import of `GraphFocusDirection`/`GraphFocusLocality` from `./graphFocusService` with:

```ts
import { externalWorkToFocusNode } from "./graphFocusService";
import {
  clampHopDepth,
  MAX_HOP_DEPTH,
  type HopDirection,
} from "./graphHopModel";
```

2. `export const GRAPH_VIEW_STATE_VERSION = 5;`

3. Replace `GraphViewExploreSettings` with:

```ts
export interface GraphViewHopsSettings {
  direction: HopDirection;
  /** The deepest hop opened, 1..6. */
  depth: number;
  /** By hop, length 7; index 0 is the seeds and is always true. */
  enabled: boolean[];
}

export function defaultHopEnabled(): boolean[] {
  return Array.from({ length: MAX_HOP_DEPTH + 1 }, () => true);
}
```

4. In `GraphViewState` replace `explore: GraphViewExploreSettings;` with `hops: GraphViewHopsSettings;` and add after `ticksNeedDescendants?: boolean;`:

```ts
  /**
   * True when this parse mapped a version 4 `explore.direction` of `both`
   * to Citers. The view shows a one-time status for it. Never serialised.
   */
  migratedFromBothDirections?: boolean;
```

5. Replace `DIRECTIONS`/`LOCALITIES` with `const HOP_DIRECTIONS: readonly HopDirection[] = ["cited-by", "references"];`

6. In `emptyGraphViewState` replace the `explore` line with `hops: { direction: "cited-by", depth: 1, enabled: defaultHopEnabled() },`.

7. In `serializeGraphViewState`: `const { ticksNeedDescendants: _migrated, migratedFromBothDirections: _both, ...persisted } = state;`

8. Add a parser:

```ts
/**
 * Version 5 stores `hops`. Versions 1 to 4 stored `explore.direction` in
 * `both | references | cited-by`; `both` and `cited-by` become Citers, and
 * `both` is reported so the view can say so once. Locality is dropped.
 */
function parseHops(raw: Record<string, unknown>): {
  hops: GraphViewHopsSettings;
  migratedFromBoth: boolean;
} {
  const empty = emptyGraphViewState().hops;
  if (isRecord(raw.hops)) {
    const direction =
      HOP_DIRECTIONS.find((d) => d === raw.hops!.direction) ?? empty.direction;
    const enabledRaw = Array.isArray(raw.hops.enabled) ? raw.hops.enabled : [];
    const enabled = defaultHopEnabled().map((fallback, hop) =>
      hop === 0
        ? true
        : typeof enabledRaw[hop] === "boolean"
          ? enabledRaw[hop]
          : fallback,
    );
    return {
      hops: { direction, depth: clampHopDepth(raw.hops.depth), enabled },
      migratedFromBoth: false,
    };
  }
  const explore = isRecord(raw.explore) ? raw.explore : {};
  const legacy = explore.direction;
  return {
    hops: {
      direction: legacy === "references" ? "references" : "cited-by",
      depth: 1,
      enabled: defaultHopEnabled(),
    },
    migratedFromBoth: legacy === "both",
  };
}
```

9. In `parseGraphViewState`: accept `raw.version` 5 (the constant), 4, 3, 2, 1; delete the `explore`/`direction`/`locality` locals; call `const hops = parseHops(raw);` and in the returned object replace `explore: {...}` with `hops: hops.hops, migratedFromBothDirections: hops.migratedFromBoth,`. Update the comment "Version 4 only added `view`" to add "Version 5 replaced `explore` with `hops`."

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/graphViewState.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/services/graphViewState.ts test/unit/graphViewState.test.ts
git add src/services/graphViewState.ts test/unit/graphViewState.test.ts
git commit -m "Stage 3: graph state version 5 replaces explore with hops"
```

---

### Task 5: The fragment cache, re-keyed per paper and direction

Spec: "The hop model" (the fragment cache survives re-keyed) and "What survives".

**Files:**

- Modify: `src/services/focusGraphCacheService.ts`
- Test: `test/unit/focusGraphCacheService.test.ts` (new)

**Interfaces:**

- Produces: `getHopFragment(libraryID, key, direction)`, `setHopFragment(libraryID, key, direction, fragment)`, `invalidateHopFragment(libraryID, key)`, `clearFocusGraphCachesForLibrary`, `clearFocusGraphCaches`, `focusGraphCacheStats`. Task 11 uses the first three. `src/hooks.ts` keeps calling `clearFocusGraphCaches`.

- [ ] **Step 1: Write the failing test**

Create `test/unit/focusGraphCacheService.test.ts`:

```ts
import { describe, it } from "node:test";
import { expect } from "chai";
import type { ExternalWork } from "../../src/domain/externalWork";
import {
  clearFocusGraphCaches,
  focusGraphCacheStats,
  getHopFragment,
  invalidateHopFragment,
  setHopFragment,
} from "../../src/services/focusGraphCacheService";

const work: ExternalWork = {
  provider: "openalex",
  providerWorkID: "W1",
  doi: null,
  title: "A",
  year: 2020,
  authors: ["X"],
};

describe("the hop fragment cache", function () {
  it("keys a fragment by library, paper and direction", function () {
    clearFocusGraphCaches();
    setHopFragment(1, "p", "cited-by", { expanded: true, works: [work] });
    expect(getHopFragment(1, "p", "cited-by")?.works[0].title).to.equal("A");
    expect(getHopFragment(1, "p", "references")).to.equal(null);
    expect(getHopFragment(2, "p", "cited-by")).to.equal(null);
    expect(focusGraphCacheStats().fragments).to.equal(1);
  });

  it("hands back copies, so a caller cannot edit the cache", function () {
    clearFocusGraphCaches();
    setHopFragment(1, "p", "cited-by", { expanded: true, works: [work] });
    getHopFragment(1, "p", "cited-by")!.works[0].title = "edited";
    expect(getHopFragment(1, "p", "cited-by")!.works[0].title).to.equal("A");
  });

  it("invalidates both directions of one paper", function () {
    clearFocusGraphCaches();
    setHopFragment(1, "p", "cited-by", { expanded: true, works: [] });
    setHopFragment(1, "p", "references", { expanded: false, works: [] });
    setHopFragment(1, "q", "cited-by", { expanded: true, works: [] });
    invalidateHopFragment(1, "p");
    expect(getHopFragment(1, "p", "cited-by")).to.equal(null);
    expect(getHopFragment(1, "p", "references")).to.equal(null);
    expect(getHopFragment(1, "q", "cited-by")).to.not.equal(null);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/focusGraphCacheService.test.ts`
Expected: FAIL, `getHopFragment` is not exported.

- [ ] **Step 3: Rewrite the module**

Replace the whole of `src/services/focusGraphCacheService.ts` with:

```ts
/**
 * A memo of each paper's stored citation list, per direction, as the hop
 * walk reads it. Reading a list means a store lookup and a conversion to
 * external works, so a rebuild after one landing must not re-read every
 * expanded paper. The entry for a paper is dropped when that paper publishes
 * (graphViewService.ts, `applyRelationshipPublication`).
 */
import type { ExternalWork } from "../domain/externalWork";
import type { HopDirection } from "./graphHopModel";

/** Thousands of hop papers at 50 works each is the working set now. */
const MAX_FRAGMENT_ENTRIES = 4096;

export interface HopFragment {
  expanded: boolean;
  works: ExternalWork[];
}

interface CachedFragment extends HopFragment {
  touchedAt: number;
}

const fragments = new Map<string, CachedFragment>();

function fragmentKey(
  libraryID: number,
  key: string,
  direction: HopDirection,
): string {
  return `${libraryID}:${direction}:${key}`;
}

function cloneWork(work: ExternalWork): ExternalWork {
  return {
    ...work,
    authors: [...(work.authors ?? [])],
    // Nested bibliographies are immutable provider data; share the reference.
    references: work.references,
    citationCountsByYear: work.citationCountsByYear?.map((entry) => ({
      ...entry,
    })),
    sourceMetrics: work.sourceMetrics
      ? { ...work.sourceMetrics }
      : work.sourceMetrics,
  };
}

function evictOldest(): void {
  while (fragments.size > MAX_FRAGMENT_ENTRIES) {
    let oldestKey: string | null = null;
    let oldest = Infinity;
    for (const [key, value] of fragments) {
      if (value.touchedAt < oldest) {
        oldest = value.touchedAt;
        oldestKey = key;
      }
    }
    if (oldestKey === null) return;
    fragments.delete(oldestKey);
  }
}

export function getHopFragment(
  libraryID: number,
  key: string,
  direction: HopDirection,
): HopFragment | null {
  const cached = fragments.get(fragmentKey(libraryID, key, direction));
  if (!cached) return null;
  cached.touchedAt = Date.now();
  return { expanded: cached.expanded, works: cached.works.map(cloneWork) };
}

export function setHopFragment(
  libraryID: number,
  key: string,
  direction: HopDirection,
  fragment: HopFragment,
): void {
  fragments.set(fragmentKey(libraryID, key, direction), {
    expanded: fragment.expanded,
    works: fragment.works.map(cloneWork),
    touchedAt: Date.now(),
  });
  evictOldest();
}

/** Both directions: a publication for a paper may have touched either list. */
export function invalidateHopFragment(libraryID: number, key: string): void {
  fragments.delete(fragmentKey(libraryID, key, "cited-by"));
  fragments.delete(fragmentKey(libraryID, key, "references"));
}

export function clearFocusGraphCachesForLibrary(libraryID: number): void {
  const prefix = `${libraryID}:`;
  for (const key of [...fragments.keys()]) {
    if (key.startsWith(prefix)) fragments.delete(key);
  }
}

export function clearFocusGraphCaches(): void {
  fragments.clear();
}

export function focusGraphCacheStats(): { fragments: number } {
  return { fragments: fragments.size };
}
```

Grep for the removed names before moving on: `grep -rn "getFocusRelationshipFragment\|setFocusRelationshipFragment\|invalidateFocusRelationshipFragment\|focusProjectionCacheKey\|getCachedFocusProjection\|setCachedFocusProjection\|clearFocusGraphCachesForLibrary" src test`. The hits are in `graphViewService.ts` (Task 11 replaces them) and possibly `hooks.ts` (keep the two surviving names).

- [ ] **Step 4: Run the test**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/focusGraphCacheService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/services/focusGraphCacheService.ts test/unit/focusGraphCacheService.test.ts
git add src/services/focusGraphCacheService.ts test/unit/focusGraphCacheService.test.ts
git commit -m "Stage 3: the fragment cache memoises one list per paper and direction"
```

---

### Task 6: The Citation hop colouring and the opacity ramp

Spec: "The plot" (first two bullets) and "The gear". Seven hand-wired touch points plus the theme.

**Files:**

- Modify: `src/domain/graphTypes.ts:43-49`, `src/services/graphCategoryAssignment.ts`, `src/services/graphKeyModel.ts:32-37`, `src/services/graphLayoutAvailability.ts:40-60`, `src/services/graphViewControls.ts:405-440` and its return, `src/services/graphRendererScene.ts:140-160`, `src/services/graphViews.ts:377-388, 534-540`, `src/services/dataSourceTooltipService.ts:188-200`, `src/services/graphTheme.ts`
- Test: `test/unit/graphCategoryAssignment.test.ts`, `test/unit/graphLayoutAvailability.test.ts`, `test/unit/graphTheme.test.ts`

**Interfaces:**

- Produces: `"citation-hop"` in `GraphNodeColorMetric`; `AssignCategoriesOptions.hopOf?: (key: string) => number | undefined`; `nodeCategory(node, metric, hopOf?)`; `HOP_OPACITY`, `hopOpacity(hop)` in `graphTheme.ts`; `colourOptionHasData(nodes, colour)` returns true for `"citation-hop"`; the gear's `setColourOptionAvailable(metric, available)`. Tasks 7 and 11 use them.

- [ ] **Step 1: Write the failing tests**

Append to `test/unit/graphCategoryAssignment.test.ts`:

```ts
describe("the Citation hop colouring", function () {
  it("names Seed and Hop n through the hop resolver, not the node", function () {
    const nodes = [node("s"), node("a"), node("b"), node("c", { hop: 5 })];
    const hop = new Map([
      ["s", 0],
      ["a", 1],
      ["b", 1],
    ]);
    const assignment = assignCategories(nodes, "citation-hop", LIGHT, {
      labels: { labelFor: () => null },
      ledger: emptySwatchLedger(),
      hopOf: (key) => hop.get(key),
    });
    expect(assignment.labelFor(nodes[0])).to.equal("Seed");
    expect(assignment.labelFor(nodes[1])).to.equal("Hop 1");
    expect(assignment.keyFor(nodes[1])).to.equal("hop:1");
    // c carries a stamped hop but the resolver says nothing: the resolver
    // wins, because the plot's library nodes never carry the stamp.
    expect(assignment.labelFor(nodes[3])).to.equal("No value");
    expect(assignment.entries.map((entry) => entry.label)).to.deep.equal([
      "Hop 1",
      "Seed",
    ]);
  });

  it("falls back to the stamped hop without a resolver", function () {
    const assignment = assignCategories(
      [node("x", { hop: 2 })],
      "citation-hop",
      LIGHT,
      {
        labels: { labelFor: () => null },
        ledger: emptySwatchLedger(),
      },
    );
    expect(assignment.labelFor(node("x", { hop: 2 }))).to.equal("Hop 2");
  });
});
```

Append to `test/unit/graphLayoutAvailability.test.ts` (open it first to reuse its node helper; if it has none, use the one from the category test):

```ts
describe("colourOptionHasData for citation-hop", function () {
  it("is always true: the gear enables the option by seededness instead", function () {
    expect(colourOptionHasData([], "citation-hop")).to.equal(true);
  });
});
```

Append to `test/unit/graphTheme.test.ts`:

```ts
describe("hopOpacity", function () {
  it("follows the design's ramp and clamps past hop 6", function () {
    expect(HOP_OPACITY).to.deep.equal([1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4]);
    expect(hopOpacity(0)).to.equal(1);
    expect(hopOpacity(3)).to.equal(0.7);
    expect(hopOpacity(9)).to.equal(0.4);
    expect(hopOpacity(undefined)).to.equal(1);
    expect(hopOpacity(null)).to.equal(1);
  });
});
```

(Add `HOP_OPACITY, hopOpacity` to that file's import from `graphTheme`.)

- [ ] **Step 2: Run them to verify they fail**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/graphCategoryAssignment.test.ts test/unit/graphLayoutAvailability.test.ts test/unit/graphTheme.test.ts`
Expected: FAIL (type error on `"citation-hop"`, missing `hopOf`, missing `hopOpacity`).

- [ ] **Step 3: Wire the seven touch points and the ramp**

1. `src/domain/graphTypes.ts`: add `| "citation-hop"` to `GraphNodeColorMetric` after `"retraction"`.

2. `src/services/graphTheme.ts`, after the `GraphTheme` interface:

```ts
/**
 * Node and label alpha by citation hop, seeds first (spec, "The plot"). Under
 * every colouring; the renderer multiplies it with its hover, search and
 * emphasis dimming so those still read.
 */
export const HOP_OPACITY: readonly number[] = [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4];

export function hopOpacity(hop: number | null | undefined): number {
  if (hop === null || hop === undefined || !Number.isFinite(hop)) return 1;
  const index = Math.max(0, Math.min(HOP_OPACITY.length - 1, Math.floor(hop)));
  return HOP_OPACITY[index];
}
```

3. `src/services/graphCategoryAssignment.ts`: add to `AssignCategoriesOptions`:

```ts
  /**
   * The Citation hop colouring's source of truth. The plot's library nodes
   * never carry `hop` (additiveGraphModel keeps the library's own object),
   * so the view hands the hop map in and the node's stamp is only a fallback
   * for fixtures.
   */
  hopOf?: (key: string) => number | undefined;
```

Change `nodeCategory` to `nodeCategory(node, metric, hopOf?: (key: string) => number | undefined)` and add before the `publication-type` branch:

```ts
if (metric === "citation-hop") {
  const hop = hopOf ? hopOf(node.key) : (node.hop ?? undefined);
  if (hop === undefined || hop === null) return null;
  const label = hop === 0 ? "Seed" : `Hop ${hop}`;
  return { key: `hop:${hop}`, label };
}
```

In `assignCategories`, call `nodeCategory(node, metric, options.hopOf)` in the counting loop and in `firstCategory`.

4. `src/services/graphKeyModel.ts`: add `"citation-hop": "Citation hop",` to `CATEGORICAL_COLOR_LABELS`.

5. `src/services/graphLayoutAvailability.ts`: add `case "citation-hop": return true;` before `default`.

6. `src/services/graphViewControls.ts`: add to `categoricalDefinitions` after retraction:

```ts
    {
      value: "citation-hop",
      label: "Citation hop",
      description:
        "Colour nodes by how many citation hops they sit from the nearest seed.",
      available: colourOptionHasData(nodes, "citation-hop"),
    },
```

The options are appended through `appendMetricOption` (`graphViewControls.ts:265`); add `option.dataset.metric = value;` there so every option, categorical or numeric, can be found by its metric. In the object `createAxesAppearance` returns, add:

```ts
    /**
     * Enable or disable one colouring's option. Citation hop means nothing
     * without a seed, so the view flips it with seededness; a disabled
     * option that is selected falls back to Uniform.
     */
    setColourOptionAvailable(metric: GraphNodeColorMetric, available: boolean): void {
      const option = colorMetric.querySelector(
        `option[data-metric="${metric}"]`,
      ) as HTMLOptionElement | null;
      if (!option) return;
      option.disabled = !available;
      if (!available && colorMetric.value === metric) {
        colorMetric.value = "uniform";
        colorMetric.dispatchEvent(new Event("change"));
      }
    },
```

(Read the function's return type annotation and add the member there too.)

7. `src/services/graphRendererScene.ts:146-150`: add `metric === "citation-hop" ||` to the condition that returns `theme.categorical.noValue` for a ghost.

8. `src/services/graphViews.ts`: add `"citation-hop"` to `COLOUR_METRICS` and `"citation-hop": "citation hop",` to `metricWord`'s `special` map.

9. `src/services/dataSourceTooltipService.ts:188`: add `case "citation-hop":` beside `case "open-access":` so the tooltip names the same sources for it.

- [ ] **Step 4: Run the three test files**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/graphCategoryAssignment.test.ts test/unit/graphLayoutAvailability.test.ts test/unit/graphTheme.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/domain/graphTypes.ts src/services/graphCategoryAssignment.ts src/services/graphKeyModel.ts src/services/graphLayoutAvailability.ts src/services/graphViewControls.ts src/services/graphRendererScene.ts src/services/graphViews.ts src/services/dataSourceTooltipService.ts src/services/graphTheme.ts test/unit/graphCategoryAssignment.test.ts test/unit/graphLayoutAvailability.test.ts test/unit/graphTheme.test.ts
git add -A src/domain src/services test/unit
git commit -m "Stage 3: Citation hop is a categorical colouring, wired at its seven touch points"
```

---

### Task 7: The renderer takes hops by map and fades by hop

Spec: "The plot" (`hopByKey`, opacity on fill, label and edge).

**Files:**

- Modify: `src/services/citationGraphRenderer.ts` (fields near line 275, `categories()` at 908, `drawNode` at 946, the edge and node loops at 1650-1710, the setters at 1755, `syncModel` pruning at 1789), `src/services/graphRendererScene.ts` (the `RendererSceneContext` interface near line 60 and the label alpha at 715)
- Test: `test/unit/citationGraphRendererHops.test.ts` (new; copy the setup of `test/unit/citationGraphRendererCategoryLedger.test.ts`, which builds a renderer on the doubles in `test/unit/graphRendererDoubles.ts`)

**Interfaces:**

- Produces: `renderer.setHops(hops: ReadonlyMap<string, number>, draw = true)`, `renderer.hopAlphaFor(key)` (public, read by the scene). Task 11 calls `setHops`.

- [ ] **Step 1: Write the failing test**

Create `test/unit/citationGraphRendererHops.test.ts`, mirroring the category ledger test's construction of a renderer (same imports, same `createRenderer`-style helper). Cases:

```ts
it("feeds the Citation hop assignment from setHops, not from the node", function () {
  const renderer = makeRenderer([node("s"), node("a")], {
    nodeColorMetric: "citation-hop",
  });
  renderer.setHops(
    new Map([
      ["s", 0],
      ["a", 2],
    ]),
    false,
  );
  const assignment = renderer.getCategoryAssignment();
  expect(assignment.labelFor(node("a"))).to.equal("Hop 2");
  expect(assignment.labelFor(node("s"))).to.equal("Seed");
});

it("fades a node's alpha by hop and leaves unmapped nodes whole", function () {
  const renderer = makeRenderer([node("s"), node("a"), node("lib")], {});
  renderer.setHops(
    new Map([
      ["s", 0],
      ["a", 3],
    ]),
    false,
  );
  expect(renderer.hopAlphaFor("s")).to.equal(1);
  expect(renderer.hopAlphaFor("a")).to.equal(0.7);
  expect(renderer.hopAlphaFor("lib")).to.equal(1);
});

it("drops hops for nodes that left the model on syncModel", function () {
  const model = modelOf([node("s"), node("a")]);
  const renderer = makeRenderer(model.nodes, {});
  renderer.setHops(
    new Map([
      ["s", 0],
      ["a", 1],
    ]),
    false,
  );
  model.nodes.splice(1, 1);
  renderer.syncModel({ draw: false });
  expect(renderer.hopAlphaFor("a")).to.equal(1);
});
```

Adapt `makeRenderer`/`modelOf` to whatever the ledger test names its helpers; the assertions are what matter.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/citationGraphRendererHops.test.ts`
Expected: FAIL, `setHops is not a function`.

- [ ] **Step 3: Implement**

In `src/services/citationGraphRenderer.ts`:

1. Import `hopOpacity` from `./graphTheme`.
2. Next to `private inLibraryReachedKeys = new Set<string>();` (line 275) add:

```ts
  /** Each reached paper's hop; absent means a library paper no hop reached. */
  private hops = new Map<string, number>();
  /** Bumped by `setHops`, so the category assignment rebuilds for the new map. */
  private hopsRevision = 0;
```

3. In `categories()` (line 908) include `${this.hopsRevision}` in `key`, and pass `hopOf: (key) => this.hops.get(key)` in the options object handed to `assignCategories`.

4. Add the public methods next to `setInLibraryReachedKeys`:

```ts
  /**
   * The hop of every paper the walk reached. A map, not a node field: the
   * model's library nodes are the library's own objects, which no walk
   * stamps. Re-sent after every rebuild of the walk and every
   * `replaceLibraryGraph`.
   */
  public setHops(hops: ReadonlyMap<string, number>, draw = true): void {
    this.hops = new Map(hops);
    this.hopsRevision += 1;
    this.categoryAssignment = null;
    if (draw) this.draw();
  }

  /** The hop opacity ramp for a node; 1 for a node no hop reached. */
  public hopAlphaFor(key: string): number {
    return hopOpacity(this.hops.get(key));
  }
```

5. In `syncModel`, where `inLibraryReachedKeys` is pruned to `validKeys` (line 1789), also prune: `this.hops = new Map([...this.hops].filter(([key]) => validKeys.has(key)));`.

6. In the draw loop (line 1680-1705): the edge call's emphasis argument becomes

```ts
          Math.max(
            this.emphasisAlphaFor(edge.source),
            this.emphasisAlphaFor(edge.target),
          ) * this.hopAlphaFor(edge.source),
```

(the citer's opacity: under the citer → cited convention the source is the citer), and the node call's last argument becomes `this.emphasisAlphaFor(node.key) * this.hopAlphaFor(node.key)`.

In `src/services/graphRendererScene.ts`:

7. Add `hopAlphaFor(key: string): number;` and `emphasisAlphaFor(key: string): number;` to `RendererSceneContext` (check whether `emphasisAlphaFor` is already listed; the renderer's is `private`, so make it `public` in the renderer if the interface needs it — it does).

8. At line 715 replace `context.globalAlpha = ghosted ? 0.58 : 1;` with:

```ts
// The label fades with its disc: hop opacity and the Key's emphasis both
// feed it, so a dimmed hop-6 paper does not keep a full-strength name.
context.globalAlpha =
  (ghosted ? 0.58 : 1) *
  renderer.hopAlphaFor(node.key) *
  renderer.emphasisAlphaFor(node.key);
```

- [ ] **Step 4: Run the renderer tests**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test "test/unit/citationGraphRenderer*.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/services/citationGraphRenderer.ts src/services/graphRendererScene.ts test/unit/citationGraphRendererHops.test.ts
git add src/services/citationGraphRenderer.ts src/services/graphRendererScene.ts test/unit/citationGraphRendererHops.test.ts
git commit -m "Stage 3: the renderer takes hops by map and fades fill, label and edge by hop"
```

---

### Task 8: The rail's Citation hops block

Spec: "The rail".

**Files:**

- Modify: `src/services/graphScopeRailModel.ts`, `src/services/graphKeyRail.ts` (the `ScopeRailHandlers` interface at 138, `renderScope` at 545), `addon/content/graph.css` (after `.cm-scope-hidden`, line 1611)
- Test: `test/unit/graphScopeRailModel.test.ts`

**Interfaces:**

- Consumes: `HopDirection`, `MAX_HOP_DEPTH` (Task 1); `GraphScopeResult.shownByHop/availableByHop` (Task 2).
- Produces: `ScopeHopsInput`, `ScopeHopRow`, `ScopeHopsBlock`, `ScopeRailModel.hops`, `ScopeRailInput.hops`, and the handlers `setHopDirection(direction)`, `fetchHop(hop)`, `toggleHop(hop, enabled)`, `fillControl(action)`. Task 12 implements the handlers.

- [ ] **Step 1: Write the failing tests**

Append to `test/unit/graphScopeRailModel.test.ts` (its `emptyScope()` now returns `shownByHop`/`availableByHop` from Task 2; build inputs with the helper below):

```ts
import type { ScopeHopsInput } from "../../src/services/graphScopeRailModel";

function hopsInput(overrides: Partial<ScopeHopsInput> = {}): ScopeHopsInput {
  return {
    direction: "cited-by",
    depth: 2,
    enabled: [true, true, true, true, true, true, true],
    shownByHop: [1, 4, 9],
    availableByHop: [1, 5, 12],
    reportedByHop: [null, 1200, null],
    colours: null,
    fill: null,
    ...overrides,
  };
}

function railWithHops(hops: ScopeHopsInput | null) {
  return buildScopeRailModel({
    collections: TREE,
    ticks: allCollectionsTicked(),
    includeUnfiled: true,
    includeExternal: true,
    seeds: hops ? [{ key: "s", label: "Seed (2020)", color: "#000" }] : [],
    scope: emptyScope(),
    regions: [],
    regionColors: new Map(),
    hops,
  });
}

describe("the Citation hops block", function () {
  it("is absent on a seedless graph", function () {
    expect(railWithHops(null).hops).to.equal(null);
  });

  it("lists Seeds and Hop 1 to Hop 6 with counts, not fetched, and the button", function () {
    const block = railWithHops(hopsInput())!.hops!;
    expect(block.direction).to.equal("cited-by");
    expect(block.rows.map((row) => row.label)).to.deep.equal([
      "Seeds",
      "Hop 1",
      "Hop 2",
      "Hop 3",
      "Hop 4",
      "Hop 5",
      "Hop 6",
    ]);
    expect(block.rows[0]).to.include({
      count: "1",
      checkbox: false,
      dimmed: false,
      fetchButton: false,
    });
    expect(block.rows[1]).to.include({
      count: "4/5",
      reported: "of 1,200",
      checkbox: true,
    });
    expect(block.rows[2]).to.include({ count: "9/12", reported: null });
    expect(block.rows[3]).to.include({
      count: "not fetched",
      fetchButton: true,
      dimmed: true,
      enabled: true,
    });
    expect(block.rows[4]).to.include({
      count: "not fetched",
      fetchButton: false,
      dimmed: true,
    });
  });

  it("dims an unticked hop and carries no button at depth 6", function () {
    const block = railWithHops(
      hopsInput({
        depth: 6,
        enabled: [true, true, false, true, true, true, true],
        shownByHop: [1, 1, 0, 0, 0, 0, 0],
        availableByHop: [1, 1, 1, 0, 0, 0, 0],
        reportedByHop: [null, null, null, null, null, null, null],
      }),
    )!.hops!;
    expect(block.rows[2]).to.include({
      enabled: false,
      dimmed: true,
      count: "0/1",
    });
    expect(block.rows.some((row) => row.fetchButton)).to.equal(false);
  });

  it("takes the hop's category colour only under the Citation hop colouring", function () {
    const neutral = railWithHops(hopsInput())!.hops!;
    expect(neutral.rows[1].swatch).to.equal(null);
    const coloured = railWithHops(
      hopsInput({ colours: ["#111", "#222", "#333"] }),
    )!.hops!;
    expect(coloured.rows[1].swatch).to.equal("#222");
    expect(coloured.rows[5].swatch).to.equal(null);
  });

  it("prints the progress line in its three states under the deepest open hop", function () {
    const running = railWithHops(
      hopsInput({ fill: { remaining: 7, waiting: 0, paused: false } }),
    )!.hops!;
    expect(running.progress).to.deep.equal({
      afterHop: 2,
      text: "expanding · 7 left",
      action: "stop",
      actionLabel: "Stop",
    });
    const paused = railWithHops(
      hopsInput({ fill: { remaining: 7, waiting: 0, paused: true } }),
    )!.hops!;
    expect(paused.progress).to.deep.include({
      action: "resume",
      actionLabel: "Resume",
    });
    const capped = railWithHops(
      hopsInput({ fill: { remaining: 0, waiting: 1800, paused: false } }),
    )!.hops!;
    expect(capped.progress).to.deep.equal({
      afterHop: 2,
      text: "500 expanded · 1,800 waiting",
      action: "more",
      actionLabel: "Fetch more",
    });
    expect(railWithHops(hopsInput({ fill: null }))!.hops!.progress).to.equal(
      null,
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/graphScopeRailModel.test.ts`
Expected: FAIL to compile.

- [ ] **Step 3: Extend the rail model**

In `src/services/graphScopeRailModel.ts` add the imports `import { HOP_EXPANSION_CAP } from "./graphHopFillModel";` and `import { MAX_HOP_DEPTH, type HopDirection } from "./graphHopModel";`, then add before `ScopeRailModel`:

```ts
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
```

Add `hops: ScopeHopsBlock | null;` to `ScopeRailModel` and `hops: ScopeHopsInput | null;` to `ScopeRailInput`, and:

```ts
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
```

In `buildScopeRailModel`'s return add `hops: input.hops ? buildScopeHopsBlock(input.hops) : null,`.

Note: the "500 expanded" text prints the base cap by design (spec copy); after Fetch more the runner's `fill.remaining` is non-zero again, so the line reads `expanding · n left` until the raised cap is hit, when it prints `500 expanded` once more. Accepted: the number is the spec's copy, not the running total.

- [ ] **Step 4: Run the model test**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/graphScopeRailModel.test.ts`
Expected: PASS.

- [ ] **Step 5: Draw the block in the rail**

In `src/services/graphKeyRail.ts`:

1. Extend `ScopeRailHandlers`:

```ts
  /** The Citers | References switch. */
  setHopDirection(direction: HopDirection): void;
  /** Fetch hop N: opens the hop and starts the fill. */
  fetchHop(hop: number): void;
  /** A hop row's checkbox. Inert past the depth: the rail never calls it there. */
  toggleHop(hop: number, enabled: boolean): void;
  /** Stop, Resume or Fetch more on the progress line. */
  fillControl(action: "stop" | "resume" | "more"): void;
```

with `import type { HopDirection } from "./graphHopModel";` and `import type { ScopeHopsBlock, ScopeHopRow } from "./graphScopeRailModel";`.

2. Add a builder inside `createKeyRail`, after `scopeRowElement`:

```ts
function hopsBlockElement(block: ScopeHopsBlock): HTMLElement {
  const host = element(document, "div", "cm-scope-hops");
  host.appendChild(
    text(document, "h3", "Citation hops", "cm-scope-hops-heading"),
  );
  const segmented = element(document, "div", "cm-segmented");
  segmented.setAttribute("role", "radiogroup");
  segmented.setAttribute("aria-label", "Hop direction");
  for (const [value, label] of [
    ["cited-by", "Citers"],
    ["references", "References"],
  ] as const) {
    const cell = element(document, "button", "cm-segmented-cell");
    cell.type = "button";
    cell.textContent = label;
    cell.setAttribute("role", "radio");
    const active = block.direction === value;
    cell.setAttribute("aria-checked", String(active));
    if (active) cell.classList.add("cm-segmented-cell-active");
    cell.addEventListener("click", () => {
      if (!active) options.onScope.setHopDirection(value);
    });
    segmented.appendChild(cell);
  }
  host.appendChild(segmented);
  const rows = element(document, "div", "cm-scope-hop-rows");
  for (const row of block.rows) {
    rows.appendChild(hopRowElement(row));
    if (block.progress && block.progress.afterHop === row.hop) {
      rows.appendChild(progressLine(block.progress));
    }
  }
  host.appendChild(rows);
  return host;
}

function hopRowElement(row: ScopeHopRow): HTMLElement {
  const wrapper = element(document, "div", "cm-scope-row cm-scope-hop-row");
  wrapper.dataset.hop = String(row.hop);
  if (row.dimmed) wrapper.classList.add("cm-scope-hop-row-dimmed");
  if (row.checkbox) {
    const boxLabel = element(document, "label", "cm-scope-check-label");
    const box = element(
      document,
      "input",
      "cm-scope-check",
    ) as HTMLInputElement;
    box.type = "checkbox";
    box.checked = row.enabled;
    // Past the depth the tick is inert: only Fetch hop N opens a hop.
    box.disabled = !row.opened;
    box.title = row.opened
      ? `Show ${row.label} on the plot`
      : `${row.label} is not fetched yet`;
    boxLabel.title = box.title;
    box.addEventListener("change", () =>
      options.onScope.toggleHop(row.hop, box.checked),
    );
    const square = element(document, "span", "cm-scope-square");
    square.setAttribute("aria-hidden", "true");
    square.classList.add(
      row.enabled ? "cm-scope-square-on" : "cm-scope-square-off",
    );
    boxLabel.append(box, square);
    wrapper.appendChild(boxLabel);
  } else {
    wrapper.appendChild(element(document, "span", "cm-scope-hop-spacer"));
  }
  const swatch = element(document, "span", "cm-scope-hop-swatch");
  swatch.setAttribute("aria-hidden", "true");
  if (row.swatch) swatch.style.setProperty("--cm-hop-swatch", row.swatch);
  else swatch.classList.add("cm-scope-hop-swatch-neutral");
  wrapper.appendChild(swatch);
  const body = element(document, "div", "cm-scope-row-body cm-scope-hop-body");
  body.appendChild(text(document, "span", row.label, "cm-scope-row-label"));
  if (row.fetchButton) {
    const fetch = element(document, "button", "cm-scope-hop-fetch");
    fetch.type = "button";
    fetch.textContent = `Fetch ${row.label.toLowerCase()}`;
    fetch.addEventListener("click", () => options.onScope.fetchHop(row.hop));
    body.appendChild(fetch);
  } else {
    const count = text(document, "span", row.count, "cm-scope-row-count");
    body.appendChild(count);
    if (row.reported) {
      body.appendChild(
        text(document, "span", row.reported, "cm-scope-hop-reported"),
      );
    }
  }
  wrapper.appendChild(body);
  return wrapper;
}

function progressLine(progress: ScopeHopsProgress): HTMLElement {
  const line = element(document, "p", "cm-scope-hop-progress");
  line.append(text(document, "span", progress.text));
  const control = element(document, "button", "cm-scope-show-all");
  control.type = "button";
  control.textContent = progress.actionLabel;
  control.addEventListener("click", () =>
    options.onScope.fillControl(progress.action),
  );
  line.append(text(document, "span", " · "), control);
  return line;
}
```

(Import `ScopeHopsProgress` too.) `Fetch hop 3` reads from `row.label.toLowerCase()` = `hop 3`, which yields the spec's **Fetch hop N**.

3. In `renderScope`, after `scopeHost.appendChild(rows);` for the collection rows, add `if (model.hops) scopeHost.appendChild(hopsBlockElement(model.hops));`.

4. Append to `addon/content/graph.css` after `.cm-scope-hidden`:

```css
.cm-scope-hops {
  margin-top: 10px;
}
.cm-scope-hops-heading {
  margin: 0 0 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--cm-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
/* The design's segmented control: 11px, radius 5, active cell on the hairline fill. */
.cm-segmented {
  display: inline-flex;
  padding: 2px;
  border: 1px solid var(--cm-border);
  border-radius: 5px;
  font-size: 11px;
}
.meristema-root button.cm-segmented-cell {
  padding: 2px 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--cm-muted);
  cursor: pointer;
}
.meristema-root button.cm-segmented-cell-active {
  background: var(--cm-border-soft);
  color: var(--cm-ink);
}
.cm-scope-hop-rows {
  display: grid;
  margin-top: 6px;
}
.cm-scope-hop-row-dimmed {
  opacity: 0.45;
}
.cm-scope-hop-spacer {
  width: 19px;
  flex: 0 0 auto;
}
.cm-scope-hop-swatch {
  flex: 0 0 auto;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: var(--cm-hop-swatch);
}
.cm-scope-hop-swatch-neutral {
  background: var(--cm-muted);
  opacity: 0.5;
}
.cm-scope-hop-body {
  cursor: default;
}
.cm-scope-hop-reported {
  flex: 0 0 auto;
  margin-inline-start: 4px;
  color: var(--cm-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.meristema-root button.cm-scope-hop-fetch {
  padding: 1px 7px;
  border: 1px solid var(--cm-border);
  border-radius: 4px;
  background: transparent;
  color: var(--cm-ink);
  font-size: 11px;
  cursor: pointer;
}
.meristema-root button.cm-scope-hop-fetch:hover {
  background: var(--cm-border-soft);
}
.cm-scope-hop-progress {
  margin: 2px 0 4px 32px;
  color: var(--cm-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
```

The tokens are the sheet's own: `--cm-border`, `--cm-border-soft`, `--cm-muted`, `--cm-ink`, `--cm-accent` all exist in `addon/content/graph.css` today.

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc --noEmit -p test` (the rail files compile on their own; `graphViewService.ts` errors on `hops` are expected until Task 11 and are listed for reference only).
Expected: errors only in `graphViewService.ts` about `ScopeRailInput.hops` and `ScopeRailHandlers`.

```bash
npx prettier --write src/services/graphScopeRailModel.ts src/services/graphKeyRail.ts addon/content/graph.css test/unit/graphScopeRailModel.test.ts
git add src/services/graphScopeRailModel.ts src/services/graphKeyRail.ts addon/content/graph.css test/unit/graphScopeRailModel.test.ts
git commit -m "Stage 3: the rail's Citation hops block, switch, rows, button and progress line"
```

---

### Task 9: Views carry `explore`

Spec: "Views (D4)".

**Files:**

- Modify: `src/services/graphViews.ts` (types at 39-51, Cornerstones at 85-95, `GraphViewLiveInput` at 284, `graphViewIsEdited` at 343, `tutorialChips` at 394, `tutorialFootnote` at 454, the wire types and `encode`/`decode` at 493-560, `captureGraphView` at 672-699), `src/services/graphViewsMenu.ts:368-372, 516-531`
- Test: `test/unit/graphViews.test.ts`

**Interfaces:**

- Consumes: `HopDirection`, `MAX_HOP_DEPTH`, `clampHopDepth` (Task 1).
- Produces: `GraphViewExplore`, `GraphViewDefinition.explore: GraphViewExplore | null`, `GraphViewLiveInput.hops`, `CaptureInput.hops`, `SavePanelOpenOptions.captures.explore: string | null`. Task 13 wires them.

- [ ] **Step 1: Update and add tests**

In `test/unit/graphViews.test.ts`:

- The "are five" case asserts `view.explore` is null for every view; change it to `expect(view.explore, view.id).to.equal(view.id === "cornerstones" ? … : null)` — replace with a dedicated assertion: every view except Cornerstones has `explore: null`, Cornerstones has `{ direction: "references", hops: 2 }` and `availability: "ready"`, and `graphViewAvailabilityLine(cornerstones)` is `null`. Delete the existing "Arrives with citation hops" assertion.
- Every `planGraphView(...)`/`graphViewIsEdited(...)` live input in the file gains `hops: liveHops` where `const liveHops = { direction: "cited-by" as const, depth: 1, enabled: [true, true, true, true, true, true, true] };`.
- Add:

```ts
describe("explore on a view", function () {
  const cornerstones = SHIPPED_GRAPH_VIEWS.find(
    (v) => v.id === "cornerstones",
  )!;
  const under = {
    direction: "references" as const,
    depth: 2,
    enabled: [true, true, true, true, true, true, true],
  };

  it("reads edited when direction, depth or a hop within the depth differs", function () {
    const live = {
      nodes,
      layout: { ...liveLayout, nodeColorMetric: "citations" as const },
      regions: [],
      filters: defaultPaperListFilterState(),
      folders,
    };
    expect(graphViewIsEdited(cornerstones, { ...live, hops: under })).to.equal(
      false,
    );
    expect(
      graphViewIsEdited(cornerstones, {
        ...live,
        hops: { ...under, direction: "cited-by" },
      }),
    ).to.equal(true);
    expect(
      graphViewIsEdited(cornerstones, {
        ...live,
        hops: { ...under, depth: 3 },
      }),
    ).to.equal(true);
    expect(
      graphViewIsEdited(cornerstones, {
        ...live,
        hops: {
          ...under,
          enabled: [true, true, false, true, true, true, true],
        },
      }),
    ).to.equal(true);
    // A hop past the view's depth is not the view's claim.
    expect(
      graphViewIsEdited(cornerstones, {
        ...live,
        hops: {
          ...under,
          enabled: [true, true, true, false, true, true, true],
        },
      }),
    ).to.equal(false);
    // A view without explore ignores the hops entirely.
    expect(
      graphViewIsEdited(overview, {
        ...live,
        layout: liveLayout,
        hops: { ...under, depth: 5 },
      }),
    ).to.equal(false);
  });

  it("captures the live direction and depth, never the toggles", function () {
    const view = captureGraphView({
      name: "Mine",
      paragraph: "",
      layout: liveLayout,
      regions: [],
      filters: defaultPaperListFilterState(),
      folders,
      hops: {
        ...under,
        enabled: [true, false, false, false, false, false, false],
      },
    });
    expect(view.explore).to.deep.equal({ direction: "references", hops: 2 });
  });

  it("round-trips explore on the wire and clamps a bad depth", function () {
    const view = captureGraphView({
      name: "Mine",
      paragraph: "",
      layout: liveLayout,
      regions: [],
      filters: defaultPaperListFilterState(),
      folders,
      hops: under,
    });
    const decoded = decodeGraphView(encodeGraphView(view));
    expect(decoded.ok && decoded.view.explore).to.deep.equal({
      direction: "references",
      hops: 2,
    });
    const raw = JSON.parse(encodeGraphView(view));
    raw.explore = { direction: "references", hops: 40 };
    const clamped = decodeGraphView(JSON.stringify(raw));
    expect(clamped.ok && clamped.view.explore?.hops).to.equal(6);
    raw.explore = { direction: "both", hops: 2 };
    const bad = decodeGraphView(JSON.stringify(raw));
    expect(bad).to.deep.equal({ ok: false, field: "explore.direction" });
    delete raw.explore;
    const absent = decodeGraphView(JSON.stringify(raw));
    expect(absent.ok && absent.view.explore).to.equal(null);
  });

  it("decodes citation-hop as a colouring", function () {
    const raw = JSON.parse(encodeGraphView(overview));
    raw.appearance.nodeColorMetric = "citation-hop";
    const decoded = decodeGraphView(JSON.stringify(raw));
    expect(decoded.ok && decoded.view.appearance.nodeColorMetric).to.equal(
      "citation-hop",
    );
  });

  it("adds the hops chip and the traffic footnote for a view with explore", function () {
    const plan = planGraphView(cornerstones, {
      nodes,
      layout: liveLayout,
      filters: defaultPaperListFilterState(),
      folders,
      hops: under,
    });
    expect(tutorialChips(cornerstones, plan, 8)).to.include(
      "hops 2 · references",
    );
    expect(tutorialFootnote(plan, cornerstones)).to.include(
      "Opening hops fetches citations from the providers.",
    );
    expect(
      tutorialChips(
        overview,
        planGraphView(overview, {
          nodes,
          layout: liveLayout,
          filters: defaultPaperListFilterState(),
          folders,
          hops: under,
        }),
        8,
      ),
    ).to.not.include("hops 2 · references");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/graphViews.test.ts`
Expected: FAIL to compile.

- [ ] **Step 3: Implement**

In `src/services/graphViews.ts`:

1. Import `import { clampHopDepth, type HopDirection } from "./graphHopModel";`.
2. Replace `explore: null;` in `GraphViewDefinition` with `explore: GraphViewExplore | null;` and add above the interface:

```ts
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
```

3. Cornerstones: `summary: "Seeds, 2 hops of references, colour citations. What the field rests on."`, `paragraph: "Starts from your seeds and follows their references two steps out, so what remains is the work the field rests on. Colour is citations. Seeds and collections are untouched."`, `explore: { direction: "references", hops: 2 }`, `availability: "ready"`. Leave `requires: "seed"`. With no view left on it, delete `"citation-hops"` from the `GraphViewNeeds` union (`graphViews.ts:28-29`) and its `"Arrives with citation hops"` entry from `NEEDS_LINE`; grep `test/` for the string and drop the assertion that expected it.
4. `GraphViewLiveInput` gains `hops: GraphViewLiveHops;`.
5. In `graphViewIsEdited`, before `return false;`:

```ts
if (view.explore !== null) {
  if (live.hops.direction !== view.explore.direction) return true;
  if (live.hops.depth !== view.explore.hops) return true;
  for (let hop = 1; hop <= view.explore.hops; hop += 1) {
    if (live.hops.enabled[hop] === false) return true;
  }
}
```

6. `tutorialChips`: after the `labels` chip push `if (view.explore) chips.push(\`hops ${view.explore.hops} · ${view.explore.direction === "references" ? "references" : "citers"}\`);`(the array is a`const chips = [...]`; make it `const chips: string[] = [...]` and push before the swatch-count logic that follows).
7. `tutorialFootnote(application, view?: GraphViewDefinition)`: after the regions block add `if (view?.explore) parts.push("Opening hops fetches citations from the providers.");`. Update the one call site in `graphViewService.ts:2082` to pass `chosen` (Task 13 touches that line anyway; do it here so the file compiles).
8. Wire: `WireView.explore: GraphViewExplore | null;`; `encodeGraphView` sets `explore: view.explore ? { ...view.explore } : null`. In `decodeGraphView`, where the other fields are validated, add:

```ts
let explore: GraphViewExplore | null = null;
if (raw.explore !== undefined && raw.explore !== null) {
  if (!isRecord(raw.explore)) return { ok: false, field: "explore" };
  const direction = raw.explore.direction;
  if (direction !== "cited-by" && direction !== "references") {
    return { ok: false, field: "explore.direction" };
  }
  explore = { direction, hops: clampHopDepth(raw.explore.hops) };
}
```

and set `explore` in the returned view (both the decoded and the `captureGraphView` paths).

9. `CaptureInput` gains `hops: GraphViewLiveHops;`; `captureGraphView` sets `explore: { direction: input.hops.direction, hops: input.hops.depth }`.

10. `summaryFor(layout)` is unchanged; a user view's summary stays about the layout.

In `src/services/graphViewsMenu.ts`: `captures: { regions: number; filters: boolean; explore: string | null }`, and replace the "Explore (hops, floor, shared citers) — not yet available" row with `captureRow(o.captures.explore ? \`Explore: ${o.captures.explore}\` : "Explore: none", Boolean(o.captures.explore))`.

- [ ] **Step 4: Run the test**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/graphViews.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/services/graphViews.ts src/services/graphViewsMenu.ts test/unit/graphViews.test.ts
git add src/services/graphViews.ts src/services/graphViewsMenu.ts test/unit/graphViews.test.ts
git commit -m "Stage 3: views carry explore; Cornerstones lights up on two hops of references"
```

---

### Task 10: Runner-originated publications are marked and coalesced; one provider per hop paper

Spec: "The fill" (publications during a fill) and the review decision on provider traffic.

**Files:**

- Modify: `src/services/relationshipEvents.ts:10-19, 88-100`, `src/services/externalDiscoveryService.ts:405-425, 1450-1470` (thread the mark), `src/services/relationshipRefreshPolicy.ts:55-73`
- Test: `test/unit/relationshipRefreshPolicy.test.ts` (new), `test/unit/relationshipEvents.test.ts` (new)

**Interfaces:**

- Produces: `RelationshipPublicationEvent.source?: "hop-fill"`; `ExternalRelationshipRefreshOptions.publicationSource?: "hop-fill"`; `HOP_FILL_REFRESH_COALESCE_MS = 10_000`; `relationshipProviderPolicyForSize` honours explicit overrides. Task 12 passes `publicationSource: "hop-fill"`, `providerStrategy: "native-first"`, `providerLimit: 1`.

- [ ] **Step 1: Write the failing tests**

`test/unit/relationshipRefreshPolicy.test.ts`:

```ts
import { describe, it } from "node:test";
import { expect } from "chai";
import { relationshipProviderPolicyForSize } from "../../src/services/relationshipRefreshPolicy";

describe("relationshipProviderPolicyForSize", function () {
  it("stays aggregate and unlimited by default", function () {
    expect(relationshipProviderPolicyForSize("automatic", 40)).to.deep.equal({
      providerStrategy: "aggregate",
      providerLimit: Number.POSITIVE_INFINITY,
    });
  });

  it("honours an explicit strategy and limit: a hop paper asks one provider", function () {
    expect(
      relationshipProviderPolicyForSize("automatic", 40, {
        providerStrategy: "native-first",
        providerLimit: 1,
      }),
    ).to.deep.equal({ providerStrategy: "native-first", providerLimit: 1 });
  });
});
```

`test/unit/relationshipEvents.test.ts` — this module imports `Zotero` globals only inside error paths and `publishCitationUpdateCompleted` from `citationUpdateEvents`; mock the latter with `node:test`'s `mock.module`, in the shape `test/unit/citationGraphRendererRegionCache.test.ts` uses (the `.ts` suffix on the specifier, `exports` spreading the real module, the module under test imported dynamically after the mock is installed):

```ts
import { describe, it, mock, beforeEach } from "node:test";
import { expect } from "chai";

const completed: unknown[] = [];
const real = await import("../../src/services/citationUpdateEvents");
mock.module("../../src/services/citationUpdateEvents.ts", {
  exports: {
    ...real,
    publishCitationUpdateCompleted: (event: unknown) => completed.push(event),
  },
});
const {
  publishRelationshipPublication,
  HOP_FILL_REFRESH_COALESCE_MS,
  flushCoalescedPresentationRefresh,
} = await import("../../src/services/relationshipEvents");

function event(source?: "hop-fill") {
  return {
    libraryID: 1,
    subjectItemKey: "K",
    direction: "cited-by" as const,
    phase: "membership-published" as const,
    reportedCount: null,
    reportedCountProvider: null,
    identifiedCount: 3,
    ...(source ? { source } : {}),
  };
}

describe("presentation refreshes during a hop fill", function () {
  beforeEach(() => {
    completed.length = 0;
    flushCoalescedPresentationRefresh();
    completed.length = 0;
  });

  it("refreshes columns at once for an ordinary publication", function () {
    publishRelationshipPublication(event());
    expect(completed.length).to.equal(1);
  });

  it("holds runner-originated refreshes to one per window", function () {
    mock.timers.enable({ apis: ["setTimeout"] });
    publishRelationshipPublication(event("hop-fill"));
    publishRelationshipPublication(event("hop-fill"));
    publishRelationshipPublication(event("hop-fill"));
    expect(completed.length).to.equal(0);
    mock.timers.tick(HOP_FILL_REFRESH_COALESCE_MS);
    expect(completed.length).to.equal(1);
    mock.timers.reset();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/relationshipRefreshPolicy.test.ts test/unit/relationshipEvents.test.ts`
Expected: FAIL (policy ignores overrides; `HOP_FILL_REFRESH_COALESCE_MS` missing).

- [ ] **Step 3: Implement**

1. `relationshipRefreshPolicy.ts`: rewrite `relationshipProviderPolicyForSize` to

```ts
export function relationshipProviderPolicyForSize(
  mode: RelationshipRefreshMode,
  reportedCount: number | null | undefined,
  overrides: {
    providerStrategy?: RelationshipProviderStrategy;
    providerLimit?: number;
  } = {},
): Pick<RelationshipRefreshPolicy, "providerStrategy" | "providerLimit"> {
  void mode;
  void reportedCount;
  // Size never reduces the provider set (B9). A caller may still narrow it
  // on purpose: a hop expansion asks the paper's own provider and no other.
  return {
    providerStrategy: overrides.providerStrategy ?? "aggregate",
    providerLimit: overrides.providerLimit ?? Number.POSITIVE_INFINITY,
  };
}
```

This reverses a tested rule on purpose. `test/unit/architecture.test.ts:822-833` ("does not reduce the enabled provider set for very large relationship lists") asserts that an explicit `native-first, 2` override is discarded; rewrite its second `expect` to assert `{ providerStrategy: "native-first", providerLimit: 2 }` and rename the case "size never reduces the provider set, an explicit override does". Then grep `externalDiscoveryService.ts` for every other caller that passed `providerStrategy`/`providerLimit` (the seed path passes `providerLimit: 3` for external seeds at `graphViewService.ts:2465`) and confirm the behaviour change is wanted there: it was already the intent of that call; keep it.

2. `relationshipEvents.ts`: add `source?: "hop-fill";` to `RelationshipPublicationEvent` with the comment "Set by the hop runner; presentation refreshes for these are coalesced." Add:

```ts
/** One item-tree column refresh per this many ms while the runner fills. */
export const HOP_FILL_REFRESH_COALESCE_MS = 10_000;

let coalescedRefresh: ReturnType<typeof setTimeout> | null = null;
let coalescedEvent: CitationUpdateCompletedEvent | null = null;

/** Fire the held refresh now; the runner calls this when its plan empties. */
export function flushCoalescedPresentationRefresh(): void {
  if (coalescedRefresh) clearTimeout(coalescedRefresh);
  coalescedRefresh = null;
  const event = coalescedEvent;
  coalescedEvent = null;
  if (event) publishCitationUpdateCompleted(event);
}
```

(import the `CitationUpdateCompletedEvent` type from `./citationUpdateEvents`). In `requestPresentationRefresh`, before the final `publishCitationUpdateCompleted(...)` call:

```ts
const refresh = {
  refreshGraph: false,
  refreshColumns: event.phase === "membership-published",
  refreshItemPanes: true,
};
if (event.source === "hop-fill") {
  coalescedEvent = {
    refreshGraph: false,
    refreshColumns:
      refresh.refreshColumns || Boolean(coalescedEvent?.refreshColumns),
    refreshItemPanes: true,
  };
  if (!coalescedRefresh) {
    coalescedRefresh = setTimeout(
      flushCoalescedPresentationRefresh,
      HOP_FILL_REFRESH_COALESCE_MS,
    );
  }
  return;
}
publishCitationUpdateCompleted(refresh);
```

3. `externalDiscoveryService.ts`: add `publicationSource?: "hop-fill";` to `ExternalRelationshipRefreshOptions`; give `publishRelationshipState` a trailing parameter `source?: "hop-fill"` that it copies into the event; thread `options.publicationSource` into every `publishRelationshipState(...)` call inside `refreshExternalRelationships` and the functions it calls with `options` in scope (grep `publishRelationshipState(` — the metadata hydration path queued by `queueRelationshipMetadataHydration` also publishes; pass the source into that queue's entry so its `metadata-published` carries it too).

- [ ] **Step 4: Run the tests**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/relationshipRefreshPolicy.test.ts test/unit/relationshipEvents.test.ts test/unit/providerExecutionPolicy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/services/relationshipEvents.ts src/services/externalDiscoveryService.ts src/services/relationshipRefreshPolicy.ts test/unit/relationshipRefreshPolicy.test.ts test/unit/relationshipEvents.test.ts
git add src/services/relationshipEvents.ts src/services/externalDiscoveryService.ts src/services/relationshipRefreshPolicy.ts test/unit/relationshipRefreshPolicy.test.ts test/unit/relationshipEvents.test.ts
git commit -m "Stage 3: hop-fill publications coalesce their column refresh; one provider per hop paper"
```

---

### Task 11: The view service builds a hop model instead of a projection

Spec: "The hop model" (how `hop` reaches the plot, what is deleted), "Visibility" (the scope call), "The gear", "State". This task makes `graphViewService.ts` compile again on the new modules, with no runner yet: hop 1 is still fetched by the existing seed path so the graph works between Task 11 and Task 12.

**Files:**

- Modify: `src/services/graphFocusService.ts` (delete the projection, export the local-matching helpers), `src/services/graphViewService.ts` (many sites, listed), `test/unit/graphFocusService.test.ts`

**Interfaces:**

- Consumes: Tasks 1, 2, 4, 5, 6, 7, 8.
- Produces, inside the service closure (Tasks 12 and 13 extend them): `hopModel: GraphHopModel | null`, `hopDirection: HopDirection`, `hopDepth: number`, `hopEnabled: boolean[]`, `seedKeysOf(): string[]`, `hopNeighbourhood(key, direction)`, `hopModelForSeeds(seedKeys)`, `applyHopModel(model, options)`, `rebuildCurrentFocus(options)`, `scheduleFocusRebuild()`, `setHopDirection(direction)`, `setHopDepth(depth)`, `setHopEnabled(hop, enabled)`, `hopScopeInput()`, `scopeHopsInput()`.

- [ ] **Step 1: Trim `graphFocusService.ts`**

Delete from `src/services/graphFocusService.ts`: `GraphFocusDirection`, `GraphFocusLocality`, `GraphFocusRanking`, `GraphFocusSeedRelationships`, `GraphFocusInput`, `GraphFocusProjection`, `RankedNode`, `AggregatedNode`, `compareRanked`, `compareImpact`, `mergeRole`, `edge`, `directionEntries`, `cloneSeedNode`, `aggregateDirection`, `buildGraphFocusProjection`, `reachedKeysOf`, and the `assignFocusCitationSequence` import. Reduce `GraphFocusState` to:

```ts
/** The seed set. Direction and depth live on the hop state now. */
export interface GraphFocusState {
  /** Ordered seed keys. The first entry is the primary seed used for labels. */
  seedKeys: string[];
}
```

Export the two matching helpers by renaming `localIndexes` → `export function buildLocalWorkIndexes(nodes, graphIndex?)` and `localNodeForWork` → `export function localNodeForWork(work, indexes)`, and export the type `export type LocalWorkIndexes = ReturnType<typeof buildLocalWorkIndexes>;`. Change `additiveGraphModel`'s second parameter type to `{ nodes: readonly CitationGraphNode[]; edges: readonly CitationGraphEdge[] } | null` and its doc comment's "projection" to "hop model". Keep `externalWorkToFocusNode` and `synchronizeExternalFocusNode` as they are.

In `test/unit/graphFocusService.test.ts` delete the `reachedKeysOf` cases and import; the `additiveGraphModel` cases pass a plain `{ nodes, edges }` now. Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/graphFocusService.test.ts` → PASS.

- [ ] **Step 2: The mechanical rename in the service**

In `src/services/graphViewService.ts`:

1. Imports: remove `buildGraphFocusProjection`, `reachedKeysOf`, `GraphFocusProjection`, `GraphFocusDirection`, `GraphFocusLocality`, `focusProjectionCacheKey`, `getCachedFocusProjection`, `setCachedFocusProjection`, `getFocusRelationshipFragment`, `setFocusRelationshipFragment`, `invalidateFocusRelationshipFragment`. Add:

```ts
import {
  buildGraphHopModel,
  hopByKey,
  reachedFromSeed,
  clampHopDepth,
  type GraphHopModel,
  type HopDirection,
  type HopNeighbourhood,
} from "./graphHopModel";
import {
  buildLocalWorkIndexes,
  localNodeForWork,
  type LocalWorkIndexes,
} from "./graphFocusService";
import {
  getHopFragment,
  invalidateHopFragment,
  setHopFragment,
} from "./focusGraphCacheService";
import { getStoredRelationshipSummary } from "./relationshipStoreService";
import { defaultHopEnabled } from "./graphViewState";
import type { ScopeHopsInput } from "./graphScopeRailModel";
```

2. `sed`-style renames across the file: `focusProjection` → `hopModel`; the type `GraphFocusProjection` → `GraphHopModel`; `.state.seedKeys` → `.seeds.map((seed) => seed.key)` wherever it reads keys off the model (lines 1994, 2690, 2713, 3712, 3813, 4473, 4488 region). Where `focusProjection.state.direction`/`.locality` were assigned into the gear's selects (1824-1825, 2370-2371) delete the lines.

3. Replace the state declarations at line 521-531:

```ts
let hopModel: GraphHopModel | null = null;
let hopDirection: HopDirection = "cited-by";
let hopDepth = 1;
let hopEnabled: boolean[] = defaultHopEnabled();
const focusSeedRegistry = new Map<string, CitationGraphNode>();
const focusRefreshInFlight = new Map<string, Promise<void>>();
const focusRefreshTimers = new Map<string, number>();
const focusRefreshQueue = new SerializedTaskQueue();
let focusRefreshEpoch = 0;
let focusRefreshCount = 0;
```

(`focusRelationships` goes: the fragment cache is the per-tab memo now.)

4. Delete the gear's Explore section: lines 905-946 (`focusDirection`, `focusLocality`, `exploreSection`), the `appearance.panel.prepend(exploreSection)` at 1173, the `exploreSection` lines inside `setSeeded`, the `change` listeners at 3894-3899. `focusStateFromControls(seedKeys)` becomes:

```ts
const seedState = (seedKeys: string[]): GraphFocusState => ({
  seedKeys: [...new Set(seedKeys)],
});
```

and every `focusStateFromControls(` call becomes `seedState(`.

- [ ] **Step 3: Replace the builder and the apply path**

Replace `inLibraryReachedKeys`, `applySeedProjection`, `seedsForState`, `projectionForState` (lines 2246-2333) with:

```ts
/**
 * A paper's stored list in one direction, as hop neighbours: the library's
 * own node where the work matches one, otherwise an external node built
 * from the work. Library citations already in the graph count as
 * neighbours too, as they did for a seed. Memoised per paper and direction
 * in the fragment cache, invalidated when that paper publishes.
 */
let localWorkIndexes: LocalWorkIndexes | null = null;
const refreshLocalWorkIndexes = (): void => {
  localWorkIndexes = buildLocalWorkIndexes(
    [...focusSeedRegistry.values()],
    libraryGraphIndex,
  );
};
const hopSubject = (key: string): CitationGraphNode | null =>
  focusSeedRegistry.get(key) ??
  libraryGraphIndex.nodeByKey.get(key) ??
  model.nodes.find((node) => node.key === key) ??
  null;
const hopNeighbourhood = (
  key: string,
  direction: HopDirection,
): HopNeighbourhood => {
  const subject = hopSubject(key);
  if (!subject) return { expanded: false, neighbours: [] };
  let fragment = getHopFragment(snapshot.libraryID, key, direction);
  if (!fragment) {
    const stored = getStoredRelationshipSummary(subject, direction);
    const works = getRelationshipViewSnapshot(
      seedRelationshipGraph(subject),
      subject,
      direction,
      snapshot.libraryID,
      FOCUS_RELATIONSHIP_CACHE_LIMIT,
      { queueBackgroundHydration: false },
    ).works;
    fragment = { expanded: stored !== null, works };
    setHopFragment(snapshot.libraryID, key, direction, fragment);
  }
  const indexes =
    localWorkIndexes ?? buildLocalWorkIndexes([], libraryGraphIndex);
  const neighbours = new Map<
    string,
    { node: CitationGraphNode; provenance: string }
  >();
  const relations =
    direction === "references"
      ? (libraryGraphIndex.outgoingEdgesByKey.get(subject.key) ?? [])
      : (libraryGraphIndex.incomingEdgesByKey.get(subject.key) ?? []);
  for (const relation of relations) {
    const other =
      direction === "references" ? relation.target : relation.source;
    const node = libraryGraphIndex.nodeByKey.get(other);
    if (node)
      neighbours.set(node.key, { node, provenance: relation.provenance });
  }
  for (const work of fragment.works) {
    const local = localNodeForWork(work, indexes);
    const node =
      local ??
      externalWorkToFocusNode(
        work,
        direction === "references" ? "reference" : "cited-by",
      );
    if (!neighbours.has(node.key)) {
      neighbours.set(node.key, { node, provenance: work.provider });
    }
  }
  return { expanded: fragment.expanded, neighbours: [...neighbours.values()] };
};

const seedsForState = (state: GraphFocusState): CitationGraphNode[] =>
  state.seedKeys
    .map(
      (key) =>
        focusSeedRegistry.get(key) ??
        libraryModel.nodes.find((node) => node.key === key) ??
        model.nodes.find((node) => node.key === key) ??
        null,
    )
    .filter((node): node is CitationGraphNode => Boolean(node))
    .map(resolveFocusSeed);

const hopModelForSeeds = (state: GraphFocusState): GraphHopModel | null => {
  const seeds = seedsForState(state);
  refreshLocalWorkIndexes();
  const seedKeys = new Set(seeds.map((seed) => seed.key));
  const seedEdges = libraryModel.edges.filter(
    (edge) => seedKeys.has(edge.source) && seedKeys.has(edge.target),
  );
  return buildGraphHopModel({
    seeds,
    direction: hopDirection,
    depth: hopDepth,
    neighbours: hopNeighbourhood,
    seedEdges,
  });
};

/** Hop papers the library already holds; they wear the thin ring. */
const inLibraryHopKeys = (model: GraphHopModel): Set<string> =>
  new Set(
    [...model.entries.keys()].filter(
      (key) => !model.seedKeys.has(key) && libraryGraphIndex.nodeByKey.has(key),
    ),
  );

const applyHopModel = (
  next: GraphHopModel,
  projectionOptions: { fit?: boolean } = {},
): void => {
  setSeeded(true);
  hopModel = next;
  // An addition, not a replacement: the library graph stays and the hop
  // papers merge into it, so adding a seed never removes anything and
  // unticking a folder never removes a paper a hop brought in.
  const merged = additiveGraphModel(libraryModel, next);
  model.nodes.splice(0, model.nodes.length, ...merged.nodes);
  model.edges.splice(0, model.edges.length, ...merged.edges);
  model.statistics.nodes = merged.nodes.length;
  model.statistics.edges = merged.edges.length;
  model.statistics.resolvedNodes = merged.nodes.filter(
    (node) => node.citationCount !== null || node.referenceCount !== null,
  ).length;
  // One pass over the edges, not one search per node: a hop-2 graph is
  // thousands of nodes and the old filter-with-some was quadratic.
  const linked = new Set<string>();
  for (const edge of merged.edges) {
    linked.add(edge.source);
    linked.add(edge.target);
  }
  model.statistics.isolatedNodes = merged.nodes.filter(
    (node) => !linked.has(node.key),
  ).length;
  rebuildGraphFilterDescriptors();
  renderer?.syncModel({ draw: false });
  renderer?.setSeedKeys(next.seedKeys, false);
  ensureSwatchesFor();
  renderer?.setSeedColors(seedColorsFor(next), false);
  renderer?.setInLibraryReachedKeys(inLibraryHopKeys(next), false);
  // The hop map, not a node field: the merge above kept the library's own
  // node objects, which carry no hop.
  renderer?.setHops(hopByKey(next), false);
  applyFilters();
  if (projectionOptions.fit) scheduleFocusFit();
  updateFocusBar();
  notifyStateChange();
};
```

Then: every `applySeedProjection(` → `applyHopModel(`; every `projectionForState(` → `hopModelForSeeds(`; `seedColorsFor(projection: GraphFocusProjection)` reads `projection.seeds.map((seed) => seed.key)`; `rebuildCurrentFocus` uses `seedState(hopModel.seeds.map((seed) => seed.key))`; the emphasis at line 1276 becomes `hopModel ? reachedFromSeed(hopModel, emphasis.seedKey) : new Set<string>()`; `ensureFocusRelationships`, `cacheFocusRelationships` and their callers go (the seed refresh path at 2480-2530 and the publication handler at 3045-3062 re-read through the fragment cache instead: replace those blocks with `invalidateHopFragment(snapshot.libraryID, seed.key); scheduleFocusRebuild();`). In `replaceLibraryGraph` the `rebuildCurrentFocus()` already re-applies the model and with it `setHops`; add `renderer?.setHops(new Map(), false)` to `clearSeeds` beside `setInLibraryReachedKeys(new Set(), false)`.

- [ ] **Step 4: The scope call, the rail input and the setters**

Replace the `computeGraphScope` call inside `applyFilters` (line 3840) so the `reachedKeys` field becomes:

```ts
      hops: {
        entries: hopModel?.entries ?? new Map(),
        depth: hopDepth,
        enabled: hopEnabled,
      },
```

Add three setters next to `applyFilters`:

```ts
const setHopDirection = (direction: HopDirection): void => {
  if (direction === hopDirection) return;
  hopDirection = direction;
  if (hopModel) rebuildCurrentFocus();
  notifyStateChange();
};
const setHopDepth = (depth: number): void => {
  const next = clampHopDepth(depth);
  if (next === hopDepth) return;
  hopDepth = next;
  if (hopModel) rebuildCurrentFocus();
  notifyStateChange();
};
const setHopEnabled = (hop: number, enabled: boolean): void => {
  if (hop <= 0 || hop > hopDepth) return;
  hopEnabled = hopEnabled.map((value, index) =>
    index === hop ? enabled : value,
  );
  applyFilters();
  notifyStateChange();
};
```

Rail input (Task 12 fills `fill` and the reported counts; for now pass `null`s): in `refreshScopeRail` add

```ts
        hops: hopModel ? scopeHopsInput() : null,
```

with

```ts
const scopeHopsInput = (): ScopeHopsInput => {
  const colouring = renderer?.getLayout().nodeColorMetric === "citation-hop";
  const assignment = colouring ? renderer?.getCategoryAssignment() : null;
  return {
    direction: hopDirection,
    depth: hopDepth,
    enabled: hopEnabled,
    shownByHop: lastScope?.shownByHop ?? [],
    availableByHop: lastScope?.availableByHop ?? [],
    reportedByHop: hopReportedByHop(),
    colours: assignment
      ? Array.from(
          { length: hopDepth + 1 },
          (_, hop) =>
            assignment.entries.find((entry) => entry.key === `hop:${hop}`)
              ?.color ?? null,
        )
      : null,
    fill: hopFillState(),
  };
};
let hopReportedByHop = (): (number | null)[] => [];
let hopFillState = (): ScopeHopsInput["fill"] => null;
```

(Task 12 reassigns the two `let`s.) Wire the rail handlers in `createKeyRail`'s `onScope` (line ~1343): `setHopDirection: (direction) => setHopDirection(direction)`, `fetchHop: (hop) => fetchHop(hop)`, `toggleHop: (hop, on) => setHopEnabled(hop, on)`, `fillControl: (action) => fillControl(action)`, with `let fetchHop = (hop: number): void => { setHopDepth(hop); }; let fillControl = (_action: "stop" | "resume" | "more"): void => undefined;` declared before the rail (Task 12 reassigns them).

The gear: after `const appearance = createAxesAppearance(...)` add nothing; in `setSeeded` add `appearance.setColourOptionAvailable("citation-hop", seeded);` — `appearance` is created after `setSeeded`, so guard with a `let appearanceReady = false` or move the call into `applyHopModel`/`clearSeeds` (call `appearance.setColourOptionAvailable("citation-hop", true)` at the end of `applyHopModel` and `false` in `clearSeeds`). Do the latter.

- [ ] **Step 5: State in and out, and the migration notice**

`getState` (line 4486): replace the `explore: {...}` field with `hops: { direction: hopDirection, depth: hopDepth, enabled: [...hopEnabled] },`.

`applyState` (line 4528): replace the two `focusDirection.value`/`focusLocality.value` lines with

```ts
hopDirection = state.hops.direction;
hopDepth = state.hops.depth;
hopEnabled = [...state.hops.enabled];
if (state.migratedFromBothDirections) {
  // A saved graph fetched both directions until Stage 3; say once
  // what it shows now, through the path B42's read-only notice uses.
  setStatus("Directions are now one at a time; showing Citers", {
    sticky: true,
  });
}
```

In the `initialState` branch at line 4738 replace the two select assignments with the same three assignments (without the notice; `applyState` handles the other branch). Check `setStatus`'s signature at line 3966 for the `sticky` option's name and use it as declared.

- [ ] **Step 6: Compile, run every unit test, commit**

Run: `npm run typecheck` then `npm run test:unit`.
Expected: both clean. Fix any leftover reference to a deleted name (`grep -n "focusRelationships\|focusDirection\|focusLocality\|reachedBySeed\|GraphFocusProjection" src/services/graphViewService.ts` must print nothing).

Then run `npm run check`.
Expected: PASS.

```bash
git add -A src test
git commit -m "Stage 3: the view builds a hop model in place of the projection; gear Explore section gone"
```

- [ ] **Step 7: Smoke it in Zotero**

Run: `npm test`. Expected: the existing suites pass (`graphScopeRail`, `graphViews`, the visual ones). If `graphViews.test.ts` in the Zotero suite asserts the old "Arrives with citation hops" copy for Cornerstones or the save panel's "not yet available" row, update those assertions to the new copy from Task 9. Wait for the process to exit before the next run.

---

### Task 12: The runner

Spec: "The fill" (runner, cap, publications, inactive tab, controls, direction switch, Refresh) and "The rail" (progress line data).

**Files:**

- Modify: `src/services/graphViewService.ts` (the seed refresh path at 2380-2620, `applyRelationshipPublication` at 3024, `reconcileInactiveView` at 4425, `refreshButton` handler at 4189, `setActive` at 4707, the rail hooks from Task 11)
- Test: Zotero suite in Task 14; unit coverage is the planner (Task 3). A service-level unit test is not attempted: `graphViewService.ts` has no unit harness (only the Zotero suite exercises it), so the runner's isolation is verified by the Zotero case "Refresh stays enabled during a fill" in Task 14.

**Interfaces:**

- Consumes: `planHopFill`, `HOP_EXPANSION_CAP` (Task 3); `refreshExternalRelationships` with `publicationSource`, `providerStrategy`, `providerLimit` (Task 10); `flushCoalescedPresentationRefresh` (Task 10); `AUTOMATIC_RELATIONSHIP_MEMBERSHIP_LIMIT` from `relationshipRefreshPolicy.ts`.
- Produces: `fetchHop`, `fillControl`, `hopFillState`, `hopReportedByHop` reassigned; `scheduleHopFill()`.

- [ ] **Step 1: Runner state and plan**

Add after the hop state from Task 11:

```ts
// ---- the hop runner: one request in flight, its own queue, epoch and
// counter, so the seed Refresh button and a seed change never touch it.
const hopFillQueue = new SerializedTaskQueue();
let hopFillEpoch = 0;
let hopFillInFlight: string | null = null;
let hopFillPaused = false;
let hopFillFrame = 0;
const hopFailedKeys = new Set<string>();
/** Landed expansions this session, by direction then hop. */
const hopExpandedByHop: Record<HopDirection, number[]> = {
  "cited-by": [],
  references: [],
};
const hopCapByHop: Record<HopDirection, number[]> = {
  "cited-by": [],
  references: [],
};
/** The reported total each expanded paper returned, by direction. */
const hopReported: Record<HopDirection, Map<string, number>> = {
  "cited-by": new Map(),
  references: new Map(),
};
let lastHopPlan: ReturnType<typeof planHopFill> | null = null;
/** Coalesced library-snapshot invalidation while the runner fills. */
let hopSnapshotTimer = 0;
let hopSnapshotPending = false;

const capFor = (hop: number): number =>
  hopCapByHop[hopDirection][hop] ?? HOP_EXPANSION_CAP;

// The camera's contents, in the canvas's own device pixels: the transform
// maps world positions to device pixels (graphViewport.ts, projectToScreen),
// so the bound is the canvas's width and height, not its CSS box.
const onScreenKeys = (): Set<string> => {
  const active = renderer;
  if (!active) return new Set();
  const canvas = active.getCanvas();
  const transform = active.getViewTransform();
  const keys = new Set<string>();
  for (const node of active.getScopeNodes()) {
    const position = active.positionOf(node.key);
    if (!position) continue;
    const { x, y } = projectToScreen(position, transform);
    if (x >= 0 && y >= 0 && x <= canvas.width && y <= canvas.height) {
      keys.add(node.key);
    }
  }
  return keys;
};

const currentHopPlan = (): ReturnType<typeof planHopFill> | null => {
  if (!hopModel || !lastScope) return null;
  return planHopFill({
    entries: hopModel.entries,
    visibleKeys: lastScope.visibleKeys,
    depth: hopDepth,
    selectedKey: selectedNode?.key ?? null,
    hoveredKey: renderer?.getHoverKey() ?? null,
    onScreenKeys: onScreenKeys(),
    failedKeys: hopFailedKeys,
    expandedByHop: hopExpandedByHop[hopDirection],
    capByHop: Array.from({ length: hopDepth + 1 }, (_, hop) => capFor(hop)),
    reportedCountOf: (key) => {
      const reported = hopReported[hopDirection].get(key);
      if (reported !== undefined) return reported;
      const node = hopSubject(key);
      if (!node) return null;
      return hopDirection === "references"
        ? node.referenceCount
        : node.citationCount;
    },
  });
};
```

Add to the renderer (in `citationGraphRenderer.ts`, next to `getViewTransform`): `public getHoverKey(): string | null { return this.hoverKey; }` and `public positionOf(key: string): Position | null { return this.positions.get(key) ?? null; }` (`positions` is `Map<string, Position>` in world coordinates, `citationGraphRenderer.ts:192`). In the service import `projectToScreen` from `./graphViewport`; it is the same function the renderer's private `projectToScreen` wraps (`citationGraphRenderer.ts:579`).

- [ ] **Step 2: The expansion**

```ts
const expandHopPaper = (key: string, epoch: number): Promise<void> => {
  const subject = hopSubject(key);
  if (!subject) return Promise.resolve();
  const direction = hopDirection;
  hopFillInFlight = key;
  return hopFillQueue
    .enqueue(async () => {
      if (cleaned || epoch !== hopFillEpoch) return;
      if (subject.itemID <= 0)
        await prepareExternalFocusSeedForRefresh(subject);
      if (cleaned || epoch !== hopFillEpoch) return;
      let resolved = false;
      try {
        await refreshExternalRelationships(
          subject,
          libraryModel.nodes,
          direction,
          {
            maximum: AUTOMATIC_RELATIONSHIP_MEMBERSHIP_LIMIT,
            refreshMembership: true,
            silent: true,
            mode: "automatic",
            providerStrategy: "native-first",
            providerLimit: 1,
            queueBackgroundHydration: true,
            showBackgroundProgress: false,
            metadataHydrationLimit: 0,
            summaryLookupLimit: 0,
            publicationSource: "hop-fill",
            ...(subject.itemID <= 0 &&
            subject.provider &&
            subject.providerWorkID
              ? {
                  providerWorkIDs: {
                    [subject.provider]: subject.providerWorkID,
                  },
                }
              : {}),
            onMembershipResolved: (resolution) => {
              resolved = resolution.complete || resolution.identifiedCount > 0;
              if (resolution.reportedCount !== null) {
                hopReported[direction].set(key, resolution.reportedCount);
              }
            },
          },
        );
      } catch (error) {
        Zotero.logError(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
      if (cleaned || epoch !== hopFillEpoch) return;
      // Expanded means a stored summary exists now; anything else failed
      // for the session (spec, "Vocabulary").
      const stored = getStoredRelationshipSummary(subject, direction) !== null;
      if (stored) {
        const entry = hopModel?.entries.get(key);
        const hop = entry?.hop ?? 0;
        const counts = hopExpandedByHop[direction];
        counts[hop] = (counts[hop] ?? 0) + 1;
      } else if (!resolved) {
        hopFailedKeys.add(key);
      }
      invalidateHopFragment(snapshot.libraryID, key);
      if (hopModel?.seedKeys.has(key)) onSeedExpanded(key);
    })
    .finally(() => {
      if (epoch !== hopFillEpoch) return;
      hopFillInFlight = null;
      // The rebuild re-reads one fragment and recomputes the scope, which
      // re-plans through applyFilters → scheduleHopFill.
      if (!cleaned) rebuildCurrentFocus();
    });
};
```

`onSeedExpanded(key)` replaces the tail of `queueAutomaticFocusConnectionUpdate`: it deletes `key` from `focusPostRefreshFitSeeds` and, when that set is empty and `hopModel` is set, calls `rebuildCurrentFocus({ fit: true })`. Define it beside `focusPostRefreshFitSeeds`.

- [ ] **Step 3: The scheduler**

```ts
const scheduleHopFill = (): void => {
  if (cleaned || hopFillFrame) return;
  const view = document.defaultView;
  const run = (): void => {
    hopFillFrame = 0;
    if (cleaned) return;
    lastHopPlan = currentHopPlan();
    refreshScopeRail();
    if (!hopModel || !lastHopPlan || hopFillPaused || !viewActive) return;
    if (hopFillInFlight) return;
    const next = lastHopPlan.order[0];
    if (!next) {
      flushCoalescedPresentationRefresh();
      flushHopSnapshot();
      return;
    }
    void expandHopPaper(next, hopFillEpoch);
  };
  hopFillFrame = view
    ? view.requestAnimationFrame(run)
    : (setTimeout(run, 0) as unknown as number);
};
hopFillState = () => {
  if (!lastHopPlan) return null;
  const remaining = lastHopPlan.remainingByHop.reduce((sum, n) => sum + n, 0);
  const waiting = lastHopPlan.waitingByHop.reduce((sum, n) => sum + n, 0);
  if (!remaining && !waiting) return null;
  return { remaining: remaining - waiting, waiting, paused: hopFillPaused };
};
hopReportedByHop = () => {
  if (!hopModel) return [];
  const totals: (number | null)[] = Array.from(
    { length: hopDepth + 1 },
    () => null,
  );
  for (const entry of hopModel.entries.values()) {
    const reported = hopReported[hopDirection].get(entry.key);
    if (reported === undefined || entry.hop >= hopDepth) continue;
    const hop = entry.hop + 1;
    totals[hop] = (totals[hop] ?? 0) + reported;
  }
  return totals;
};
fetchHop = (hop: number): void => {
  hopFillPaused = false;
  hopEnabled = hopEnabled.map((value, index) => (index === hop ? true : value));
  setHopDepth(hop);
};
fillControl = (action) => {
  if (action === "stop") hopFillPaused = true;
  else if (action === "resume") hopFillPaused = false;
  else {
    hopFillPaused = false;
    const caps = hopCapByHop[hopDirection];
    for (let hop = 0; hop < hopDepth; hop += 1) {
      if ((lastHopPlan?.waitingByHop[hop] ?? 0) > 0)
        caps[hop] = capFor(hop) + HOP_EXPANSION_CAP;
    }
  }
  scheduleHopFill();
};
```

Call `scheduleHopFill()` at the end of `applyFilters` (after `maybeShowGallery()`), in the renderer's `onSelectionChange` handler, and on hover and camera changes: add `onHoverChange?: (key: string | null) => void` and `onViewChange?: () => void` to `CitationGraphRendererOptions`, invoke the first where `hoverKey` changes (renderer lines 714 and 751) and the second inside `markViewAdjusted`, and pass both from the service as `() => scheduleHopFill()`. In `setHopDirection` bump `hopFillEpoch += 1; hopFillInFlight = null;` before the rebuild (a request in flight still stores; only its callbacks are dropped). In `clearSeeds` bump the epoch, clear `hopFailedKeys`, reset `lastHopPlan = null`.

Snapshot coalescing:

```ts
const flushHopSnapshot = (): void => {
  if (hopSnapshotTimer) clearFocusTask(hopSnapshotTimer);
  hopSnapshotTimer = 0;
  if (!hopSnapshotPending) return;
  hopSnapshotPending = false;
  invalidateCitationGraphSnapshot(snapshot.libraryID);
};
```

In `applyRelationshipPublication`: when `event.phase === "membership-published"`, if `event.source === "hop-fill"` set `hopSnapshotPending = true` and, if no timer, `hopSnapshotTimer = scheduleFocusTask(flushHopSnapshot, HOP_FILL_REFRESH_COALESCE_MS)`; else invalidate at once as today. Then, for any phase, `invalidateHopFragment(event.libraryID, subject.key)` and, if `hopModel?.entries.has(subject.key)`, `scheduleFocusRebuild()` (this replaces the seed-only branch; the non-seed `scheduleRelationshipGraphRefresh()` stays for a seedless graph). Today only `metadata-published` invalidates a fragment; `membership-published` must too, or a paper expanded a second time (Fetch more, the detail pane's refresh) walks on its stale list.

- [ ] **Step 4: Narrow the seed path to manual Refresh**

In `refreshFocusSeedConnections`: `const directions = [hopDirection]` filtered as before by `forceRefresh || !selectedRelationshipCacheIsFresh(seed, direction)`; keep `mode` manual only by deleting the `mode` parameter's automatic branch (the `maximum` is always `FOCUS_RELATIONSHIP_CACHE_LIMIT`, `showBackgroundProgress: true`). Replace the `onMembershipResolved`/post-refresh blocks that wrote `focusRelationships` with `invalidateHopFragment(snapshot.libraryID, seed.key); scheduleFocusRebuild();`. Delete `queueAutomaticFocusConnectionUpdate` and its two callers in `enterFocusSeeds`/`addFocusSeeds`; in their place `focusPostRefreshFitSeeds.add(seed.key)` for each new seed (the runner's `onSeedExpanded` consumes it). `loadFocusConnections` loses its `mode` option (always manual). Update `updateFocusRefreshState`'s title to "Refresh the seeds' lists in the current direction."

In `reconcileInactiveView`'s seeded branch replace the loop with `rebuildCurrentFocus();` (fragments were invalidated by the publications the inactive tab received). In `setActive(true)` add `scheduleHopFill()` after `reconcileInactiveView()`.

- [ ] **Step 5: Check, run, commit**

Run: `npm run check` → PASS. Then `npm test` → the existing suites pass; open a graph by hand if the user is present, otherwise rely on Task 14's suite.

```bash
git add -A src
git commit -m "Stage 3: the runner fills shown papers one at a time, seeds first, under the cap"
```

---

### Task 13: Views apply hops; the save panel; the queued view

Spec: "Views (D4)".

**Files:**

- Modify: `src/services/graphViewService.ts` (`refreshViewChip` at 2020, `applyGraphView` at 2048, `openSavePanel`'s `captures` at 2147 and its `captureGraphView` call at 2126)

- [ ] **Step 1: Live input and apply**

Define `const liveHops = () => ({ direction: hopDirection, depth: hopDepth, enabled: hopEnabled });` and pass `hops: liveHops()` in the three `GraphViewLiveInput` literals (`refreshViewChip`, `applyGraphView`, the saved-view re-plan at 2179) and in `captureGraphView`'s input. `captures.explore` becomes `existing?.explore ? \`${existing.explore.hops} hop${existing.explore.hops === 1 ? "" : "s"} of ${existing.explore.direction === "references" ? "references" : "citers"}\` : \`${hopDepth} hop${hopDepth === 1 ? "" : "s"} of ${hopDirection === "references" ? "references" : "citers"}\``.

In `applyGraphView`, before `appearance.setLayout(plan.layout)`:

```ts
const seedCount = hopModel?.seeds.length ?? 0;
const needs =
  chosen.requires === "seed" ? 1 : chosen.requires === "two-seeds" ? 2 : 0;
if (seedCount < needs) {
  // The view waits for its seed: the Add seed panel opens with the view
  // queued, and the view is applied when the seed lands.
  queuedView = chosen;
  openFocusSeedPopover(keyRail.addSeedAnchor());
  setStatus(
    `${chosen.name} needs ${needs === 1 ? "a seed" : "2 seeds"}; add one to apply it`,
  );
  return;
}
if (chosen.explore) {
  hopDirection = chosen.explore.direction;
  hopDepth = chosen.explore.hops;
  hopEnabled = hopEnabled.map((value, hop) =>
    hop <= chosen.explore!.hops ? true : value,
  );
  hopFillPaused = false;
  if (hopModel) rebuildCurrentFocus();
}
```

with `let queuedView: GraphViewDefinition | null = null;` declared near `applyGraphView`. At the end of `enterFocusSeeds` and `addFocusSeeds` (after the seeds are activated) add:

```ts
if (queuedView) {
  const view = queuedView;
  queuedView = null;
  applyGraphView(view);
}
```

`tutorialFootnote(plan, chosen)` per Task 9.

- [ ] **Step 2: Check, test, commit**

Run: `npm run check` → PASS.

```bash
git add src/services/graphViewService.ts
git commit -m "Stage 3: applying a view opens its hops; a view short of seeds waits for them"
```

---

### Task 14: The Zotero suite walk

Spec: "Testing" (Zotero suite). Evidence in assertion messages; timing-shaped cases run twice.

**Files:**

- Create: `test/zotero/graphCitationHops.test.ts` (copy the scaffolding of `test/zotero/graphScopeRail.test.ts`: `shown`, `customMenu`, `waitFor`, `command`, `graphRoot`, `tabContent`, `graphTabs`, the fixture collection, the seed-adding walk through the node menu)

- [ ] **Step 1: Write the suite**

Cases, in order against one graph opened from Tools › Meristema › New Graph on a fixture collection with one library paper that has a DOI the providers know (reuse the fixture the scope rail suite seeds with):

1. **Hop 1 fills.** Add the paper as a seed through the node menu. `waitFor` the row labelled `Hop 1` (`.cm-scope-hop-row[data-hop="1"] .cm-scope-row-count`) to read `n/n` with `n > 0`, timeout 60 s. Assertion message: the count text, the Seeds row text and `galleryState()`.
2. **Fetch hop 2.** The row `data-hop="2"` holds a button whose text is `Fetch hop 2`; `click()` it. `waitFor` the hop-2 count to change from `not fetched` to a `x/y` with `y > 0`, timeout 120 s. Message: both counts and the progress line's text (`.cm-scope-hop-progress`).
3. **Refresh stays enabled during the fill.** Immediately after 2 starts, assert the toolbar's Refresh button is not `disabled` (message: `aria-busy` and `title`).
4. **Unticking Hop 1 hides the external hop-2 nodes.** Read `scopeCount()`, untick the hop-1 checkbox, `waitFor` the hop-2 count's `x` to become `0`, then re-tick. Message: counts before and after.
5. **Switch to References rebuilds the ladder.** Click the `References` cell; `waitFor` the hop-1 count to read `x/y` again (References of the seed are fetched by the runner); assert the active cell has `aria-checked="true"`.
6. **Save, reopen, state is back.** Save the graph through File › Save (the saved-graph menu the D4 suite uses), close the tab, open it from the saved-graph menu, assert the References cell is active and the hop-2 row is opened (not `not fetched`). Message: the two row texts.
7. **A version 4 record with `both` shows the notice.** Create a saved graph directly with `createSavedGraph` (as the D4 suite creates its v3 graph) whose state JSON is `{ ...emptyGraphViewState(), version: 4, explore: { direction: "both", locality: "all" } }` with `hops` deleted, open it, `waitFor` the toolbar status text to equal `Directions are now one at a time; showing Citers`.

Cases 2 and 5 are timing-shaped: run them twice in the same suite (a second `it` that repeats the wait after a `Refresh`), as the memory note prescribes.

- [ ] **Step 2: Run the suite**

Run: `npm test` (wait for any earlier run's process to exit first).
Expected: PASS. On a failure, the assertion message carries the counts; do not add `Zotero.debug` calls, they never reach the log.

- [ ] **Step 3: Commit**

```bash
npx prettier --write test/zotero/graphCitationHops.test.ts
git add test/zotero/graphCitationHops.test.ts
git commit -m "Stage 3: the Zotero suite walks the hop ladder, the switch, save and reopen"
```

---

### Task 15: Docs, roadmap, XPI

**Files:**

- Modify: `docs/superpowers/handoffs/2026-09-08-roadmap.md` (Stage 3 rows at 69-84; the Manual verification section), `docs/superpowers/specs/2026-09-12-citation-hops-design.md` (status line)

- [ ] **Step 1: Tick the roadmap and queue the manual checks**

Tick `brainstorm and spec`, `plan` and `implemented, reviewed, merged, XPI built, pushed` only for what is true at this point (merged and pushed are the user's calls; tick "implemented, reviewed" by splitting the row if the roadmap's convention allows, otherwise leave the row and note the state in the handoff). Append to the roadmap's Manual verification section the eight checks from the spec's "Manual verification" list, verbatim.

Change the spec's status line to `**Status:** Built <date>; manual checks queued (revised 2026-09-12 after an adversarial review of 24 findings, folded in below)`.

- [ ] **Step 2: Format, check, commit**

Run: `npx prettier --write docs/superpowers/handoffs/2026-09-08-roadmap.md docs/superpowers/specs/2026-09-12-citation-hops-design.md && npm run check`.

```bash
git add docs
git commit -m "Roadmap: Stage 3 built; manual checks queued"
```

- [ ] **Step 3: Build the XPI last**

Run: `npm run build` after the last `npm test` of the session (the test run deletes the XPI, and so does the user's `zotero-plugin serve` watcher on any source edit).
Expected: the XPI under `.scaffold/build/` or wherever `zotero-plugin build` writes it; report the path.

---

## Self-review

**Spec coverage.** Vocabulary → Tasks 1, 12 (expanded, failed). Hop model incl. `hopByKey`, fragment cache, linear isolated count → Tasks 1, 5, 7, 11. Visibility → Task 2. Fill: planner and cap → 3; runner, own queue/epoch/counter, one provider, silent, publications coalesced, walk rebuild on any hop entry, inactive tab, controls, direction switch, Refresh seeds-only → 10, 12; per-paper refresh from the detail pane is existing behaviour and untouched. Rail → 8 (model, DOM, CSS) and 12 (data). Plot: colouring at seven touch points → 6; opacity on fill, label, edge → 7; in-library ring → 11; Add as seed unchanged. Gear → 6 (option), 11 (section deleted, option toggled). Views → 9, 13. State v5, migration, notice → 4, 11. Store keys / `focus:candidate:` → Task 1 stamps nodes from the parent's work and `hopSubject` resolves through the seed registry and the library index; the promotion case is asserted in Task 1's external-node test only by key shape — **gap**: add to Task 1's tests a case where the lookup is asked for a `focus:candidate:` key after `synchronizeExternalFocusNode` promoted the node's `itemKey`; the walk keys by `node.key`, which the promotion never changes (`graphFocusService.ts:204`), so the assertion is that `buildGraphHopModel` keeps asking the lookup by `node.key`. Added as the last case of Task 1 during execution. Testing list: `graphScopeRailModel.test.ts` → 8; `graphFocusService.test.ts` → 11; the runner's service-level case → not possible without a harness, replaced by Zotero case 3 (Task 12 says so). Manual verification → 15.

**Placeholders.** None of "TBD/TODO/similar to Task N". Where a step says "grep for X" it names the symbol and the file, and the code that follows is complete.

**Type consistency.** `HopDirection` is imported from `graphHopModel` everywhere (Tasks 4, 8, 9, 11). `GraphScopeHops.entries` takes `ReadonlyMap<string, ScopeHopEntry>` and receives `hopModel.entries: Map<string, HopEntry>` (structural superset) in Task 11. `ScopeHopsInput.fill` is `{ remaining, waiting, paused } | null` in Tasks 8 and 12. `planHopFill`'s `expandedByHop`/`capByHop` are per direction in Task 12, matching Task 3's per-hop arrays. `renderer.setHops` (Task 7) is what Task 11 calls; `renderer.getHoverKey`/`positionOf` are added in Task 12 Step 1. `tutorialFootnote(application, view?)` (Task 9) matches Task 13's call.
