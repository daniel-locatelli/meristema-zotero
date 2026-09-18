# Citation Floor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A citation floor: a paper under it is hidden, counted in the rail and not followed by the fill; the reader sets it by dragging a line on the plot or typing in the rail, and it persists with the graph and travels on views.

**Architecture:** The floor is the last step of `computeGraphScope`'s order (`src/services/graphScopeModel.ts`), so hiding, counting and the fill's smaller plan all follow from the one function. A new pure module `src/services/graphFloor.ts` owns the rounding, the line's placement on whichever axis shows citations and the tag's text; the renderer draws from it and reports drags through two callbacks; the view service holds the value and feeds it to the scope, the renderer, the rail and the recipe.

**Tech Stack:** TypeScript, canvas 2D, `node:test` + chai for `test/unit`, the Zotero suite under `test/zotero` (mocha).

Spec: `docs/superpowers/specs/2026-09-18-citation-floor-design.md`. Read it once before any task.

## Global Constraints

- Branch `s4-citation-floor` off `main`; commits in sentence case, no type prefix, staged by path (`git add <paths>`, never `-A`).
- The gate is `npm run check` (prettier over `src`, `test`, `docs`, `README.md`; typecheck of `src` and `test`; the unit suite). Run it before every commit; the plan's test code has never been compiled.
- Colour literals only in `src/services/graphTheme.ts` (an ESLint rule enforces it). CSS-px measures multiplied by `this.ratio` in the renderer.
- Grouped numbers come from `Intl.NumberFormat`; the machine locale prints `1'200`, so a test never asserts a literal grouped digit.
- The Zotero suite (`npm test`) runs once, in Task 8, not per task. It deletes the XPI; `npm run build` is last.
- `floor` is an integer ≥ 0; 0 is off. Copy: rail label `Citation floor`; tag `⇕ floor: ≥ 20 citations · 143 below` / `⇕ floor: off`; rail count `143 below` / `off`.

---

### Task 1: The floor as the last step of the scope order

**Files:**

- Modify: `src/services/graphScopeModel.ts:114-121` (`ScopePaper`), `:137-153` (`GraphScopeInput`), `:155-170` (`GraphScopeResult`), `:190-256` (`computeGraphScope`)
- Modify: `src/services/graphViewService.ts:4092-4116` (`applyFilters` builds the input)
- Test: `test/unit/graphScopeModel.test.ts`

**Interfaces:**

- Produces: `ScopePaper.citationCount: number | null`; `GraphScopeInput.floor: number`; `GraphScopeResult.belowFloorCount: number`.

- [ ] **Step 1: Write the failing tests**

In `test/unit/graphScopeModel.test.ts`, change the `paper` helper and the `scope` helper so every existing case still compiles, then add the floor block:

```ts
function paper(
  key: string,
  collectionIDs: readonly number[] = [],
  inLibrary = true,
  citationCount: number | null = null,
): ScopePaper {
  return { key, collectionIDs, inLibrary, citationCount };
}

function scope(overrides: Partial<GraphScopeInput> = {}): GraphScopeResult {
  return computeGraphScope({
    papers: [],
    seedKeys: new Set(),
    hops: noHops(),
    ticks: allCollectionsTicked(),
    includeUnfiled: true,
    includeExternal: true,
    hiddenKeys: new Set(),
    facetAdmits: () => true,
    floor: 0,
    ...overrides,
  });
}
```

Append at the end of the file:

```ts
describe("computeGraphScope with a floor", function () {
  const hops: GraphScopeHops = {
    entries: new Map([
      ["s", { hop: 0, parents: [] }],
      ["a", { hop: 1, parents: ["s"] }],
      ["b", { hop: 1, parents: ["s"] }],
      ["c", { hop: 2, parents: ["a"] }],
      ["d", { hop: 2, parents: ["a", "b"] }],
    ]),
    depth: 2,
    enabled: [true, true, true],
  };
  const papers = [
    paper("s", [], true, 3),
    paper("a", [], false, 5),
    paper("b", [], false, 40),
    paper("c", [], false, 9),
    paper("d", [], false, 200),
  ];

  it("hides a paper under the floor and its hop-child with it", function () {
    const result = scope({ papers, seedKeys: new Set(["s"]), hops, floor: 10 });
    expect([...result.visibleKeys].sort()).to.deep.equal(["b", "d", "s"]);
    expect(result.belowFloorCount).to.equal(2);
    expect(result.shownByHop).to.deep.equal([1, 1, 1]);
  });

  it("keeps a child whose other parent is above the floor", function () {
    const result = scope({ papers, seedKeys: new Set(["s"]), hops, floor: 10 });
    expect(result.visibleKeys.has("d")).to.equal(true);
  });

  it("never hides a seed", function () {
    const result = scope({
      papers,
      seedKeys: new Set(["s"]),
      hops,
      floor: 1000,
    });
    expect([...result.visibleKeys]).to.deep.equal(["s"]);
  });

  it("hides a folder-admitted library paper under the floor", function () {
    const result = scope({
      papers: [paper("lib", [1], true, 2), paper("top", [1], true, 50)],
      floor: 10,
    });
    expect([...result.visibleKeys]).to.deep.equal(["top"]);
    expect(result.belowFloorCount).to.equal(1);
  });

  it("lets a paper with no count pass", function () {
    const result = scope({
      papers: [paper("unknown", [1], true, null)],
      floor: 10,
    });
    expect([...result.visibleKeys]).to.deep.equal(["unknown"]);
    expect(result.belowFloorCount).to.equal(0);
  });

  it("counts only what the floor removed, not what a facet already hid", function () {
    const result = scope({
      papers: [paper("x", [1], true, 1), paper("y", [1], true, 1)],
      facetAdmits: (key) => key !== "x",
      floor: 10,
    });
    expect(result.belowFloorCount).to.equal(1);
  });

  it("removes nothing at 0", function () {
    const result = scope({ papers, seedKeys: new Set(["s"]), hops, floor: 0 });
    expect(result.visibleKeys.size).to.equal(5);
    expect(result.belowFloorCount).to.equal(0);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx tsc --noEmit -p test`
Expected: errors that `citationCount` and `floor` do not exist on the types.

- [ ] **Step 3: Implement the rule**

In `src/services/graphScopeModel.ts`:

```ts
/** A paper as the scope rules see it. Everything else about it is irrelevant. */
export interface ScopePaper {
  key: string;
  /** The library folders it is filed in. Empty means unfiled or external. */
  collectionIDs: readonly number[];
  /** False for a paper that is not in Zotero. */
  inLibrary: boolean;
  /** What the floor reads; null passes the floor. */
  citationCount: number | null;
}
```

Add to `GraphScopeInput`, after `facetAdmits`:

```ts
/**
 * The citation count a non-seed paper needs to be shown. 0 is off. The last
 * rule of the order, so a paper a facet already hid is not counted below it.
 */
floor: number;
```

Add to `GraphScopeResult`, after `hiddenCount`:

```ts
/** Papers the floor removed: known count under it, after every other rule. */
belowFloorCount: number;
```

In `computeGraphScope`, declare `let belowFloorCount = 0;` beside `hiddenCount`, and after the `facetAdmits` line (`if (!input.facetAdmits(paper.key)) continue;`) insert:

```ts
if (
  input.floor > 0 &&
  paper.citationCount !== null &&
  paper.citationCount < input.floor
) {
  belowFloorCount += 1;
  continue;
}
```

Add `belowFloorCount,` to the returned object. Extend the function's doc comment with one sentence: "The floor is the last rule: it reads a fact about the paper itself and, like the facets, applies to a folder-admitted paper as much as to a citer; a seed is never under it."

In `src/services/graphViewService.ts` `applyFilters`, the papers map gains `citationCount: node.citationCount,` and the input gains `floor: 0,` for now (Task 6 replaces the literal with the live value).

- [ ] **Step 4: Run the tests**

Run: `npm run test:unit -- --test-name-pattern="computeGraphScope"` (or `npm run test:unit`)
Expected: every `computeGraphScope` case passes, including the seven new ones.

- [ ] **Step 5: Gate and commit**

Run: `npm run check`
Expected: clean.

```bash
git add src/services/graphScopeModel.ts src/services/graphViewService.ts test/unit/graphScopeModel.test.ts
git commit -m "The floor is the last step of the scope order"
```

---

### Task 2: The pure floor module and the theme tokens

**Files:**

- Create: `src/services/graphFloor.ts`
- Modify: `src/services/graphTheme.ts:51-65` (`GraphStateTokens`), `:158-165` and `:207-214` (the two `states` literals)
- Test: `test/unit/graphFloor.test.ts` (new), `test/unit/graphTheme.test.ts`

**Interfaces:**

- Produces:
  - `roundFloor(value: number): number`
  - `FloorAxisInput { metric: GraphAxisMetric; scale: GraphScaleType; domain: [number, number] | null }`
  - `FloorLinePlacement { axis: "x" | "y"; world: number }`
  - `floorLinePlacement(x: FloorAxisInput, y: FloorAxisInput, floor: number): FloorLinePlacement | null`
  - `floorAtWorld(axis: "x" | "y", input: FloorAxisInput, world: number): number`
  - `floorTagText(floor: number, below: number): string`
  - `WORLD_PLOT` (`{ left: 105, right: 1030, top: 60, bottom: 675 }`)
  - `theme.states.floorLine`, `theme.states.floorBand` (strings, both schemes)

