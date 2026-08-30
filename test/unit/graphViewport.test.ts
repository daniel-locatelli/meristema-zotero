import { describe, it } from "node:test";
import { expect } from "chai";
import {
  devicePixelScale,
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
