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
