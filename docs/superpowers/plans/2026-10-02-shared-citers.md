# Shared Citers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A hop-1 paper's seed links (how many seeds it cites, or is cited by) show as a Seeds linked colouring with Key tiers, seed-coloured edges and label priority; a shared rule in Scope hides hop-1 papers with too few; it persists and travels on views, and Who cites whom becomes ready.

**Architecture:** One pure module, `src/services/graphSeedLinks.ts`, owns the count, the tier labels, the ramp step and the label rank. `SeedMarks` carries the counts as a map (ADR 0008). `computeGraphScope` gains the shared rule as step 5, after the floor, so hiding, counting and the fill's smaller plan follow from one function, as they did for the floor. The colouring is a categorical metric, `seed-links`, whose assignment takes its colours from the theme's existing sequential ramp rather than the swatch ledger.

**Tech Stack:** TypeScript, canvas 2D, `node:test` + chai for `test/unit`, the Zotero suite under `test/zotero` (mocha).

Spec: `docs/superpowers/specs/2026-09-28-shared-citers-design.md`. Read it once before any task. Where this plan differs from the spec, the plan wins and Task 8 brings the spec into line:

- The tier colours reuse `theme.ramp` (five stops, already validated against the seed and categorical palettes in `test/unit/graphPalette.test.ts`) instead of a new eight-step `SEED_LINK_RAMP`. Tier k of S takes stop `round((k − 1) / (S − 1) × 4)`.
- `GraphScopeInput` gains `shared` only. k is computed in the scope from `hops.entries` and `seedKeys`, which it already has, through the same `seedLinkCount` helper `seedMarks` uses.
- The Key's not-graded line is the existing no-value entry, labelled `Not graded`, and the note is always present under the colouring: `Only hop 1 is graded, by the links fetched.` No cut flag is plumbed in.
- The rail row's count reads `{n} below`, like the floor's, not `{n} hidden` (which the rail already uses for papers removed one by one).

## Global Constraints

- Branch `s4-shared-citers` off `main`; commits in sentence case, no type prefix, staged by path (`git add <paths>`, never `-A`).
- The gate is `npm run check` (prettier over `src`, `test`, `docs`, `README.md`; typecheck of `src` and `test`; the unit suite). Run it before every commit; this plan's test code has never been compiled.
- Colour literals only in `src/services/graphTheme.ts` (an ESLint rule enforces it). CSS-px measures multiplied by `this.ratio` in the renderer.
- Grouped numbers come from `Intl.NumberFormat`; the machine locale prints `1'200`, so a test never asserts a literal grouped digit.
- The Zotero suite (`npm test`) runs once, in Task 9, not per task. It deletes the XPI; `npm run build` is last.
- `shared` is an integer ≥ 1; 1 is off. The rule is inert while the graph has fewer than two seeds, and reads `min(shared, S)`.
- Copy: gear option `Seeds linked`; Key tiers `Cite all {S} seeds` / `Cite {k} of {S} seeds` / `Cite 1 seed` under Citers, `Cited by all {S} seeds` / `Cited by {k} of {S} seeds` / `Cited by 1 seed` under References; Key no-value entry `Not graded`; Key note `Only hop 1 is graded, by the links fetched.`; rail label `Shared by`, field `≥ [N] seeds`, count `{n} below` / `off`.

---

### Task 1: Seed links, counted once

**Files:**

- Create: `src/services/graphSeedLinks.ts`
- Modify: `src/services/graphHopModel.ts` (`SeedMarks`, `EMPTY_SEED_MARKS`, `seedMarks`, `seedMarksWithin`)
- Test: `test/unit/graphSeedLinks.test.ts` (create), `test/unit/graphHopModel.test.ts`

**Interfaces:**

- Produces, from `graphSeedLinks.ts`:
  - `seedLinkCount(entry: { hop: number; parents: readonly string[] }, seedKeys: ReadonlySet<string>): number | undefined` — undefined unless `entry.hop === 1`.
  - `interface SeedLinkSource { of(key: string): number | undefined; seedCount: number; direction: HopDirection }`
  - `seedLinkTierKey(k: number): string` — `links:${k}`.
  - `seedLinkTierLabel(k: number, seedCount: number, direction: HopDirection): string`
  - `seedLinkRampIndex(k: number, seedCount: number, stops: number): number`
  - `seedLinkLabelRank(key: string, marks: Pick<SeedMarks, "seedKeys" | "seedLinks">): number`
- Produces, on `SeedMarks`: `direction: HopDirection` and `seedLinks: ReadonlyMap<string, number>` (hop-1 papers only).

- [ ] **Step 1: Write the failing tests**

Create `test/unit/graphSeedLinks.test.ts`:

```ts
import { describe, it } from "node:test";
import { expect } from "chai";
import {
  seedLinkCount,
  seedLinkLabelRank,
  seedLinkRampIndex,
  seedLinkTierKey,
  seedLinkTierLabel,
} from "../../src/services/graphSeedLinks";

describe("seedLinkCount", function () {
  const seeds = new Set(["s", "t", "u"]);

  it("counts the seeds among a hop-1 paper's parents", function () {
    expect(seedLinkCount({ hop: 1, parents: ["s", "u"] }, seeds)).to.equal(2);
  });

  it("ignores a parent that is not a seed", function () {
    // The walk can give a hop-1 paper a hop-1 parent: an existing entry gains
    // every parent that links to it, whatever its hop (graphHopModel.ts).
    expect(seedLinkCount({ hop: 1, parents: ["s", "a"] }, seeds)).to.equal(1);
  });

  it("has no count for a seed or a deeper paper", function () {
    expect(seedLinkCount({ hop: 0, parents: [] }, seeds)).to.equal(undefined);
    expect(seedLinkCount({ hop: 2, parents: ["s"] }, seeds)).to.equal(
      undefined,
    );
  });
});

describe("seed link tiers", function () {
  it("keys a tier by its count", function () {
    expect(seedLinkTierKey(3)).to.equal("links:3");
  });

  it("names a tier by the direction", function () {
    expect(seedLinkTierLabel(3, 3, "cited-by")).to.equal("Cite all 3 seeds");
    expect(seedLinkTierLabel(2, 3, "cited-by")).to.equal("Cite 2 of 3 seeds");
    expect(seedLinkTierLabel(1, 3, "cited-by")).to.equal("Cite 1 seed");
    expect(seedLinkTierLabel(2, 2, "references")).to.equal(
      "Cited by all 2 seeds",
    );
    expect(seedLinkTierLabel(2, 4, "references")).to.equal(
      "Cited by 2 of 4 seeds",
    );
    expect(seedLinkTierLabel(1, 4, "references")).to.equal("Cited by 1 seed");
  });

  it("puts all S on the ramp's last stop and 1 on its first", function () {
    expect(seedLinkRampIndex(2, 2, 5)).to.equal(4);
    expect(seedLinkRampIndex(1, 2, 5)).to.equal(0);
    expect(seedLinkRampIndex(2, 3, 5)).to.equal(2);
    expect(
      [1, 2, 3, 4, 5, 6].map((k) => seedLinkRampIndex(k, 6, 5)),
    ).to.deep.equal([0, 1, 2, 2, 3, 4]);
  });

  it("clamps a count outside 1..S and a graph with one seed", function () {
    expect(seedLinkRampIndex(9, 3, 5)).to.equal(4);
    expect(seedLinkRampIndex(0, 3, 5)).to.equal(0);
    expect(seedLinkRampIndex(1, 1, 5)).to.equal(4);
  });
});

describe("seedLinkLabelRank", function () {
  const marks = {
    seedKeys: new Set(["s"]),
    seedLinks: new Map([
      ["a", 2],
      ["b", 1],
    ]),
  };

  it("ranks seeds first, then by seed links, then everything else at 0", function () {
    expect(seedLinkLabelRank("s", marks)).to.be.greaterThan(
      seedLinkLabelRank("a", marks),
    );
    expect(seedLinkLabelRank("a", marks)).to.equal(2);
    expect(seedLinkLabelRank("b", marks)).to.equal(1);
    expect(seedLinkLabelRank("deep", marks)).to.equal(0);
  });
});
```

In `test/unit/graphHopModel.test.ts`, inside the describe that holds "builds the seed marks as one record over the merged graph", add:

```ts
it("carries each hop-1 paper's seed links and the direction", function () {
  const s = node("s");
  const t = node("t");
  const walk = buildGraphHopModel({
    seeds: [s, t],
    direction: "cited-by",
    depth: 2,
    // "a" cites both seeds, "b" cites one, "c" is at hop 2.
    neighbours: lookup({ s: ["a", "b"], t: ["a"], a: ["c"] }),
  })!;
  const merged = additiveGraphModel({ nodes: [s, t], edges: [] }, walk);
  const marks = seedMarks(walk, merged, {
    seedColors: new Map(),
    isLibraryPaper: () => false,
  });
  expect(marks.direction).to.equal("cited-by");
  expect(marks.seedLinks.get("a")).to.equal(2);
  expect(marks.seedLinks.get("b")).to.equal(1);
  expect(marks.seedLinks.has("c")).to.equal(false);
  expect(marks.seedLinks.has("s")).to.equal(false);

  const within = seedMarksWithin(marks, new Set(["s", "t", "b"]));
  expect(within.seedLinks.has("a")).to.equal(false);
  expect(within.seedLinks.get("b")).to.equal(1);
  expect(within.direction).to.equal("cited-by");
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx tsc --noEmit -p test`
Expected: errors that `graphSeedLinks` does not exist and that `direction` and `seedLinks` are not on `SeedMarks`.

- [ ] **Step 3: Write the module**

Create `src/services/graphSeedLinks.ts`:

