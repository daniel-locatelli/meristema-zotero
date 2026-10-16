/**
 * The bridge between the graph's world coordinates and the canvas's device
 * pixels.
 *
 * Layout, hit testing and the fit operations all reason in world units. Drawing
 * does not: a stroke width, a label, an arrowhead and a node radius must keep
 * the same apparent size whatever the zoom, so every draw call works in device
 * pixels and reaches them through `projectToScreen`. Keeping the two directions
 * in one module is what makes them testable as a pair — they must remain exact
 * inverses or dragging a node drifts away from the pointer.
 */

export interface ViewportPoint {
  x: number;
  y: number;
}

export interface ViewportTransform {
  x: number;
  y: number;
  scale: number;
}

/** World coordinates to canvas device pixels. */
export function projectToScreen(
  position: ViewportPoint,
  transform: ViewportTransform,
): ViewportPoint {
  return {
    x: transform.x + position.x * transform.scale,
    y: transform.y + position.y * transform.scale,
  };
}

/** Canvas device pixels back to world coordinates. */
export function projectToWorld(
  point: ViewportPoint,
  transform: ViewportTransform,
): ViewportPoint {
  return {
    x: (point.x - transform.x) / transform.scale,
    y: (point.y - transform.y) / transform.scale,
  };
}

/**
 * How many device pixels one CSS pixel of the canvas covers. Every screen-space
 * size in the renderer is authored in CSS pixels and multiplied by this, so the
 * graph looks identical on a HiDPI display and a plain one.
 */
export function devicePixelScale(
  canvasWidth: number,
  cssWidth: number,
): number {
  return canvasWidth / Math.max(1, cssWidth);
}

/**
 * A world-space length as it should be tested in world space when the drawn
 * size is fixed in device pixels — the conversion `hitTest` needs now that a
 * node's radius no longer grows with the zoom.
 */
export function screenLengthToWorld(
  length: number,
  transform: ViewportTransform,
): number {
  return length / transform.scale;
}

/**
 * The view that puts a world point at the canvas centre at the same zoom —
 * where a seed picked from the rail is shown (B98).
 */
export function centredTransform(
  position: ViewportPoint,
  transform: ViewportTransform,
  width: number,
  height: number,
): ViewportTransform {
  return {
    x: width / 2 - position.x * transform.scale,
    y: height / 2 - position.y * transform.scale,
    scale: transform.scale,
  };
}

/** Cubic ease-out: quick away from the start, settling into the end. Clamped to [0, 1]. */
export function easeOutCubic(progress: number): number {
  const t = Math.min(1, Math.max(0, progress));
  return 1 - (1 - t) ** 3;
}

/**
 * The view `elapsed` milliseconds into an eased pan from one transform to
 * another (B105). At or past `duration` it is the target itself, not a value
 * near it, so a frame that comes late — a covered window's fallback timer —
 * lands the pan exactly where an instant one would have.
 */
export function easedTransform(
  from: ViewportTransform,
  to: ViewportTransform,
  elapsed: number,
  duration: number,
): ViewportTransform {
  if (!(elapsed < duration)) return { ...to };
  const share = easeOutCubic(elapsed / duration);
  return {
    x: from.x + (to.x - from.x) * share,
    y: from.y + (to.y - from.y) * share,
    scale: from.scale + (to.scale - from.scale) * share,
  };
}

/**
 * How far to shift the view so a screen point sits inside the canvas with
 * `margin` to spare, or zero on an axis where it already does. Used to bring
 * a node selected elsewhere into view without changing the zoom.
 */
export function offscreenPanDelta(
  point: ViewportPoint,
  margin: number,
  width: number,
  height: number,
): ViewportPoint {
  const shift = (value: number, extent: number): number => {
    if (value < margin) return margin - value;
    if (value > extent - margin) return extent - margin - value;
    return 0;
  };
  return { x: shift(point.x, width), y: shift(point.y, height) };
}

/** Scale multiplier per pixel of wheel travel; 100 pixels is one mouse notch. */
const WHEEL_ZOOM_RATE = 0.0025;
/** Wheel travel a single event may count for, in pixels. */
const WHEEL_ZOOM_MAX_TRAVEL = 400;
const WHEEL_PIXELS_PER_LINE = 16;
const WHEEL_PIXELS_PER_PAGE = 800;

/**
 * The factor a wheel event multiplies the zoom by. Negative travel zooms in.
 *
 * Browsers report `deltaY` in pixels, lines or pages depending on the mouse
 * driver, so the three are first put on one pixel scale. One event's travel is
 * then capped, which keeps an inertial trackpad fling or a page-mode wheel
 * from throwing the view across the whole zoom range in one frame, while a
 * trackpad's small deltas still produce a gentle, continuous zoom.
 */
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  const pixels =
    deltaMode === 1
      ? deltaY * WHEEL_PIXELS_PER_LINE
      : deltaMode === 2
        ? deltaY * WHEEL_PIXELS_PER_PAGE
        : deltaY;
  const travel = Math.max(
    -WHEEL_ZOOM_MAX_TRAVEL,
    Math.min(WHEEL_ZOOM_MAX_TRAVEL, pixels),
  );
  return Math.exp(-travel * WHEEL_ZOOM_RATE);
}

/** An axis-aligned rectangle in canvas device pixels. */
export interface ViewportRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Whether a box, grown by `margin` on every side, lies wholly outside `rect`.
 * A draw call whose geometry stays inside such a box paints no pixel of the
 * rect, so skipping it leaves the frame identical (B34, B89): at a deep zoom
 * that is nearly every node and edge. Touching an edge counts as inside.
 *
 * Fails open: a non-finite bound or margin compares false, so the box is kept
 * and drawn exactly as it was before culling existed.
 */
export function boxMissesRect(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  margin: number,
  rect: ViewportRect,
): boolean {
  return (
    maxX + margin < rect.left ||
    minX - margin > rect.right ||
    maxY + margin < rect.top ||
    minY - margin > rect.bottom
  );
}

/**
 * Whether a segment comes no nearer `rect` than `margin` on either axis: the
 * segment misses `rect` grown by `margin` on every side (Liang–Barsky). Ink
 * within `margin` of the segment then paints no pixel of `rect`, which is the
 * edge cull's statement (B89): a seed's citers radiate to it from every
 * direction, so at a deep zoom most of their boxes cover the view while their
 * lines pass it by.
 *
 * Fails open on a non-finite coordinate or margin, like `boxMissesRect`.
 */
export function segmentMissesRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  margin: number,
  rect: ViewportRect,
): boolean {
  if (
    !Number.isFinite(x0) ||
    !Number.isFinite(y0) ||
    !Number.isFinite(x1) ||
    !Number.isFinite(y1) ||
    !Number.isFinite(margin)
  ) {
    return false;
  }
  const dx = x1 - x0;
  const dy = y1 - y0;
  let enter = 0;
  let leave = 1;
  // Each side as `p * t <= q`: the part of the segment on the rect's side of
  // that edge. An empty interval after any side means a miss.
  const sides: ReadonlyArray<readonly [number, number]> = [
    [-dx, x0 - (rect.left - margin)],
    [dx, rect.right + margin - x0],
    [-dy, y0 - (rect.top - margin)],
    [dy, rect.bottom + margin - y0],
  ];
  for (const [p, q] of sides) {
    if (p === 0) {
      if (q < 0) return true;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > leave) return true;
      if (t > enter) enter = t;
    } else {
      if (t < enter) return true;
      if (t < leave) leave = t;
    }
  }
  return false;
}
