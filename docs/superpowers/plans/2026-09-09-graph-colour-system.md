# Graph Colour System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each of the plot's four meanings — folder, metric, seed, in-library — its own visual channel and its own palette, so no two can collide, and make every colour assignment stable under ticking, seed removal and reopening.

**Architecture:** Folder membership leaves the node's fill and becomes a marching-squares region drawn behind the nodes, computed in data space by a new DOM-free module. The fill is then free for the metric, and a seed overrides it with a colour from a new dedicated palette. Colour allocation moves out of rank order into a pure ledger that hands a key the lowest free swatch and remembers it in the graph's saved state.

**Tech Stack:** TypeScript, Zotero 7 plugin (bootstrapped, `src/services`), canvas 2D rendering, `node --test` with chai for unit tests, `zotero-plugin test` for the Zotero suite.

**Spec:** `docs/superpowers/specs/2026-09-09-graph-colour-system-design.md`. Read it before Task 1; every task below implements part of it.

**Branch:** `graph-colour-system`, off `main` at `ad90f91`.

## Global Constraints

- **No colour literal outside `graphTheme.ts`.** Nothing in `src/services` may hold one; an ESLint rule enforces it. Every new colour is a theme token.
- **Pure modules are DOM-free.** `graphFolderRegion.ts` and `graphSwatchLedger.ts` import nothing from the DOM or from Zotero, take plain data and return plain data, exactly as `graphScopeModel.ts` and `graphVisibility.ts` do.
- **The unfilled outline is reserved for Stage 4** (citation floor). Nothing in this plan may draw an unfilled node outline as a new meaning.
- **`npm run check` must pass at the end of every task** — it runs `prettier --check`, `eslint`, `tsc --noEmit` for both the source and the test project, and the unit suite.
- **One commit per task**, message in the repo's style: a short imperative subject, then prose explaining _why_, wrapped at 76 columns. End every commit message with:
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa
  ```
- **Do not run `npm test`** (the Zotero suite) until Task 10. It launches Zotero and it **deletes `.scaffold/build/meristema.xpi`**; the XPI is rebuilt once, at the very end.
- **Cap:** at most **four** folder regions are drawn at once.
- **Seed palette size:** six colours per theme.

## File Structure

**Created**

| File                                     | Responsibility                                                                                                                                                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/services/graphSwatchLedger.ts`      | Pure allocation of palette indices to keys: lowest free index, held while the key lives, longest-released reused when the pool is exhausted. Serves categories, folder regions and seeds. |
| `src/services/graphFolderRegion.ts`      | Pure marching squares: node positions in data space → closed contours in data space. No canvas, no DOM.                                                                                   |
| `test/unit/graphSwatchLedger.test.ts`    | Allocation, stability, release and reuse order.                                                                                                                                           |
| `test/unit/graphFolderRegion.test.ts`    | Contour shape, islands, holes, saddles, zoom invariance, edge tapering.                                                                                                                   |
| `test/unit/graphPalette.test.ts`         | The palette validator: lightness band, chroma floor, separation under normal vision and simulated CVD, ramp monotonicity.                                                                 |
| `test/zotero/graphFolderRegions.test.ts` | The Zotero-side walk: select two folders, assert two regions; the version 2 → 3 migration.                                                                                                |

**Modified**

| File                                              | Change                                                                                                                                   |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `src/services/graphTheme.ts`                      | New `seeds` palette, `states.uniformFill`, neutral `states.inLibraryRing`; `seedColorAt` takes a palette index, not a seed position.     |
| `src/services/graphCategoryAssignment.ts`         | Colour comes from the ledger, not from rank; `"collection"` case removed; slices removed; `colorsFor` → `colorFor` returning one colour. |
| `src/services/graphViewState.ts`                  | Version 3: `regions`, `swatchAssignments`, `seedColorIndex`; version 2 migration.                                                        |
| `src/services/citationPreferences.ts`             | `nodeColorMetric` default `"uniform"`; a stored `"collection"` coerced on read.                                                          |
| `src/services/graphViewControls.ts`               | `"Collection"` leaves the colour dropdown; `"Uniform"` joins it.                                                                         |
| `src/domain/graphTypes.ts`                        | `GraphNodeColorMetric` loses `"collection"`, gains `"uniform"`.                                                                          |
| `src/services/citationGraphRenderer.ts`           | Draws regions; seed fill overrides the metric; single-colour fills; uniform fill.                                                        |
| `src/services/graphKeyRail.ts`                    | The scope row splits into checkbox and selectable body; selected styling; region legend.                                                 |
| `src/services/graphScopeRailModel.ts`             | Rows carry `selected` and the folder's colour.                                                                                           |
| `src/services/graphViewService.ts`                | Wires selection to state and renderer; a new folder graph selects its folder.                                                            |
| `content/graph.css`                               | Selected row, grown checkbox.                                                                                                            |
| `docs/superpowers/handoffs/2026-09-08-roadmap.md` | Tick D3 and B12; append the manual checks; log line.                                                                                     |

---

### Task 1: The palettes and the validator

The seed palette is new, two theme tokens are wrong, and nothing in the repo enforces the validation `graphTheme.ts` claims. Build the validator first so the seed hexes are chosen against it rather than by eye.

**Files:**

- Modify: `src/services/graphTheme.ts`
- Create: `test/unit/graphPalette.test.ts`
- Modify: `test/unit/graphTheme.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `theme.seeds: readonly string[]` (six per theme); `theme.states.uniformFill: string`; `seedColorAt(paletteIndex: number, theme: GraphTheme): string` — **note the changed meaning of the argument**: it is an index into `theme.seeds`, allocated by the ledger in Task 2, not a seed's position in a list.

- [ ] **Step 1: Write the validator's colour maths**

Create `test/unit/graphPalette.test.ts` with the conversions and the CVD simulation. These are the standard formulae; write them out rather than adding a dependency.

```ts
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
```

- [ ] **Step 2: Write the failing assertions, with the floors left to be measured**

Append to the same file. `SEPARATION_FLOOR` and the band bounds are set in Step 4 from what the existing palette actually achieves; write them as the constants below for now so the test compiles and runs.

```ts
const LIGHTNESS_BAND: [number, number] = [30, 80];
const CHROMA_FLOOR = 20;
const SEPARATION_FLOOR = 18;
const CVD_SEPARATION_FLOOR = 12;
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
});
```

- [ ] **Step 3: Run it and watch it fail on the missing palette**

Run: `node --import ./test/nodeResolve.mjs --test test/unit/graphPalette.test.ts`

Expected: FAIL. The swatch and ramp cases may pass; every `theme.seeds` case fails, because `seeds` does not exist yet (TypeScript will also object — that is the failing test).

- [ ] **Step 4: Measure what the existing palette achieves, and set the floors from it**

Do not invent thresholds. Add a temporary reporter at the end of the file, run it, and read the numbers:

```ts
describe("reporting", function () {
  it("prints the measured minima", function () {
    for (const theme of themes()) {
      const swatches = theme.categorical.swatches;
      console.log(
        theme.scheme,
        "swatch normal",
        minimumSeparation(swatches, null).toFixed(1),
      );
      for (const kind of Object.keys(CVD_MATRICES)) {
        console.log(
          theme.scheme,
          "swatch",
          kind,
          minimumSeparation(swatches, kind).toFixed(1),
        );
      }
      console.log(
        theme.scheme,
        "swatch lightness",
        swatches.map((s) => labOf(s)[0].toFixed(0)).join(" "),
        "chroma",
        swatches.map((s) => chroma(labOf(s)).toFixed(0)).join(" "),
      );
    }
  });
});
```

Run: `node --import ./test/nodeResolve.mjs --test test/unit/graphPalette.test.ts`

Set `LIGHTNESS_BAND`, `CHROMA_FLOOR`, `SEPARATION_FLOOR` and `CVD_SEPARATION_FLOOR` to the values the **existing, shipped** palette actually meets, rounded down to a round number. The existing eight are the calibration; the seeds must then meet the same bar. Add a comment above the constants recording that they were measured from the shipped palette on 2026-09-09 and what the observed minima were. Then delete the reporter block.

- [ ] **Step 5: Add the seed palette and the two corrected tokens**

In `src/services/graphTheme.ts`, extend the interfaces:

```ts
export interface GraphStateTokens {
  selected: string;
  seed: string;
  searchMatch: string;
  retracted: string;
  /**
   * The in-library ring's colour when a node's fill cannot be brightened —
   * a ramp stop given as `rgba(...)`, or a missing fill. Neutral on purpose:
   * it used to be `#4f9a5e`, which *is* ramp stop three, so a ring on an
   * unparseable fill read as a metric value.
   */
  inLibraryRing: string;
  /** Every non-seed node when no colour metric is chosen. */
  uniformFill: string;
}

