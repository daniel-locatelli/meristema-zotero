import { describe, it } from "node:test";
import { expect } from "chai";
import {
  graphThemeCustomProperties,
  graphThemeFor,
  inLibraryRingColor,
  seedColorAt,
} from "../../src/services/graphTheme";

describe("seed colours", function () {
  it("gives each seed the next swatch and wraps round", function () {
    const theme = graphThemeFor("light");
    const swatches = theme.categorical.swatches;
    expect(seedColorAt(0, theme)).to.equal(swatches[0]);
    expect(seedColorAt(1, theme)).to.equal(swatches[1]);
    expect(seedColorAt(swatches.length, theme)).to.equal(swatches[0]);
    expect(seedColorAt(-1, theme)).to.equal(swatches[0]);
  });
});

describe("the in-library ring", function () {
  it("brightens a hex fill", function () {
    const theme = graphThemeFor("light");
    const ring = inLibraryRingColor("#336699", theme);
    expect(ring).to.match(/^#[0-9a-f]{6}$/);
    expect(ring).to.not.equal("#336699");
    // Every channel moves towards white, none past it.
    expect(Number.parseInt(ring.slice(1, 3), 16)).to.be.greaterThan(0x33);
    expect(Number.parseInt(ring.slice(5, 7), 16)).to.be.at.most(0xff);
  });

  it("falls back to the theme token for a colour it cannot parse", function () {
    const theme = graphThemeFor("dark");
    expect(inLibraryRingColor("rgba(1, 2, 3, .4)", theme)).to.equal(
      theme.states.inLibraryRing,
    );
    expect(inLibraryRingColor("", theme)).to.equal(theme.states.inLibraryRing);
  });

  it("publishes the ring token to CSS", function () {
    const properties = graphThemeCustomProperties(graphThemeFor("light"));
    expect(properties.map(([name]) => name)).to.include(
      "--cm-state-in-library-ring",
    );
  });
});
