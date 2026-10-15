import { describe, it } from "node:test";
import { expect } from "chai";
import type { GraphLayoutOptions } from "../../src/domain/graphTypes";
import {
  createAxesAppearance,
  type AppearanceDefaults,
} from "../../src/services/graphViewControls";
import { node } from "./graphRendererDoubles";

/*
 * Just enough DOM for the gear to build its panel: elements that hold
 * classes, attributes, text and children, selects that hold a value among
 * their options, and listeners a test fires by hand. Nothing is laid out.
 */
class FakeElement {
  className = "";
  hidden = false;
  disabled = false;
  type = "";
  title = "";
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  children: FakeElement[] = [];
  textContent = "";
  private ownValue = "";
  private selected: FakeElement | null = null;
  private explicit = false;
  readonly tagName: string;
  constructor(tagName: string) {
    this.tagName = tagName;
  }
  get classList() {
    return {
      add: (...names: string[]) => {
        this.className = [...this.className.split(" "), ...names]
          .filter(Boolean)
          .join(" ");
      },
    };
  }
  get firstElementChild(): FakeElement | null {
    return this.children[0] ?? null;
  }
  get options(): FakeElement[] {
    return this.children.filter((child) => child.tagName === "option");
  }
  get selectedOptions(): FakeElement[] {
    const chosen = this.chosen();
    return chosen ? [chosen] : [];
  }
  get value(): string {
    if (this.tagName !== "select") return this.ownValue;
    return this.chosen()?.ownValue ?? "";
  }
  set value(value: string) {
    if (this.tagName !== "select") {
      this.ownValue = value;
      return;
    }
    this.explicit = true;
    this.selected = this.options.find((o) => o.ownValue === value) ?? null;
  }
  private chosen(): FakeElement | null {
    if (this.explicit) return this.selected;
    return this.options.find((option) => !option.disabled) ?? null;
  }
  private listeners = new Map<string, Array<() => void>>();
  setAttribute(): void {}
  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  fire(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
  /** Every element under this one, depth first. */
  descendants(): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }
  append(...nodes: FakeElement[]): void {
    this.children.push(...nodes);
  }
  appendChild(node: FakeElement): FakeElement {
    this.children.push(node);
    return node;
  }
  prepend(node: FakeElement): void {
    this.children.unshift(node);
  }
  querySelector(selector: string): FakeElement | null {
    const match = /^option\[(value|data-metric)="([^"]+)"\]$/.exec(selector);
    if (!match) throw new Error(`unsupported selector ${selector}`);
    const [, attribute, wanted] = match;
    return (
      this.options.find((option) =>
        attribute === "value"
          ? option.ownValue === wanted
          : option.dataset.metric === wanted,
      ) ?? null
    );
  }
}

const fakeDocument = {
  createElementNS: (_namespace: string, tag: string) => new FakeElement(tag),
} as unknown as Document;

const SAVED: GraphLayoutOptions = {
  xMetric: "year",
  xScale: "linear",
  yMetric: "citations",
  yScale: "linear",
  nodeSizeMetric: "citations",
  nodeColorMetric: "uniform",
  nodeLabelMode: "author-year",
};

const BUILT_IN: GraphLayoutOptions = {
  ...SAVED,
  nodeColorMetric: "publication-type",
};

/** The stored default, kept in memory: `persisted` is every write. */
function fakeDefaults(initiallyStored: boolean): {
  defaults: AppearanceDefaults;
  persisted: GraphLayoutOptions[];
  forgotten: () => number;
} {
  const persisted: GraphLayoutOptions[] = [];
  let stored: GraphLayoutOptions | null = initiallyStored ? SAVED : null;
  let forgets = 0;
  return {
    persisted,
    forgotten: () => forgets,
    defaults: {
      current: () => stored ?? BUILT_IN,
      stored: () => stored !== null,
      make: (layout) => {
        persisted.push(layout);
        stored = layout;
      },
      forget: () => {
        forgets += 1;
        stored = null;
        return BUILT_IN;
      },
    },
  };
}

/**
 * The gear lists only the metrics the loaded papers carry, so a graph with
 * no year or count shows Free axes. That is what this graph can show, not a
 * choice the reader made: opening it must leave the saved appearance alone,
 * or every graph opened after it starts on Free axes too. The Zotero suite's
 * empty-library case did exactly that to the folder-region case after it,
 * whose plot then had no frame or axes to paint.
 */
describe("The gear's appearance on opening", () => {
  it("shows Free axes on a graph without data, and saves nothing", () => {
    const { defaults, persisted } = fakeDefaults(false);
    const gear = createAxesAppearance(
      fakeDocument,
      SAVED,
      [],
      () => {},
      defaults,
    );
    expect(gear.getLayout().xMetric).to.equal("free");
    expect(gear.getLayout().yMetric).to.equal("free");
    expect(persisted, "the saved appearance was overwritten").to.deep.equal([]);
  });

  it("shows the saved appearance where the papers carry it", () => {
    const { defaults, persisted } = fakeDefaults(false);
    const gear = createAxesAppearance(
      fakeDocument,
      SAVED,
      [node("a", { year: 2020, citationCount: 4 })],
      () => {},
      defaults,
    );
    expect(gear.getLayout()).to.deep.equal(SAVED);
    expect(persisted).to.deep.equal([]);
  });
});