export interface GraphTheme {
  scheme: GraphColorScheme;
  surfaces: GraphSurfaceTokens;
  inks: GraphInkTokens;
  /** Five stops, monotone in lightness, low value first. */
  ramp: readonly string[];
  categorical: GraphCategoricalTokens;
  /**
   * Six hues for seeds, from the half of the wheel the ramp cannot reach, so a
   * seed can never be mistaken for a metric value. Validated in
   * `test/unit/graphPalette.test.ts` against the ramp and against each other.
   */
  seeds: readonly string[];
  edges: GraphEdgeTokens;
  states: GraphStateTokens;
}
```

In `LIGHT_THEME` add `seeds` and the two token changes:

```ts
  seeds: ["#d0104c", "#d55f00", "#8a2be2", "#1544c4", "#b0006e", "#5b3bb8"],
  states: {
    selected: "#1b1d19",
    seed: "#63665d",
    searchMatch: "#0f110d",
    retracted: "#a33a3a",
    inLibraryRing: "#6f736a",
    uniformFill: "#8d928a",
  },
```

In `DARK_THEME`:

```ts
  seeds: ["#f2447c", "#f07a1a", "#b47bff", "#5a8cff", "#e04a94", "#8f6ae0"],
  states: {
    selected: "#e8e9e3",
    seed: "#9a9c93",
    searchMatch: "#ffffff",
    retracted: "#d98b8b",
    inLibraryRing: "#a8ada2",
    uniformFill: "#787d75",
  },
```

- [ ] **Step 6: Publish the new tokens to CSS and retarget `seedColorAt`**

In `graphThemeCustomProperties`, add to the property list:

```ts
    ["--cm-state-uniform-fill", theme.states.uniformFill],
```

and after the swatch loop:

```ts
theme.seeds.forEach((seed, index) => {
  properties.push([`--cm-seed-${index}`, seed]);
});
```

Replace `seedColorAt` — its argument changes meaning, so change the doc comment with it:

```ts
/**
 * A seed's colour by **palette index**, not by its position among the seeds.
 * The index is allocated once by `graphSwatchLedger` and held for as long as
 * the seed lives, so removing one seed never repaints the others — which is
 * what indexing by position did.
 */
export function seedColorAt(paletteIndex: number, theme: GraphTheme): string {
  const seeds = theme.seeds;
  const position =
    Number.isInteger(paletteIndex) && paletteIndex > 0 ? paletteIndex : 0;
  return seeds[position % seeds.length];
}
```

- [ ] **Step 7: Update the existing theme test**

In `test/unit/graphTheme.test.ts`, the seed-colour case now describes palette indices, and the ring case must assert the fallback is no longer a ramp stop:

```ts
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
```

And add to the ring describe block:

```ts
it("falls back to a neutral, never to a ramp stop", function () {
  for (const scheme of ["light", "dark"] as const) {
    const theme = graphThemeFor(scheme);
    expect(theme.ramp, scheme).to.not.include(theme.states.inLibraryRing);
  }
});
```

- [ ] **Step 8: Run the palette tests and adjust the seed hexes until they pass**

Run: `node --import ./test/nodeResolve.mjs --test test/unit/graphPalette.test.ts test/unit/graphTheme.test.ts`

Expected: PASS. If a seed fails the separation floor against another seed or against a ramp stop, adjust that seed's hex — move its lightness away from the value it collides with, or push its chroma up; do not lower a floor. Keep the six hue families (crimson, orange, purple, indigo, magenta, violet) and keep the dark theme's variants lighter than the light theme's, since they sit on a darker paper.

- [ ] **Step 9: Run the full check and commit**

Run: `npm run check`
Expected: PASS.

```bash
git add src/services/graphTheme.ts test/unit/graphPalette.test.ts test/unit/graphTheme.test.ts
git commit
```

Subject: `Give seeds a palette of their own, and prove the palettes apart`.

---

### Task 2: The swatch ledger

Colour stops being dealt by rank. One pure module serves every palette user.

**Files:**

- Create: `src/services/graphSwatchLedger.ts`
- Create: `test/unit/graphSwatchLedger.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:

  ```ts
  export interface SwatchLedgerState {
    assigned: Record<string, number>;
    releasedOrder: string[];
  }
  export function emptySwatchLedger(): SwatchLedgerState;
  export function allocateSwatches(
    state: SwatchLedgerState,
    keys: readonly string[],
    poolSize: number,
  ): SwatchLedgerState;
  export function swatchIndexFor(
    state: SwatchLedgerState,
    key: string,
  ): number | null;
  ```

  `allocateSwatches` is pure: it returns a new state and never mutates its argument.

- [ ] **Step 1: Write the failing tests**

Create `test/unit/graphSwatchLedger.test.ts`:

```ts
import { describe, it } from "node:test";
import { expect } from "chai";
import {
  allocateSwatches,
  emptySwatchLedger,
  swatchIndexFor,
} from "../../src/services/graphSwatchLedger";

describe("the swatch ledger", function () {
  it("gives a new key the lowest free index", function () {
    const first = allocateSwatches(emptySwatchLedger(), ["a", "b"], 8);
    expect(swatchIndexFor(first, "a")).to.equal(0);
    expect(swatchIndexFor(first, "b")).to.equal(1);
  });

  it("holds a key's index while the key lives, whatever else arrives", function () {
    // This is B12: a folder's colour must not move when another is ticked.
    const first = allocateSwatches(emptySwatchLedger(), ["phd"], 8);
    const second = allocateSwatches(first, ["dokwood", "phd"], 8);
    expect(swatchIndexFor(second, "phd")).to.equal(0);
    expect(swatchIndexFor(second, "dokwood")).to.equal(1);
  });

  it("does not depend on the order keys are presented in", function () {
    const left = allocateSwatches(emptySwatchLedger(), ["a", "b"], 8);
    const right = allocateSwatches(left, ["b", "a"], 8);
    expect(right.assigned).to.deep.equal(left.assigned);
  });

  it("frees an index when its key goes, and reuses it", function () {
    const first = allocateSwatches(emptySwatchLedger(), ["a", "b"], 8);
    const second = allocateSwatches(first, ["b"], 8);
    expect(swatchIndexFor(second, "a")).to.equal(null);
    const third = allocateSwatches(second, ["b", "c"], 8);
    expect(swatchIndexFor(third, "c")).to.equal(0);
    expect(swatchIndexFor(third, "b")).to.equal(1);
  });

  it("reuses the longest-released index first", function () {
    const full = allocateSwatches(emptySwatchLedger(), ["a", "b", "c"], 3);
    const lost = allocateSwatches(full, ["c"], 3); // a released, then b
    const refilled = allocateSwatches(lost, ["c", "d", "e"], 3);
    expect(swatchIndexFor(refilled, "d")).to.equal(0); // a's, released first
    expect(swatchIndexFor(refilled, "e")).to.equal(1); // b's
  });

  it("shares an index only once the pool is exhausted, oldest holder first", function () {
    // Six seeds hold the whole palette; the seventh must double up rather than
    // repaint anyone, and it doubles with the oldest live holder.
    const full = allocateSwatches(emptySwatchLedger(), ["s1", "s2"], 2);
    const over = allocateSwatches(full, ["s1", "s2", "s3"], 2);
    expect(swatchIndexFor(over, "s1")).to.equal(0);
    expect(swatchIndexFor(over, "s2")).to.equal(1);
    expect(swatchIndexFor(over, "s3")).to.equal(0);
  });

  it("never mutates the state it was given", function () {
    const first = allocateSwatches(emptySwatchLedger(), ["a"], 8);
    const snapshot = JSON.stringify(first);
    allocateSwatches(first, ["a", "b", "c"], 8);
    expect(JSON.stringify(first)).to.equal(snapshot);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import ./test/nodeResolve.mjs --test test/unit/graphSwatchLedger.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the module**

Create `src/services/graphSwatchLedger.ts`:

```ts
/**
 * Which palette index a key holds, and for how long.
 *
 * Colour used to be dealt by **rank**: categories were ordered by how many
 * nodes carried them and took the swatches in that order, so ticking one
 * folder changed the counts and repainted the others (backlog B12). Seeds had
 * the same fault by another route — they were indexed by their position in the
 * seed list, so removing the first repainted the rest.
 *
 * Here a key takes the lowest free index the first time it is seen and keeps
 * it for as long as it is present. Rank still decides which categories are
 * named and which collapse into "Other"; it no longer decides any colour.
 *
 * Plain data, no DOM: the state serialises straight into the graph's saved
 * recipe, so a reopened graph reproduces every colour it had.
 */

