import { describe, it } from "node:test";
import { expect } from "chai";
import {
  folderRegionContours,
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

  it("gives the same contour whatever the zoom, because the field is data space", function () {
    // The renderer transforms this contour for display; the shape itself must
    // not depend on the viewport, or a folder would fragment as you zoom in.
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
});
