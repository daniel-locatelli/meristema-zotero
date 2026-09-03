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
      cb: Callback;
      constructor(cb: Callback) {
        this.cb = cb;
      }
      observe(): void {
        registry.resize.push(this.cb);
      }
      disconnect(): void {
        registry.disconnected += 1;
      }
    };
  MutationObserver = (registry: FakeObserverRegistry) =>
    class {
      cb: Callback;
      constructor(cb: Callback) {
        this.cb = cb;
      }
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

function fixture(
  options: { itemPaneSetter?: boolean; layout?: boolean } = {},
): Fixture {
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

function collect(binding: {
  subscribe(l: (s: ZoteroPaneState) => void): () => void;
}): ZoteroPaneState[] {
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

  it("resumes hearing about a width equal to the last write once Zotero moves away from it", function () {
    const f = fixture();
    f.pane.rectWidth = 200;
    const binding = bindZoteroPane("collections", f.win, f.deps);
    const seen = collect(binding);
    binding.write(300);
    f.pane.rectWidth = 400;
    f.observers.fire();
    expect(seen).to.have.length(1);
    f.pane.rectWidth = 300;
    f.observers.fire();
    expect(seen).to.have.length(2);
    expect(seen[1]).to.deep.equal({ width: 300, collapsed: false });
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

  it("reports the pane's real state when Zotero refuses to collapse it", function () {
    const f = fixture();
    f.pane.rectWidth = 400;
    (
      f.win as unknown as { ZoteroPane: { itemPane: { collapsed: boolean } } }
    ).ZoteroPane.itemPane = {
      set collapsed(_value: boolean) {
        throw new Error("Zotero said no");
      },
      get collapsed(): boolean {
        return false;
      },
    };
    const binding = bindZoteroPane("item", f.win, f.deps);
    const seen = collect(binding);
    binding.setCollapsed(true);
    expect(binding.read()).to.deep.equal({ width: 400, collapsed: false });
    expect(seen).to.deep.equal([{ width: 400, collapsed: false }]);
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
    const host = {
      document: { getElementById: () => null },
    } as unknown as Window;
    f.deps.mainWindows = () => [f.win];
    const binding = bindZoteroPane("collections", host, f.deps);
    expect(binding.read().width).to.equal(270);
  });

  it("falls back to a detached binding when no pane exists anywhere", function () {
    const host = {
      document: { getElementById: () => null },
    } as unknown as Window;
    const debugLines: string[] = [];
    const binding = bindZoteroPane("collections", host, {
      mainWindows: () => [],
      persistPref: () =>
        JSON.stringify({ "zotero-collections-pane": { width: "222" } }),
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

  it("falls back to a detached binding when Zotero itself throws at bind time", function () {
    const host = {
      document: { getElementById: () => null },
    } as unknown as Window;
    const debugLines: string[] = [];
    const angry = () => {
      throw new Error("Zotero is not ready");
    };
    let binding: ReturnType<typeof bindZoteroPane> | null = null;
    expect(() => {
      binding = bindZoteroPane("item", host, {
        mainWindows: angry,
        persistPref: () => null,
        debug: (line) => debugLines.push(line),
      });
    }).not.to.throw();
    expect(binding!.read()).to.deep.equal({
      width: PANE_REOPEN_WIDTH.item,
      collapsed: false,
    });
    expect(debugLines).to.have.length(1);
    expect(() =>
      bindZoteroPane("item", host, {
        mainWindows: angry,
        persistPref: () => null,
        debug: angry,
      }),
    ).not.to.throw();
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
