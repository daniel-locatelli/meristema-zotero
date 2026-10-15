import { describe, it } from "node:test";
import { expect } from "chai";
import {
  boxMissesRect,
  centredTransform,
  devicePixelScale,
  segmentMissesRect,
  offscreenPanDelta,
  projectToScreen,
  projectToWorld,
  screenLengthToWorld,
  wheelZoomFactor,
} from "../../src/services/graphViewport";

const TRANSFORMS = [
  { x: 0, y: 0, scale: 1 },
  { x: 0, y: 0, scale: 0.15 },
  { x: -412.5, y: 96.25, scale: 8 },
  { x: 1024, y: -768, scale: 0.7331 },
  { x: 37.5, y: 37.5, scale: 2.5 },
];

const POINTS = [
  { x: 0, y: 0 },
  { x: 105, y: 60 },
  { x: 1030, y: 675 },
  { x: -45, y: 815 },
  { x: 1100.5, y: 760.5 },
];

describe("Graph viewport", function () {
  it("round-trips world and screen coordinates across the zoom range", function () {
    for (const transform of TRANSFORMS) {
      for (const point of POINTS) {
        const screen = projectToScreen(point, transform);
        const world = projectToWorld(screen, transform);
        expect(world.x).to.be.closeTo(point.x, 1e-9);
        expect(world.y).to.be.closeTo(point.y, 1e-9);
      }
    }
  });

  it("projects the pan offset when the scale is one", function () {
    expect(
      projectToScreen({ x: 10, y: 20 }, { x: 5, y: -5, scale: 1 }),
    ).to.deep.equal({ x: 15, y: 15 });
  });

  it("keeps a screen-space length constant in world units as the zoom rises", function () {
    // A node drawn at a fixed device size covers less of the world the further
    // in the view is zoomed — the conversion `hitTest` depends on.
    const near = screenLengthToWorld(18, { x: 0, y: 0, scale: 1 });
    const far = screenLengthToWorld(18, { x: 0, y: 0, scale: 8 });
    expect(near).to.equal(18);
    expect(far).to.equal(2.25);
  });

  it("reads the device pixel scale off the canvas and guards a zero width", function () {
    expect(devicePixelScale(2000, 1000)).to.equal(2);
    expect(devicePixelScale(1000, 1000)).to.equal(1);
    expect(devicePixelScale(4, 0)).to.equal(4);
  });
});

describe("Centring on a point", function () {
  it("puts the point at the canvas centre and keeps the zoom", function () {
    for (const transform of TRANSFORMS) {
      for (const point of POINTS) {
        const centred = centredTransform(point, transform, 800, 600);
        expect(centred.scale).to.equal(transform.scale);
        const screen = projectToScreen(point, centred);
        expect(screen.x).to.be.closeTo(400, 1e-9);
        expect(screen.y).to.be.closeTo(300, 1e-9);
      }
    }
  });
});

describe("Off-screen pan", function () {
  const width = 800;
  const height = 600;
  const margin = 10;

  it("moves nothing for a point inside the margin", function () {
    expect(
      offscreenPanDelta({ x: 400, y: 300 }, margin, width, height),
    ).to.deep.equal({ x: 0, y: 0 });
    expect(
      offscreenPanDelta({ x: 10, y: 590 }, margin, width, height),
      "on the margin line counts as inside",
    ).to.deep.equal({ x: 0, y: 0 });
  });

  it("moves by the minimum past each edge", function () {
    expect(
      offscreenPanDelta({ x: -50, y: 300 }, margin, width, height),
    ).to.deep.equal({ x: 60, y: 0 });
    expect(
      offscreenPanDelta({ x: 850, y: 300 }, margin, width, height),
    ).to.deep.equal({ x: -60, y: 0 });
    expect(
      offscreenPanDelta({ x: 400, y: -20 }, margin, width, height),
    ).to.deep.equal({ x: 0, y: 30 });
    expect(
      offscreenPanDelta({ x: 400, y: 700 }, margin, width, height),
    ).to.deep.equal({ x: 0, y: -110 });
  });

  it("moves on both axes past a corner", function () {
    expect(
      offscreenPanDelta({ x: 900, y: -100 }, margin, width, height),
    ).to.deep.equal({ x: -110, y: 110 });
  });
});

