import { describe, it } from "node:test";
import { expect } from "chai";
import type { GraphLayoutOptions } from "../../src/domain/graphTypes";
import { createAxesAppearance } from "../../src/services/graphViewControls";
import { node } from "./graphRendererDoubles";

/*
 * Just enough DOM for the gear to build its panel: elements that hold
 * classes, attributes, text and children, and selects that hold a value
 * among their options. Nothing is laid out and no event is dispatched.
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
  setAttribute(): void {}
  addEventListener(): void {}
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
    const persisted: GraphLayoutOptions[] = [];
    const gear = createAxesAppearance(
      fakeDocument,
      SAVED,
      [],
      () => {},
      (layout) => persisted.push(layout),
      () => SAVED,
    );
    expect(gear.getLayout().xMetric).to.equal("free");
    expect(gear.getLayout().yMetric).to.equal("free");
    expect(persisted, "the saved appearance was overwritten").to.deep.equal([]);
  });

  it("shows the saved appearance where the papers carry it", () => {
    const persisted: GraphLayoutOptions[] = [];
    const gear = createAxesAppearance(
      fakeDocument,
      SAVED,
      [node("a", { year: 2020, citationCount: 4 })],
      () => {},
      (layout) => persisted.push(layout),
      () => SAVED,
    );
    expect(gear.getLayout()).to.deep.equal(SAVED);
    expect(persisted).to.deep.equal([]);
  });
});
