# Region Shapes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A folder's territory becomes a set of shapes — an exact circle for a
lone paper, a resampled smooth blob for a cluster — so the outline stops
wobbling and the halo can tighten further for less work than it costs today.

**Architecture:** `folderRegionContours` partitions a folder's papers into
connected components under "closer than `2R`" over one shared lattice, returns
`FolderRegionShapes` (`{ radius, pitch, discs, loops }`) instead of
`RegionPoint[][]`, and `regionPathFor` emits an `arc()` per disc and fits each
loop after resampling it to even arc length. The decomposition lands first with
the constants untouched, so the "every surviving loop is byte-identical at a
given radius and pitch" claim is directly testable against today's contours;
the constants then move as one small task whose diff is four numbers.

**Tech Stack:** TypeScript, ESM, `node --test` with chai for unit tests,
`zotero-plugin test` (mocha inside a real Zotero) for the Zotero suite,
esbuild via `zotero-plugin-scaffold` for the XPI.

**Branch:** `graph-region-shapes`, cut from `main`.

**Spec:** `docs/superpowers/specs/2026-09-10-graph-region-shapes-design.md`.
It is approved. Do not re-derive it, and do not re-derive D6
(`docs/superpowers/specs/2026-09-10-graph-region-curves-design.md`), which is
current and which this spec amends.

## Global Constraints

- **`draw()` latches `canvasError` after one throw** and never paints again for
  that renderer's life; only a new renderer recovers it. Every function in
  `src/services/graphFolderRegion.ts` must therefore be **total**: no
  unguarded division, no throw, finite output for any input including `NaN`,
  `Infinity`, empty arrays and coincident points.
- **The contour golden's numbers were recorded from pre-refactor code on
  purpose.** In `test/unit/graphFolderRegion.test.ts`, the case "sums the field
  to the same contour however it is accumulated" asserts `length = 68`,
  `x = 475.8592418546`, `y = 439.2057750520` for its first loop. **If those
  three fail, the code is wrong, not the golden.** Only its _second_ triple may
  move, and only into the disc assertion Task 3 gives it.
- Prettier settings are `printWidth: 80`, `tabWidth: 2`. Run
  `npm run lint:fix` before committing if formatting drifts.
- `npm run check` = `lint:check` + `typecheck` (both `tsconfig.json` and
  `test/tsconfig.json`) + `test:unit`. It must be green at the end of every
  task. It does **not** run the Zotero suite.
- **`npm test` deletes `.scaffold/build/meristema.xpi`.** Build the XPI
  **after** the last test run, never before.
- **Never `Stop-Process zotero`.** If `npm test` fails with EBUSY, stop and ask
  the user; the user usually has a live Zotero session open.
- Backlog **B25, B26 and B27** are open and live in this code. **B27 will look
  like a regression**: an out-of-range swatch index draws
  `strokeStyle = undefined` and canvas silently keeps the previous region's
  colour. Do not "fix" it here.
- Commit after every task, one commit per task, with the task number in the
  subject.

## File Structure

- `src/services/graphFolderRegion.ts` (modify) — the whole geometry change:
  `regionComponents`, `FolderRegionShapes`, the shared lattice, discs,
  `resampleRing`, the `cellSegments` early return, and the four constants. It
  stays one module: everything here is one pipeline over plain geometry, with
  no canvas and no DOM, and the renderer is its only caller.
- `src/services/citationGraphRenderer.ts` (modify, two small sites) —
  `regionsFor`'s map type at ~line 1297 and `drawRegions`' call to
  `regionPathFor` at ~line 1405.
- `test/unit/graphRendererDoubles.ts` (create) — the `FakePath2D` /
  `FakeContext2D` / `FakeCanvas` doubles and the `node` / `model` /
  `FREE_LAYOUT` fixtures, extracted from
  `test/unit/citationGraphRendererRegions.test.ts` so two test files can share
  them. Not a `.test.ts`, so the runner's glob does not execute it.
- `test/unit/citationGraphRendererRegionCache.test.ts` (create) — the
  `folderRegionContours` call count. It needs `mock.module`, which must run
  before the renderer is imported, so it dynamically imports the renderer and
  therefore cannot live in the statically-importing existing file.
- `test/unit/graphFolderRegion.test.ts` (modify) — every existing region case
  moves to the new return type; the decomposition, resampler, path and knob
  cases join it.
- `test/unit/citationGraphRendererRegions.test.ts` (modify) — imports the
  extracted doubles; its zoom case gains disc awareness.
- `package.json` (modify) — `test:unit` gains
  `--experimental-test-module-mocks`.
- `docs/superpowers/specs/2026-09-10-graph-region-curves-design.md` (modify) —
  two corrections, in the tasks whose code makes them true.
- `docs/superpowers/handoffs/2026-09-08-roadmap.md` (modify) — manual checks and
  the Log line, last task.

---

### Task 1: Pin the cache claim with a real call count

D6's pan assertion ("recomputes nothing on a pan") checks that every drawn
coordinate is the old one shifted by the pan delta. That passes whether or not
the contour was recomputed, because recomputing at the same radius produces the
same contour and the projection then shifts it. Counting the calls is what
actually tests it, and it must be pinned **before** the geometry moves.

Node's `mock.module` is the only way to intercept an ESM import here. It is
available behind `--experimental-test-module-mocks` on the repo's Node 24 and
has been verified to work alongside `test/nodeResolve.mjs`'s resolve hooks. The
flag prints one `ExperimentalWarning` to stderr per unit run; that is expected
and is not a failure.

**Files:**

- Create: `test/unit/graphRendererDoubles.ts`
- Create: `test/unit/citationGraphRendererRegionCache.test.ts`
- Modify: `test/unit/citationGraphRendererRegions.test.ts` (delete the doubles,
  import them instead)
- Modify: `package.json` (the `test:unit` script)

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `test/unit/graphRendererDoubles.ts` exporting
  `class FakePath2D` (recording `moveTo`, `lineTo`, `arc`, `bezierCurveTo`,
  `closePath` into `commands: Array<{ op: string; args: number[] }>`),
  `class FakeContext2D` (with `calls: RecordedCall[]`),
  `interface RecordedCall`, `class FakeCanvas`,
  `function node(key: string, overrides?: Partial<CitationGraphNode>): CitationGraphNode`,
  `function model(nodes: CitationGraphNode[]): CitationGraphModel`,
  `const FREE_LAYOUT: GraphLayoutOptions`,
  `function attachView(canvas: FakeCanvas): void`,
  `function lastRegionStroke(context: FakeContext2D): RecordedCall`,
  `function lastRegionStrokeOf(context: FakeContext2D, color: string): RecordedCall`.
  Later tasks reuse all of these.

- [ ] **Step 1: Extract the doubles into a shared module**

Create `test/unit/graphRendererDoubles.ts` by **moving** — not copying — the
following out of `test/unit/citationGraphRendererRegions.test.ts`, keeping every
docstring verbatim with them: `FakePath2D`, `RecordedCall`, `FakeContext2D`,
`FakeCanvas`, `node`, `model`, `FREE_LAYOUT`, `lastRegionStroke`,
`lastRegionStrokeOf`, `attachView`. Add `export` to each. The file needs this
header and these imports:

```ts
/**
 * The renderer's test doubles, shared by every unit case that drives a real
 * `CitationGraphRenderer`. Extracted from
 * `citationGraphRendererRegions.test.ts` when a second file needed them: the
 * call-count case has to `mock.module` before importing the renderer, so it
 * cannot live beside a static import of it.
 *
 * Deliberately not a `*.test.ts`, so `npm run test:unit`'s glob does not try
 * to run it as a suite.
 */
import type {
  CitationGraphModel,
  CitationGraphNode,
  GraphLayoutOptions,
} from "../../src/domain/graphTypes";
```

While moving `FakePath2D`, add the `arc` recorder it does not have yet — Task 3
makes the renderer emit arcs, and adding it here keeps that task's diff to the
product:

```ts
  arc(...args: number[]): void {
    this.commands.push({ op: "arc", args });
  }
```

Then in `test/unit/citationGraphRendererRegions.test.ts`, replace the deleted
declarations with:

```ts
import {
  attachView,
  FakeCanvas,
  FakeContext2D,
  FakePath2D,
  FREE_LAYOUT,
  lastRegionStroke,
  lastRegionStrokeOf,
  model,
  node,
} from "./graphRendererDoubles";
```

Delete the now-unused `CitationGraphModel` / `CitationGraphNode` /
`GraphLayoutOptions` type imports from that file only if nothing else in it
still references them (`GraphLayoutOptions` is still used by the colour-metric
case at the bottom — keep that one).

- [ ] **Step 2: Run the unit suite to confirm the extraction changed nothing**

Run: `npm run test:unit`
Expected: PASS, `tests 371`, `fail 0` — the same count as before the move.

- [ ] **Step 3: Add the module-mocks flag**

In `package.json`, change the `test:unit` script to:

```json
    "test:unit": "node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test \"test/unit/**/*.test.ts\"",
```

- [ ] **Step 4: Write the failing call-count test**

Create `test/unit/citationGraphRendererRegionCache.test.ts`:

