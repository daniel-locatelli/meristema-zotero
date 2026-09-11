import { describe, it } from "node:test";
import { expect } from "chai";
import {
  categoricalSwatchAt,
  GRAPH_APPEARANCE_PREF,
  graphThemeCustomProperties,
  graphThemeFor,
  inLibraryRingColor,
  resolveGraphScheme,
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

describe("categorical swatch lookup", function () {
  it("returns the swatch a valid index names", function () {
    const theme = graphThemeFor("light");
    expect(categoricalSwatchAt(0, theme)).to.equal(
      theme.categorical.swatches[0],
    );
    expect(categoricalSwatchAt(7, theme)).to.equal(
      theme.categorical.swatches[7],
    );
  });

  it("falls back to the Other tone when the index is outside the pool", function () {
    // A hand-edited saved state can hold an index past the palette, and a
    // shrunk palette can strand a live key on one. `strokeStyle = undefined`
    // is not a canvas error: the context keeps whatever colour the previous
    // draw left behind, so the region borrows another region's colour with
    // nothing in the console to say so (B27).
    const theme = graphThemeFor("light");
    expect(categoricalSwatchAt(99, theme)).to.equal(theme.categorical.other);
    expect(categoricalSwatchAt(-1, theme)).to.equal(theme.categorical.other);
    expect(categoricalSwatchAt(1.5, theme)).to.equal(theme.categorical.other);
    expect(categoricalSwatchAt(null, theme)).to.equal(theme.categorical.other);
  });
});

/**
 * A chrome window's `matchMedia`, answering per feature. `-moz-system-dark-theme`
 * is the OS's own setting; `prefers-color-scheme` is what the chrome document
 * shows, which follows the appearance pref only after a restyle Gecko does not
 * run at the pref write (B29). An unknown feature comes back as `not all`.
 */
function fakeView(features: Record<string, boolean>): Window {
  return {
    matchMedia: (query: string) => {
      const name = query.replace(/^\(|\)$/g, "").split(":")[0];
      const known = Object.keys(features).some((feature) =>
        name.startsWith(feature),
      );
      if (!known) return { media: "not all", matches: false };
      if (name === "prefers-color-scheme") {
        return { media: query, matches: features["prefers-color-scheme"] };
      }
      return { media: query, matches: features[name] };
    },
  } as unknown as Window;
}

describe("resolving the scheme", function () {
  function withPref<T>(value: number | null, run: () => T): T {
    const had = "Services" in globalThis;
    const previous = (globalThis as any).Services;
    (globalThis as any).Services =
      value === null
        ? undefined
        : {
            prefs: {
              getIntPref: (name: string, fallback: number) =>
                name === GRAPH_APPEARANCE_PREF ? value : fallback,
            },
          };
    try {
      return run();
    } finally {
      if (had) (globalThis as any).Services = previous;
      else delete (globalThis as any).Services;
    }
  }

  it("takes an explicit Dark or Light from the pref, whatever the OS says", function () {
    const view = fakeView({
      "-moz-system-dark-theme": true,
      "prefers-color-scheme": true,
    });
    expect(withPref(1, () => resolveGraphScheme(view))).to.equal("light");
    expect(withPref(0, () => resolveGraphScheme(view))).to.equal("dark");
  });

  it("follows the OS under Automatic, not the chrome query that lags the pref write", function () {
    // Light → Automatic on a dark OS: at the write the chrome still reports
    // light, and nothing fires when it catches up.
    const view = fakeView({
      "-moz-system-dark-theme": true,
      "prefers-color-scheme": false,
    });
    expect(withPref(2, () => resolveGraphScheme(view))).to.equal("dark");
    const lightOS = fakeView({
      "-moz-system-dark-theme": false,
      "prefers-color-scheme": true,
    });
    expect(withPref(2, () => resolveGraphScheme(lightOS))).to.equal("light");
  });

  it("falls back to the chrome query where the OS feature is unknown", function () {
    const view = fakeView({ "prefers-color-scheme": true });
    expect(withPref(2, () => resolveGraphScheme(view))).to.equal("dark");
    expect(withPref(null, () => resolveGraphScheme(view))).to.equal("dark");
    expect(resolveGraphScheme(null)).to.equal("light");
  });
});
