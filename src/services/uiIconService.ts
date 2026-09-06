/// <reference lib="dom" />

const SVG_NS = "http://www.w3.org/2000/svg";

export type IconName =
  | "add"
  | "search"
  | "similar"
  | "refresh"
  | "export"
  | "filter"
  | "sort"
  | "ascending"
  | "descending"
  | "arrow-left"
  | "arrow-right"
  | "chevron-left"
  | "chevron-right"
  | "zoom-in"
  | "zoom-out"
  | "fit"
  | "document"
  | "sliders"
  | "settings";

const ICON_PATHS: Record<IconName, string[]> = {
  add: ["M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7V4Z"],
  search: [
    "M10.5 4a6.5 6.5 0 1 0 3.95 11.66L20 21.2l1.2-1.2-5.55-5.55A6.5 6.5 0 0 0 10.5 4Zm0 1.8a4.7 4.7 0 1 1 0 9.4 4.7 4.7 0 0 1 0-9.4Z",
  ],
  similar: [
    "M10.5 4a6.5 6.5 0 1 0 3.95 11.66L20 21.2l1.2-1.2-5.55-5.55A6.5 6.5 0 0 0 10.5 4Zm0 1.8a4.7 4.7 0 1 1 0 9.4 4.7 4.7 0 0 1 0-9.4Z",
  ],
  refresh: [
    "M17.65 6.35A7.95 7.95 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8S7.58 20 12 20c3.73 0 6.84-2.55 7.73-6h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35Z",
  ],
  export: [
    "M11 3h2v9.17l2.59-2.58L17 11l-5 5-5-5 1.41-1.41L11 12.17V3Z",
    "M5 18h14v3H5v-3Z",
  ],
  filter: [
    "M3 5a1 1 0 0 1 1-1h16a1 1 0 0 1 .8 1.6L14 14.67V20a1 1 0 0 1-1.45.89l-3-1.5A1 1 0 0 1 9 18.5v-3.83L3.2 5.6A1 1 0 0 1 3 5Z",
  ],
  sort: ["M7 4 3 8h3v10h2V8h3L7 4Zm10 16 4-4h-3V6h-2v10h-3l4 4Z"],
  ascending: ["M12 5 6 11h4v8h4v-8h4l-6-6Z"],
  descending: ["M10 5v8H6l6 6 6-6h-4V5h-4Z"],
  /*
   * The four navigation glyphs, drawn rather than typed. They were "←", "→",
   * "‹" and "›" set as button text, and a text glyph sits on its font's
   * baseline: the arrows ride the maths axis and the chevrons are shorter than
   * their line box, so both looked a pixel or two high inside a centred
   * button. These are centred on the viewBox instead, so they cannot drift.
   */
  "arrow-left": [
    "M20 11H7.83l5.58-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2Z",
  ],
  "arrow-right": [
    "M4 11h12.17l-5.58-5.59L12 4l8 8-8 8-1.41-1.41L16.17 13H4v-2Z",
  ],
  "chevron-left": [
    "M15.7 6.7 14.3 5.3 7.6 12l6.7 6.7 1.4-1.4-5.3-5.3 5.3-5.3Z",
  ],
  "chevron-right": [
    "M9.7 5.3 8.3 6.7l5.3 5.3-5.3 5.3 1.4 1.4L16.4 12 9.7 5.3Z",
  ],
  /*
   * The rail's four buttons, for the same reason as the four above: they were
   * "+", "−", "⌖" and "⚙" set as text. A text glyph sits on its font's
   * baseline, and the last two are characters no interface font agrees on, so
   * each one landed wherever its own font's metrics put it inside a button
   * centred on something else. Drawn on the viewBox, they cannot drift.
   */
  "zoom-in": [
    "M10.5 4a6.5 6.5 0 1 0 3.95 11.66L20 21.2l1.2-1.2-5.55-5.55A6.5 6.5 0 0 0 10.5 4Zm0 1.8a4.7 4.7 0 1 1 0 9.4 4.7 4.7 0 0 1 0-9.4Z",
    "M9.6 7.6h1.8v1.9h1.9v1.8h-1.9v1.9H9.6v-1.9H7.7V9.5h1.9V7.6Z",
  ],
  "zoom-out": [
    "M10.5 4a6.5 6.5 0 1 0 3.95 11.66L20 21.2l1.2-1.2-5.55-5.55A6.5 6.5 0 0 0 10.5 4Zm0 1.8a4.7 4.7 0 1 1 0 9.4 4.7 4.7 0 0 1 0-9.4Z",
    "M7.7 9.5h5.6v1.8H7.7V9.5Z",
  ],
  fit: [
    "M4 4h6v2H6v4H4V4Zm10 0h6v6h-2V6h-4V4ZM4 14h2v4h4v2H4v-6Zm14 0h2v6h-6v-2h4v-4Z",
    "M10.5 10.5h3v3h-3v-3Z",
  ],
  // Three slider tracks with their knobs: the Explore controls,
  // distinct from the gear that opens the rail's display settings.
  sliders: [
    "M3 17v2h6v-2H3Zm0-12v2h10V5H3Zm10 16v-2h8v-2h-8v-2h-2v6h2ZM7 9v2H3v2h4v2h2V9H7Zm14 4v-2H11v2h10Zm-6-4h2V7h4V5h-4V3h-2v6Z",
  ],
  // A page with a folded corner; even-odd fill leaves it hollow like the magnifier.
  document: [
    "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm4 18H6V4h7v5h5v11Z",
  ],
  /*
   * Generated, not hand-written, and rendered before it was pasted here: eight
   * teeth on a 10.4 radius, a 3.4 bore, every vertex from the same polar
   * sweep. A gear drawn by eye in path data comes out lopsided, which is what
   * the first attempt did.
   *
   * One path, not two: separate `<path>` elements cannot punch a hole in each
   * other, so the bore is a second subpath of this one and the set is filled
   * even-odd (below).
   */
  settings: [
    "M22.2 9.9L22.2 14.1L19.7 14.3L19.1 15.8L20.7 17.7L17.7 20.7L15.8 19.1L14.3 19.7L14.1 22.2L9.9 22.2L9.7 19.7L8.2 19.1L6.3 20.7L3.3 17.7L4.9 15.8L4.3 14.3L1.8 14.1L1.8 9.9L4.3 9.7L4.9 8.2L3.3 6.3L6.3 3.3L8.2 4.9L9.7 4.3L9.9 1.8L14.1 1.8L14.3 4.3L15.8 4.9L17.7 3.3L20.7 6.3L19.1 8.2L19.7 9.7ZM15.4 12.0L15.2 13.1L14.8 14.0L14.0 14.8L13.1 15.2L12.0 15.4L10.9 15.2L10.0 14.8L9.2 14.0L8.8 13.1L8.6 12.0L8.8 10.9L9.2 10.0L10.0 9.2L10.9 8.8L12.0 8.6L13.1 8.8L14.0 9.2L14.8 10.0L15.2 10.9Z",
  ],
};

/**
 * The chevron in a pane's collapse toggle. The Key rail's and the detail
 * pane's flank the plot and are read as a pair, so they take their size from
 * one name rather than from two literals — which is how the rail's ended up at
 * 14 and the detail pane's at the 16px default, visibly larger in the same
 * 26px box.
 */
export const PANE_TOGGLE_ICON_SIZE = 14;

export function createIcon(
  document: Document,
  name: IconName,
  size = 16,
): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("cm-icon", `cm-icon-${name}`);
  svg.style.width = `${size}px`;
  svg.style.height = `${size}px`;
  svg.style.flex = `0 0 ${size}px`;
  svg.style.fill = "currentColor";
  for (const d of ICON_PATHS[name]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "currentColor");
    /*
     * Even-odd, so a subpath nested inside another is a hole no matter which
     * way round it was drawn. The magnifier's lens already relied on winding
     * to be hollow and stays hollow under this rule; the gear's bore needs it.
     */
    path.setAttribute("fill-rule", "evenodd");
    svg.appendChild(path);
  }
  return svg;
}
