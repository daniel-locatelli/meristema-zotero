/**
 * A folder's territory on the plot, as closed contours.
 *
 * Folder membership used to live in the node's fill, which cut a paper filed
 * in three folders into three pie slices and left the fill unable to carry a
 * metric at the same time. It is drawn as a region behind the nodes instead,
 * and this module computes the shape.
 *
 * The field is built in **data space**, not screen space, and that is the
 * load-bearing choice. A screen-space field with a falloff in device pixels
 * makes the contour a function of the zoom: zoom in and a folder fragments
 * into islands, zoom out and islands merge, because the nodes move apart and
 * together on screen while the papers do not. In data space the topology is
 * invariant, and a folder fragments only when its papers genuinely are apart.
 * The renderer transforms these contours with the same viewport transform the
 * nodes use, and dilates them by a device-pixel amount so the hull clears the
 * node discs by a constant margin on screen.
 *
 * Plain geometry in, plain geometry out: no canvas, no DOM.
 *
 * `stitch` walks the marching-squares segments into closed loops and, when a
 * loop's walk runs out of unused segments before it returns to its start,
 * force-closes it with a straight edge back to the start point rather than
 * raising an error. That is silent: a pathological field — one that produces
 * a genuinely unclosable fragment — yields a small, wrong polygon instead of
 * a visible failure. If a region's shape ever looks subtly off in a way that
 * does not track back to a renderer bug, look here first, not in the
 * renderer's transform or compositing.
 */

export interface RegionPoint {
  x: number;
  y: number;
}

export interface FolderRegionOptions {
  /** Falloff radius in data units. A lone paper's loop is smaller than this. */
  radius: number;
  /** Grid cell size in data units. Smaller is smoother and slower. */
  pitch: number;
  /** The field level the contour follows. Defaults to half a paper's peak. */
  threshold?: number;
}

const DEFAULT_THRESHOLD = 0.5;
/**
 * How far past the papers' bounding box the grid runs. The field has to reach
 * the threshold from both sides inside the grid, or the contour is clipped
 * square at the edge instead of tapering shut.
 */
const DOMAIN_MARGIN = 1.5;
/** Vertices closer than this share a stitching slot. */
const WELD = 1e-6;
/**
 * Two knots closer than this, in device pixels, are one knot. Marching-squares
 * vertices bunch tightly at grid corners, so a knot difference genuinely does
 * reach zero and the Catmull-Rom denominators genuinely do divide by it.
 */
const KNOT_EPSILON = 1e-6;
/** A ring's trailing repeat of its own first point, in device pixels. */
const RING_WELD = 1e-4;

/**
 * A hard ceiling on the field grid. With the falloff's 8x tightening floor and
 * `pitch = radius / 5` the grid never exceeds roughly 640 steps across a
 * folder's bounding box, about 410 000 cells, so this cannot trigger in the
 * product. It is here so that a later change to the floor coarsens the pitch
 * instead of allocating unboundedly on a wheel notch.
 */
const MAX_GRID_CELLS = 500_000;

function interpolate(
  first: RegionPoint,
  second: RegionPoint,
  firstValue: number,
  secondValue: number,
  threshold: number,
): RegionPoint {
  const span = secondValue - firstValue;
  const ratio = Math.abs(span) < 1e-12 ? 0.5 : (threshold - firstValue) / span;
  return {
    x: first.x + (second.x - first.x) * ratio,
    y: first.y + (second.y - first.y) * ratio,
  };
}

function keyOf(point: RegionPoint): string {
  return `${Math.round(point.x / WELD)}:${Math.round(point.y / WELD)}`;
}

/**
 * Marching squares, full case table, saddles disambiguated by the cell's mean.
 *
 * The two ambiguous cases — corners above the threshold on one diagonal and
 * below on the other — can be joined two ways. Choosing by the cell's average
 * value keeps the contour consistent with the field it came from; choosing
 * arbitrarily makes loops that cross themselves.
 */
