import { config } from "../../package.json";

export type GraphViewKind = "map" | "focus";

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

export function graphViewBaseTitle(kind: GraphViewKind): string {
  return kind === "focus" ? "Explore" : "Collection Graph";
}

/**
 * Return a stable, human-readable default title without reusing an existing
 * title. The first view keeps the unnumbered base name; later views use 2, 3,
 * and so on.
 */
export function nextGraphViewTitle(
  kind: GraphViewKind,
  existingTitles: readonly string[],
): string {
  const base = graphViewBaseTitle(kind);
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
