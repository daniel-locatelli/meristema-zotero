import { config } from "../../package.json";

export interface ViewInstanceDescriptor {
  instanceID: string;
  tabID: string | null;
  lastActivatedAt: number;
}

export interface ZoteroTabDescriptor {
  id?: string | null;
  type?: string | null;
}

/** Only real Meristema tabs may be promoted into the view-instance registry. */
export function isGraphTabDescriptor(
  tab: ZoteroTabDescriptor | null | undefined,
): boolean {
  if (!tab || tab.id === "zotero-pane") return false;
  return String(tab.type ?? "").replace(/-unloaded$/, "") === config.addonRef;
}

/** The name a view carries when nothing more specific names it. */
export const GRAPH_VIEW_BASE_TITLE = "Graph";

/**
 * The name a folder's graph carries: "PhD" becomes "PhD Graph". A folder
 * already named like a graph keeps its own name rather than becoming
 * "PhD Graph Graph". An unnamed folder has no graph name, and callers fall
 * back to the generic base.
 */
export function collectionGraphTitle(name: unknown): string | null {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return null;
  const lastWord = trimmed.split(/\s+/).at(-1)?.toLowerCase();
  return lastWord === "graph" ? trimmed : `${trimmed} Graph`;
}

/**
 * The name a graph scoped to several folders carries: the first folder, then
 * how many more. "PhD" and "Reading" give "PhD +1 Graph".
 *
 * Listing every folder would outgrow a tab as soon as there were three, and
 * truncating mid-name reads worse than a count. One folder is delegated to
 * `collectionGraphTitle` so the single-folder wording is unchanged.
 */
export function multiCollectionGraphTitle(
  names: readonly unknown[],
): string | null {
  const named = names.map((name) => String(name ?? "").trim()).filter(Boolean);
  if (!named.length) return null;
  if (named.length === 1) return collectionGraphTitle(named[0]);
  const words = named[0].split(/\s+/);
  const stem =
    words.length > 1 && words.at(-1)?.toLowerCase() === "graph"
      ? words.slice(0, -1).join(" ")
      : named[0];
  return `${stem} +${named.length - 1} Graph`;
}

/**
 * Return a stable, human-readable default title without reusing an existing
 * title. The first view keeps the unnumbered base name; later views use 2, 3,
 * and so on.
 *
 * `preferredBase` lets a caller name the view after what it shows — a graph
 * opened from a folder is titled after the folder, so the tab says what is in
 * it. A blank preference falls back to the generic base rather than titling a
 * tab with nothing.
 */
export function nextGraphViewTitle(
  existingTitles: readonly string[],
  preferredBase?: string,
): string {
  const base = preferredBase?.trim() || GRAPH_VIEW_BASE_TITLE;
  const occupied = new Set(existingTitles.map((title) => title.trim()));
  if (!occupied.has(base)) return base;
  let suffix = 2;
  while (occupied.has(`${base} ${suffix}`)) suffix += 1;
  return `${base} ${suffix}`;
}

/**
 * Route ordinary commands to the selected graph view when possible,
 * otherwise to the most recently activated live instance.
 */
export function selectReusableGraphInstance<T extends ViewInstanceDescriptor>(
  instances: readonly T[],
  selectedTabID: string | null | undefined,
): T | null {
  if (selectedTabID) {
    const selected = instances.find(
      (instance) => instance.tabID === selectedTabID,
    );
    if (selected) return selected;
  }
  return (
    [...instances].sort(
      (left, right) => right.lastActivatedAt - left.lastActivatedAt,
    )[0] ?? null
  );
}

/** Hidden tabs keep shared data current but defer expensive canvas rebuilds. */
export function graphInstanceShouldRender(
  hasDetachedWindow: boolean,
  isSelectedTab: boolean,
): boolean {
  return hasDetachedWindow || isSelectedTab;
}