function cellSegments(
  corners: readonly [RegionPoint, RegionPoint, RegionPoint, RegionPoint],
  values: readonly [number, number, number, number],
  threshold: number,
): Array<[RegionPoint, RegionPoint]> {
  const [topLeft, topRight, bottomRight, bottomLeft] = corners;
  const [tl, tr, br, bl] = values;
  const code =
    (tl >= threshold ? 8 : 0) +
    (tr >= threshold ? 4 : 0) +
    (br >= threshold ? 2 : 0) +
    (bl >= threshold ? 1 : 0);

  const top = (): RegionPoint =>
    interpolate(topLeft, topRight, tl, tr, threshold);
  const right = (): RegionPoint =>
    interpolate(topRight, bottomRight, tr, br, threshold);
  const bottom = (): RegionPoint =>
    interpolate(bottomLeft, bottomRight, bl, br, threshold);
  const left = (): RegionPoint =>
    interpolate(topLeft, bottomLeft, tl, bl, threshold);

  switch (code) {
    case 0:
    case 15:
      return [];
    case 1:
    case 14:
      return [[left(), bottom()]];
    case 2:
    case 13:
      return [[bottom(), right()]];
    case 3:
    case 12:
      return [[left(), right()]];
    case 4:
    case 11:
      return [[top(), right()]];
    case 6:
    case 9:
      return [[top(), bottom()]];
    case 7:
    case 8:
      return [[left(), top()]];
    case 5:
    case 10: {
      const mean = (tl + tr + br + bl) / 4;
      const joinedThroughMiddle = mean >= threshold;
      if (code === 5) {
        return joinedThroughMiddle
          ? [
              [left(), top()],
              [bottom(), right()],
            ]
          : [
              [left(), bottom()],
              [top(), right()],
            ];
      }
      return joinedThroughMiddle
        ? [
            [left(), bottom()],
            [top(), right()],
          ]
        : [
            [left(), top()],
            [bottom(), right()],
          ];
    }
    default:
      return [];
  }
}

/** Walk the loose segments into closed loops. */
function stitch(
  segments: ReadonlyArray<[RegionPoint, RegionPoint]>,
): RegionPoint[][] {
  // Index every segment at *both* of its endpoints. A cell's case table picks
  // each segment's two points in whatever order that case's branch happens
  // to list them in, not in a winding consistent with its neighbours, so the
  // vertex where two segments meet is exactly as often the *second* point of
  // one of them as the first. Indexing by segment[0] alone misses those
  // vertices, and the walk below stops there and force-closes a false, small
  // loop instead of continuing through the one true loop it is part of.
  const byEndpoint = new Map<string, Array<[RegionPoint, RegionPoint]>>();
  for (const segment of segments) {
    for (const point of segment) {
      const key = keyOf(point);
      const bucket = byEndpoint.get(key);
      if (bucket) bucket.push(segment);
      else byEndpoint.set(key, [segment]);
    }
  }

  const used = new Set<[RegionPoint, RegionPoint]>();
  const loops: RegionPoint[][] = [];

  for (const segment of segments) {
    if (used.has(segment)) continue;
    used.add(segment);
    const loop: RegionPoint[] = [segment[0], segment[1]];
    let tail = segment[1];

    while (keyOf(tail) !== keyOf(loop[0])) {
      const candidates = byEndpoint.get(keyOf(tail)) ?? [];
      const following = candidates.find((candidate) => !used.has(candidate));
      if (!following) break;
      used.add(following);
      // The matching endpoint may be either end of the found segment;
      // whichever it is becomes this step's arrival point, and the other
      // end continues the walk.
      tail = keyOf(following[0]) === keyOf(tail) ? following[1] : following[0];
      loop.push(tail);
    }

    // A loop the walk could not close is a fragment; the caller draws filled
    // shapes, so close it rather than leaving an open path.
    if (keyOf(loop[loop.length - 1]) !== keyOf(loop[0])) loop.push(loop[0]);
    if (loop.length > 3) loops.push(loop);
  }

  return loops;
}

