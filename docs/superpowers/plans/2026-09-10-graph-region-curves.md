# Graph Region Curves Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw a folder's region as a smooth closed curve whose halo holds a constant size on screen once the reader zooms past the fit view.

**Architecture:** Two independent changes behind one module. `regionPathFor` stops emitting `lineTo` between marching-squares vertices and fits a centripetal Catmull-Rom → cubic Bézier through them, so the outline is flattened by the rasterizer in device pixels and never re-facets. Separately, the falloff radius becomes a function of a quantised zoom bucket rather than a constant, so past the fit zoom the data-space halo shrinks in inverse proportion to the zoom; the bucket joins the per-folder contour cache key so a pan still recomputes nothing.

**Tech Stack:** TypeScript, `node:test` + `chai` for unit tests, Mocha inside a real Zotero for the `test/zotero` suite, `Path2D` supplied by the canvas's own window.

**Spec:** `docs/superpowers/specs/2026-09-10-graph-region-curves-design.md`. Read it before Task 1. Backlog entry D6 in `docs/superpowers/handoffs/2026-09-08-review-backlog.md`.

## Global Constraints

- Branch `graph-region-curves`, off `main`. One commit per task. Fast-forward to `main` only after the whole plan is green.
- `npm run check` is the gate for every task (`prettier --check` + `eslint` + `tsc` on both projects + the unit suite). It does **not** run the Zotero suite.
- `npm test` launches the dev Zotero. It is allowed in this repo, but it **deletes `.scaffold/build/meristema.xpi`** — build the XPI **after** the last test run, never before.
- **Never kill the user's Zotero.** Do not run `Stop-Process zotero`. If `npm test` fails on EBUSY, stop and ask.
- `draw()` latches `canvasError` after a single throw and never paints again for that renderer's life. Every function this plan adds must be **total**: no exceptions, no `NaN` reaching a canvas call.
- `src/services/graphFolderRegion.ts` stays DOM-free apart from the `Path2D` its caller's window supplies. It must never reference a global constructor.
- Commits: sentence-case subject, no type prefix, trailers `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` and `Claude-Session: <session URL>`. Stage by path.
- Prettier runs over `docs/` and `README.md` too; run `npm run lint:fix` if `lint:check` complains about a doc.
- Exact constant values, copied from the spec and used verbatim in every task:
  - `FALLOFF_FRACTION = 0.06`
  - `ZOOM_STEP = 1.12`
  - `MAX_ZOOM_BUCKET = 18`
  - `PITCH_DIVISOR = 5` (so `pitch = radius / 5`, which is `spread * 0.012` at bucket 0)
  - `MAX_GRID_CELLS = 500_000`
  - `KNOT_EPSILON = 1e-6` (device pixels)
  - `RING_WELD = 1e-4` (device pixels)

---

## File Structure

| File                                                              | Responsibility                                                                                                                                                         | Tasks   |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `src/services/graphFolderRegion.ts`                               | The whole region geometry seam: the field, marching squares, stitching, the curve fit, and the pure zoom rules. Already the single place a region path is built (B28). | 1, 2, 3 |
| `src/services/citationGraphRenderer.ts`                           | Wiring only: measures the plot and the data extent, derives the bucket, feeds radius and pitch in, and keys the contour cache on the bucket.                           | 4       |
| `test/unit/graphFolderRegion.test.ts`                             | Unit tests for everything in the module. Existing file — Task 1 **rewrites one existing test** that asserts `lineTo`.                                                  | 1, 2, 3 |
| `test/unit/citationGraphRendererRegions.test.ts`                  | Renderer-boundary tests. Existing file — its `FakePath2D` gains `bezierCurveTo` in Task 1.                                                                             | 1, 4    |
| `test/zotero/graphRegionZoom.test.ts`                             | New. One case: a region survives a zoom-in through the plugin's own control, and its path actually changed.                                                            | 5       |
| `docs/superpowers/specs/2026-09-09-graph-colour-system-design.md` | Amended with the reversal note.                                                                                                                                        | 4       |
| `docs/superpowers/handoffs/2026-09-08-roadmap.md`                 | D6 ticked, manual checks appended, Log line.                                                                                                                           | 6       |

**Task order is a dependency order.** Task 3 must land before Task 4: Task 4 is what shrinks the pitch, and without Task 3's stamped field build that makes the field build quadratically slower.

---

### Task 0: Branch

- [ ] **Step 1: Confirm the tree is clean and on main**

```bash
git -C C:/repos/github/daniel-locatelli/meristema-zotero status --short --branch
```

Expected: `## main...origin/main [ahead 5]` and no tracked modifications. An untracked `.claude/` is expected and fine.

Three untracked docs are expected as well — this plan, D6's spec and `docs/superpowers/handoffs/2026-09-10-d6-plan-written-handoff.md` — plus one modification, a Log line already appended to `docs/superpowers/handoffs/2026-09-08-roadmap.md`. All four were written before the branch existed and are committed in Step 3.

- [ ] **Step 2: Create the branch**

```bash
git checkout -b graph-region-curves
```

Expected: `Switched to a new branch 'graph-region-curves'`

- [ ] **Step 3: Commit the spec and the plan**

They are the branch's first commit, so every later task's diff is code against a written design rather than the two arriving together at the end. The session handoff and the roadmap's Log line go with them, since they describe the same step.

```bash
git add docs/superpowers/specs/2026-09-10-graph-region-curves-design.md docs/superpowers/plans/2026-09-10-graph-region-curves.md docs/superpowers/handoffs/2026-09-10-d6-plan-written-handoff.md docs/superpowers/handoffs/2026-09-08-roadmap.md
git commit -m "Specify and plan the folder regions' curves and zoom falloff"
```

Expected: four files changed. `.claude/` stays untracked — do not add it.

Task 6 ticks D6 itself and appends the manual checks; this Log line only records that the design step finished.

---

### Task 1: The Catmull-Rom → cubic Bézier fit

**Files:**

- Modify: `src/services/graphFolderRegion.ts` (`regionPathFor`, currently lines 303-320; new helpers above it)
- Modify: `test/unit/graphFolderRegion.test.ts` (add cases; **rewrite** the existing "builds its path from the window it is handed" case, which asserts `lineTo`)
- Modify: `test/unit/citationGraphRendererRegions.test.ts` (add `bezierCurveTo` to `FakePath2D`, around line 22)

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `regionPathFor(view: Window | null, loops: readonly (readonly RegionPoint[])[], project: (point: RegionPoint) => RegionPoint): Path2D | null` — unchanged signature, curved output. No new exports.

**Why the existing test must change, not be deleted:** the B28 case asserts the exact command stream `moveTo, lineTo, lineTo, closePath` for a three-point loop. Three unique points is now the _minimum curve case_, so that stream becomes `moveTo` plus three `bezierCurveTo` plus `closePath`. The case's purpose — the constructor came from the handed-in window, not a global — is unchanged and must survive.

- [ ] **Step 1: Write the failing tests**

Add `bezierCurveTo` to the fake in `test/unit/graphFolderRegion.test.ts` and replace the existing B28 case. Find this block:

```ts
it("builds its path from the window it is handed, not from a global", function () {
  const calls: string[] = [];
  class FakePath {
    moveTo(x: number, y: number): void {
      calls.push(`moveTo(${x},${y})`);
    }
    lineTo(x: number, y: number): void {
      calls.push(`lineTo(${x},${y})`);
    }
    closePath(): void {
      calls.push("closePath");
    }
  }
  const view = { Path2D: FakePath } as unknown as Window;

  const path = regionPathFor(
    view,
    [
      [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 2 },
      ],
    ],
    (point: RegionPoint) => ({ x: point.x * 10, y: point.y * 10 }),
  );

  expect(path, "the path came from the window's constructor").to.be.instanceOf(
    FakePath,
  );
  expect(calls).to.deep.equal([
    "moveTo(0,0)",
    "lineTo(20,0)",
    "lineTo(20,20)",
    "closePath",
  ]);
});
```

Replace that whole `it(...)` block with the following, and add the shared helper immediately **above** `describe("folder regions", ...)` (near `centroid`, at the top of the file):

