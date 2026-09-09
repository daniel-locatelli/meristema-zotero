import { describe, it } from "node:test";
import { expect } from "chai";
import {
  graphThemeCustomProperties,
  graphThemeFor,
  inLibraryRingColor,
  seedColorAt,
} from "../../src/services/graphTheme";

describe("seed colours", function () {
  it("gives each palette index its own seed colour and wraps round", function () {
    const theme = graphThemeFor("light");
    const seeds = theme.seeds;
    expect(seedColorAt(0, theme)).to.equal(seeds[0]);
    expect(seedColorAt(1, theme)).to.equal(seeds[1]);
    expect(seedColorAt(seeds.length, theme)).to.equal(seeds[0]);
    expect(seedColorAt(-1, theme)).to.equal(seeds[0]);
  });

  it("draws seeds from a palette of their own, never the categorical one", function () {
    for (const scheme of ["light", "dark"] as const) {
      const theme = graphThemeFor(scheme);
      for (const seed of theme.seeds) {
        expect(theme.categorical.swatches, `${scheme} ${seed}`).to.not.include(
          seed,
        );
        expect(theme.ramp, `${scheme} ${seed}`).to.not.include(seed);
      }
    }
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

  it("falls back to a neutral, never to a ramp stop", function () {
    for (const scheme of ["light", "dark"] as const) {
      const theme = graphThemeFor(scheme);
      expect(theme.ramp, scheme).to.not.include(theme.states.inLibraryRing);
    }
  });
});
