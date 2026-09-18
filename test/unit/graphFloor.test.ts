import { describe, it } from "node:test";
import { expect } from "chai";
import {
  floorAtWorld,
  floorLinePlacement,
  floorTagText,
  roundFloor,
  WORLD_PLOT,
  type FloorAxisInput,
} from "../../src/services/graphFloor";
import { graphThemeFor } from "../../src/services/graphTheme";

const citationsLinear: FloorAxisInput = {
  metric: "citations",
  scale: "linear",
  domain: [0, 100],
};
const citationsLog: FloorAxisInput = {
  metric: "citations",
  scale: "log",
  domain: [1, 1000],
};
const year: FloorAxisInput = {
  metric: "year",
  scale: "linear",
  domain: [1990, 2026],
};

describe("roundFloor", function () {
  it("rounds to the band's step and never below 0", function () {
    expect(roundFloor(0)).to.equal(0);
    expect(roundFloor(-3)).to.equal(0);
    expect(roundFloor(7.4)).to.equal(7);
    expect(roundFloor(19.6)).to.equal(20);
    expect(roundFloor(23)).to.equal(25);
    expect(roundFloor(97)).to.equal(95);
    expect(roundFloor(99)).to.equal(100);
    expect(roundFloor(104)).to.equal(100);
    expect(roundFloor(996)).to.equal(1000);
    expect(roundFloor(1449)).to.equal(1400);
    expect(roundFloor(Number.NaN)).to.equal(0);
  });
});

describe("floorLinePlacement", function () {
  it("puts the floor on Y when Y shows citations", function () {
    const placed = floorLinePlacement(year, citationsLinear, 50);
    expect(placed).to.deep.equal({
      axis: "y",
      world: (WORLD_PLOT.bottom + WORLD_PLOT.top) / 2,
    });
  });

  it("puts the floor on X when only X shows citations", function () {
    const placed = floorLinePlacement(citationsLinear, year, 50);
    expect(placed).to.deep.equal({
      axis: "x",
      world: (WORLD_PLOT.left + WORLD_PLOT.right) / 2,
    });
  });

  it("prefers Y when both axes show citations", function () {
    expect(
      floorLinePlacement(citationsLinear, citationsLinear, 50)?.axis,
    ).to.equal("y");
  });

  it("is null when neither axis shows citations, or the axis has no domain", function () {
    expect(floorLinePlacement(year, year, 50)).to.equal(null);
    expect(
      floorLinePlacement(year, { ...citationsLinear, domain: null }, 50),
    ).to.equal(null);
  });

  it("sits on the bottom edge at off, on a log axis whose domain starts above 0", function () {
    expect(floorLinePlacement(year, citationsLog, 0)?.world).to.equal(
      WORLD_PLOT.bottom,
    );
    expect(floorLinePlacement(year, citationsLog, 1)?.world).to.equal(
      WORLD_PLOT.bottom,
    );
  });

  it("clamps a floor past the domain to the top edge", function () {
    expect(floorLinePlacement(year, citationsLinear, 5000)?.world).to.equal(
      WORLD_PLOT.top,
    );
  });
});

describe("floorAtWorld", function () {
  it("inverts a Y position through the scale and rounds it", function () {
    const middle = (WORLD_PLOT.bottom + WORLD_PLOT.top) / 2;
    expect(floorAtWorld("y", citationsLinear, middle)).to.equal(50);
    // log: halfway between 1 and 1000 is 10^1.5 ≈ 31.6, which rounds to 30.
    expect(floorAtWorld("y", citationsLog, middle)).to.equal(30);
  });

  it("inverts an X position", function () {
    const quarter = WORLD_PLOT.left + (WORLD_PLOT.right - WORLD_PLOT.left) / 4;
    expect(floorAtWorld("x", citationsLinear, quarter)).to.equal(25);
  });

  it("reads 0 at or past the axis edge on every scale", function () {
    expect(floorAtWorld("y", citationsLog, WORLD_PLOT.bottom)).to.equal(0);
    expect(floorAtWorld("y", citationsLog, WORLD_PLOT.bottom + 40)).to.equal(0);
    expect(floorAtWorld("x", citationsLog, WORLD_PLOT.left - 5)).to.equal(0);
    expect(floorAtWorld("y", { ...citationsLog, domain: null }, 300)).to.equal(
      0,
    );
  });
});

describe("floorTagText", function () {
  const grouped = new Intl.NumberFormat(undefined, { useGrouping: true });

  it("names the floor and the count, and reads off at 0", function () {
    expect(floorTagText(0, 0)).to.equal("⇕ floor: off");
    expect(floorTagText(20, 143)).to.equal(
      "⇕ floor: ≥ 20 citations · 143 below",
    );
    expect(floorTagText(1200, 1500)).to.equal(
      `⇕ floor: ≥ ${grouped.format(1200)} citations · ${grouped.format(1500)} below`,
    );
  });
});

describe("the floor's theme tokens", function () {
  it("exist on both schemes", function () {
    for (const scheme of ["light", "dark"] as const) {
      const states = graphThemeFor(scheme).states;
      expect(states.floorLine, scheme).to.be.a("string").and.not.empty;
      expect(states.floorBand, scheme).to.be.a("string").and.not.empty;
    }
  });
});