- [ ] **Step 1: Write the failing tests**

Create `test/unit/graphFloor.test.ts`:

```ts
import { describe, it } from "node:test";
import { expect } from "chai";
import {
  floorAtWorld,
  floorLinePlacement,
  floorTagText,
  roundFloor,
  WORLD_PLOT,
  type FloorAxisInput,
} from "../../src/services/graphFloor";
import { graphThemeFor } from "../../src/services/graphTheme";

const citationsLinear: FloorAxisInput = {
  metric: "citations",
  scale: "linear",
  domain: [0, 100],
};
const citationsLog: FloorAxisInput = {
  metric: "citations",
  scale: "log",
  domain: [1, 1000],
};
const year: FloorAxisInput = {
  metric: "year",
  scale: "linear",
  domain: [1990, 2026],
};

describe("roundFloor", function () {
  it("rounds to the band's step and never below 0", function () {
    expect(roundFloor(0)).to.equal(0);
    expect(roundFloor(-3)).to.equal(0);
    expect(roundFloor(7.4)).to.equal(7);
    expect(roundFloor(19.6)).to.equal(20);
    expect(roundFloor(23)).to.equal(25);
    expect(roundFloor(97)).to.equal(95);
    expect(roundFloor(99)).to.equal(100);
    expect(roundFloor(104)).to.equal(100);
    expect(roundFloor(996)).to.equal(1000);
    expect(roundFloor(1449)).to.equal(1400);
    expect(roundFloor(Number.NaN)).to.equal(0);
  });
});

describe("floorLinePlacement", function () {
  it("puts the floor on Y when Y shows citations", function () {
    const placed = floorLinePlacement(year, citationsLinear, 50);
    expect(placed).to.deep.equal({
      axis: "y",
      world: (WORLD_PLOT.bottom + WORLD_PLOT.top) / 2,
    });
  });

  it("puts the floor on X when only X shows citations", function () {
    const placed = floorLinePlacement(citationsLinear, year, 50);
    expect(placed).to.deep.equal({
      axis: "x",
      world: (WORLD_PLOT.left + WORLD_PLOT.right) / 2,
    });
  });

  it("prefers Y when both axes show citations", function () {
    expect(
      floorLinePlacement(citationsLinear, citationsLinear, 50)?.axis,
    ).to.equal("y");
  });

  it("is null when neither axis shows citations, or the axis has no domain", function () {
    expect(floorLinePlacement(year, year, 50)).to.equal(null);
    expect(
      floorLinePlacement(year, { ...citationsLinear, domain: null }, 50),
    ).to.equal(null);
  });

  it("sits on the bottom edge at off, on a log axis whose domain starts above 0", function () {
    expect(floorLinePlacement(year, citationsLog, 0)?.world).to.equal(
      WORLD_PLOT.bottom,
    );
    expect(floorLinePlacement(year, citationsLog, 1)?.world).to.equal(
      WORLD_PLOT.bottom,
    );
  });

  it("clamps a floor past the domain to the top edge", function () {
    expect(floorLinePlacement(year, citationsLinear, 5000)?.world).to.equal(
      WORLD_PLOT.top,
    );
  });
});

describe("floorAtWorld", function () {
  it("inverts a Y position through the scale and rounds it", function () {
    const middle = (WORLD_PLOT.bottom + WORLD_PLOT.top) / 2;
    expect(floorAtWorld("y", citationsLinear, middle)).to.equal(50);
    // log: halfway between 1 and 1000 is 10^1.5 ≈ 31.6, which rounds to 30.
    expect(floorAtWorld("y", citationsLog, middle)).to.equal(30);
  });

  it("inverts an X position", function () {
    const quarter = WORLD_PLOT.left + (WORLD_PLOT.right - WORLD_PLOT.left) / 4;
    expect(floorAtWorld("x", citationsLinear, quarter)).to.equal(25);
  });

  it("reads 0 at or past the axis edge on every scale", function () {
    expect(floorAtWorld("y", citationsLog, WORLD_PLOT.bottom)).to.equal(0);
    expect(floorAtWorld("y", citationsLog, WORLD_PLOT.bottom + 40)).to.equal(0);
    expect(floorAtWorld("x", citationsLog, WORLD_PLOT.left - 5)).to.equal(0);
    expect(floorAtWorld("y", { ...citationsLog, domain: null }, 300)).to.equal(
      0,
    );
  });
});

describe("floorTagText", function () {
  const grouped = new Intl.NumberFormat(undefined, { useGrouping: true });

  it("names the floor and the count, and reads off at 0", function () {
    expect(floorTagText(0, 0)).to.equal("⇕ floor: off");
    expect(floorTagText(20, 143)).to.equal(
      "⇕ floor: ≥ 20 citations · 143 below",
    );
    expect(floorTagText(1200, 1500)).to.equal(
      `⇕ floor: ≥ ${grouped.format(1200)} citations · ${grouped.format(1500)} below`,
    );
  });
});

describe("the floor's theme tokens", function () {
  it("exist on both schemes", function () {
    for (const scheme of ["light", "dark"] as const) {
      const states = graphThemeFor(scheme).states;
      expect(states.floorLine, scheme).to.be.a("string").and.not.empty;
      expect(states.floorBand, scheme).to.be.a("string").and.not.empty;
    }
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx tsc --noEmit -p test`
Expected: `Cannot find module '../../src/services/graphFloor'` and `floorLine` missing on `GraphStateTokens`.

- [ ] **Step 3: Write the module and the tokens**

Create `src/services/graphFloor.ts`:

```ts
/**
 * The citation floor's pure half: how a dragged value rounds, where the line
 * sits on the plot, what its tag says. The renderer draws from this and the
 * view service holds the value; neither decides anything the other needs.
 */
import type { GraphAxisMetric, GraphScaleType } from "../domain/graphTypes";
import { clamp, inverseScaleValue, scaleValue } from "./graphMetricScale";

/**
 * The plot's box in world units. The renderer and its scene each keep the
 * same four numbers; a fourth copy is the price of keeping this module free
 * of the renderer.
 */
export const WORLD_PLOT = {
  left: 105,
  right: 1030,
  top: 60,
  bottom: 675,
} as const;

const COUNT_FORMAT = new Intl.NumberFormat(undefined, { useGrouping: true });

/**
 * A dragged floor reads as a round number: integers under 20, fives to 100,
 * tens to 1,000, hundreds past that. Never below 0.
 */
export function roundFloor(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const step = value < 20 ? 1 : value < 100 ? 5 : value < 1000 ? 10 : 100;
  return Math.max(0, Math.round(value / step) * step);
}

export interface FloorAxisInput {
  metric: GraphAxisMetric;
  scale: GraphScaleType;
  /** The axis's full domain, or null when the axis has none to show. */
  domain: [number, number] | null;
}

export interface FloorLinePlacement {
  axis: "x" | "y";
  /** The line's world coordinate on that axis: a y for "y", an x for "x". */
  world: number;
}

function showsCitations(input: FloorAxisInput): input is FloorAxisInput & {
  domain: [number, number];
} {
  return input.metric === "citations" && input.domain !== null;
}

/**
 * Where the line goes: on Y when Y shows citations, else on X when X does,
 * else nowhere. A floor under the domain (0 on any scale, 1 on a log axis
 * starting at 1) sits on the axis edge; one past it sits on the far edge.
 */
export function floorLinePlacement(
  x: FloorAxisInput,
  y: FloorAxisInput,
  floor: number,
): FloorLinePlacement | null {
  const axis = showsCitations(y) ? "y" : showsCitations(x) ? "x" : null;
  if (axis === null) return null;
  const input = axis === "y" ? y : x;
  const domain = input.domain as [number, number];
  const t =
    floor <= 0
      ? 0
      : clamp(scaleValue(floor, domain[0], domain[1], input.scale), 0, 1);
  return axis === "y"
    ? {
        axis,
        world: WORLD_PLOT.bottom - t * (WORLD_PLOT.bottom - WORLD_PLOT.top),
      }
    : {
        axis,
        world: WORLD_PLOT.left + t * (WORLD_PLOT.right - WORLD_PLOT.left),
      };
}

/**
 * The floor a pointer asks for at a world coordinate on the line's axis. At
 * or past the axis edge it is 0 on every scale: a log domain starting at 1
 * could otherwise never reach off.
 */
export function floorAtWorld(
  axis: "x" | "y",
  input: FloorAxisInput,
  world: number,
): number {
  const t =
    axis === "y"
      ? (WORLD_PLOT.bottom - world) / (WORLD_PLOT.bottom - WORLD_PLOT.top)
      : (world - WORLD_PLOT.left) / (WORLD_PLOT.right - WORLD_PLOT.left);
  if (t <= 0 || input.domain === null) return 0;
  return roundFloor(
    inverseScaleValue(clamp(t, 0, 1), input.domain, input.scale),
  );
}

/** The handle tag's text, also the canvas title while the tag is hovered. */
export function floorTagText(floor: number, below: number): string {
  if (floor <= 0) return "⇕ floor: off";
  return `⇕ floor: ≥ ${COUNT_FORMAT.format(floor)} citations · ${COUNT_FORMAT.format(below)} below`;
}
```