export function folderRegionContours(
  points: readonly RegionPoint[],
  options: FolderRegionOptions,
): RegionPoint[][] {
  if (!points.length) return [];
  const radius = options.radius;
  const pitch = options.pitch;
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  if (!(radius > 0) || !(pitch > 0)) return [];

  const margin = radius * DOMAIN_MARGIN;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs) - margin;
  const maxX = Math.max(...xs) + margin;
  const minY = Math.min(...ys) - margin;
  const maxY = Math.max(...ys) + margin;

  const width = maxX - minX;
  const height = maxY - minY;
  // Coarsen rather than allocate: see MAX_GRID_CELLS.
  const cellPitch = Math.max(
    pitch,
    Math.sqrt((width * height) / MAX_GRID_CELLS),
  );
  const columns = Math.ceil(width / cellPitch) + 1;
  const rows = Math.ceil(height / cellPitch) + 1;

  // Each paper's bump has compact support, so the field is accumulated by
  // stamping every node into the cells inside its own footprint rather than
  // evaluating every node against every cell. Same sum, different order:
  // O(nodes x (radius/pitch)^2) instead of O(cells x nodes), which is what
  // keeps the cost flat as the falloff tightens with the zoom (D6).
  const values = new Float64Array(rows * columns);
  const squared = radius * radius;
  const reach = Math.ceil(radius / cellPitch);
  for (const point of points) {
    const centreColumn = Math.round((point.x - minX) / cellPitch);
    const centreRow = Math.round((point.y - minY) / cellPitch);
    const firstRow = Math.max(0, centreRow - reach);
    const lastRow = Math.min(rows - 1, centreRow + reach);
    const firstColumn = Math.max(0, centreColumn - reach);
    const lastColumn = Math.min(columns - 1, centreColumn + reach);
    for (let row = firstRow; row <= lastRow; row += 1) {
      const dy = minY + row * cellPitch - point.y;
      const dySquared = dy * dy;
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        const dx = minX + column * cellPitch - point.x;
        const distance = dx * dx + dySquared;
        if (distance < squared) {
          values[row * columns + column] += 1 - distance / squared;
        }
      }
    }
  }

  const segments: Array<[RegionPoint, RegionPoint]> = [];
  for (let row = 0; row + 1 < rows; row += 1) {
    for (let column = 0; column + 1 < columns; column += 1) {
      const left = minX + column * cellPitch;
      const right = left + cellPitch;
      const top = minY + row * cellPitch;
      const bottom = top + cellPitch;
      segments.push(
        ...cellSegments(
          [
            { x: left, y: top },
            { x: right, y: top },
            { x: right, y: bottom },
            { x: left, y: bottom },
          ],
          [
            values[row * columns + column],
            values[row * columns + column + 1],
            values[(row + 1) * columns + column + 1],
            values[(row + 1) * columns + column],
          ],
          threshold,
        ),
      );
    }
  }

  return stitch(segments);
}

/**
 * A region's contours as one `Path2D`, built from the canvas's own window.
 *
 * `Path2D` is a DOM constructor, and the plugin's bundle runs in a scope that
 * carries none: the live plugin threw "Path2D is not defined" the moment a
 * folder was drawn, `draw()` caught it and latched `canvasError`, and the plot
 * stayed on its flat panel fill — no nodes, no axes — for the rest of that
 * renderer's life (backlog B28). Every test scope has a `Path2D` on it, which
 * is exactly why the suite watched this happen and reported nothing. The
 * renderer already takes `ResizeObserver` from `canvas.ownerDocument
 * .defaultView`; this is the same rule, and the reason it is a function here
 * rather than a line there is that a fake window makes it testable.
 *
 * Null when the window has no `Path2D` at all, so the caller skips the region
 * rather than losing the frame the nodes are drawn in.
 *
 * The outline is a centripetal Catmull-Rom fit, one cubic Bézier per contour
 * segment, wrapping because the loops are closed. A polyline in data space
 * re-facets as you zoom in — its segments grow on screen with everything else
 * — while a curve does not, because the rasterizer flattens it in device
 * pixels. The contour it is fitted through is untouched: same points, same
 * topology, same `evenodd` fill, same dilation stroke (backlog D6).
 */

/**
 * One segment's two cubic control points, centripetal Catmull-Rom → Bézier
 * (Barry–Goldman, α = 0.5).
 *
 * Centripetal is not a detail to swap out for uniform. Marching-squares
 * vertices bunch tightly at grid corners, and a uniform parameterisation over
 * spacing like that overshoots and can loop the curve back through itself
 * exactly there — a self-intersecting fill in the one place the contour is
 * most detailed.
 *
 * The guards are per control point, not per segment: a degenerate neighbour on
 * one side must not flatten the other side, which is perfectly well defined.
 * `t2 - t0` and `t3 - t1` need guarding as much as the adjacent differences —
 * each is a sum of two non-negative terms, so it vanishes when both halves do,
 * which is three coincident vertices.
 */