```ts
/** Records the command stream `regionPathFor` builds, as the renderer's own
 *  double does. Curves carry six arguments; the last two are the on-curve
 *  end point, the first four are the two control points. */
class RecordingPath {
  commands: Array<{ op: string; args: number[] }> = [];
  moveTo(x: number, y: number): void {
    this.commands.push({ op: "moveTo", args: [x, y] });
  }
  lineTo(x: number, y: number): void {
    this.commands.push({ op: "lineTo", args: [x, y] });
  }
  bezierCurveTo(...args: number[]): void {
    this.commands.push({ op: "bezierCurveTo", args });
  }
  closePath(): void {
    this.commands.push({ op: "closePath", args: [] });
  }
}

function recordingView(): {
  view: Window;
  constructor: typeof RecordingPath;
} {
  return {
    view: { Path2D: RecordingPath } as unknown as Window,
    constructor: RecordingPath,
  };
}

const IDENTITY = (point: RegionPoint): RegionPoint => point;
```

Then add these cases inside `describe("folder regions", ...)`:

```ts
/**
 * B28's case, kept: the constructor still comes from the handed-in window
 * and not from a global. What changed is the command stream — three unique
 * points is the minimum *curve* case now, not a triangle of `lineTo`s.
 */
it("builds its path from the window it is handed, not from a global", function () {
  const { view, constructor } = recordingView();
  const path = regionPathFor(
    view,
    [
      [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 2 },
      ],
    ],
    (point: RegionPoint) => ({ x: point.x * 10, y: point.y * 10 }),
  );

  expect(path, "the path came from the window's constructor").to.be.instanceOf(
    constructor,
  );
  const commands = (path as unknown as RecordingPath).commands;
  expect(commands.map((command) => command.op)).to.deep.equal([
    "moveTo",
    "bezierCurveTo",
    "bezierCurveTo",
    "bezierCurveTo",
    "closePath",
  ]);
  expect(commands[0].args).to.deep.equal([0, 0]);
  // Each curve ends on the next ring vertex, and the ring wraps home.
  expect(commands[1].args.slice(4)).to.deep.equal([20, 0]);
  expect(commands[2].args.slice(4)).to.deep.equal([20, 20]);
  expect(commands[3].args.slice(4)).to.deep.equal([0, 0]);
});

/**
 * The sign test. A four-point square is the case where a swapped `m1`/`m2`
 * or a dropped minus still emits four curves and still closes, so a command
 * count proves nothing. Every control point must sit *outside* its chord,
 * on the far side from the square's centre, or the fill dips inward at each
 * corner instead of bulging out.
 *
 * The numbers are exact for a unit-spaced square: with all four knot gaps
 * equal, the tangent at each corner is the chord of its neighbours, and the
 * control points land a third of the way along it. Hand-checked, not
 * recorded from the implementation.
 */
it("bulges outward at a right-angle turn", function () {
  const { view } = recordingView();
  const path = regionPathFor(
    view,
    [
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
    ],
    IDENTITY,
  );
  const commands = (path as unknown as RecordingPath).commands;
  const first = commands[1];
  expect(first.op).to.equal("bezierCurveTo");
  // Segment (0,0) → (10,0). The square's centre is (5,5); both control
  // points must sit at negative y, away from it.
  expect(first.args[0]).to.be.closeTo(5 / 3, 1e-9);
  expect(first.args[1]).to.be.closeTo(-5 / 3, 1e-9);
  expect(first.args[2]).to.be.closeTo(10 - 5 / 3, 1e-9);
  expect(first.args[3]).to.be.closeTo(-5 / 3, 1e-9);
  // And every control point on every segment is outside the square.
  for (const command of commands) {
    if (command.op !== "bezierCurveTo") continue;
    for (const pair of [
      [command.args[0], command.args[1]],
      [command.args[2], command.args[3]],
    ]) {
      const outside =
        pair[0] < 0 || pair[0] > 10 || pair[1] < 0 || pair[1] > 10;
      expect(outside, `control point ${pair} is outside the square`).to.equal(
        true,
      );
    }
  }
});

/**
 * `stitch` ends every loop with a point whose weld key equals `loop[0]`.
 * Treating that array as a ring gives a zero-length final segment, a knot
 * spacing of `0 ** 0.5 = 0`, and a division by zero at the seam.
 */
it("draws the same ring whether or not the loop repeats its first point", function () {
  const ring = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  const open = regionPathFor(recordingView().view, [ring], IDENTITY);
  const closed = regionPathFor(
    recordingView().view,
    [[...ring, { x: 0, y: 0 }]],
    IDENTITY,
  );
  expect((closed as unknown as RecordingPath).commands).to.deep.equal(
    (open as unknown as RecordingPath).commands,
  );
});

/**
 * The minimum curve case, and the one that pins the wrap: for segment
 * A → B the predecessor of A and the successor of B are both C.
 */
it("wraps a three-vertex ring with C in both neighbour roles", function () {
  const path = regionPathFor(
    recordingView().view,
    [
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 9 },
      ],
    ],
    IDENTITY,
  );
  const commands = (path as unknown as RecordingPath).commands;
  expect(commands.filter((c) => c.op === "bezierCurveTo")).to.have.length(3);
  expect(commands[1].args.slice(4)).to.deep.equal([10, 0]);
  expect(commands[2].args.slice(4)).to.deep.equal([5, 9]);
  expect(commands[3].args.slice(4)).to.deep.equal([0, 0]);
  for (const command of commands) {
    for (const value of command.args) {
      expect(Number.isFinite(value), `${command.op} got ${value}`).to.equal(
        true,
      );
    }
  }
});

/** Grid-corner bunching: two vertices a hair apart, and three coincident
 *  ones, are what make a knot difference vanish. Neither may produce a
 *  `NaN` or a throw. */
it("stays finite through bunched and coincident vertices", function () {
  const loops = [
    [
      { x: 0, y: 0 },
      { x: 0.0000001, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ],
    [
      { x: 3, y: 3 },
      { x: 3, y: 3 },
      { x: 3, y: 3 },
      { x: 9, y: 3 },
      { x: 9, y: 9 },
    ],
  ];
  const path = regionPathFor(recordingView().view, loops, IDENTITY);
  for (const command of (path as unknown as RecordingPath).commands) {
    for (const value of command.args) {
      expect(Number.isFinite(value), `${command.op} got ${value}`).to.equal(
        true,
      );
    }
  }
});

/**
 * Totality. `draw()` latches `canvasError` after one throw and the plot
 * never paints again for that renderer's life (B28), so this asserts the
 * absence of an exception rather than any shape.
 */
it("throws nothing on degenerate input", function () {
  const abuse: RegionPoint[][] = [
    [],
    [{ x: 1, y: 1 }],
    [
      { x: 2, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 2 },
    ],
    [
      { x: Number.NaN, y: 0 },
      { x: 0, y: Number.POSITIVE_INFINITY },
      { x: 1, y: 1 },
    ],
  ];
  for (const loop of abuse) {
    expect(() =>
      regionPathFor(recordingView().view, [loop], IDENTITY),
    ).to.not.throw();
  }
  expect(() =>
    regionPathFor(recordingView().view, [], IDENTITY),
  ).to.not.throw();
  const path = regionPathFor(
    recordingView().view,
    abuse,
    IDENTITY,
  ) as unknown as RecordingPath;
  for (const command of path.commands) {
    for (const value of command.args) {
      expect(Number.isFinite(value), `${command.op} got ${value}`).to.equal(
        true,
      );
    }
  }
});

it("still draws a two-point loop with lineTo", function () {
  const path = regionPathFor(
    recordingView().view,
    [
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
      ],
    ],
    IDENTITY,
  );
  expect(
    (path as unknown as RecordingPath).commands.map((c) => c.op),
  ).to.deep.equal(["moveTo", "lineTo", "closePath"]);
});
```

Also add `bezierCurveTo` to the renderer suite's double, in `test/unit/citationGraphRendererRegions.test.ts`. Find:

```ts
class FakePath2D {
  commands: Array<{ op: string; args: number[] }> = [];
  moveTo(x: number, y: number): void {
    this.commands.push({ op: "moveTo", args: [x, y] });
  }
  lineTo(x: number, y: number): void {
    this.commands.push({ op: "lineTo", args: [x, y] });
  }
  closePath(): void {
    this.commands.push({ op: "closePath", args: [] });
  }
}
```

and add, after `lineTo`:

```ts
  bezierCurveTo(...args: number[]): void {
    this.commands.push({ op: "bezierCurveTo", args });
  }
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
node --import ./test/nodeResolve.mjs --test test/unit/graphFolderRegion.test.ts
```