In `src/services/graphTheme.ts`, add to `GraphStateTokens` after `uniformFill`:

```ts
/** The citation floor's dashed line and its handle tag's border. */
floorLine: string;
/** The band over the plot's hidden side, under the floor. */
floorBand: string;
```

Light `states` gains `floorLine: "#2563eb", floorBand: "rgba(27, 29, 25, .06)",`; dark `states` gains `floorLine: "#8fb8ff", floorBand: "rgba(0, 0, 0, .28)",`.

- [ ] **Step 4: Run the tests**

Run: `npm run test:unit`
Expected: the new file's cases pass; `test/unit/graphTheme.test.ts` and `graphPalette.test.ts` still pass (they validate swatches and seeds, not states).

- [ ] **Step 5: Gate and commit**

Run: `npm run check`

```bash
git add src/services/graphFloor.ts src/services/graphTheme.ts test/unit/graphFloor.test.ts
git commit -m "The floor's rounding, placement and tag, and its two theme tokens"
```

---

### Task 3: The renderer draws the floor and takes the drag

**Files:**

- Modify: `src/services/citationGraphRenderer.ts` — options (`:118-149`), fields (`:290-299`), pointer handlers (`:652-774`), draw order (`:1647-1652`), a new `drawFloor` beside `drawNoDataLane`, a public `labelObstacles()` and `setFloor()`
- Modify: `src/services/graphRendererScene.ts:40-82` (`RendererSceneContext`), `:602-613` (obstacles)
- Test: `test/unit/citationGraphRendererFloor.test.ts` (new)

**Interfaces:**

- Consumes: Task 2's `floorLinePlacement`, `floorAtWorld`, `floorTagText`, `theme.states.floorLine/floorBand`; `LabelRectangle` from `graphLabelBudget.ts`.
- Produces:
  - `CitationGraphRendererOptions.onFloorChange?: (floor: number) => void` and `onFloorDragEnd?: () => void`
  - `renderer.setFloor(floor: number, below: number, draw = true): void`
  - `renderer.labelObstacles(): LabelRectangle[]` (public; the scene reads it)
  - `RendererSceneContext.labelObstacles(): LabelRectangle[]`

- [ ] **Step 1: Write the failing tests**

Create `test/unit/citationGraphRendererFloor.test.ts`:

```ts
import { describe, it } from "node:test";
import { expect } from "chai";
import { CitationGraphRenderer } from "../../src/services/citationGraphRenderer";
import type {
  CitationGraphNode,
  GraphLayoutOptions,
} from "../../src/domain/graphTypes";
import {
  attachView,
  FakeCanvas,
  FREE_LAYOUT,
  model,
  node,
} from "./graphRendererDoubles";
import { floorAtWorld, floorTagText } from "../../src/services/graphFloor";

/**
 * The floor line, its tag, and the drag. The fake canvas is 800×600 with the
 * plot's world box projected 1:1 (transform x 0, y 0, scale 1 after
 * `setViewTransform`), so a world y is a client y.
 */
describe("CitationGraphRenderer floor", function () {
  const CITATIONS_Y: Partial<GraphLayoutOptions> = {
    xMetric: "year",
    yMetric: "citations",
  };

  function papers(): CitationGraphNode[] {
    return [
      node("low", { year: 2000, citationCount: 0 }),
      node("mid", { year: 2010, citationCount: 50 }),
      node("high", { year: 2020, citationCount: 100 }),
    ];
  }

  function makeRenderer(
    layoutOverrides: Partial<GraphLayoutOptions>,
    hooks: {
      onFloorChange?: (floor: number) => void;
      onFloorDragEnd?: () => void;
    } = {},
  ): { renderer: CitationGraphRenderer; canvas: FakeCanvas } {
    const canvas = new FakeCanvas();
    const renderer = new CitationGraphRenderer({
      canvas: canvas as unknown as HTMLCanvasElement,
      model: model(papers()),
      layout: { ...FREE_LAYOUT, ...layoutOverrides },
      collectionLabels: new Map(),
      onSelectionChange: () => undefined,
      onOpenNode: () => undefined,
      ...hooks,
    });
    attachView(canvas);
    renderer.setViewTransform({ x: 0, y: 0, scale: 1 });
    return { renderer, canvas };
  }

  function tagTexts(canvas: FakeCanvas): string[] {
    return canvas.context.calls
      .filter((call) => call.method === "fillText")
      .map((call) => String(call.args[0]))
      .filter((text) => text.startsWith("⇕ floor"));
  }

  it("draws the tag only when an axis shows citations", function () {
    const withY = makeRenderer(CITATIONS_Y);
    withY.renderer.setFloor(20, 1);
    expect(tagTexts(withY.canvas)).to.include(floorTagText(20, 1));

    const withoutY = makeRenderer({ xMetric: "year", yMetric: "year" });
    withoutY.renderer.setFloor(20, 1);
    expect(tagTexts(withoutY.canvas)).to.be.empty;
    expect(withoutY.renderer.labelObstacles()).to.be.empty;
  });

  it("offers the tag's rectangle as a label obstacle", function () {
    const { renderer } = makeRenderer(CITATIONS_Y);
    renderer.setFloor(20, 1);
    const [tag] = renderer.labelObstacles();
    expect(tag).to.exist;
    expect(tag.right).to.be.greaterThan(tag.left);
    expect(tag.bottom).to.be.greaterThan(tag.top);
  });

  it("reports rounded values through a drag and one drag end", function () {
    const changes: number[] = [];
    let ends = 0;
    const { renderer, canvas } = makeRenderer(CITATIONS_Y, {
      onFloorChange: (floor) => changes.push(floor),
      onFloorDragEnd: () => (ends += 1),
    });
    renderer.setFloor(0, 0);
    const [tag] = renderer.labelObstacles();
    const grab = {
      clientX: (tag.left + tag.right) / 2,
      clientY: (tag.top + tag.bottom) / 2,
    };
    canvas.fire("pointerdown", { button: 0, pointerId: 1, ...grab });
    expect(canvas.style.cursor).to.equal("ns-resize");
    // Halfway up the plot's world box (675 → 60), under the identity camera,
    // is client y 367.5. The axis pads its domain to round ticks, so the
    // expected value is read back through the same inversion the drag uses.
    const domain = renderer.axisScale(papers(), "y")!.domain;
    const expected = floorAtWorld(
      "y",
      { metric: "citations", scale: "linear", domain },
      367.5,
    );
    expect(expected).to.be.greaterThan(0);
    canvas.fire("pointermove", {
      pointerId: 1,
      clientX: grab.clientX,
      clientY: 367.5,
    });
    canvas.fire("pointermove", {
      pointerId: 1,
      clientX: grab.clientX,
      clientY: 367.5,
    });
    canvas.fire("pointerup", {
      pointerId: 1,
      clientX: grab.clientX,
      clientY: 367.5,
    });
    expect(changes, "one change per new value, not per move").to.deep.equal([
      expected,
    ]);
    expect(ends).to.equal(1);
  });

  it("reads 0 past the bottom edge", function () {
    const changes: number[] = [];
    const { renderer, canvas } = makeRenderer(
      { ...CITATIONS_Y, yScale: "log" },
      { onFloorChange: (floor) => changes.push(floor) },
    );
    renderer.setFloor(30, 1);
    const [tag] = renderer.labelObstacles();
    const grab = {
      clientX: (tag.left + tag.right) / 2,
      clientY: (tag.top + tag.bottom) / 2,
    };
    canvas.fire("pointerdown", { button: 0, pointerId: 1, ...grab });
    canvas.fire("pointermove", {
      pointerId: 1,
      clientX: grab.clientX,
      clientY: 700,
    });
    canvas.fire("pointerup", {
      pointerId: 1,
      clientX: grab.clientX,
      clientY: 700,
    });
    expect(changes).to.deep.equal([0]);
  });

  it("lets a node win over the bare line, and the tag win over a node", function () {
    const selected: string[] = [];
    const changes: number[] = [];
    const canvas = new FakeCanvas();
    const renderer = new CitationGraphRenderer({
      canvas: canvas as unknown as HTMLCanvasElement,
      model: model(papers()),
      layout: { ...FREE_LAYOUT, ...CITATIONS_Y },
      collectionLabels: new Map(),
      onSelectionChange: (node) => selected.push(node?.key ?? "none"),
      onOpenNode: () => undefined,
      onFloorChange: (floor) => changes.push(floor),
    });
    attachView(canvas);
    renderer.setViewTransform({ x: 0, y: 0, scale: 1 });
    // The floor is put exactly through "mid", so the line and the node share a y.
    const mid = renderer.positionOf("mid");
    expect(mid).to.exist;
    const domain = renderer.axisScale(papers(), "y")!.domain;
    renderer.setFloor(
      floorAtWorld(
        "y",
        { metric: "citations", scale: "linear", domain },
        mid!.y,
      ),
      1,
    );
    canvas.fire("pointerdown", {
      button: 0,
      pointerId: 1,
      clientX: mid!.x,
      clientY: mid!.y,
    });
    canvas.fire("pointerup", {
      pointerId: 1,
      clientX: mid!.x,
      clientY: mid!.y,
    });
    expect(selected).to.deep.equal(["mid"]);
    expect(changes).to.be.empty;
  });

  it("names the tag in the canvas title while it is hovered", function () {
    const { renderer, canvas } = makeRenderer(CITATIONS_Y);
    renderer.setFloor(20, 3);
    const [tag] = renderer.labelObstacles();
    canvas.fire("pointermove", {
      clientX: (tag.left + tag.right) / 2,
      clientY: (tag.top + tag.bottom) / 2,
    });
    expect(canvas.title).to.equal(floorTagText(20, 3));
    expect(canvas.style.cursor).to.equal("ns-resize");
    canvas.fire("pointermove", { clientX: 5, clientY: 5 });
    expect(canvas.title).to.equal("");
  });
});
```

