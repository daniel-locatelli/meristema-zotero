import type { GraphColorScheme } from "../domain/graphTypes";

/**
 * The graph's entire colour vocabulary. Every colour the canvas or `graph.css`
 * draws comes from here; nothing else in `src/services` may hold a colour
 * literal, and an ESLint rule enforces that.
 *
 * The categorical swatches and the sequential ramp were validated rather than
 * chosen: the swatches clear the lightness band, the chroma floor, and both the
 * simulated-CVD and normal-vision separation floors in each mode, and the ramp
 * is monotone in lightness so it reads as an ordering and survives greyscale.
 * Changing a value here means re-running that validation
 * (`test/unit/graphPalette.test.ts`).
 *
 * The categorical list is twelve long since 2026-09-11 (F14, when the
 * four-folder region cap went): the first eight are D3's, the last four —
 * lime, sky, coral (maroon on the light paper) and plum — were searched for
 * against the same floors plus a paper-lightness clearance, with light and
 * dark keeping the same families in the same order. A thirteenth folder
 * takes the Other tone (`categoricalSwatchAt`).
 */

export interface GraphSurfaceTokens {
  /** The panel the plot sits on — matches the surrounding chrome. */
  panel: string;
  /** The plot itself, one step off the panel: the scientific-figure inset. */
  paper: string;
  /** Frames and separators. */
  hairline: string;
  /** Gridlines at every axis tick, beneath the nodes. */
  grid: string;
}

export interface GraphInkTokens {
  primary: string;
  muted: string;
  emphasis: string;
}

export interface GraphEdgeTokens {
  /** Every edge when nothing is selected. */
  base: string;
  /** References out of the selection. */
  outgoing: string;
  /** Citations into the selection. */
  incoming: string;
  /** Everything else while a selection is lit. */
  dimmed: string;
}

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

export interface GraphCategoricalTokens {
  /**
   * Eight validated swatches in a fixed order. The order is the separation
   * mechanism, not a preference — never re-order without re-validating.
   */
  swatches: readonly string[];
  /** Everything past the assigned categories. */
  other: string;
  /** A node whose value for the metric is missing. Never a real category. */
  noValue: string;
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
   * `test/unit/graphPalette.test.ts` against the ramp, against the
   * categorical swatches — a seed disc and a category disc can sit side by
   * side on the same plot — and against each other.
   */
  seeds: readonly string[];
  edges: GraphEdgeTokens;
  states: GraphStateTokens;
}

/**
 * Colour alone cannot separate more than five node fills on a plot where any two
 * nodes can touch. Assignment gives the five largest categories a swatch and
 * collapses the rest into `other`; the Key rail and the node labels carry the
 * identity past that.
 */
export const GRAPH_ASSIGNED_CATEGORY_LIMIT = 5;

const LIGHT_THEME: GraphTheme = {
  scheme: "light",
  surfaces: {
    panel: "#f7f7f5",
    paper: "#fdfdfc",
    hairline: "#d9dad4",
    grid: "#ecece6",
  },
  inks: {
    primary: "#1b1d19",
    muted: "#63665d",
    emphasis: "#0f110d",
  },
  ramp: ["#0f3b33", "#1e6b52", "#4f9a5e", "#96bf54", "#e0c64a"],
  categorical: {
    swatches: [
      "#fe6d8a",
      "#ab8efe",
      "#039f6c",
      "#0066af",
      "#ae8f06",
      "#a302a0",
      "#a44c00",
      "#07bcbd",
      "#66c636",
      "#36baf6",
      "#8a423c",
      "#8a5490",
    ],
    other: "#7e8a84",
    noValue: "#9aa5a0",
  },
  seeds: ["#f20032", "#f2a87d", "#7a1fd6", "#08258a", "#b0006e", "#c7b2e4"],
  edges: {
    base: "rgba(99, 102, 93, .32)",
    outgoing: "#0066af",
    incoming: "#a44c00",
    dimmed: "rgba(99, 102, 93, .07)",
  },
  states: {
    selected: "#1b1d19",
    seed: "#63665d",
    searchMatch: "#0f110d",
    retracted: "#a33a3a",
    inLibraryRing: "#6f736a",
    uniformFill: "#8d928a",
  },
};