Expected: FAIL. "builds its path from the window it is handed" fails on the op list (it still gets `lineTo`); "bulges outward at a right-angle turn" fails because `commands[1]` is a `lineTo` with two args, so `first.op` is not `bezierCurveTo`. `RecordingPath` has no `bezierCurveTo` call yet, so nothing throws — the assertions are what fail.

- [ ] **Step 3: Write the implementation**

In `src/services/graphFolderRegion.ts`, add these constants next to `WELD` (line 53):

```ts
/**
 * Two knots closer than this, in device pixels, are one knot. Marching-squares
 * vertices bunch tightly at grid corners, so a knot difference genuinely does
 * reach zero and the Catmull-Rom denominators genuinely do divide by it.
 */
const KNOT_EPSILON = 1e-6;
/** A ring's trailing repeat of its own first point, in device pixels. */
const RING_WELD = 1e-4;
```

Add these helpers immediately above `regionPathFor`:

```ts
/**
 * One segment's two cubic control points, centripetal Catmull-Rom → Bézier
 * (Barry–Goldman, α = 0.5).
 *
 * Centripetal is not a detail to swap out for uniform. Marching-squares
 * vertices bunch tightly at grid corners, and a uniform parameterisation over
 * spacing like that overshoots and can loop the curve back through itself
 * exactly there — a self-intersecting fill in the one place the contour is
 * most detailed.
 *
 * The guards are per control point, not per segment: a degenerate neighbour on
 * one side must not flatten the other side, which is perfectly well defined.
 * `t2 - t0` and `t3 - t1` need guarding as much as the adjacent differences —
 * each is a sum of two non-negative terms, so it vanishes when both halves do,
 * which is three coincident vertices.
 */
function segmentControls(
  p0: RegionPoint,
  p1: RegionPoint,
  p2: RegionPoint,
  p3: RegionPoint,
): [RegionPoint, RegionPoint] {
  // Knot spacing is the *Euclidean* distance raised to α, not a squared
  // distance and not a per-axis delta.
  const d10 = Math.sqrt(Math.hypot(p1.x - p0.x, p1.y - p0.y));
  const d21 = Math.sqrt(Math.hypot(p2.x - p1.x, p2.y - p1.y));
  const d32 = Math.sqrt(Math.hypot(p3.x - p2.x, p3.y - p2.y));
  const d20 = d10 + d21;
  const d31 = d21 + d32;

  const straightFirst: RegionPoint = {
    x: p1.x + (p2.x - p1.x) / 3,
    y: p1.y + (p2.y - p1.y) / 3,
  };
  const straightSecond: RegionPoint = {
    x: p2.x - (p2.x - p1.x) / 3,
    y: p2.y - (p2.y - p1.y) / 3,
  };
  if (!(d21 > KNOT_EPSILON)) return [straightFirst, straightSecond];

  const first =
    !(d10 > KNOT_EPSILON) || !(d20 > KNOT_EPSILON)
      ? straightFirst
      : {
          x:
            p1.x +
            (d21 *
              ((p1.x - p0.x) / d10 -
                (p2.x - p0.x) / d20 +
                (p2.x - p1.x) / d21)) /
              3,
          y:
            p1.y +
            (d21 *
              ((p1.y - p0.y) / d10 -
                (p2.y - p0.y) / d20 +
                (p2.y - p1.y) / d21)) /
              3,
        };
  const second =
    !(d32 > KNOT_EPSILON) || !(d31 > KNOT_EPSILON)
      ? straightSecond
      : {
          x:
            p2.x -
            (d21 *
              ((p2.x - p1.x) / d21 -
                (p3.x - p1.x) / d31 +
                (p3.x - p2.x) / d32)) /
              3,
          y:
            p2.y -
            (d21 *
              ((p2.y - p1.y) / d21 -
                (p3.y - p1.y) / d31 +
                (p3.y - p2.y) / d32)) /
              3,
        };
  return [first, second];
}

/**
 * A projected loop as a ring: finite points only, and without the trailing
 * repeat of the first point that `stitch` always leaves on a closed loop.
 */
function ringOf(loop: readonly RegionPoint[]): RegionPoint[] {
  const ring = loop.filter(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
  );
  while (
    ring.length > 1 &&
    Math.hypot(
      ring[ring.length - 1].x - ring[0].x,
      ring[ring.length - 1].y - ring[0].y,
    ) < RING_WELD
  ) {
    ring.pop();
  }
  return ring;
}
```

Then replace the body of `regionPathFor` (keep the existing docstring above it, and add the paragraph in Step 4):

```ts
export function regionPathFor(
  view: Window | null,
  loops: readonly (readonly RegionPoint[])[],
  project: (point: RegionPoint) => RegionPoint,
): Path2D | null {
  const constructor = (view as any)?.Path2D as typeof Path2D | undefined;
  if (!constructor) return null;
  const path = new constructor();
  for (const loop of loops) {
    // Projected first, then fitted: the projection is a uniform similarity,
    // so the shape is the same either way, but fitting afterwards puts the
    // epsilons in device pixels, where "degenerate" means "sub-pixel".
    const ring = ringOf(loop.map(project));
    if (!ring.length) continue;
    path.moveTo(ring[0].x, ring[0].y);
    if (ring.length < 3) {
      // No curve to fit through two points.
      for (const point of ring.slice(1)) path.lineTo(point.x, point.y);
      path.closePath();
      continue;
    }
    for (let index = 0; index < ring.length; index += 1) {
      const p0 = ring[(index - 1 + ring.length) % ring.length];
      const p1 = ring[index];
      const p2 = ring[(index + 1) % ring.length];
      const p3 = ring[(index + 2) % ring.length];
      const [first, second] = segmentControls(p0, p1, p2, p3);
      path.bezierCurveTo(first.x, first.y, second.x, second.y, p2.x, p2.y);
    }
    path.closePath();
  }
  return path;
}
```

- [ ] **Step 4: Extend `regionPathFor`'s docstring**

The existing docstring is entirely about B28 and must keep saying so. Insert this paragraph immediately before the closing `*/`, after the "Null when the window has no `Path2D`" paragraph:

```
 * The outline is a centripetal Catmull-Rom fit, one cubic Bézier per contour
 * segment, wrapping because the loops are closed. A polyline in data space
 * re-facets as you zoom in — its segments grow on screen with everything else
 * — while a curve does not, because the rasterizer flattens it in device
 * pixels. The contour it is fitted through is untouched: same points, same
 * topology, same `evenodd` fill, same dilation stroke (backlog D6).
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
node --import ./test/nodeResolve.mjs --test test/unit/graphFolderRegion.test.ts && node --import ./test/nodeResolve.mjs --test test/unit/citationGraphRendererRegions.test.ts
```

Expected: PASS, `fail 0` on both.

- [ ] **Step 6: Run the gate**

```bash
npm run check
```

Expected: prettier clean, eslint clean, both `tsc` projects clean, unit suite `fail 0`. The count should be 354 plus the seven cases added here.

- [ ] **Step 7: Commit**

```bash
git add src/services/graphFolderRegion.ts test/unit/graphFolderRegion.test.ts test/unit/citationGraphRendererRegions.test.ts
git commit -m "Fit a region's outline with Bézier curves rather than lines"
```

---

### Task 2: The zoom rules, as pure functions

**Files:**

- Modify: `src/services/graphFolderRegion.ts` (new exported functions and constants; no existing code changes)
- Modify: `test/unit/graphFolderRegion.test.ts` (new `describe` block)

**Interfaces:**

- Consumes: nothing from Task 1.
- Produces, all from `src/services/graphFolderRegion.ts`:
  - `regionFitScale(plotWidth: number, plotHeight: number, extentWidth: number, extentHeight: number): number` — `0` when there is no usable fit.
  - `regionZoomBucket(scale: number, fitScale: number): number` — an integer in `[0, 18]`.
  - `regionFalloffRadius(spread: number, scale: number, fitScale: number): number`
  - `regionGridPitch(radius: number): number`

Task 4 calls all four. Nothing is wired in this task — the renderer still uses its literals until Task 4.

- [ ] **Step 1: Write the failing tests**

Append to `test/unit/graphFolderRegion.test.ts`, at the end of the file, outside `describe("folder regions", ...)`. Add the four names to the existing import at the top of the file.