```ts
/**
 * A hop-1 paper's seed links: how many of the reader's seeds it cites, or
 * under References how many cite it (spec: shared citers). Pure, so the scope,
 * the colouring, the Key and the label order read one definition.
 *
 * Only hop 1 has a count. Deeper papers are not graded, and a seed is a seed.
 * The count is of the links the graph holds: a seed's hop-1 list is cut at 50
 * (ADR 0015), so a paper citing two seeds that made one cut reads 1.
 */
import type { HopDirection, SeedMarks } from "./graphHopModel";

/** What the colouring reads, per paper, and what its labels need. */
export interface SeedLinkSource {
  of(key: string): number | undefined;
  seedCount: number;
  direction: HopDirection;
}

/**
 * The seeds among a hop-1 paper's parents. The filter is not redundant: the
 * walk gives an existing entry every parent that links to it, so a hop-1
 * paper can carry a hop-1 parent too.
 */
export function seedLinkCount(
  entry: { hop: number; parents: readonly string[] },
  seedKeys: ReadonlySet<string>,
): number | undefined {
  if (entry.hop !== 1) return undefined;
  return entry.parents.filter((parent) => seedKeys.has(parent)).length;
}

export function seedLinkTierKey(k: number): string {
  return `links:${k}`;
}

export function seedLinkTierLabel(
  k: number,
  seedCount: number,
  direction: HopDirection,
): string {
  const verb = direction === "references" ? "Cited by" : "Cite";
  if (k <= 1) return `${verb} 1 seed`;
  if (k >= seedCount) return `${verb} all ${seedCount} seeds`;
  return `${verb} ${k} of ${seedCount} seeds`;
}

/**
 * The ramp stop a tier takes: all S on the last, 1 on the first. Fixed by k
 * and S alone, so a tier's colour never moves while the fill runs or the
 * floor is dragged.
 */
export function seedLinkRampIndex(
  k: number,
  seedCount: number,
  stops: number,
): number {
  const last = Math.max(0, stops - 1);
  if (seedCount <= 1) return last;
  const clamped = Math.min(seedCount, Math.max(1, k));
  return Math.round(((clamped - 1) / (seedCount - 1)) * last);
}

/**
 * Where a paper sorts among label candidates under the Seeds linked
 * colouring: seeds first, then hop-1 papers by seed links, then the rest.
 */
export function seedLinkLabelRank(
  key: string,
  marks: Pick<SeedMarks, "seedKeys" | "seedLinks">,
): number {
  if (marks.seedKeys.has(key)) return Number.MAX_SAFE_INTEGER;
  return marks.seedLinks.get(key) ?? 0;
}
```

In `src/services/graphHopModel.ts`, import the counter at the top:

```ts
import { seedLinkCount } from "./graphSeedLinks";
```

(`graphSeedLinks.ts` imports only types from `graphHopModel.ts`, so the cycle is type-only.)

Extend `SeedMarks`:

```ts
export interface SeedMarks {
  seedKeys: ReadonlySet<string>;
  /** Each seed's own colour, so the rail's bullseye and the plot's agree. */
  seedColors: ReadonlyMap<string, string>;
  /** Papers a seed reached that the library already holds; not the seeds. */
  inLibraryReachedKeys: ReadonlySet<string>;
  /** Each reached paper's hop; absent means a library paper no hop reached. */
  hops: ReadonlyMap<string, number>;
  citationSequence: ReadonlyMap<string, number>;
  /** The walk's direction, so the Key words a tier as citing or cited by. */
  direction: HopDirection;
  /** Each hop-1 paper's seed links (graphSeedLinks.ts); deeper papers have none. */
  seedLinks: ReadonlyMap<string, number>;
}
```

`EMPTY_SEED_MARKS` gains `direction: "cited-by", seedLinks: new Map(),`.

In `seedMarks`, the returned record gains:

```ts
    direction: model.direction,
    seedLinks: seedLinksOf(model),
```

and add, beside `hopByKey`:

```ts
/** Each hop-1 paper's seed links; the colouring, Key and labels read these. */
export function seedLinksOf(model: GraphHopModel): Map<string, number> {
  const links = new Map<string, number>();
  for (const entry of model.entries.values()) {
    const k = seedLinkCount(entry, model.seedKeys);
    if (k !== undefined) links.set(entry.key, k);
  }
  return links;
}
```

In `seedMarksWithin`, the returned record gains:

```ts
    direction: marks.direction,
    seedLinks: new Map([...marks.seedLinks].filter(([key]) => keep(key))),
```

- [ ] **Step 4: Run the tests**

Run: `npm run test:unit`
Expected: the new `seedLinkCount`, tier, rank and seed-marks cases pass; nothing else changes.

- [ ] **Step 5: Gate and commit**

Run: `npm run check`
Expected: clean.

```bash
git add src/services/graphSeedLinks.ts src/services/graphHopModel.ts test/unit/graphSeedLinks.test.ts test/unit/graphHopModel.test.ts
git commit -m "Seed links: each hop-1 paper's count of seeds, carried on the seed marks"
```

---

### Task 2: The shared rule as step 5 of the scope order

**Files:**

- Modify: `src/services/graphScopeModel.ts` (`GraphScopeInput`, `GraphScopeResult`, `computeGraphScope` and its doc comment)
- Test: `test/unit/graphScopeModel.test.ts`

**Interfaces:**

- Consumes: `seedLinkCount` (Task 1).
- Produces: `GraphScopeInput.shared?: number` (absent or ≤ 1 is off); `GraphScopeResult.belowSharedCount: number`.

- [ ] **Step 1: Write the failing tests**

