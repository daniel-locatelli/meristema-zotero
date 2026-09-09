/// <reference lib="dom" />
/**
 * The Key rail: the graph saying, in words, what it is drawing.
 *
 * `graphKeyModel.ts` decides *what* to say; this decides how it looks and what
 * happens when you point at it. Two rules from the spec are load-bearing here:
 *
 * The Key never filters. Hovering or pinning an entry emphasises the papers it
 * covers and dims the rest; nothing is removed, no count changes, and no export
 * differs. Filtering has its own home in the filter panel. If Key clicks ever
 * start routing through `PaperFilterController` or `setVisibleKeys`, that is
 * this decision being reversed by accident.
 *
 * Only an entry that stands for a set of papers is a button. A ramp and a link
 * colour describe how the graph draws rather than which papers it drew, so they
 * render as plain rows: a focusable control that does nothing when pressed is
 * worse than no control.
 */
import { element, text } from "./graphViewControls";
import { createIcon, PANE_TOGGLE_ICON_SIZE } from "./uiIconService";
import type { KeyEntry, KeyMark, KeyModel, KeySection } from "./graphKeyModel";
import type {
  ScopeRailModel,
  ScopeRow,
  ScopeSeedRow,
} from "./graphScopeRailModel";

/**
 * One emphasis, whatever raised it. Scope adds a second source of hover to a
 * rail that had only the Key's, and two sources writing the same plot state is
 * how a highlight gets stranded when the pointer crosses quickly from a Seeds
 * row to a Key entry. Raising one clears the last.
 */
export type RailEmphasis =
  | { kind: "key"; entry: KeyEntry }
  | { kind: "seed"; seedKey: string }
  | { kind: "collection"; collectionID: number };

const SVG_NS = "http://www.w3.org/2000/svg";

/** Gradient ids have to be unique within a document, and rails can coexist. */
let markSequence = 0;

function svg(document: Document, tag: string): SVGElement {
  return document.createElementNS(SVG_NS, tag) as SVGElement;
}

function markElement(document: Document, mark: KeyMark): SVGElement {
  const root = svg(document, "svg");
  root.setAttribute("viewBox", "0 0 20 20");
  root.setAttribute("width", "20");
  root.setAttribute("height", "20");
  root.setAttribute("aria-hidden", "true");
  root.setAttribute("focusable", "false");
  const primary = mark.colors[0] ?? "currentColor";

  if (mark.kind === "ramp") {
    markSequence += 1;
    const id = `cm-key-ramp-${markSequence}`;
    const defs = svg(document, "defs");
    const gradient = svg(document, "linearGradient");
    gradient.setAttribute("id", id);
    gradient.setAttribute("x1", "0");
    gradient.setAttribute("x2", "1");
    gradient.setAttribute("y1", "0");
    gradient.setAttribute("y2", "0");
    mark.colors.forEach((color, index) => {
      const stop = svg(document, "stop");
      const offset =
        mark.colors.length > 1 ? index / (mark.colors.length - 1) : 0;
      stop.setAttribute("offset", `${Math.round(offset * 100)}%`);
      stop.setAttribute("stop-color", color);
      gradient.appendChild(stop);
    });
    defs.appendChild(gradient);
    const bar = svg(document, "rect");
    bar.setAttribute("x", "1");
    bar.setAttribute("y", "6");
    bar.setAttribute("width", "18");
    bar.setAttribute("height", "8");
    bar.setAttribute("rx", "2");
    bar.setAttribute("fill", `url(#${id})`);
    root.append(defs, bar);
    return root;
  }

  if (mark.kind === "circles") {
    // Three nested outlines: the smallest and largest node on screen, and the
    // step between them. The numbers beside the mark carry the values.
    for (const radius of [2.5, 5, 8]) {
      const circle = svg(document, "circle");
      circle.setAttribute("cx", "10");
      circle.setAttribute("cy", "10");
      circle.setAttribute("r", String(radius));
      circle.setAttribute("fill", "none");
      circle.setAttribute("stroke", primary);
      circle.setAttribute("stroke-width", "1");
      root.appendChild(circle);
    }
    return root;
  }

  if (mark.kind === "arrow") {
    const line = svg(document, "path");
    line.setAttribute("d", "M2 10h11");
    line.setAttribute("stroke", primary);
    line.setAttribute("stroke-width", "1.6");
    line.setAttribute("fill", "none");
    const head = svg(document, "path");
    head.setAttribute("d", "M13 6.5 18.5 10 13 13.5Z");
    head.setAttribute("fill", primary);
    root.append(line, head);
    return root;
  }

  const circle = svg(document, "circle");
  circle.setAttribute("cx", "10");
  circle.setAttribute("cy", "10");
  if (mark.kind === "ring") {
    circle.setAttribute("r", "7");
    circle.setAttribute("fill", "none");
    circle.setAttribute("stroke", primary);
    circle.setAttribute("stroke-width", "2");
  } else {
    circle.setAttribute("r", "6.5");
    circle.setAttribute("fill", mark.dashed ? "none" : primary);
    circle.setAttribute("stroke", primary);
    circle.setAttribute("stroke-width", "1.5");
  }
  if (mark.dashed) circle.setAttribute("stroke-dasharray", "3 2.5");
  root.appendChild(circle);
  return root;
}