```ts
describe("region zoom rules", function () {
  const SPREAD = 1000;

  it("holds today's radius at and below the fit zoom", function () {
    // Byte-identical to what D3 shipped, which is the whole point of the
    // crossover sitting at the fit rather than at some pixel constant.
    expect(regionFalloffRadius(SPREAD, 1, 1)).to.equal(60);
    expect(regionFalloffRadius(SPREAD, 0.5, 1)).to.equal(60);
    expect(regionFalloffRadius(SPREAD, 0.15, 1)).to.equal(60);
    expect(regionZoomBucket(0.5, 1)).to.equal(0);
    expect(regionZoomBucket(1, 1)).to.equal(0);
  });

  it("tightens in 12% steps past the fit zoom", function () {
    expect(regionZoomBucket(1.12, 1)).to.equal(1);
    expect(regionFalloffRadius(SPREAD, 1.12, 1)).to.be.closeTo(60 / 1.12, 1e-9);
    expect(regionZoomBucket(1.12 ** 4, 1)).to.equal(4);
    expect(regionFalloffRadius(SPREAD, 1.12 ** 4, 1)).to.be.closeTo(
      60 / 1.12 ** 4,
      1e-9,
    );
    // The fit zoom moves the crossover with it, rather than the crossover
    // being a fixed scale.
    expect(regionZoomBucket(2.24, 2)).to.equal(1);
    expect(regionZoomBucket(1.5, 3)).to.equal(0);
  });

  it("stops tightening at the 8x floor", function () {
    expect(regionZoomBucket(1.12 ** 18, 1)).to.equal(18);
    expect(regionZoomBucket(1.12 ** 40, 1)).to.equal(18);
    expect(regionFalloffRadius(SPREAD, 1e6, 1)).to.be.closeTo(
      60 / 1.12 ** 18,
      1e-9,
    );
  });

  it("keeps the pitch a fifth of the radius, so bucket 0 is today's grid", function () {
    expect(regionGridPitch(regionFalloffRadius(SPREAD, 1, 1))).to.equal(12);
    expect(regionGridPitch(60 / 1.12)).to.be.closeTo(12 / 1.12, 1e-9);
  });

  it("measures the fit against the tighter of the two axes", function () {
    expect(regionFitScale(800, 600, 400, 200)).to.equal(2);
    expect(regionFitScale(800, 600, 200, 600)).to.equal(1);
  });

  it("falls back to bucket zero rather than NaN on degenerate input", function () {
    // Same totality rule as the curve builder, on the other input. A `NaN`
    // radius reaches the grid loop and the renderer draws nothing at all.
    expect(regionFitScale(800, 600, 0, 0)).to.equal(0);
    expect(regionFitScale(0, 0, 100, 100)).to.equal(0);
    expect(regionZoomBucket(1, 0)).to.equal(0);
    expect(regionZoomBucket(0, 1)).to.equal(0);
    expect(regionZoomBucket(Number.NaN, 1)).to.equal(0);
    expect(regionZoomBucket(Number.POSITIVE_INFINITY, 1)).to.equal(18);
    expect(regionFalloffRadius(SPREAD, 1, 0)).to.equal(60);
    expect(regionFalloffRadius(SPREAD, Number.NaN, 1)).to.equal(60);
    expect(regionFalloffRadius(0, 1, 1)).to.equal(0);
    expect(regionFalloffRadius(Number.NaN, 1, 1)).to.equal(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
node --import ./test/nodeResolve.mjs --test test/unit/graphFolderRegion.test.ts
```

Expected: FAIL — TypeScript/module resolution error, `regionFalloffRadius is not a function` or an unresolved import, because none of the four exist yet.

- [ ] **Step 3: Write the implementation**

Append to `src/services/graphFolderRegion.ts`, at the end of the file:

```ts
/** Today's falloff, as a fraction of the plot's larger side. */
const FALLOFF_FRACTION = 0.06;
/**
 * One zoom bucket. About 12%: small enough that the shape reads as following
 * the zoom rather than jumping, large enough that a slow zoom across the whole
 * range recomputes a handful of times rather than once per wheel notch.
 */
const ZOOM_STEP = 1.12;
/**
 * The tightening stops at roughly 8x past the fit (`1.12 ** 18 ≈ 7.7`).
 *
 * This floor is about work and memory, not looks. The grid grows
 * quadratically with the tightening and nothing else stops it: the viewport
 * scale clamps at 8 while the fit scale can sit well below 1, so a ratio in
 * the twenties is reachable on an ordinary graph. The honest cost is that
 * past 8x the halo starts growing on screen again.
 */
const MAX_ZOOM_BUCKET = 18;
/** `pitch = radius / 5`, which is `spread * 0.012` at bucket 0. */
const PITCH_DIVISOR = 5;

/**
 * The scale at which the laid-out papers just fill the plot.
 *
 * Computed, not remembered. Latching the scale of the last `fitView()` was
 * rejected: a saved graph restores a transform and may never fit at all, so
 * the latch would be undefined at first paint, and pressing "Fit" would
 * silently redefine where the halo starts tightening — a viewport control
 * quietly editing a drawing rule.
 *
 * On a whole-graph fit this is deliberately an upper bound on `fitView`'s own
 * scale, which divides a smaller box (canvas minus axis gutters) by a larger
 * extent (positions plus label padding). So pressing "Fit" lands at or below
 * the crossover, in bucket 0, at today's radius.
 *
 * Zero when there is no usable fit, which the callers read as bucket 0.
 */
export function regionFitScale(
  plotWidth: number,
  plotHeight: number,
  extentWidth: number,
  extentHeight: number,
): number {
  const byWidth = extentWidth > 0 ? plotWidth / extentWidth : Infinity;
  const byHeight = extentHeight > 0 ? plotHeight / extentHeight : Infinity;
  const fit = Math.min(byWidth, byHeight);
  return Number.isFinite(fit) && fit > 0 ? fit : 0;
}

/**
 * How many 12% steps past the fit zoom the view is, clamped to `[0, 18]`.
 *
 * Clamping at zero is what makes "at or below the fit is unchanged" exact:
 * every scale at or below the fit lands in bucket 0, and bucket 0's radius is
 * `spread * 0.06` to the last bit.
 */
export function regionZoomBucket(scale: number, fitScale: number): number {
  if (!(scale > 0) || !(fitScale > 0)) return 0;
  const steps = Math.log(scale / fitScale) / Math.log(ZOOM_STEP);
  if (Number.isNaN(steps)) return 0;
  if (steps >= MAX_ZOOM_BUCKET) return MAX_ZOOM_BUCKET;
  return Math.min(MAX_ZOOM_BUCKET, Math.max(0, Math.round(steps)));
}

/**
 * The falloff radius in data units: today's constant at or below the fit
 * zoom, shrinking in inverse proportion to the zoom past it, which is the
 * same statement as the halo holding a constant size on screen.
 *
 * The radius comes from the *bucket*, not from the raw scale, and that is
 * deliberate. If the radius tracked the raw scale while the contour cache key
 * tracked the bucket, two frames sharing a bucket would draw a contour
 * computed at some other frame's radius — a cache that lies. The cost is that
 * the radius moves in 12% steps; it agrees with the continuous rule at every
 * bucket boundary and is never more than 6% from it between them, which is
 * under a third of a grid cell.
 */
export function regionFalloffRadius(
  spread: number,
  scale: number,
  fitScale: number,
): number {
  if (!(spread > 0) || !Number.isFinite(spread)) return 0;
  return (
    spread * FALLOFF_FRACTION * ZOOM_STEP ** -regionZoomBucket(scale, fitScale)
  );
}

/**
 * The grid pitch that goes with a falloff radius.
 *
 * Holding the literal `spread * 0.012` while the radius shrinks under-samples
 * the field: at high zoom the falloff would be narrower than a cell and the
 * contour would break into rubble or vanish. A fixed ratio keeps the contour's
 * fidelity relative to the falloff constant at every zoom.
 */
export function regionGridPitch(radius: number): number {
  return radius / PITCH_DIVISOR;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --import ./test/nodeResolve.mjs --test test/unit/graphFolderRegion.test.ts
```

Expected: PASS, `fail 0`.

- [ ] **Step 5: Run the gate**

```bash
npm run check
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/services/graphFolderRegion.ts test/unit/graphFolderRegion.test.ts
git commit -m "Add the region falloff's zoom rules as pure functions"
```

---

### Task 3: Stamp the field per node, and cap the grid

**Files:**

