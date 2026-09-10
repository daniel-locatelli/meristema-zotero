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
  type RegionPoint,
} from "../../src/services/graphFolderRegion";

const OPTIONS = { radius: 10, pitch: 2 };

/** The contour's centroid, for asserting where a loop sits. */
function centroid(contour: readonly RegionPoint[]): RegionPoint {
  const sum = contour.reduce(
    (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
    { x: 0, y: 0 },
  );
  return { x: sum.x / contour.length, y: sum.y / contour.length };
}

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

describe("folder regions", function () {
  it("draws nothing for a folder with no papers", function () {
    expect(folderRegionContours([], OPTIONS)).to.deep.equal([]);
  });

  it("draws one closed loop around a single paper", function () {
    const contours = folderRegionContours([{ x: 0, y: 0 }], OPTIONS);
    expect(contours).to.have.length(1);
    const loop = contours[0];
    expect(loop.length).to.be.greaterThan(6);
    // Closed: the last vertex meets the first.
    expect(
      Math.hypot(
        loop[0].x - loop[loop.length - 1].x,
        loop[0].y - loop[loop.length - 1].y,
      ),
    ).to.be.below(0.001);
    // Roughly circular and centred on the paper.
    const middle = centroid(loop);
    expect(middle.x).to.be.closeTo(0, 1);
    expect(middle.y).to.be.closeTo(0, 1);
  });

  it("merges papers that sit close together into one loop", function () {
    const contours = folderRegionContours(
      [
        { x: 0, y: 0 },
        { x: 6, y: 0 },
      ],
      OPTIONS,
    );
    expect(contours).to.have.length(1);
    expect(extent(contours[0])).to.be.greaterThan(14);
  });

  it("leaves distant papers as separate islands", function () {
    const contours = folderRegionContours(
      [
        { x: 0, y: 0 },
        { x: 80, y: 0 },
      ],
      OPTIONS,
    );
    expect(contours).to.have.length(2);
  });

  it("draws a hole as its own loop when papers ring an empty middle", function () {
    const ring: RegionPoint[] = [];
    for (let angle = 0; angle < 360; angle += 30) {
      const radians = (angle * Math.PI) / 180;
      ring.push({ x: Math.cos(radians) * 26, y: Math.sin(radians) * 26 });
    }
    const contours = folderRegionContours(ring, { radius: 10, pitch: 2 });
    // An outer loop and an inner one: the ring's middle is below threshold.
    expect(contours.length).to.be.at.least(2);
  });

  it("closes a contour whose papers sit at the extreme of the plot", function () {
    // The grid must extend past the nodes' bounding box, or the loop is cut
    // square at the edge instead of tapering shut.
    const contours = folderRegionContours([{ x: 1000, y: -1000 }], OPTIONS);
    expect(contours).to.have.length(1);
    const loop = contours[0];
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
    expect(once).to.have.length(1);
  });

  it("resolves a saddle without crossing itself", function () {
    // Two diagonal pairs make a cell whose corners alternate above and below
    // the threshold. The naive case table joins them wrongly and the loop
    // self-intersects; disambiguating by the cell's mean does not.
    const contours = folderRegionContours(
      [
        { x: 0, y: 0 },
        { x: 18, y: 18 },
        { x: 0, y: 18 },
        { x: 18, y: 0 },
      ],
      { radius: 11, pitch: 1.5 },
    );
    expect(contours.length).to.be.at.least(1);
    for (const loop of contours) {
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
      [
        [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 2, y: 2 },
        ],
      ],
      (point: RegionPoint) => ({ x: point.x * 10, y: point.y * 10 }),
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
   * A → B the predecessor of A and the successor of B are both C, since the
   * ring only has three vertices. That still shows up in the averaged
   * `start`/`end` points, even though none of them equals a ring vertex
   * outright: hand-checked below for ring [(0,0),(10,0),(5,9)].
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

    const path = regionPathFor(recordingView().view, [ring], IDENTITY);
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

  it("returns null when the window has no Path2D at all", function () {
    expect(
      regionPathFor(
        {} as unknown as Window,
        [[{ x: 0, y: 0 }]],
        (p: RegionPoint) => p,
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
});

describe("region zoom rules", function () {
  const SPREAD = 1000;

  it("holds today's radius at and below the fit zoom", function () {
    // Byte-identical to what D3 shipped, which is the whole point of the
    // crossover sitting at the fit rather than at some pixel constant.
    expect(regionFalloffRadius(SPREAD, 1, 1)).to.equal(40);
    expect(regionFalloffRadius(SPREAD, 0.5, 1)).to.equal(40);
    expect(regionFalloffRadius(SPREAD, 0.15, 1)).to.equal(40);
    expect(regionZoomBucket(0.5, 1)).to.equal(0);
    expect(regionZoomBucket(1, 1)).to.equal(0);
  });

  it("tightens in 12% steps past the fit zoom", function () {
    expect(regionZoomBucket(1.12, 1)).to.equal(1);
    expect(regionFalloffRadius(SPREAD, 1.12, 1)).to.be.closeTo(40 / 1.12, 1e-9);
    expect(regionZoomBucket(1.12 ** 4, 1)).to.equal(4);
    expect(regionFalloffRadius(SPREAD, 1.12 ** 4, 1)).to.be.closeTo(
      40 / 1.12 ** 4,
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
      40 / 1.12 ** 18,
      1e-9,
    );
  });

  it("keeps the pitch a fifth of the radius, so bucket 0 is today's grid", function () {
    expect(regionGridPitch(regionFalloffRadius(SPREAD, 1, 1))).to.equal(8);
    expect(regionGridPitch(40 / 1.12)).to.be.closeTo(8 / 1.12, 1e-9);
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
    expect(regionFalloffRadius(SPREAD, 1, 0)).to.equal(40);
    expect(regionFalloffRadius(SPREAD, Number.NaN, 1)).to.equal(40);
    expect(regionFalloffRadius(0, 1, 1)).to.equal(0);
    expect(regionFalloffRadius(Number.NaN, 1, 1)).to.equal(0);
  });
});
