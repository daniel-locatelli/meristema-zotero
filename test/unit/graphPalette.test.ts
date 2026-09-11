import { describe, it } from "node:test";
import { expect } from "chai";
import { graphThemeFor, type GraphTheme } from "../../src/services/graphTheme";

type RGB = [number, number, number];
type Lab = [number, number, number];

function toLinear(hex: string): RGB {
  const channel = (start: number): number => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return [channel(1), channel(3), channel(5)];
}

function toLab([r, g, b]: RGB): Lab {
  // sRGB D65 → XYZ, then XYZ → CIE L*a*b* against the D65 white point.
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.9505;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.089;
  const f = (t: number): number =>
    t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** CIE76 ΔE. Coarser than ΔE2000 but monotone enough for a floor. */
function deltaE(left: Lab, right: Lab): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function chroma(lab: Lab): number {
  return Math.hypot(lab[1], lab[2]);
}

/** Viénot, Brettel and Mollon (1999) dichromat simulation, on linear RGB. */
const CVD_MATRICES: Record<string, number[][]> = {
  protanopia: [
    [0.1121, 0.8853, -0.0005],
    [0.1127, 0.8897, -0.0001],
    [0.0045, 0.0, 1.0019],
  ],
  deuteranopia: [
    [0.292, 0.7054, -0.0003],
    [0.2934, 0.7089, 0.0],
    [-0.0209, 0.0257, 0.9993],
  ],
  tritanopia: [
    [0.9957, 0.0089, -0.0048],
    [0.0, 0.9998, 0.0],
    [-0.0153, 0.7674, 0.2478],
  ],
};

function simulate(rgb: RGB, kind: string): RGB {
  const m = CVD_MATRICES[kind];
  return [
    m[0][0] * rgb[0] + m[0][1] * rgb[1] + m[0][2] * rgb[2],
    m[1][0] * rgb[0] + m[1][1] * rgb[1] + m[1][2] * rgb[2],
    m[2][0] * rgb[0] + m[2][1] * rgb[1] + m[2][2] * rgb[2],
  ];
}

function labOf(hex: string): Lab {
  return toLab(toLinear(hex));
}

function labUnder(hex: string, kind: string): Lab {
  return toLab(simulate(toLinear(hex), kind));
}

/** The smallest ΔE between any two members, under one vision model. */
function minimumSeparation(
  colors: readonly string[],
  kind: string | null,
): number {
  let smallest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < colors.length; i += 1) {
    for (let j = i + 1; j < colors.length; j += 1) {
      const left = kind ? labUnder(colors[i], kind) : labOf(colors[i]);
      const right = kind ? labUnder(colors[j], kind) : labOf(colors[j]);
      smallest = Math.min(smallest, deltaE(left, right));
    }
  }
  return smallest;
}

/**
 * Measured from the shipped eight-swatch categorical palette (both themes) on
 * 2026-09-09, via a temporary reporter run against
 * `theme.categorical.swatches`, then rounded down to a round number. That
 * palette is the calibration; the new seed palette must clear the same bar,
 * and so do the four swatches F14 added on 2026-09-11 (searched for against
 * these floors, not chosen by eye).
 * Observed minima:
 *   - lightness: light 38.5-69.2, dark 40.6-62.1 → band [30, 80]
 *   - chroma: light min 39.5, dark min 36.2 → floor 30
 *   - separation, normal vision: light 32.3, dark 30.9 → floor 30
 *   - separation, protanopia: light 16.6, dark 23.7
 *   - separation, deuteranopia: light 13.6, dark 14.1
 *   - separation, tritanopia: light 12.5, dark 7.0
 *     → the worst of the three dichromacies, dark tritanopia at 7.0, sets
 *       the single CVD floor: 5
 */
const LIGHTNESS_BAND: [number, number] = [30, 80];
const CHROMA_FLOOR = 30;
const SEPARATION_FLOOR = 30;
const CVD_SEPARATION_FLOOR = 5;
const PAPER_LIGHTNESS_CLEARANCE = 20;
const SCHEMES = ["light", "dark"] as const;

function themes(): GraphTheme[] {
  return SCHEMES.map((scheme) => graphThemeFor(scheme));
}

describe("the categorical swatches", function () {
  it("sit in the lightness band and clear the chroma floor", function () {
    for (const theme of themes()) {
      for (const swatch of theme.categorical.swatches) {
        const lab = labOf(swatch);
        expect(lab[0], `${theme.scheme} ${swatch} lightness`).to.be.within(
          LIGHTNESS_BAND[0],
          LIGHTNESS_BAND[1],
        );
        expect(chroma(lab), `${theme.scheme} ${swatch} chroma`).to.be.at.least(
          CHROMA_FLOOR,
        );
      }
    }
  });

  it("stays separable in normal vision and under each dichromacy", function () {
    for (const theme of themes()) {
      const swatches = theme.categorical.swatches;
      expect(
        minimumSeparation(swatches, null),
        `${theme.scheme} normal`,
      ).to.be.at.least(SEPARATION_FLOOR);
      for (const kind of Object.keys(CVD_MATRICES)) {
        expect(
          minimumSeparation(swatches, kind),
          `${theme.scheme} ${kind}`,
        ).to.be.at.least(CVD_SEPARATION_FLOOR);
      }
    }
  });
});