`setViewTransform`, `positionOf` and `axisScale` are public on the renderer today (`citationGraphRenderer.ts:2097`, `:396`; `positionOf` is used at `citationGraphRendererHops.test.ts:252`).

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx tsc --noEmit -p test`
Expected: `setFloor`, `labelObstacles`, `onFloorChange` unknown.

- [ ] **Step 3: Implement the renderer side**

In `src/services/citationGraphRenderer.ts`:

Imports:

```ts
import {
  floorAtWorld,
  floorLinePlacement,
  floorTagText,
  type FloorAxisInput,
  type FloorLinePlacement,
} from "./graphFloor";
import type { LabelRectangle } from "./graphLabelBudget";
```

Options, after `onThemeChange`:

```ts
  /** The floor's tag or line was dragged to a new rounded value. */
  onFloorChange?: (floor: number) => void;
  /** The drag released; the owner re-plans the fill once here. */
  onFloorDragEnd?: () => void;
```

Fields, after `pointer`:

```ts
  private readonly onFloorChange: (floor: number) => void;
  private readonly onFloorDragEnd: () => void;
  private floor = 0;
  private floorBelow = 0;
  /** Where the last frame drew the line, or null when no axis shows citations. */
  private floorPlacement: FloorLinePlacement | null = null;
  private floorAxisInput: FloorAxisInput | null = null;
  /** The line's screen coordinate on its axis, device pixels, for the hit test. */
  private floorLineScreen: number | null = null;
  /** The tag's rectangle in device pixels; a label obstacle and the grab. */
  private floorTagRect: LabelRectangle | null = null;
  private floorDragging = false;
  private floorHovered = false;
```

Constructor, after `this.onThemeChange = ...`:

```ts
this.onFloorChange = options.onFloorChange ?? (() => undefined);
this.onFloorDragEnd = options.onFloorDragEnd ?? (() => undefined);
```

Public methods, beside `setRegions`:

```ts
  /** The floor and how many papers sit under it; the tag prints both. */
  public setFloor(floor: number, below: number, draw = true): void {
    this.floor = Math.max(0, Math.floor(floor));
    this.floorBelow = Math.max(0, below);
    if (draw) this.draw();
  }

  /** Rectangles no label may sit under: the floor's tag, when drawn. */
  public labelObstacles(): LabelRectangle[] {
    return this.floorTagRect ? [this.floorTagRect] : [];
  }

  /** What the pointer is over, floor-wise: the tag, the bare line, or nothing. */
  private floorHit(clientX: number, clientY: number): "tag" | "line" | null {
    if (!this.floorPlacement || this.floorLineScreen === null) return null;
    const rect = this.canvas.getBoundingClientRect();
    const ratio = devicePixelScale(this.canvas.width, rect.width);
    const x = (clientX - rect.left) * ratio;
    const y = (clientY - rect.top) * ratio;
    const tag = this.floorTagRect;
    if (tag && x >= tag.left && x <= tag.right && y >= tag.top && y <= tag.bottom) {
      return "tag";
    }
    const plot = this.plotRect();
    const tolerance = 5 * ratio;
    if (this.floorPlacement.axis === "y") {
      const onLine = Math.abs(y - this.floorLineScreen) <= tolerance;
      return onLine && x >= plot.left && x <= plot.right ? "line" : null;
    }
    const onLine = Math.abs(x - this.floorLineScreen) <= tolerance;
    return onLine && y >= plot.top && y <= plot.bottom ? "line" : null;
  }

  private floorCursor(): string {
    return this.floorPlacement?.axis === "x" ? "ew-resize" : "ns-resize";
  }

  private beginFloorDrag(event: PointerEvent): void {
    this.floorDragging = true;
    this.pointer = {
      down: true,
      panning: false,
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      draggedKey: null,
    };
    this.canvas.style.cursor = this.floorCursor();
  }

  private dragFloorTo(event: PointerEvent): void {
    if (!this.floorPlacement || !this.floorAxisInput) return;
    const world = this.screenToWorld(event.clientX, event.clientY);
    const axis = this.floorPlacement.axis;
    const value = floorAtWorld(axis, this.floorAxisInput, axis === "y" ? world.y : world.x);
    if (value === this.floor) return;
    this.floor = value;
    this.onFloorChange(value);
  }
```

`onPointerDown` becomes:

```ts
  private onPointerDown = (event: PointerEvent): void => {
    // A right button belongs to the context menu: it must neither pan, drag nor clear the selection.
    if (event.button !== 0) return;
    this.markViewAdjusted();
    this.canvas.setPointerCapture?.(event.pointerId);
    // The tag always grabs the floor; a node wins over the bare line.
    const floorHit = this.floorHit(event.clientX, event.clientY);
    if (floorHit === "tag") return this.beginFloorDrag(event);
    const world = this.screenToWorld(event.clientX, event.clientY);
    const node = this.hitTest(world.x, world.y);
    if (!node && floorHit === "line") return this.beginFloorDrag(event);
    const canDragNode = Boolean(
      node &&
      (this.layout.xMetric === "free" || this.layout.yMetric === "free"),
    );
    this.pointer = {
      down: true,
      panning: !node,
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      draggedKey: canDragNode ? node!.key : null,
    };
    if (node) {
      this.selectedKey = node.key;
      this.onSelectionChange(node);
      this.draw();
    }
  };
```

At the top of `onPointerMove`, before the node-drag branch:

```ts
if (this.pointer.down && this.floorDragging) {
  this.dragFloorTo(event);
  return;
}
```

In `onPointerMove`'s hover branch, replace the block from `const world = this.screenToWorld(...)` to the end with:

```ts
const floorHit = this.floorHit(event.clientX, event.clientY);
const world = this.screenToWorld(event.clientX, event.clientY);
// The tag is over the plot; the bare line yields to a node under it.
const node = floorHit === "tag" ? null : this.hitTest(world.x, world.y);
const overFloor = floorHit === "tag" || (floorHit === "line" && !node);
const key = node?.key ?? null;
if (key !== this.hoverKey || overFloor !== this.floorHovered) {
  this.hoverKey = key;
  this.floorHovered = overFloor;
  this.onHoverChange(key);
  this.canvas.style.cursor = overFloor
    ? this.floorCursor()
    : node
      ? this.layout.xMetric === "free" || this.layout.yMetric === "free"
        ? "move"
        : "pointer"
      : "grab";
  this.canvas.title = overFloor
    ? floorTagText(this.floor, this.floorBelow)
    : node
      ? this.tooltipForNode(node)
      : "";
  this.draw();
}
```

At the top of `onPointerUp`, after `releasePointerCapture`:

```ts
if (this.floorDragging) {
  this.floorDragging = false;
  this.pointer.down = false;
  this.canvas.style.cursor = "grab";
  this.onFloorDragEnd();
  return;
}
```

Register the same for `pointercancel` if it is not already routed to `onPointerUp` (check `installEvents`, `:507-515`).

The drawing, beside `drawNoDataLane`:

```ts
  /**
   * The citation floor: a dashed line across the plot on the axis that shows
   * citations, a band over the hidden side, and a handle tag at the line's
   * left (Y) or bottom (X) end. Drawn after the backdrop and before the
   * regions, so the band sits under everything the reader can point at. The
   * tag's rectangle is kept for the hit test and as a label obstacle.
   */
  private drawFloor(
    plot: PlotRect,
    xScale: AxisScale | null,
    yScale: AxisScale | null,
  ): void {
    const x: FloorAxisInput = {
      metric: this.layout.xMetric,
      scale: this.layout.xScale,
      domain: xScale?.domain ?? null,
    };
    const y: FloorAxisInput = {
      metric: this.layout.yMetric,
      scale: this.layout.yScale,
      domain: yScale?.domain ?? null,
    };
    const placement = floorLinePlacement(x, y, this.floor);
    this.floorPlacement = placement;
    this.floorAxisInput = placement ? (placement.axis === "y" ? y : x) : null;
    this.floorLineScreen = null;
    this.floorTagRect = null;
    if (!placement) return;

    const context = this.context;
    const ratio = this.ratio;
    const screen =
      placement.axis === "y"
        ? this.projectToScreen({ x: 0, y: placement.world }).y
        : this.projectToScreen({ x: placement.world, y: 0 }).x;
    this.floorLineScreen = screen;
    const onPlot =
      placement.axis === "y"
        ? screen >= plot.top && screen <= plot.bottom
        : screen >= plot.left && screen <= plot.right;
    if (!onPlot) return;

    context.save();
    context.beginPath();
    context.rect(plot.left, plot.top, plot.width, plot.height);
    context.clip();
    context.fillStyle = this.theme.states.floorBand;
    if (placement.axis === "y") {
      context.fillRect(plot.left, screen, plot.width, plot.bottom - screen);
    } else {
      context.fillRect(plot.left, plot.top, screen - plot.left, plot.height);
    }
    context.strokeStyle = this.theme.states.floorLine;
    context.lineWidth = Math.max(1, 1.2 * ratio);
    context.setLineDash([4 * ratio, 4 * ratio]);
    context.beginPath();
    if (placement.axis === "y") {
      context.moveTo(plot.left, screen);
      context.lineTo(plot.right, screen);
    } else {
      context.moveTo(screen, plot.top);
      context.lineTo(screen, plot.bottom);
    }
    context.stroke();
    context.setLineDash([]);

    const size = Math.round(10.5 * ratio);
    context.font = `${size}px ${this.fontStack}`;
    const label = floorTagText(this.floor, this.floorBelow);
    const padX = 8 * ratio;
    const padY = 3 * ratio;
    const width = context.measureText(label).width + padX * 2;
    const height = size + padY * 2;
    const left =
      placement.axis === "y" ? plot.left + 8 * ratio : screen + 8 * ratio;
    const top =
      placement.axis === "y"
        ? screen + 8 * ratio
        : plot.bottom - 8 * ratio - height;
    context.fillStyle = this.theme.surfaces.panel;
    context.fillRect(left, top, width, height);
    context.lineWidth = Math.max(1, ratio);
    context.strokeRect(left, top, width, height);
    context.fillStyle = this.theme.inks.primary;
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillText(label, left + padX, top + height / 2);
    context.restore();
    this.floorTagRect = { left, right: left + width, top, bottom: top + height };
  }