/** The papers carry what every layout below asks for. */
const RICH = [
  node("a", {
    year: 2020,
    citationCount: 4,
    publicationType: "journal-article",
    provider: "openalex",
  }),
];

function buttonReading(
  gear: { root: HTMLDivElement },
  label: string,
): FakeElement {
  const found = (gear.root as unknown as FakeElement)
    .descendants()
    .find((el) => el.tagName === "button" && el.textContent === label);
  if (!found) throw new Error(`no button reading ${label}`);
  return found;
}

function colourSelect(gear: { root: HTMLDivElement }): FakeElement {
  const found = (gear.root as unknown as FakeElement)
    .descendants()
    .find(
      (el) =>
        el.tagName === "select" &&
        el.options.some((option) => option.value === "publication-type"),
    );
  if (!found) throw new Error("no colour select");
  return found;
}

/**
 * D17: a gear edit stays with its graph. The stored default changes only
 * through "Use for new blank graphs", and "Restore built-in blank graph" is there
 * only while a made default exists.
 */
describe("The gear's default", () => {
  it("keeps an edit with the graph and stores nothing", () => {
    const { defaults, persisted } = fakeDefaults(false);
    const changes: GraphLayoutOptions[] = [];
    const gear = createAxesAppearance(
      fakeDocument,
      BUILT_IN,
      RICH,
      (layout) => changes.push(layout),
      defaults,
    );
    const select = colourSelect(gear);
    select.value = "provider";
    select.fire("change");
    expect(changes.map((layout) => layout.nodeColorMetric)).to.deep.equal([
      "provider",
    ]);
    expect(persisted, "a gear edit stored a default").to.deep.equal([]);
  });

  it("stores the graph's settings on Use for new blank graphs, then offers the way back", () => {
    const { defaults, persisted } = fakeDefaults(false);
    const gear = createAxesAppearance(
      fakeDocument,
      BUILT_IN,
      RICH,
      () => {},
      defaults,
    );
    const back = buttonReading(gear, "Restore built-in blank graph");
    expect(back.hidden, "no made default, no way back").to.equal(true);
    const select = colourSelect(gear);
    select.value = "provider";
    select.fire("change");
    buttonReading(gear, "Use for new blank graphs").fire("click");
    expect(persisted).to.deep.equal([
      { ...BUILT_IN, nodeColorMetric: "provider" },
    ]);
    expect(back.hidden).to.equal(false);
  });

  it("forgets a made default on Restore built-in blank graph and shows the built-in one", () => {
    const { defaults, forgotten } = fakeDefaults(true);
    const changes: GraphLayoutOptions[] = [];
    const gear = createAxesAppearance(
      fakeDocument,
      SAVED,
      RICH,
      (layout) => changes.push(layout),
      defaults,
    );
    const back = buttonReading(gear, "Restore built-in blank graph");
    expect(back.hidden, "a made default offers the way back").to.equal(false);
    back.fire("click");
    expect(forgotten()).to.equal(1);
    expect(gear.getLayout()).to.deep.equal(BUILT_IN);
    expect(changes.at(-1)).to.deep.equal(BUILT_IN);
    expect(back.hidden).to.equal(true);
  });

  it("puts the graph back on the default with Reset, storing nothing", () => {
    const { defaults, persisted, forgotten } = fakeDefaults(true);
    const gear = createAxesAppearance(
      fakeDocument,
      BUILT_IN,
      RICH,
      () => {},
      defaults,
    );
    buttonReading(gear, "Reset").fire("click");
    expect(gear.getLayout()).to.deep.equal(SAVED);
    expect(persisted).to.deep.equal([]);
    expect(forgotten()).to.equal(0);
  });
});

function sourceLine(gear: { root: HTMLDivElement }): FakeElement {
  const found = (gear.root as unknown as FakeElement)
    .descendants()
    .find((el) => el.className.split(" ").includes("cm-appearance-source"));
  if (!found) throw new Error("no source line");
  return found;
}

/*
 * D28: the gear names the view its settings came from, so a reader who
 * applied Overview and then pressed "Use for new blank graphs" can see
 * that Overview itself is untouched.
 */
describe("The gear's source line", () => {
  const gearOn = () =>
    createAxesAppearance(
      fakeDocument,
      BUILT_IN,
      RICH,
      () => {},
      fakeDefaults(false).defaults,
    );

  it("says nothing on a graph no view was applied to", () => {
    const line = sourceLine(gearOn());
    expect(line.hidden).to.equal(true);
  });

  it("names the view, and says so once the settings moved from it", () => {
    const gear = gearOn();
    gear.setSource({ name: "Overview", edited: false });
    expect(sourceLine(gear).hidden).to.equal(false);
    expect(sourceLine(gear).textContent).to.equal("From view: Overview");
    gear.setSource({ name: "Overview", edited: true });
    expect(sourceLine(gear).textContent).to.equal("Edited from view: Overview");
    gear.setSource(null);
    expect(sourceLine(gear).hidden).to.equal(true);
  });
});
