/// <reference lib="dom" />
/**
 * Keeps one of the graph's side panes in step with one of Zotero's.
 *
 * Zotero remembers its pane widths in the `pane.persist` pref, but only on
 * window close; during a session the pane element is the truth. So this
 * binding reads the element, writes the element the way Zotero's own restore
 * code does (`width` attribute plus inline style, then a relayout), and lets
 * Zotero persist the result. Nothing here writes the pref.
 *
 * The graph has two hosts: a tab in a Zotero main window, where the pane is in
 * the same document, and a detached window, where it is not. The binding
 * follows the host's own pane if it has one, otherwise the first open main
 * window's, and otherwise keeps a local width so the graph stays resizable.
 */

export type ZoteroPaneSide = "collections" | "item";

export interface ZoteroPaneState {
  /** The pane's open width. While collapsed, the last open width known. */
  width: number;
  collapsed: boolean;
}

export interface ZoteroPaneBinding {
  read(): ZoteroPaneState;
  /** Set the open width. Clamped to Zotero's minimum for the side. */
  write(width: number): void;
  setCollapsed(collapsed: boolean): void;
  /** Between these two calls the binding writes but does not notify. */
  beginLocalChange(): void;
  endLocalChange(): void;
  subscribe(listener: (state: ZoteroPaneState) => void): () => void;
  dispose(): void;
}

/** The Zotero access the binding needs, injectable so tests need no Zotero. */
export interface ZoteroPaneSyncDeps {
  mainWindows(): Window[];
  persistPref(): string | null;
  debug(message: string): void;
}

/** Keep in sync with Zotero's `updateLayoutConstraints`. */
export const PANE_MINIMUM: Record<ZoteroPaneSide, number> = {
  collections: 200,
  item: 320,
};

/** What Zotero gives a pane that reopens without a width. */
export const PANE_REOPEN_WIDTH: Record<ZoteroPaneSide, number> = {
  collections: 200,
  item: 337,
};

const PANE_ID: Record<ZoteroPaneSide, string> = {
  collections: "zotero-collections-pane",
  item: "zotero-item-pane",
};

const SPLITTER_ID: Record<ZoteroPaneSide, string> = {
  collections: "zotero-collections-splitter",
  item: "zotero-items-splitter",
};

/** An observation this close to what we last wrote is our own echo. */
const ECHO_TOLERANCE = 0.5;

function defaultDeps(): ZoteroPaneSyncDeps {
  return {
    mainWindows: () => Zotero.getMainWindows() as unknown as Window[],
    persistPref: () => {
      const value = Zotero.Prefs.get("pane.persist");
      return typeof value === "string" ? value : null;
    },
    debug: (message) => Zotero.debug(message),
  };
}

interface Target {
  win: Window;
  pane: Element & { style: CSSStyleDeclaration };
  splitter: Element | null;
  zoteroPane: {
    updateLayoutConstraints?: () => void;
    itemPane?: { collapsed: boolean };
  };
}

function findTarget(
  side: ZoteroPaneSide,
  win: Window | undefined,
): Target | null {
  if (!win) return null;
  try {
    const document = win.document;
    const pane = document?.getElementById?.(PANE_ID[side]);
    const zoteroPane = (win as unknown as { ZoteroPane?: Target["zoteroPane"] })
      .ZoteroPane;
    if (!pane || !zoteroPane) return null;
    return {
      win,
      pane: pane as Target["pane"],
      splitter: document.getElementById(SPLITTER_ID[side]),
      zoteroPane,
    };
  } catch {
    return null;
  }
}

