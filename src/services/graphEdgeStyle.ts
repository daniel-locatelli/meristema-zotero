/**
 * How an edge is drawn: how far it curves, how solid it is, and whether it
 * still earns an arrowhead.
 *
 * The renderer draws every edge inside one loop, so the decisions that loop
 * makes per edge are the ones worth having outside it, where they can be tested
 * without a canvas. Like `graphPlotFrame.ts`, every length here is authored in
 * CSS pixels; the caller multiplies by the frame's device pixel scale.
 */

export interface EdgeEndpoint {
  x: number;
  y: number;
}

export interface EdgeLike {
  source: string;
  target: string;
}

/** How far the apex of a curved edge sits off the straight chord, in CSS px. */
export const EDGE_CURVE_APEX_CSS = 8;

/** The arrowhead's length along the edge, in CSS px. */
export const ARROWHEAD_SIZE_CSS = 6;

/** Below this zoom an unlit arrowhead is a smudge, so it is not drawn. */
export const ARROWHEAD_MIN_ZOOM = 0.5;

/**
 * Edge counts between which the base opacity falls. Below the first every edge
 * is drawn at full strength; above the second the mesh is dense enough that the
 * floor is all that keeps the nodes readable through it.
 */
const OPACITY_FULL_BELOW = 240;
const OPACITY_FLOOR_ABOVE = 3200;
const OPACITY_FLOOR = 0.3;

/**
 * The alpha an ordinary edge is drawn at. A hundred edges should each read as a
 * line; four thousand should read as a texture the nodes sit on top of, so the
 * strength falls with the count. The decay is linear in log space — the visual
 * difference between 300 and 600 edges is about the difference between 1500 and
 * 3000, not between 1500 and 1800.
 *
 * Selected and hovered edges do not go through this; they are lit deliberately
 * and stay at full strength however dense the graph is.
 */
export function edgeBaseOpacity(edgeCount: number): number {
  if (edgeCount <= OPACITY_FULL_BELOW) return 1;
  if (edgeCount >= OPACITY_FLOOR_ABOVE) return OPACITY_FLOOR;
  const span =
    Math.log(edgeCount / OPACITY_FULL_BELOW) /
    Math.log(OPACITY_FLOOR_ABOVE / OPACITY_FULL_BELOW);
  return 1 - span * (1 - OPACITY_FLOOR);
}

function edgeKey(source: string, target: string): string {
  return `${source}>${target}`;
}

/**
 * The edges that have a partner running the other way. Only these curve: a
 * lone edge drawn as an arc says something the graph does not mean, and a
 * straight line between two nodes is the most legible thing available.
 */
export function reciprocalEdgeKeys(edges: readonly EdgeLike[]): Set<string> {
  const present = new Set(
    edges.map((edge) => edgeKey(edge.source, edge.target)),
  );
  const reciprocal = new Set<string>();
  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    if (present.has(edgeKey(edge.target, edge.source))) {
      reciprocal.add(edgeKey(edge.source, edge.target));
    }
  }
  return reciprocal;
}

/**
 * Which side of the chord an edge bows to. Comparing the two keys is what makes
 * the pair separate rather than overdraw: whichever order the edges arrive in,
 * `A>B` and `B>A` always disagree about the sign.
 */
export function curveSign(source: string, target: string): number {
  return source < target ? 1 : -1;
}

/**
 * The control point of the quadratic that bows an edge `apex` device pixels off
 * its chord. A quadratic passes through half its control offset at the midpoint,
 * so the control point is placed twice as far out as the apex we want.
 */
export function curveControlPoint(
  source: EdgeEndpoint,
  target: EdgeEndpoint,
  apex: number,
): EdgeEndpoint {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return { x: source.x, y: source.y };
  // The chord's left-hand normal.
  const normalX = -dy / length;
  const normalY = dx / length;
  return {
    x: (source.x + target.x) / 2 + normalX * apex * 2,
    y: (source.y + target.y) / 2 + normalY * apex * 2,
  };
}

/**
 * The unit direction the edge arrives at its target travelling in — the
 * tangent of the quadratic at t=1, which is what the arrowhead has to align
 * with. For a straight edge the control point is the midpoint and this reduces
 * to the chord direction.
 */
export function arrivalDirection(
  control: EdgeEndpoint,
  target: EdgeEndpoint,
): EdgeEndpoint {
  const dx = target.x - control.x;
  const dy = target.y - control.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return { x: 1, y: 0 };
  return { x: dx / length, y: dy / length };
}

/**
 * An arrowhead is six pixels of solid ink. Zoomed out past half scale the nodes
 * it points at are smaller than that, and the heads merge into the edge mesh
 * instead of reading as direction — so they are dropped, unless the edge is lit
 * by a selection, where direction is the whole point of lighting it.
 */
export function shouldDrawArrowhead(zoom: number, lit: boolean): boolean {
  return lit || zoom > ARROWHEAD_MIN_ZOOM;
}

/**
 * How far the line and the head overlap where they meet, in CSS pixels. Butting
 * two antialiased edges together leaves a pale seam; a fraction of a pixel of
 * overlap closes it, and is small enough that the double-composited band it
 * costs is invisible under a head several times wider.
 */
export const ARROWHEAD_SEAM_OVERLAP_CSS = 0.5;

/**
 * How far back from the target the *line* stops, given where the head's tip
 * goes.
 *
 * The line used to run to the tip, so its last six pixels lay underneath the
 * head. Both are drawn at the same `globalAlpha` — an edge is translucent, and
 * more so as the mesh thickens — so that overlap composited twice and the shaft
 * showed through the head as a darker streak. Ending the line at the head's
 * base instead means every pixel is painted once.
 */
export function edgeLineInset(
  tipInset: number,
  headSize: number,
  headDrawn: boolean,
  seamOverlap: number,
): number {
  if (!headDrawn) return tipInset;
  return tipInset + Math.max(0, headSize - seamOverlap);
}