- Modify: `src/services/graphFolderRegion.ts` (`fieldAt` is deleted; the field build inside `folderRegionContours`, lines 246-255, becomes a stamp; a cell budget is added after the `columns`/`rows` computation)
- Modify: `test/unit/graphFolderRegion.test.ts` (one new case)

**Interfaces:**

- Consumes: nothing. `FolderRegionOptions` and `folderRegionContours`'s signature are unchanged.
- Produces: `folderRegionContours` unchanged in signature and output. This is an exact refactor — it must not change a single contour.

**Why:** `fieldAt` evaluates every node against every cell, `O(cells × nodes)`. Task 4 shrinks the pitch, and cells scale as `(bbox / pitch)²`, so an 8× tightening multiplies them by 64 — hundreds of millions of evaluations per bucket change on a folder spanning the plot. Each node's bump has compact support (it contributes nothing beyond `radius`), so the same sum can be accumulated by stamping each node into the cells inside its own footprint: `O(nodes × (radius/pitch)²)` ≈ `O(nodes × 100)`, constant at every zoom.

- [ ] **Step 1: Write the failing test**

The suite's existing cases (single paper, merge, islands, saddle, extreme-position closure, determinism) are the behavioural pins and must keep passing untouched. Add one case that pins the exact geometry, so a reordering error that still produces a plausible shape is caught. Append inside `describe("folder regions", ...)`:

```ts
/**
 * The field is summed by stamping each node into its own footprint rather
 * than evaluating every node against every cell. That is an exact refactor
 * — the same sum in a different order — so these numbers are the ones the
 * per-cell evaluator produced, recorded before the change. Vertex counts
 * and coordinate sums together catch a reordering error that still yields a
 * plausible-looking shape.
 */
it("sums the field to the same contour however it is accumulated", function () {
  const contours = folderRegionContours(
    [
      { x: 0, y: 0 },
      { x: 14, y: 3 },
      { x: 7, y: 16 },
      { x: 40, y: 40 },
    ],
    { radius: 10, pitch: 2 },
  );
  expect(contours).to.have.length(2);
  const sums = contours.map((loop) => ({
    length: loop.length,
    x: loop.reduce((total, point) => total + point.x, 0),
    y: loop.reduce((total, point) => total + point.y, 0),
  }));
  expect(sums[0].length).to.equal(68);
  expect(sums[0].x).to.be.closeTo(475.8592418546, 1e-6);
  expect(sums[0].y).to.be.closeTo(439.205775052, 1e-6);
  expect(sums[1].length).to.equal(26);
  expect(sums[1].x).to.be.closeTo(1040, 1e-6);
  expect(sums[1].y).to.be.closeTo(1014, 1e-6);
});

/** A pitch small enough to blow the cell budget is coarsened rather than
 *  allocated. With the 8x tightening floor in place this cannot happen in
 *  the product; it is a guard against a later change moving that floor. */
it("coarsens rather than allocating an unbounded grid", function () {
  const contours = folderRegionContours(
    [
      { x: 0, y: 0 },
      { x: 5000, y: 5000 },
    ],
    { radius: 100, pitch: 0.05 },
  );
  expect(contours.length).to.be.at.least(1);
});
```

- [ ] **Step 2: Run the test to verify it passes, then breaks**

```bash
node --import ./test/nodeResolve.mjs --test test/unit/graphFolderRegion.test.ts
```

Expected: the "sums the field" case **PASSES** already — it records what today's code does, which is the point of a golden. The "coarsens" case **FAILS or hangs**: a 5000-unit extent at pitch 0.05 is 100 001 × 100 001 cells, roughly 10 billion, so it exhausts memory or does not return. If it hangs, kill it with Ctrl-C and treat that as the red.

This is the one task in the plan whose refactor test is green before the change. That is deliberate: an exact refactor has no red to watch, so the golden is the guard and the budget case is the failing test.

- [ ] **Step 3: Write the implementation**

Delete `fieldAt` entirely (lines 55-71). Add the budget constant next to `DOMAIN_MARGIN`:

```ts
/**
 * A hard ceiling on the field grid. With the falloff's 8x tightening floor and
 * `pitch = radius / 5` the grid never exceeds roughly 640 steps across a
 * folder's bounding box, about 410 000 cells, so this cannot trigger in the
 * product. It is here so that a later change to the floor coarsens the pitch
 * instead of allocating unboundedly on a wheel notch.
 */
const MAX_GRID_CELLS = 500_000;
```

In `folderRegionContours`, replace this:

```ts
const columns = Math.ceil((maxX - minX) / pitch) + 1;
const rows = Math.ceil((maxY - minY) / pitch) + 1;

const values: number[][] = [];
for (let row = 0; row < rows; row += 1) {
  const line: number[] = [];
  for (let column = 0; column < columns; column += 1) {
    line.push(
      fieldAt(points, minX + column * pitch, minY + row * pitch, radius),
    );
  }
  values.push(line);
}
```

with this:

```ts
const width = maxX - minX;
const height = maxY - minY;
// Coarsen rather than allocate: see MAX_GRID_CELLS.
const cellPitch = Math.max(pitch, Math.sqrt((width * height) / MAX_GRID_CELLS));
const columns = Math.ceil(width / cellPitch) + 1;
const rows = Math.ceil(height / cellPitch) + 1;

// Each paper's bump has compact support, so the field is accumulated by
// stamping every node into the cells inside its own footprint rather than
// evaluating every node against every cell. Same sum, different order:
// O(nodes x (radius/pitch)^2) instead of O(cells x nodes), which is what
// keeps the cost flat as the falloff tightens with the zoom (D6).
const values = new Float64Array(rows * columns);
const squared = radius * radius;
const reach = Math.ceil(radius / cellPitch);
for (const point of points) {
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
```

Then, in the marching-squares loop below it, replace every `pitch` with `cellPitch` and every `values[row][column]`-style read with the flat index. The loop becomes:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --import ./test/nodeResolve.mjs --test test/unit/graphFolderRegion.test.ts
```

Expected: PASS, `fail 0`. The golden case must still hold to 1e-6 — if it does not, the stamp's footprint is wrong (most likely `reach` too small, which drops a contribution near the edge of a node's support).

- [ ] **Step 5: Run the gate**

```bash
npm run check
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/services/graphFolderRegion.ts test/unit/graphFolderRegion.test.ts
git commit -m "Stamp the region field per paper rather than per cell"
```

---

### Task 4: Wire the zoom into the renderer, and record the reversal

**Files:**

- Modify: `src/services/citationGraphRenderer.ts` — `dataSpread()` (line 1250) becomes `dataExtent()`; `regionsFor()` (line 1272) takes the plot rect and the scale; `drawRegions()` (line 1358) passes them
- Modify: `test/unit/citationGraphRendererRegions.test.ts` (two new cases)
- Modify: `src/services/graphFolderRegion.ts` (module docstring, lines 9-17)
- Modify: `docs/superpowers/specs/2026-09-09-graph-colour-system-design.md` (two amendment notes)

**Interfaces:**

- Consumes, from Task 2: `regionFitScale(plotWidth, plotHeight, extentWidth, extentHeight)`, `regionZoomBucket(scale, fitScale)`, `regionFalloffRadius(spread, scale, fitScale)`, `regionGridPitch(radius)`.
- Produces: no new public API. `regionsFor(plot: PlotRect, scale: number): Map<number, RegionPoint[][]>` is private.

**The reversal lands here, so the documentation lands in the same commit.** D3's spec says the field is data-space "precisely so the hull's topology is not a function of the zoom", and its review called splitting-on-zoom indefensible. D6 reverses that knowingly, on a reason the review never weighed: zoomed in, a data-space hull has its edge off-screen and stops telling the reader anything. Anyone reading D3 later must find that named, with the reason attached.

- [ ] **Step 1: Write the failing tests**

Append inside `describe("CitationGraphRenderer regions", ...)` in `test/unit/citationGraphRendererRegions.test.ts`:

```ts
/**
 * Three papers, deliberately: two close together and one far away. At the
 * fit zoom the close pair merges into one loop and the far paper is a
 * second, so the region is two loops. Past the fit the falloff tightens
 * until the pair no longer reaches across the gap, and the territory pulls
 * apart into three — which is the behaviour D6 exists to produce, and is
 * also the only assertion that cannot be satisfied by a re-projection.
 *
 * A single paper would prove nothing here: its contour is *self-similar*
 * under the tightening, because the pitch follows the radius, so both the
 * vertex count and the normalised shape survive a zoom unchanged.
 */
