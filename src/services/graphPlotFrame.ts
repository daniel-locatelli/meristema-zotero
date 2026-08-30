/**
 * The plot's geometry and its typography — the two things the axis furniture,
 * the gridlines and the fitted view all have to agree about.
 *
 * Everything here is authored in CSS pixels and multiplied by the frame's
 * device pixel scale, the same convention Task 2 established for the drawing
 * sizes. Before this module the two sides disagreed: `fitView` reserved flat
 * device-pixel gutters while `drawAxes` drew its axis at a ratio-scaled offset,
 * so on a scaled display the fit under-reserved and nodes landed beneath the
 * y-axis labels. `fitInsets` is now defined as `axisInsets` plus a margin, and
 * `test/unit/graphPlotFrame.test.ts` pins that it can never reserve less.
 */

export interface PlotInsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface PlotRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export interface PlotAxisState {
  /** The x metric is "free", so no tick row or axis title is drawn. */
  xFree: boolean;
  /** The y metric is "free", so no tick column or axis title is drawn. */
  yFree: boolean;
}

/**
 * CSS pixels the axis furniture occupies outside the plot. A free axis draws no
 * ticks and no title, so its side keeps only the frame's breathing room.
 */
const AXIS_GUTTER_CSS = {
  labelledLeft: 58,
  bareLeft: 18,
  right: 14,
  top: 14,
  labelledBottom: 42,
  bareBottom: 18,
} as const;

/**
 * CSS pixels a fitted view keeps clear. Each is the axis gutter plus a margin,
 * and each matches the flat literal `fitView` used before this module, so a
 * fit at ratio 1 lands exactly where it always did.
 */
const FIT_GUTTER_CSS = {
  left: 64,
  right: 32,
  top: 28,
  labelledBottom: 72,
  bareBottom: 32,
} as const;

/** The type scale, in CSS pixels. */
export const GRAPH_TYPE_SCALE = {
  tick: 11,
  axisTitle: 11,
  gutter: 10,
} as const;

/** Tracking for the uppercase furniture, as a fraction of the font size. */
export const GRAPH_UPPERCASE_TRACKING = 0.09;

/**
 * Used only when the chrome's own stack cannot be read off the canvas — see
 * `resolveChromeFontStack`.
 */
export const GRAPH_FALLBACK_FONT_STACK =
  "system-ui, -apple-system, 'Segoe UI', sans-serif";

export function axisInsets(ratio: number, axes: PlotAxisState): PlotInsets {
  return {
    left:
      (axes.yFree ? AXIS_GUTTER_CSS.bareLeft : AXIS_GUTTER_CSS.labelledLeft) *
      ratio,
    right: AXIS_GUTTER_CSS.right * ratio,
    top: AXIS_GUTTER_CSS.top * ratio,
    bottom:
      (axes.xFree
        ? AXIS_GUTTER_CSS.bareBottom
        : AXIS_GUTTER_CSS.labelledBottom) * ratio,
  };
}

export function fitInsets(ratio: number, axes: PlotAxisState): PlotInsets {
  return {
    left: FIT_GUTTER_CSS.left * ratio,
    right: FIT_GUTTER_CSS.right * ratio,
    top: FIT_GUTTER_CSS.top * ratio,
    bottom:
      (axes.xFree ? FIT_GUTTER_CSS.bareBottom : FIT_GUTTER_CSS.labelledBottom) *
      ratio,
  };
}

/** The drawable plot, in canvas device pixels. Degenerate on a tiny canvas. */
export function plotRect(
  canvasWidth: number,
  canvasHeight: number,
  insets: PlotInsets,
): PlotRect {
  const left = Math.min(insets.left, Math.max(0, canvasWidth - 1));
  const top = Math.min(insets.top, Math.max(0, canvasHeight - 1));
  const right = Math.max(left, canvasWidth - insets.right);
  const bottom = Math.max(top, canvasHeight - insets.bottom);
  return {
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

/**
 * The font stack the surrounding chrome is using, so the canvas furniture and
 * the DOM chrome are set in the same face rather than in whatever the platform
 * maps `sans-serif` to.
 */
export function resolveChromeFontStack(element: HTMLElement): string {
  const view = element.ownerDocument?.defaultView;
  const family = view?.getComputedStyle?.(element)?.fontFamily;
  return family && family.trim() ? family : GRAPH_FALLBACK_FONT_STACK;
}

/**
 * Draw an uppercase, tracked run of text.
 *
 * Canvas 2D has no `font-variant-numeric`, so tabular figures can only be asked
 * for in `graph.css`; tick labels stay right- or centre-aligned, which is what
 * the tabular setting would have bought here anyway. `letterSpacing` is
 * available from Firefox 118 and Zotero 9 is well past that, but it is still
 * feature-detected: without it the text simply draws untracked rather than
 * disappearing.
 */
export function fillTrackedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fontSizeDevicePixels: number,
): void {
  const value = text.toLocaleUpperCase();
  const spacing = fontSizeDevicePixels * GRAPH_UPPERCASE_TRACKING;
  const tracked = context as CanvasRenderingContext2D & {
    letterSpacing?: string;
  };
  if (typeof tracked.letterSpacing !== "string") {
    context.fillText(value, x, y);
    return;
  }
  tracked.letterSpacing = `${spacing}px`;
  // Tracking is added after the final glyph too, so a centred run sits half a
  // step right of where it should. Take that back.
  const offset = context.textAlign === "center" ? -spacing / 2 : 0;
  context.fillText(value, x + offset, y);
  tracked.letterSpacing = "0px";
}
