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
