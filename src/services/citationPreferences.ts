import { config } from "../../package.json";
import {
  CITATION_PROVIDER_IDS,
  type CitationProviderID,
  type CitationProviderPreference,
} from "../domain/citationTypes";
import type { GraphLayoutOptions } from "../domain/graphTypes";
import { citationDataSourceLabel } from "./providerPresentation";

const key = (name: string): string => `${config.prefsPrefix}.${name}`;
const PROVIDER_LABELS: Pick<
  Record<CitationProviderPreference, string>,
  "auto"
> = {
  auto: "Automatic — combine selected providers",
};
const PROVIDER_PREF_NAMES: Record<CitationProviderID, string> = {
  crossref: "providerCrossrefEnabled",
  "semantic-scholar": "providerSemanticScholarEnabled",
  opencitations: "providerOpenCitationsEnabled",
  inspire: "providerInspireEnabled",
  openalex: "providerOpenAlexEnabled",
};

function boolPref(name: string, fallback: boolean): boolean {
  const value = Zotero.Prefs.get(key(name), true);
  return value === undefined || value === null ? fallback : Boolean(value);
}

function setBoolPref(name: string, value: boolean): void {
  Zotero.Prefs.set(key(name), value, true);
}

export function getProviderAutomaticEnabled(): boolean {
  return boolPref("providerAutomatic", true);
}

export function getProviderLabel(provider: CitationProviderPreference): string {
  if (provider !== "auto") return citationDataSourceLabel(provider);
  const selected = getEnabledProviders();
  if (selected.length === 1) return citationDataSourceLabel(selected[0]);
  return selected.length === CITATION_PROVIDER_IDS.length
    ? PROVIDER_LABELS.auto
    : `${selected.length} selected providers`;
}

export function getEnabledProviders(): CitationProviderID[] {
  if (getProviderAutomaticEnabled()) {
    return [...CITATION_PROVIDER_IDS];
  }

  const selected = CITATION_PROVIDER_IDS.filter((provider) =>
    boolPref(PROVIDER_PREF_NAMES[provider], true),
  );
  if (selected.length) return selected;

  // Older or externally edited preferences can leave custom mode with no
  // provider selected. Recover to the documented safe default instead of
  // aborting startup before the preference pane can be opened.
  setBoolPref("providerAutomatic", true);
  for (const name of Object.values(PROVIDER_PREF_NAMES))
    setBoolPref(name, true);
  Zotero.debug(
    "Meristema: repaired an invalid empty provider selection by enabling automatic mode.",
  );
  return [...CITATION_PROVIDER_IDS];
}

export function normalizeCitationPreferences(): void {
  getEnabledProviders();
}

export function isProviderEnabled(provider: CitationProviderID): boolean {
  return getEnabledProviders().includes(provider);
}

export function getOpenAlexAPIKey(): string {
  return String(Zotero.Prefs.get(key("openAlexAPIKey"), true) ?? "").trim();
}

export function getSemanticScholarAPIKey(): string {
  return String(
    Zotero.Prefs.get(key("semanticScholarAPIKey"), true) ?? "",
  ).trim();
}

export function getShowMetricTooltipsEnabled(): boolean {
  return boolPref("showMetricTooltips", true);
}

function getAutomaticUpdateModeEnabled(): boolean {
  return boolPref("automaticUpdates", true);
}

export function getAutomaticUpdatesEnabled(): boolean {
  return (
    getAutomaticUpdateModeEnabled() ||
    boolPref("updateNewItems", true) ||
    boolPref("updateModifiedItems", true) ||
    boolPref("checkStaleOnStartup", true)
  );
}

export function getUpdateNewItemsEnabled(): boolean {
  return getAutomaticUpdateModeEnabled() || boolPref("updateNewItems", true);
}

export function getUpdateModifiedItemsEnabled(): boolean {
  return (
    getAutomaticUpdateModeEnabled() || boolPref("updateModifiedItems", true)
  );
}

export function getCheckStaleOnStartupEnabled(): boolean {
  return (
    getAutomaticUpdateModeEnabled() || boolPref("checkStaleOnStartup", true)
  );
}

