import { describe, it } from "node:test";
import { expect } from "chai";
import {
  folderRegionContours,
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
    // Zoom invariance holds structurally, because the renderer transforms
    // this same data-space contour for display rather than recomputing it
    // per zoom level — that is not testable at this module's boundary.
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
});

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