const COUNT_FORMAT = new Intl.NumberFormat(undefined, { useGrouping: true });

export interface ScopeRailHandlers {
  /** A folder, Unfiled or Not in Zotero was ticked or unticked. */
  toggleRow(row: ScopeRow, ticked: boolean): void;
  /** A folder's row body was clicked, to draw or drop it as a region. */
  selectRow(row: ScopeRow, selected: boolean): void;
  removeSeed(seedKey: string): void;
  /** The reader asked for the seed search panel; the anchor is the link. */
  addSeed(anchor: HTMLElement): void;
  showAllHidden(): void;
}

export interface KeyRailOptions {
  document: Document;
  /**
   * Emphasise the papers an entry covers, or release with null. The rail never
   * decides what emphasis *means*; it only says which entry is being pointed at.
   */
  onEmphasise: (emphasis: RailEmphasis | null) => void;
  onScope: ScopeRailHandlers;
  /**
   * The rail's own toggle flipped it. Not called for `setCollapsed`, which is
   * how the view tells the rail about a change that came from elsewhere.
   */
  onCollapsedChange?: (collapsed: boolean) => void;
}

export interface KeyRail {
  root: HTMLElement;
  /**
   * The rail's toolbar, level with the plot's. It carries the collapse toggle
   * and whatever the view puts beside it — the counterpart of
   * `#zotero-toolbar-collection-tree`, which is where Zotero keeps the
   * controls that belong to its left pane.
   */
  toolbar: HTMLElement;
  /**
   * Where the view's own controls live. The zoom and appearance buttons used to
   * float over the plot's corners, covering the graph they were there to
   * adjust; the rail already owns the column beside it, and it collapses with
   * the rail when the reader wants the whole width for the graph.
   */
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
  /** Draw the Scope section, or pass null to leave the column Key-only. */
  renderScope(model: ScopeRailModel | null): void;
  /** The "+ Add seed" link. The view anchors the seed search panel to it. */
  addSeedAnchor(): HTMLElement;
  /** Drop any pinned emphasis — a background click, or Escape. */
  release(): void;
  destroy(): void;
}