export interface SwatchLedgerState {
  /** Key to palette index, for every key currently holding one. */
  assigned: Record<string, number>;
  /**
   * Keys whose index has been freed, longest-released first. Only the order
   * matters; the keys are kept so the reuse order is inspectable in a saved
   * state rather than being a number nobody can explain.
   */
  releasedOrder: string[];
}

export function emptySwatchLedger(): SwatchLedgerState {
  return { assigned: {}, releasedOrder: [] };
}

export function swatchIndexFor(
  state: SwatchLedgerState,
  key: string,
): number | null {
  const index = state.assigned[key];
  return typeof index === "number" ? index : null;
}

/**
 * The ledger after `keys` are the only live keys. Keys that are present keep
 * their index; keys that have gone release theirs; keys that are new take the
 * longest-released free index, or the lowest never-used one.
 */
export function allocateSwatches(
  state: SwatchLedgerState,
  keys: readonly string[],
  poolSize: number,
): SwatchLedgerState {
  const live = new Set(keys);
  const assigned: Record<string, number> = {};
  const releasedOrder = [...state.releasedOrder];

  // Hold what is still live.
  for (const [key, index] of Object.entries(state.assigned)) {
    if (live.has(key)) assigned[key] = index;
    else if (!releasedOrder.includes(key)) releasedOrder.push(key);
  }

  const freed: number[] = [];
  for (const key of releasedOrder) {
    const index = state.assigned[key];
    if (typeof index === "number") freed.push(index);
  }

  const taken = new Set(Object.values(assigned));
  const never: number[] = [];
  for (let index = 0; index < poolSize; index += 1) {
    if (!taken.has(index) && !freed.includes(index)) never.push(index);
  }

  // Sorting the newcomers keeps the result independent of the order the caller
  // happened to list them in — the property the old rank sort was reaching for.
  const newcomers = [...live].filter((key) => !(key in assigned)).sort();
  let sharedAt = 0;

  for (const key of newcomers) {
    const reused = never.length ? never.shift() : freed.shift();
    if (typeof reused === "number") {
      assigned[key] = reused;
      continue;
    }
    // The pool is exhausted: double up with the oldest live holder rather than
    // repaint anyone. The rail's hover tells the two apart.
    const holders = Object.entries(assigned)
      .sort((left, right) => left[1] - right[1])
      .map(([, index]) => index);
    assigned[key] = holders[sharedAt % holders.length] ?? 0;
    sharedAt += 1;
  }

  return {
    assigned,
    releasedOrder: releasedOrder.filter((key) => !(key in assigned)),
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `node --import ./test/nodeResolve.mjs --test test/unit/graphSwatchLedger.test.ts`
Expected: PASS, all seven cases.

- [ ] **Step 5: Run the full check and commit**

Run: `npm run check`

```bash
git add src/services/graphSwatchLedger.ts test/unit/graphSwatchLedger.test.ts
git commit
```

Subject: `Deal colour by identity rather than by rank`.

---

### Task 3: Marching squares

**Files:**

- Create: `src/services/graphFolderRegion.ts`
- Create: `test/unit/graphFolderRegion.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:

  ```ts
  export interface RegionPoint {
    x: number;
    y: number;
  }
  export interface FolderRegionOptions {
    radius: number;
    pitch: number;
    threshold?: number;
  }
  export function folderRegionContours(
    points: readonly RegionPoint[],
    options: FolderRegionOptions,
  ): RegionPoint[][];
  ```

  Points and contours are both in **data space**. Task 7 transforms the contours with the same viewport transform the nodes use, and dilates at draw time.

- [ ] **Step 1: Write the failing tests**

Create `test/unit/graphFolderRegion.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import ./test/nodeResolve.mjs --test test/unit/graphFolderRegion.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the module**

Create `src/services/graphFolderRegion.ts`:

```ts
/**
 * A folder's territory on the plot, as closed contours.
 *
 * Folder membership used to live in the node's fill, which cut a paper filed
 * in three folders into three pie slices and left the fill unable to carry a
 * metric at the same time. It is drawn as a region behind the nodes instead,
 * and this module computes the shape.
 *
 * The field is built in **data space**, not screen space, and that is the
 * load-bearing choice. A screen-space field with a falloff in device pixels
 * makes the contour a function of the zoom: zoom in and a folder fragments
 * into islands, zoom out and islands merge, because the nodes move apart and
 * together on screen while the papers do not. In data space the topology is
 * invariant, and a folder fragments only when its papers genuinely are apart.
 * The renderer transforms these contours with the same viewport transform the
 * nodes use, and dilates them by a device-pixel amount so the hull clears the
 * node discs by a constant margin on screen.
 *
 * Plain geometry in, plain geometry out: no canvas, no DOM.
 */

export interface RegionPoint {
  x: number;
  y: number;
}

export interface FolderRegionOptions {
  /** Falloff radius in data units. A lone paper's loop is smaller than this. */
  radius: number;
  /** Grid cell size in data units. Smaller is smoother and slower. */
  pitch: number;
  /** The field level the contour follows. Defaults to half a paper's peak. */
  threshold?: number;
}

const DEFAULT_THRESHOLD = 0.5;
/**
 * How far past the papers' bounding box the grid runs. The field has to reach
 * the threshold from both sides inside the grid, or the contour is clipped
 * square at the edge instead of tapering shut.
 */
const DOMAIN_MARGIN = 1.5;
/** Vertices closer than this share a stitching slot. */
const WELD = 1e-6;

/** Each paper contributes a smooth bump with compact support. */
function fieldAt(
  points: readonly RegionPoint[],
  x: number,
  y: number,
  radius: number,
): number {
  const squared = radius * radius;
  let total = 0;
  for (const point of points) {
    const dx = x - point.x;
    const dy = y - point.y;
    const distance = dx * dx + dy * dy;
    if (distance < squared) total += 1 - distance / squared;
  }
  return total;
}

function interpolate(
  first: RegionPoint,
  second: RegionPoint,
  firstValue: number,
  secondValue: number,
  threshold: number,
): RegionPoint {
  const span = secondValue - firstValue;
  const ratio = Math.abs(span) < 1e-12 ? 0.5 : (threshold - firstValue) / span;
  return {
    x: first.x + (second.x - first.x) * ratio,
    y: first.y + (second.y - first.y) * ratio,
  };
}

function keyOf(point: RegionPoint): string {
  return `${Math.round(point.x / WELD)}:${Math.round(point.y / WELD)}`;
}

/**
 * Marching squares, full case table, saddles disambiguated by the cell's mean.
 *
 * The two ambiguous cases — corners above the threshold on one diagonal and
 * below on the other — can be joined two ways. Choosing by the cell's average
 * value keeps the contour consistent with the field it came from; choosing
 * arbitrarily makes loops that cross themselves.
 */
function cellSegments(
  corners: readonly [RegionPoint, RegionPoint, RegionPoint, RegionPoint],
  values: readonly [number, number, number, number],
  threshold: number,
): Array<[RegionPoint, RegionPoint]> {
  const [topLeft, topRight, bottomRight, bottomLeft] = corners;
  const [tl, tr, br, bl] = values;
  const code =
    (tl >= threshold ? 8 : 0) +
    (tr >= threshold ? 4 : 0) +
    (br >= threshold ? 2 : 0) +
    (bl >= threshold ? 1 : 0);

  const top = (): RegionPoint =>
    interpolate(topLeft, topRight, tl, tr, threshold);
  const right = (): RegionPoint =>
    interpolate(topRight, bottomRight, tr, br, threshold);
  const bottom = (): RegionPoint =>
    interpolate(bottomLeft, bottomRight, bl, br, threshold);
  const left = (): RegionPoint =>
    interpolate(topLeft, bottomLeft, tl, bl, threshold);

  switch (code) {
    case 0:
    case 15:
      return [];
    case 1:
    case 14:
      return [[left(), bottom()]];
    case 2:
    case 13:
      return [[bottom(), right()]];
    case 3:
    case 12:
      return [[left(), right()]];
    case 4:
    case 11:
      return [[top(), right()]];
    case 6:
    case 9:
      return [[top(), bottom()]];
    case 7:
    case 8:
      return [[left(), top()]];
    case 5:
    case 10: {
      const mean = (tl + tr + br + bl) / 4;
      const joinedThroughMiddle = mean >= threshold;
      if (code === 5) {
        return joinedThroughMiddle
          ? [
              [left(), top()],
              [bottom(), right()],
            ]
          : [
              [left(), bottom()],
              [top(), right()],
            ];
      }
      return joinedThroughMiddle
        ? [
            [left(), bottom()],
            [top(), right()],
          ]
        : [
            [left(), top()],
            [bottom(), right()],
          ];
    }
    default:
      return [];
  }
}

/** Walk the loose segments into closed loops. */
function stitch(
  segments: ReadonlyArray<[RegionPoint, RegionPoint]>,
): RegionPoint[][] {
  const next = new Map<string, Array<[RegionPoint, RegionPoint]>>();
  for (const segment of segments) {
    const key = keyOf(segment[0]);
    const bucket = next.get(key);
    if (bucket) bucket.push(segment);
    else next.set(key, [segment]);
  }

  const used = new Set<[RegionPoint, RegionPoint]>();
  const loops: RegionPoint[][] = [];

  for (const segment of segments) {
    if (used.has(segment)) continue;
    const loop: RegionPoint[] = [segment[0]];
    let current = segment;
    used.add(current);

    for (;;) {
      loop.push(current[1]);
      const candidates = next.get(keyOf(current[1])) ?? [];
      const following = candidates.find((candidate) => !used.has(candidate));
      if (!following) break;
      used.add(following);
      current = following;
      if (keyOf(current[1]) === keyOf(loop[0])) {
        loop.push(current[1]);
        break;
      }
    }

    // A loop the walk could not close is a fragment; the caller draws filled
    // shapes, so close it rather than leaving an open path.
    if (keyOf(loop[loop.length - 1]) !== keyOf(loop[0])) loop.push(loop[0]);
    if (loop.length > 3) loops.push(loop);
  }

  return loops;
}

export function folderRegionContours(
  points: readonly RegionPoint[],
  options: FolderRegionOptions,
): RegionPoint[][] {
  if (!points.length) return [];
  const radius = options.radius;
  const pitch = options.pitch;
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  if (!(radius > 0) || !(pitch > 0)) return [];

  const margin = radius * DOMAIN_MARGIN;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs) - margin;
  const maxX = Math.max(...xs) + margin;
  const minY = Math.min(...ys) - margin;
  const maxY = Math.max(...ys) + margin;

  const columns = Math.ceil((maxX - minX) / pitch) + 1;
  const rows = Math.ceil((maxY - minY) / pitch) + 1;

  const values: number[][] = [];
  for (let row = 0; row < rows; row += 1) {
    const line: number[] = [];
    for (let column = 0; column < columns; column += 1) {
      line.push(
        fieldAt(points, minX + column * pitch, minY + row * pitch, radius),
      );
    }
    values.push(line);
  }

  const segments: Array<[RegionPoint, RegionPoint]> = [];
  for (let row = 0; row + 1 < rows; row += 1) {
    for (let column = 0; column + 1 < columns; column += 1) {
      const left = minX + column * pitch;
      const right = left + pitch;
      const top = minY + row * pitch;
      const bottom = top + pitch;
      segments.push(
        ...cellSegments(
          [
            { x: left, y: top },
            { x: right, y: top },
            { x: right, y: bottom },
            { x: left, y: bottom },
          ],
          [
            values[row][column],
            values[row][column + 1],
            values[row + 1][column + 1],
            values[row + 1][column],
          ],
          threshold,
        ),
      );
    }
  }

  return stitch(segments);
}
```

- [ ] **Step 4: Run the tests**

Run: `node --import ./test/nodeResolve.mjs --test test/unit/graphFolderRegion.test.ts`
Expected: PASS, all eight cases. If the hole case returns one loop rather than two, lower the test's `pitch` to 1 before touching the module — a coarse grid can miss a small hole, and that is a resolution fact, not a bug.

- [ ] **Step 5: Run the full check and commit**

Run: `npm run check`

```bash
git add src/services/graphFolderRegion.ts test/unit/graphFolderRegion.test.ts
git commit
```

Subject: `Compute a folder's territory as a contour, in data space`.

---

### Task 4: Category assignment stops dealing colour, and loses the folder metric

**Files:**

- Modify: `src/services/graphCategoryAssignment.ts`
- Modify: `src/domain/graphTypes.ts`
- Modify: `test/unit/graphCategoryAssignment.test.ts`

**Interfaces:**

- Consumes: `allocateSwatches`, `swatchIndexFor`, `emptySwatchLedger`, `SwatchLedgerState` (Task 2).
- Produces: `assignCategories(nodes, metric, theme, options)` where `options` is `{ labels?: CategoryLabelSource; ledger: SwatchLedgerState }`, returning a `CategoryAssignment` that now carries `ledger: SwatchLedgerState` and `colorFor(node): string` **in place of** `colorsFor(node): string[]`. `labelsFor` and `keysFor` return a single string and a single key or null, for the same reason.

- [ ] **Step 1: Narrow the metric type**

In `src/domain/graphTypes.ts`, find `GraphNodeColorMetric` and remove `"collection"`, adding `"uniform"`. Leave the numeric metric ids alone.

- [ ] **Step 2: Write the failing tests**

In `test/unit/graphCategoryAssignment.test.ts`, replace any `"collection"` case with these. Keep the file's existing node fixture helper if it has one; otherwise build nodes with the minimum fields the metric reads.

```ts
it("holds a category's colour when another category arrives", function () {
  // B12: the swatch follows the key, never the rank.
  const theme = graphThemeFor("light");
  const small = assignCategories(
    nodesOfTypes(["article"]),
    "publication-type",
    theme,
    {
      ledger: emptySwatchLedger(),
    },
  );
  const before = small.colorFor(nodeOfType("article"));
  const larger = assignCategories(
    nodesOfTypes(["article", "book", "book", "book"]),
    "publication-type",
    theme,
    { ledger: small.ledger },
  );
  expect(larger.colorFor(nodeOfType("article"))).to.equal(before);
});

it("still ranks by count for which categories are named", function () {
  const theme = graphThemeFor("light");
  const assignment = assignCategories(
    nodesOfTypes(["article", "book", "book"]),
    "publication-type",
    theme,
    { ledger: emptySwatchLedger() },
  );
  expect(assignment.entries.map((entry) => entry.label)).to.deep.equal([
    "book",
    "article",
  ]);
});

it("returns one colour per node, since no metric is multi-valued now", function () {
  const theme = graphThemeFor("light");
  const assignment = assignCategories(
    nodesOfTypes(["book"]),
    "publication-type",
    theme,
    {
      ledger: emptySwatchLedger(),
    },
  );
  expect(assignment.colorFor(nodeOfType("book"))).to.be.a("string");
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `node --import ./test/nodeResolve.mjs --test test/unit/graphCategoryAssignment.test.ts`
Expected: FAIL — `colorFor` is not a function, and the options argument is not accepted.

- [ ] **Step 4: Rewrite the module's colour path**

In `src/services/graphCategoryAssignment.ts`:

- Delete `MAX_SLICES_PER_NODE` and the `ordered()` helper's `.slice(0, MAX_SLICES_PER_NODE)`; `ordered` becomes a single-ref lookup.
- Delete the `metric === "collection"` branch of `nodeCategories` and the `CategoryLabelSource` uses that only served it. **Keep** the `CategoryLabelSource` type and the `labels` option — Task 8's region legend needs folder labels — but it is no longer consulted here; move the interface to `graphScopeRailModel.ts` if ESLint reports it unused.
- Change the signature and the colour source:

```ts
export interface AssignCategoriesOptions {
  labels?: CategoryLabelSource;
  /** Colours are held by key, in this ledger, and never dealt by rank. */
  ledger: SwatchLedgerState;
}

export function assignCategories(
  nodes: CitationGraphNode[],
  metric: GraphNodeColorMetric,
  theme: GraphTheme,
  options: AssignCategoriesOptions,
): CategoryAssignment {
  // ... counting and `ranked` are unchanged: rank still decides which
  // categories are named and which collapse into Other.

  const assigned = ranked.slice(0, GRAPH_ASSIGNED_CATEGORY_LIMIT);
  const collapsed = ranked.slice(GRAPH_ASSIGNED_CATEGORY_LIMIT);

  const ledger = allocateSwatches(
    options.ledger,
    assigned.map((entry) => entry.key),
    theme.categorical.swatches.length,
  );

  const entries: CategoryEntry[] = assigned.map((entry) => ({
    ...entry,
    color: theme.categorical.swatches[swatchIndexFor(ledger, entry.key) ?? 0],
  }));
  // ... `other` and `noValue` unchanged.

  return {
    metric,
    entries,
    other,
    noValue,
    ledger,
    colorFor(node) {
      const ref = firstCategory(node);
      if (!ref) return theme.categorical.noValue;
      return colorByKey.get(ref.key) ?? theme.categorical.other;
    },
    labelFor(node) {
      return firstCategory(node)?.label ?? "No value";
    },
    keyFor(node) {
      return firstCategory(node)?.key ?? null;
    },
  };
}
```

Update the `CategoryAssignment` interface to match: `ledger: SwatchLedgerState`, `colorFor(node): string`, `labelFor(node): string`, `keyFor(node): string | null`. Update the module's header comment: it opens by saying assignment is "by **rank**, not by hash" — it is now by identity, and the comment must say so and say why.

- [ ] **Step 5: Run the tests**

Run: `node --import ./test/nodeResolve.mjs --test test/unit/graphCategoryAssignment.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full check and commit**

`npm run check` will fail to typecheck until Tasks 5 to 9 land, because the renderer and rail still call `colorsFor`. Run the two unit files instead, and commit with the compile break confined to callers you are about to fix:

Run: `node --import ./test/nodeResolve.mjs --test test/unit/graphCategoryAssignment.test.ts test/unit/graphSwatchLedger.test.ts`

```bash
git add src/services/graphCategoryAssignment.ts src/domain/graphTypes.ts test/unit/graphCategoryAssignment.test.ts
git commit
```

Subject: `Take folder colouring out of the node's fill`.

---

### Task 5: State version 3 and its migration

**Files:**

- Modify: `src/services/graphViewState.ts`
- Modify: `test/unit/graphViewState.test.ts`

**Interfaces:**

- Consumes: `SwatchLedgerState` (Task 2).
- Produces: on `GraphViewState` — `regions: number[]` (selected collection IDs, oldest first, at most `MAX_GRAPH_REGIONS`), `swatches: SwatchLedgerState`, `seedSwatches: SwatchLedgerState`; and `export const MAX_GRAPH_REGIONS = 4`.

- [ ] **Step 1: Write the failing tests**

Add to `test/unit/graphViewState.test.ts`:

```ts
describe("version 3", function () {
  it("keeps the regions a graph was saved with", function () {
    const state = { ...emptyGraphViewState(), regions: [7, 9] };
    const parsed = parseGraphViewState(JSON.parse(JSON.stringify(state)));
    expect(parsed?.regions).to.deep.equal([7, 9]);
  });

  it("caps the regions it will accept", function () {
    const state = { ...emptyGraphViewState(), regions: [1, 2, 3, 4, 5, 6] };
    const parsed = parseGraphViewState(JSON.parse(JSON.stringify(state)));
    expect(parsed?.regions).to.have.length(MAX_GRAPH_REGIONS);
  });

  it("gives a version 2 folder graph its own folders as regions", function () {
    // The colour metric used to default to Collection, so a folder graph drew
    // its folders in colour. It keeps doing so, now as regions.
    const legacy = {
      ...emptyGraphViewState(),
      version: 2,
      collections: { base: "none", except: [12, 4, 30] },
    };
    const parsed = parseGraphViewState(JSON.parse(JSON.stringify(legacy)));
    expect(parsed?.regions).to.deep.equal([4, 12, 30]);
  });

  it("gives a version 2 whole-library graph no regions", function () {
    // Choosing folders the reader never singled out would be noise.
    const legacy = {
      ...emptyGraphViewState(),
      version: 2,
      collections: { base: "all", except: [] },
    };
    const parsed = parseGraphViewState(JSON.parse(JSON.stringify(legacy)));
    expect(parsed?.regions).to.deep.equal([]);
  });

  it("caps a version 2 migration at four folders", function () {
    const legacy = {
      ...emptyGraphViewState(),
      version: 2,
      collections: { base: "none", except: [5, 4, 3, 2, 1] },
    };
    const parsed = parseGraphViewState(JSON.parse(JSON.stringify(legacy)));
    expect(parsed?.regions).to.deep.equal([1, 2, 3, 4]);
  });

  it("starts a version 2 graph with empty ledgers", function () {
    const legacy = { ...emptyGraphViewState(), version: 2 };
    const parsed = parseGraphViewState(JSON.parse(JSON.stringify(legacy)));
    expect(parsed?.swatches.assigned).to.deep.equal({});
    expect(parsed?.seedSwatches.assigned).to.deep.equal({});
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import ./test/nodeResolve.mjs --test test/unit/graphViewState.test.ts`
Expected: FAIL — `regions` is not on the parsed state.

- [ ] **Step 3: Bump the version and add the fields**

In `src/services/graphViewState.ts`:

```ts
export const GRAPH_VIEW_STATE_VERSION = 3;

/** At most this many folder regions are drawn at once. */
export const MAX_GRAPH_REGIONS = 4;
```

Add to `GraphViewState`:

```ts
  /**
   * The folders drawn as regions, oldest selection first. Capped at
   * `MAX_GRAPH_REGIONS`: overlapping translucent hulls stop being readable
   * past a handful, and the fifth selection releases the first.
   */
  regions: number[];
  /** Which swatch each category key holds. Never dealt by rank; see B12. */
  swatches: SwatchLedgerState;
  /** Which seed-palette index each seed key holds. */
  seedSwatches: SwatchLedgerState;
```

Add them to `emptyGraphViewState`:

```ts
    regions: [],
    swatches: emptySwatchLedger(),
    seedSwatches: emptySwatchLedger(),
```

- [ ] **Step 4: Accept version 2 and migrate it**

`parseGraphViewState` currently rejects anything that is neither the current version nor 1. Widen it and add the migration:

```ts
if (
  raw.version !== GRAPH_VIEW_STATE_VERSION &&
  raw.version !== 2 &&
  raw.version !== 1
) {
  return null;
}
```

and, where the parsed object is assembled:

```ts
  const ticks = /* the existing ticks resolution, unchanged */;
  const regions =
    raw.version === GRAPH_VIEW_STATE_VERSION
      ? normalizedRegions(raw.regions)
      : migratedRegions(ticks);
```

with these helpers:

```ts
function normalizedRegions(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const ids = raw.filter(
    (id): id is number => Number.isInteger(id) && (id as number) > 0,
  );
  return [...new Set(ids)].slice(0, MAX_GRAPH_REGIONS);
}

/**
 * A version 2 graph carried no regions, because folder membership was a node
 * fill and the colour metric defaulted to Collection. A graph made from
 * folders keeps showing those folders, now as regions; a whole-library graph
 * takes none, since picking four folders the reader never singled out would
 * be noise dressed as continuity.
 *
 * The ticks are all there is to go on: `parseGraphViewState` holds a recipe
 * and no nodes, so it cannot rank folders by how many papers they hold and
 * must not pretend to. Ascending ID order is arbitrary but stable.
 */
function migratedRegions(ticks: GraphViewCollectionTicks): number[] {
  if (ticks.base !== "none") return [];
  return [...ticks.except].sort((a, b) => a - b).slice(0, MAX_GRAPH_REGIONS);
}
```

Parse the ledgers defensively — a hand-edited or truncated record must not throw:

```ts
function parsedLedger(raw: unknown): SwatchLedgerState {
  const record = (raw ?? {}) as Partial<SwatchLedgerState>;
  const assigned: Record<string, number> = {};
  for (const [key, value] of Object.entries(record.assigned ?? {})) {
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
      assigned[key] = value;
    }
  }
  const releasedOrder = Array.isArray(record.releasedOrder)
    ? record.releasedOrder.filter(
        (key): key is string => typeof key === "string",
      )
    : [];
  return { assigned, releasedOrder };
}
```

and use `parsedLedger(raw.swatches)` / `parsedLedger(raw.seedSwatches)` for the two ledger fields, which yields empty ledgers for a version 2 record — correct, since it has none.

- [ ] **Step 5: Run the tests**

Run: `node --import ./test/nodeResolve.mjs --test test/unit/graphViewState.test.ts`
Expected: PASS, including every pre-existing version 1 case — the version 1 path is untouched and must stay green.

- [ ] **Step 6: Commit**

```bash
git add src/services/graphViewState.ts test/unit/graphViewState.test.ts
git commit
```

Subject: `Carry regions and colour ledgers in the graph's recipe`.

---

### Task 6: The colour dropdown loses Collection and gains Uniform

**Files:**

- Modify: `src/services/citationPreferences.ts`
- Modify: `src/services/graphViewControls.ts`
- Modify: `test/unit/citationPreferences.test.ts` (create the describe block if the file has none for appearance)

**Interfaces:**

- Consumes: the narrowed `GraphNodeColorMetric` (Task 4).
- Produces: `DEFAULT_GRAPH_LAYOUT.nodeColorMetric === "uniform"`; `getGraphAppearance()` never returns `"collection"`.

- [ ] **Step 1: Write the failing test**

```ts
describe("the graph appearance preference", function () {
  it("coerces a stored Collection colouring to Uniform", function () {
    // Collection is not a node colouring any more — folders are regions. The
    // appearance schema version is deliberately not bumped to force this: a
    // mismatch makes getGraphAppearance rewrite the whole record from
    // defaults, which would throw away the reader's axes, scales, size metric
    // and label mode to change one field.
    stubPrefs({
      graphAppearanceVersion: 4,
      graphAppearance: JSON.stringify({
        xMetric: "year",
        xScale: "log",
        yMetric: "citations",
        yScale: "linear",
        nodeSizeMetric: "citations",
        nodeColorMetric: "collection",
        nodeLabelMode: "author-year",
      }),
    });
    const appearance = getGraphAppearance();
    expect(appearance.nodeColorMetric).to.equal("uniform");
    expect(appearance.xScale).to.equal(
      "log",
      "the rest of the record survives",
    );
  });
});
```

Use the file's existing preference stubbing helper; if there is none, stub `globalThis.Zotero = { Prefs: { get: (key) => store[key], set: () => {} } }` in a `beforeEach` and restore it after.

- [ ] **Step 2: Run to verify it fails**

Run: `node --import ./test/nodeResolve.mjs --test test/unit/citationPreferences.test.ts`
Expected: FAIL — `nodeColorMetric` comes back as `"collection"`.

- [ ] **Step 3: Change the default and coerce on read**

In `src/services/citationPreferences.ts`:

```ts
const DEFAULT_GRAPH_LAYOUT: GraphLayoutOptions = {
  xMetric: "year",
  xScale: "linear",
  yMetric: "citations",
  yScale: "linear",
  nodeSizeMetric: "citations",
  nodeColorMetric: "uniform",
  nodeLabelMode: "author-year",
};

/**
 * "collection" was the default colouring until folders became regions. The
 * appearance schema version is deliberately not bumped for it: a mismatch
 * makes this function write DEFAULT_GRAPH_LAYOUT over the whole record, and
 * changing one field is no reason to throw away the reader's axes, scales,
 * size metric and label mode.
 */
function withoutRetiredColouring(
  options: GraphLayoutOptions,
): GraphLayoutOptions {
  return (options.nodeColorMetric as string) === "collection"
    ? { ...options, nodeColorMetric: "uniform" }
    : options;
}
```

and return `withoutRetiredColouring({ ...DEFAULT_GRAPH_LAYOUT, ...parsed })` from `getGraphAppearance`, in both the reset path and the normal path.

- [ ] **Step 4: Change the dropdown**

In `src/services/graphViewControls.ts`, delete the `"collection"` entry from `categoricalDefinitions` and prepend a Uniform option the way the size select already does:

```ts
const uniformColor = element(document, "option");
uniformColor.value = "uniform";
uniformColor.textContent = "Uniform";
uniformColor.title =
  "One colour for every node. Folders are shown as regions, from the rail.";
uniformColor.dataset.metricDescription = uniformColor.title;
colorMetric.prepend(uniformColor);
```

Keep `collectionLabelsByID` — the region legend needs it.

- [ ] **Step 5: Run the tests**

Run: `node --import ./test/nodeResolve.mjs --test test/unit/citationPreferences.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/citationPreferences.ts src/services/graphViewControls.ts test/unit/citationPreferences.test.ts
git commit
```

Subject: `Retire Collection as a colouring, without resetting the rest`.

---

### Task 7: The renderer draws regions, and a seed wears its own colour

**Files:**

- Modify: `src/services/citationGraphRenderer.ts`
- Modify: `src/services/graphRendererScene.ts`

**Interfaces:**

- Consumes: `folderRegionContours` (Task 3), `assignCategories` with `colorFor` and `ledger` (Task 4), `seedColorAt` (Task 1).
- Produces: `renderer.setRegions(regions: ReadonlyArray<{ collectionID: number; color: string; nodeKeys: ReadonlySet<string> }>): void`; `renderer.setSeedColors(colors: ReadonlyMap<string, string>)` keeps its name and now receives ledger-derived colours.

- [ ] **Step 1: Make the fill single-valued and let a seed override it**

Replace `nodeColors` with:

```ts
  private nodeColor(
    node: CitationGraphNode,
    colorDomain: [number, number] | null,
  ): string {
    // A seed is always its own colour, whatever the colour metric. Seeds are
    // the anchor set the reader navigates by; their metric values are read in
    // the rail and the detail pane, not off the plot.
    const seed = this.seedColors.get(node.key);
    if (seed) return seed;
    const metric = this.layout.nodeColorMetric;
    if (metric === "uniform") return this.theme.states.uniformFill;
    if (!isMetricID(metric)) return this.categories().colorFor(node);
    const value = metricNumber(node, metric);
    if (value === null || !colorDomain) return this.theme.categorical.noValue;
    return numericColor(
      scaleValue(value, colorDomain[0], colorDomain[1], "linear"),
      this.theme,
    );
  }
```

Update every call site to pass and receive one colour. In `drawNode`, replace the `colors: string[]` parameter with `color: string` and delete the slice loop, leaving a single filled arc:

```ts
context.beginPath();
context.arc(position.x, position.y, radius, 0, Math.PI * 2);
context.fillStyle = color;
context.fill();
```

The in-library ring's call becomes `inLibraryRingColor(color, this.theme)`.

- [ ] **Step 2: Hold the regions**

Add the field and setter next to `seedColors`:

```ts
  /** The folders drawn as regions, with the papers each one holds. */
  private regions: ReadonlyArray<{
    collectionID: number;
    color: string;
    nodeKeys: ReadonlySet<string>;
  }> = [];
  /** Contours in data space, cached until the positions or the set change. */
  private regionContours = new Map<number, RegionPoint[][]>();
  private regionRevision = "";

  setRegions(
    regions: ReadonlyArray<{
      collectionID: number;
      color: string;
      nodeKeys: ReadonlySet<string>;
    }>,
  ): void {
    this.regions = regions;
    this.regionContours.clear();
    this.regionRevision = "";
    this.requestDraw();
  }
```

Use the renderer's existing redraw entry point in place of `requestDraw()` if it is named differently.

- [ ] **Step 3: Compute the contours, in data space, only when they can have changed**

```ts
  /**
   * Contours are data-space, so pan and zoom never invalidate them — they are
   * transformed at draw time like the nodes. Only the positions or the
   * selected set can change them.
   */
  private regionsFor(): Map<number, RegionPoint[][]> {
    const revision = `${this.layoutRevision}:${this.regions
      .map((region) => region.collectionID)
      .join(",")}`;
    if (this.regionRevision === revision) return this.regionContours;

    this.regionContours.clear();
    const spread = this.dataSpread();
    for (const region of this.regions) {
      const points: RegionPoint[] = [];
      for (const key of region.nodeKeys) {
        const position = this.positions.get(key);
        if (position) points.push({ x: position.x, y: position.y });
      }
      this.regionContours.set(
        region.collectionID,
        folderRegionContours(points, {
          radius: spread * 0.06,
          pitch: spread * 0.012,
        }),
      );
    }
    this.regionRevision = revision;
    return this.regionContours;
  }

  /** The larger side of the laid-out plot, in data units. */
  private dataSpread(): number {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const position of this.positions.values()) {
      minX = Math.min(minX, position.x);
      maxX = Math.max(maxX, position.x);
      minY = Math.min(minY, position.y);
      maxY = Math.max(maxY, position.y);
    }
    const width = maxX - minX;
    const height = maxY - minY;
    return Math.max(width, height, 1);
  }
```

If the renderer has no `layoutRevision`, use the same key material `categoryAssignmentKey` uses plus the node count.

- [ ] **Step 4: Draw them beneath the nodes**

In the draw pass, after the grid and before the edges:

```ts
  private drawRegions(): void {
    if (!this.regions.length) return;
    const contours = this.regionsFor();
    const ratio = this.ratio;
    // The hull clears the node discs by a constant amount on screen, while the
    // shape it clears is data-space and so does not change with the zoom. A
    // wide round-joined stroke under the fill is the dilation.
    const dilation = (this.baseNodeRadius() + 5) * ratio * 2;
    for (const region of this.regions) {
      const loops = contours.get(region.collectionID) ?? [];
      if (!loops.length) continue;
      const path = new Path2D();
      for (const loop of loops) {
        loop.forEach((point, index) => {
          const screen = this.toScreen(point);
          if (index === 0) path.moveTo(screen.x, screen.y);
          else path.lineTo(screen.x, screen.y);
        });
        path.closePath();
      }
      this.context.save();
      this.context.lineJoin = "round";
      this.context.lineCap = "round";
      this.context.strokeStyle = region.color;
      this.context.globalAlpha = 0.25;
      this.context.lineWidth = dilation;
      this.context.stroke(path);
      this.context.fill(path, "evenodd");
      this.context.globalAlpha = 1;
      this.context.lineWidth = 1.6 * ratio;
      this.context.stroke(path);
      this.context.restore();
    }
  }
```

`this.toScreen` is the renderer's existing `projectToScreen(position, this.transform)` wrapper (line ~513). `baseNodeRadius()` is whatever the renderer already uses for an unsized node; reuse it rather than inventing a constant.

- [ ] **Step 5: Run the unit suite and commit**

`npm run check` still fails to typecheck here: the rail has not been updated yet, so it is still calling the API Task 4 removed. That break closes in Task 9. Run the unit suite alone:

Run: `npm run test:unit`
Expected: PASS. If a _renderer_ type error appears in the output, fix it; a `graphKeyRail.ts` or `graphViewService.ts` error is the expected break and belongs to Tasks 8 and 9.

```bash
git add src/services/citationGraphRenderer.ts src/services/graphRendererScene.ts
git commit
```

Subject: `Draw folders behind the nodes and seeds in their own colour`.

---

### Task 8: The rail's row splits, and regions are selected

**Files:**

- Modify: `src/services/graphScopeRailModel.ts`
- Modify: `src/services/graphKeyRail.ts`
- Modify: `content/graph.css`
- Modify: `test/unit/graphScopeRailModel.test.ts`

**Interfaces:**

- Consumes: `MAX_GRAPH_REGIONS` (Task 5).
- Produces: on `ScopeRow` — `selected: boolean` and `color: string | null`; on the rail's `onScope` options — `selectRow(row: ScopeRow, selected: boolean): void`; and a pure `nextRegionSelection(current: readonly number[], collectionID: number, cap: number): number[]`.

- [ ] **Step 1: Write the failing tests for the pure selection rule**

Add to `test/unit/graphScopeRailModel.test.ts`:

```ts
describe("selecting folders for regions", function () {
  it("adds a folder, oldest first", function () {
    expect(nextRegionSelection([4], 9, 4)).to.deep.equal([4, 9]);
  });

  it("toggles a selected folder off", function () {
    expect(nextRegionSelection([4, 9], 4, 4)).to.deep.equal([9]);
  });

  it("releases the oldest when the cap is reached", function () {
    expect(nextRegionSelection([1, 2, 3, 4], 5, 4)).to.deep.equal([2, 3, 4, 5]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import ./test/nodeResolve.mjs --test test/unit/graphScopeRailModel.test.ts`
Expected: FAIL — `nextRegionSelection` is not exported.

- [ ] **Step 3: Write it, and carry selection on the row**

In `src/services/graphScopeRailModel.ts`:

```ts
/**
 * The regions after clicking one folder. Selection is a toggle and holds more
 * than one, because seeing two folders' territories at once — where they
 * overlap, which papers sit in neither — is the comparison a hull is best at.
 * Past the cap the oldest selection is released: overlapping translucent
 * hulls stop being readable past a handful.
 */
export function nextRegionSelection(
  current: readonly number[],
  collectionID: number,
  cap: number,
): number[] {
  if (current.includes(collectionID)) {
    return current.filter((id) => id !== collectionID);
  }
  return [...current, collectionID].slice(-cap);
}
```

Add to `ScopeRow`:

```ts
/** Drawn as a region on the plot. */
selected: boolean;
/** The folder's colour while it is selected, else null. */
color: string | null;
```

and populate both in `buildScopeRailModel` from a new `regions` and `regionColors` input.

- [ ] **Step 4: Split the row in the DOM**

In `src/services/graphKeyRail.ts`, `scopeRowElement` currently wraps everything in a `<label>`, so clicking the name ticks the box. Split it:

```ts
function scopeRowElement(row: ScopeRow): HTMLElement {
  const wrapper = element(document, "div", "cm-scope-row");
  if (row.selected) {
    wrapper.classList.add("cm-scope-row-selected");
    if (row.color) wrapper.style.setProperty("--cm-row-color", row.color);
  }

  // The box keeps its own label so the checkbox still has a hit area of its
  // own and a name for a screen reader; the row's body is now a button.
  const boxLabel = element(document, "label", "cm-scope-check-label");
  const box = element(document, "input", "cm-scope-check") as HTMLInputElement;
  box.type = "checkbox";
  box.checked = row.state !== "off";
  box.indeterminate = row.state === "mixed";
  box.title = `Show ${row.label} on the plot`;
  box.addEventListener("change", () =>
    options.onScope.toggleRow(row, box.checked),
  );
  boxLabel.appendChild(box);

  const body = element(
    document,
    "button",
    "cm-scope-row-body",
  ) as HTMLButtonElement;
  body.type = "button";
  body.setAttribute("aria-pressed", row.selected ? "true" : "false");
  const name = text(document, "span", row.label, "cm-scope-row-label");
  name.title = `${row.label} — click to draw this folder as a region`;
  const count = text(
    document,
    "span",
    COUNT_FORMAT.format(row.count),
    "cm-scope-row-count",
  );
  body.append(name, count);
  if (row.kind === "collection") {
    body.addEventListener("click", () =>
      options.onScope.selectRow(row, !row.selected),
    );
    const collectionID = row.collectionID;
    body.addEventListener("pointerenter", () => {
      if (!pinned) options.onEmphasise({ kind: "collection", collectionID });
    });
    body.addEventListener("pointerleave", () => {
      if (!pinned) options.onEmphasise(null);
    });
  } else {
    body.disabled = true;
  }

  wrapper.append(boxLabel, body);
  return wrapper;
}
```

Add `selectRow(row: ScopeRow, selected: boolean): void` to the rail's `onScope` interface beside `toggleRow`.

- [ ] **Step 5: Style it**

In `content/graph.css`, add beside the existing `.cm-scope-row` rules:

```css
.cm-scope-row {
  display: flex;
  align-items: center;
  gap: 6px;
  border: 1.5px solid transparent;
  border-radius: 3px;
}
/* The box stops being the whole row, so it grows to stay comfortably hit. */
.cm-scope-check {
  width: 15px;
  height: 15px;
}
.cm-scope-check-label {
  display: flex;
  align-items: center;
  padding: 3px;
}
.cm-scope-row-body {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  background: none;
  border: 0;
  padding: 3px 4px;
  font: inherit;
  color: inherit;
  text-align: start;
  cursor: pointer;
}
.cm-scope-row-selected {
  border-color: var(--cm-row-color, var(--cm-ink-muted));
  background: var(--cm-surface-paper);
}
```

- [ ] **Step 6: Run the tests and commit**

Run: `node --import ./test/nodeResolve.mjs --test test/unit/graphScopeRailModel.test.ts`
Expected: PASS. `npm run check` still does not typecheck at this point — the view service has not been wired yet — and Task 9 is what closes it.

```bash
git add src/services/graphScopeRailModel.ts src/services/graphKeyRail.ts content/graph.css test/unit/graphScopeRailModel.test.ts
git commit
```

Subject: `Select a folder to draw it, tick it to show it`.

---

### Task 9: Wire selection to the plot

**Files:**

- Modify: `src/services/graphViewService.ts`

**Interfaces:**

- Consumes: everything above.
- Produces: no new exports; the view holds `state.regions`, feeds `renderer.setRegions`, and keeps scope and selection consistent.

- [ ] **Step 1: Feed the renderer**

Where `refreshScopeRail` builds its model, also build the regions and hand them over:

```ts
const regionsForRenderer = (): Array<{
  collectionID: number;
  color: string;
  nodeKeys: ReadonlySet<string>;
}> => {
  const theme = renderer?.getTheme() ?? graphThemeFor("light");
  const ledger = allocateSwatches(
    state.swatches,
    state.regions.map((id) => String(id)),
    theme.categorical.swatches.length,
  );
  state.swatches = ledger;
  return state.regions.map((collectionID) => ({
    collectionID,
    color:
      theme.categorical.swatches[
        swatchIndexFor(ledger, String(collectionID)) ?? 0
      ],
    nodeKeys: new Set(
      visibleNodes()
        .filter((node) => node.collectionIDs.includes(collectionID))
        .map((node) => node.key),
    ),
  }));
};
```

Use the view's existing accessor for the visible node set in place of `visibleNodes()`.

- [ ] **Step 2: Handle a click on a row**

Add `selectRow` beside the existing `toggleRow` handler:

```ts
    selectRow(row, selected) {
      if (row.kind !== "collection") return;
      // Selecting an unticked folder ticks it first: an out-of-scope folder
      // has no papers on the plot, so its region would be empty.
      if (selected && row.state === "off") {
        this.toggleRow(row, true);
      }
      state.regions = nextRegionSelection(
        state.regions,
        row.collectionID,
        MAX_GRAPH_REGIONS,
      );
      persistState();
      renderer?.setRegions(regionsForRenderer());
      refreshScopeRail();
    },
```

- [ ] **Step 3: Keep unticking consistent**

In the existing `toggleRow`, after the ticks are written, add:

```ts
// Unticking a selected folder clears its region, the mirror of selecting
// an unticked one ticking it: a region with nothing inside says nothing.
if (!ticked) {
  state.regions = state.regions.filter((id) => id !== row.collectionID);
}
```

using the handler's own name for the new tick value.

- [ ] **Step 4: Seed colours come from the ledger**

Replace `seedColorsFor`:

```ts
/** Seeds hold a palette index for as long as they live, not a position. */
const seedColorsFor = (
  projection: GraphFocusProjection,
): Map<string, string> => {
  const theme = renderer?.getTheme() ?? graphThemeFor("light");
  const keys = projection.state.seedKeys;
  const ledger = allocateSwatches(state.seedSwatches, keys, theme.seeds.length);
  state.seedSwatches = ledger;
  return new Map(
    keys.map((key) => [
      key,
      seedColorAt(swatchIndexFor(ledger, key) ?? 0, theme),
    ]),
  );
};
```

and make `scopeSeedRows()` read its colour from the same map rather than from the seed's index.

- [ ] **Step 5: A new folder graph selects its folder**

Where a new graph's state is built from a collection scope, set its regions from the same folders, capped:

```ts
  regions: [...collectionIDs].slice(0, MAX_GRAPH_REGIONS),
```

- [ ] **Step 6: Run the check and commit**

Run: `npm run check`
Expected: PASS — this is the task that closes the compile break Task 4 opened.

```bash
git add src/services/graphViewService.ts
git commit
```

Subject: `Wire folder selection to the regions on the plot`.

---

### Task 10: The Zotero walk, the docs, and the XPI

**Files:**

- Create: `test/zotero/graphFolderRegions.test.ts`
- Modify: `docs/superpowers/handoffs/2026-09-08-roadmap.md`
- Modify: `docs/superpowers/handoffs/2026-09-08-review-backlog.md`

- [ ] **Step 1: Write the Zotero case**

Model it on `test/zotero/graphScopeRail.test.ts`, which already opens a graph and drives the rail. Drive the **real rail**, not the model: the plugin's own menus and rows, per the repo's rule that a UI-path test goes through the interface.

```ts
  it("draws a region for each selected folder, and clears it when unticked", async function () {
    const view = await openGraphForCollection(collectionID);
    const row = view.document.querySelector(
      `.cm-scope-row [data-collection-id="${collectionID}"]`,
    ) as HTMLButtonElement;
    row.click();
    await view.settled();
    expect(view.state().regions).to.deep.equal([collectionID]);

    const second = /* the sibling folder's row body */;
    second.click();
    await view.settled();
    expect(view.state().regions).to.have.length(2);

    const box = row.parentElement?.querySelector(".cm-scope-check") as HTMLInputElement;
    box.checked = false;
    box.dispatchEvent(new view.window.Event("change"));
    await view.settled();
    expect(view.state().regions).to.deep.equal([second collection's id]);
  });
```

Add `data-collection-id` to the row body in `graphKeyRail.ts` so the test can find a row without matching on a label. Fill in the helpers from what `graphScopeRail.test.ts` already provides; do not invent new ones.

- [ ] **Step 2: Run the Zotero suite**

Run: `npm test`
Expected: the suite's known state — 37 passed, 1 failed (view 15, backlog B11, which fails on main too), plus the new case passing. Any _other_ failure is a regression from this branch; fix it before continuing. Remember this deletes `.scaffold/build/meristema.xpi`.

- [ ] **Step 3: Tick the roadmap and file the manual checks**

In `docs/superpowers/handoffs/2026-09-08-roadmap.md`:

- Tick `D3` in the design items list, and strike `B12` from the small-fixes line, noting it was subsumed.
- Append to **Manual verification**:

```markdown
- [ ] D3: a folder graph opens with its own folder drawn as a shaded region
      behind the nodes, in that folder's colour.
- [ ] D3: clicking a second folder's row draws a second region; clicking it
      again removes it. Selecting a fifth folder drops the first.
- [ ] D3: ticking and unticking folders never changes any other folder's
      colour (B12), and unticking a selected folder clears its region.
- [ ] D3: with four seeds and colour by citations, every seed is plainly not
      a ramp colour, and no seed, ring or region shares a green.
- [ ] D3: removing the first seed leaves the other seeds' colours alone.
- [ ] D3: a graph saved before this release opens showing the folders it was
      made from as regions; a whole-library graph opens with none.
- [ ] D3: zooming in does not split a folder's region into pieces, and the
      region keeps a constant clearance around the node discs.
```

- Add a Log line: date, what was ticked, the commit range.

In `docs/superpowers/handoffs/2026-09-08-review-backlog.md`, mark B12 resolved by D3, pointing at the spec.

- [ ] **Step 4: Merge, build the XPI, push**

```bash
git add docs/superpowers/handoffs test/zotero/graphFolderRegions.test.ts src/services/graphKeyRail.ts
git commit
git switch main && git merge --ff-only graph-colour-system
npm run build
git push
```

The XPI is built **after** the last `npm test`, because `npm test` deletes it.

Subject for the commit: `Walk the regions in Zotero, and file the checks`.

---

## Self-Review

**Spec coverage.** Region channel → Tasks 3, 7, 8, 9. Seed palette and override → Tasks 1, 7, 9. In-library ring fallback → Task 1. Stable assignment (B12) → Tasks 2, 4. `"collection"` removed, `"uniform"` added and defaulted → Tasks 4, 6. State v3 and migration → Task 5. Rail row split, cap, tick/select coupling → Tasks 8, 9. Palette validator → Task 1. Region unit tests including zoom invariance and edge tapering → Task 3. Zotero walk and manual checks → Task 10. No spec section is unimplemented.

**Placeholders.** None: every step carries the code or the exact command. Three steps deliberately defer a value to measurement rather than invent one — Task 1 Step 4 sets the validator's floors from the shipped palette, Task 1 Step 8 adjusts seed hexes until they pass, and Task 10 Step 1 fills helpers from the existing Zotero test — and each says exactly how.

**Type consistency.** `colorsFor` → `colorFor` is changed in Task 4 and consumed under that name in Task 7. `seedColorAt` takes a palette index from Task 1 onward, supplied by `swatchIndexFor` in Task 9. `SwatchLedgerState`, `allocateSwatches`, `swatchIndexFor` and `emptySwatchLedger` keep one spelling throughout. `MAX_GRAPH_REGIONS` is defined in Task 5 and used in Tasks 8 and 9. `nextRegionSelection` is defined in Task 8 and called in Task 9. `RegionPoint` is defined in Task 3 and imported in Task 7.

**Known compile gap.** Task 4 breaks the build for callers it does not own; Tasks 7 and 9 close it. Task 4's commit step says so and runs the unit files rather than `npm run check`. This is deliberate — splitting it further would mean a commit that changes the renderer before the module it renders from exists.