const DARK_THEME: GraphTheme = {
  scheme: "dark",
  surfaces: {
    panel: "#1c1c1a",
    paper: "#232320",
    hairline: "#35352f",
    grid: "#2b2b27",
  },
  inks: {
    primary: "#e8e9e3",
    muted: "#9a9c93",
    emphasis: "#ffffff",
  },
  ramp: ["#1a4c42", "#1e6b52", "#4f9a5e", "#96bf54", "#e0c64a"],
  categorical: {
    swatches: [
      "#c2004c",
      "#9c72fe",
      "#039f6c",
      "#006bb8",
      "#ae8f06",
      "#ac00a9",
      "#a44c00",
      "#04a7a8",
      "#66c636",
      "#1eaee4",
      "#fc4e42",
      "#a82a78",
    ],
    other: "#7e8a84",
    noValue: "#9aa5a0",
  },
  seeds: ["#ff0c9e", "#ffb582", "#8d23ee", "#6c448c", "#e089c2", "#abb4fe"],
  edges: {
    base: "rgba(154, 156, 147, .28)",
    outgoing: "#006bb8",
    incoming: "#a44c00",
    dimmed: "rgba(154, 156, 147, .07)",
  },
  states: {
    selected: "#e8e9e3",
    seed: "#9a9c93",
    searchMatch: "#ffffff",
    retracted: "#d98b8b",
    inLibraryRing: "#a8ada2",
    uniformFill: "#787d75",
  },
};

export function graphThemeFor(scheme: GraphColorScheme): GraphTheme {
  return scheme === "dark" ? DARK_THEME : LIGHT_THEME;
}

/**
 * The custom properties `graph.css` reads, so the chrome and the canvas can
 * never disagree about a colour. Only the panel surface today: the canvas
 * takes every other colour from the theme object, so nothing else is
 * published (B39, B40). Add a token here the day a stylesheet rule reads it.
 */
export function graphThemeCustomProperties(
  theme: GraphTheme,
): ReadonlyArray<readonly [string, string]> {
  return [["--cm-surface-panel", theme.surfaces.panel]];
}

export function applyGraphThemeToDocument(
  root: HTMLElement,
  theme: GraphTheme,
): void {
  for (const [property, value] of graphThemeCustomProperties(theme)) {
    root.style.setProperty(property, value);
  }
  root.dataset.cmScheme = theme.scheme;
}

/**
 * Zotero's General → Appearance control is bound to this Firefox pref:
 * 0 dark, 1 light, 2 follow the OS.
 */
export const GRAPH_APPEARANCE_PREF = "browser.theme.toolbar-theme";

/**
 * Gecko's chrome-only media feature for the OS's own dark setting, read
 * straight from the widget layer. Unlike `prefers-color-scheme` it does not
 * pass through the appearance override, so it neither lags the pref nor
 * needs a restyle to be right.
 */
const SYSTEM_DARK_QUERY = "(-moz-system-dark-theme)";

/**
 * Resolve the scheme from scratch, every time.
 *
 * Setting the appearance pref triggers no restyle of an open chrome document,
 * so a `MediaQueryList` held across the change keeps its stale `matches` and
 * never fires `change` — see `test/zotero/colorScheme.test.ts`. Only a query
 * created after the change reports the truth, so this never caches one, and
 * callers re-run it rather than listening on a stored query.
 *
 * Under Automatic (pref 2) even a fresh `prefers-color-scheme` query is not
 * enough: the pref observer runs synchronously at the write, and the chrome's
 * answer catches up with the OS only some time later, with nothing firing
 * when it does (B29, reproduced in `test/zotero/graphThemeFlip.test.ts`: at
 * the write the chrome still said light, 1.5 s later it said dark). So
 * Automatic asks the OS directly through `-moz-system-dark-theme`, which is
 * already right at the write, and falls back to the chrome query only where
 * Gecko does not know the feature.
 */
