import { describe, it } from "node:test";
import { expect } from "chai";
import type { SavedGraphSummary } from "../../src/services/savedGraphService";
import {
  SAVED_GRAPH_DYNAMIC_ATTR,
  fillSavedGraphPopup,
  hasSavedGraphRows,
  type SavedGraphMenuHost,
  type SavedGraphMenuNode,
} from "../../src/services/savedGraphMenu";

type Listener = () => void;

class FakeNode implements SavedGraphMenuNode {
  hidden = false;
  attributes = new Map<string, string>();
  listeners = new Map<string, Listener[]>();
  parent: FakePopup | null = null;
  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  remove(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  fire(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

class FakePopup {
  children: FakeNode[] = [];
  listeners = new Map<string, Listener[]>();
  append(...nodes: SavedGraphMenuNode[]): void {
    for (const node of nodes as FakeNode[]) {
      node.remove();
      node.parent = this;
      this.children.push(node);
    }
  }
  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  fire(type: string): void {
    const listeners = this.listeners.get(type) ?? [];
    this.listeners.delete(type);
    for (const listener of listeners) listener();
  }
  rows(): FakeNode[] {
    return this.children.filter((c) =>
      c.hasAttribute(SAVED_GRAPH_DYNAMIC_ATTR),
    );
  }
  labels(): string[] {
    return this.rows().map((row) => row.attributes.get("label")!);
  }
}

const graph = (id: number, name: string): SavedGraphSummary => ({
  id,
  libraryID: 1,
  name,
  created: "2026-09-01T00:00:00Z",
  modified: "2026-09-08T00:00:00Z",
});

function host(
  graphs: SavedGraphSummary[] | Error,
  opened: SavedGraphSummary[] = [],
): SavedGraphMenuHost {
  return {
    list: () =>
      graphs instanceof Error
        ? Promise.reject(graphs)
        : Promise.resolve(graphs),
    createRow: () => new FakeNode(),
    open: (g) => {
      opened.push(g);
    },
    formatModified: (iso) => iso.slice(0, 10),
  };
}

/** The declared "No saved graphs yet." entry, as Zotero creates it. */
function withStaticEntry(popup: FakePopup): FakeNode {
  const entry = new FakeNode();
  popup.append(entry);
  return entry;
}

describe("fillSavedGraphPopup", function () {
  it("lists the graphs on the first showing, before Zotero has created the static entry", async function () {
    // Zotero's MenuManager runs a submenu's onShowing when the parent popup
    // shows, and only creates the submenu's declared children when the
    // submenu itself first opens. On the first showing the popup is empty.
    const popup = new FakePopup();
    await fillSavedGraphPopup(
      popup,
      host([graph(1, "Alpha"), graph(2, "Beta")]),
    );
    expect(popup.labels()).to.deep.equal(["Alpha", "Beta"]);
  });

  it("lists the graphs and hides the static entry when it exists", async function () {
    const popup = new FakePopup();
    const entry = withStaticEntry(popup);
    await fillSavedGraphPopup(popup, host([graph(1, "Alpha")]));
    expect(popup.labels()).to.deep.equal(["Alpha"]);
    expect(entry.hidden).to.equal(true);
    expect(popup.rows()[0].attributes.get("acceltext")).to.equal("2026-09-08");
  });

  it("shows the static entry when there are no graphs", async function () {
    const popup = new FakePopup();
    const entry = withStaticEntry(popup);
    await fillSavedGraphPopup(popup, host([]));
    expect(popup.rows()).to.have.length(0);
    expect(entry.hidden).to.equal(false);
  });

  it("removes stale rows before listing and again when the popup hides", async function () {
    const popup = new FakePopup();
    withStaticEntry(popup);
    await fillSavedGraphPopup(popup, host([graph(1, "Alpha")]));
    await fillSavedGraphPopup(popup, host([graph(2, "Beta")]));
    expect(popup.labels()).to.deep.equal(["Beta"]);
    popup.fire("popuphidden");
    expect(popup.rows()).to.have.length(0);
  });

  it("opens the graph of the row that is commanded", async function () {
    const popup = new FakePopup();
    const opened: SavedGraphSummary[] = [];
    await fillSavedGraphPopup(popup, host([graph(7, "Seven")], opened));
    popup.rows()[0].fire("command");
    expect(opened.map((g) => g.id)).to.deep.equal([7]);
  });

  it("puts the static entry back and rethrows when listing fails", async function () {
    const popup = new FakePopup();
    const entry = withStaticEntry(popup);
    entry.hidden = true;
    let caught: unknown = null;
    await fillSavedGraphPopup(popup, host(new Error("no db"))).catch((e) => {
      caught = e;
    });
    expect(caught).to.be.instanceOf(Error);
    expect(entry.hidden).to.equal(false);
  });
});

describe("hasSavedGraphRows", function () {
  it("is false for an empty popup and for the static entry alone", async function () {
    const popup = new FakePopup();
    expect(hasSavedGraphRows(popup)).to.equal(false);
    withStaticEntry(popup);
    expect(hasSavedGraphRows(popup)).to.equal(false);
  });

  it("is true once a row has been injected", async function () {
    const popup = new FakePopup();
    await fillSavedGraphPopup(popup, host([graph(1, "Alpha")]));
    expect(hasSavedGraphRows(popup)).to.equal(true);
  });
});