```ts
import { describe, it, mock } from "node:test";
import { expect } from "chai";
import {
  attachView,
  FakeCanvas,
  FREE_LAYOUT,
  model,
  node,
} from "./graphRendererDoubles";

/**
 * "A pan recomputes nothing" is the load-bearing performance claim of D6's
 * zoom-bucket cache, and until this case nothing verified it. D6's own
 * assertion compared the drawn coordinates before and after a pan and required
 * them to differ by exactly the pan delta — which passes whether or not the
 * contour was recomputed, because a recompute at an unchanged radius produces
 * the very same contour and the projection then shifts it. Only a call count
 * can tell a cache hit from a byte-identical recompute.
 *
 * `mock.module` is experimental and needs `--experimental-test-module-mocks`
 * (set in the `test:unit` script). It must be installed before the renderer is
 * imported, which is why the renderer is imported dynamically here and why
 * this case lives in its own file rather than beside the statically-imported
 * one in `citationGraphRendererRegions.test.ts`.
 */
describe("CitationGraphRenderer region cache", function () {
  it("recomputes a contour on a bucket change and never on a pan", async function () {
    const real = await import("../../src/services/graphFolderRegion");
    let calls = 0;
    mock.module("../../src/services/graphFolderRegion.ts", {
      exports: {
        ...real,
        folderRegionContours: (
          ...args: Parameters<typeof real.folderRegionContours>
        ) => {
          calls += 1;
          return real.folderRegionContours(...args);
        },
      },
    });
    const { CitationGraphRenderer } =
      await import("../../src/services/citationGraphRenderer");

    const canvas = new FakeCanvas();
    const graphNode = node("n1", { collectionIDs: [1] });
    const renderer = new CitationGraphRenderer({
      canvas: canvas as unknown as HTMLCanvasElement,
      model: model([graphNode]),
      layout: FREE_LAYOUT,
      collectionLabels: new Map(),
      onSelectionChange: () => undefined,
      onOpenNode: () => undefined,
    });
    attachView(canvas);
    renderer.setNodePositions(new Map([["n1", { x: 100, y: 100 }]]));

    renderer.setRegions([
      { collectionID: 1, color: "#336699", nodeKeys: new Set(["n1"]) },
    ]);
    const afterFirstDraw = calls;
    expect(afterFirstDraw, "the first frame builds the contour").to.equal(1);

    // A pan: same scale, different origin. Neither the layout revision nor
    // the zoom bucket moves, so the cached contour is re-projected.
    renderer.setViewTransform({ x: 40, y: -25, scale: 1 });
    expect(calls, "a pan recomputes nothing").to.equal(afterFirstDraw);
    renderer.setViewTransform({ x: -10, y: 90, scale: 1 });
    expect(calls, "a second pan recomputes nothing either").to.equal(
      afterFirstDraw,
    );

    // A zoom far past the fit crosses many bucket edges at once, so exactly
    // one recompute lands, not one per bucket.
    renderer.setViewTransform({ x: 0, y: 0, scale: 8 });
    expect(calls, "a zoom past a bucket edge recomputes once").to.equal(
      afterFirstDraw + 1,
    );

    // And back at that scale, panning is free again.
    renderer.setViewTransform({ x: 5, y: 5, scale: 8 });
    expect(calls, "a pan at the new bucket recomputes nothing").to.equal(
      afterFirstDraw + 1,
    );

    mock.reset();
  });
});
```

- [ ] **Step 5: Run it and confirm it passes on today's code**

Run: `npm run test:unit`
Expected: PASS. This case describes behaviour that is already correct — its job
is to hold it while the geometry moves underneath.

- [ ] **Step 6: Watch it red against a deliberately broken product**

A test that has never failed proves nothing. Break the cache on purpose: in
`src/services/citationGraphRenderer.ts`, inside `regionsFor`, comment out the
early return

```ts
if (this.regionSignatures.get(region.collectionID) === signature) {
  continue;
}
```

Run: `npm run test:unit`
Expected: FAIL, in `CitationGraphRenderer region cache`, with
`a pan recomputes nothing: expected 2 to equal 1`.

Then restore the early return exactly as it was and re-run:

Run: `npm run test:unit`
Expected: PASS, `fail 0`.

- [ ] **Step 7: Commit**

```bash
git add package.json test/unit/graphRendererDoubles.ts test/unit/citationGraphRendererRegionCache.test.ts test/unit/citationGraphRendererRegions.test.ts
git commit -m "test: count folderRegionContours calls to pin the pan claim (task 1)"
```

---

### Task 2: `regionComponents`, the partition

A pure export with no callers yet. Papers in different components are at least
`2R` apart, so their supports are disjoint and neither contributes anything to
the other's field anywhere: the union of the components' contours is the
folder's contour, **exactly**.

`2R` is deliberately conservative — the exact isolation radius is
`R(1 + √(1−t)) ≈ 1.707R`. Grouping the papers between `1.707R` and `2R`
costs a handful of discs that could have been exact circles; using the tighter
threshold would instead let a grouped component's grid omit a neighbour whose
support genuinely overlaps its domain. One threshold, provably safe.

**Files:**

- Modify: `src/services/graphFolderRegion.ts`
- Test: `test/unit/graphFolderRegion.test.ts`

**Interfaces:**

- Consumes: `RegionPoint` (already exported by the module).
- Produces:
  `export function regionComponents(points: readonly RegionPoint[], radius: number): RegionPoint[][]`
  — each component is a fresh array of the caller's own point objects, in
  first-seen order. Task 3 consumes it.

- [ ] **Step 1: Write the failing tests**

Append to the `describe("folder regions", ...)` block in
`test/unit/graphFolderRegion.test.ts`, and add `regionComponents` to the import
list at the top of the file:

```ts
it("splits papers more than 2R apart into separate components", function () {
  const components = regionComponents(
    [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
    ],
    10,
  );
  expect(components).to.have.length(2);
  expect(components[0]).to.deep.equal([{ x: 0, y: 0 }]);
  expect(components[1]).to.deep.equal([{ x: 30, y: 0 }]);
});

it("keeps papers closer than 2R in one component", function () {
  expect(
    regionComponents(
      [
        { x: 0, y: 0 },
        { x: 12, y: 0 },
      ],
      10,
    ),
  ).to.have.length(1);
});

/**
 * The conservative boundary, pinned. The exact isolation radius is
 * `R(1 + sqrt(1 - t))`, about `1.707R`; the spec takes `2R` instead so a
 * grouped component's grid can never omit a neighbour whose support
 * overlaps its domain. Anyone later tightening this to 1.707R has to change
 * this case, which is the point.
 */
it("groups at exactly the 2R boundary and splits just past it", function () {
  expect(
    regionComponents(
      [
        { x: 0, y: 0 },
        { x: 19.999, y: 0 },
      ],
      10,
    ),
    "just inside 2R is one component",
  ).to.have.length(1);
  expect(
    regionComponents(
      [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
      ],
      10,
    ),
    "exactly 2R is two components",
  ).to.have.length(2);
});

it("chains papers into one component through their neighbours", function () {
  // Ends 60 apart, so no single hop; every step is 15, well inside 2R.
  const chain = [0, 15, 30, 45, 60].map((x) => ({ x, y: 0 }));
  const components = regionComponents(chain, 10);
  expect(components).to.have.length(1);
  expect(components[0]).to.have.length(5);
});

/**
 * 400 papers in twenty well-separated clusters. This exercises the spatial
 * hash's neighbour lookup at a size where a naive all-pairs pass would be
 * doing 160 000 comparisons — but it asserts the partition, not the clock:
 * 400 points is small enough that even the quadratic version finishes
 * instantly, so a timing assertion here would be flaky and prove nothing.
 * What it does prove is that hashing into cells never loses or merges a
 * component.
 */
it("partitions four hundred papers into the clusters they form", function () {
  const points: RegionPoint[] = [];
  for (let cluster = 0; cluster < 20; cluster += 1) {
    for (let member = 0; member < 20; member += 1) {
      points.push({
        x: cluster * 1000 + (member % 5) * 4,
        y: Math.floor(member / 5) * 4,
      });
    }
  }
  const components = regionComponents(points, 10);
  expect(components).to.have.length(20);
  for (const component of components) {
    expect(component).to.have.length(20);
  }
});

it("never throws on degenerate partition input", function () {
  expect(regionComponents([], 10)).to.deep.equal([]);
  expect(regionComponents([{ x: 1, y: 1 }], 10)).to.deep.equal([
    [{ x: 1, y: 1 }],
  ]);
  // Coincident papers are one component, not one each.
  expect(
    regionComponents(
      [
        { x: 2, y: 2 },
        { x: 2, y: 2 },
      ],
      10,
    ),
  ).to.have.length(1);
  // A non-finite paper joins nothing, and takes nothing down with it.
  const withNaN = regionComponents(
    [
      { x: 0, y: 0 },
      { x: Number.NaN, y: 0 },
      { x: 5, y: 0 },
    ],
    10,
  );
  expect(withNaN).to.have.length(2);
  expect(withNaN[0]).to.have.length(2);
  // A radius that is not a positive number leaves every paper on its own
  // rather than dividing by it.
  expect(regionComponents([{ x: 0, y: 0 }], 0)).to.have.length(1);
  expect(
    regionComponents(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      Number.NaN,
    ),
  ).to.have.length(2);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run test:unit`
Expected: FAIL — `regionComponents is not a function`, or a TypeScript error
from `tsc` if you run `npm run check`. Either is the red you are looking for.

- [ ] **Step 3: Implement `regionComponents`**

In `src/services/graphFolderRegion.ts`, after the `RegionPoint` /
`FolderRegionOptions` declarations and before `DEFAULT_THRESHOLD`:

```ts
/**
 * A folder's papers, partitioned into the groups whose fields can reach each
 * other: two papers join when they are closer than `2 * radius`.
 *
 * Past `2R` the supports are disjoint, so neither paper contributes anything
 * to the other's field anywhere on the plot. The partition is therefore a
 * decomposition and not an approximation: the union of the components'
 * contours is the folder's contour exactly. `2R` is conservative on purpose —
 * the exact isolation radius is `R(1 + sqrt(1 - t))`, about `1.707R` — and the
 * slack is what guarantees a component's own grid can never omit a paper whose
 * bump overlaps its domain.
 *
 * The neighbour search hashes into cells of side `2R`, so each paper compares
 * itself against the nine cells around it rather than against the whole
 * folder. A non-finite paper is hashed nowhere and joins nothing, which leaves
 * it a singleton rather than poisoning a component with a `NaN`.
 */
export function regionComponents(
  points: readonly RegionPoint[],
  radius: number,
): RegionPoint[][] {
  if (!points.length) return [];
  const reach = radius * 2;
  if (!(reach > 0) || !Number.isFinite(reach)) {
    return points.map((point) => [point]);
  }
  const finite = points.map(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
  );
  const cellOf = (value: number): number => Math.floor(value / reach);
  const buckets = new Map<string, number[]>();
  points.forEach((point, index) => {
    if (!finite[index]) return;
    const key = `${cellOf(point.x)}:${cellOf(point.y)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(index);
    else buckets.set(key, [index]);
  });

  const parent = points.map((_, index) => index);
  const find = (start: number): number => {
    let root = start;
    while (parent[root] !== root) root = parent[root];
    let walk = start;
    while (parent[walk] !== root) {
      const next = parent[walk];
      parent[walk] = root;
      walk = next;
    }
    return root;
  };
  const join = (first: number, second: number): void => {
    const rootFirst = find(first);
    const rootSecond = find(second);
    if (rootFirst !== rootSecond) parent[rootSecond] = rootFirst;
  };

  const reachSquared = reach * reach;
  points.forEach((point, index) => {
    if (!finite[index]) return;
    const column = cellOf(point.x);
    const row = cellOf(point.y);
    for (let dc = -1; dc <= 1; dc += 1) {
      for (let dr = -1; dr <= 1; dr += 1) {
        for (const other of buckets.get(`${column + dc}:${row + dr}`) ?? []) {
          if (other <= index) continue;
          const dx = points[other].x - point.x;
          const dy = points[other].y - point.y;
          if (dx * dx + dy * dy < reachSquared) join(index, other);
        }
      }
    }
  });

  const groups = new Map<number, RegionPoint[]>();
  points.forEach((point, index) => {
    const root = find(index);
    const group = groups.get(root);
    if (group) group.push(point);
    else groups.set(root, [point]);
  });
  return [...groups.values()];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run check`
Expected: PASS, lint and typecheck clean, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/services/graphFolderRegion.ts test/unit/graphFolderRegion.test.ts
git commit -m "feat: partition a folder's papers into 2R components (task 2)"
```

---

### Task 3: `FolderRegionShapes` — a disc for a singleton, a loop for a cluster

The return type changes, every component samples **one shared lattice**, a
singleton becomes an exact circle of radius `radius * Math.sqrt(1 - threshold)`
(derived, never written as a constant, so a future threshold cannot silently
break it), and `regionPathFor` emits an `arc()` for it.

The constants do **not** move in this task. That is what makes the
byte-identical claim testable: Step 1's shared-lattice case asserts the
cluster's loop against what today's whole-folder grid produces, and the golden's
first triple must not budge.

**Files:**

- Modify: `src/services/graphFolderRegion.ts`
- Modify: `src/services/citationGraphRenderer.ts` (~line 1297, ~line 1405)
- Test: `test/unit/graphFolderRegion.test.ts`
- Test: `test/unit/citationGraphRendererRegions.test.ts`

**Interfaces:**

- Consumes: `regionComponents` from Task 2.
- Produces:

```ts
export interface RegionDisc {
  centre: RegionPoint;
  radius: number;
}

export interface FolderRegionShapes {
  /** The falloff radius the shapes were built at, in data units. */
  radius: number;
  /** The lattice pitch they were built at, in data units. */
  pitch: number;
  discs: RegionDisc[];
  loops: RegionPoint[][];
}

export function folderRegionContours(
  points: readonly RegionPoint[],
  options: FolderRegionOptions,
): FolderRegionShapes;

export function regionPathFor(
  view: Window | null,
  shapes: FolderRegionShapes,
  project: (point: RegionPoint) => RegionPoint,
  scale: number,
): Path2D | null;
```

Task 4 adds the resampler inside `regionPathFor` and reads `shapes.pitch`;
nothing else consumes these.

- [ ] **Step 1: Write the failing tests**

In `test/unit/graphFolderRegion.test.ts`, add `type FolderRegionShapes` to the
import list, then **replace** the existing cases named below and add the new
ones. Everything not named here stays exactly as it is.

Replace `"draws nothing for a folder with no papers"`:

```ts
it("draws nothing for a folder with no papers", function () {
  expect(folderRegionContours([], OPTIONS)).to.deep.equal({
    radius: 0,
    pitch: 0,
    discs: [],
    loops: [],
  });
});
```

Replace `"draws one closed loop around a single paper"` — a lone paper is a
disc now, and its radius is exact rather than a grid's best effort:

```ts
it("draws an exact circle around a single paper", function () {
  const shapes = folderRegionContours([{ x: 0, y: 0 }], OPTIONS);
  expect(shapes.loops).to.have.length(0);
  expect(shapes.discs).to.have.length(1);
  expect(shapes.discs[0].centre).to.deep.equal({ x: 0, y: 0 });
  // The field is `1 - d^2/R^2` and the threshold is 0.5, so the contour of
  // a lone paper is the circle `R * sqrt(1 - t)` — an exact answer, and one
  // no grid and no fit can improve on.
  expect(shapes.discs[0].radius).to.be.closeTo(10 / Math.SQRT2, 1e-12);
});
```

Replace `"merges papers that sit close together into one loop"`:

```ts
it("merges papers that sit close together into one loop", function () {
  const shapes = folderRegionContours(
    [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
    ],
    OPTIONS,
  );
  expect(shapes.discs).to.have.length(0);
  expect(shapes.loops).to.have.length(1);
  expect(extent(shapes.loops[0])).to.be.greaterThan(14);
});
```

Replace `"leaves distant papers as separate islands"`:

```ts
it("leaves distant papers as separate discs", function () {
  const shapes = folderRegionContours(
    [
      { x: 0, y: 0 },
      { x: 80, y: 0 },
    ],
    OPTIONS,
  );
  expect(shapes.loops).to.have.length(0);
  expect(shapes.discs).to.have.length(2);
});
```

Replace `"draws a hole as its own loop when papers ring an empty middle"`'s last
two lines with:

```ts
const shapes = folderRegionContours(ring, { radius: 10, pitch: 2 });
// An outer loop and an inner one: the ring's middle is below threshold.
expect(shapes.loops.length).to.be.at.least(2);
```

Replace `"closes a contour whose papers sit at the extreme of the plot"` — it
needs a cluster now, since a lone paper no longer reaches the grid at all:

```ts
it("closes a contour whose papers sit at the extreme of the plot", function () {
  // The grid must extend past the nodes' bounding box, or the loop is cut
  // square at the edge instead of tapering shut. Two papers, not one: a
  // singleton is an exact circle and never touches the grid.
  const shapes = folderRegionContours(
    [
      { x: 1000, y: -1000 },
      { x: 1006, y: -1000 },
    ],
    OPTIONS,
  );
  expect(shapes.loops).to.have.length(1);
  const loop = shapes.loops[0];
  expect(
    Math.hypot(
      loop[0].x - loop[loop.length - 1].x,
      loop[0].y - loop[loop.length - 1].y,
    ),
  ).to.be.below(0.001);
});
```

In `"gives the same contour for the same input, deterministically"`, replace the
final two assertions:

```ts
expect(twice).to.deep.equal(once);
expect(once.loops).to.have.length(1);
```

In `"resolves a saddle without crossing itself"`, replace the last four lines:

```ts
expect(shapes.loops.length).to.be.at.least(1);
for (const loop of shapes.loops) {
  expect(loop.length).to.be.greaterThan(6);
}
```

(rename its local `const contours` to `const shapes` throughout that case.)

Replace `"coarsens rather than allocating an unbounded grid"` — its old fixture
is two papers 7071 apart, which are now two discs and never build a grid:

```ts
/** A pitch small enough to blow the cell budget is coarsened rather than
 *  allocated. The fixture must be one *component*, since discs cost no
 *  cells at all: a chain whose every hop is inside 2R but whose ends are
 *  5000 apart. With the shipped constants this cannot happen in the
 *  product; it is a guard against a later change moving them. */
it("coarsens rather than allocating an unbounded grid", function () {
  const chain: RegionPoint[] = [];
  for (let x = 0; x <= 5000; x += 150) chain.push({ x, y: 0 });
  const shapes = folderRegionContours(chain, { radius: 100, pitch: 0.05 });
  expect(shapes.loops.length).to.be.at.least(1);
  expect(shapes.pitch).to.be.greaterThan(0.05);
});
```

Replace the golden's tail — its first triple is untouched, its second becomes
the disc assertion:

```ts
it("sums the field to the same contour however it is accumulated", function () {
  const shapes = folderRegionContours(
    [
      { x: 0, y: 0 },
      { x: 14, y: 3 },
      { x: 7, y: 16 },
      { x: 40, y: 40 },
    ],
    { radius: 10, pitch: 2 },
  );
  expect(shapes.loops).to.have.length(1);
  const loop = shapes.loops[0];
  expect(loop.length).to.equal(68);
  expect(loop.reduce((total, point) => total + point.x, 0)).to.be.closeTo(
    475.8592418546,
    1e-6,
  );
  expect(loop.reduce((total, point) => total + point.y, 0)).to.be.closeTo(
    439.205775052,
    1e-6,
  );
  // The fourth paper is 40-odd units from the nearest of the other three,
  // well past 2R, so it leaves the loop list and comes back as an exact
  // disc. Its old triple (26, 1040, 1014) was a grid's approximation of
  // this circle.
  expect(shapes.discs).to.have.length(1);
  expect(shapes.discs[0].centre).to.deep.equal({ x: 40, y: 40 });
  expect(shapes.discs[0].radius).to.be.closeTo(10 / Math.SQRT2, 1e-12);
});
```

Now add the new cases, at the end of the same `describe` block:

```ts
/**
 * The shared lattice, asserted rather than assumed. Every component is
 * sampled on the folder's own lattice — the folder's pitch, anchored at the
 * folder's min corner — so a component sees exactly the cell corners it saw
 * when the whole folder was one grid. At a given radius and pitch, every
 * surviving loop is therefore byte-identical to the one that shipped.
 *
 * Anchoring each component at its own min corner instead would shift the
 * sampling lattice per component and move every vertex slightly: a visible
 * change nobody asked for, and one that would have forced the golden above
 * to be re-recorded.
 */
it("samples every component on one lattice, so a loop is unchanged by a distant paper", function () {
  const cluster = [
    { x: 0, y: 0 },
    { x: 14, y: 3 },
    { x: 7, y: 16 },
  ];
  const alone = folderRegionContours(cluster, { radius: 10, pitch: 2 });
  const withDistant = folderRegionContours([...cluster, { x: 40, y: 40 }], {
    radius: 10,
    pitch: 2,
  });
  expect(withDistant.loops[0]).to.deep.equal(alone.loops[0]);
});

it("reports the radius and the pitch it built the shapes at", function () {
  const shapes = folderRegionContours(
    [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
    ],
    OPTIONS,
  );
  expect(shapes.radius).to.equal(10);
  expect(shapes.pitch).to.equal(2);
});

it("returns shapes and throws nothing on degenerate folders", function () {
  // `draw()` latches `canvasError` after one throw, so this asserts the
  // absence of an exception rather than any shape.
  const abuse: Array<[RegionPoint[], { radius: number; pitch: number }]> = [
    [[], OPTIONS],
    [[{ x: 0, y: 0 }], OPTIONS],
    [
      [
        { x: 3, y: 3 },
        { x: 3, y: 3 },
      ],
      OPTIONS,
    ],
    [[{ x: Number.NaN, y: 0 }], OPTIONS],
    [
      [
        { x: 0, y: 0 },
        { x: 1, y: Number.POSITIVE_INFINITY },
      ],
      OPTIONS,
    ],
    [[{ x: 0, y: 0 }], { radius: 0, pitch: 2 }],
    [[{ x: 0, y: 0 }], { radius: 10, pitch: 0 }],
    [[{ x: 0, y: 0 }], { radius: Number.NaN, pitch: Number.NaN }],
  ];
  for (const [points, options] of abuse) {
    let shapes: FolderRegionShapes | null = null;
    expect(() => {
      shapes = folderRegionContours(points, options);
    }, JSON.stringify(points)).to.not.throw();
    expect(shapes).to.not.equal(null);
    for (const loop of shapes!.loops) {
      for (const point of loop) {
        expect(Number.isFinite(point.x) && Number.isFinite(point.y)).to.equal(
          true,
        );
      }
    }
  }
});

it("emits one arc per disc and no curve", function () {
  const { view } = recordingView();
  const path = regionPathFor(
    view,
    {
      radius: 10,
      pitch: 2,
      discs: [{ centre: { x: 4, y: 5 }, radius: 7 }],
      loops: [],
    },
    (point: RegionPoint) => ({ x: point.x * 3, y: point.y * 3 }),
    3,
  );
  const commands = (path as unknown as RecordingPath).commands;
  expect(commands.map((command) => command.op)).to.deep.equal([
    "moveTo",
    "arc",
    "closePath",
  ]);
  // `arc()` continues the current subpath, so the disc opens its own with a
  // moveTo onto the circle; without it a disc after a loop is joined to it
  // by a straight line across the plot.
  expect(commands[0].args).to.deep.equal([12 + 21, 15]);
  expect(commands[1].args[0]).to.equal(12);
  expect(commands[1].args[1]).to.equal(15);
  expect(commands[1].args[2]).to.equal(21);
  expect(commands.some((command) => command.op === "bezierCurveTo")).to.equal(
    false,
  );
});

it("draws discs and loops onto one path", function () {
  const path = regionPathFor(
    recordingView().view,
    {
      radius: 10,
      pitch: 0,
      discs: [{ centre: { x: 100, y: 0 }, radius: 5 }],
      loops: [
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
      ],
    },
    IDENTITY,
    1,
  );
  const ops = (path as unknown as RecordingPath).commands.map((c) => c.op);
  expect(ops.filter((op) => op === "arc")).to.have.length(1);
  expect(ops.filter((op) => op === "bezierCurveTo")).to.have.length(4);
});

it("skips a disc it cannot draw rather than emitting a NaN arc", function () {
  const path = regionPathFor(
    recordingView().view,
    {
      radius: 10,
      pitch: 0,
      discs: [
        { centre: { x: Number.NaN, y: 0 }, radius: 5 },
        { centre: { x: 0, y: 0 }, radius: 0 },
        { centre: { x: 0, y: 0 }, radius: Number.POSITIVE_INFINITY },
      ],
      loops: [],
    },
    IDENTITY,
    1,
  );
  expect((path as unknown as RecordingPath).commands).to.deep.equal([]);
});
```

Finally, every remaining `regionPathFor(...)` call in this file takes the new
signature. Add this helper just below `IDENTITY` and rewrite each existing call
to use it:

```ts
/**
 * A shapes object carrying nothing but loops, with `pitch: 0`.
 *
 * A zero pitch turns the arc-length resampler off (its spacing is
 * `pitch * scale`, and a non-positive spacing returns the ring untouched), so
 * these cases see the B-spline fit alone. That is what keeps every
 * hand-checked control point below a statement about the fit rather than about
 * the resampler that now feeds it.
 */
function fitOnly(loops: RegionPoint[][]): FolderRegionShapes {
  return { radius: 10, pitch: 0, discs: [], loops };
}
```

So, for example, `regionPathFor(view, [ring], IDENTITY)` becomes
`regionPathFor(view, fitOnly([ring]), IDENTITY, 1)`, and
`regionPathFor(recordingView().view, [], IDENTITY)` becomes
`regionPathFor(recordingView().view, fitOnly([]), IDENTITY, 1)`. The
`"returns null when the window has no Path2D at all"` case becomes:

```ts
it("returns null when the window has no Path2D at all", function () {
  expect(
    regionPathFor(
      {} as unknown as Window,
      fitOnly([[{ x: 0, y: 0 }]]),
      (p: RegionPoint) => p,
      1,
    ),
  ).to.equal(null);
});
```

The `centroid` helper at the top of the file was used only by the single-paper
case this step rewrites. Delete it — an unused local is a lint failure — and
leave `extent`, which the merge case still uses.

Also add `arc` to the test file's own `RecordingPath` class, matching the one in
`graphRendererDoubles.ts`:

```ts
  arc(...args: number[]): void {
    this.commands.push({ op: "arc", args });
  }
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run test:unit`
Expected: FAIL, many cases, with type and shape errors — `shapes.loops is not
iterable`, `expected [ Array ] to deep equal { radius: 0, ... }`. This is a
type-level change; a wall of red here is correct.

- [ ] **Step 3: Rewrite `folderRegionContours`**

In `src/services/graphFolderRegion.ts`, add the two interfaces immediately after
`FolderRegionOptions`:

```ts
/** A lone paper's contour: the exact circle `radius * sqrt(1 - threshold)`. */
export interface RegionDisc {
  centre: RegionPoint;
  radius: number;
}

/**
 * A folder's territory: a disc per isolated paper, a loop per cluster.
 *
 * `radius` and `pitch` are the values the shapes were actually built at, and
 * they travel with the shapes rather than being passed alongside them, so the
 * path builder cannot be handed one frame's pitch and another frame's loops.
 */
export interface FolderRegionShapes {
  /** The falloff radius the shapes were built at, in data units. */
  radius: number;
  /** The lattice pitch they were built at, in data units. */
  pitch: number;
  discs: RegionDisc[];
  loops: RegionPoint[][];
}
```

Replace the whole body of `folderRegionContours` (lines ~238-322) with:

```ts
/**
 * How many cells a component's own grid needs at a given pitch, including the
 * margin the field needs to taper shut inside the grid.
 */
function componentCells(
  component: readonly RegionPoint[],
  cellPitch: number,
  margin: number,
): number {
  const xs = component.map((point) => point.x);
  const ys = component.map((point) => point.y);
  const width = Math.max(...xs) - Math.min(...xs) + 2 * margin;
  const height = Math.max(...ys) - Math.min(...ys) + 2 * margin;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return 0;
  return (
    (Math.ceil(width / cellPitch) + 1) * (Math.ceil(height / cellPitch) + 1)
  );
}

/**
 * One cluster's contour, sampled on the folder's shared lattice.
 *
 * The grid's origin is the folder's min corner stepped outward by whole cells
 * — never the component's own min corner — so the cell corners a component
 * sees are exactly the ones it would see on a single folder-wide grid. That is
 * what makes the decomposition byte-identical rather than merely equivalent.
 */
function componentLoops(
  component: readonly RegionPoint[],
  originX: number,
  originY: number,
  cellPitch: number,
  radius: number,
  threshold: number,
): RegionPoint[][] {
  const margin = radius * DOMAIN_MARGIN;
  const xs = component.map((point) => point.x);
  const ys = component.map((point) => point.y);
  const startColumn = Math.floor(
    (Math.min(...xs) - margin - originX) / cellPitch,
  );
  const startRow = Math.floor((Math.min(...ys) - margin - originY) / cellPitch);
  const minX = originX + startColumn * cellPitch;
  const minY = originY + startRow * cellPitch;
  const columns = Math.ceil((Math.max(...xs) + margin - minX) / cellPitch) + 1;
  const rows = Math.ceil((Math.max(...ys) + margin - minY) / cellPitch) + 1;
  if (!Number.isFinite(columns) || !Number.isFinite(rows)) return [];
  if (columns < 2 || rows < 2) return [];

  // Each paper's bump has compact support, so the field is accumulated by
  // stamping every node into the cells inside its own footprint rather than
  // evaluating every node against every cell. Same sum, different order:
  // O(nodes x (radius/pitch)^2) instead of O(cells x nodes), which is what
  // keeps the cost flat as the falloff tightens with the zoom (D6).
  const values = new Float64Array(rows * columns);
  const squared = radius * radius;
  const reach = Math.ceil(radius / cellPitch);
  for (const point of component) {
    const centreColumn = Math.round((point.x - minX) / cellPitch);
    const centreRow = Math.round((point.y - minY) / cellPitch);
    const firstRow = Math.max(0, centreRow - reach);
    const lastRow = Math.min(rows - 1, centreRow + reach);
    const firstColumn = Math.max(0, centreColumn - reach);
    const lastColumn = Math.min(columns - 1, centreColumn + reach);
    for (let row = firstRow; row <= lastRow; row += 1) {
      const dy = minY + row * cellPitch - point.y;
      const dySquared = dy * dy;
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        const dx = minX + column * cellPitch - point.x;
        const distance = dx * dx + dySquared;
        if (distance < squared) {
          values[row * columns + column] += 1 - distance / squared;
        }
      }
    }
  }

  const segments: Array<[RegionPoint, RegionPoint]> = [];
  for (let row = 0; row + 1 < rows; row += 1) {
    for (let column = 0; column + 1 < columns; column += 1) {
      const left = minX + column * cellPitch;
      const right = left + cellPitch;
      const top = minY + row * cellPitch;
      const bottom = top + cellPitch;
      segments.push(
        ...cellSegments(
          [
            { x: left, y: top },
            { x: right, y: top },
            { x: right, y: bottom },
            { x: left, y: bottom },
          ],
          [
            values[row * columns + column],
            values[row * columns + column + 1],
            values[(row + 1) * columns + column + 1],
            values[(row + 1) * columns + column],
          ],
          threshold,
        ),
      );
    }
  }

  return stitch(segments);
}

/**
 * A folder's territory as shapes: an exact circle for every paper no other
 * paper can reach, and a marching-squares blob for every cluster.
 *
 * The papers are partitioned under "closer than 2R" (`regionComponents`),
 * which is a decomposition and not an approximation — past 2R the supports are
 * disjoint. A singleton's contour is then the circle
 * `radius * sqrt(1 - threshold)`, derived here rather than written as a
 * constant so that moving the threshold cannot silently break it, and it is
 * right at every zoom for no work at all. Only clusters build a grid, which
 * inverts the cost curve: zoomed in, nearly every paper is a singleton, so a
 * large folder at maximum zoom is the *cheapest* case rather than the most
 * expensive.
 *
 * Every component shares one lattice — the folder's pitch, anchored at the
 * folder's min corner — so at a given radius and pitch every surviving loop is
 * byte-identical to the one a single folder-wide grid produced.
 */
export function folderRegionContours(
  points: readonly RegionPoint[],
  options: FolderRegionOptions,
): FolderRegionShapes {
  const radius = options.radius;
  const pitch = options.pitch;
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const nothing: FolderRegionShapes = {
    radius: 0,
    pitch: 0,
    discs: [],
    loops: [],
  };
  if (!points.length) return nothing;
  if (!(radius > 0) || !Number.isFinite(radius)) return nothing;
  if (!(pitch > 0) || !Number.isFinite(pitch)) return nothing;

  const margin = radius * DOMAIN_MARGIN;
  const components = regionComponents(points, radius);
  const discRadius = radius * Math.sqrt(Math.max(0, 1 - threshold));
  const discs: RegionDisc[] = [];
  const clusters: RegionPoint[][] = [];
  for (const component of components) {
    if (component.length === 1) {
      discs.push({ centre: component[0], radius: discRadius });
    } else {
      clusters.push(component);
    }
  }

  // The folder's own min corner, which anchors every component's grid.
  const originX = Math.min(...points.map((point) => point.x)) - margin;
  const originY = Math.min(...points.map((point) => point.y)) - margin;

  // Coarsen rather than allocate: the budget is the *sum* across the folder's
  // components, and exceeding it coarsens every component by the same factor,
  // so the shared lattice survives. Cells go as 1/pitch^2, so one scaling by
  // sqrt(cells / budget) brings the total back inside it.
  let cellPitch = pitch;
  let cells = 0;
  for (const cluster of clusters) {
    cells += componentCells(cluster, cellPitch, margin);
  }
  if (cells > MAX_GRID_CELLS) {
    cellPitch = pitch * Math.sqrt(cells / MAX_GRID_CELLS);
  }

  const loops: RegionPoint[][] = [];
  for (const cluster of clusters) {
    loops.push(
      ...componentLoops(
        cluster,
        originX,
        originY,
        cellPitch,
        radius,
        threshold,
      ),
    );
  }

  return { radius, pitch: cellPitch, discs, loops };
}
```

- [ ] **Step 4: Give `regionPathFor` the new signature and the arc**

Replace `regionPathFor`'s signature and the head of its body:

```ts
export function regionPathFor(
  view: Window | null,
  shapes: FolderRegionShapes,
  project: (point: RegionPoint) => RegionPoint,
  scale: number,
): Path2D | null {
  const constructor = (view as any)?.Path2D as typeof Path2D | undefined;
  if (!constructor) return null;
  const path = new constructor();
  for (const disc of shapes.discs) {
    const centre = project(disc.centre);
    const radius = disc.radius * scale;
    if (!Number.isFinite(centre.x) || !Number.isFinite(centre.y)) continue;
    if (!(radius > 0) || !Number.isFinite(radius)) continue;
    // `arc()` joins the current subpath to the circle with a straight line
    // when one is open, so every disc opens its own with a moveTo onto its
    // rim. `evenodd` needs no winding help beyond that: a disc sitting inside
    // a cluster's hole crosses the outer loop, the hole loop and itself — an
    // odd count — so it fills.
    path.moveTo(centre.x + radius, centre.y);
    path.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
    path.closePath();
  }
  for (const loop of shapes.loops) {
```

The rest of the loop body — `ringOf`, the two-point `lineTo` branch and the
B-spline fit — is unchanged, as is the closing `return path;`.

- [ ] **Step 5: Move the renderer onto the new type**

In `src/services/citationGraphRenderer.ts`, add `type FolderRegionShapes` to the
existing import block from `./graphFolderRegion`, and change `regionsFor`'s
return type (~line 1297):

```ts
  private regionsFor(
    plot: PlotRect,
    scale: number,
  ): Map<number, FolderRegionShapes> {
```

Change the declared type of the `regionContours` field to match. Find it with:

```bash
grep -n "regionContours" src/services/citationGraphRenderer.ts
```

and change `private regionContours = new Map<number, RegionPoint[][]>();` to
`private regionContours = new Map<number, FolderRegionShapes>();`.

Then in `drawRegions` (~line 1405), replace:

```ts
const loops = contours.get(region.collectionID) ?? [];
if (!loops.length) continue;
const path = regionPathFor(
  this.canvas.ownerDocument.defaultView,
  loops,
  (point) => this.projectToScreen(point),
);
```

with:

```ts
const shapes = contours.get(region.collectionID);
if (!shapes) continue;
if (!shapes.discs.length && !shapes.loops.length) continue;
const path = regionPathFor(
  this.canvas.ownerDocument.defaultView,
  shapes,
  (point) => this.projectToScreen(point),
  this.transform.scale,
);
```

Rename the local `const contours = this.regionsFor(...)` to `const shapesByFolder`
if the shadowing reads badly; otherwise leave it.

- [ ] **Step 6: Teach the renderer's zoom case about discs**

In `test/unit/citationGraphRendererRegions.test.ts`, the case
`"pulls a territory apart on a zoom but recomputes nothing on a pan"` counts
`moveTo` commands to count territories. That still works — a disc opens with a
`moveTo` too — but the comment is now wrong. Replace the `loopsDrawn` helper and
its two assertion messages:

```ts
// Each territory opens its own subpath: a cluster with a moveTo onto
// the fit's first on-curve point, a lone paper with a moveTo onto its
// circle's rim before the arc.
const territoriesDrawn = (path: FakePath2D): number =>
  path.commands.filter((command) => command.op === "moveTo").length;
```

and rename the two call sites to `territoriesDrawn`, with messages
`"at the fit zoom the close pair is one territory and the far paper another"`
and `"zoomed in, the territory is three separate papers"`. The expected counts,
2 and 3, do not change.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm run check`
Expected: PASS, lint and typecheck clean, `fail 0`. In particular the golden's
three numbers — 68, 475.8592418546, 439.205775052 — must be untouched. **If they
fail, the code is wrong, not the golden**: check that the component grid is
anchored at the folder's min corner and stepped by whole cells.

- [ ] **Step 8: Commit**

```bash
git add src/services/graphFolderRegion.ts src/services/citationGraphRenderer.ts test/unit/graphFolderRegion.test.ts test/unit/citationGraphRendererRegions.test.ts
git commit -m "feat: draw a lone paper as an exact disc and a cluster as a loop (task 3)"
```

---

### Task 4: The arc-length resampler

The measured cause of the wobble is **parameterisation**, not grid jitter:
Newton-refining every vertex onto the exact level set — removing quantisation
jitter entirely — improved smoothness by nothing (curvature sd 0.0511 → 0.0514),
while evening the spacing did (0.0416). D6's spec and this module's docstring
both name the wrong cause, and are corrected here, in the commit that makes the
correction true.

The divisions live in the resampler, where a degenerate ring falls back cleanly,
and not in the fit, which stays free of denominators. That is the whole reason a
non-uniform knot vector was rejected: `draw()` latches `canvasError`.

**Files:**

- Modify: `src/services/graphFolderRegion.ts`
- Modify: `docs/superpowers/specs/2026-09-10-graph-region-curves-design.md`
- Test: `test/unit/graphFolderRegion.test.ts`

**Interfaces:**

- Consumes: `FolderRegionShapes` from Task 3.
- Produces:
  `export function resampleRing(ring: readonly RegionPoint[], spacing: number): RegionPoint[]`
  and `const RESAMPLE_PITCH_FACTOR = 1` (module-private). Task 6 moves that
  constant's neighbours, not this one.

- [ ] **Step 1: Write the failing tests**

Add `resampleRing` to the import list, then append to
`describe("folder regions", ...)`:

```ts
/**
 * The uneven ring these cases share: sixty vertices on a circle of radius
 * 100, with the angular gaps alternating 0.3x and 1.7x of even. No radial
 * jitter at all — the vertices lie exactly on the circle — so anything the
 * fitted curve does other than trace that circle is a parameterisation
 * artefact and nothing else. That is the isolation the measurement in the
 * spec made, reproduced as a fixture.
 */
