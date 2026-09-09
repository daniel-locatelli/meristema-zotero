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
 * palette is the calibration; the new seed palette must clear the same bar.
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