```

In `draw()`, replace `this.drawRegions(plot);` with:

```ts
if (framed) this.drawFloor(plot, xScale, yScale);
else {
  this.floorPlacement = null;
  this.floorAxisInput = null;
  this.floorLineScreen = null;
  this.floorTagRect = null;
}
this.drawRegions(plot);
```

In `src/services/graphRendererScene.ts`, add to `RendererSceneContext` after `emphasisAlphaFor`:

```ts
  /** Rectangles in device pixels no label may cover: the floor's tag. */
  labelObstacles(): LabelRectangle[];
```

(import `LabelRectangle` from `./graphLabelBudget` if the file imports only functions from it). In `drawRendererLabels`, after the node-rectangle loop (`:603-613`):

```ts
for (const rectangle of renderer.labelObstacles()) obstacles.insert(rectangle);
```

Every other object typed as `RendererSceneContext` in `test/unit` (grep `RendererSceneContext` in `test/unit`) gains `labelObstacles: () => []`.

- [ ] **Step 4: Run the tests**

Run: `npm run test:unit`
Expected: the six new cases pass; `citationGraphRendererHops`, `Regions`, and the label tests still pass. If "reports rounded values" reads a value other than 50, print `renderer.labelObstacles()` and the world y in the assertion message and re-derive the client y from `WORLD_PLOT`: the fake canvas is 800×600 device px at ratio 1, so world y 367.5 is client y 367.5 only with the identity transform; make sure `setViewTransform({x:0,y:0,scale:1})` ran after construction.

- [ ] **Step 5: Gate and commit**

Run: `npm run check`

```bash
git add src/services/citationGraphRenderer.ts src/services/graphRendererScene.ts test/unit/citationGraphRendererFloor.test.ts test/unit
git commit -m "The plot draws the citation floor and takes its drag"
```

---

### Task 4: The rail's Citation floor row

**Files:**

- Modify: `src/services/graphScopeRailModel.ts:142-167` (`ScopeRailModel`, `ScopeRailInput`), `:375-425` (`buildScopeRailModel`)
- Modify: `src/services/graphKeyRail.ts:143-160` (`ScopeRailHandlers`), `:708-751` (`renderScope`), a new `floorRowElement`
- Modify: `addon/content/graph.css` after `.cm-scope-hop-cut` (`:1783-1787`)
- Test: `test/unit/graphScopeRailModel.test.ts`

**Interfaces:**

- Consumes: `GraphScopeResult.belowFloorCount` (Task 1).
- Produces: `ScopeFloorRow { value: number; belowText: string }`; `ScopeRailModel.floor: ScopeFloorRow`; `ScopeRailInput.floor: number`; `ScopeRailHandlers.setFloor(value: number): void`; DOM classes `cm-scope-floor-row`, `cm-scope-floor-field`, `cm-scope-floor-input`.

- [ ] **Step 1: Write the failing tests**

In `test/unit/graphScopeRailModel.test.ts`, find the helper that builds a `ScopeRailInput` (grep `buildScopeRailModel(` in the file) and add `floor: 0` and `belowFloorCount: 0` wherever an input or a `GraphScopeResult` literal is built (the `scope` object; grep `hiddenCount:` to find them). Then add:

```ts
describe("the Citation floor row", function () {
  it("prints the floor and how many sit under it", function () {
    const model = buildScopeRailModel({
      ...baseInput(),
      floor: 20,
      scope: { ...baseInput().scope, belowFloorCount: 143 },
    });
    expect(model.floor).to.deep.equal({ value: 20, belowText: "143 below" });
  });

  it("reads off at 0, on a seedless graph too", function () {
    const model = buildScopeRailModel({ ...baseInput(), hops: null, floor: 0 });
    expect(model.floor).to.deep.equal({ value: 0, belowText: "off" });
  });
});
```

where `baseInput()` is whatever the file's existing input factory is called; if it has none, write one from the file's first `buildScopeRailModel` call.

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx tsc --noEmit -p test`
Expected: `floor` unknown on `ScopeRailInput` / `ScopeRailModel`.

- [ ] **Step 3: Implement the row**

`src/services/graphScopeRailModel.ts`:

```ts
/** The Citation floor row: the field's value and the muted count beside it. */
export interface ScopeFloorRow {
  value: number;
  /** `{n} below`, or `off` while the floor is 0. */
  belowText: string;
}
```

`ScopeRailModel` gains `floor: ScopeFloorRow;` after `hops`; `ScopeRailInput` gains `/** The citation floor, 0 when off. */ floor: number;`. In `buildScopeRailModel`'s return:

```ts
    floor: {
      value: input.floor,
      belowText:
        input.floor > 0
          ? `${COUNT_FORMAT.format(input.scope.belowFloorCount)} below`
          : "off",
    },
```

`src/services/graphKeyRail.ts`: `ScopeRailHandlers` gains

```ts
  /** The Citation floor field committed a value (Enter or blur). */
  setFloor(value: number): void;
```

Inside `createKeyRail`, beside `hopsBlockElement`:

```ts
/**
 * The floor's row: a number field and the count under it. The field is the
 * only control when no axis shows citations, so it is always editable.
 */
function floorRowElement(row: ScopeFloorRow): HTMLElement {
  const wrapper = element(document, "div", "cm-scope-row cm-scope-floor-row");
  wrapper.append(
    text(document, "span", "Citation floor", "cm-scope-row-label"),
  );
  const field = element(document, "label", "cm-scope-floor-field");
  field.append(text(document, "span", "≥"));
  const input = element(
    document,
    "input",
    "cm-scope-floor-input",
  ) as HTMLInputElement;
  input.type = "number";
  input.min = "0";
  input.step = "1";
  input.value = String(row.value);
  input.setAttribute("aria-label", "Citation floor");
  const commit = (): void => {
    const parsed = Math.floor(Number(input.value));
    if (!Number.isFinite(parsed) || parsed < 0) {
      input.value = String(row.value);
      return;
    }
    if (parsed !== row.value) options.onScope.setFloor(parsed);
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
    // A render that arrived while the reader was typing waits for this.
    const pending = pendingScope;
    pendingScope = undefined;
    if (pending !== undefined) rail.renderScope(pending);
  });
  field.append(input);
  wrapper.append(
    field,
    text(document, "span", row.belowText, "cm-scope-row-count"),
  );
  return wrapper;
}
```

Declare beside `lastScopeSignature`:

```ts
/** A Scope model that arrived while the floor field had focus. */
let pendingScope: ScopeRailModel | null | undefined = undefined;
```

and name the returned object so the closure can call it: change `return {` at the end of `createKeyRail` to `const rail: KeyRail = {` … `};` followed by `return rail;`. In `renderScope`, before the signature check:

```ts
const active = document.activeElement;
if (
  active &&
  scopeHost.contains(active) &&
  active.classList.contains("cm-scope-floor-input")
) {
  pendingScope = model;
  return;
}
```

and after `if (model.hops) scopeHost.appendChild(hopsBlockElement(model.hops));` add `scopeHost.appendChild(floorRowElement(model.floor));`. Import `ScopeFloorRow` from `./graphScopeRailModel`.

`addon/content/graph.css`, after `.cm-scope-hop-cut`:

```css
.cm-scope-floor-row {
  margin-top: 8px;
}
.cm-scope-floor-field {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 3px;
  color: var(--cm-muted);
  font-size: 11px;
}
.cm-scope-floor-input {
  width: 48px;
  height: 20px;
  padding: 0 4px;
  border: 1px solid var(--cm-border);
  border-radius: 3px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
```

Every `ScopeRailHandlers` literal in `src` and `test` (grep `fillControl:`) gains a `setFloor` entry; in `graphViewService.ts` it is `setFloor: (value) => setFloor(value),` and Task 6 defines `setFloor`; until then write `setFloor: () => undefined,` there and let Task 6 replace it. Every `buildScopeRailModel` caller passes `floor` (`graphViewService.ts` `refreshScopeRail`: `floor: 0,` for now, Task 6 replaces it).

- [ ] **Step 4: Run the tests**

Run: `npm run test:unit`
Expected: the two new cases pass; every `graphScopeRailModel` and `graphKeyRail` case still passes.

- [ ] **Step 5: Gate and commit**

Run: `npm run check`

```bash
git add src/services/graphScopeRailModel.ts src/services/graphKeyRail.ts src/services/graphViewService.ts addon/content/graph.css test/unit
git commit -m "The rail's Scope section gains the Citation floor row"
```

---

### Task 5: The floor persists with the graph and travels on views

**Files:**

- Modify: `src/services/graphViewState.ts:36` (version), `:69-132` (the state), `:136-154` (`emptyGraphViewState`), `:501-563` (`parseGraphViewState`)
- Modify: `src/services/graphViews.ts:39-49` (`GraphViewExplore`, `GraphViewLiveHops`), `:91-105` (Cornerstones), `:382-388` (edited), `:427-431` (tutorial chip), `:675-683` (decode), `:735` (capture)
- Test: `test/unit/graphViewState.test.ts`, `test/unit/graphViews.test.ts`

**Interfaces:**

- Produces: `GraphViewState.floor: number`; `GRAPH_VIEW_STATE_VERSION = 6`; `GraphViewExplore.floor?: number`; `GraphViewLiveHops.floor: number`.

- [ ] **Step 1: Write the failing tests**

`test/unit/graphViewState.test.ts`: in the "returns null for another version" case change `version: 6` to `version: 7`. Add to the round-trip `state` literal `floor: 25,`. Add after the "fills missing optional fields" case:

```ts
it("parses a version 5 record with the floor off", function () {
  const five = JSON.stringify({ ...state, version: 5, floor: undefined });
  expect(parseGraphViewState(five)?.floor).to.equal(0);
});

it("drops a malformed floor to 0 and floors a fraction", function () {
  expect(
    parseGraphViewState(JSON.stringify({ ...state, floor: "ten" }))?.floor,
  ).to.equal(0);
  expect(
    parseGraphViewState(JSON.stringify({ ...state, floor: -4 }))?.floor,
  ).to.equal(0);
  expect(
    parseGraphViewState(JSON.stringify({ ...state, floor: 12.9 }))?.floor,
  ).to.equal(12);
});
```

`test/unit/graphViews.test.ts`: the `liveHops` constant gains `floor: 0,`. Add, near the `graphViewIsEdited` cases:

```ts
it("is edited when the view's floor differs from the live one, and not when the view has none", function () {
  const cornerstones = SHIPPED_GRAPH_VIEWS.find(
    (v) => v.id === "cornerstones",
  )!;
  expect(cornerstones.explore).to.deep.equal({
    direction: "references",
    hops: 2,
    floor: 10,
  });
  const live = {
    layout: cornerstones.appearance,
    regions: [],
    filters,
    folders,
    nodes,
    hops: {
      ...liveHops,
      direction: "references" as const,
      depth: 2,
      floor: 10,
    },
  };
  expect(graphViewIsEdited(cornerstones, live)).to.equal(false);
  expect(
    graphViewIsEdited(cornerstones, {
      ...live,
      hops: { ...live.hops, floor: 20 },
    }),
  ).to.equal(true);
  const noFloor: GraphViewDefinition = {
    ...cornerstones,
    id: "user:9",
    explore: { direction: "references", hops: 2 },
  };
  expect(
    graphViewIsEdited(noFloor, { ...live, hops: { ...live.hops, floor: 20 } }),
  ).to.equal(false);
});

it("decodes, encodes and captures the floor", function () {
  const record = JSON.parse(
    encodeGraphView({
      ...SHIPPED_GRAPH_VIEWS[0]!,
      explore: { direction: "cited-by", hops: 1, floor: 5 },
    }),
  );
  expect(record.explore).to.deep.equal({
    direction: "cited-by",
    hops: 1,
    floor: 5,
  });
  const decoded = decodeGraphViewRecord(record);
  expect(decoded.ok && decoded.view.explore).to.deep.equal({
    direction: "cited-by",
    hops: 1,
    floor: 5,
  });
  const bad = decodeGraphViewRecord({
    ...record,
    explore: { direction: "cited-by", hops: 1, floor: "many" },
  });
  expect(bad.ok).to.equal(false);
  const captured = captureGraphView({
    name: "Mine",
    paragraph: "",
    layout: SHIPPED_GRAPH_VIEWS[0]!.appearance,
    regions: [],
    filters,
    folders,
    nodes,
    hops: { ...liveHops, floor: 30 },
  });
  expect(captured.explore?.floor).to.equal(30);
});
```

Match the `captureGraphView` input shape to the file's existing capture case (grep `captureGraphView(` there) and the `decodeGraphViewRecord` result shape to its existing decode cases; keep the assertions.

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx tsc --noEmit -p test`
Expected: `floor` unknown on the state and on `GraphViewLiveHops`.

- [ ] **Step 3: Implement**

`src/services/graphViewState.ts`:

- `export const GRAPH_VIEW_STATE_VERSION = 6;`
- `GraphViewState` gains, after `hiddenKeys`:

```ts
/** The citation floor, 0 when off (spec: the citation floor). Since version 6. */
floor: number;
```

- `emptyGraphViewState()` gains `floor: 0,`.
- `parseGraphViewState`: the accept list gains `raw.version !== 5 &&` (keep 4, 3, 2, 1). Add a helper beside `parseKeys`:

```ts
/** A stored floor: a finite number at or above 0, floored; anything else is off. */
function parseFloor(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}
```

and the returned object gains `floor: parseFloor(raw.floor),`. Extend the "Regions have been stored since version 3…" comment with "Version 6 added `floor`."

`src/services/graphViews.ts`:

```ts
/**
 * Stage 3: the direction and the depth a view opens. Stage 4: an optional
 * `floor`; a view that carries one applies it (0 switches it off), a view
 * without leaves the live floor alone.
 */
export interface GraphViewExplore {
  direction: HopDirection;
  hops: number;
  floor?: number;
}

export interface GraphViewLiveHops {
  direction: HopDirection;
  depth: number;
  enabled: readonly boolean[];
  /** The live citation floor, 0 when off. */
  floor: number;
}
```

Cornerstones: `summary: "Seeds, 2 hops of references, floor 10, colour citations. What the field rests on."`, `explore: { direction: "references", hops: 2, floor: 10 }`, and the paragraph gains, after "two steps out,": "keeps what has at least 10 citations,".

`graphViewIsEdited`, inside `if (view.explore !== null)`:

```ts
if (
  view.explore.floor !== undefined &&
  live.hops.floor !== view.explore.floor
) {
  return true;
}
```

The tutorial chip (`:427-431`): append `${view.explore.floor ? ` · floor ${view.explore.floor}` : ""}` to the hops chip's string.

Decode (`:675-683`):

```ts
const rawFloor = raw.explore.floor;
if (rawFloor !== undefined) {
  if (
    typeof rawFloor !== "number" ||
    !Number.isFinite(rawFloor) ||
    rawFloor < 0
  ) {
    return { ok: false, field: "explore.floor" };
  }
}
explore = {
  direction,
  hops: clampHopDepth(raw.explore.hops),
  ...(rawFloor === undefined ? {} : { floor: Math.floor(rawFloor) }),
};
```

Capture (`:735`): `explore: { direction: input.hops.direction, hops: input.hops.depth, floor: input.hops.floor },`. Encode (`:545`) already spreads `explore`.

- [ ] **Step 4: Run the tests**

Run: `npm run test:unit`
Expected: the new cases pass, and `graphViewsStore`, `graphViewApplication` (or whatever consumes `GraphViewLiveHops`, grep it in `test/unit` and add `floor: 0` where a literal lacks it).

- [ ] **Step 5: Gate and commit**

Run: `npm run check` — the typecheck will name `graphViewService.ts`'s `liveHops()` and the recipe as missing `floor`; add `floor: 0` to both for now (Task 6 replaces the literals).

```bash
git add src/services/graphViewState.ts src/services/graphViews.ts src/services/graphViewService.ts test/unit/graphViewState.test.ts test/unit/graphViews.test.ts test/unit
git commit -m "The floor persists at recipe version 6 and travels on a view's explore"
```

---

### Task 6: The view service holds the floor

**Files:**

- Modify: `src/services/graphViewService.ts` — `:556` (state), `:1339-1400` (`onScope`), `:1984-1999` (`liveHops`, `capturedExplore`), `:2070-2092` (`applyGraphView`), `:3700-3730` (renderer options), `:4028-4047` (`refreshScopeRail`), `:4092-4149` (`applyFilters`), `:4166-4173` (a `setFloor` beside `setHopEnabled`), `:4761-4781` (the recipe), `:4816-4819` (`applyState`), `:5035-5037` (initial state)

**Interfaces:**

- Consumes: everything Tasks 1–5 produced.
- Produces: `setFloor(value: number)` (module-local), `floorDragging` (module-local).

- [ ] **Step 1: Wire the state**

After `let hopEnabled = defaultHopEnabled();`:

```ts
/** The citation floor (spec: the citation floor), 0 when off. */
let floor = 0;
/** True from the first drag change to the release; the fill re-plans once at the end. */
let floorDragging = false;
```

Beside `setHopEnabled`:

```ts
/** The floor from the rail's field or a view; a drag goes through the same door. */
const setFloor = (value: number): void => {
  const next = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  if (next === floor) return;
  floor = next;
  applyFilters();
  notifyStateChange();
};
```

`applyFilters`: replace `floor: 0,` with `floor,`; after `renderer?.setScopeKeys(scopeKeys);` add `renderer?.setFloor(floor, scope.belowFloorCount, false);`; replace the final `scheduleHopFill();` with:

```ts
// A drag sweeps through many floors; the plan is rebuilt once, on release.
if (!floorDragging) scheduleHopFill();
```

Renderer options, after `onViewChange`:

```ts
    onFloorChange: (value) => {
      floorDragging = true;
      setFloor(value);
    },
    onFloorDragEnd: () => {
      floorDragging = false;
      scheduleHopFill();
    },
```

`onScope`: `setFloor: (value) => setFloor(value),` (replacing Task 4's stub). `refreshScopeRail`: `floor,` (replacing `floor: 0`). `liveHops()`: `floor,`. The recipe (`getState`): `floor,` after `hiddenKeys`. `applyState`: after `hopEnabled = [...state.hops.enabled];` add `floor = state.floor;`. Initial state with a request (`:5037`): add `floor = options.initialState.floor;`.

`applyGraphView`, after the `if (chosen.explore) { … }` block:

```ts
if (chosen.explore?.floor !== undefined && chosen.explore.floor !== floor) {
  // Applied through the same door as the rail's field, before the
  // filters move, so the one `applyFilters` the filter change runs sees it.
  floor = Math.max(0, Math.floor(chosen.explore.floor));
  notifyStateChange();
}
```

(`graphFilter.setState` below runs `applyFilters`; if a view's filters are unchanged and the controller does not fire, follow it with `applyFilters()` — verify by reading the controller's `setState`: grep `setState(` in `src/services/graphFilterController.ts` or wherever `graphFilter` is created. If it fires only on change, add `applyFilters();` after the `graphFilter.setState` line unconditionally; a second run is harmless.)

`capturedExplore`: after computing `word`, return

```ts
const floorPart = explore.floor ? `, floor ${explore.floor}` : "";
return `${explore.hops} hop${explore.hops === 1 ? "" : "s"} of ${word}${floorPart}`;
```

and its default for a new view is `{ direction: hopDirection, hops: hopDepth, floor }`.

- [ ] **Step 2: Typecheck and run the unit suite**

Run: `npm run check`
Expected: clean. There is no unit harness for the view service; Task 8's Zotero case is its test.

- [ ] **Step 3: Commit**

```bash
git add src/services/graphViewService.ts
git commit -m "The view service holds the floor: rail, drag, recipe and views"
```

---

### Task 7: The words: CONTEXT.md, an ADR, the roadmap

**Files:**

- Modify: `CONTEXT.md:42-45` (Scope), a new **Floor** entry after **Hop rule**
- Create: `docs/adr/0016-the-floor-is-a-scope-rule-and-the-fill-stops-at-it.md`
- Modify: `docs/superpowers/handoffs/roadmap.md` — Stage 4's checklist, the Manual verification section, the Log

- [ ] **Step 1: CONTEXT.md**

Scope becomes:

```markdown
**Scope**:
The rule that decides which papers of the graph are shown: the folder rule,
the hop rule and the floor taken together, followed by the reader's filters.
_Avoid_: filter (filters come after scope), visibility, focus
```

After **Hop rule**:

```markdown
**Floor**:
The citation count a paper needs to be shown. A paper under it is not shown
and is not followed by the fill; one with no count passes. Seeds are never
under it. Set by dragging the line on the plot or typing in the rail.
_Avoid_: threshold, cutoff, min citations
```

- [ ] **Step 2: The ADR**

```markdown
# The floor is a scope rule, and the fill stops at it

A citation floor hides every non-seed paper whose known count is under it,
as the last step of the scope order after the folder rule, the hop rule and
the reader's filters, and a paper with no count passes. Because the fill
expands shown papers, a paper under the floor is never expanded: the floor is
the reader's cost lever, and with the cut (ADR 0015) it is the plain
statement of what a filled plot holds. It is not a facet, since the rail
counts what it removed, and not a renderer overlay, since the renderer never
decides visibility. The design's outline rendering of papers under the floor
was not built: a third node state at D13's densities, and the dashed ghost
outline already means something (citation-floor spec, 2026-09-18).
```

- [ ] **Step 3: The roadmap**

In Stage 4's checklist tick `brainstorm and spec` and `plan` for the floor, and rewrite the entry so it says the floor is built and shared citers are next:

```markdown
### Stage 4: citation floor and shared citers

Depends on Stage 3 and D8. Two specs: the floor
(`docs/superpowers/specs/2026-09-18-citation-floor-design.md`, ADR 0016) and
shared citers (Off, Dim, Only with the grading formula and Key tiers; label
routing through `graphLabelBudget.ts`; brainstorm not yet held).

- [x] floor: brainstorm, spec, plan, implemented, reviewed, merged
- [ ] floor: manual walk-through by the user
- [ ] shared citers: brainstorm and spec
- [ ] shared citers: plan
- [ ] shared citers: implemented, reviewed, merged, XPI built, pushed
- [ ] shared citers: manual walk-through by the user
```

Under **Next**, item 1 becomes "Shared citers' brainstorm and spec (Stage 4's second half); the floor shipped." Append to Manual verification, before the B42 paragraph, the spec's five checks verbatim as `- [ ] Floor: …` items. Add a Log line: "2026-09-18, later: the citation floor shipped (ADR 0016); commits `<range>`." with the real range filled in at Task 8's end.

- [ ] **Step 4: Gate and commit**

Run: `npm run check` (prettier covers the docs; never let it split an inline code span — reword instead).

```bash
git add CONTEXT.md docs/adr/0016-the-floor-is-a-scope-rule-and-the-fill-stops-at-it.md docs/superpowers/handoffs/roadmap.md
git commit -m "The floor in the vocabulary, ADR 0016, and the roadmap's Stage 4 split"
```

---

### Task 8: The Zotero case, the suite, the build

**Files:**

- Modify: `test/zotero/graphCitationHops.test.ts` — a new `describe` block after the D8 block (`:1869-…`), inside the outer `describe("Citation hops (Stage 3)")`

**Interfaces:**

- Consumes: the D8 block's shape (`serveOpenAlex`, `openAlexWork`, `notFound`, `providerAnswer`, `untilQuiet`, `nodeMenuEntry`, `hopCounts`, `hopRowText`, `fetchButton`, `dismissGallery`, `openNewGraphTab`, `waitFor`, `delay`, `PROVIDER_HOST`, `OPEN_ALEX_KEY_PREF`, `FIXTURE_TITLE`), all defined in the file. Read the D8 block (`:1869-2200`) in full first; its comments name every trap.

- [ ] **Step 1: Write the case**

The block is D8's harness with three citers that carry counts, and each citer's own page served consistently with its count, so the fill drains:

```ts
describe("with a citation floor (Stage 4)", function () {
  const SEED_DOI = "10.5555/floor.seed";
  const SEED_TITLE = `${FIXTURE_TITLE} (floor)`;
  /** Three citers whose counts straddle a floor of 2; each one's own page holds exactly its count. */
  const CITERS = [
    { id: "W901", doi: "10.5555/floor.a", count: 1, citers: ["W911"] },
    {
      id: "W902",
      doi: "10.5555/floor.b",
      count: 3,
      citers: ["W912", "W913", "W914"],
    },
    { id: "W903", doi: "10.5555/floor.c", count: 0, citers: [] },
  ];
  let previousKey: unknown = undefined;
  let seedItemID: number | null = null;
  let tabID: string | null = null;
  let realRequest: any = null;
  let asked: string[] = [];
  let serving = false;

  function work(
    id: string,
    doi: string,
    count: number,
    title = `Floor paper ${id}`,
  ): unknown {
    return {
      id: `https://openalex.org/${id}`,
      doi: `https://doi.org/${doi}`,
      display_name: title,
      publication_year: 2021,
      publication_date: "2021-01-01",
      cited_by_count: count,
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
      asked.push(url);
      if (!serving || !/^https:\/\/api\.openalex\.org\//.test(url))
        return notFound();
      const parsed = new URL(url);
      const path = decodeURIComponent(parsed.pathname);
      if (/\/works\/doi/i.test(path)) {
        return path.includes(SEED_DOI)
          ? providerAnswer(
              JSON.stringify({
                ...(work("W900", SEED_DOI, CITERS.length) as object),
                display_name: SEED_TITLE,
                publication_year: 2019,
                publication_date: "2019-01-01",
              }),
            )
          : notFound();
      }
      const filter = parsed.searchParams.get("filter") ?? "";
      if (filter === "cites:W900") {
        return providerAnswer(
          JSON.stringify({
            results: CITERS.map((citer) =>
              work(citer.id, citer.doi, citer.count),
            ),
            meta: { count: CITERS.length },
          }),
        );
      }
      const citer = CITERS.find(
        (candidate) => filter === `cites:${candidate.id}`,
      );
      if (citer) {
        return providerAnswer(
          JSON.stringify({
            results: citer.citers.map((id) =>
              work(id, `10.5555/floor.${id.toLowerCase()}`, 0),
            ),
            meta: { count: citer.citers.length },
          }),
        );
      }
      return providerAnswer(
        JSON.stringify({ results: [], meta: { count: 0 } }),
      );
    };
  }

  function restore(): void {
    if (!realRequest) return;
    (Zotero.HTTP as any).request = realRequest;
    realRequest = null;
  }

  function citerPages(): string[] {
    return asked.filter((url) =>
      /^cites:W90[123]$/.test(new URL(url).searchParams.get("filter") ?? ""),
    );
  }

  function floorInput(): HTMLInputElement {
    const input = graphRoot().querySelector(
      ".cm-scope-floor-input",
    ) as HTMLInputElement | null;
    expect(input, "the Citation floor field").to.exist;
    return input!;
  }

  function floorRowText(): string {
    return normalize(
      graphRoot().querySelector(".cm-scope-floor-row")?.textContent,
    );
  }

  async function typeFloor(value: number): Promise<void> {
    const input = floorInput();
    input.focus();
    input.value = String(value);
    input.dispatchEvent(new win.Event("change", { bubbles: true }));
    input.blur();
    await delay(200);
  }

  /** Walk the plot in whole CSS pixels until the canvas title reads the tag (B43). */
  function findTag(): { x: number; y: number } | null {
    const canvas = graphRoot().querySelector("canvas") as HTMLCanvasElement;
    const box = canvas.getBoundingClientRect();
    const left = Math.ceil(box.left);
    const top = Math.ceil(box.top);
    for (let y = top + 2; y < box.bottom - 2; y += 3) {
      for (let x = left + 2; x < box.right - 2; x += 3) {
        canvas.dispatchEvent(
          new win.PointerEvent("pointermove", {
            bubbles: true,
            clientX: x,
            clientY: y,
          }),
        );
        if (canvas.title.startsWith("⇕ floor")) return { x, y };
      }
    }
    return null;
  }

  before(async function () {
    this.timeout(240_000);
    previousKey = Zotero.Prefs.get(OPEN_ALEX_KEY_PREF, true);
    Zotero.Prefs.set(OPEN_ALEX_KEY_PREF, "floor-test-key", true);
    serve();
    const item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField("title", SEED_TITLE);
    item.setField("date", "2019");
    item.setField("DOI", SEED_DOI);
    seedItemID = await item.saveTx();
    tabID = await openNewGraphTab();
    currentTabID = tabID;
    win.Zotero_Tabs.select(tabID);
    const rail = await waitFor(
      () =>
        tabContent(tabID)?.querySelector(".cm-scope-section .cm-scope-count"),
      30_000,
    );
    expect(rail, "the floor tab's Scope section").to.exist;
    await dismissGallery(tabID);
    const fit = await waitFor(
      () =>
        graphRoot().querySelector(
          '.cm-zoom-controls button[data-action="fit"]',
        ) as HTMLButtonElement | null,
      10_000,
    );
    fit!.click();
    // The library's own update of the new item must settle before the case counts requests.
    const quiet = await waitFor(() => asked.length, 5_000);
    void quiet;
    await delay(12_000);
    const unlocked = await Promise.race([
      Zotero.unlockPromise.then(() => true),
      delay(5_000).then(() => false),
    ]);
    if (!unlocked) Zotero.hideZoteroPaneOverlays();
  });

  after(async function () {
    this.timeout(30_000);
    serving = false;
    restore();
    if (previousKey === undefined || previousKey === null)
      Zotero.Prefs.clear(OPEN_ALEX_KEY_PREF, true);
    else Zotero.Prefs.set(OPEN_ALEX_KEY_PREF, previousKey as string, true);
    if (tabID) win.Zotero_Tabs.close(tabID);
    await delay(500);
    tabID = null;
    currentTabID = null;
    if (seedItemID !== null) await Zotero.Items.erase(seedItemID);
    seedItemID = null;
  });

  it("hides under the floor, fills only above it, and the drag brings the rest back", async function () {
    this.timeout(180_000);
    asked = [];
    serving = true;
    (await nodeMenuEntry("Add as seed", SEED_TITLE)).click();
    const filled = await waitFor(() => hopCounts(1)?.available ?? null, 60_000);
    expect(
      filled,
      `hop 1 never filled; it read "${hopRowText(1)}"; ${asked.join(" | ")}`,
    ).to.equal(3);

    await typeFloor(2);
    expect(floorInput().value, floorRowText()).to.equal("2");
    expect(floorRowText(), "the floor row").to.include("2 below");
    expect(hopCounts(1), hopRowText(1)).to.deep.equal({
      shown: 1,
      available: 3,
    });

    fetchButton(2)!.click();
    const hop2 = await waitFor(
      () => (hopCounts(2)?.available ? hopCounts(2) : null),
      60_000,
    );
    expect(
      hop2,
      `hop 2: "${hopRowText(2)}"; pages ${citerPages().join(" | ")}`,
    ).to.deep.equal({ shown: 3, available: 3 });
    expect(
      citerPages().map((url) => new URL(url).searchParams.get("filter")),
      "only the citer above the floor was paged",
    ).to.deep.equal(["cites:W902"]);

    const tag = findTag();
    expect(tag, "the floor's tag on the plot").to.exist;
    const canvas = graphRoot().querySelector("canvas") as HTMLCanvasElement;
    const box = canvas.getBoundingClientRect();
    const utils = win.windowUtils;
    utils.sendMouseEvent("mousedown", tag!.x, tag!.y, 0, 1, 0, false, 0, 0);
    for (let y = tag!.y; y < box.bottom + 20; y += 8) {
      utils.sendMouseEvent("mousemove", tag!.x, y, 0, 0, 0, false, 0, 0);
    }
    utils.sendMouseEvent(
      "mouseup",
      tag!.x,
      box.bottom + 20,
      0,
      1,
      0,
      false,
      0,
      0,
    );
    const off = await waitFor(() => floorInput().value === "0", 5_000);
    expect(
      off,
      `the field after the drag read "${floorInput().value}"; ${floorRowText()}`,
    ).to.equal(true);
    expect(floorRowText()).to.include("off");
    const back = await waitFor(
      () => (hopCounts(2)?.available === 4 ? hopCounts(2) : null),
      60_000,
    );
    expect(
      back,
      `hop 2 after the drag: "${hopRowText(2)}"; pages ${citerPages().join(" | ")}`,
    ).to.deep.equal({ shown: 4, available: 4 });
    expect(
      citerPages()
        .map((url) => new URL(url).searchParams.get("filter"))
        .sort(),
    ).to.deep.equal(["cites:W901", "cites:W902"]);
  });
});
```

Notes for the implementer: `W903` has `cited_by_count: 0`, so its expansion takes the reported-zero return and pages nothing; that is why the expected page lists never hold `cites:W903`. `hopCounts(2)` is `{shown, available}` per the file's helper. If the fake canvas's `title` never reads the tag, the tag may be under the gallery or the plot may be off-screen: assert `galleryState()` in the message and re-click fit. If `sendMouseEvent` lands on the overlay, the `unlocked` block above is what lowers it.

- [ ] **Step 2: Lint and typecheck the case**

Run: `npm run check`
Expected: clean (the Zotero suite's tsconfig is under `test`, so this compiles the case).

- [ ] **Step 3: Run the case alone, then the suite**

Put a temporary `describe.only` on the new block, run `npm test 2>&1 | tee C:\Users\nunesd\AppData\Local\Temp\floor-case.log` (in a subagent: `run_in_background` with a 600 s timeout; wait for the notification), read the log, fix what fails (the systematic-debugging skill if the assertion message does not name the cause), remove `.only`, and then run the full suite once the same way. Expected: 91 passed, 0 failed (90 + this case); a Semantic Scholar `0/0` after exactly 15 s in the ten live hop cases is the provider, not this change (roadmap, "Zotero suite").

- [ ] **Step 4: Commit, merge, build, push**

```bash
git add test/zotero/graphCitationHops.test.ts
git commit -m "A Zotero case: the floor hides, fills only above itself, and the drag brings the rest back"
```

Fill the commit range into the roadmap's Log line (Task 7) and commit that with "Roadmap: the floor's log line". Then:

```bash
git checkout main && git merge --ff-only s4-citation-floor && git branch -d s4-citation-floor
npm run build
git push gh-daniel-locatelli main
```

Record the ledger entry in `.superpowers/sdd/progress.md` ("SDD progress: Citation floor": each task's commit and review verdict), then delete `docs/superpowers/plans/2026-09-18-citation-floor.md` in a final commit ("Retire the floor's plan; the spec stays until shared citers ships"), since the shared-citers spec will cite the floor spec but nothing cites the plan.