it("pulls a territory apart on a zoom but recomputes nothing on a pan", function () {
  {
    const canvas = new FakeCanvas();
    const nodes = [
      node("near", { collectionIDs: [1] }),
      node("pair", { collectionIDs: [1] }),
      node("far", { collectionIDs: [1] }),
    ];
    const renderer = new CitationGraphRenderer({
      canvas: canvas as unknown as HTMLCanvasElement,
      model: model(nodes),
      layout: FREE_LAYOUT,
      collectionLabels: new Map(),
      onSelectionChange: () => undefined,
      onOpenNode: () => undefined,
    });
    attachView(canvas);
    // Spread is 1000, so the fit-zoom falloff radius is 60: "near" and
    // "pair" are 30 apart and merge, "far" is on its own.
    renderer.setNodePositions(
      new Map([
        ["near", { x: 0, y: 0 }],
        ["pair", { x: 30, y: 0 }],
        ["far", { x: 1000, y: 0 }],
      ]),
    );
    renderer.setRegions([
      {
        collectionID: 1,
        color: "#336699",
        nodeKeys: new Set(["near", "pair", "far"]),
      },
    ]);

    const loopsDrawn = (path: FakePath2D): number =>
      path.commands.filter((command) => command.op === "moveTo").length;

    // 0.15 is the viewport's minimum scale, so it is below the fit zoom
    // whatever the plot rect works out to: bucket 0, today's radius.
    renderer.setViewTransform({ x: 0, y: 0, scale: 0.15 });
    const zoomedOut = lastRegionStroke(canvas.context).args[0] as FakePath2D;
    expect(
      loopsDrawn(zoomedOut),
      "at the fit zoom the close pair is one territory",
    ).to.equal(2);

    // A pan: same scale, different origin. Every coordinate must be the old
    // one shifted by the same delta — that is a re-projection of the cached
    // contour, not a resum over the grid.
    renderer.setViewTransform({ x: 40, y: -25, scale: 0.15 });
    const panned = lastRegionStroke(canvas.context).args[0] as FakePath2D;
    expect(panned.commands.map((command) => command.op)).to.deep.equal(
      zoomedOut.commands.map((command) => command.op),
    );
    panned.commands.forEach((command, index) => {
      command.args.forEach((value, position) => {
        const shift = position % 2 === 0 ? 40 : -25;
        expect(
          value - shift,
          `command ${index} argument ${position} moved by more than the pan`,
        ).to.be.closeTo(zoomedOut.commands[index].args[position], 1e-9);
      });
    });

    // 8 is the viewport's maximum scale, so it is many buckets past the fit
    // and the falloff has hit its floor. The pair can no longer reach.
    renderer.setViewTransform({ x: 0, y: 0, scale: 8 });
    const zoomedIn = lastRegionStroke(canvas.context).args[0] as FakePath2D;
    expect(
      loopsDrawn(zoomedIn),
      "zoomed in, the territory is three separate papers",
    ).to.equal(3);
  }
});