function unevenRing(): RegionPoint[] {
  const ring: RegionPoint[] = [];
  const base = (2 * Math.PI) / 60;
  let angle = 0;
  const push = (): void => {
    ring.push({ x: Math.cos(angle) * 100, y: Math.sin(angle) * 100 });
  };
  for (let pair = 0; pair < 30; pair += 1) {
    push();
    angle += base * 0.3;
    push();
    angle += base * 1.7;
  }
  return ring;
}

function spacingsOf(ring: readonly RegionPoint[]): number[] {
  return ring.map((point, index) => {
    const next = ring[(index + 1) % ring.length];
    return Math.hypot(next.x - point.x, next.y - point.y);
  });
}

/** How far the fitted curve wanders in and out, sampled along every span:
 *  the radial spread of the curve, which is what "wobble" means here. */
function radialRange(shapes: FolderRegionShapes): number {
  const path = regionPathFor(
    recordingView().view,
    shapes,
    IDENTITY,
    1,
  ) as unknown as RecordingPath;
  const radii: number[] = [];
  let current = path.commands[0].args;
  for (const command of path.commands.slice(1)) {
    if (command.op !== "bezierCurveTo") continue;
    const c1 = command.args.slice(0, 2);
    const c2 = command.args.slice(2, 4);
    const end = command.args.slice(4, 6);
    for (let step = 0; step < 16; step += 1) {
      const t = step / 16;
      const u = 1 - t;
      const x =
        u * u * u * current[0] +
        3 * u * u * t * c1[0] +
        3 * u * t * t * c2[0] +
        t * t * t * end[0];
      const y =
        u * u * u * current[1] +
        3 * u * u * t * c1[1] +
        3 * u * t * t * c2[1] +
        t * t * t * end[1];
      radii.push(Math.hypot(x, y));
    }
    current = end;
  }
  return Math.max(...radii) - Math.min(...radii);
}

/**
 * The discriminating test, and the reason the resampler exists.
 *
 * D6's existing jitter case is *not* discriminating: the measurement in the
 * spec showed the shipping fit already handles radial jitter and fails on
 * uneven spacing. This one holds the vertices exactly on a circle and varies
 * only their spacing, so the fit has nothing to smooth away and only the
 * parameterisation can be at fault.
 *
 * Measured on this fixture: 0.3198 without the resampler, 0.1285 with it, a
 * 2.5x improvement. The assertion asks for half, which leaves the margin
 * the numbers deserve and still fails outright on today's code, where both
 * sides are the same path.
 */
it("evens the spacing so the fit stops wobbling", function () {
  const ring = unevenRing();
  const spacings = spacingsOf(ring);
  expect(Math.max(...spacings) / Math.min(...spacings)).to.be.greaterThan(
    5,
    "the fixture must actually be unevenly spaced",
  );

  const withoutResampling = radialRange(fitOnly([ring]));
  // The ring's perimeter is about 628, so a pitch of 10 asks for 63 points
  // and the never-upsample rule caps it at the source's own 60: the same
  // vertex count, evenly spaced.
  const withResampling = radialRange({
    radius: 10,
    pitch: 10,
    discs: [],
    loops: [ring],
  });

  expect(
    withResampling,
    "resampling to even arc length should halve the curve's wobble",
  ).to.be.lessThan(withoutResampling / 2);
});

it("resamples a ring to even spacing without adding vertices", function () {
  const ring = unevenRing();
  const even = resampleRing(ring, 10);
  expect(even.length).to.equal(60);
  const spacings = spacingsOf(even);
  // Chords, not arcs: an interval that happens to straddle one of the
  // source polyline's corners is a hair shorter than one that does not, so
  // this is even to within a fraction of a percent rather than exactly.
  expect(Math.max(...spacings) / Math.min(...spacings)).to.be.lessThan(1.02);
});

it("never sharpens a ring that is already at the pitch", function () {
  // Upsampling inserts points along straight chords: no new information,
  // but more control points, which un-smooths the fit back toward the
  // polyline it came from. Tying the spacing to the pitch is what makes
  // that impossible.
  const ring: RegionPoint[] = [];
  for (let index = 0; index < 40; index += 1) {
    const angle = (index / 40) * 2 * Math.PI;
    ring.push({ x: Math.cos(angle) * 100, y: Math.sin(angle) * 100 });
  }
  expect(resampleRing(ring, 0.1).length).to.equal(40);
  expect(resampleRing(ring, 1e-9).length).to.equal(40);
});

it("returns a ring and throws nothing on degenerate resampling input", function () {
  const cases: Array<[RegionPoint[], number]> = [
    [[], 10],
    [[{ x: 1, y: 1 }], 10],
    [
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
      ],
      10,
    ],
    [
      [
        { x: 2, y: 2 },
        { x: 2, y: 2 },
        { x: 2, y: 2 },
      ],
      10,
    ],
    [
      [
        { x: Number.NaN, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ],
      10,
    ],
    [
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 9 },
      ],
      0,
    ],
    [
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 9 },
      ],
      Number.NaN,
    ],
    [
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 9 },
      ],
      Number.POSITIVE_INFINITY,
    ],
  ];
  for (const [ring, spacing] of cases) {
    let result: RegionPoint[] | null = null;
    expect(
      () => {
        result = resampleRing(ring, spacing);
      },
      `${JSON.stringify(ring)} at ${spacing}`,
    ).to.not.throw();
    expect(Array.isArray(result)).to.equal(true);
  }
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run test:unit`
Expected: FAIL — `resampleRing is not a function`, and
`"evens the spacing so the fit stops wobbling"` failing with
`expected 0.3198… to be below 0.1599…`, since without the resampler both sides
of the comparison are the same number.

- [ ] **Step 3: Implement the resampler and wire it in**

In `src/services/graphFolderRegion.ts`, add the constant beside `DEVICE_WELD`:

```ts
/**
 * The resampler's spacing, as a multiple of the projected lattice pitch.
 *
 * This is the smoothness knob, and it is the honest one: coarser is smoother
 * and loses genuine detail. Turn this, not the falloff, if a build still reads
 * wobbly. Deriving the spacing from the pitch rather than from a pixel
 * constant is what stops the resampler ever *up*sampling — inserting points
 * along straight chords adds no information but does add control points, which
 * un-smooths the fit back toward the polyline it came from.
 */
const RESAMPLE_PITCH_FACTOR = 1;
```

Add `resampleRing` just above `regionPathFor`:

```ts
/**
 * A ring re-emitted at even arc length, which is what the approximating fit
 * needs and what marching squares does not give it.
 *
 * A uniform B-spline gives every control point the same parameter interval, so
 * unevenly spaced vertices make the curvature vary for reasons that have
 * nothing to do with the shape — the wobble the reader sees. Evening the
 * spacing is the measured fix: on the spec's fixture it improves smoothness by
 * about a quarter on every measure, while removing grid quantisation jitter
 * entirely improves it by nothing at all.
 *
 * Total, and deliberately so: this is where the divisions live, so that the
 * fit downstream keeps no denominator that can vanish. A ring of fewer than
 * three points, a ring of zero or non-finite total length, and a spacing that
 * is not a positive finite number are all returned untouched rather than
 * divided by. `draw()` latches `canvasError` after one throw.
 *
 * The count is capped at the ring's own, so this can only ever even the
 * spacing out, never sharpen it.
 */
export function resampleRing(
  ring: readonly RegionPoint[],
  spacing: number,
): RegionPoint[] {
  if (ring.length < 3) return [...ring];
  if (!(spacing > 0) || !Number.isFinite(spacing)) return [...ring];
  const lengths: number[] = [];
  let total = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const from = ring[index];
    const to = ring[(index + 1) % ring.length];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    lengths.push(length);
    total += length;
  }
  if (!Number.isFinite(total) || total <= 0) return [...ring];

  const count = Math.min(ring.length, Math.max(3, Math.round(total / spacing)));
  const step = total / count;
  const resampled: RegionPoint[] = [];
  let segment = 0;
  let travelled = 0;
  for (let index = 0; index < count; index += 1) {
    const target = index * step;
    while (
      segment < lengths.length - 1 &&
      travelled + lengths[segment] < target
    ) {
      travelled += lengths[segment];
      segment += 1;
    }
    const from = ring[segment];
    const to = ring[(segment + 1) % ring.length];
    const fraction =
      lengths[segment] > 0 ? (target - travelled) / lengths[segment] : 0;
    resampled.push({
      x: from.x + (to.x - from.x) * fraction,
      y: from.y + (to.y - from.y) * fraction,
    });
  }
  return resampled;
}
```

Then in `regionPathFor`, replace the line that builds the ring:

```ts
const ring = ringOf(loop.map(project));
```

with:

```ts
const ring = resampleRing(
  ringOf(loop.map(project)),
  shapes.pitch * scale * RESAMPLE_PITCH_FACTOR,
);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run check`
Expected: PASS, `fail 0`. D6's own jitter case
(`"smooths grid jitter instead of reproducing it"`) must still pass — it runs
through `fitOnly`, so the resampler is off for it and it keeps testing what it
always tested.

- [ ] **Step 5: Correct the two passages that name the wrong cause**

In `src/services/graphFolderRegion.ts`, `regionPathFor`'s docstring says the
approximating fit exists so that "the jitter averages out". Replace that
paragraph with:

```
 * The outline is a uniform periodic cubic B-spline fit to the ring's
 * vertices — one cubic Bezier per vertex, wrapping because the loops are
 * closed — not a curve through them, and the ring is resampled to even arc
 * length first. An earlier version of this docstring blamed the wobble on
 * grid jitter; that was measured and it is wrong. Newton-refining every
 * vertex onto the exact level set, which removes quantisation jitter
 * entirely, improves smoothness by nothing at all (curvature sd 0.0511 to
 * 0.0514), while evening the spacing improves it by about a quarter
 * (0.0416). The wobble is a parameterisation artefact: a uniform B-spline
 * gives every control point the same parameter interval, so unevenly spaced
 * marching-squares vertices make the curvature vary for reasons that are not
 * about the shape. `resampleRing` is the fix; the approximating fit stays
 * because it keeps no denominator that can vanish. A polyline in data space
 * re-facets as you zoom in — its segments grow on screen with everything
 * else — while a curve does not, because the rasterizer flattens it in
 * device pixels.