describe("every data colour against its paper", function () {
  // B32: a dark-theme seed, #442b87, sat 12 lightness points above the dark
  // paper and read as a hole in the plot. Every other shipped colour in both
  // themes sits at least 23 points from its paper; the floor is that,
  // rounded down. Seeds and swatches alike are drawn as small discs, so
  // lightness against the paper is what makes them legible.
  it("keeps every seed and categorical swatch at least 20 lightness points from the paper", function () {
    for (const theme of themes()) {
      const paper = labOf(theme.surfaces.paper)[0];
      for (const colour of [...theme.seeds, ...theme.categorical.swatches]) {
        expect(
          Math.abs(labOf(colour)[0] - paper),
          `${theme.scheme} ${colour} vs paper`,
        ).to.be.at.least(PAPER_LIGHTNESS_CLEARANCE);
      }
    }
  });
});

describe("the sequential ramp", function () {
  it("rises monotonically in lightness, so it survives greyscale", function () {
    for (const theme of themes()) {
      const lightness = theme.ramp.map((stop) => labOf(stop)[0]);
      for (let i = 1; i < lightness.length; i += 1) {
        expect(lightness[i], `${theme.scheme} stop ${i}`).to.be.greaterThan(
          lightness[i - 1],
        );
      }
    }
  });
});

/**
 * `theme.states.selected` and `.searchMatch` are deliberately extreme —
 * near-black on light, near-white on dark — and `theme.states.inLibraryRing`
 * is a deliberately neutral mid-grey (its own docstring: a ring on an
 * unparseable fill must never read as a metric value). A flat ΔE floor is
 * the wrong tool for any of the three: recomputing it here found light
 * `selected` (#1b1d19) measures ΔE 19.2 against the darkest ramp stop
 * (#0f3b33) and light `searchMatch` (#0f110d) measures 23.2 — both under the
 * 30-point floor — purely because that stop is also low-lightness, even
 * though its chroma (17.2) is nearly six times either state token's. Light
 * `inLibraryRing` (#6f736a) measures ΔE 27.7 against the ramp's next stop
 * (#1e6b52), also under the floor, for the same reason: shared mid-lightness,
 * very different chroma. Both are genuine floor misses on the shipped
 * colours, not bugs to fix — the colours are right, the flat floor is not
 * the right measurement for this pair.
 *
 * What actually keeps a reader from mistaking these tokens for a data
 * colour: `selected`/`searchMatch` sit clearly outside the lightness range
 * every seed, categorical swatch and ramp stop occupies (measured margins:
 * light 10.5-16.1, dark 12.1-20 — well clear of the 10-point clearance
 * required below); `inLibraryRing` sits inside that range but reads as grey,
 * not as any hue (chroma 5.6/6.3, against a categorical floor of 30 and the
 * ramp's own least-saturated stop at 17.2/19.5). Every dichromacy simulation
 * still clears CVD_SEPARATION_FLOOR for all three tokens against all three
 * palettes (worst case 8.8, light inLibraryRing vs ramp under protanopia),
 * so a colour-blind reader is never at risk either.
 */
const NEUTRAL_CHROMA_CEILING = 15; // ~half the ramp's own lowest-chroma stop
const STATE_LIGHTNESS_CLEARANCE = 10; // measured margins: 10.5-20, both themes

function dataLightnessRange(theme: GraphTheme): [number, number] {
  const lightness = [
    ...theme.seeds.map((c) => labOf(c)[0]),
    ...theme.categorical.swatches.map((c) => labOf(c)[0]),
    ...theme.ramp.map((c) => labOf(c)[0]),
  ];
  return [Math.min(...lightness), Math.max(...lightness)];
}

