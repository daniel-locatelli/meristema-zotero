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
import {
  getKeyRailCollapsed,
  setKeyRailCollapsed,
} from "./citationPreferences";
import { element, text } from "./graphViewControls";
import { createIcon } from "./uiIconService";
import type { KeyEntry, KeyMark, KeyModel, KeySection } from "./graphKeyModel";

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

export interface KeyRailOptions {
  document: Document;
  /**
   * Emphasise the papers an entry covers, or release with null. The rail never
   * decides what emphasis *means*; it only says which entry is being pointed at.
   */
  onEmphasise: (entry: KeyEntry | null) => void;
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
  render(model: KeyModel): void;
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
  const footer = element(document, "div", "cm-key-footer");
  root.append(toolbar, body, footer);

  let collapsed = getKeyRailCollapsed();
  /** The entry whose emphasis is pinned, if any. Hover is transient; this is not. */
  let pinned: KeyEntry | null = null;
  let pinnedButton: HTMLButtonElement | null = null;

  const applyCollapsed = (): void => {
    root.dataset.collapsed = String(collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    // "Sidebar", not "key": the rail carries the view's controls as well as
    // the Key now, and the button takes the whole column with it.
    const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
    toggle.title = label;
    toggle.setAttribute("aria-label", label);
    toggle.replaceChildren(
      createIcon(document, collapsed ? "chevron-right" : "chevron-left", 14),
    );
  };

  const release = (): void => {
    if (!pinned) return;
    pinned = null;
    pinnedButton?.setAttribute("aria-pressed", "false");
    pinnedButton = null;
    onEmphasise(null);
  };

  toggle.addEventListener("click", () => {
    collapsed = !collapsed;
    setKeyRailCollapsed(collapsed);
    applyCollapsed();
    // A collapsed rail cannot show what is pinned, so it cannot hold a pin.
    if (collapsed) release();
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
      if (!pinned) onEmphasise(entry);
    });
    button.addEventListener("pointerleave", () => {
      if (!pinned) onEmphasise(null);
    });
    button.addEventListener("focus", () => {
      if (!pinned) onEmphasise(entry);
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
      onEmphasise(entry);
    });
    return button;
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

  applyCollapsed();

  return {
    root,
    toolbar,
    footer,
    render(model: KeyModel): void {
      // A rebuild throws away the pinned entry's identity — the model is new
      // even when it describes the same thing — so the pin goes with it rather
      // than leaving the canvas emphasising something the rail cannot show.
      release();
      body.replaceChildren();
      for (const section of model.sections) {
        body.appendChild(sectionElement(section));
      }
      // The rail carries the view's controls in its footer now, so an empty
      // Key empties the body and leaves the column standing. Hiding the whole
      // rail would take the zoom and appearance buttons off screen with it.
      body.hidden = model.sections.length === 0;
    },
    release,
    destroy(): void {
      root.removeEventListener("keydown", onKeyDown);
      body.replaceChildren();
      root.remove();
    },
  };
}