export function resolveGraphScheme(view: Window | null): GraphColorScheme {
  const override = appearanceOverride();
  if (override) return override;
  const system = view?.matchMedia?.(SYSTEM_DARK_QUERY);
  if (system && system.media !== "not all") {
    return system.matches ? "dark" : "light";
  }
  return view?.matchMedia?.("(prefers-color-scheme: dark)")?.matches
    ? "dark"
    : "light";
}

function appearanceOverride(): GraphColorScheme | null {
  const services = (globalThis as any).Services;
  const value = services?.prefs?.getIntPref?.(GRAPH_APPEARANCE_PREF, 2);
  if (value === 0) return "dark";
  if (value === 1) return "light";
  return null;
}

/**
 * Call `onChange` whenever the resolved scheme could have changed: the
 * appearance pref moving, or — while the pref follows the OS — the OS scheme
 * moving under it. Returns a disposer.
 */
export function observeGraphScheme(
  view: Window | null,
  onChange: () => void,
): () => void {
  const services = (globalThis as any).Services;
  const observer = { observe: () => onChange() };
  services?.prefs?.addObserver?.(GRAPH_APPEARANCE_PREF, observer);

  // Both queries: the OS one is what `resolveGraphScheme` reads under
  // Automatic, the chrome one is the fallback where Gecko lacks the feature.
  const queries = [SYSTEM_DARK_QUERY, "(prefers-color-scheme: dark)"]
    .map((query) => view?.matchMedia?.(query) ?? null)
    .filter((query) => query !== null);
  const onMediaChange = (): void => onChange();
  for (const query of queries) {
    query.addEventListener?.("change", onMediaChange);
  }

  return () => {
    services?.prefs?.removeObserver?.(GRAPH_APPEARANCE_PREF, observer);
    for (const query of queries) {
      query.removeEventListener?.("change", onMediaChange);
    }
  };
}

/**
 * A seed's colour by **palette index**, not by its position among the seeds.
 * The index is allocated once by `graphSwatchLedger` and held for as long as
 * the seed lives, so removing one seed never repaints the others — which is
 * what indexing by position did.
 */
/**
 * The categorical swatch an index names, or the Other tone when it names
 * none. A ledger index is only ever checked against the pool at the moment a
 * colour is read (see `SwatchLedgerState.assigned`): a hand-edited saved
 * state can hold `99`, and a shrunk palette can strand a live key past its
 * end. `strokeStyle = undefined` is not a canvas error — the context keeps
 * whatever the previous draw set — so an unchecked index paints one region
 * or disc in another's colour with nothing in the console to say so (B27).
 */
export function categoricalSwatchAt(
  paletteIndex: number | null,
  theme: GraphTheme,
): string {
  const swatches = theme.categorical.swatches;
  if (
    paletteIndex === null ||
    !Number.isInteger(paletteIndex) ||
    paletteIndex < 0 ||
    paletteIndex >= swatches.length
  ) {
    return theme.categorical.other;
  }
  return swatches[paletteIndex];
}

export function seedColorAt(paletteIndex: number, theme: GraphTheme): string {
  const seeds = theme.seeds;
  const position =
    Number.isInteger(paletteIndex) && paletteIndex > 0 ? paletteIndex : 0;
  return seeds[position % seeds.length];
}

function hexChannel(value: string, start: number): number | null {
  const parsed = Number.parseInt(value.slice(start, start + 2), 16);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * A brighter tint of a node's own fill: a hop result already in the library
 * wears a thin ring, so a paper you own is told from one you do not at a
 * glance while still reading as the same category. Only `#rrggbb` fills can be
 * brightened; anything else takes the theme's token.
 */
export function inLibraryRingColor(fill: string, theme: GraphTheme): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(fill)) return theme.states.inLibraryRing;
  const channels = [1, 3, 5].map((start) => hexChannel(fill, start));
  if (channels.some((channel) => channel === null)) {
    return theme.states.inLibraryRing;
  }
  const brightened = (channels as number[]).map((channel) =>
    Math.min(255, Math.round(channel + (255 - channel) * 0.45)),
  );
  return `#${brightened.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}