export function getCacheDays(): number {
  const value = Number(Zotero.Prefs.get(key("cacheDays"), true));
  return Number.isFinite(value) && value >= 1
    ? Math.min(3650, Math.floor(value))
    : 30;
}

export function getExactTitleFallbackEnabled(): boolean {
  return boolPref("exactTitleFallback", true);
}

export function getDebugLoggingEnabled(): boolean {
  return boolPref("debugLogging", false);
}

/*
 * D17: a new graph opens on a fixed default. The gear's edits stay with the
 * graph they were made on (a saved graph carries its own appearance), and
 * the stored records below change only when the reader presses "Make this
 * the default" or resets it. A library graph and a seeded one keep separate
 * defaults, as the gear has since B41.
 *
 * Every open before D17 wrote the built-in default whether or not the
 * reader chose anything, so a record of an older version that only repeats
 * that default is read as no default at all; any other older record is the
 * reader's own and is honoured. The make-default button writes the current
 * versions, which are honoured whatever they hold.
 */
const GRAPH_APPEARANCE_SCHEMA_VERSION = 5;
const FOCUS_GRAPH_APPEARANCE_SCHEMA_VERSION = 2;
/** The versions written before D17, read with the check above. */
const LEGACY_GRAPH_APPEARANCE_SCHEMA_VERSION = 4;
const LEGACY_FOCUS_GRAPH_APPEARANCE_SCHEMA_VERSION = 1;

/** Overview's appearance (D22): a new graph opens the way that view does. */
const DEFAULT_GRAPH_LAYOUT: GraphLayoutOptions = {
  xMetric: "year",
  xScale: "linear",
  yMetric: "citations",
  yScale: "linear",
  nodeSizeMetric: "citations",
  nodeColorMetric: "publication-type",
  nodeLabelMode: "author-year",
};

/** The built-in default before D22, which every open used to store. */
const LEGACY_DEFAULT_GRAPH_LAYOUT: GraphLayoutOptions = {
  ...DEFAULT_GRAPH_LAYOUT,
  nodeColorMetric: "uniform",
};

/**
 * "collection" was the default colouring until folders became regions. The
 * appearance schema version is deliberately not bumped for it: changing one
 * field is no reason to throw away the reader's axes, scales, size metric
 * and label mode.
 */
function withoutRetiredColouring(
  options: GraphLayoutOptions,
): GraphLayoutOptions {
  return (options.nodeColorMetric as string) === "collection"
    ? { ...options, nodeColorMetric: "uniform" }
    : options;
}

function sameLayout(a: GraphLayoutOptions, b: GraphLayoutOptions): boolean {
  return (Object.keys(b) as Array<keyof GraphLayoutOptions>).every(
    (field) => a[field] === b[field],
  );
}

/**
 * The stored record behind one of the two defaults, parsed, or null when
 * there is none the reader chose: absent, unreadable, of an unknown version,
 * or an older record that only repeats the old built-in default.
 */
function storedRecord(
  name: string,
  version: number,
  legacyVersion: number,
  legacyDefault: GraphLayoutOptions,
): Partial<GraphLayoutOptions> | null {
  const storedVersion = Number(Zotero.Prefs.get(key(`${name}Version`), true));
  if (storedVersion !== version && storedVersion !== legacyVersion) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(Zotero.Prefs.get(key(name), true) ?? ""));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Partial<GraphLayoutOptions>;
  if (
    storedVersion === legacyVersion &&
    sameLayout(
      withoutRetiredColouring({ ...legacyDefault, ...record }),
      legacyDefault,
    )
  ) {
    return null;
  }
  return record;
}

function storedGraphAppearance(): Partial<GraphLayoutOptions> | null {
  return storedRecord(
    "graphAppearance",
    GRAPH_APPEARANCE_SCHEMA_VERSION,
    LEGACY_GRAPH_APPEARANCE_SCHEMA_VERSION,
    LEGACY_DEFAULT_GRAPH_LAYOUT,
  );
}