```

Also correct `segmentControls`' docstring, whose second paragraph claims the
approximation is "exactly what averages away the jitter marching squares leaves
at nearby grid crossings". Replace that clause with "which is what lets the
curve ignore a control point's exact position while still following the ring —
the smoothing that matters is the even spacing `resampleRing` gives it, not the
approximation itself".

In `docs/superpowers/specs/2026-09-10-graph-region-curves-design.md`, find the
passage giving grid jitter as the reason for the approximating fit (search for
`jitter`) and append to it:

```markdown
**Correction, 2026-09-10 (region shapes).** The cause named above is wrong, and
it was measured rather than argued. On the same ring, fed to the same fit:
removing grid quantisation jitter entirely by Newton-refining every vertex onto
the exact level set changes the curvature standard deviation from 0.0511 to
0.0514 — no improvement at all — while evening the vertex spacing takes it to
0.0416. The wobble is a **parameterisation** artefact: a uniform B-spline gives
every control point the same parameter interval, so unevenly spaced
marching-squares vertices vary the curvature for reasons that are not about the
shape. The fit itself is unchanged and stays for the reason it always had — it
carries no denominator that can vanish, and `draw()` latches `canvasError`.
What changed is that the ring is resampled to even arc length before it
(`resampleRing`). See
`docs/superpowers/specs/2026-09-10-graph-region-shapes-design.md`.
```

- [ ] **Step 6: Run the checks again and commit**

Run: `npm run check`
Expected: PASS, `fail 0`.

```bash
git add src/services/graphFolderRegion.ts test/unit/graphFolderRegion.test.ts docs/superpowers/specs/2026-09-10-graph-region-curves-design.md
git commit -m "fix: resample a ring to even arc length before the fit (task 4)"
```

---

### Task 5: `cellSegments` returns early on an empty cell

Codes 0 and 15 — every corner below the threshold, or every corner above —
dominate a sparse field, and today each one allocates four closures before the
switch decides it needs none of them. This is the handoff's second open item,
closed here because it lives in the function whose caller Task 3 rewrote.

Behaviour must not change at all: the golden is what proves it.

**Files:**

- Modify: `src/services/graphFolderRegion.ts`
- Test: `test/unit/graphFolderRegion.test.ts` (no new case; the golden covers it)

**Interfaces:**

- Consumes: nothing new.
- Produces: nothing new.

- [ ] **Step 1: Record the golden's numbers before the change**

Run: `npm run test:unit 2>&1 | grep -c "^ℹ fail 0" || npm run test:unit`
Expected: PASS. The relevant case is "sums the field to the same contour however
it is accumulated"; it must be green going in, or this task cannot prove
anything.

- [ ] **Step 2: Add the early return**

In `cellSegments`, between the `code` computation and the four `const top =`
closures:

```ts
// An empty or a full cell crosses nothing, and these two codes dominate a
// sparse field: the four interpolators below are allocated on every cell
// and thrown away on most of them. Deciding before building them is the
// whole of this early return.
if (code === 0 || code === 15) return [];
```

Leave the `case 0: case 15: return [];` arm in the switch where it is: the
switch stays exhaustive over the sixteen codes, which is what
`noFallthroughCasesInSwitch` and the next reader both want.

- [ ] **Step 3: Run the tests to verify nothing moved**

Run: `npm run check`
Expected: PASS, `fail 0`, and specifically the golden's 68 /
475.8592418546 / 439.205775052 unchanged. Any movement here means the early
return is not equivalent — revert it rather than re-recording the golden.

- [ ] **Step 4: Commit**

```bash
git add src/services/graphFolderRegion.ts
git commit -m "perf: skip the interpolators on an empty marching-squares cell (task 5)"
```

---

### Task 6: The constants

The decomposition is what pays for these. Today's cells grow monotonically with
the zoom, which is exactly why the offset was stuck; per component they peak in
the middle and collapse, because at high zoom nearly every paper is a singleton
drawn as an arc with no grid at all. For a 300-paper folder at bucket 18: 451 k
cells today, 21 k per component, 5 k per component at the new constants.

`FALLOFF_FRACTION = 0.03` is **reasoned, not measured** — drawing lone papers as
exact arcs hands back about half a pixel of halo the fit's inward bias was
removing, so this is not simply "a quarter tighter". It is judged on a build,
and it is one character to move.

**Files:**

- Modify: `src/services/graphFolderRegion.ts`
- Modify: `docs/superpowers/specs/2026-09-10-graph-region-curves-design.md`
- Test: `test/unit/graphFolderRegion.test.ts`

**Interfaces:**

- Consumes: everything from Tasks 2-5.
- Produces: no signature changes. `regionGridPitch(r) === r / 3`,
  `regionFalloffRadius(spread, scale, fit)` at bucket 0 is `spread * 0.03`,
  `regionZoomBucket` clamps at 30.

- [ ] **Step 1: Write the failing tests**

In `test/unit/graphFolderRegion.test.ts`, inside
`describe("region zoom rules", ...)` where `SPREAD = 1000`, replace every
occurrence of the radius `40` with `30`, and rewrite the floor case and the
pitch case:

```ts
it("holds today's radius at and below the fit zoom", function () {
  expect(regionFalloffRadius(SPREAD, 1, 1)).to.equal(30);
  expect(regionFalloffRadius(SPREAD, 0.5, 1)).to.equal(30);
  expect(regionFalloffRadius(SPREAD, 0.15, 1)).to.equal(30);
  expect(regionZoomBucket(0.5, 1)).to.equal(0);
  expect(regionZoomBucket(1, 1)).to.equal(0);
});

it("tightens in 12% steps past the fit zoom", function () {
  expect(regionZoomBucket(1.12, 1)).to.equal(1);
  expect(regionFalloffRadius(SPREAD, 1.12, 1)).to.be.closeTo(30 / 1.12, 1e-9);
  expect(regionZoomBucket(1.12 ** 4, 1)).to.equal(4);
  expect(regionFalloffRadius(SPREAD, 1.12 ** 4, 1)).to.be.closeTo(
    30 / 1.12 ** 4,
    1e-9,
  );
  // The fit zoom moves the crossover with it, rather than the crossover
  // being a fixed scale.
  expect(regionZoomBucket(2.24, 2)).to.equal(1);
  expect(regionZoomBucket(1.5, 3)).to.equal(0);
});

/**
 * D6 floored the tightening at roughly 8x (`1.12 ** 18`) for work and
 * memory, with the acknowledged cost that past 8x the halo starts growing on
 * screen again — the original complaint returning in the far corner of the
 * zoom range. The decomposition inverts that cost curve, so the floor moves
 * out to where the zoom range actually ends: the viewport scale clamps at 8
 * while `fitScale` can sit well below 1, so a ratio in the twenties is
 * reachable on an ordinary graph, and `1.12 ** 30` is about 30.
 */
it("stops tightening at the 30-bucket ceiling", function () {
  expect(regionZoomBucket(1.12 ** 30, 1)).to.equal(30);
  expect(regionZoomBucket(1.12 ** 60, 1)).to.equal(30);
  expect(regionFalloffRadius(SPREAD, 1e6, 1)).to.be.closeTo(
    30 / 1.12 ** 30,
    1e-9,
  );
});

it("keeps the pitch a third of the radius", function () {
  // The pitch's only job is contour accuracy now: the fit's control-point
  // spacing is the resampler's, not the grid's, so a fifth was buying
  // 0.14 px of fidelity under a curve that misses by 0.51 px.
  expect(regionGridPitch(regionFalloffRadius(SPREAD, 1, 1))).to.equal(10);
  expect(regionGridPitch(30 / 1.12)).to.be.closeTo(10 / 1.12, 1e-9);
});
```

And in `"falls back to bucket zero rather than NaN on degenerate input"`,
change the two lines that name the old numbers:

```ts
expect(regionZoomBucket(Number.POSITIVE_INFINITY, 1)).to.equal(30);
expect(regionFalloffRadius(SPREAD, 1, 0)).to.equal(30);
expect(regionFalloffRadius(SPREAD, Number.NaN, 1)).to.equal(30);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run test:unit`
Expected: FAIL in `region zoom rules` — `expected 40 to equal 30`.

- [ ] **Step 3: Move the four constants**

In `src/services/graphFolderRegion.ts`:

```ts
const MAX_GRID_CELLS = 250_000;
```

with its docstring replaced by:

```ts
/**
 * A hard ceiling on the field grids, held as one `Float64Array` per component
 * (8 bytes a cell) and applied to their **sum**. Exceeding it coarsens every
 * component by the same factor, so the shared lattice survives.
 *
 * It was raised twice chasing the offset, to 1 200 000; the decomposition took
 * the measured worst case across every bucket down to about 15 000 cells, so
 * with today's constants this cannot trigger. It stays as the guard that a
 * later change coarsens rather than allocating unboundedly on a wheel notch.
 */
