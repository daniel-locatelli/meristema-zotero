# Zotero Pane Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The graph view's Key rail and detail pane mirror Zotero's collections pane and item pane in width and collapse state, live and in both directions, and the rail becomes draggable.

**Architecture:** A new `zoteroPaneSync.ts` service binds one graph pane to one Zotero pane element: it observes the element with `ResizeObserver` and `MutationObserver`, writes back the way Zotero's own restore code does, and suppresses its own echoes. A shared drag helper in `graphViewControls.ts` drives both the rail's new handle and the detail pane's existing one. The graph view wires the two together and the three Meristema layout prefs are removed.

**Tech Stack:** TypeScript, Zotero 7 plugin (XUL/HTML in a Gecko window), `node --test` + chai for unit tests (`npm run test:unit`), esbuild via `zotero-plugin`.

Spec: `docs/superpowers/specs/2026-09-03-zotero-pane-sync-design.md`.

## Global Constraints

- Unit tests run under Node with no DOM and no `Zotero` global (`test/nodeResolve.mjs`). Any module under test must take its window and Zotero access as injectable parameters with defaults; module top level must not touch `Zotero` or `document`.
- Zotero minimum widths: collections pane 200px, item pane 320px. Reopen fallbacks: collections 200, item 337.
- Collapsed graph strips stay: rail 28px (CSS), detail pane `COLLAPSED_DETAIL_WIDTH` = 36px.
- Collapse threshold: 60px past the minimum, measured from the pointer.
- Echo suppression: drop observations within 0.5px of the last written width; no notification during a local change.
- Zotero element ids: `zotero-collections-pane`, `zotero-collections-splitter`, `zotero-item-pane`, `zotero-items-splitter`. Zotero methods: `ZoteroPane.updateLayoutConstraints()`, `ZoteroPane.itemPane.collapsed` (setter).
- Zotero pref `pane.persist` is read with `Zotero.Prefs.get("pane.persist")` (no `true`: it lives under Zotero's own prefix). It is never written by the plugin.
- Every call into Zotero is wrapped so an exception cannot break a drag.
- Commit messages follow the repo's style: a sentence in the imperative, no prefix, plus the trailer lines below.
- `npm run check` (prettier, eslint, tsc, unit tests) must pass before each commit.

Commit trailer for every commit in this plan:

```
Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa
```

## File map

| File | Responsibility |
| --- | --- |
| `src/services/zoteroPaneSync.ts` (new) | Bind a graph pane to a Zotero pane: read, write, collapse, observe, echo suppression, detached fallback. |
| `test/unit/zoteroPaneSync.test.ts` (new) | Unit tests against a fake window. |
| `src/services/graphViewControls.ts` | Gains `attachPaneResizer` and its two pure helpers. |
| `test/unit/paneResizer.test.ts` (new) | Unit tests for the drag helper. |
| `src/services/graphKeyRail.ts` | Rail gets a resizer handle, `setWidth`, `setCollapsed`, `isCollapsed`; drops the pref. |
| `src/services/graphViewService.ts` | Creates the two bindings, wires rail and detail pane to them, disposes on cleanup. |
| `src/services/citationPreferences.ts`, `addon/prefs.js` | Remove `detailPanelWidth`, `detailPanelCollapsed`, `graphKeyRailCollapsed`. |
| `addon/content/graph.css` | Rail resizer strip; rail width no longer a fixed variable. |

---

### Task 1: `zoteroPaneSync.ts` binding with unit tests

**Files:**
- Create: `src/services/zoteroPaneSync.ts`
- Create: `test/unit/zoteroPaneSync.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:

```ts
export type ZoteroPaneSide = "collections" | "item";
export interface ZoteroPaneState { width: number; collapsed: boolean }
export interface ZoteroPaneBinding {
  read(): ZoteroPaneState;
  write(width: number): void;
  setCollapsed(collapsed: boolean): void;
  beginLocalChange(): void;
  endLocalChange(): void;
  subscribe(listener: (state: ZoteroPaneState) => void): () => void;
  dispose(): void;
}
export interface ZoteroPaneSyncDeps {
  mainWindows(): Window[];
  persistPref(): string | null;
  debug(message: string): void;
}
export const PANE_MINIMUM: Record<ZoteroPaneSide, number>;   // { collections: 200, item: 320 }
export const PANE_REOPEN_WIDTH: Record<ZoteroPaneSide, number>; // { collections: 200, item: 337 }
export function bindZoteroPane(side: ZoteroPaneSide, host: Window, deps?: ZoteroPaneSyncDeps): ZoteroPaneBinding;
```

- [ ] **Step 1: Write the failing tests**

Create `test/unit/zoteroPaneSync.test.ts`:

```ts
import { describe, it } from "node:test";
import { expect } from "chai";
import {
  bindZoteroPane,
  PANE_MINIMUM,
  PANE_REOPEN_WIDTH,
  type ZoteroPaneState,
  type ZoteroPaneSyncDeps,
} from "../../src/services/zoteroPaneSync";

/** The subset of an element the binding touches, with a settable layout width. */
class FakePane {
  attributes = new Map<string, string>();
  style: Record<string, string> = {};
  rectWidth = 0;
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }
  getBoundingClientRect(): { width: number } {
    return { width: this.rectWidth };
  }
}

