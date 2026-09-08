import { describe, it } from "node:test";
import { expect } from "chai";
import {
  devicePixelScale,
  offscreenPanDelta,
  projectToScreen,
  projectToWorld,
  screenLengthToWorld,
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
