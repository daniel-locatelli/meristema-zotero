import { describe, it } from "node:test";
import { expect } from "chai";
import { SHIPPED_GRAPH_VIEWS } from "../../src/services/graphViews";
import {
  createGraphViewsMenu,
  createSavePanel,
} from "../../src/services/graphViewsMenu";

/*
 * Just enough DOM for the View dropdown to build its rows: elements that hold
 * classes, attributes, text and children, and nothing that lays them out.
 */
class FakeElement {
  className = "";
  hidden = false;
  type = "";
  title = "";
  id = "";
  value = "";
  disabled = false;
  checked = false;
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  children: FakeElement[] = [];
  private ownText = "";
  private attributes = new Map<string, string>();
  get classList() {
    return {
      add: (...names: string[]) => {
        this.className = [...this.className.split(" "), ...names]
          .filter(Boolean)
          .join(" ");
      },
      contains: (name: string) => this.className.split(" ").includes(name),
    };
  }
  get textContent(): string {
    return this.ownText + this.children.map((c) => c.textContent).join("");
  }
  set textContent(value: string) {
    this.ownText = value;
    this.children = [];
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  append(...nodes: FakeElement[]): void {
    this.children.push(...nodes);
  }
  appendChild(node: FakeElement): FakeElement {
    this.children.push(node);
    return node;
  }
  replaceChildren(...nodes: FakeElement[]): void {
    this.children = [...nodes];
  }
  private listeners = new Map<string, Array<(event: unknown) => void>>();
  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  click(): void {
    for (const listener of this.listeners.get("click") ?? []) {
      listener({ stopPropagation: () => {} });
    }
  }
  focus(): void {}
  select(): void {}
  all(className: string): FakeElement[] {
    return this.children.flatMap((child) => [
      ...(child.classList.contains(className) ? [child] : []),
      ...child.all(className),
    ]);
  }
  one(className: string): FakeElement {
    const found = this.all(className)[0];
    expect(found, `a .${className}`).to.exist;
    return found as FakeElement;
  }
}

const fakeDocument = {
  createElementNS: () => new FakeElement(),
} as unknown as Document;

function openMenu(
  activeID: string | null,
  onCopyCurrent: () => void = () => {},
): FakeElement {
  const menu = createGraphViewsMenu({
    document: fakeDocument,
    shipped: SHIPPED_GRAPH_VIEWS,
    listSaved: () => [],
    onChoose: () => {},
    onEdit: () => {},
    onSaveCurrent: () => {},
    onCopyCurrent,
    onImport: () => {},
    onOpenGallery: () => {},
  });
  menu.setActive(activeID);
  menu.open();
  return menu.menu as unknown as FakeElement;
}

function rowFor(menu: FakeElement, id: string): FakeElement {
  const row = menu.all("cm-view-row").find((r) => r.dataset.viewId === id);
  expect(row, `a row for ${id}`).to.exist;
  return row as FakeElement;
}

describe("the View dropdown's rows (D18)", function () {
  it("marks the active view by its state, not by a check mark", function () {
    const menu = openMenu("cornerstones");
    const active = rowFor(menu, "cornerstones");
    expect(active.getAttribute("role")).to.equal("menuitemradio");
    expect(active.getAttribute("aria-checked")).to.equal("true");
    expect(rowFor(menu, "overview").getAttribute("aria-checked")).to.equal(
      "false",
    );
    expect(menu.all("cm-view-row-tick"), "no tick element").to.have.length(0);
    expect(menu.textContent, "no check glyph").not.to.include("✓");
  });

  it("puts the status on the name's line and the description under both", function () {
    const row = rowFor(openMenu(null), "cornerstones");
    const body = row.one("cm-view-row-body");
    const [head, summary] = body.children;
    expect(head?.classList.contains("cm-view-row-head")).to.equal(true);
    expect(
      head?.children.map((c) => c.className),
      "the name, then its status",
    ).to.deep.equal(["cm-view-row-name", "cm-view-row-note"]);
    expect(head?.one("cm-view-row-note").textContent).to.equal("needs a seed");
    expect(summary?.className).to.equal("cm-view-row-summary");
    expect(
      row.children.filter((c) => c.classList.contains("cm-view-row-note")),
      "the status is no longer a column of its own",
    ).to.have.length(0);
  });

  it("gives a row with no status a head holding the name alone", function () {
    const head = rowFor(openMenu(null), "overview").one("cm-view-row-head");
    expect(head.children.map((c) => c.className)).to.deep.equal([
      "cm-view-row-name",
    ]);
  });
});

describe("the View dropdown's actions (D31)", function () {
  it("puts Copy current as JSON directly under Save current as view…", function () {
    const labels = openMenu(null)
      .all("cm-view-action")
      .map((action) => action.textContent);
    expect(labels).to.deep.equal([
      "Save current as view…",
      "Copy current as JSON",
      "Import view JSON…",
      "Choose a view…",
    ]);
  });

  it("copies from the row without opening the save panel", function () {
    let copies = 0;
    const menu = openMenu(null, () => {
      copies += 1;
    });
    const action = menu
      .all("cm-view-action")
      .find((a) => a.textContent === "Copy current as JSON");
    action?.click();
    expect(copies).to.equal(1);
  });
});

describe("the save panel's Copy JSON (D31)", function () {
  const openPanel = (existing: boolean): FakeElement => {
    const panel = createSavePanel(fakeDocument);
    panel.open({
      name: "A view",
      paragraph: "",
      captures: { regions: 0, filters: true, explore: null },
      existing: existing ? (SHIPPED_GRAPH_VIEWS[0] ?? null) : null,
      nameTaken: () => false,
      onCopyJSON: () => {},
      onSave: () => {},
      onDelete: null,
    });
    return panel.root as unknown as FakeElement;
  };
  const copyButton = (root: FakeElement): FakeElement | undefined =>
    root
      .all("cm-secondary-button")
      .find((button) => button.textContent === "Copy JSON");

  it("hides it while saving the current state", function () {
    expect(copyButton(openPanel(false))?.hidden).to.equal(true);
  });

  it("shows it while editing a saved view", function () {
    expect(copyButton(openPanel(true))?.hidden).to.equal(false);
  });
});