export function createKeyRail(options: KeyRailOptions): KeyRail {
  const { document, onEmphasise } = options;
  const root = element(document, "aside", "cm-key-rail");
  root.setAttribute("aria-label", "Key");

  const toggle = element(document, "button", "cm-key-toggle");
  toggle.type = "button";
  /*
   * The rail's own toolbar, and the reason the rail starts where Zotero's
   * collections pane starts. Zotero has no bar spanning the window: it gives
   * each pane a toolbar of its own inside it, so the band across the top of
   * the library is two toolbars cut by the pane splitter. A single full-width
   * bar put the rail's top edge below where the collections tree begins, and
   * switching to the graph read as the whole layout dropping.
   */
  const toolbar = element(document, "div", "cm-rail-toolbar");
  toolbar.append(toggle);
  const body = element(document, "div", "cm-key-body");
  const scopeHost = element(document, "section", "cm-scope-section");
  scopeHost.setAttribute("aria-label", "Scope");
  scopeHost.hidden = true;
  const keyHost = element(document, "div", "cm-key-sections");
  body.append(scopeHost, keyHost);
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

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !pinned) return;
    release();
    event.stopPropagation();
  };
  root.addEventListener("keydown", onKeyDown);

  function entryRow(entry: KeyEntry): HTMLElement {
    const interactive = entry.matches !== null;
    const row = interactive
      ? element(document, "button", "cm-key-entry")
      : element(document, "div", "cm-key-entry cm-key-entry-static");
    row.appendChild(markElement(document, entry.mark));

    const label = text(document, "span", entry.label, "cm-key-entry-label");
    label.title = entry.label;
    row.appendChild(label);

    if (entry.detail) {
      row.appendChild(
        text(document, "span", entry.detail, "cm-key-entry-detail"),
      );
    }
    if (entry.count !== null) {
      row.appendChild(
        text(
          document,
          "span",
          COUNT_FORMAT.format(entry.count),
          "cm-key-entry-count",
        ),
      );
    }

    if (!interactive) return row;

    const button = row as HTMLButtonElement;
    button.type = "button";
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("pointerenter", () => {
      if (!pinned) onEmphasise({ kind: "key", entry });
    });
    button.addEventListener("pointerleave", () => {
      if (!pinned) onEmphasise(null);
    });
    button.addEventListener("focus", () => {
      if (!pinned) onEmphasise({ kind: "key", entry });
    });
    button.addEventListener("blur", () => {
      if (!pinned) onEmphasise(null);
    });
    button.addEventListener("click", () => {
      if (pinned === entry) {
        release();
        return;
      }
      pinnedButton?.setAttribute("aria-pressed", "false");
      pinned = entry;
      pinnedButton = button;
      button.setAttribute("aria-pressed", "true");
      onEmphasise({ kind: "key", entry });
    });
    return button;
  }

  const addSeedLink = element(document, "button", "cm-scope-add-seed");
  addSeedLink.type = "button";
  addSeedLink.textContent = "+ Add seed";
  addSeedLink.setAttribute("aria-haspopup", "dialog");
  addSeedLink.setAttribute("aria-expanded", "false");
  addSeedLink.addEventListener("click", () =>
    options.onScope.addSeed(addSeedLink),
  );

  function seedRow(seed: ScopeSeedRow): HTMLElement {
    const row = element(document, "div", "cm-scope-seed");
    const swatch = svg(document, "svg");
    swatch.setAttribute("viewBox", "0 0 20 20");
    swatch.setAttribute("width", "20");
    swatch.setAttribute("height", "20");
    swatch.setAttribute("aria-hidden", "true");
    swatch.setAttribute("focusable", "false");
    // A bullseye: a filled centre inside a ring with a gap, so it reads as a
    // different mark from the Key's plain swatch and from the in-library ring.
    for (const [radius, fill] of [
      [7, "none"],
      [3, seed.color],
    ] as const) {
      const circle = svg(document, "circle");
      circle.setAttribute("cx", "10");
      circle.setAttribute("cy", "10");
      circle.setAttribute("r", String(radius));
      circle.setAttribute("fill", fill);
      circle.setAttribute("stroke", seed.color);
      circle.setAttribute("stroke-width", "2");
      swatch.appendChild(circle);
    }
    const label = text(document, "span", seed.label, "cm-scope-seed-label");
    label.title = seed.label;
    const remove = element(document, "button", "cm-scope-seed-remove");
    remove.type = "button";
    remove.textContent = "×";
    remove.title = `Remove ${seed.label} as a seed`;
    remove.setAttribute("aria-label", remove.title);
    remove.addEventListener("click", () =>
      options.onScope.removeSeed(seed.key),
    );
    row.append(swatch, label, remove);
    row.addEventListener("pointerenter", () => {
      if (!pinned) options.onEmphasise({ kind: "seed", seedKey: seed.key });
    });
    row.addEventListener("pointerleave", () => {
      if (!pinned) options.onEmphasise(null);
    });
    return row;
  }

  function scopeRowElement(row: ScopeRow): HTMLElement {
    const wrapper = element(document, "div", "cm-scope-row");
    if (row.selected) {
      wrapper.classList.add("cm-scope-row-selected");
      if (row.color) wrapper.style.setProperty("--cm-row-color", row.color);
    }

    // The box keeps its own label so the checkbox still has a hit area of its
    // own and a name for a screen reader; the row's body is now a button.
    const boxLabel = element(document, "label", "cm-scope-check-label");
    const box = element(
      document,
      "input",
      "cm-scope-check",
    ) as HTMLInputElement;
    box.type = "checkbox";
    box.checked = row.state !== "off";
    // A parent whose descendants disagree draws mixed; clicking it commits to
    // ticked, which is what writes the same tick to the whole subtree.
    box.indeterminate = row.state === "mixed";
    box.title = `Show ${row.label} on the plot`;
    box.addEventListener("change", () =>
      options.onScope.toggleRow(row, box.checked),
    );
    boxLabel.appendChild(box);

    const body = element(
      document,
      "button",
      "cm-scope-row-body",
    ) as HTMLButtonElement;
    body.type = "button";
    body.setAttribute("aria-pressed", row.selected ? "true" : "false");
    const name = text(document, "span", row.label, "cm-scope-row-label");
    name.title = `${row.label} — click to draw this folder as a region`;
    const count = text(
      document,
      "span",
      COUNT_FORMAT.format(row.count),
      "cm-scope-row-count",
    );
    body.append(name, count);
    if (row.kind === "collection") {
      const collectionID = row.collectionID;
      body.setAttribute("data-collection-id", String(collectionID));
      body.addEventListener("click", () =>
        options.onScope.selectRow(row, !row.selected),
      );
      body.addEventListener("pointerenter", () => {
        if (!pinned) options.onEmphasise({ kind: "collection", collectionID });
      });
      body.addEventListener("pointerleave", () => {
        if (!pinned) options.onEmphasise(null);
      });
    } else {
      body.disabled = true;
    }

    wrapper.append(boxLabel, body);
    return wrapper;
  }

  function sectionElement(section: KeySection): HTMLElement {
    const node = element(document, "section", "cm-key-section");
    // The heading is set in sentence case and uppercased by CSS, so a screen
    // reader is not handed an acronym.
    const heading = text(document, "h2", section.heading, "cm-key-heading");
    node.appendChild(heading);
    if (section.subheading) {
      node.appendChild(
        text(document, "p", section.subheading, "cm-key-subheading"),
      );
    }
    for (const entry of section.entries) node.appendChild(entryRow(entry));
    if (section.note) {
      node.appendChild(text(document, "p", section.note, "cm-key-note"));
    }
    return node;
  }

  applyLayout();

  return {
    root,
    toolbar,
    footer,
    resizer,
    setWidth(next: number): void {
      width = next;
      applyLayout();
    },
    setCollapsed,
    isCollapsed: () => collapsed,
    render(model: KeyModel): void {
      // A rebuild throws away the pinned entry's identity — the model is new
      // even when it describes the same thing — so the pin goes with it rather
      // than leaving the canvas emphasising something the rail cannot show.
      release();
      keyHost.replaceChildren();
      for (const section of model.sections) {
        keyHost.appendChild(sectionElement(section));
      }
      // The rail carries the view's controls in its footer now, so an empty
      // Key empties the body and leaves the column standing. Hiding the whole
      // rail would take the zoom and appearance buttons off screen with it.
      body.hidden = model.sections.length === 0 && scopeHost.hidden;
    },
    renderScope(model: ScopeRailModel | null): void {
      scopeHost.replaceChildren();
      scopeHost.hidden = model === null;
      if (!model) {
        body.hidden = keyHost.children.length === 0;
        return;
      }
      scopeHost.appendChild(text(document, "h2", "Scope", "cm-key-heading"));
      scopeHost.appendChild(
        text(document, "p", model.countLine, "cm-scope-count"),
      );
      const seedsHeader = element(document, "div", "cm-scope-seeds-header");
      seedsHeader.append(
        text(document, "span", model.seedsHeading, "cm-scope-seeds-heading"),
        addSeedLink,
      );
      scopeHost.appendChild(seedsHeader);
      for (const seed of model.seeds) scopeHost.appendChild(seedRow(seed));
      const rows = element(document, "div", "cm-scope-rows");
      for (const row of model.rows) rows.appendChild(scopeRowElement(row));
      scopeHost.appendChild(rows);
      if (model.hiddenLine) {
        const hidden = element(document, "p", "cm-scope-hidden");
        hidden.append(text(document, "span", model.hiddenLine));
        const showAll = element(document, "button", "cm-scope-show-all");
        showAll.type = "button";
        showAll.textContent = "Show all";
        showAll.addEventListener("click", () =>
          options.onScope.showAllHidden(),
        );
        hidden.append(text(document, "span", " · "), showAll);
        scopeHost.appendChild(hidden);
      }
      body.hidden = false;
    },
    addSeedAnchor: () => addSeedLink,
    release,
    destroy(): void {
      root.removeEventListener("keydown", onKeyDown);
      scopeHost.replaceChildren();
      keyHost.replaceChildren();
      root.remove();
    },
  };
}
