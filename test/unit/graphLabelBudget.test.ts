import { describe, it } from "node:test";
import { expect } from "chai";

import {
  createLabelBudget,
  createRectangleIndex,
  createTextWidthCache,
  overlapArea,
  type LabelRectangle,
} from "../../src/services/graphLabelBudget";

/** A deterministic spread of rectangles, wide enough to span several cells. */
function fixture(count: number): LabelRectangle[] {
  const rectangles: LabelRectangle[] = [];
  let seed = 7;
  for (let index = 0; index < count; index += 1) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const left = (seed % 900) - 100;
    const top = ((seed >>> 7) % 700) - 100;
    const width = 20 + ((seed >>> 3) % 160);
    const height = 10 + ((seed >>> 11) % 30);
    rectangles.push({
      left,
      right: left + width,
      top,
      bottom: top + height,
    });
  }
  return rectangles;
}

function bruteForce(
  rectangle: LabelRectangle,
  others: readonly LabelRectangle[],
): number {
  return others.reduce((sum, other) => sum + overlapArea(rectangle, other), 0);
}

describe("Graph label budget", () => {
  it("returns the same overlap the brute-force sum does", () => {
    // The whole point of the index is that it changes the cost, not the answer.
    const rectangles = fixture(120);
    const queries = fixture(60);
    for (const cellSize of [16, 64, 300]) {
      const index = createRectangleIndex(cellSize);
      const inserted: LabelRectangle[] = [];
      for (const rectangle of rectangles) {
        index.insert(rectangle);
        inserted.push(rectangle);
      }
      for (const query of queries) {
        expect(index.overlap(query), `cell ${cellSize}`).to.be.closeTo(
          bruteForce(query, inserted),
          1e-9,
        );
      }
    }
  });

  it("counts a rectangle spanning many cells exactly once", () => {
    const index = createRectangleIndex(10);
    // Ten cells wide and ten tall: a naive per-cell sum would report 100x.
    index.insert({ left: 0, right: 100, top: 0, bottom: 100 });
    expect(
      index.overlap({ left: 0, right: 100, top: 0, bottom: 100 }),
    ).to.equal(100 * 100);
  });

  it("agrees with brute force as placements accumulate", () => {
    const index = createRectangleIndex();
    const placed: LabelRectangle[] = [];
    for (const rectangle of fixture(80)) {
      expect(index.overlap(rectangle)).to.be.closeTo(
        bruteForce(rectangle, placed),
        1e-9,
      );
      index.insert(rectangle);
      placed.push(rectangle);
    }
  });

  it("stops once labels have covered their share of the plot", () => {
    const budget = createLabelBudget(1000, 0.2);
    expect(budget.hasRoom()).to.equal(true);
    budget.placed(100);
    expect(budget.hasRoom()).to.equal(true);
    budget.placed(150);
    expect(budget.hasRoom()).to.equal(false);
  });

  it("stops after enough consecutive labels find nowhere to go", () => {
    const budget = createLabelBudget(1_000_000, 0.5, 3);
    budget.failed();
    budget.failed();
    expect(budget.hasRoom()).to.equal(true);
    budget.failed();
    expect(budget.hasRoom()).to.equal(false);
  });

  it("forgives failures once a label lands, so a crowded patch is not fatal", () => {
    const budget = createLabelBudget(1_000_000, 0.5, 3);
    budget.failed();
    budget.failed();
    budget.placed(1);
    budget.failed();
    budget.failed();
    expect(budget.hasRoom()).to.equal(true);
  });

  it("labels a bounded number of nodes however many there are", () => {
    // The property the 220-node cliff used to buy, without the cliff: a plot
    // only has so much room, whether there are 300 nodes or 30,000.
    const label = 90 * 14;
    const place = (nodeCount: number): number => {
      const budget = createLabelBudget(1200 * 800);
      let placed = 0;
      for (let index = 0; index < nodeCount; index += 1) {
        if (!budget.hasRoom()) break;
        budget.placed(label);
        placed += 1;
      }
      return placed;
    };
    expect(place(300)).to.equal(place(30_000));
    expect(place(30_000)).to.be.below(300);
  });

  it("measures a string once per font and re-measures when the font changes", () => {
    let calls = 0;
    const measurer = {
      measureText(text: string) {
        calls += 1;
        return { width: text.length * 6 };
      },
    };
    const cache = createTextWidthCache();
    expect(cache.width(measurer, "11px sans", "Darwin (1859)")).to.equal(78);
    expect(cache.width(measurer, "11px sans", "Darwin (1859)")).to.equal(78);
    expect(calls).to.equal(1);
    // A resize changes the device pixel ratio and so the font string; the
    // cached width would be wrong, and the key is what stops it being reused.
    cache.width(measurer, "22px sans", "Darwin (1859)");
    expect(calls).to.equal(2);
  });

  it("drops its entries rather than growing without limit", () => {
    let calls = 0;
    const measurer = {
      measureText(text: string) {
        calls += 1;
        return { width: text.length };
      },
    };
    const cache = createTextWidthCache(4);
    for (let index = 0; index < 5; index += 1) {
      cache.width(measurer, "f", `label-${index}`);
    }
    expect(calls).to.equal(5);
    // The fifth insert cleared the map, so the first string is gone.
    cache.width(measurer, "f", "label-0");
    expect(calls).to.equal(6);
  });
});