type Callback = () => void;

class FakeObserverRegistry {
  resize: Callback[] = [];
  mutation: Callback[] = [];
  disconnected = 0;
  ResizeObserver = (registry: FakeObserverRegistry) =>
    class {
      constructor(private cb: Callback) {}
      observe(): void {
        registry.resize.push(this.cb);
      }
      disconnect(): void {
        registry.disconnected += 1;
      }
    };
  MutationObserver = (registry: FakeObserverRegistry) =>
    class {
      constructor(private cb: Callback) {}
      observe(): void {
        registry.mutation.push(this.cb);
      }
      disconnect(): void {
        registry.disconnected += 1;
      }
    };
  fire(): void {
    for (const cb of [...this.resize, ...this.mutation]) cb();
  }
}

interface Fixture {
  win: Window;
  pane: FakePane;
  splitter: FakePane;
  observers: FakeObserverRegistry;
  layoutCalls: number;
  itemPaneCollapsed: boolean[];
  deps: ZoteroPaneSyncDeps;
  debugLines: string[];
}

function fixture(options: { itemPaneSetter?: boolean; layout?: boolean } = {}): Fixture {
  const pane = new FakePane();
  const splitter = new FakePane();
  const observers = new FakeObserverRegistry();
  const state: Fixture = {
    win: null as unknown as Window,
    pane,
    splitter,
    observers,
    layoutCalls: 0,
    itemPaneCollapsed: [],
    debugLines: [],
    deps: {
      mainWindows: () => [],
      persistPref: () => null,
      debug: (line) => state.debugLines.push(line),
    },
  };
  const ZoteroPane: Record<string, unknown> = {};
  if (options.layout !== false) {
    ZoteroPane.updateLayoutConstraints = () => {
      state.layoutCalls += 1;
    };
  }
  if (options.itemPaneSetter !== false) {
    ZoteroPane.itemPane = {
      set collapsed(value: boolean) {
        state.itemPaneCollapsed.push(value);
        if (value) {
          pane.setAttribute("collapsed", "true");
          pane.removeAttribute("width");
        } else {
          pane.removeAttribute("collapsed");
        }
      },
    };
  }
  const byId: Record<string, FakePane> = {
    "zotero-collections-pane": pane,
    "zotero-item-pane": pane,
    "zotero-collections-splitter": splitter,
    "zotero-items-splitter": splitter,
  };
  state.win = {
    document: { getElementById: (id: string) => byId[id] ?? null },
    ZoteroPane,
    ResizeObserver: observers.ResizeObserver(observers),
    MutationObserver: observers.MutationObserver(observers),
  } as unknown as Window;
  return state;
}

function collect(binding: { subscribe(l: (s: ZoteroPaneState) => void): () => void }): ZoteroPaneState[] {
  const seen: ZoteroPaneState[] = [];
  binding.subscribe((s) => seen.push({ ...s }));
  return seen;
}

