import { describe, it } from "node:test";
import { expect } from "chai";
import {
  folderRegionContours,
  regionComponents,
  regionFalloffRadius,
  regionFitScale,
  regionGridPitch,
  regionPathFor,
  regionZoomBucket,
  resampleRing,
  type FolderRegionShapes,
  type RegionPoint,
} from "../../src/services/graphFolderRegion";

const OPTIONS = { radius: 10, pitch: 2 };

function extent(contour: readonly RegionPoint[]): number {
  const xs = contour.map((point) => point.x);
  return Math.max(...xs) - Math.min(...xs);
}

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
  arc(...args: number[]): void {
    this.commands.push({ op: "arc", args });
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

describe("folder regions", function () {
  it("draws nothing for a folder with no papers", function () {
    expect(folderRegionContours([], OPTIONS)).to.deep.equal({
      radius: 0,
      pitch: 0,
      discs: [],
      loops: [],
    });
  });

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

  it("draws a hole as its own loop when papers ring an empty middle", function () {
    const ring: RegionPoint[] = [];
    for (let angle = 0; angle < 360; angle += 30) {
      const radians = (angle * Math.PI) / 180;
      ring.push({ x: Math.cos(radians) * 26, y: Math.sin(radians) * 26 });
    }
    const shapes = folderRegionContours(ring, { radius: 10, pitch: 2 });
    // An outer loop and an inner one: the ring's middle is below threshold.
    expect(shapes.loops.length).to.be.at.least(2);
  });

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

  it("gives the same contour for the same input, deterministically", function () {
    // This proves determinism, not zoom invariance: `folderRegionContours`
    // takes no viewport, so it cannot even be handed a zoom level to vary.
    // Zoom invariance holds structurally at or below the fit zoom, because the
    // renderer transforms this same data-space contour for display rather
    // than recomputing it per zoom level. Past the fit zoom the falloff
    // radius tightens (`regionFalloffRadius`), and the contour genuinely
    // changes with it — that half is asserted at the renderer's boundary, in
    // `test/unit/citationGraphRendererRegions.test.ts`, not here.
    const points = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
    ];
    const once = folderRegionContours(points, OPTIONS);
    const twice = folderRegionContours(points, OPTIONS);
    expect(twice).to.deep.equal(once);
    expect(once.loops).to.have.length(1);
  });

  it("resolves a saddle without crossing itself", function () {
    // Two diagonal pairs make a cell whose corners alternate above and below
    // the threshold. The naive case table joins them wrongly and the loop
    // self-intersects; disambiguating by the cell's mean does not.
    const shapes = folderRegionContours(
      [
        { x: 0, y: 0 },
        { x: 18, y: 18 },
        { x: 0, y: 18 },
        { x: 18, y: 0 },
      ],
      { radius: 11, pitch: 1.5 },
    );
    expect(shapes.loops.length).to.be.at.least(1);
    for (const loop of shapes.loops) {
      expect(loop.length).to.be.greaterThan(6);
    }
  });

  /**
   * B28's case, kept: the constructor still comes from the handed-in window
   * and not from a global. What changed is the command stream — the curve is
   * a uniform cubic B-spline now, so `moveTo` lands on the first segment's
   * averaged `start`, not on a ring vertex, and each curve's end point is the
   * next segment's averaged `start` in turn.
   */
  it("builds its path from the window it is handed, not from a global", function () {
    const { view, constructor } = recordingView();
    const path = regionPathFor(
      view,
      fitOnly([
        [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 2, y: 2 },
        ],
      ]),
      (point: RegionPoint) => ({ x: point.x * 10, y: point.y * 10 }),
      1,
    );

    expect(
      path,
      "the path came from the window's constructor",
    ).to.be.instanceOf(constructor);
    const commands = (path as unknown as RecordingPath).commands;
    expect(commands.map((command) => command.op)).to.deep.equal([
      "moveTo",
      "bezierCurveTo",
      "bezierCurveTo",
      "bezierCurveTo",
      "closePath",
    ]);
    // moveTo is the first segment's averaged start: (ring[2] + 4*ring[0] +
    // ring[1]) / 6 on the projected ring [(0,0), (20,0), (20,20)].
    expect(commands[0].args[0]).to.be.closeTo(20 / 3, 1e-9);
    expect(commands[0].args[1]).to.be.closeTo(10 / 3, 1e-9);
    // Each curve ends on the next segment's start, and the ring wraps home.
    expect(commands[1].args[4]).to.be.closeTo(50 / 3, 1e-9);
    expect(commands[1].args[5]).to.be.closeTo(10 / 3, 1e-9);
    expect(commands[2].args[4]).to.be.closeTo(50 / 3, 1e-9);
    expect(commands[2].args[5]).to.be.closeTo(40 / 3, 1e-9);
    expect(commands[3].args[4]).to.be.closeTo(20 / 3, 1e-9);
    expect(commands[3].args[5]).to.be.closeTo(10 / 3, 1e-9);
  });

  /**
   * The convex-hull test. A B-spline lies inside its control polygon, which
   * inverts the old interpolating fit's premise: every emitted point (both
   * control points and each segment's end) must sit within the square's
   * bounding box, `[0,10] x [0,10]`, never bulging outward past a corner.
   *
   * The first segment's numbers are hand-checked, not recorded from the
   * implementation: for ring [(0,0),(10,0),(10,10),(0,10)], segment 0's
   * window is P0=(0,10), P1=(0,0), P2=(10,0), P3=(10,10).
   */
  it("bulges outward at a right-angle turn", function () {
    const { view } = recordingView();
    const path = regionPathFor(
      view,
      fitOnly([
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
      ]),
      IDENTITY,
      1,
    );
    const commands = (path as unknown as RecordingPath).commands;
    expect(commands[0].args[0]).to.be.closeTo(5 / 3, 1e-9);
    expect(commands[0].args[1]).to.be.closeTo(5 / 3, 1e-9);
    const first = commands[1];
    expect(first.op).to.equal("bezierCurveTo");
    expect(first.args[0]).to.be.closeTo(10 / 3, 1e-9);
    expect(first.args[1]).to.be.closeTo(0, 1e-9);
    expect(first.args[2]).to.be.closeTo(20 / 3, 1e-9);
    expect(first.args[3]).to.be.closeTo(0, 1e-9);
    expect(first.args[4]).to.be.closeTo(25 / 3, 1e-9);
    expect(first.args[5]).to.be.closeTo(5 / 3, 1e-9);
    // Every emitted point lies within the convex hull of the square.
    for (const command of commands) {
      if (command.op === "moveTo") {
        expect(command.args[0]).to.be.within(0, 10);
        expect(command.args[1]).to.be.within(0, 10);
        continue;
      }
      if (command.op !== "bezierCurveTo") continue;
      for (const pair of [
        [command.args[0], command.args[1]],
        [command.args[2], command.args[3]],
        [command.args[4], command.args[5]],
      ]) {
        expect(pair[0], `x of ${pair}`).to.be.within(0, 10);
        expect(pair[1], `y of ${pair}`).to.be.within(0, 10);
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
    const open = regionPathFor(
      recordingView().view,
      fitOnly([ring]),
      IDENTITY,
      1,
    );
    const closed = regionPathFor(
      recordingView().view,
      fitOnly([[...ring, { x: 0, y: 0 }]]),
      IDENTITY,
      1,
    );
    expect((closed as unknown as RecordingPath).commands).to.deep.equal(
      (open as unknown as RecordingPath).commands,
    );
  });

  /**
   * The minimum curve case, and the one that pins the wrap: for segment
   * A → B the predecessor of A and the successor of B are both C, since the
   * ring only has three vertices. That still shows up in the averaged
   * `start`/`end` points, even though none of them equals a ring vertex
   * outright: hand-checked below for ring [(0,0),(10,0),(5,9)].
   */
  it("wraps a three-vertex ring with C in both neighbour roles", function () {
    const path = regionPathFor(
      recordingView().view,
      fitOnly([
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 5, y: 9 },
        ],
      ]),
      IDENTITY,
      1,
    );
    const commands = (path as unknown as RecordingPath).commands;
    expect(commands.filter((c) => c.op === "bezierCurveTo")).to.have.length(3);
    // moveTo = segment 0's start = (C + 4*A + B) / 6.
    expect(commands[0].args[0]).to.be.closeTo(2.5, 1e-9);
    expect(commands[0].args[1]).to.be.closeTo(1.5, 1e-9);
    // Segment 0 ends at (A + 4*B + C) / 6.
    expect(commands[1].args[4]).to.be.closeTo(7.5, 1e-9);
    expect(commands[1].args[5]).to.be.closeTo(1.5, 1e-9);
    // Segment 1 ends at (B + 4*C + A) / 6.
    expect(commands[2].args[4]).to.be.closeTo(5, 1e-9);
    expect(commands[2].args[5]).to.be.closeTo(6, 1e-9);
    // Segment 2 ends at (C + 4*A + B) / 6, wrapping back to the moveTo.
    expect(commands[3].args[4]).to.be.closeTo(2.5, 1e-9);
    expect(commands[3].args[5]).to.be.closeTo(1.5, 1e-9);
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
    const path = regionPathFor(
      recordingView().view,
      fitOnly(loops),
      IDENTITY,
      1,
    );
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
        regionPathFor(recordingView().view, fitOnly([loop]), IDENTITY, 1),
      ).to.not.throw();
    }
    expect(() =>
      regionPathFor(recordingView().view, fitOnly([]), IDENTITY, 1),
    ).to.not.throw();
    const path = regionPathFor(
      recordingView().view,
      fitOnly(abuse),
      IDENTITY,
      1,
    ) as unknown as RecordingPath;
    for (const command of path.commands) {
      for (const value of command.args) {
        expect(Number.isFinite(value), `${command.op} got ${value}`).to.equal(
          true,
        );
      }
    }
  });

  /**
   * The actual defect this change fixes: marching-squares vertices jitter a
   * little to either side of the smooth path they approximate, and an
   * interpolating fit reproduces that jitter exactly. An approximating fit
   * should not — the curve should sit closer to the smooth path than the raw,
   * jittered vertices do.
   *
   * Points sit on a circle of radius 100, with alternating vertices nudged
   * ±2 radially — the small, sign-alternating perturbation grid crossings
   * actually produce. Radial distance from the origin stands in for distance
   * from the smooth path.
   */
  it("smooths grid jitter instead of reproducing it", function () {
    const centre = { x: 0, y: 0 };
    const radius = 100;
    const jitter = 2;
    const count = 24;
    const ring: RegionPoint[] = [];
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * 2 * Math.PI;
      const r = radius + (i % 2 === 0 ? jitter : -jitter);
      ring.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r });
    }
    const rawDeviation = Math.max(
      ...ring.map((point) =>
        Math.abs(Math.hypot(point.x - centre.x, point.y - centre.y) - radius),
      ),
    );
    expect(rawDeviation).to.be.closeTo(jitter, 1e-9);

    const path = regionPathFor(
      recordingView().view,
      fitOnly([ring]),
      IDENTITY,
      1,
    );
    const commands = (path as unknown as RecordingPath).commands;

    function cubicAt(
      t: number,
      p0: number[],
      c1: number[],
      c2: number[],
      p3: number[],
    ): RegionPoint {
      const u = 1 - t;
      const w0 = u * u * u;
      const w1 = 3 * u * u * t;
      const w2 = 3 * u * t * t;
      const w3 = t * t * t;
      return {
        x: w0 * p0[0] + w1 * c1[0] + w2 * c2[0] + w3 * p3[0],
        y: w0 * p0[1] + w1 * c1[1] + w2 * c2[1] + w3 * p3[1],
      };
    }

    let current = commands[0].args;
    let curveDeviation = 0;
    for (const command of commands.slice(1)) {
      if (command.op !== "bezierCurveTo") continue;
      const c1 = command.args.slice(0, 2);
      const c2 = command.args.slice(2, 4);
      const end = command.args.slice(4, 6);
      for (let step = 0; step <= 10; step += 1) {
        const sample = cubicAt(step / 10, current, c1, c2, end);
        const deviation = Math.abs(
          Math.hypot(sample.x - centre.x, sample.y - centre.y) - radius,
        );
        curveDeviation = Math.max(curveDeviation, deviation);
      }
      current = end;
    }

    expect(
      curveDeviation,
      "the fitted curve should hug the smooth path more closely than the jittered vertices do",
    ).to.be.lessThan(rawDeviation);
  });

  it("still draws a two-point loop with lineTo", function () {
    const path = regionPathFor(
      recordingView().view,
      fitOnly([
        [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
        ],
      ]),
      IDENTITY,
      1,
    );
    expect(
      (path as unknown as RecordingPath).commands.map((c) => c.op),
    ).to.deep.equal(["moveTo", "lineTo", "closePath"]);
  });

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

  /**
   * The field is summed by stamping each node into its own footprint rather
   * than evaluating every node against every cell. That is an exact refactor
   * — the same sum in a different order — so these numbers are the ones the
   * per-cell evaluator produced, recorded before the change. Vertex counts
   * and coordinate sums together catch a reordering error that still yields a
   * plausible-looking shape.
   */
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
    expect(alone.loops).to.have.length(1);
    expect(withDistant.loops).to.have.length(1);
    expect(withDistant.loops[0]).to.deep.equal(alone.loops[0]);
  });

  /**
   * The case above does not actually pin the anchor: `(0,0)` is both the
   * folder's min corner and the cluster's own min corner, with or without the
   * distant paper at `(40,40)`, so per-component anchoring produces the same
   * byte-identical output as folder anchoring. That is a false pass — it
   * cannot distinguish the two anchors. Here the distant paper sits at
   * `(-101, -101)`, which actually drags the folder's min corner away from
   * the cluster's own min corner, by an offset that is not a whole number of
   * lattice pitches, so the two anchoring rules disagree about where every
   * vertex lands. Under the folder anchor every vertex still sits on the
   * folder's lattice; under a per-component anchor it would be off-lattice by
   * half a cell.
   */
  it("pins the shared lattice with a distant paper that actually moves the folder's min corner", function () {
    const cluster = [
      { x: 0, y: 0 },
      { x: 14, y: 3 },
      { x: 7, y: 16 },
    ];
    const options = { radius: 10, pitch: 2 };
    const shapes = folderRegionContours(
      [...cluster, { x: -101, y: -101 }],
      options,
    );
    // The distant paper is far past 2R from everything, so it comes back as
    // its own disc and the cluster comes back as exactly one loop — the case
    // cannot pass on an empty result.
    expect(shapes.discs).to.have.length(1);
    expect(shapes.discs[0].centre).to.deep.equal({ x: -101, y: -101 });
    expect(shapes.loops).to.have.length(1);

    // The folder's min corner is (-101, -101), so the lattice origin is
    // margin = radius * 1.5 = 15 below that on each axis: (-116, -116).
    const origin = -101 - 10 * 1.5;
    const pitch = shapes.pitch;
    const distanceFromInteger = (value: number): number =>
      Math.abs(value - Math.round(value));
    for (const point of shapes.loops[0]) {
      const onX = distanceFromInteger((point.x - origin) / pitch);
      const onY = distanceFromInteger((point.y - origin) / pitch);
      expect(
        Math.min(onX, onY),
        `point ${JSON.stringify(point)} off the shared lattice`,
      ).to.be.below(1e-9);
    }
  });

  /**
   * The lattice origin is poisoned by the very papers the partition
   * quarantines: `regionComponents` keeps a non-finite paper out of every
   * component (it joins nothing), but the shared-lattice origin used to be
   * computed from the whole, unfiltered folder. One non-finite paper made
   * that origin non-finite, which made `componentLoops`' `startColumn`
   * non-finite, which made every cluster's `columns` non-finite and every
   * cluster's `return []` fire — dropping every loop in the folder while the
   * lone-paper discs kept drawing.
   */
  it("keeps a cluster's loop unchanged by a NaN paper elsewhere in the folder", function () {
    const cluster = [
      { x: 0, y: 0 },
      { x: 14, y: 3 },
      { x: 7, y: 16 },
    ];
    const alone = folderRegionContours(cluster, { radius: 10, pitch: 2 });
    const withNaN = folderRegionContours(
      [...cluster, { x: Number.NaN, y: Number.NaN }],
      { radius: 10, pitch: 2 },
    );
    expect(alone.loops).to.have.length(1);
    expect(withNaN.loops).to.have.length(1);
    expect(withNaN.loops[0]).to.deep.equal(alone.loops[0]);
  });

  /**
   * `{ x: 0, y: 0 }` happens to already sit at the minimum on both axes, so a
   * NaN paper cannot be seen moving it. `-Infinity` actually would move the
   * minimum were it not filtered out first — this is the case that
   * distinguishes "the origin ignored the outlier" from "the outlier merely
   * didn't matter".
   */
  it("keeps a cluster's loop unchanged by a -Infinity paper that would otherwise move the minimum", function () {
    const cluster = [
      { x: 0, y: 0 },
      { x: 14, y: 3 },
      { x: 7, y: 16 },
    ];
    const alone = folderRegionContours(cluster, { radius: 10, pitch: 2 });
    const withInfinity = folderRegionContours(
      [...cluster, { x: Number.NEGATIVE_INFINITY, y: 0 }],
      { radius: 10, pitch: 2 },
    );
    expect(alone.loops).to.have.length(1);
    expect(withInfinity.loops).to.have.length(1);
    expect(withInfinity.loops[0]).to.deep.equal(alone.loops[0]);
  });

  it("returns empty shapes for a folder whose papers are all non-finite", function () {
    expect(() =>
      folderRegionContours(
        [
          { x: Number.NaN, y: Number.NaN },
          { x: Number.POSITIVE_INFINITY, y: 0 },
        ],
        OPTIONS,
      ),
    ).to.not.throw();
    const shapes = folderRegionContours(
      [
        { x: Number.NaN, y: Number.NaN },
        { x: Number.POSITIVE_INFINITY, y: 0 },
      ],
      OPTIONS,
    );
    expect(shapes).to.deep.equal({
      radius: 0,
      pitch: 0,
      discs: [],
      loops: [],
    });
  });

  it("never gives a disc a non-finite centre", function () {
    const shapes = folderRegionContours(
      [
        { x: 0, y: 0 },
        { x: Number.NaN, y: Number.NaN },
        { x: Number.NEGATIVE_INFINITY, y: 0 },
        { x: 80, y: 0 },
      ],
      OPTIONS,
    );
    for (const disc of shapes.discs) {
      expect(
        Number.isFinite(disc.centre.x) && Number.isFinite(disc.centre.y),
      ).to.equal(true);
    }
    // The two finite, mutually distant papers still come back as discs.
    expect(shapes.discs).to.have.length(2);
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
});