```

```ts
/** Today's falloff, as a fraction of the plot's larger side. */
const FALLOFF_FRACTION = 0.03;
```

```ts
/**
 * The tightening stops at 30 buckets, about 30x past the fit (`1.12 ** 30`).
 *
 * D6 floored this at 18, roughly 8x, as a concession to work and memory, and
 * paid for it with the halo growing on screen again past 8x — the original
 * complaint returning in the far corner of the zoom range. The decomposition
 * inverted that cost curve: at high zoom nearly every paper is a singleton
 * drawn as an arc with no grid at all, so the deepest zoom is now the cheapest
 * case. The ceiling is set by the zoom range instead: the viewport scale
 * clamps at 8 while `fitScale` can sit well below 1, so a ratio in the
 * twenties is reachable on an ordinary graph.
 */
const MAX_ZOOM_BUCKET = 30;
/** `pitch = radius / 3`, which is `spread * 0.01` at bucket 0. */
const PITCH_DIVISOR = 3;
```

Then update the two docstrings that quote the old numbers: `regionZoomBucket`'s
says "clamped to `[0, 18]`" and "bucket 0's radius is `spread * 0.04`" — make
them `[0, 30]` and `spread * 0.03`; the module docstring's mention of the
tightening floor, if it names 8x, becomes 30x. Find them with:

```bash
grep -n "0\.04\|\[0, 18\]\|8x\|7\.7" src/services/graphFolderRegion.ts
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run check`
Expected: PASS, `fail 0`. The renderer's zoom case still expects 2 territories
at scale 0.15 and 3 at scale 8: at spread 1000 the bucket-0 radius is 30, so the
pair 30 apart is inside `2R = 60` and merges, and at the ceiling the radius is
about 1 and they do not.

- [ ] **Step 5: Note the floor's changed argument in D6's spec**

In `docs/superpowers/specs/2026-09-10-graph-region-curves-design.md`, find the
paragraph justifying the 8x tightening floor and append:

```markdown
**Superseded, 2026-09-10 (region shapes).** The cost argument above no longer
holds. It floored the tightening at 8x because the grid grows quadratically
with it and nothing else stopped it; decomposing a folder into components
inverts that curve, because at high zoom nearly every paper is a singleton
drawn as an exact arc with no grid at all — for a 300-paper folder at bucket
18, 451 k cells become 21 k, or 5 k at the new constants. The floor moves to 30
buckets, which covers the reachable zoom range, and the acknowledged cost of
the old floor — the halo growing on screen again past 8x — goes with it. See
`docs/superpowers/specs/2026-09-10-graph-region-shapes-design.md`.
```

- [ ] **Step 6: Commit**

```bash
git add src/services/graphFolderRegion.ts test/unit/graphFolderRegion.test.ts docs/superpowers/specs/2026-09-10-graph-region-curves-design.md
git commit -m "feat: tighten the halo to 0.03 now the grid gets no vote (task 6)"
```

---

### Task 7: The Zotero suite, the roadmap and the XPI

The spec makes logged repeat runs a gate on this branch. One `npm test` run on
2026-09-10 reported 42 passed / 1 failed and the case was never identified; two
later runs were 43/0, and the known-intermittent `savedGraphMenu` case passed in
the failing run, so it was something else. **An unclosed gap is not a cleared
one, and this branch must not inherit it.**

**Files:**

- Modify: `docs/superpowers/handoffs/2026-09-08-roadmap.md`
- Build: `.scaffold/build/meristema.xpi`

**Interfaces:**

- Consumes: everything above.
- Produces: nothing code-facing.

- [ ] **Step 1: Run the Zotero suite three times, keeping the log**

Never `Stop-Process zotero`. If a run fails with EBUSY, stop and ask the user.

```bash
for run in 1 2 3; do npm test 2>&1 | tee "$TMPDIR/zotero-run-$run.log"; done
```

(On PowerShell: `1..3 | ForEach-Object { npm test 2>&1 | Tee-Object "$env:TEMP\zotero-run-$_.log" }`.)

Expected: three runs, each `43 passing` or better, `0 failing`. If any run
fails, **name the case** from the log before going further — that is the whole
point of the repeat runs. `savedGraphMenu.test.ts`'s "lists the saved graphs on
the first showing" is known-intermittent and one failure there is not a
regression; anything else is, and calls for
`superpowers:systematic-debugging` rather than another run.

- [ ] **Step 2: Update the roadmap's manual batch**

In `docs/superpowers/handoffs/2026-09-08-roadmap.md`, in the
"Manual verification" section, **replace** D6's first two checks — the two
recorded as walked-and-changed, beginning "D6: zoom into a folder graph" and
"D6: a folder's outline reads as a curve at every zoom" — with:

```markdown
- [ ] D6/shapes: a folder graph at the fit zoom. The territory reads as a
      smooth blob and its outline is a curve with no wobble and no facets.
- [ ] D6/shapes: zoom in until the papers separate. A lone paper's halo is a
      clean circle at every zoom — it is drawn as an exact arc now, not fitted
      through a grid — and the territory pulls apart into those circles
      smoothly.
- [ ] D6/shapes: the offset at `FALLOFF_FRACTION = 0.03` is right, or says
      which way to move. Reasoned, not measured: drawing lone papers as exact
      arcs hands back about half a pixel the fit's inward bias was removing, so
      it is not simply a quarter tighter than 0.04. It is one character to
      change and the grid no longer gets a vote on it.
```

Leave D6's remaining three checks (the deadband jiggle, the quiet Error
Console, and the 300-paper pan at maximum zoom) where they are — all three are
still unwalked and all three still apply. Add a line under the pan one:

```markdown
      This is the regime the shapes design makes cheapest rather than most
      expensive, so a frame drop here means the draw path — `drawRegions`
      rebuilding every `Path2D` every frame — and not the contour.
```

- [ ] **Step 3: Add the Log line**

Append to the roadmap's `## Log` section, newest last:

```markdown
- 2026-09-10: D6's follow-up landed (`graph-region-shapes`): a folder is a set
  of shapes rather than a set of loops. `folderRegionContours` partitions its
  papers into connected components under "closer than 2R" — a decomposition,
  not an approximation, since past 2R the supports are disjoint — draws a
  singleton as the exact circle `R * sqrt(1 - t)` and gives only clusters a
  grid, with every component sampled on one shared lattice so that at a given
  radius and pitch every surviving loop is byte-identical to the one that
  shipped (asserted, and the contour golden's first triple is untouched). Each
  ring is resampled to even arc length before the existing B-spline fit: the
  wobble was measured to be a parameterisation artefact and not the grid jitter
  D6's spec and the module docstring both named, and both passages are
  corrected. That inverted the cost curve the offset was stuck behind — a
  300-paper folder at bucket 18 goes from 451 k cells to 5 k — which paid for
  `PITCH_DIVISOR` 5 to 3, `FALLOFF_FRACTION` 0.04 to 0.03, `MAX_GRID_CELLS`
  back down to 250 000, and retiring D6's 8x tightening floor for a 30-bucket
  ceiling. D6's pan assertion, which passed whether or not the contour was
  recomputed, is replaced by a real `folderRegionContours` call count through
  `mock.module` (`test:unit` gains `--experimental-test-module-mocks`). Spec:
  `docs/superpowers/specs/2026-09-10-graph-region-shapes-design.md`. Plan:
  `docs/superpowers/plans/2026-09-10-graph-region-shapes.md`. Three manual
  checks replace D6's first two.
```

- [ ] **Step 4: Build the XPI, after the last test run**

`npm test` deletes `.scaffold/build/meristema.xpi`, so this comes last.

Run: `npm run build`
Expected: PASS, and `.scaffold/build/meristema.xpi` exists with a fresh
timestamp:

```bash
ls -l .scaffold/build/meristema.xpi
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/handoffs/2026-09-08-roadmap.md
git commit -m "docs: record the region-shapes round and reset D6's checks (task 7)"
```

- [ ] **Step 6: Hand back**

Do **not** push. `main` is two commits ahead of `origin/main`, both
documentation, and the user asks to be consulted before anything is pushed.
Report: the three `npm test` results with the log paths, `npm run check`'s unit
count, and that the XPI is built from the branch tip so the user can walk the
three new manual checks.

---

## Notes for the executing agent

- **Watch the two discriminating tests red first.** Task 1's call count must be
  seen failing against a deliberately broken cache (its Step 6), and Task 4's
  wobble case must be seen failing before the resampler exists (its Step 2). A
  test that has never failed proves nothing, and D6's pan assertion is the
  cautionary example: it passed for the wrong reason for a whole release.
- **`describe.only` plus `npm test` is about a minute end to end.** Take the
  `.only` off before committing — `npm run check` does not run the Zotero
  suite, so it will not catch one left behind.
- The Zotero test add-on is a **second copy of `src`**, so a UI-path test drives
  the plugin's own menus and controls, never an imported service.
  `test/zotero/graphRegionZoom.test.ts` needs no change here: it drives a real
  zoom through the plugin's own control and asserts nothing threw and the plot
  is still drawn, with no numeric coupling to the contour.
- The scratch measurement harnesses behind the spec's numbers are named in
  `docs/superpowers/handoffs/2026-09-10-region-shapes-spec-handoff.md`. They are
  deliberately not committed and are not a substitute for these tests.