function storedFocusGraphAppearance(): Partial<GraphLayoutOptions> | null {
  return storedRecord(
    "focusGraphAppearance",
    FOCUS_GRAPH_APPEARANCE_SCHEMA_VERSION,
    LEGACY_FOCUS_GRAPH_APPEARANCE_SCHEMA_VERSION,
    defaultFocusGraphAppearance(LEGACY_DEFAULT_GRAPH_LAYOUT),
  );
}

/** The library graph's default: the reader's, else the built-in one. */
export function getGraphAppearance(): GraphLayoutOptions {
  return withoutRetiredColouring({
    ...DEFAULT_GRAPH_LAYOUT,
    ...storedGraphAppearance(),
  });
}

/** Whether the reader made a library graph's appearance the default. */
export function hasStoredGraphAppearance(): boolean {
  return storedGraphAppearance() !== null;
}

export function setGraphAppearance(options: GraphLayoutOptions): void {
  Zotero.Prefs.set(key("graphAppearance"), JSON.stringify(options), true);
  Zotero.Prefs.set(
    key("graphAppearanceVersion"),
    GRAPH_APPEARANCE_SCHEMA_VERSION,
    true,
  );
}

/** Forgets the library graph's made default and answers the built-in one. */
export function resetGraphAppearance(): GraphLayoutOptions {
  Zotero.Prefs.clear(key("graphAppearance"), true);
  Zotero.Prefs.clear(key("graphAppearanceVersion"), true);
  return { ...DEFAULT_GRAPH_LAYOUT };
}

function defaultFocusGraphAppearance(
  base: GraphLayoutOptions,
): GraphLayoutOptions {
  return {
    ...base,
    xMetric: "citation-sequence",
    xScale: "linear",
  };
}

/**
 * A seeded graph's default: the reader's, else the citation-sequence
 * variant of `base`, the library graph's default.
 */
export function getFocusGraphAppearance(
  base: GraphLayoutOptions,
): GraphLayoutOptions {
  const fallback = defaultFocusGraphAppearance(base);
  const parsed = storedFocusGraphAppearance();
  if (!parsed) return fallback;
  return withoutRetiredColouring({
    ...fallback,
    ...parsed,
    xScale:
      parsed.xMetric === "citation-sequence"
        ? "linear"
        : (parsed.xScale ?? fallback.xScale),
    yScale:
      parsed.yMetric === "citation-sequence"
        ? "linear"
        : (parsed.yScale ?? fallback.yScale),
  });
}

/** Whether the reader made a seeded graph's appearance the default. */
export function hasStoredFocusGraphAppearance(): boolean {
  return storedFocusGraphAppearance() !== null;
}

export function setFocusGraphAppearance(options: GraphLayoutOptions): void {
  const normalized = {
    ...options,
    xScale: options.xMetric === "citation-sequence" ? "linear" : options.xScale,
    yScale: options.yMetric === "citation-sequence" ? "linear" : options.yScale,
  };
  Zotero.Prefs.set(
    key("focusGraphAppearance"),
    JSON.stringify(normalized),
    true,
  );
  Zotero.Prefs.set(
    key("focusGraphAppearanceVersion"),
    FOCUS_GRAPH_APPEARANCE_SCHEMA_VERSION,
    true,
  );
}

/**
 * Forgets a seeded graph's made default and answers what a seeded graph
 * then opens with: the citation-sequence variant of `base`.
 */
export function resetFocusGraphAppearance(
  base: GraphLayoutOptions,
): GraphLayoutOptions {
  Zotero.Prefs.clear(key("focusGraphAppearance"), true);
  Zotero.Prefs.clear(key("focusGraphAppearanceVersion"), true);
  return defaultFocusGraphAppearance(base);
}

/**
 * The layout a new graph opens with: a seeded graph (a request with seeds,
 * or a saved graph whose recipe has them) takes the seeded default, a
 * library graph the library one. Reading writes nothing (D17).
 */
export function initialGraphAppearance(seeded: boolean): GraphLayoutOptions {
  const base = getGraphAppearance();
  return seeded ? getFocusGraphAppearance(base) : base;
}