describe("the state tokens", function () {
  it("keeps selected and searchMatch apart from every seed and categorical swatch, in normal vision and under each dichromacy", function () {
    for (const theme of themes()) {
      for (const stateName of ["selected", "searchMatch"] as const) {
        const combined = [
          theme.states[stateName],
          ...theme.seeds,
          ...theme.categorical.swatches,
        ];
        expect(
          minimumSeparation(combined, null),
          `${theme.scheme} ${stateName} normal`,
        ).to.be.at.least(SEPARATION_FLOOR);
        for (const kind of Object.keys(CVD_MATRICES)) {
          expect(
            minimumSeparation(combined, kind),
            `${theme.scheme} ${stateName} ${kind}`,
          ).to.be.at.least(CVD_SEPARATION_FLOOR);
        }
      }
    }
  });

  it("keeps selected and searchMatch outside the lightness range any data colour occupies, and away from the ramp under every dichromacy", function () {
    for (const theme of themes()) {
      const [min, max] = dataLightnessRange(theme);
      for (const stateName of ["selected", "searchMatch"] as const) {
        const stateHex = theme.states[stateName];
        const lab = labOf(stateHex);
        const clearance = Math.max(min - lab[0], lab[0] - max);
        expect(
          clearance,
          `${theme.scheme} ${stateName} lightness clearance`,
        ).to.be.at.least(STATE_LIGHTNESS_CLEARANCE);
        expect(
          chroma(lab),
          `${theme.scheme} ${stateName} chroma`,
        ).to.be.at.most(NEUTRAL_CHROMA_CEILING);
        for (const kind of Object.keys(CVD_MATRICES)) {
          expect(
            minimumSeparation([stateHex, ...theme.ramp], kind),
            `${theme.scheme} ${stateName} vs ramp ${kind}`,
          ).to.be.at.least(CVD_SEPARATION_FLOOR);
        }
      }
    }
  });

  it("keeps inLibraryRing apart from every seed and categorical swatch, in normal vision and under each dichromacy", function () {
    for (const theme of themes()) {
      const combined = [
        theme.states.inLibraryRing,
        ...theme.seeds,
        ...theme.categorical.swatches,
      ];
      expect(
        minimumSeparation(combined, null),
        `${theme.scheme} inLibraryRing normal`,
      ).to.be.at.least(SEPARATION_FLOOR);
      for (const kind of Object.keys(CVD_MATRICES)) {
        expect(
          minimumSeparation(combined, kind),
          `${theme.scheme} inLibraryRing ${kind}`,
        ).to.be.at.least(CVD_SEPARATION_FLOOR);
      }
    }
  });

  it("keeps inLibraryRing neutral rather than measuring it against the ramp on a flat floor", function () {
    for (const theme of themes()) {
      const ringHex = theme.states.inLibraryRing;
      expect(
        chroma(labOf(ringHex)),
        `${theme.scheme} inLibraryRing chroma`,
      ).to.be.at.most(NEUTRAL_CHROMA_CEILING);
      for (const kind of Object.keys(CVD_MATRICES)) {
        expect(
          minimumSeparation([ringHex, ...theme.ramp], kind),
          `${theme.scheme} inLibraryRing vs ramp ${kind}`,
        ).to.be.at.least(CVD_SEPARATION_FLOOR);
      }
    }
  });
});

describe("the seed palette", function () {
  it("has six colours in each theme", function () {
    for (const theme of themes()) expect(theme.seeds).to.have.length(6);
  });

  it("keeps its seeds apart, in normal vision and under each dichromacy", function () {
    for (const theme of themes()) {
      expect(
        minimumSeparation(theme.seeds, null),
        `${theme.scheme} normal`,
      ).to.be.at.least(SEPARATION_FLOOR);
      for (const kind of Object.keys(CVD_MATRICES)) {
        expect(
          minimumSeparation(theme.seeds, kind),
          `${theme.scheme} ${kind}`,
        ).to.be.at.least(CVD_SEPARATION_FLOOR);
      }
    }
  });

  it("never lands near a ramp stop, in any vision model", function () {
    // This is the collision D3 exists to end: a seed must never be mistakable
    // for a metric value, so every seed is far from every stop of the ramp.
    for (const theme of themes()) {
      for (const seed of theme.seeds) {
        for (const stop of theme.ramp) {
          expect(
            deltaE(labOf(seed), labOf(stop)),
            `${theme.scheme} ${seed} vs ramp ${stop}`,
          ).to.be.at.least(SEPARATION_FLOOR);
          for (const kind of Object.keys(CVD_MATRICES)) {
            expect(
              deltaE(labUnder(seed, kind), labUnder(stop, kind)),
              `${theme.scheme} ${seed} vs ramp ${stop} under ${kind}`,
            ).to.be.at.least(CVD_SEPARATION_FLOOR);
          }
        }
      }
    }
  });

  it("never lands near a categorical swatch, in any vision model", function () {
    // Four categorical colourings (publication type, provider, open access,
    // retraction) still paint small solid discs from these swatches, right
    // beside small solid seed discs — so a seed must clear the same
    // separation floors against the categorical palette as it does against
    // the ramp, or a reader cannot tell a seed from a category at a glance.
    for (const theme of themes()) {
      for (const seed of theme.seeds) {
        for (const swatch of theme.categorical.swatches) {
          expect(
            deltaE(labOf(seed), labOf(swatch)),
            `${theme.scheme} ${seed} vs categorical ${swatch}`,
          ).to.be.at.least(SEPARATION_FLOOR);
          for (const kind of Object.keys(CVD_MATRICES)) {
            expect(
              deltaE(labUnder(seed, kind), labUnder(swatch, kind)),
              `${theme.scheme} ${seed} vs categorical ${swatch} under ${kind}`,
            ).to.be.at.least(CVD_SEPARATION_FLOOR);
          }
        }
      }
    }
  });
});