Append to `test/unit/graphScopeModel.test.ts` (the file's `paper` and `scope` helpers already exist; `paper(key, collectionIDs, inLibrary, citationCount)`):

```ts
describe("computeGraphScope with the shared rule", function () {
  // Seeds s and t. a cites both; b cites s only; c is b's citer at hop 2;
  // d is a's citer at hop 2 and b's as well.
  const hops: GraphScopeHops = {
    entries: new Map([
      ["s", { hop: 0, parents: [] }],
      ["t", { hop: 0, parents: [] }],
      ["a", { hop: 1, parents: ["s", "t"] }],
      ["b", { hop: 1, parents: ["s"] }],
      ["c", { hop: 2, parents: ["b"] }],
      ["d", { hop: 2, parents: ["a", "b"] }],
    ]),
    depth: 2,
    enabled: [true, true, true],
  };
  const papers = ["s", "t", "a", "b", "c", "d"].map((key) =>
    paper(key, [], false, 50),
  );
  const seedKeys = new Set(["s", "t"]);

  it("hides a hop-1 paper with too few seed links, and its only-parent child", function () {
    const result = scope({ papers, seedKeys, hops, shared: 2 });
    expect([...result.visibleKeys].sort()).to.deep.equal(["a", "d", "s", "t"]);
    expect(result.belowSharedCount).to.equal(1);
    expect(result.shownByHop).to.deep.equal([2, 1, 1]);
  });

  it("removes nothing when off or absent", function () {
    expect(
      scope({ papers, seedKeys, hops, shared: 1 }).visibleKeys.size,
    ).to.equal(6);
    expect(scope({ papers, seedKeys, hops }).belowSharedCount).to.equal(0);
  });

  it("reads a value above the seed count as the seed count", function () {
    const result = scope({ papers, seedKeys, hops, shared: 5 });
    expect(result.visibleKeys.has("a")).to.equal(true);
    expect(result.visibleKeys.has("b")).to.equal(false);
  });

  it("is inert with one seed", function () {
    const result = scope({
      papers: papers.filter((p) => p.key !== "t"),
      seedKeys: new Set(["s"]),
      hops,
      shared: 2,
    });
    expect(result.visibleKeys.has("b")).to.equal(true);
    expect(result.belowSharedCount).to.equal(0);
  });

  it("hides a folder-admitted hop-1 paper: its hop decides", function () {
    const result = scope({
      papers: [
        paper("s", [], true, 50),
        paper("t", [], true, 50),
        paper("b", [1], true, 50),
      ],
      seedKeys,
      hops,
      shared: 2,
    });
    expect(result.visibleKeys.has("b")).to.equal(false);
  });

  it("leaves a folder-admitted paper no hop reached alone", function () {
    const result = scope({
      papers: [...papers, paper("lib", [1], true, 50)],
      seedKeys,
      hops,
      shared: 2,
    });
    expect(result.visibleKeys.has("lib")).to.equal(true);
  });

  it("does not count a paper the floor already removed", function () {
    const result = scope({
      papers: papers.map((p) =>
        p.key === "b" ? { ...p, citationCount: 1 } : p,
      ),
      seedKeys,
      hops,
      floor: 10,
      shared: 2,
    });
    expect(result.belowFloorCount).to.equal(1);
    expect(result.belowSharedCount).to.equal(0);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx tsc --noEmit -p test`
Expected: errors that `shared` and `belowSharedCount` do not exist on the types.

- [ ] **Step 3: Implement the rule**

In `src/services/graphScopeModel.ts`, import the counter:

```ts
import { seedLinkCount } from "./graphSeedLinks";
```

Add to `GraphScopeInput`, after `floor`:

```ts
  /**
   * The seed links a hop-1 paper needs to be shown (the shared rule); absent
   * or 1 is off, and a value above the seed count reads as the seed count.
   * Inert with fewer than two seeds. After the floor, so a paper under the
   * floor is not counted twice.
   */
  shared?: number;
```

Add to `GraphScopeResult`, after `belowFloorCount`:

```ts
/** Hop-1 papers the shared rule removed, after every other rule. */
belowSharedCount: number;
```

In `computeGraphScope`, beside `let belowFloorCount = 0;`:

```ts
let belowSharedCount = 0;
const shared =
  input.seedKeys.size >= 2
    ? Math.min(Math.floor(input.shared ?? 1), input.seedKeys.size)
    : 1;
```

After the floor's `continue` block and before `const hopAdmitted =`, insert:

```ts
if (
  shared >= 2 &&
  entry?.hop === 1 &&
  (seedLinkCount(entry, input.seedKeys) ?? 0) < shared
) {
  belowSharedCount += 1;
  continue;
}
```

Add `belowSharedCount,` to the returned object. Extend the doc comment's last paragraph with: "The shared rule comes after it: a hop-1 paper linked to fewer seeds than it asks for is not shown, however it was admitted, since the rule reads the paper's place in the hops."

- [ ] **Step 4: Run the tests**

Run: `npm run test:unit`
Expected: the seven new cases pass, and every older `computeGraphScope` case still does.

- [ ] **Step 5: Gate and commit**

Run: `npm run check`
Expected: clean.

```bash
git add src/services/graphScopeModel.ts test/unit/graphScopeModel.test.ts
git commit -m "The shared rule is step 5 of the scope order, after the floor"
```

---

### Task 3: The Seeds linked colouring and its Key

**Files:**

- Modify: `src/domain/graphTypes.ts:42-50` (`GraphNodeColorMetric`)
- Modify: `src/services/graphCategoryAssignment.ts` (`nodeCategory`, `AssignCategoriesOptions`, `assignCategories`)
- Modify: `src/services/graphKeyModel.ts` (`CATEGORICAL_COLOR_LABELS`, `colorSection`)
- Modify: `src/services/graphViewControls.ts` (the categorical definitions list)
- Modify: `src/services/graphLayoutAvailability.ts` (`colourOptionHasData`)
- Modify: `src/services/dataSourceTooltipService.ts` (the `citation-hop` case group)
- Modify: `src/services/graphRendererScene.ts:153-160` (the ghost's categorical metrics)
- Modify: `src/services/citationGraphRenderer.ts` (`categories()`)
- Test: `test/unit/graphCategoryAssignment.test.ts`, `test/unit/graphKeyModel.test.ts`, `test/unit/citationGraphRendererHops.test.ts`

**Interfaces:**

- Consumes: `SeedLinkSource`, `seedLinkTierKey`, `seedLinkTierLabel`, `seedLinkRampIndex` (Task 1); `SeedMarks.seedLinks`, `SeedMarks.direction` (Task 1).
- Produces: metric value `"seed-links"`; `AssignCategoriesOptions.seedLinks?: SeedLinkSource`; `nodeCategory(node, metric, hopOf?, seedLinks?)`.

- [ ] **Step 1: Write the failing tests**

Append to `test/unit/graphCategoryAssignment.test.ts` (it already has `assignCategories`, `emptySwatchLedger`, `const LIGHT = graphThemeFor("light")` and a `node(key, overrides)` helper):

```ts
describe("the Seeds linked colouring", function () {
  const links = new Map([
    ["a", 2],
    ["b", 1],
    ["c", 1],
  ]);
  const source = {
    of: (key: string) => links.get(key),
    seedCount: 2,
    direction: "cited-by" as const,
  };
  const nodes = ["s", "t", "a", "b", "c", "deep"].map((key) => node(key));

  it("orders tiers highest first and colours them from the ramp", function () {
    const assignment = assignCategories(nodes, "seed-links", LIGHT, {
      ledger: emptySwatchLedger(),
      seedLinks: source,
    });
    expect(assignment.entries.map((e) => [e.label, e.count])).to.deep.equal([
      ["Cite all 2 seeds", 1],
      ["Cite 1 seed", 2],
    ]);
    expect(assignment.entries[0].color).to.equal(LIGHT.ramp[4]);
    expect(assignment.entries[1].color).to.equal(LIGHT.ramp[0]);
    expect(assignment.other).to.equal(null);
  });

  it("names everything without a count Not graded", function () {
    const assignment = assignCategories(nodes, "seed-links", LIGHT, {
      ledger: emptySwatchLedger(),
      seedLinks: source,
    });
    expect(assignment.noValue?.label).to.equal("Not graded");
    expect(assignment.noValue?.count).to.equal(3);
    expect(assignment.labelFor(node("deep"))).to.equal("Not graded");
    expect(assignment.keyFor(node("a"))).to.equal("links:2");
    expect(assignment.colorFor(node("deep"))).to.equal(
      LIGHT.categorical.noValue,
    );
  });

  it("leaves the swatch ledger as it found it", function () {
    const ledger = emptySwatchLedger();
    const assignment = assignCategories(nodes, "seed-links", LIGHT, {
      ledger,
      seedLinks: source,
    });
    expect(assignment.ledger).to.equal(ledger);
  });
});
```

Append to `test/unit/graphKeyModel.test.ts`:

```ts
describe("the Key under Seeds linked", function () {
  it("lists the tiers in the direction's words, then Not graded, with the note", function () {
    const nodes = [node(1), node(2), node(3), node(4)];
    const links = new Map([
      ["k1", 3],
      ["k2", 2],
      ["k3", 1],
    ]);
    const layout = { ...LAYOUT, nodeColorMetric: "seed-links" as const };
    const assignment = assignCategories(nodes, "seed-links", theme, {
      ledger: emptySwatchLedger(),
      seedLinks: {
        of: (key) => links.get(key),
        seedCount: 3,
        direction: "references",
      },
    });
    const model = buildKeyModel({
      layout,
      assignment,
      nodes,
      theme,
      edgeCount: 0,
      states: QUIET,
    });
    const color = model.sections.find((s) => s.kind === "color")!;
    expect(color.subheading).to.equal("Seeds linked");
    expect(color.entries.map((e) => e.label)).to.deep.equal([
      "Cited by all 3 seeds",
      "Cited by 2 of 3 seeds",
      "Cited by 1 seed",
      "Not graded",
    ]);
    expect(color.entries[0].matches!(node(1))).to.equal(true);
    expect(color.entries[0].matches!(node(2))).to.equal(false);
    expect(color.note).to.equal("Only hop 1 is graded, by the links fetched.");
  });
});
```

Append to the first describe of `test/unit/citationGraphRendererHops.test.ts`:

```ts
it("feeds the Seeds linked assignment from the seed marks", function () {
  const renderer = makeRenderer([node("s"), node("t"), node("a")], {
    nodeColorMetric: "seed-links",
  });
  renderer.setSeedMarks(
    {
      ...EMPTY_SEED_MARKS,
      seedKeys: new Set(["s", "t"]),
      hops: new Map([
        ["s", 0],
        ["t", 0],
        ["a", 1],
      ]),
      seedLinks: new Map([["a", 2]]),
      direction: "cited-by",
    },
    false,
  );
  const assignment = renderer.getCategoryAssignment();
  expect(assignment.labelFor(node("a"))).to.equal("Cite all 2 seeds");
  expect(assignment.labelFor(node("s"))).to.equal("Not graded");
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx tsc --noEmit -p test`
Expected: errors that `"seed-links"` is not a `GraphNodeColorMetric` and `seedLinks` is not an option.

- [ ] **Step 3: Implement the colouring**

`src/domain/graphTypes.ts`: add `| "seed-links"` after `| "citation-hop"`.

`src/services/graphCategoryAssignment.ts`:

```ts
import {
  seedLinkRampIndex,
  seedLinkTierKey,
  seedLinkTierLabel,
  type SeedLinkSource,
} from "./graphSeedLinks";
```

`nodeCategory` gains a fourth parameter and a first branch:

```ts
export function nodeCategory(
  node: CitationGraphNode,
  metric: GraphNodeColorMetric,
  hopOf?: (key: string) => number | undefined,
  seedLinks?: SeedLinkSource,
): CategoryRef | null {
  if (metric === "seed-links") {
    const k = seedLinks?.of(node.key);
    if (k === undefined || !seedLinks) return null;
    return {
      key: seedLinkTierKey(k),
      label: seedLinkTierLabel(k, seedLinks.seedCount, seedLinks.direction),
    };
  }
  // ...the existing branches, unchanged
```

`AssignCategoriesOptions` gains, after `hopOf`:

```ts
  /**
   * The Seeds linked colouring's source: each hop-1 paper's seed links, the
   * seed count and the direction, from the seed marks (ADR 0008).
   */
  seedLinks?: SeedLinkSource;
```

At the top of `assignCategories`:

```ts
if (metric === "seed-links") return assignSeedLinkTiers(nodes, theme, options);
```

and below `assignCategories`:

```ts
/**
 * Seeds linked is categorical but ordered: tiers are named highest first and
 * coloured from the theme's sequential ramp by k of S, so a tier's colour is
 * fixed and the swatch ledger is neither read nor moved. No tier collapses
 * into Other; there are at most as many tiers as seeds.
 */
function assignSeedLinkTiers(
  nodes: CitationGraphNode[],
  theme: GraphTheme,
  options: AssignCategoriesOptions,
): CategoryAssignment {
  const source = options.seedLinks;
  const counts = new Map<number, number>();
  let noValueCount = 0;
  for (const node of nodes) {
    const k = source?.of(node.key);
    if (k === undefined) noValueCount += 1;
    else counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const seedCount = source?.seedCount ?? 0;
  const direction = source?.direction ?? "cited-by";
  const entries: CategoryEntry[] = [...counts.entries()]
    .sort((left, right) => right[0] - left[0])
    .map(([k, count]) => ({
      key: seedLinkTierKey(k),
      label: seedLinkTierLabel(k, seedCount, direction),
      count,
      color: theme.ramp[seedLinkRampIndex(k, seedCount, theme.ramp.length)],
    }));
  const colorByKey = new Map(entries.map((entry) => [entry.key, entry.color]));
  const noValue: CategoryEntry | null = noValueCount
    ? {
        key: NO_VALUE_KEY,
        label: NOT_GRADED,
        count: noValueCount,
        color: theme.categorical.noValue,
      }
    : null;
  const ref = (node: CitationGraphNode): CategoryRef | null =>
    nodeCategory(node, "seed-links", options.hopOf, source);
  return {
    metric: "seed-links",
    entries,
    other: null,
    noValue,
    ledger: options.ledger,
    colorFor(node) {
      const found = ref(node);
      return found
        ? (colorByKey.get(found.key) ?? theme.categorical.noValue)
        : theme.categorical.noValue;
    },
    labelFor(node) {
      return ref(node)?.label ?? NOT_GRADED;
    },
    keyFor(node) {
      return ref(node)?.key ?? null;
    },
  };
}
```

with, beside `OTHER_KEY`:

```ts
/** Seeds linked's no-value label: seeds and papers past hop 1 are not graded. */
const NOT_GRADED = "Not graded";
```

`src/services/graphKeyModel.ts`: `CATEGORICAL_COLOR_LABELS` gains `"seed-links": "Seeds linked",`. In `colorSection`'s categorical return, replace `note: null` with:

```ts
    note:
      metric === "seed-links"
        ? "Only hop 1 is graded, by the links fetched."
        : null,
```

`src/services/graphViewControls.ts`: after the `citation-hop` definition:

```ts
    {
      value: "seed-links",
      label: "Seeds linked",
      description:
        "Colour hop-1 papers by how many of your seeds they are linked to.",
      available: colourOptionHasData(nodes, "seed-links"),
    },
```

`src/services/graphLayoutAvailability.ts`: `case "seed-links":` joins `case "citation-hop":` (returns `true`; the view service toggles it by seed count, Task 7).

`src/services/dataSourceTooltipService.ts`: `case "seed-links":` joins the `case "citation-hop":` group.

`src/services/graphRendererScene.ts`: the ghost's categorical condition gains `|| metric === "seed-links"`.

`src/services/citationGraphRenderer.ts`, in `categories()`, the options gain:

```ts
          seedLinks: this.seedMarks
            ? {
                of: (nodeKey) => this.seedMarks?.seedLinks.get(nodeKey),
                seedCount: this.seedMarks.seedKeys.size,
                direction: this.seedMarks.direction,
              }
            : undefined,
```

- [ ] **Step 4: Run the tests**

Run: `npm run test:unit`
Expected: the new assignment, Key and renderer cases pass; every older one still does.

- [ ] **Step 5: Gate and commit**

Run: `npm run check`
Expected: clean.

```bash
git add src/domain/graphTypes.ts src/services/graphCategoryAssignment.ts src/services/graphKeyModel.ts src/services/graphViewControls.ts src/services/graphLayoutAvailability.ts src/services/dataSourceTooltipService.ts src/services/graphRendererScene.ts src/services/citationGraphRenderer.ts test/unit/graphCategoryAssignment.test.ts test/unit/graphKeyModel.test.ts test/unit/citationGraphRendererHops.test.ts
git commit -m "The Seeds linked colouring: tiers from the ramp, named in the Key"
```

---

### Task 4: Seed-coloured edges and the label order

**Files:**

- Modify: `src/services/graphEdgeStyle.ts` (two constants, `seedLinkEdgeColor`)
- Modify: `src/services/citationGraphRenderer.ts` (`drawArrow`, the edge loop, `labelRankFor`)
- Modify: `src/services/graphRendererScene.ts` (`RendererSceneContext.labelRankFor`, `orderLabelCandidates`, `drawRendererLabels`)
- Create: `test/unit/graphRendererScene.test.ts`
- Test: `test/unit/graphEdgeStyle.test.ts`, `test/unit/citationGraphRendererHops.test.ts`

**Interfaces:**

- Consumes: `SeedMarks.seedLinks`, `SeedMarks.seedColors`, `seedLinkLabelRank` (Task 1).
- Produces: `seedLinkEdgeColor(source: string, target: string, marks: Pick<SeedMarks, "seedKeys" | "seedColors" | "seedLinks">): string | null`; `SEED_LINK_EDGE_ALPHA = 0.85`; `SEED_LINK_EDGE_WIDTH_CSS = 1.2`; `orderLabelCandidates(nodes, selectedKey, hoverKey, rankFor): CitationGraphNode[]`.

- [ ] **Step 1: Write the failing tests**

Append to `test/unit/graphEdgeStyle.test.ts`:

```ts
describe("seedLinkEdgeColor", function () {
  const marks = {
    seedKeys: new Set(["s", "t"]),
    seedColors: new Map([
      ["s", "seed-s"],
      ["t", "seed-t"],
    ]),
    seedLinks: new Map([
      ["a", 2],
      ["b", 1],
    ]),
  };

  it("takes the seed's colour on an edge between a shared paper and a seed", function () {
    expect(seedLinkEdgeColor("a", "s", marks)).to.equal("seed-s");
    // Under References the seed is the citer, so the edge runs seed → paper.
    expect(seedLinkEdgeColor("t", "a", marks)).to.equal("seed-t");
  });

  it("is null for a paper linked to one seed, or an edge that misses the seeds", function () {
    expect(seedLinkEdgeColor("b", "s", marks)).to.equal(null);
    expect(seedLinkEdgeColor("a", "b", marks)).to.equal(null);
  });
});
```

(and add `seedLinkEdgeColor` to that file's import from `../../src/services/graphEdgeStyle`).

Create `test/unit/graphRendererScene.test.ts`:

```ts
import { describe, it } from "node:test";
import { expect } from "chai";
import { orderLabelCandidates } from "../../src/services/graphRendererScene";
import { node } from "./graphRendererDoubles";

describe("orderLabelCandidates", function () {
  const nodes = [
    node("low", { citationCount: 900 }),
    node("tier2", { citationCount: 5 }),
    node("seed", { citationCount: 1 }),
    node("picked", { citationCount: 0 }),
  ];
  const rank: Record<string, number> = { tier2: 2, seed: 99 };

  it("puts the selection first, then rank, then citations", function () {
    const ordered = orderLabelCandidates(
      nodes,
      "picked",
      null,
      (key) => rank[key] ?? 0,
    );
    expect(ordered.map((n) => n.key)).to.deep.equal([
      "picked",
      "seed",
      "tier2",
      "low",
    ]);
  });

  it("is today's order when every rank is 0", function () {
    const ordered = orderLabelCandidates(nodes, null, null, () => 0);
    expect(ordered.map((n) => n.key)).to.deep.equal([
      "low",
      "tier2",
      "seed",
      "picked",
    ]);
  });
});
```

Append to the first describe of `test/unit/citationGraphRendererHops.test.ts`:

```ts
it("draws a shared paper's edge to a seed in that seed's colour, only under Seeds linked", function () {
  const graphModel: CitationGraphModel = {
    nodes: [node("s"), node("t"), node("a")],
    edges: [
      {
        key: "a>s",
        source: "a",
        target: "s",
        provenance: "test",
        manual: false,
      },
    ],
    statistics: { nodes: 3, resolvedNodes: 3, edges: 1, isolatedNodes: 1 },
  };
  const marks = {
    ...EMPTY_SEED_MARKS,
    seedKeys: new Set(["s", "t"]),
    seedColors: new Map([
      ["s", "#123456"],
      ["t", "#654321"],
    ]),
    hops: new Map([
      ["s", 0],
      ["t", 0],
      ["a", 1],
    ]),
    seedLinks: new Map([["a", 2]]),
  };
  const strokesUnder = (metric: GraphLayoutOptions["nodeColorMetric"]) => {
    const canvas = new FakeCanvas();
    const renderer = new CitationGraphRenderer({
      canvas: canvas as unknown as HTMLCanvasElement,
      model: graphModel,
      layout: { ...FREE_LAYOUT, nodeColorMetric: metric },
      collectionLabels: new Map(),
      onSelectionChange: () => undefined,
      onOpenNode: () => undefined,
    });
    attachView(canvas);
    renderer.setNodePositions(
      new Map([
        ["s", { x: 400, y: 300 }],
        ["t", { x: 600, y: 300 }],
        ["a", { x: 200, y: 300 }],
      ]),
    );
    canvas.context.calls = [];
    // `setSeedMarks` draws unless told not to; `draw` itself is private.
    renderer.setSeedMarks(marks);
    return canvas.context.calls.filter((call) => call.method === "stroke");
  };
  // Edges draw before nodes, and there is one edge, so the first stroke is
  // its line. A seed's ring is stroked in the seed's colour too, so matching
  // any stroke by colour would find the ring.
  const [linked] = strokesUnder("seed-links");
  expect(linked.strokeStyle, "the edge took seed s's colour").to.equal(
    "#123456",
  );
  // 0.85, times the citer's hop-1 alpha of 0.9.
  expect(linked.globalAlpha).to.be.closeTo(0.765, 1e-9);
  const [plain] = strokesUnder("uniform");
  expect(
    plain.strokeStyle,
    "no seed-coloured edge under another colouring",
  ).to.not.equal("#123456");
});
```

Do not force the draw with `selectNode`: any selection dims every edge that does not touch it, and a dimmed edge is never seed-coloured.

- [ ] **Step 2: Run them to see them fail**

Run: `npx tsc --noEmit -p test`
Expected: errors that `seedLinkEdgeColor` and `orderLabelCandidates` are not exported.

- [ ] **Step 3: Implement**

`src/services/graphEdgeStyle.ts`:

```ts
import type { SeedMarks } from "./graphHopModel";

/** A shared paper's edge to a seed, under Seeds linked (spec: shared citers). */
export const SEED_LINK_EDGE_ALPHA = 0.85;
export const SEED_LINK_EDGE_WIDTH_CSS = 1.2;

/**
 * The seed's colour for an edge between a seed and a hop-1 paper linked to
 * two or more seeds, either way round (the seed is the cited paper under
 * Citers and the citer under References); null for every other edge.
 */
export function seedLinkEdgeColor(
  source: string,
  target: string,
  marks: Pick<SeedMarks, "seedKeys" | "seedColors" | "seedLinks">,
): string | null {
  const seed = marks.seedKeys.has(target)
    ? target
    : marks.seedKeys.has(source)
      ? source
      : null;
  if (seed === null) return null;
  const other = seed === target ? source : target;
  if ((marks.seedLinks.get(other) ?? 0) < 2) return null;
  return marks.seedColors.get(seed) ?? null;
}
```

`src/services/graphRendererScene.ts`: `RendererSceneContext` gains

```ts
  /** Label priority past selection and hover; 0 for all but Seeds linked. */
  labelRankFor(key: string): number;
```

Export the ordering, replacing the inline sort in `drawRendererLabels`:

```ts
/**
 * Label candidates in importance order: selected, hovered, then the
 * colouring's rank (Seeds linked: seeds, then seed links), then citations.
 */
export function orderLabelCandidates(
  nodes: readonly CitationGraphNode[],
  selectedKey: string | null,
  hoverKey: string | null,
  rankFor: (key: string) => number,
): CitationGraphNode[] {
  const priority = (node: CitationGraphNode): number =>
    node.key === selectedKey ? 3 : node.key === hoverKey ? 2 : 1;
  return [...nodes].sort(
    (left, right) =>
      priority(right) - priority(left) ||
      rankFor(right.key) - rankFor(left.key) ||
      (right.citationCount ?? -1) - (left.citationCount ?? -1) ||
      left.key.localeCompare(right.key),
  );
}
```

and in `drawRendererLabels`:

```ts
const ordered = orderLabelCandidates(
  nodes,
  renderer.selectedKey,
  renderer.hoverKey,
  (key) => renderer.labelRankFor(key),
);
```

(`rankFor` subtraction of two `Number.MAX_SAFE_INTEGER` values is 0, and of `MAX_SAFE_INTEGER` and a small k stays positive, so seeds tie with each other and beat every tier.)

`src/services/citationGraphRenderer.ts`: import `seedLinkLabelRank` from `./graphSeedLinks` and `seedLinkEdgeColor`, `SEED_LINK_EDGE_ALPHA`, `SEED_LINK_EDGE_WIDTH_CSS` from `./graphEdgeStyle`. Beside `hopAlphaFor`:

```ts
  /** Seeds linked ranks seeds, then seed links, ahead of citations. */
  public labelRankFor(key: string): number {
    return this.layout.nodeColorMetric === "seed-links" && this.seedMarks
      ? seedLinkLabelRank(key, this.seedMarks)
      : 0;
  }
```

`drawArrow` gains a last parameter `seedLinkColor: string | null = null`, and its alpha, stroke and width become:

```ts
const linked = seedLinkColor !== null && connection === null && !dimmed;
context.globalAlpha =
  (ghosted ? 0.58 : 1) *
  (connection ? 1 : linked ? SEED_LINK_EDGE_ALPHA : Math.max(0, baseOpacity)) *
  emphasis;
// ...
context.strokeStyle = connection
  ? connected
  : linked
    ? seedLinkColor!
    : dimmed
      ? edges.dimmed
      : edges.base;
context.lineWidth =
  (connection ? 2.15 : linked ? SEED_LINK_EDGE_WIDTH_CSS : 1) * ratio;
```

In the edge loop, compute each edge's colour once and sort plain, then seed-linked, then the selection's edges:

```ts
const marks = this.seedMarks;
const seedLinkColorOf = (edge: { source: string; target: string }) =>
  this.layout.nodeColorMetric === "seed-links" && marks
    ? seedLinkEdgeColor(edge.source, edge.target, marks)
    : null;
const edges = [...this.visibleEdges()]
  .map((edge) => ({ edge, seedLink: seedLinkColorOf(edge) }))
  .sort((left, right) => {
    const rank = (entry: {
      edge: { source: string; target: string };
      seedLink: string | null;
    }): number =>
      selectedKey !== null &&
      (entry.edge.source === selectedKey || entry.edge.target === selectedKey)
        ? 2
        : entry.seedLink
          ? 1
          : 0;
    return rank(left) - rank(right);
  });
```

then iterate `for (const { edge, seedLink } of edges)`, pass `reciprocalEdgeKeys(edges.map((entry) => entry.edge))` and `edgeBaseOpacity(edges.length)` as before, and pass `seedLink` as the new last argument to `drawArrow`.

- [ ] **Step 4: Run the tests**

Run: `npm run test:unit`
Expected: the new edge, order and renderer cases pass; the existing "lands the hop ramp" case still reads 0.9 on its edge.

- [ ] **Step 5: Gate and commit**

Run: `npm run check`
Expected: clean.

```bash
git add src/services/graphEdgeStyle.ts src/services/graphRendererScene.ts src/services/citationGraphRenderer.ts test/unit/graphEdgeStyle.test.ts test/unit/graphRendererScene.test.ts test/unit/citationGraphRendererHops.test.ts
git commit -m "Under Seeds linked, a shared paper's edges take its seeds' colours and its label comes first"
```

---

### Task 5: The rail's Shared by row

**Files:**

- Modify: `src/services/graphScopeRailModel.ts` (`ScopeRailModel`, `ScopeSharedRow`, `ScopeRailInput`, `buildScopeRailModel`)
- Modify: `src/services/graphKeyRail.ts` (`ScopeRailHandlers.setShared`, a shared number-row helper, the focus guard)
- Modify: `addon/content/graph.css`
- Modify: `src/services/graphViewService.ts` (the handler stub)
- Modify: `test/zotero/graphVisual.test.ts`, `test/zotero/hostButtonHeight.test.ts` (handlers and the literal model)
- Test: `test/unit/graphScopeRailModel.test.ts`

**Interfaces:**

- Consumes: `GraphScopeResult.belowSharedCount` (Task 2).
- Produces: `ScopeRailInput.shared?: { value: number; seedCount: number }`; `ScopeRailModel.shared: ScopeSharedRow | null`; `interface ScopeSharedRow { value: number; max: number; belowText: string }`; `ScopeRailHandlers.setShared(value: number): void`.

- [ ] **Step 1: Write the failing tests**

Append to `test/unit/graphScopeRailModel.test.ts`:

```ts
describe("the Shared by row", function () {
  it("is absent without two seeds", function () {
    expect(buildScopeRailModel(baseInput()).shared).to.equal(null);
    expect(
      buildScopeRailModel({
        ...baseInput(),
        shared: { value: 2, seedCount: 1 },
      }).shared,
    ).to.equal(null);
  });

  it("prints the value, its ceiling and how many it removed", function () {
    const model = buildScopeRailModel({
      ...baseInput(),
      shared: { value: 2, seedCount: 3 },
      scope: { ...baseInput().scope, belowSharedCount: 4 },
    });
    expect(model.shared).to.deep.equal({
      value: 2,
      max: 3,
      belowText: "4 below",
    });
  });

  it("reads off at 1 and clamps a value above the seed count", function () {
    expect(
      buildScopeRailModel({
        ...baseInput(),
        shared: { value: 1, seedCount: 2 },
      }).shared,
    ).to.deep.equal({ value: 1, max: 2, belowText: "off" });
    expect(
      buildScopeRailModel({
        ...baseInput(),
        shared: { value: 5, seedCount: 2 },
      }).shared?.value,
    ).to.equal(2);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx tsc --noEmit -p test`
Expected: errors that `shared` is not on `ScopeRailInput` or `ScopeRailModel`.

- [ ] **Step 3: Implement the model and the row**

`src/services/graphScopeRailModel.ts`: `ScopeRailModel` gains, after `floor`:

```ts
/** The Shared by row, or null with fewer than two seeds. */
shared: ScopeSharedRow | null;
```

and beside `ScopeFloorRow`:

```ts
/** The Shared by row: the field's value, its ceiling, and the count beside it. */
export interface ScopeSharedRow {
  /** Already clamped to 1..max. */
  value: number;
  /** The seed count. */
  max: number;
  /** `{n} below`, or `off` while the value is 1. */
  belowText: string;
}
```

`ScopeRailInput` gains, after `floor`:

```ts
  /** The shared rule and the seed count; absent on a seedless graph. */
  shared?: { value: number; seedCount: number };
```

In `buildScopeRailModel`'s return, after `floor`:

```ts
    shared:
      input.shared && input.shared.seedCount >= 2
        ? sharedRow(input.shared, input.scope.belowSharedCount)
        : null,
```

with, above `buildScopeRailModel`:

```ts
function sharedRow(
  shared: { value: number; seedCount: number },
  below: number,
): ScopeSharedRow {
  const value = Math.min(
    shared.seedCount,
    Math.max(1, Math.floor(shared.value)),
  );
  return {
    value,
    max: shared.seedCount,
    belowText: value >= 2 ? `${COUNT_FORMAT.format(below)} below` : "off",
  };
}
```

`src/services/graphKeyRail.ts`: import `type ScopeSharedRow`. `ScopeRailHandlers` gains:

```ts
  /** The Shared by field committed a value (Enter or blur). */
  setShared(value: number): void;
```

Replace `floorRowElement` with one helper both rows use, and two thin callers:

```ts
/**
 * A Scope row whose control is a number field: the floor's and the shared
 * rule's. A render that arrives while the field has focus waits for its
 * blur (see `renderScope`).
 */
function numberRowElement(spec: {
  kind: "floor" | "shared";
  label: string;
  value: number;
  min: number;
  max: number | null;
  suffix: string | null;
  countText: string;
  commit: (value: number) => void;
}): HTMLElement {
  const wrapper = element(
    document,
    "div",
    `cm-scope-row cm-scope-${spec.kind}-row`,
  );
  wrapper.append(text(document, "span", spec.label, "cm-scope-row-label"));
  const field = element(document, "label", `cm-scope-${spec.kind}-field`);
  field.append(text(document, "span", "≥"));
  const input = element(
    document,
    "input",
    `cm-scope-${spec.kind}-input`,
  ) as HTMLInputElement;
  input.type = "number";
  input.min = String(spec.min);
  if (spec.max !== null) input.max = String(spec.max);
  input.step = "1";
  input.value = String(spec.value);
  input.setAttribute("aria-label", spec.label);
  const commit = (): void => {
    const parsed = Math.floor(Number(input.value));
    if (
      !Number.isFinite(parsed) ||
      parsed < spec.min ||
      (spec.max !== null && parsed > spec.max)
    ) {
      input.value = String(spec.value);
      return;
    }
    if (parsed !== spec.value) spec.commit(parsed);
    else input.value = String(parsed);
  };
  input.addEventListener("change", commit);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
      input.blur();
    }
  });
  input.addEventListener("blur", () => {
    const pending = pendingScope;
    pendingScope = undefined;
    if (pending !== undefined) rail.renderScope(pending);
  });
  field.append(input);
  if (spec.suffix) field.append(text(document, "span", spec.suffix));
  wrapper.append(
    field,
    text(document, "span", spec.countText, "cm-scope-row-count"),
  );
  return wrapper;
}

function floorRowElement(row: ScopeFloorRow): HTMLElement {
  return numberRowElement({
    kind: "floor",
    label: "Citation floor",
    value: row.value,
    min: 0,
    max: null,
    suffix: null,
    countText: row.belowText,
    commit: (value) => options.onScope.setFloor(value),
  });
}

function sharedRowElement(row: ScopeSharedRow): HTMLElement {
  return numberRowElement({
    kind: "shared",
    label: "Shared by",
    value: row.value,
    min: 1,
    max: row.max,
    suffix: "seeds",
    countText: row.belowText,
    commit: (value) => options.onScope.setShared(value),
  });
}
```

The floor row's `aria-label` stays `Citation floor` and its classes stay `cm-scope-floor-*`, so the Zotero floor case's selectors still hold. In `renderScope`, after `scopeHost.appendChild(floorRowElement(model.floor));`:

```ts
if (model.shared) scopeHost.appendChild(sharedRowElement(model.shared));
```

and the focus guard's condition becomes:

```ts
active.classList.contains("cm-scope-floor-input") ||
  active.classList.contains("cm-scope-shared-input");
```

`addon/content/graph.css`: widen the floor's three rules to the shared row's classes:

```css
.cm-scope-floor-row,
.cm-scope-shared-row {
  margin-top: 8px;
}
.cm-scope-floor-field,
.cm-scope-shared-field {
  /* unchanged body */
}
.cm-scope-floor-input,
.cm-scope-shared-input {
  /* unchanged body */
}
```

`src/services/graphViewService.ts`: the `onScope` handlers gain `setShared: () => undefined,` (Task 7 wires it).

`test/zotero/graphVisual.test.ts` and `test/zotero/hostButtonHeight.test.ts`: every `setFloor: () => undefined,` handler block gains `setShared: () => undefined,`; `HOP_ROW_MODEL` in `hostButtonHeight.test.ts` gains `shared: null,` after its `floor`.

- [ ] **Step 4: Run the tests**

Run: `npm run test:unit`
Expected: the three new row cases pass; the floor row's cases still pass.

- [ ] **Step 5: Gate and commit**

Run: `npm run check`
Expected: clean (the Zotero test files typecheck under the test tsconfig).

```bash
git add src/services/graphScopeRailModel.ts src/services/graphKeyRail.ts addon/content/graph.css src/services/graphViewService.ts test/unit/graphScopeRailModel.test.ts test/zotero/graphVisual.test.ts test/zotero/hostButtonHeight.test.ts
git commit -m "The rail's Scope section gains the Shared by row"
```

---

### Task 6: The rule persists at version 7, travels on views, and Who cites whom is ready

**Files:**

- Modify: `src/services/graphViewState.ts` (version, `shared`, `parseShared`, the version list, the parse)
- Modify: `src/services/graphViews.ts` (`GraphViewExplore`, `GraphViewLiveHops`, `GraphViewNeeds`, Who cites whom, `graphViewIsEdited`, `tutorialChips`, `metricWord`, `COLOUR_METRICS`, `decodeGraphViewRecord`, `captureGraphView`)
- Modify: `src/services/graphViewService.ts` (`liveHops` gains `shared: 1` for now)
- Test: `test/unit/graphViewState.test.ts`, `test/unit/graphViews.test.ts`, `test/unit/graphViewsStore.test.ts`, `test/zotero/graphViews.test.ts`

**Interfaces:**

- Produces: `GraphViewState.shared: number`; `GRAPH_VIEW_STATE_VERSION = 7`; `GraphViewExplore.shared?: number`; `GraphViewLiveHops.shared: number`.

- [ ] **Step 1: Write the failing tests**

`test/unit/graphViewState.test.ts`: in the round-trip fixture `state` (the one with `floor: 25`) add `shared: 2,`. Change both "another version" / "a version it does not know" cases from `version: 7` to `version: 8`, and every `expect(...version).to.equal(6)` in "hops in the state" to `7`. Add beside the floor's cases:

```ts
it("parses a version 6 record with the shared rule off", function () {
  const six = JSON.stringify({ ...state, version: 6, shared: undefined });
  expect(parseGraphViewState(six)?.shared).to.equal(1);
});

it("drops a malformed shared rule to 1 and floors a fraction", function () {
  expect(
    parseGraphViewState(JSON.stringify({ ...state, shared: "two" }))?.shared,
  ).to.equal(1);
  expect(
    parseGraphViewState(JSON.stringify({ ...state, shared: 0 }))?.shared,
  ).to.equal(1);
  expect(
    parseGraphViewState(JSON.stringify({ ...state, shared: 3.7 }))?.shared,
  ).to.equal(3);
});
```

`test/unit/graphViews.test.ts`: `liveHops` gains `shared: 1,`. In "are five, with unique ids…", the `explore` expectation becomes:

```ts
expect(view.explore, view.id).to.deep.equal(
  view.id === "cornerstones"
    ? { direction: "references", hops: 2, floor: 10 }
    : view.id === "who-cites-whom"
      ? { direction: "cited-by", hops: 1, shared: 2 }
      : null,
);
```

In "names what a greyed view waits on…", the Who cites whom availability line is now `null`:

```ts
expect(
  graphViewAvailabilityLine(
    SHIPPED_GRAPH_VIEWS.find((v) => v.id === "who-cites-whom")!,
  ),
).to.equal(null);
```

Add after "decodes, encodes and captures the floor":

```ts
it("decodes, encodes, captures and compares the shared rule", function () {
  const record = JSON.parse(
    encodeGraphView({
      ...SHIPPED_GRAPH_VIEWS[0]!,
      explore: { direction: "cited-by", hops: 1, shared: 2 },
    }),
  );
  expect(record.explore).to.deep.equal({
    direction: "cited-by",
    hops: 1,
    shared: 2,
  });
  const decoded = decodeGraphViewRecord(record);
  expect(decoded.ok && decoded.view.explore?.shared).to.equal(2);
  expect(
    decodeGraphViewRecord({
      ...record,
      explore: { direction: "cited-by", hops: 1, shared: 0 },
    }).ok,
  ).to.equal(false);
  const captured = captureGraphView({
    name: "Mine",
    paragraph: "",
    layout: SHIPPED_GRAPH_VIEWS[0]!.appearance,
    regions: [],
    filters,
    folders,
    hops: { ...liveHops, shared: 3 },
  });
  expect(captured.explore?.shared).to.equal(3);

  const whoCites = SHIPPED_GRAPH_VIEWS.find((v) => v.id === "who-cites-whom")!;
  expect(whoCites.availability).to.equal("ready");
  expect(whoCites.appearance.nodeColorMetric).to.equal("seed-links");
  const live = {
    layout: whoCites.appearance,
    regions: [],
    filters,
    folders,
    nodes,
    hops: { ...liveHops, shared: 2 },
  };
  expect(graphViewIsEdited(whoCites, live)).to.equal(false);
  expect(
    graphViewIsEdited(whoCites, { ...live, hops: { ...live.hops, shared: 1 } }),
  ).to.equal(true);
});
```

In "adds the hops chip…", add:

```ts
const whoCites = SHIPPED_GRAPH_VIEWS.find((v) => v.id === "who-cites-whom")!;
const whoPlan = planGraphView(whoCites, {
  nodes,
  layout: liveLayout,
  filters: defaultPaperListFilterState(),
  folders,
  hops: under,
});
expect(tutorialChips(whoCites, whoPlan, 8)).to.include(
  "hops 1 · citers · shared ≥ 2",
);
```

Wherever that file builds a `GraphViewLiveHops` literal with `floor:` and not from `liveHops`, add `shared: 1`. `test/unit/graphViewsStore.test.ts` and `test/zotero/graphViews.test.ts`: `hops: { direction: "cited-by", depth: 1, enabled: [], floor: 0 }` gains `shared: 1`.

`test/zotero/graphViews.test.ts`, "ignores a click on a greyed view": Who cites whom is ready now, so the greyed example becomes Reading plan:

```ts
// Who cites whom is ready as of Stage 4, so the greyed example is the one
// view still waiting: Reading plan, on reading state.
const row = viewRow("reading-plan");
expect(
  row.getAttribute("aria-disabled"),
  `Reading plan waits on reading state; the row read "${normalize(row.textContent)}"`,
).to.equal("true");
expect(normalize(row.textContent)).to.contain("Arrives with reading state");
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx tsc --noEmit -p test`
Expected: errors that `shared` does not exist on `GraphViewState`, `GraphViewExplore` or `GraphViewLiveHops`.

- [ ] **Step 3: Implement**

`src/services/graphViewState.ts`: `GRAPH_VIEW_STATE_VERSION = 7`. `GraphViewState` gains after `floor`:

```ts
/** The shared rule, 1 when off (spec: shared citers). Since version 7. */
shared: number;
```

`emptyGraphViewState()` gains `shared: 1,`. Beside `parseFloor`:

```ts
/** A stored shared rule: a finite number at or above 1, floored; anything else is off. */
function parseShared(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : 1;
}
```

The accepted versions gain `raw.version !== 6 &&`; the migration comment gains "Version 7 added `shared`."; the parsed record gains `shared: parseShared(raw.shared),` after `floor`.

`src/services/graphViews.ts`:

- `GraphViewNeeds` becomes `"reading-state"`; `NEEDS_LINE` loses its `"shared-citers"` row.
- `GraphViewExplore` doc gains "and an optional `shared`, carried the same way"; the interface gains `shared?: number;`.
- `GraphViewLiveHops` gains `/** The live shared rule, 1 when off. */ shared: number;`.
- Who cites whom becomes:

```ts
  {
    id: "who-cites-whom",
    name: "Who cites whom",
    summary:
      "Seeds linked, 1 hop, shared by 2 or more. Bridges between your seeds.",
    paragraph:
      "One citation step out from your seeds, keeping only the papers that cite at least two of them, coloured by how many they cite, so the bridges between your starting points stand out. Seeds and collections are untouched.",
    icon: "view-who-cites-whom",
    appearance: { ...BASE, nodeColorMetric: "seed-links" },
    regions: null,
    filters: null,
    explore: { direction: "cited-by", hops: 1, shared: 2 },
    requires: "two-seeds",
    availability: "ready",
  },
```

- `graphViewIsEdited`, after the floor check:

```ts
if (
  view.explore.shared !== undefined &&
  live.hops.shared !== view.explore.shared
) {
  return true;
}
```

- `tutorialChips`: the explore chip becomes

```ts
      `hops ${view.explore.hops} · ${view.explore.direction === "references" ? "references" : "citers"}${view.explore.floor ? ` · floor ${view.explore.floor}` : ""}${view.explore.shared && view.explore.shared > 1 ? ` · shared ≥ ${view.explore.shared}` : ""}`,
```

- `metricWord`'s `special` gains `"seed-links": "seeds linked",`; `COLOUR_METRICS` gains `"seed-links",`.
- `decodeGraphViewRecord`, after the floor's check:

```ts
const rawShared = raw.explore.shared;
if (rawShared !== undefined) {
  if (
    typeof rawShared !== "number" ||
    !Number.isFinite(rawShared) ||
    rawShared < 1
  ) {
    return { ok: false, field: "explore.shared" };
  }
}
```

and the built `explore` gains `...(rawShared === undefined ? {} : { shared: Math.floor(rawShared) }),`.

- `captureGraphView`'s `explore` gains `shared: input.hops.shared,`.

`src/services/graphViewService.ts`: `liveHops` gains `shared: 1,` (Task 7 replaces the literal).

- [ ] **Step 4: Run the tests**

Run: `npm run test:unit`
Expected: the new state and view cases pass; the version expectations read 7.

- [ ] **Step 5: Gate and commit**

Run: `npm run check`
Expected: clean.

```bash
git add src/services/graphViewState.ts src/services/graphViews.ts src/services/graphViewService.ts test/unit/graphViewState.test.ts test/unit/graphViews.test.ts test/unit/graphViewsStore.test.ts test/zotero/graphViews.test.ts
git commit -m "The shared rule persists at recipe version 7 and travels on views; Who cites whom is ready"
```

---

### Task 7: The view service holds the shared rule and toggles the colouring

**Files:**

- Modify: `src/services/graphViewService.ts`

**Interfaces:**

- Consumes: everything above.

No unit test reaches `renderGraphView`; Task 9's Zotero case covers this task. Each edit below sits next to its floor counterpart (search for `floor` in the file).

- [ ] **Step 1: The value and its door**

Beside `let floor = 0;`:

```ts
/** The shared rule (spec: shared citers), 1 when off. */
let shared = 1;
```

Beside `setFloor`:

```ts
/** The shared rule from the rail's field or a view. */
const setShared = (value: number): void => {
  const next = Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
  if (next === shared) return;
  shared = next;
  applyFilters();
  notifyStateChange();
};
```

The rail handler: `setShared: (value) => setShared(value),`.

- [ ] **Step 2: Feed it to the scope, the rail, the views and the recipe**

- `applyFilters`'s `computeGraphScope` input: `shared,` after `floor,`.
- The Scope rail input: after `floor,`:

```ts
        shared: hopModel
          ? { value: shared, seedCount: hopModel.seeds.length }
          : undefined,
```

- `liveHops`: `shared,` replaces `shared: 1,`.
- `capturedExplore`: the non-existing branch becomes `{ direction: hopDirection, hops: hopDepth, floor, shared }`, and after `floorPart`:

```ts
const sharedPart =
  explore.shared && explore.shared > 1 ? `, shared ≥ ${explore.shared}` : "";
return `${explore.hops} hop${explore.hops === 1 ? "" : "s"} of ${word}${floorPart}${sharedPart}`;
```

- Applying a view, after the floor's block:

```ts
if (chosen.explore?.shared !== undefined && chosen.explore.shared !== shared) {
  shared = Math.max(1, Math.floor(chosen.explore.shared));
  notifyStateChange();
}
```

- The state record: `shared,` after `floor,`. `applyState` and the initial-state restore: `shared = state.shared;` / `shared = options.initialState.shared;` after their floor lines.

- [ ] **Step 3: Toggle the colouring by seed count**

Seeds linked is offered while the graph has two or more seeds, beside each Citation hop toggle:

- At the startup guard (`if (currentLayout.nodeColorMetric !== "citation-hop")`), add:

```ts
if (currentLayout.nodeColorMetric !== "seed-links") {
  appearance.setColourOptionAvailable("seed-links", false);
}
```

- In `applyHopModel`, after `appearance.setColourOptionAvailable("citation-hop", true);`:

```ts
appearance.setColourOptionAvailable("seed-links", next.seeds.length >= 2);
```

- In the seed-clearing path, after `appearance.setColourOptionAvailable("citation-hop", false);`:

```ts
appearance.setColourOptionAvailable("seed-links", false);
```

- In `seedlessColouring`:

```ts
if (!hopModel) {
  appearance.setColourOptionAvailable("citation-hop", false);
  appearance.setColourOptionAvailable("seed-links", false);
}
```

Disabling the selected option knocks the gear back to Uniform (`setColourOptionAvailable`, `graphViewControls.ts`), which is the spec's fallback when a seed is removed below two.

- [ ] **Step 4: Gate and commit**

Run: `npm run check`
Expected: clean.

```bash
git add src/services/graphViewService.ts
git commit -m "The view service holds the shared rule and offers Seeds linked from two seeds"
```

---

### Task 8: The words: CONTEXT.md, ADR 0017, the spec, the roadmap

**Files:**

- Modify: `CONTEXT.md`
- Create: `docs/adr/0017-the-shared-citer-grade-is-a-colouring.md`
- Modify: `docs/superpowers/specs/2026-09-28-shared-citers-design.md`
- Modify: `docs/superpowers/handoffs/roadmap.md`

- [ ] **Step 1: CONTEXT.md**

The Scope entry becomes: "The rule that decides which papers of the graph are shown: the folder rule, the hop rule, the floor and the shared rule taken together, followed by the reader's filters."

After the Floor entry:

```markdown
**Shared rule**:
The seed links a hop-1 paper needs to be shown, set in the rail; 1 is off.
A hop-1 paper under it is not shown, however it was admitted, and is not
followed by the fill. Inert with fewer than two seeds.
_Avoid_: Only, shared filter
```

Under Citation hops, after Parents:

```markdown
**Seed links**:
The number of seeds among a hop-1 paper's parents: under Citers, the seeds it
cites; under References, the seeds that cite it. Counts only the links the
graph holds. Deeper papers have none.
_Avoid_: shared count, bridge score, k

**Shared paper**:
A hop-1 paper with two or more seed links.
_Avoid_: bridge, shared citer (the Citers case only)
```

- [ ] **Step 2: ADR 0017**

Create `docs/adr/0017-the-shared-citer-grade-is-a-colouring.md`:

```markdown
# The shared-citer grade is a colouring, and Only is a scope rule

A hop-1 paper's seed links show as a categorical colouring, Seeds linked,
whose tiers take the theme's sequential ramp by k of S, so a tier's colour is
fixed while the fill runs. The design's opacity grade was not built: opacity
already carries the hop ramp and emphasis dimming (ADR 0009, D10), and a
third meaning would make all three unreadable. The design's Off/Dim/Only
switch came apart: Dim is choosing the colouring, and Only is the shared
rule, a scope rule after the floor, so the rail counts what it removed and
the fill stops following it as it does at the floor (ADR 0016). k counts the
links the graph holds; a seed's list is cut at 50 (ADR 0015), which
undercounts, and the Key says so (shared-citers spec, 2026-09-28).
```

- [ ] **Step 3: The spec**

In `docs/superpowers/specs/2026-09-28-shared-citers-design.md`, bring the four departures this plan lists at its top into the spec's text: the ramp is `theme.ramp` with stop `round((k − 1) / (S − 1) × 4)` (Decisions' Tier colours row and "The colouring" section; drop `SEED_LINK_RAMP` from the Files list); `GraphScopeInput` gains `shared` only and k comes from the entries ("The rule"); the Key's not-graded line is the no-value entry `Not graded` with the note `Only hop 1 is graded, by the links fetched.` always under the colouring ("The Key", and the Cut undercounts row); the row reads `{n} below` ("The rail row"). Remove the Zotero case's last sentence (the one-seed Who cites whom check): it is the existing two-seed queue, covered by the views suite.

- [ ] **Step 4: The roadmap**

In `docs/superpowers/handoffs/roadmap.md`: tick `shared citers: plan` and `shared citers: implemented, reviewed, merged, XPI built, pushed` (the latter after Task 9); set Next to "the open bugs" or whichever item the user names; append the Manual verification block from the spec under the floor's, prefixed `Shared citers:`; add a Log line `- 2026-10-02: shared citers shipped (ADR 0017); commits <first>..<last>.`

- [ ] **Step 5: Format, gate and commit**

Run: `npx prettier --write CONTEXT.md docs/adr/0017-the-shared-citer-grade-is-a-colouring.md docs/superpowers/specs/2026-09-28-shared-citers-design.md docs/superpowers/handoffs/roadmap.md` then `npm run check`.
Expected: clean.

```bash
git add CONTEXT.md docs/adr/0017-the-shared-citer-grade-is-a-colouring.md docs/superpowers/specs/2026-09-28-shared-citers-design.md docs/superpowers/handoffs/roadmap.md
git commit -m "Seed links and the shared rule in the vocabulary, ADR 0017, and the spec as built"
```

---

### Task 9: The Zotero case, the suite, the build

**Files:**

- Modify: `test/zotero/graphCitationHops.test.ts` (a new block after "with a citation floor (Stage 4)")

The block reuses the floor block's fake-provider pattern (read it whole first: `serve`, `restore`, `untilQuiet`, the `before`/`after` hooks). Differences: two seed items, the fake answers both seeds' citer pages, no floor drag, no Overview (the colouring does not need an axis).

- [ ] **Step 1: Write the case**

Add after the floor block's closing `});`, inside the outer describe:

```ts
describe("with shared citers (Stage 4)", function () {
  const SEED_A = {
    doi: "10.5555/shared.a",
    id: "W950",
    title: `${FIXTURE_TITLE} (shared A)`,
  };
  const SEED_B = {
    doi: "10.5555/shared.b",
    id: "W960",
    title: `${FIXTURE_TITLE} (shared B)`,
  };
  /** W951 cites both seeds; W952 cites A only; W953 cites B only. */
  const CITERS_OF: Record<string, string[]> = {
    W950: ["W951", "W952"],
    W960: ["W951", "W953"],
  };
  let previousKey: unknown = undefined;
  let previousAppearance: unknown = undefined;
  let itemIDs: number[] = [];
  let tabID: string | null = null;
  let realRequest: any = null;

  function work(id: string, doi: string, title: string, year: number): unknown {
    return {
      id: `https://openalex.org/${id}`,
      doi: `https://doi.org/${doi}`,
      display_name: title,
      publication_year: year,
      publication_date: `${year}-01-01`,
      cited_by_count: 10,
      referenced_works_count: 0,
      authorships: [
        {
          author: { id: "https://openalex.org/A1", display_name: "A. Author" },
        },
      ],
      primary_location: null,
    };
  }

  function notFound(): unknown {
    return { status: 404, responseText: "", getResponseHeader: () => null };
  }

  /** Answers from install, as the floor's block does, for the same reason. */
  function serve(): void {
    if (realRequest) return;
    realRequest = Zotero.HTTP.request;
    (Zotero.HTTP as any).request = async (
      method: string,
      url: string,
      options?: unknown,
    ) => {
      if (!PROVIDER_HOST.test(url))
        return realRequest.call(Zotero.HTTP, method, url, options);
      if (!/^https:\/\/api\.openalex\.org\//.test(url)) return notFound();
      const parsed = new URL(url);
      const path = decodeURIComponent(parsed.pathname);
      if (/\/works\/doi/i.test(path)) {
        const seed = [SEED_A, SEED_B].find((s) => path.includes(s.doi));
        return seed
          ? providerAnswer(
              JSON.stringify(work(seed.id, seed.doi, seed.title, 2019)),
            )
          : notFound();
      }
      const filter = parsed.searchParams.get("filter") ?? "";
      const cited = /^cites:(W9\d\d)$/.exec(filter)?.[1];
      const citers = cited ? (CITERS_OF[cited] ?? []) : [];
      return providerAnswer(
        JSON.stringify({
          results: citers.map((id) =>
            work(
              id,
              `10.5555/shared.${id.toLowerCase()}`,
              `Shared paper ${id}`,
              2021,
            ),
          ),
          meta: { count: citers.length },
        }),
      );
    };
  }

  function restore(): void {
    if (!realRequest) return;
    (Zotero.HTTP as any).request = realRequest;
    realRequest = null;
  }

  function keyEntries(): string[] {
    return [...graphRoot().querySelectorAll(".cm-key-entry")].map((entry) =>
      normalize(entry.textContent),
    );
  }

  function sharedInput(): HTMLInputElement {
    const input = graphRoot().querySelector(
      ".cm-scope-shared-input",
    ) as HTMLInputElement | null;
    expect(input, "the Shared by field").to.exist;
    return input!;
  }

  function sharedRowText(): string {
    return normalize(
      graphRoot().querySelector(".cm-scope-shared-row")?.textContent,
    );
  }

  before(async function () {
    this.timeout(240_000);
    previousKey = Zotero.Prefs.get(OPEN_ALEX_KEY_PREF, true);
    Zotero.Prefs.set(OPEN_ALEX_KEY_PREF, "shared-test-key", true);
    previousAppearance = Zotero.Prefs.get(GRAPH_APPEARANCE_PREF, true);
    serve();
    for (const seed of [SEED_A, SEED_B]) {
      const item = new Zotero.Item("journalArticle");
      item.libraryID = Zotero.Libraries.userLibraryID;
      item.setField("title", seed.title);
      item.setField("date", "2019");
      item.setField("DOI", seed.doi);
      itemIDs.push(await item.saveTx());
    }
    tabID = await openNewGraphTab();
    currentTabID = tabID;
    win.Zotero_Tabs.select(tabID);
    const rail = await waitFor(
      () =>
        tabContent(tabID)?.querySelector(".cm-scope-section .cm-scope-count"),
      30_000,
    );
    expect(rail, "the shared tab's Scope section").to.exist;
  });

  after(async function () {
    this.timeout(30_000);
    restore();
    if (previousKey === undefined || previousKey === null)
      Zotero.Prefs.clear(OPEN_ALEX_KEY_PREF, true);
    else Zotero.Prefs.set(OPEN_ALEX_KEY_PREF, previousKey as string, true);
    if (previousAppearance === undefined || previousAppearance === null)
      Zotero.Prefs.clear(GRAPH_APPEARANCE_PREF, true);
    else
      Zotero.Prefs.set(
        GRAPH_APPEARANCE_PREF,
        previousAppearance as string,
        true,
      );
    if (tabID) win.Zotero_Tabs.close(tabID);
    await delay(500);
    tabID = null;
    currentTabID = null;
    for (const id of itemIDs) await Zotero.Items.erase(id);
    itemIDs = [];
  });

  it("colours the paper citing both seeds into the top tier, and the rule keeps only it", async function () {
    this.timeout(180_000);
    (await nodeMenuEntry("Add as seed", SEED_A.title)).click();
    await waitFor(() => hopCounts(1)?.available ?? null, 60_000);
    (await nodeMenuEntry("Add as seed", SEED_B.title)).click();
    const filled = await waitFor(
      () => (hopCounts(1)?.available === 3 ? hopCounts(1) : null),
      60_000,
    );
    expect(filled, `hop 1 read "${hopRowText(1)}"`).to.deep.equal({
      shown: 3,
      available: 3,
    });

    const option = graphRoot().querySelector(
      'option[data-metric="seed-links"]',
    ) as HTMLOptionElement | null;
    expect(option, "the Seeds linked option").to.exist;
    expect(option!.disabled, "offered with two seeds").to.equal(false);
    const select = option!.parentElement as HTMLSelectElement;
    select.value = "seed-links";
    select.dispatchEvent(new win.Event("change", { bubbles: true }));
    const tiers = await waitFor(() => {
      const entries = keyEntries();
      return entries.some((e) => e.startsWith("Cite all 2 seeds"))
        ? entries
        : null;
    }, 10_000);
    expect(tiers, `the Key read: ${keyEntries().join(" | ")}`).to.exist;
    expect(tiers!.find((e) => e.startsWith("Cite all 2 seeds"))).to.include(
      "1",
    );
    expect(tiers!.find((e) => e.startsWith("Cite 1 seed"))).to.include("2");

    const input = sharedInput();
    input.value = "2";
    input.dispatchEvent(new win.Event("change", { bubbles: true }));
    const narrowed = await waitFor(
      () => (hopCounts(1)?.shown === 1 ? hopCounts(1) : null),
      10_000,
    );
    expect(
      narrowed,
      `hop 1 read "${hopRowText(1)}"; the row read "${sharedRowText()}"`,
    ).to.deep.equal({ shown: 1, available: 3 });
    expect(sharedRowText()).to.include("2 below");
  });
});
```

Before running, check every helper the case names exists in the file with that signature (`graphRoot`, `hopCounts`, `hopRowText`, `nodeMenuEntry`, `openNewGraphTab`, `tabContent`, `waitFor`, `delay`, `normalize`, `providerAnswer`, `PROVIDER_HOST`, `OPEN_ALEX_KEY_PREF`, `GRAPH_APPEARANCE_PREF`, `FIXTURE_TITLE`, `currentTabID`, `win`); `normalize` may live in another test file — if it is absent here, use `(text ?? "").replace(/\s+/g, " ").trim()` inline. Run `npx prettier --write test/zotero/graphCitationHops.test.ts`, `npx eslint test/zotero/graphCitationHops.test.ts` and `npm run check` before spending a suite run on it.

- [ ] **Step 2: Run the case alone**

Put a temporary `describe.only` on the new block, wait for any earlier `npm test` task to finish (a second run hits `EBUSY` on `cert9.db`), then run: `npm test 2>&1 | tee "$TEMP/shared-case.log"`
Expected: the one case passes. If it fails, the assertion message carries the evidence (Zotero.debug never reaches the runner log). Remove the `describe.only` once it passes.

- [ ] **Step 3: The full suite**

Run: `npm test 2>&1 | tee "$TEMP/shared-suite.log"`
Expected: 92 passed, 0 failed (91 before, plus this case). The ten live Citation hops cases can fail at `0/0` after exactly 15 s when Semantic Scholar's keyless pool refuses (B74): that is the provider, not a regression, and a second run inside the hour confirms nothing.

- [ ] **Step 4: Commit, merge, build, push**

```bash
git add test/zotero/graphCitationHops.test.ts
git commit -m "A Zotero case: Seeds linked tiers the shared citer, and the shared rule keeps only it"
git checkout main
git merge --ff-only s4-shared-citers
npm run build
git push origin main
```

Then tick the roadmap's implemented row and fill the Log line's commit range (Task 8, Step 4), commit that with `git add docs/superpowers/handoffs/roadmap.md`, and push again. Update the roadmap's Zotero suite section: last full run date and commit, and the clean count of 92.
