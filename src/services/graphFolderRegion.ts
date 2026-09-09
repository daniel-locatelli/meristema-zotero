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

/** Each paper contributes a smooth bump with compact support. */
function fieldAt(
  points: readonly RegionPoint[],
  x: number,
  y: number,
  radius: number,
): number {
  const squared = radius * radius;
  let total = 0;
  for (const point of points) {
    const dx = x - point.x;
    const dy = y - point.y;
    const distance = dx * dx + dy * dy;
    if (distance < squared) total += 1 - distance / squared;
  }
  return total;
}

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

  const columns = Math.ceil((maxX - minX) / pitch) + 1;
  const rows = Math.ceil((maxY - minY) / pitch) + 1;

  const values: number[][] = [];
  for (let row = 0; row < rows; row += 1) {
    const line: number[] = [];
    for (let column = 0; column < columns; column += 1) {
      line.push(
        fieldAt(points, minX + column * pitch, minY + row * pitch, radius),
      );
    }
    values.push(line);
  }

  const segments: Array<[RegionPoint, RegionPoint]> = [];
  for (let row = 0; row + 1 < rows; row += 1) {
    for (let column = 0; column + 1 < columns; column += 1) {
      const left = minX + column * pitch;
      const right = left + pitch;
      const top = minY + row * pitch;
      const bottom = top + pitch;
      segments.push(
        ...cellSegments(
          [
            { x: left, y: top },
            { x: right, y: top },
            { x: right, y: bottom },
            { x: left, y: bottom },
          ],
          [
            values[row][column],
            values[row][column + 1],
            values[row + 1][column + 1],
            values[row + 1][column],
          ],
          threshold,
        ),
      );
    }
  }

  return stitch(segments);
}