it("draws a region at every zoom rather than losing it", function () {
  // The tightening must never take a folder off the plot: at maximum zoom a
  // lone paper still has a halo, it is simply a smaller one in data space. A
  // dropped region here would look exactly like B28 coming back.
  {
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
    for (const scale of [0.15, 1, 2, 4, 8]) {
      renderer.setViewTransform({ x: 0, y: 0, scale });
      const path = lastRegionStroke(canvas.context).args[0] as FakePath2D;
      expect(
        path.commands.length,
        `a region at scale ${scale}`,
      ).to.be.greaterThan(0);
      for (const command of path.commands) {
        for (const value of command.args) {
          expect(
            Number.isFinite(value),
            `scale ${scale} produced ${value}`,
          ).to.equal(true);
        }
      }
    }
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
node --import ./test/nodeResolve.mjs --test test/unit/citationGraphRendererRegions.test.ts
```

Expected: FAIL on "pulls a territory apart on a zoom but recomputes nothing on a pan", at the last assertion: `expected 2 to equal 3`. The radius is still the constant `spread * 0.06` at every zoom, so the close pair stays merged and the region is two loops however far in the reader goes. The pan half of that case passes before the change and must keep passing after it — it is the half that would break if the bucket were computed wrongly and a pan started invalidating the cache.

"draws a region at every zoom rather than losing it" passes already; it is the guard against the tightening dropping a folder, not the driver.

- [ ] **Step 3: Write the implementation**

In `src/services/citationGraphRenderer.ts`, extend the import at lines 51-52:

```ts
  folderRegionContours,
  regionFalloffRadius,
  regionFitScale,
  regionGridPitch,
  regionPathFor,
  regionZoomBucket,
```

Replace `dataSpread()` (lines 1249-1264, the docstring `/** The larger side of the laid-out plot, in data units. */` and its method) with:

```ts
  /**
   * The laid-out plot's bounding box in data units, and its larger side.
   *
   * Both are needed: the falloff is a fraction of the larger side, while the
   * fit scale is measured per axis against the plot rect (D6).
   */
  private dataExtent(): { width: number; height: number; spread: number } {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const position of this.positions.values()) {
      minX = Math.min(minX, position.x);
      maxX = Math.max(maxX, position.x);
      minY = Math.min(minY, position.y);
      maxY = Math.max(maxY, position.y);
    }
    const width = maxX - minX;
    const height = maxY - minY;
    return {
      width: Number.isFinite(width) ? width : 0,
      height: Number.isFinite(height) ? height : 0,
      spread: Math.max(width, height, 1),
    };
  }
```

Replace `regionsFor`'s docstring and signature, and the four lines that build a contour. The method head becomes:

```ts
  /**
   * A folder's contour is cached per folder, and the cache key says exactly
   * what can change it: the layout revision (a position moved), the folder's
   * own node-key set, and the zoom bucket.
   *
   * The bucket is D6. The falloff radius holds today's value at and below the
   * fit zoom and tightens past it, so that the halo holds a constant size on
   * screen rather than swallowing the viewport — see `regionFalloffRadius`.
   * Quantising the zoom into 12% buckets is what keeps this a cache rather
   * than a recompute on every wheel notch, and deriving the radius from the
   * bucket rather than the raw scale is what keeps the cache honest: two
   * frames in one bucket draw the contour that bucket's radius produced.
   *
   * A pan changes neither the revision nor the bucket, so it still recomputes
   * nothing. Each folder is checked against its own signature, so `setRegions`
   * clearing one selection cannot force the others to resum (finding 4).
   */
  private regionsFor(plot: PlotRect, scale: number): Map<number, RegionPoint[][]> {
    const extent = this.dataExtent();
    const spread = extent.spread;
    const fitScale = regionFitScale(
      plot.width,
      plot.height,
      extent.width,
      extent.height,
    );
    const bucket = regionZoomBucket(scale, fitScale);
    const radius = regionFalloffRadius(spread, scale, fitScale);
    const activeIDs = new Set<number>();
    for (const region of this.regions) {
      activeIDs.add(region.collectionID);
      const keySignature = [...region.nodeKeys].sort().join(",");
      const signature = `${this.layoutRevision}:${bucket}:${keySignature}`;
```

and the contour build inside it becomes:

```ts
this.regionContours.set(
  region.collectionID,
  folderRegionContours(points, {
    radius,
    pitch: regionGridPitch(radius),
  }),
);
```

Everything else in `regionsFor` — the `points` gather, the signature store, the drop of unselected folders, the return — is unchanged.

Finally, in `drawRegions` (line 1359), replace:

```ts
const contours = this.regionsFor();
```

with:

```ts
const contours = this.regionsFor(plot, this.transform.scale);
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --import ./test/nodeResolve.mjs --test test/unit/citationGraphRendererRegions.test.ts && node --import ./test/nodeResolve.mjs --test test/unit/graphFolderRegion.test.ts
```

Expected: PASS on both, `fail 0`.

- [ ] **Step 5: Rewrite the module docstring's data-space claim**

`src/services/graphFolderRegion.ts` lines 9-17 currently assert the invariance without qualification. Replace this paragraph:

```
 * The field is built in **data space**, not screen space, and that is the
 * load-bearing choice. A screen-space field with a falloff in device pixels
 * makes the contour a function of the zoom: zoom in and a folder fragments
 * into islands, zoom out and islands merge, because the nodes move apart and
 * together on screen while the papers do not. In data space the topology is
 * invariant, and a folder fragments only when its papers genuinely are apart.
 * The renderer transforms these contours with the same viewport transform the
 * nodes use, and dilates them by a device-pixel amount so the hull clears the
 * node discs by a constant margin on screen.
```

with:

```
 * The field is built in **data space**, and the falloff radius is constant at
 * and below the fit zoom, so the topology is invariant through the whole
 * zoomed-out range: a folder fragments only when its papers genuinely are
 * apart. The renderer transforms these contours with the same viewport
 * transform the nodes use, and dilates them by a device-pixel amount so the
 * hull clears the node discs by a constant margin on screen.
 *
 * **Past the fit zoom the radius tightens** (`regionFalloffRadius`), so the
 * halo holds a constant size on screen and a territory pulls apart into its
 * papers as the reader zooms in. That reverses D3's original rule, which held
 * the radius constant at every zoom precisely so topology was never a function
 * of the zoom. It was reversed knowingly, on a reason D3's review never
 * weighed: zoomed in, a data-space hull has its edge off-screen and stops
 * telling the reader which papers made it — the region swallows the viewport,
 * and a shape that covers everything identifies nothing. What makes it
 * defensible is that it is scoped to past the fit, where the alternative is
 * not a stable shape but an edge nobody can see. See
 * `docs/superpowers/specs/2026-09-10-graph-region-curves-design.md` (D6).
```

- [ ] **Step 6: Amend D3's spec**

In `docs/superpowers/specs/2026-09-09-graph-colour-system-design.md`, find the paragraph beginning "Data space, not screen space, and that is the load-bearing choice." and insert immediately **after** the paragraph that ends "...and a folder fragments only when its papers genuinely are apart.":

```markdown
> **Amended 2026-09-10 by D6**
> (`2026-09-10-graph-region-curves-design.md`). This still holds at and below
> the fit zoom, and the contour there is byte-identical to what this spec
> shipped. Past the fit zoom the falloff radius tightens in inverse proportion
> to the zoom, so a folder's topology _is_ a function of the zoom there. That
> reverses this paragraph knowingly, on a reason this spec's review never
> weighed: zoomed in, a data-space hull has its edge off-screen and stops
> telling the reader which papers made it. Read D6's "The reversal, and why it
> is allowed" before treating the rule above as current.
```

Then find the verification bullet beginning "the same nodes under two different zoom levels produce the **same contour**" and append to that same bullet, as a new sentence inside it:

```markdown
(Amended by D6, 2026-09-10: this now reads "two zoom levels **at or below
the fit** produce the same contour", and a second case asserts that a zoom
past the fit produces a tighter one.)
```

- [ ] **Step 7: Run the gate**

```bash
npm run check
```

Expected: all green. If prettier complains about the two docs, run `npm run lint:fix` and re-run.

- [ ] **Step 8: Commit**

```bash
git add src/services/citationGraphRenderer.ts src/services/graphFolderRegion.ts test/unit/citationGraphRendererRegions.test.ts docs/superpowers/specs/2026-09-09-graph-colour-system-design.md
git commit -m "Tighten a region's halo past the fit zoom"
```

---

### Task 5: The Zotero case — a region survives a zoom-in

**Files:**

- Create: `test/zotero/graphRegionZoom.test.ts`

**Interfaces:**

- Consumes: the plugin's own chrome. `openViewStage`, `makeCorpus`, `settle` and `ViewStage` from `./visualHarness`, exactly as `graphRegionBlank.test.ts` uses them.
- Produces: nothing consumed by later tasks.

**Why through the chrome:** the Zotero test add-on is a second copy of `src`, so a UI-path test drives the plugin's own controls and never imports a service. The zoom-in button is `.cm-zoom-controls button[data-action="in"]`, and each click is `zoomBy(1.22)` — larger than one 12% bucket, so two clicks past the fit are guaranteed to cross a bucket boundary.

- [ ] **Step 1: Write the failing test**

Create `test/zotero/graphRegionZoom.test.ts`:

```ts
/// <reference types="mocha" />
import { expect } from "chai";
import {
  makeCorpus,
  openViewStage,
  settle,
  type ViewStage,
} from "./visualHarness";

/**
 * D6. A folder's region tightens past the fit zoom so the territory pulls
 * apart into its papers rather than swallowing the viewport. Two things have
 * to be true at once and only one of them is obvious: the region must still be
 * painted after a zoom, and its shape must actually have changed. Asserting
 * only the first would pass on the pre-D6 build; asserting only the second
 * would pass on a build that dropped the region entirely — which is what B28
 * looked like, and is the failure this case is really standing guard over.
 */
describe("D6: a folder region survives a zoom-in", function () {
  let stage: ViewStage | null = null;

  afterEach(function () {
    stage?.close();
    stage = null;
  });

  /** Whether the plot has anything on it beyond one flat fill. */
  function drawnPixels(active: ViewStage): number {
    const context = active.canvas.getContext("2d")!;
    const { width, height } = active.canvas;
    const data = context.getImageData(0, 0, width, height).data;
    const first = [data[0], data[1], data[2]];
    let different = 0;
    for (let index = 0; index < data.length; index += 160) {
      if (
        data[index] !== first[0] ||
        data[index + 1] !== first[1] ||
        data[index + 2] !== first[2]
      ) {
        different += 1;
      }
    }
    return different;
  }

  /** A coarse fingerprint of what is on the canvas, cheap enough to take
   *  twice: the per-channel totals over a sampled grid. Two different
   *  contours cannot land on the same three numbers by accident. */
  function fingerprint(active: ViewStage): string {
    const context = active.canvas.getContext("2d")!;
    const { width, height } = active.canvas;
    const data = context.getImageData(0, 0, width, height).data;
    let red = 0;
    let green = 0;
    let blue = 0;
    for (let index = 0; index < data.length; index += 40) {
      red += data[index];
      green += data[index + 1];
      blue += data[index + 2];
    }
    return `${red}:${green}:${blue}`;
  }

  function zoomIn(active: ViewStage): void {
    const button = active.root.querySelector(
      '.cm-zoom-controls button[data-action="in"]',
    ) as HTMLButtonElement | null;
    expect(button, "the zoom-in control").to.exist;
    button!.click();
  }

  it("keeps the region painted and changes its shape", async function () {
    this.timeout(60_000);
    const active = await openViewStage(makeCorpus({ nodes: 120 }), {
      initialCollectionIDs: [3],
    });
    stage = active;
    await settle(active);

    const atFit = drawnPixels(active);
    expect(atFit, "the graph is drawn before the zoom").to.be.greaterThan(200);
    const before = fingerprint(active);

    // Two clicks at 1.22 each is 1.49, comfortably past one 12% bucket.
    zoomIn(active);
    zoomIn(active);
    await settle(active);

    expect(
      drawnPixels(active),
      "the region and the nodes are still on the plot after zooming",
    ).to.be.greaterThan(200);
    expect(
      fingerprint(active),
      "the zoom actually redrew the plot",
    ).to.not.equal(before);
    expect(active.errors, "nothing threw during the zoom").to.deep.equal([]);
  });
});
```

- [ ] **Step 2: Run the Zotero suite for this file only**

Add `.only` to the `describe` so the run is about a minute rather than the whole suite:

```bash
sed -i 's/^describe("D6: a folder region survives/describe.only("D6: a folder region survives/' test/zotero/graphRegionZoom.test.ts
npm test
```

Expected: PASS. This case does not have a meaningful red — it asserts that the product still works after a zoom, which Task 4 is what makes true. If it fails, Task 4 has a defect; go back rather than weakening the assertion.

**Do not leave `.only` in.** `npm run check` does not run the Zotero suite and will not catch it.

- [ ] **Step 3: Remove `.only` and run the whole Zotero suite**

```bash
sed -i 's/^describe\.only("D6: a folder region survives/describe("D6: a folder region survives/' test/zotero/graphRegionZoom.test.ts
grep -rn "describe.only\|it.only" test/zotero/
npm test
```

Expected: `grep` finds nothing. `npm test` reports 43 passed, 0 failed (42 before this case). `savedGraphMenu.test.ts` "lists the saved graphs on the first showing" is known intermittent; one failure there is not a regression — re-run before treating it as one.

- [ ] **Step 4: Run the gate**

```bash
npm run check
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add test/zotero/graphRegionZoom.test.ts
git commit -m "Walk a folder region through a zoom in Zotero"
```

---

### Task 6: Tick the roadmap, and hand the manual checks over

**Files:**

- Modify: `docs/superpowers/handoffs/2026-09-08-roadmap.md`

**Interfaces:**

- Consumes: everything above.
- Produces: the record the next session reads first.

- [ ] **Step 1: Tick D6**

In the "Design items from the Stage 2 walk-through" list, replace:

```markdown
- [ ] D6 the folder regions read as faceted polylines, and their offset does
      not follow the zoom. The second half reverses D3's data-space decision
      knowingly; read D6 in the backlog before designing.
```

with:

```markdown
- [x] D6 the folder regions read as faceted polylines, and their offset does
      not follow the zoom. The outline is a centripetal Catmull-Rom → cubic
      Bézier fit inside `regionPathFor`, and the falloff radius tightens past
      the fit zoom only, on a quantised 12% bucket that joins the contour
      cache key. The second half reverses D3's data-space decision knowingly;
      the reason is recorded in D6's spec, in D3's spec and in
      `graphFolderRegion.ts`'s docstring.
```

- [ ] **Step 2: Append the manual checks**

At the end of the "Manual verification" list, append:

```markdown
- [ ] D6: zoom into a folder graph. The territory pulls apart into its papers
      as you go in, smoothly at every step, and never fragments or jumps while
      zooming back out through the fit view.
- [ ] D6: a folder's outline reads as a curve at every zoom, including at
      maximum zoom on a corner of the region — no chamfered polygon at any
      step.
- [ ] D6: park the zoom part-way into a tighten and jiggle it by a percent
      either way. The region should not stutter or pulse. If it does, the
      bucket function wants a deadband — the spec says why it was left out.
- [ ] D6: the Error Console stays quiet through all of the above. `draw()`
      latches `canvasError`, so one throw blanks the plot permanently; a quiet
      console is the check that the curve builder is total.
```

Note for whoever walks this batch: D3's six unwalked checks are still open above, and they need rewalking on this build anyway, since D6 changes what a region looks like at every zoom.

- [ ] **Step 3: Add the Log line**

At the end of the "## Log" list, append (fill the commit range in from `git log --oneline main..graph-region-curves`):

```markdown
- 2026-09-10: D6 finished (`graph-region-curves`, <first>..<last>): a folder's
  outline is a centripetal Catmull-Rom → cubic Bézier fit inside
  `regionPathFor`, so it no longer re-facets as the reader zooms — a polyline
  in data space always does, whatever its vertex count, because the rasterizer
  flattens a curve in device pixels instead. The falloff radius became
  `regionFalloffRadius(spread, scale, fitScale)`: today's constant at and below
  the fit zoom, tightening in inverse proportion to the zoom past it, so the
  halo holds a constant size on screen and a territory pulls apart into its
  papers. The zoom enters through a quantised 12% bucket that joins each
  folder's contour cache key, so a pan still recomputes nothing and a slow zoom
  recomputes a handful of times; the radius is derived from the bucket rather
  than the raw scale, or the cache would be drawing one frame's contour at
  another frame's radius. `folderRegionContours` now stamps each paper's
  compact support into the grid instead of evaluating every paper against every
  cell, which is what keeps the field build flat as the pitch follows the
  radius down. This reverses D3's data-space decision past the fit zoom,
  knowingly and on the user's reason — zoomed in, a data-space hull has its
  edge off-screen and identifies nothing — and the reversal is recorded in
  D3's spec, in D6's spec and in `graphFolderRegion.ts`'s docstring rather than
  left as a contradiction. Spec:
  `docs/superpowers/specs/2026-09-10-graph-region-curves-design.md`. Plan:
  `docs/superpowers/plans/2026-09-10-graph-region-curves.md`. Four manual
  checks appended to the batch.
```

- [ ] **Step 4: Run the gate**

```bash
npm run check
```

Expected: all green (this catches a prettier complaint about the roadmap).

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/handoffs/2026-09-08-roadmap.md
git commit -m "Tick D6 and hand its checks to the manual batch"
```

---

### Task 7: Land it

- [ ] **Step 1: Confirm the whole gate is green**

```bash
npm run check
```

Expected: all green.

- [ ] **Step 2: Run the whole Zotero suite one last time**

```bash
npm test
```

Expected: 43 passed, 0 failed. Remember `savedGraphMenu.test.ts`'s known intermittent case.

- [ ] **Step 3: Fast-forward to main**

```bash
git checkout main
git merge --ff-only graph-region-curves
```

Expected: `Fast-forward`.

- [ ] **Step 4: Build the XPI — after the last test run, never before**

```bash
npm run build
```

Expected: `.scaffold/build/meristema.xpi` written. `npm test` deletes it, so this step must come after Step 2 and must not be followed by another `npm test`.

- [ ] **Step 5: Stop and report**

Do not push. `origin/main` is five commits behind before this work starts, and the user has not been asked. Report the commit range, the two suites' counts, and that the XPI is built and ready to install for the manual batch.

---

## Self-Review

**Spec coverage.** Every section maps to a task:

| Spec section                                                               | Task                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decision 1, the Bézier fit, centripetal reasoning, NURBS rejection         | 1                                                                                                                                                                                                                                                                                      |
| The three traps: duplicated first point, knot guards, fit after projection | 1                                                                                                                                                                                                                                                                                      |
| `< 3 unique points` → `lineTo` fallback                                    | 1                                                                                                                                                                                                                                                                                      |
| Decision 2, `regionFalloffRadius` and the min rule                         | 2                                                                                                                                                                                                                                                                                      |
| The quantised bucket and `ZOOM_STEP`                                       | 2                                                                                                                                                                                                                                                                                      |
| `fitScale` computed rather than latched                                    | 2                                                                                                                                                                                                                                                                                      |
| Pitch follows radius                                                       | 2 (rule), 4 (applied)                                                                                                                                                                                                                                                                  |
| Stamped field build                                                        | 3                                                                                                                                                                                                                                                                                      |
| 8× floor and the cell budget                                               | 2 (floor), 3 (budget)                                                                                                                                                                                                                                                                  |
| The cache key gaining the bucket                                           | 4                                                                                                                                                                                                                                                                                      |
| The reversal recorded in D3's spec and the module docstring                | 4                                                                                                                                                                                                                                                                                      |
| Unit tests: curve builder, radius/bucket, cache key, stamped equivalence   | 1, 2, 3, 4                                                                                                                                                                                                                                                                             |
| D3's zoom-invariance test rewritten rather than deleted                    | 4, Step 1 — the new pan/zoom case is its replacement at the renderer boundary, where a zoom can actually be applied. The module-level "gives the same contour ... deterministically" case stays as-is and its docstring is already accurate: `folderRegionContours` takes no viewport. |
| Zotero: a region survives a zoom-in                                        | 5                                                                                                                                                                                                                                                                                      |
| Manual checks appended to the roadmap's batch                              | 6                                                                                                                                                                                                                                                                                      |
| "What this does not do" (B25, B26, B27, the `canvasError` latch)           | no task, by design — these are explicitly out of scope                                                                                                                                                                                                                                 |

**Placeholders:** none. Every code step carries the code; every command carries its expected output; no step says "similar to Task N".

**Type consistency:** `regionFitScale`, `regionZoomBucket`, `regionFalloffRadius` and `regionGridPitch` are declared in Task 2 with the same signatures Task 4 calls. `dataExtent()` returns `{ width, height, spread }` in Task 4 Step 3 and is read as `extent.width` / `extent.height` / `extent.spread` in the same step. `regionsFor(plot, scale)` is declared and called in the same task. `RecordingPath` (Task 1, `graphFolderRegion.test.ts`) and `FakePath2D` (Tasks 1 and 4, `citationGraphRendererRegions.test.ts`) are separate doubles in separate files, both with a `commands: Array<{ op, args }>` shape — deliberate, since the two files already keep separate doubles.

**One risk worth naming before execution:** Task 3's golden numbers (68/26 vertices, the four coordinate sums) were recorded from the current implementation on 2026-09-10. If Task 1 or Task 2 is ever reordered ahead of them, the golden still holds — neither touches the field — but if the golden ever fails after Task 3, the stamp's footprint is wrong, most likely `reach` being one cell too small. Do not adjust the golden to match the new output.