describe("Wheel zoom factor", function () {
  it("zooms in on a negative delta and out on a positive one, symmetrically", function () {
    const zoomIn = wheelZoomFactor(-100, 0);
    const zoomOut = wheelZoomFactor(100, 0);
    expect(zoomIn).to.be.greaterThan(1);
    expect(zoomOut).to.be.lessThan(1);
    expect(zoomIn * zoomOut).to.be.closeTo(1, 1e-9);
  });

  it("covers the zoom range in about sixteen wheel notches", function () {
    // A Windows mouse sends 100 pixels per notch. The old coefficient needed
    // more than thirty notches from the minimum scale to the maximum, which is
    // what "I have to scroll a lot" meant.
    const notches = Math.log(8 / 0.15) / Math.log(wheelZoomFactor(-100, 0));
    expect(notches).to.be.within(14, 18);
  });

  it("treats one line as sixteen pixels and a page as one screen", function () {
    expect(wheelZoomFactor(-3, 1)).to.be.closeTo(wheelZoomFactor(-48, 0), 1e-9);
    expect(wheelZoomFactor(-1, 2)).to.be.closeTo(
      wheelZoomFactor(-800, 0),
      1e-9,
    );
  });

  it("keeps a trackpad's small deltas gentle", function () {
    expect(wheelZoomFactor(-4, 0)).to.be.within(1.005, 1.02);
  });

  it("caps a single event so an inertial fling cannot jump the view", function () {
    expect(wheelZoomFactor(-5000, 0)).to.equal(wheelZoomFactor(-400, 0));
    expect(wheelZoomFactor(5000, 0)).to.equal(wheelZoomFactor(400, 0));
    expect(wheelZoomFactor(-400, 0)).to.be.lessThan(3);
  });

  it("does nothing on a zero delta", function () {
    expect(wheelZoomFactor(0, 0)).to.equal(1);
  });
});

describe("boxMissesRect", function () {
  const rect = { left: 0, top: 0, right: 100, bottom: 50 };

  it("keeps a box inside, straddling, or spanning the rect", function () {
    expect(boxMissesRect(10, 10, 20, 20, 0, rect)).to.equal(false);
    expect(boxMissesRect(-30, 10, 5, 20, 0, rect)).to.equal(false);
    // Both ends off-screen on opposite sides: the segment crosses the rect.
    expect(boxMissesRect(-500, -500, 500, 500, 0, rect)).to.equal(false);
  });

  it("culls a box wholly off any one side", function () {
    expect(boxMissesRect(-30, 10, -1, 20, 0, rect)).to.equal(true);
    expect(boxMissesRect(101, 10, 130, 20, 0, rect)).to.equal(true);
    expect(boxMissesRect(10, -30, 20, -1, 0, rect)).to.equal(true);
    expect(boxMissesRect(10, 51, 20, 80, 0, rect)).to.equal(true);
  });

  it("keeps a box the margin reaches into the rect", function () {
    expect(boxMissesRect(-30, 10, -5, 20, 6, rect)).to.equal(false);
    expect(boxMissesRect(-30, 10, -5, 20, 4, rect)).to.equal(true);
    // Touching an edge exactly is not a miss.
    expect(boxMissesRect(100, 10, 120, 20, 0, rect)).to.equal(false);
  });

  it("never culls on a non-finite bound, so a bad box draws as before", function () {
    expect(boxMissesRect(Number.NaN, 10, 20, 20, 0, rect)).to.equal(false);
    expect(boxMissesRect(-30, 10, -5, 20, Number.NaN, rect)).to.equal(false);
  });
});

describe("segmentMissesRect", function () {
  const rect = { left: 0, top: 0, right: 100, bottom: 50 };

  it("keeps a segment inside, entering, or crossing the rect", function () {
    expect(segmentMissesRect(10, 10, 20, 20, 0, rect)).to.equal(false);
    expect(segmentMissesRect(-50, 25, 50, 25, 0, rect)).to.equal(false);
    expect(segmentMissesRect(-500, 25, 500, 25, 0, rect)).to.equal(false);
    expect(segmentMissesRect(50, -500, 50, 500, 0, rect)).to.equal(false);
  });

  it("culls a long diagonal whose box covers the rect but whose line passes it", function () {
    // From far left-below to far top-right, passing beyond the corner at
    // (100, 0): the box spans the rect, the line never enters it.
    expect(boxMissesRect(-1000, -1000, 1000, 1000, 0, rect)).to.equal(false);
    expect(segmentMissesRect(-1000, -900, 1000, -1100, 0, rect)).to.equal(true);
    expect(segmentMissesRect(0, -200, 300, 100, 0, rect)).to.equal(true);
  });

  it("keeps a segment the margin reaches into the rect", function () {
    // Passes 10 px above the top edge.
    expect(segmentMissesRect(-50, -10, 150, -10, 9, rect)).to.equal(true);
    expect(segmentMissesRect(-50, -10, 150, -10, 11, rect)).to.equal(false);
  });

  it("treats a point segment as a point", function () {
    expect(segmentMissesRect(10, 10, 10, 10, 0, rect)).to.equal(false);
    expect(segmentMissesRect(-10, 10, -10, 10, 5, rect)).to.equal(true);
  });

  it("never culls on a non-finite coordinate or margin", function () {
    expect(segmentMissesRect(Number.NaN, 0, -5, -5, 0, rect)).to.equal(false);
    expect(segmentMissesRect(-9, -9, -5, -5, Number.NaN, rect)).to.equal(false);
    expect(
      segmentMissesRect(-9, -9, Number.POSITIVE_INFINITY, -5, 0, rect),
    ).to.equal(false);
  });
});