function persistedWidth(
  side: ZoteroPaneSide,
  deps: ZoteroPaneSyncDeps,
): number | null {
  try {
    const raw = deps.persistPref();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, Record<string, string>>;
    const value = Number(parsed?.[PANE_ID[side]]?.width);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function attributeWidth(pane: Element): number | null {
  const value = Number(pane.getAttribute("width"));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function isCollapsed(pane: Element): boolean {
  return pane.getAttribute("collapsed") === "true";
}

function safely(deps: ZoteroPaneSyncDeps, what: string, run: () => void): void {
  try {
    run();
  } catch (error) {
    deps.debug(`Meristema: ${what} failed: ${String(error)}`);
  }
}

function sameState(a: ZoteroPaneState, b: ZoteroPaneState): boolean {
  return (
    a.collapsed === b.collapsed && Math.abs(a.width - b.width) < ECHO_TOLERANCE
  );
}

function detachedBinding(
  side: ZoteroPaneSide,
  deps: ZoteroPaneSyncDeps,
): ZoteroPaneBinding {
  const listeners = new Set<(state: ZoteroPaneState) => void>();
  let state: ZoteroPaneState = {
    width: persistedWidth(side, deps) ?? PANE_REOPEN_WIDTH[side],
    collapsed: false,
  };
  const notify = (): void => {
    for (const listener of listeners) listener({ ...state });
  };
  return {
    read: () => ({ ...state }),
    write(width) {
      state = {
        ...state,
        width: Math.max(PANE_MINIMUM[side], Math.round(width)),
      };
      notify();
    },
    setCollapsed(collapsed) {
      if (collapsed === state.collapsed) return;
      state = { ...state, collapsed };
      notify();
    },
    beginLocalChange: () => undefined,
    endLocalChange: () => undefined,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: () => listeners.clear(),
  };
}

export function bindZoteroPane(
  side: ZoteroPaneSide,
  host: Window,
  deps: ZoteroPaneSyncDeps = defaultDeps(),
): ZoteroPaneBinding {
  let target = findTarget(side, host);
  if (!target) {
    for (const win of deps.mainWindows()) {
      target = findTarget(side, win);
      if (target) break;
    }
  }
  if (!target) {
    deps.debug(
      `Meristema: no Zotero ${side} pane to follow; the graph pane resizes on its own.`,
    );
    return detachedBinding(side, deps);
  }

  const { pane, splitter, zoteroPane } = target;
  const minimum = PANE_MINIMUM[side];
  const listeners = new Set<(state: ZoteroPaneState) => void>();

  /** The last open width seen or written; what `read()` reports while collapsed. */
  let lastWidth =
    attributeWidth(pane) ??
    persistedWidth(side, deps) ??
    PANE_REOPEN_WIDTH[side];
  let lastWritten = Number.NaN;
  let localDepth = 0;

  const read = (): ZoteroPaneState => {
    const collapsed = isCollapsed(pane);
    if (!collapsed) {
      const measured = pane.getBoundingClientRect().width;
      const width = measured > 0 ? measured : attributeWidth(pane);
      if (width) lastWidth = width;
    }
    return { width: lastWidth, collapsed };
  };

  /** What listeners last heard, so a self-made change is not reported back. */
  let lastNotified = read();

  const notify = (state: ZoteroPaneState): void => {
    lastNotified = state;
    for (const listener of listeners) listener({ ...state });
  };

  const relayout = (): void =>
    safely(deps, "ZoteroPane.updateLayoutConstraints", () =>
      zoteroPane.updateLayoutConstraints?.(),
    );

  const write = (width: number): void => {
    const rounded = Math.max(minimum, Math.round(width));
    lastWritten = rounded;
    lastWidth = rounded;
    safely(deps, `writing the ${side} pane width`, () => {
      pane.setAttribute("width", String(rounded));
      pane.style.width = `${rounded}px`;
    });
    relayout();
  };

  const onObservation = (): void => {
    const state = read();
    if (localDepth > 0) return;
    if (sameState(state, lastNotified)) return;
    const echo =
      state.collapsed === lastNotified.collapsed &&
      Math.abs(state.width - lastWritten) < ECHO_TOLERANCE;
    if (echo) {
      lastNotified = state;
      return;
    }
    lastWritten = Number.NaN;
    notify(state);
  };

  const view = target.win as unknown as {
    ResizeObserver?: new (cb: () => void) => {
      observe(el: Element): void;
      disconnect(): void;
    };
    MutationObserver?: new (cb: () => void) => {
      observe(el: Element, init: MutationObserverInit): void;
      disconnect(): void;
    };
  };
  const resizeObserver = view.ResizeObserver
    ? new view.ResizeObserver(onObservation)
    : null;
  resizeObserver?.observe(pane);
  const mutationObserver = view.MutationObserver
    ? new view.MutationObserver(onObservation)
    : null;
  mutationObserver?.observe(pane, {
    attributes: true,
    attributeFilter: ["collapsed", "width"],
  });

  const setCollapsed = (collapsed: boolean): void => {
    if (collapsed === isCollapsed(pane)) return;
    const widthToRestore = lastWidth;
    // Say it before doing it, so the mutation we cause reads as already known.
    lastNotified = { width: widthToRestore, collapsed };
    if (side === "item" && zoteroPane.itemPane) {
      safely(deps, "ZoteroPane.itemPane.collapsed", () => {
        zoteroPane.itemPane!.collapsed = collapsed;
      });
    } else {
      safely(deps, `collapsing the ${side} pane`, () => {
        splitter?.setAttribute("state", collapsed ? "collapsed" : "open");
        pane.setAttribute("collapsed", String(collapsed));
      });
      relayout();
    }
    if (!collapsed) write(widthToRestore);
    /*
     * Zotero can refuse silently: `safely` swallows a throw, and its own
     * `setPaneCollapsed` early-returns in states it does not like. So the pane
     * itself, not the request, is what listeners are told about — otherwise the
     * view would draw a collapsed pane that Zotero still has open, and no
     * observation would ever correct it, because `lastNotified` already claims
     * the change happened.
     */
    const actual = read();
    if (actual.collapsed === collapsed) {
      lastNotified = actual;
      return;
    }
    notify(actual);
  };

  return {
    read,
    write,
    setCollapsed,
    beginLocalChange() {
      localDepth += 1;
    },
    endLocalChange() {
      localDepth = Math.max(0, localDepth - 1);
      // Whatever we wrote during the change is now the known state.
      lastNotified = read();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      listeners.clear();
    },
  };
}