describe("region zoom rules", function () {
  const SPREAD = 1000;

  it("holds today's radius at and below the fit zoom", function () {
    expect(regionFalloffRadius(SPREAD, 1, 1)).to.equal(25);
    expect(regionFalloffRadius(SPREAD, 0.5, 1)).to.equal(25);
    expect(regionFalloffRadius(SPREAD, 0.15, 1)).to.equal(25);
    expect(regionZoomBucket(0.5, 1)).to.equal(0);
    expect(regionZoomBucket(1, 1)).to.equal(0);
  });

  it("tightens in 12% steps past the fit zoom", function () {
    expect(regionZoomBucket(1.12, 1)).to.equal(1);
    expect(regionFalloffRadius(SPREAD, 1.12, 1)).to.be.closeTo(25 / 1.12, 1e-9);
    expect(regionZoomBucket(1.12 ** 4, 1)).to.equal(4);
    expect(regionFalloffRadius(SPREAD, 1.12 ** 4, 1)).to.be.closeTo(
      25 / 1.12 ** 4,
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
      25 / 1.12 ** 30,
      1e-9,
    );
  });

  it("keeps the pitch a third of the radius", function () {
    // The pitch's only job is contour accuracy now: the fit's control-point
    // spacing is the resampler's, not the grid's, so a fifth was buying
    // 0.14 px of fidelity under a curve that misses by 0.51 px.
    expect(regionGridPitch(regionFalloffRadius(SPREAD, 1, 1))).to.be.closeTo(
      25 / 3,
      1e-9,
    );
    expect(regionGridPitch(25 / 1.12)).to.be.closeTo(25 / 3 / 1.12, 1e-9);
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
    expect(regionZoomBucket(Number.POSITIVE_INFINITY, 1)).to.equal(30);
    expect(regionFalloffRadius(SPREAD, 1, 0)).to.equal(25);
    expect(regionFalloffRadius(SPREAD, Number.NaN, 1)).to.equal(25);
    expect(regionFalloffRadius(0, 1, 1)).to.equal(0);
    expect(regionFalloffRadius(Number.NaN, 1, 1)).to.equal(0);
  });
});