describe("bindZoteroPane", function () {
  it("reads the pane's width and collapsed state", function () {
    const f = fixture();
    f.pane.setAttribute("width", "260");
    f.pane.rectWidth = 260;
    const binding = bindZoteroPane("collections", f.win, f.deps);
    expect(binding.read()).to.deep.equal({ width: 260, collapsed: false });
    f.pane.setAttribute("collapsed", "true");
    expect(binding.read()).to.deep.equal({ width: 260, collapsed: true });
  });

  it("writes attribute and style, clamps, and asks Zotero to relayout", function () {
    const f = fixture();
    f.pane.rectWidth = 250;
    const binding = bindZoteroPane("item", f.win, f.deps);
    binding.write(410.4);
    expect(f.pane.getAttribute("width")).to.equal("410");
    expect(f.pane.style.width).to.equal("410px");
    expect(f.layoutCalls).to.equal(1);
    binding.write(10);
    expect(f.pane.getAttribute("width")).to.equal(String(PANE_MINIMUM.item));
  });

  it("does not notify for an observation echoing its own write", function () {
    const f = fixture();
    f.pane.rectWidth = 200;
    const binding = bindZoteroPane("collections", f.win, f.deps);
    const seen = collect(binding);
    binding.write(300);
    f.pane.rectWidth = 300.3;
    f.observers.fire();
    expect(seen).to.have.length(0);
    f.pane.rectWidth = 320;
    f.observers.fire();
    expect(seen).to.deep.equal([{ width: 320, collapsed: false }]);
  });

  it("stays quiet during a local change and reports the first change after it", function () {
    const f = fixture();
    f.pane.rectWidth = 200;
    const binding = bindZoteroPane("collections", f.win, f.deps);
    const seen = collect(binding);
    binding.beginLocalChange();
    f.pane.rectWidth = 240;
    f.observers.fire();
    f.pane.rectWidth = 280;
    f.observers.fire();
    binding.endLocalChange();
    expect(seen).to.have.length(0);
    f.pane.rectWidth = 500;
    f.observers.fire();
    expect(seen).to.deep.equal([{ width: 500, collapsed: false }]);
  });

  it("collapses the collections pane the way Zotero's View menu does", function () {
    const f = fixture();
    f.pane.rectWidth = 230;
    const binding = bindZoteroPane("collections", f.win, f.deps);
    const seen = collect(binding);
    binding.setCollapsed(true);
    expect(f.splitter.getAttribute("state")).to.equal("collapsed");
    expect(f.pane.getAttribute("collapsed")).to.equal("true");
    expect(f.layoutCalls).to.equal(1);
    f.observers.fire();
    expect(seen).to.have.length(0);
    binding.setCollapsed(false);
    expect(f.splitter.getAttribute("state")).to.equal("open");
    expect(f.pane.getAttribute("collapsed")).to.equal("false");
    expect(f.pane.getAttribute("width")).to.equal("230");
  });

  it("collapses the item pane through Zotero's setter and restores the width on reopen", function () {
    const f = fixture();
    f.pane.rectWidth = 400;
    const binding = bindZoteroPane("item", f.win, f.deps);
    binding.setCollapsed(true);
    expect(f.itemPaneCollapsed).to.deep.equal([true]);
    expect(binding.read()).to.deep.equal({ width: 400, collapsed: true });
    binding.setCollapsed(false);
    expect(f.itemPaneCollapsed).to.deep.equal([true, false]);
    expect(f.pane.getAttribute("width")).to.equal("400");
  });

  it("notifies a collapse that came from Zotero, with the last open width", function () {
    const f = fixture();
    f.pane.rectWidth = 333;
    const binding = bindZoteroPane("item", f.win, f.deps);
    const seen = collect(binding);
    f.pane.setAttribute("collapsed", "true");
    f.pane.removeAttribute("width");
    f.pane.rectWidth = 0;
    f.observers.fire();
    expect(seen).to.deep.equal([{ width: 333, collapsed: true }]);
  });

  it("takes the width from pane.persist, then Zotero's reopen default, when collapsed at bind", function () {
    const f = fixture();
    f.pane.setAttribute("collapsed", "true");
    f.deps.persistPref = () =>
      JSON.stringify({ "zotero-item-pane": { width: "380" } });
    expect(bindZoteroPane("item", f.win, f.deps).read().width).to.equal(380);
    f.deps.persistPref = () => null;
    expect(bindZoteroPane("item", f.win, f.deps).read().width).to.equal(
      PANE_REOPEN_WIDTH.item,
    );
  });

  it("follows the first main window when the host has no Zotero pane", function () {
    const f = fixture();
    f.pane.rectWidth = 270;
    const host = { document: { getElementById: () => null } } as unknown as Window;
    f.deps.mainWindows = () => [f.win];
    const binding = bindZoteroPane("collections", host, f.deps);
    expect(binding.read().width).to.equal(270);
  });

  it("falls back to a detached binding when no pane exists anywhere", function () {
    const host = { document: { getElementById: () => null } } as unknown as Window;
    const debugLines: string[] = [];
    const binding = bindZoteroPane("collections", host, {
      mainWindows: () => [],
      persistPref: () => JSON.stringify({ "zotero-collections-pane": { width: "222" } }),
      debug: (line) => debugLines.push(line),
    });
    const seen = collect(binding);
    expect(binding.read()).to.deep.equal({ width: 222, collapsed: false });
    binding.write(300);
    binding.setCollapsed(true);
    expect(binding.read()).to.deep.equal({ width: 300, collapsed: true });
    expect(seen).to.deep.equal([
      { width: 300, collapsed: false },
      { width: 300, collapsed: true },
    ]);
    expect(debugLines).to.have.length(1);
  });

  it("still writes the element when updateLayoutConstraints is missing", function () {
    const f = fixture({ layout: false });
    f.pane.rectWidth = 200;
    const binding = bindZoteroPane("collections", f.win, f.deps);
    expect(() => binding.write(310)).not.to.throw();
    expect(f.pane.getAttribute("width")).to.equal("310");
  });

  it("disconnects both observers on dispose", function () {
    const f = fixture();
    const binding = bindZoteroPane("collections", f.win, f.deps);
    binding.dispose();
    expect(f.observers.disconnected).to.equal(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:unit -- --test-name-pattern="bindZoteroPane"` (or simply `npm run test:unit`)
Expected: failure to load `../../src/services/zoteroPaneSync` (module not found).

- [ ] **Step 3: Write the implementation**

Create `src/services/zoteroPaneSync.ts`:

```ts
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

function findTarget(side: ZoteroPaneSide, win: Window | undefined): Target | null {
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
  return a.collapsed === b.collapsed && Math.abs(a.width - b.width) < ECHO_TOLERANCE;
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
      state = { ...state, width: Math.max(PANE_MINIMUM[side], Math.round(width)) };
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
    notify(state);
  };

  const view = target.win as unknown as {
    ResizeObserver?: new (cb: () => void) => { observe(el: Element): void; disconnect(): void };
    MutationObserver?: new (cb: () => void) => {
      observe(el: Element, init: MutationObserverInit): void;
      disconnect(): void;
    };
  };
  const resizeObserver = view.ResizeObserver ? new view.ResizeObserver(onObservation) : null;
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit`
Expected: all `bindZoteroPane` cases PASS, no other test changed.

If the type checker rejects `Zotero.getMainWindows()` or `Zotero.Prefs.get("pane.persist")`, keep the `as unknown as` casts inside `defaultDeps` only; do not loosen the exported types.

- [ ] **Step 5: Check and commit**

Run: `npm run check`
Expected: prettier, eslint, tsc and tests all pass.

```bash
git add src/services/zoteroPaneSync.ts test/unit/zoteroPaneSync.test.ts
git commit -m "Bind a graph pane to one of Zotero's

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa"
```

---

### Task 2: `attachPaneResizer` drag helper with unit tests

**Files:**
- Modify: `src/services/graphViewControls.ts` (append at end of file)
- Create: `test/unit/paneResizer.test.ts`

**Interfaces:**
- Consumes: `clamp` from `src/services/graphMetricScale.ts` (`clamp(value, minimum, maximum): number`).
- Produces:

```ts
export type PaneEdge = "start" | "end";
export type PaneRelease = { kind: "commit"; width: number } | { kind: "collapse" };
export function paneWidthFromPointer(edge: PaneEdge, origin: number, clientX: number): number;
export function paneRelease(raw: number, minimum: number, maximum: number, collapseThreshold: number): PaneRelease;
export interface PaneResizerOptions {
  handle: HTMLElement;
  edge: PaneEdge;
  minimum: number;
  maximum: () => number;
  collapseThreshold: number;
  origin: () => number;
  onBegin: () => void;
  onMove: (width: number) => void;
  onRelease: (release: PaneRelease) => void;
  onEnd: () => void;
  onToggle: () => void;
}
export function attachPaneResizer(options: PaneResizerOptions): () => void; // returns detach
```

- [ ] **Step 1: Write the failing tests**

Create `test/unit/paneResizer.test.ts`:

```ts
import { describe, it } from "node:test";
import { expect } from "chai";
import {
  attachPaneResizer,
  paneRelease,
  paneWidthFromPointer,
  type PaneRelease,
} from "../../src/services/graphViewControls";

type Listener = (event: unknown) => void;

class FakeHandle {
  listeners = new Map<string, Listener[]>();
  captured: number[] = [];
  released: number[] = [];
  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  removeEventListener(type: string, listener: Listener): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((l) => l !== listener),
    );
  }
  setPointerCapture(id: number): void {
    this.captured.push(id);
  }
  releasePointerCapture(id: number): void {
    this.released.push(id);
  }
  fire(type: string, event: Record<string, unknown> = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  count(): number {
    let total = 0;
    for (const list of this.listeners.values()) total += list.length;
    return total;
  }
}

describe("paneWidthFromPointer", function () {
  it("grows to the right for a start edge and to the left for an end edge", function () {
    expect(paneWidthFromPointer("start", 100, 350)).to.equal(250);
    expect(paneWidthFromPointer("end", 1000, 640)).to.equal(360);
  });
});

describe("paneRelease", function () {
  it("commits the clamped width inside the range", function () {
    expect(paneRelease(250, 200, 600, 60)).to.deep.equal({ kind: "commit", width: 250 });
    expect(paneRelease(900, 200, 600, 60)).to.deep.equal({ kind: "commit", width: 600 });
  });
  it("commits the minimum just under it, and collapses past the threshold", function () {
    expect(paneRelease(150, 200, 600, 60)).to.deep.equal({ kind: "commit", width: 200 });
    expect(paneRelease(139, 200, 600, 60)).to.deep.equal({ kind: "collapse" });
  });
});

describe("attachPaneResizer", function () {
  function setup(edge: "start" | "end") {
    const handle = new FakeHandle();
    const log: string[] = [];
    const releases: PaneRelease[] = [];
    const detach = attachPaneResizer({
      handle: handle as unknown as HTMLElement,
      edge,
      minimum: 200,
      maximum: () => 600,
      collapseThreshold: 60,
      origin: () => (edge === "start" ? 100 : 1000),
      onBegin: () => log.push("begin"),
      onMove: (width) => log.push(`move ${width}`),
      onRelease: (release) => releases.push(release),
      onEnd: () => log.push("end"),
      onToggle: () => log.push("toggle"),
    });
    return { handle, log, releases, detach };
  }

  it("captures the pointer, clamps moves, and commits on release", function () {
    const { handle, log, releases } = setup("start");
    handle.fire("pointerdown", { pointerId: 7 });
    handle.fire("pointermove", { clientX: 400 });
    handle.fire("pointermove", { clientX: 900 });
    handle.fire("pointerup", { pointerId: 7, clientX: 900 });
    expect(handle.captured).to.deep.equal([7]);
    expect(handle.released).to.deep.equal([7]);
    expect(log).to.deep.equal(["begin", "move 300", "move 600", "end"]);
    expect(releases).to.deep.equal([{ kind: "commit", width: 600 }]);
  });

  it("ignores moves without a pointer down and releases without a move", function () {
    const { handle, log, releases } = setup("end");
    handle.fire("pointermove", { clientX: 700 });
    handle.fire("pointerdown", { pointerId: 1 });
    handle.fire("pointerup", { pointerId: 1, clientX: 1000 });
    expect(log).to.deep.equal(["begin", "end"]);
    expect(releases).to.have.length(0);
  });

  it("collapses when released past the threshold", function () {
    const { handle, log, releases } = setup("end");
    handle.fire("pointerdown", { pointerId: 2 });
    handle.fire("pointermove", { clientX: 870 });
    handle.fire("pointerup", { pointerId: 2, clientX: 870 });
    expect(log).to.deep.equal(["begin", "move 200", "end"]);
    expect(releases).to.deep.equal([{ kind: "collapse" }]);
  });

  it("toggles on double click and removes every listener on detach", function () {
    const { handle, log, detach } = setup("start");
    handle.fire("dblclick");
    expect(log).to.deep.equal(["toggle"]);
    detach();
    expect(handle.count()).to.equal(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:unit`
Expected: `paneResizer.test.ts` fails with `attachPaneResizer` is not exported / not a function.

- [ ] **Step 3: Write the implementation**

Append to `src/services/graphViewControls.ts`. First add the import at the top of the file, next to the existing imports:

```ts
import { clamp } from "./graphMetricScale";
```

Then append:

```ts
/*
 * A drag handle on a pane's inner edge. Both of the view's side panes use
 * this: the Key rail, whose width grows as the pointer moves right, and the
 * detail pane, whose width grows as it moves left. The drawn width is always
 * clamped, so "drag it shut" is decided from where the pointer is, not from
 * the width: past the minimum by more than the threshold on release means
 * collapse.
 */
export type PaneEdge = "start" | "end";

export type PaneRelease =
  | { kind: "commit"; width: number }
  | { kind: "collapse" };

/** The raw width the pointer asks for: distance from the pane's far edge. */
export function paneWidthFromPointer(
  edge: PaneEdge,
  origin: number,
  clientX: number,
): number {
  return edge === "start" ? clientX - origin : origin - clientX;
}

export function paneRelease(
  raw: number,
  minimum: number,
  maximum: number,
  collapseThreshold: number,
): PaneRelease {
  if (raw < minimum - collapseThreshold) return { kind: "collapse" };
  return { kind: "commit", width: clamp(raw, minimum, maximum) };
}

export interface PaneResizerOptions {
  handle: HTMLElement;
  edge: PaneEdge;
  minimum: number;
  maximum: () => number;
  /** Pixels past the minimum the pointer must go before release collapses. */
  collapseThreshold: number;
  /** The pane's far edge in client x: its left for "start", its right for "end". */
  origin: () => number;
  onBegin: () => void;
  onMove: (width: number) => void;
  /** Called on release only if the pointer moved. */
  onRelease: (release: PaneRelease) => void;
  /** Called on every release, after `onRelease`. */
  onEnd: () => void;
  onToggle: () => void;
}

/** Wire the handle. Returns a function that removes every listener. */
export function attachPaneResizer(options: PaneResizerOptions): () => void {
  const { handle } = options;
  let dragging = false;
  let lastRaw: number | null = null;

  const onPointerDown = (event: PointerEvent): void => {
    dragging = true;
    lastRaw = null;
    handle.setPointerCapture?.(event.pointerId);
    options.onBegin();
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging) return;
    lastRaw = paneWidthFromPointer(options.edge, options.origin(), event.clientX);
    options.onMove(clamp(lastRaw, options.minimum, options.maximum()));
  };
  const onPointerUp = (event: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    handle.releasePointerCapture?.(event.pointerId);
    if (lastRaw !== null) {
      options.onRelease(
        paneRelease(
          lastRaw,
          options.minimum,
          options.maximum(),
          options.collapseThreshold,
        ),
      );
    }
    options.onEnd();
  };
  const onDoubleClick = (): void => options.onToggle();

  handle.addEventListener("pointerdown", onPointerDown);
  handle.addEventListener("pointermove", onPointerMove);
  handle.addEventListener("pointerup", onPointerUp);
  handle.addEventListener("pointercancel", onPointerUp);
  handle.addEventListener("dblclick", onDoubleClick);
  return () => {
    handle.removeEventListener("pointerdown", onPointerDown);
    handle.removeEventListener("pointermove", onPointerMove);
    handle.removeEventListener("pointerup", onPointerUp);
    handle.removeEventListener("pointercancel", onPointerUp);
    handle.removeEventListener("dblclick", onDoubleClick);
  };
}
```

Note on the test "releases without a move": `pointerup` with `clientX: 1000` and no prior move leaves `lastRaw` null, so `onRelease` is not called. The "collapses" test: end edge, origin 1000, pointer 870, raw 130, which is more than 60 under the minimum 200.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit`
Expected: all cases PASS.

- [ ] **Step 5: Check and commit**

Run: `npm run check`

```bash
git add src/services/graphViewControls.ts test/unit/paneResizer.test.ts
git commit -m "Share one drag handle between the view's two side panes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa"
```

---

### Task 3: The Key rail gets a handle and stops owning its collapse pref

**Files:**
- Modify: `src/services/graphKeyRail.ts` (imports at top; `KeyRailOptions`, `KeyRail` interface, `createKeyRail` body)
- Modify: `addon/content/graph.css:1274-1290` (rail block) and add a `.cm-rail-resizer` rule

**Interfaces:**
- Consumes: `element` from `graphViewControls.ts` (already imported).
- Produces, on `KeyRail`:

```ts
resizer: HTMLElement;              // the 8px handle on the rail's inner edge
setWidth(width: number): void;     // open width in px; stored while collapsed, applied when open
setCollapsed(collapsed: boolean): void;
isCollapsed(): boolean;
```
and on `KeyRailOptions`: `onCollapsedChange?: (collapsed: boolean) => void`, called only when the rail's own toggle flips it.

This task has no unit test: the rail needs a DOM and the repo's unit tests run without one (see `test/nodeResolve.mjs`). It is verified by the type checker here and by the manual check in Task 5.

- [ ] **Step 1: Remove the pref import and add the option**

In `src/services/graphKeyRail.ts` delete these lines:

```ts
import {
  getKeyRailCollapsed,
  setKeyRailCollapsed,
} from "./citationPreferences";
```

Change `KeyRailOptions` to:

```ts
export interface KeyRailOptions {
  document: Document;
  /**
   * Emphasise the papers an entry covers, or release with null. The rail never
   * decides what emphasis *means*; it only says which entry is being pointed at.
   */
  onEmphasise: (entry: KeyEntry | null) => void;
  /**
   * The rail's own toggle flipped it. Not called for `setCollapsed`, which is
   * how the view tells the rail about a change that came from elsewhere.
   */
  onCollapsedChange?: (collapsed: boolean) => void;
}
```

- [ ] **Step 2: Extend the `KeyRail` interface**

Replace the `KeyRail` interface's `render`/`release`/`destroy` block so it reads:

```ts
  footer: HTMLElement;
  /**
   * The drag handle on the rail's inner edge. The view wires it, because the
   * width it drags is Zotero's collections pane width, not the rail's own.
   */
  resizer: HTMLElement;
  /** The open width. Remembered while collapsed and applied on expand. */
  setWidth(width: number): void;
  setCollapsed(collapsed: boolean): void;
  isCollapsed(): boolean;
  render(model: KeyModel): void;
  /** Drop any pinned emphasis — a background click, or Escape. */
  release(): void;
  destroy(): void;
}
```

- [ ] **Step 3: Rewrite the collapse state inside `createKeyRail`**

Replace, inside `createKeyRail`, the block from `const body = element(document, "div", "cm-key-body");` down to the end of the `toggle.addEventListener("click", …)` handler with:

```ts
  const body = element(document, "div", "cm-key-body");
  const footer = element(document, "div", "cm-key-footer");
  const resizer = element(document, "div", "cm-rail-resizer");
  resizer.tabIndex = 0;
  resizer.setAttribute("role", "separator");
  resizer.setAttribute("aria-orientation", "vertical");
  resizer.setAttribute("aria-label", "Resize sidebar");
  root.append(toolbar, body, footer, resizer);

  // Width and collapse belong to Zotero's collections pane; the view sets
  // them here from its binding, and the rail only draws what it is told.
  let collapsed = false;
  let width = 200;
  /** The entry whose emphasis is pinned, if any. Hover is transient; this is not. */
  let pinned: KeyEntry | null = null;
  let pinnedButton: HTMLButtonElement | null = null;

  const applyLayout = (): void => {
    root.dataset.collapsed = String(collapsed);
    // Inline width would beat the stylesheet's 28px collapsed rule, so it is
    // only set while open.
    root.style.width = collapsed ? "" : `${Math.round(width)}px`;
    resizer.hidden = collapsed;
    toggle.setAttribute("aria-expanded", String(!collapsed));
    // "Sidebar", not "key": the rail carries the view's controls as well as
    // the Key now, and the button takes the whole column with it.
    const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
    toggle.title = label;
    toggle.setAttribute("aria-label", label);
    toggle.replaceChildren(
      createIcon(
        document,
        collapsed ? "chevron-right" : "chevron-left",
        PANE_TOGGLE_ICON_SIZE,
      ),
    );
  };

  const release = (): void => {
    if (!pinned) return;
    pinned = null;
    pinnedButton?.setAttribute("aria-pressed", "false");
    pinnedButton = null;
    onEmphasise(null);
  };

  const setCollapsed = (next: boolean): void => {
    if (next === collapsed) return;
    collapsed = next;
    applyLayout();
    // A collapsed rail cannot show what is pinned, so it cannot hold a pin.
    if (collapsed) release();
  };

  toggle.addEventListener("click", () => {
    setCollapsed(!collapsed);
    options.onCollapsedChange?.(collapsed);
  });
```

Then replace the call `applyCollapsed();` near the bottom of `createKeyRail` with `applyLayout();`, and in the returned object add the new members after `footer,`:

```ts
    resizer,
    setWidth(next: number): void {
      width = next;
      applyLayout();
    },
    setCollapsed,
    isCollapsed: () => collapsed,
```

- [ ] **Step 4: Style the handle and free the rail's width**

In `addon/content/graph.css`, the `.cm-key-rail` block keeps `width: var(--cm-sidepane-width);` as the pre-sync default; add `min-width: 0;` is already there. Add after the `.cm-key-rail[data-collapsed="true"] .cm-key-body` rule:

```css
/*
 * The rail's drag handle, on the edge it shares with the plot. Zotero's
 * `#zotero-collections-splitter` sits between the two panes; here it lies
 * over the rail's own last 8px so the layout has no extra column.
 */
.cm-rail-resizer {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  width: 8px;
  cursor: ew-resize;
  z-index: 3;
}
.cm-rail-resizer:hover {
  background: color-mix(in srgb, var(--cm-accent) 30%, transparent);
}
.cm-rail-resizer[hidden] {
  display: none;
}
```

Change the comment above `--cm-sidepane-width: 200px;` (`graph.css:25`) to say it is the rail's width until the view has read Zotero's, since the rail now sets an inline width.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean. `graphViewService.ts` never imported the rail's pref functions, and the new `KeyRail` members are optional to use, so nothing outside `graphKeyRail.ts` changes in this task. Any error is a mistake in this task.

- [ ] **Step 6: Commit**

Run: `npm run check`

```bash
git add src/services/graphKeyRail.ts addon/content/graph.css
git commit -m "Give the Key rail a drag handle and take its collapse pref away

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa"
```

---

### Task 4: Wire both panes to Zotero in the graph view and remove the prefs

**Files:**
- Modify: `src/services/graphViewService.ts` (imports at ~118-172; detail pane setup ~1034-1097; toggle/resizer block ~4254-4313; cleanup ~4660-4667)
- Modify: `src/services/citationPreferences.ts:168-190`
- Modify: `addon/prefs.js:18-19`

**Interfaces:**
- Consumes: `bindZoteroPane`, `PANE_MINIMUM`, `ZoteroPaneState` (Task 1); `attachPaneResizer` (Task 2); `KeyRail.resizer/setWidth/setCollapsed/isCollapsed`, `KeyRailOptions.onCollapsedChange` (Task 3).
- Produces: nothing new for later tasks.

- [ ] **Step 1: Remove the prefs**

In `src/services/citationPreferences.ts` delete the six functions `getDetailPanelWidth`, `setDetailPanelWidth`, `getDetailPanelCollapsed`, `setDetailPanelCollapsed`, `getKeyRailCollapsed`, `setKeyRailCollapsed` (lines 168-190).

In `addon/prefs.js` delete:

```js
pref("__prefsPrefix__.detailPanelWidth", 360);
pref("__prefsPrefix__.detailPanelCollapsed", false);
```

Run `npm run typecheck`. Expected: errors in `graphViewService.ts` only, on the removed imports and their uses. That is the list of sites the next steps replace.

- [ ] **Step 2: Swap the imports**

In `src/services/graphViewService.ts`, remove `getDetailPanelCollapsed`, `getDetailPanelWidth`, `setDetailPanelCollapsed`, `setDetailPanelWidth` from the `./citationPreferences` import. Add:

```ts
import { attachPaneResizer } from "./graphViewControls";
import {
  bindZoteroPane,
  PANE_MINIMUM,
  type ZoteroPaneState,
} from "./zoteroPaneSync";
```

(If `./graphViewControls` is already imported for `element`/`text`, add `attachPaneResizer` to that import instead of a second statement.)

- [ ] **Step 3: Bind the panes where the detail shell is built**

Replace the block from `const initialWidth = clamp(` through `detailShell.dataset.collapsed = String(collapsed);` (~1064-1073) with:

```ts
  // Width and collapse for both side panes belong to Zotero's own panes: the
  // collections pane on the left, the item pane on the right. The graph draws
  // what they say and writes back what its handles do.
  const hostWindow = document.defaultView as Window;
  const collectionsPane = bindZoteroPane("collections", hostWindow);
  const itemPane = bindZoteroPane("item", hostWindow);

  const applyDetailState = (state: ZoteroPaneState): void => {
    detailShell.dataset.collapsed = String(state.collapsed);
    detailShell.style.width = state.collapsed
      ? COLLAPSED_DETAIL_WIDTH
      : `${Math.round(state.width)}px`;
  };
  applyDetailState(itemPane.read());
```

Then change `createKeyRail({ document, onEmphasise: … })` to also pass:

```ts
    onCollapsedChange: (collapsed) => collectionsPane.setCollapsed(collapsed),
```

and right after `const keyRail = createKeyRail({ … });` add:

```ts
  {
    const state = collectionsPane.read();
    keyRail.setWidth(state.width);
    keyRail.setCollapsed(state.collapsed);
  }
  const unsubscribeCollectionsPane = collectionsPane.subscribe((state) => {
    keyRail.setWidth(state.width);
    keyRail.setCollapsed(state.collapsed);
  });
  const unsubscribeItemPane = itemPane.subscribe((state) => {
    applyDetailState(state);
    syncDetailToggle();
  });
```

`syncDetailToggle` is a function declaration later in the same function body, so it is hoisted and callable here.

- [ ] **Step 4: Replace the detail pane's toggle and resizer code**

Replace the block from `function setDetailCollapsed(next: boolean): void {` through the `detailToggle.addEventListener("click", …)` call (~4273-4312) with:

```ts
  function setDetailCollapsed(next: boolean): void {
    applyDetailState({ width: itemPane.read().width, collapsed: next });
    itemPane.setCollapsed(next);
    syncDetailToggle();
  }

  const detachDetailResizer = attachPaneResizer({
    handle: resizer,
    edge: "end",
    minimum: PANE_MINIMUM.item,
    maximum: () => Math.max(PANE_MINIMUM.item, root.getBoundingClientRect().width * 0.7),
    collapseThreshold: 60,
    origin: () => root.getBoundingClientRect().right,
    onBegin: () => itemPane.beginLocalChange(),
    onMove: (width) => {
      applyDetailState({ width, collapsed: false });
      itemPane.write(width);
    },
    onRelease: (release) => {
      if (release.kind === "collapse") setDetailCollapsed(true);
      else itemPane.write(release.width);
    },
    onEnd: () => {
      itemPane.endLocalChange();
      syncDetailToggle();
    },
    onToggle: () => setDetailCollapsed(detailShell.dataset.collapsed !== "true"),
  });
  detailToggle.addEventListener("click", () => {
    setDetailCollapsed(detailShell.dataset.collapsed !== "true");
  });

  const detachRailResizer = attachPaneResizer({
    handle: keyRail.resizer,
    edge: "start",
    minimum: PANE_MINIMUM.collections,
    maximum: () =>
      Math.max(PANE_MINIMUM.collections, root.getBoundingClientRect().width * 0.5),
    collapseThreshold: 60,
    origin: () => keyRail.root.getBoundingClientRect().left,
    onBegin: () => collectionsPane.beginLocalChange(),
    onMove: (width) => {
      keyRail.setWidth(width);
      collectionsPane.write(width);
    },
    onRelease: (release) => {
      if (release.kind === "collapse") {
        keyRail.setCollapsed(true);
        collectionsPane.setCollapsed(true);
      } else {
        collectionsPane.write(release.width);
      }
    },
    onEnd: () => collectionsPane.endLocalChange(),
    onToggle: () => {
      const next = !keyRail.isCollapsed();
      keyRail.setCollapsed(next);
      collectionsPane.setCollapsed(next);
    },
  });
```

Keep the `syncDetailToggle();` call that followed the old block. Delete the old `let resizing = false;` / `const resize = …` code and the four `resizer.addEventListener` calls; nothing else should reference `resizing`. The `renderer?.resizeViewport()` calls that were in `setDetailCollapsed` and `resize` are gone on purpose: the renderer's own `ResizeObserver` on the plot container already coalesces to one resize per frame.

Grep for remaining uses: `grep -n "getDetailPanelWidth\|setDetailPanelWidth\|DetailPanelCollapsed\|KeyRailCollapsed\|resizing" src/services/graphViewService.ts` must print nothing.

- [ ] **Step 5: Dispose on cleanup**

In the `cleanup` function, before `keyRail.destroy();` add:

```ts
    detachRailResizer();
    detachDetailResizer();
    unsubscribeCollectionsPane();
    unsubscribeItemPane();
    collectionsPane.dispose();
    itemPane.dispose();
```

- [ ] **Step 6: Typecheck, lint, tests**

Run: `npm run check`
Expected: pass. Common failures and their fixes: an unused `clamp` import (leave it if still used at other sites, otherwise remove); `COLLAPSED_DETAIL_WIDTH` unused (it is used by `applyDetailState`, so it must not be); `document.defaultView` typed as `Window | null` (the cast above handles it).

- [ ] **Step 7: Commit**

```bash
git add src/services/graphViewService.ts src/services/citationPreferences.ts addon/prefs.js
git commit -m "Let the graph's side panes follow Zotero's, and Zotero's follow the graph's

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa"
```

---

### Task 5: Manual check in Zotero and rail width audit

**Files:**
- Possibly modify: `addon/content/graph.css` (identity row overflow at narrow and wide rails)

**Interfaces:** none.

- [ ] **Step 1: Build and run**

Run: `npm start` (starts Zotero with the plugin loaded via `zotero-plugin serve`). Open a Collection Graph tab and an Explore view.

- [ ] **Step 2: Walk the checklist**

In a graph tab:

1. Drag Zotero's collections splitter in the library tab, switch to the graph: the rail is the same width.
2. Drag the rail's handle quickly back and forth: Zotero's collections pane follows in the library tab, no jitter, no console error mentioning `ResizeObserver`.
3. Drag the detail pane's handle: Zotero's item pane follows. Drag Zotero's items splitter: the detail pane follows.
4. Collapse the collections pane from Zotero's View menu: the rail collapses to its 28px strip. Reopen from the rail's toggle: Zotero's pane reopens at the rail's width.
5. Collapse the item pane with Zotero's toolbar button, reopen from the graph's 36px strip.
6. Drag the rail's handle far left past 200px and release: both collapse. Double-click the handle: both reopen.
7. Open a second graph tab, drag in one, check the other.

In a detached window (open one from the graph's window control): with the main window open, repeat 1 to 3. Close the main window if Zotero allows it, open a detached graph, resize: no errors, and the widths stick within that window.

Quit Zotero, relaunch, open the library and a graph: both come back at the last widths.

Check the rail at 200px and at 500px: the identity row in the rail's toolbar must not overflow or clip its text badly; adjust `graph.css` rules for `.cm-command-identity` if it does.

- [ ] **Step 3: Record what was found**

If any CSS change was needed, commit it:

```bash
git add addon/content/graph.css
git commit -m "Keep the rail's identity row tidy at every width

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa"
```

If a checklist item fails, fix it in the task that owns the code (binding: Task 1 file; handle: Task 2; rail: Task 3; wiring: Task 4), with a unit test where the module has one, and commit with a message naming what was wrong.

- [ ] **Step 4: Update the spec status**

In `docs/superpowers/specs/2026-09-03-zotero-pane-sync-design.md` change `Status: designed` to `Status: implemented` and commit:

```bash
git add docs/superpowers/specs/2026-09-03-zotero-pane-sync-design.md
git commit -m "Mark the pane sync design as implemented

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa"
```