function segmentControls(
  p0: RegionPoint,
  p1: RegionPoint,
  p2: RegionPoint,
  p3: RegionPoint,
): [RegionPoint, RegionPoint] {
  // Knot spacing is the *Euclidean* distance raised to α, not a squared
  // distance and not a per-axis delta.
  const d10 = Math.sqrt(Math.hypot(p1.x - p0.x, p1.y - p0.y));
  const d21 = Math.sqrt(Math.hypot(p2.x - p1.x, p2.y - p1.y));
  const d32 = Math.sqrt(Math.hypot(p3.x - p2.x, p3.y - p2.y));
  const d20 = d10 + d21;
  const d31 = d21 + d32;

  const straightFirst: RegionPoint = {
    x: p1.x + (p2.x - p1.x) / 3,
    y: p1.y + (p2.y - p1.y) / 3,
  };
  const straightSecond: RegionPoint = {
    x: p2.x - (p2.x - p1.x) / 3,
    y: p2.y - (p2.y - p1.y) / 3,
  };
  if (!(d21 > KNOT_EPSILON)) return [straightFirst, straightSecond];

  const first =
    !(d10 > KNOT_EPSILON) || !(d20 > KNOT_EPSILON)
      ? straightFirst
      : {
          x:
            p1.x +
            (d21 *
              ((p1.x - p0.x) / d10 -
                (p2.x - p0.x) / d20 +
                (p2.x - p1.x) / d21)) /
              3,
          y:
            p1.y +
            (d21 *
              ((p1.y - p0.y) / d10 -
                (p2.y - p0.y) / d20 +
                (p2.y - p1.y) / d21)) /
              3,
        };
  const second =
    !(d32 > KNOT_EPSILON) || !(d31 > KNOT_EPSILON)
      ? straightSecond
      : {
          x:
            p2.x -
            (d21 *
              ((p2.x - p1.x) / d21 -
                (p3.x - p1.x) / d31 +
                (p3.x - p2.x) / d32)) /
              3,
          y:
            p2.y -
            (d21 *
              ((p2.y - p1.y) / d21 -
                (p3.y - p1.y) / d31 +
                (p3.y - p2.y) / d32)) /
              3,
        };
  return [first, second];
}

/**
 * A projected loop as a ring: finite points only, and without the trailing
 * repeat of the first point that `stitch` always leaves on a closed loop.
 */
function ringOf(loop: readonly RegionPoint[]): RegionPoint[] {
  const ring = loop.filter(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
  );
  while (
    ring.length > 1 &&
    Math.hypot(
      ring[ring.length - 1].x - ring[0].x,
      ring[ring.length - 1].y - ring[0].y,
    ) < RING_WELD
  ) {
    ring.pop();
  }
  return ring;
}

export function regionPathFor(
  view: Window | null,
  loops: readonly (readonly RegionPoint[])[],
  project: (point: RegionPoint) => RegionPoint,
): Path2D | null {
  const constructor = (view as any)?.Path2D as typeof Path2D | undefined;
  if (!constructor) return null;
  const path = new constructor();
  for (const loop of loops) {
    // Projected first, then fitted: the projection is a uniform similarity,
    // so the shape is the same either way, but fitting afterwards puts the
    // epsilons in device pixels, where "degenerate" means "sub-pixel".
    const ring = ringOf(loop.map(project));
    if (!ring.length) continue;
    path.moveTo(ring[0].x, ring[0].y);
    if (ring.length < 3) {
      // No curve to fit through two points.
      for (const point of ring.slice(1)) path.lineTo(point.x, point.y);
      path.closePath();
      continue;
    }
    for (let index = 0; index < ring.length; index += 1) {
      const p0 = ring[(index - 1 + ring.length) % ring.length];
      const p1 = ring[index];
      const p2 = ring[(index + 1) % ring.length];
      const p3 = ring[(index + 2) % ring.length];
      const [first, second] = segmentControls(p0, p1, p2, p3);
      path.bezierCurveTo(first.x, first.y, second.x, second.y, p2.x, p2.y);
    }
    path.closePath();
  }
  return path;
}

/** Today's falloff, as a fraction of the plot's larger side. */
const FALLOFF_FRACTION = 0.06;
/**
 * One zoom bucket. About 12%: small enough that the shape reads as following
 * the zoom rather than jumping, large enough that a slow zoom across the whole
 * range recomputes a handful of times rather than once per wheel notch.
 */
const ZOOM_STEP = 1.12;
/**
 * The tightening stops at roughly 8x past the fit (`1.12 ** 18 ≈ 7.7`).
 *
 * This floor is about work and memory, not looks. The grid grows
 * quadratically with the tightening and nothing else stops it: the viewport
 * scale clamps at 8 while the fit scale can sit well below 1, so a ratio in
 * the twenties is reachable on an ordinary graph. The honest cost is that
 * past 8x the halo starts growing on screen again.
 */
const MAX_ZOOM_BUCKET = 18;
/** `pitch = radius / 5`, which is `spread * 0.012` at bucket 0. */
const PITCH_DIVISOR = 5;

/**
 * The scale at which the laid-out papers just fill the plot.
 *
 * Computed, not remembered. Latching the scale of the last `fitView()` was
 * rejected: a saved graph restores a transform and may never fit at all, so
 * the latch would be undefined at first paint, and pressing "Fit" would
 * silently redefine where the halo starts tightening — a viewport control
 * quietly editing a drawing rule.
 *
 * On a whole-graph fit this is deliberately an upper bound on `fitView`'s own
 * scale, which divides a smaller box (canvas minus axis gutters) by a larger
 * extent (positions plus label padding). So pressing "Fit" lands at or below
 * the crossover, in bucket 0, at today's radius.
 *
 * Zero when there is no usable fit, which the callers read as bucket 0.
 */
export function regionFitScale(
  plotWidth: number,
  plotHeight: number,
  extentWidth: number,
  extentHeight: number,
): number {
  const byWidth = extentWidth > 0 ? plotWidth / extentWidth : Infinity;
  const byHeight = extentHeight > 0 ? plotHeight / extentHeight : Infinity;
  const fit = Math.min(byWidth, byHeight);
  return Number.isFinite(fit) && fit > 0 ? fit : 0;
}

/**
 * How many 12% steps past the fit zoom the view is, clamped to `[0, 18]`.
 *
 * Clamping at zero is what makes "at or below the fit is unchanged" exact:
 * every scale at or below the fit lands in bucket 0, and bucket 0's radius is
 * `spread * 0.06` to the last bit.
 */
export function regionZoomBucket(scale: number, fitScale: number): number {
  if (!(scale > 0) || !(fitScale > 0)) return 0;
  const steps = Math.log(scale / fitScale) / Math.log(ZOOM_STEP);
  if (Number.isNaN(steps)) return 0;
  if (steps >= MAX_ZOOM_BUCKET) return MAX_ZOOM_BUCKET;
  return Math.min(MAX_ZOOM_BUCKET, Math.max(0, Math.round(steps)));
}

/**
 * The falloff radius in data units: today's constant at or below the fit
 * zoom, shrinking in inverse proportion to the zoom past it, which is the
 * same statement as the halo holding a constant size on screen.
 *
 * The radius comes from the *bucket*, not from the raw scale, and that is
 * deliberate. If the radius tracked the raw scale while the contour cache key
 * tracked the bucket, two frames sharing a bucket would draw a contour
 * computed at some other frame's radius — a cache that lies. The cost is that
 * the radius moves in 12% steps; it agrees with the continuous rule at every
 * bucket boundary and is never more than 6% from it between them, which is
 * under a third of a grid cell.
 */
export function regionFalloffRadius(
  spread: number,
  scale: number,
  fitScale: number,
): number {
  if (!(spread > 0) || !Number.isFinite(spread)) return 0;
  return (
    spread * FALLOFF_FRACTION * ZOOM_STEP ** -regionZoomBucket(scale, fitScale)
  );
}

/**
 * The grid pitch that goes with a falloff radius.
 *
 * Holding the literal `spread * 0.012` while the radius shrinks under-samples
 * the field: at high zoom the falloff would be narrower than a cell and the
 * contour would break into rubble or vanish. A fixed ratio keeps the contour's
 * fidelity relative to the falloff constant at every zoom.
 */
export function regionGridPitch(radius: number): number {
  return radius / PITCH_DIVISOR;
}
