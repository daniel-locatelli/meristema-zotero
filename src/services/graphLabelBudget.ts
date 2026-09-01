/**
 * What decides how many node labels get drawn, and what makes deciding cheap.
 *
 * The renderer used to stop labelling entirely above 220 nodes — a cliff, so a
 * 219-node graph was covered in text and a 221-node one had none. Two things
 * replace it. `createLabelBudget` places labels in importance order until they
 * occupy a fraction of the plot or stop finding room, so density rather than
 * node count decides where to stop, and zooming in reveals more continuously
 * because the same labels occupy less of a larger plot.
 *
 * The second stop is a cap on how many candidates get considered at all. It was
 * a cap on *consecutive* failures until the graph was first looked at running;
 * see `LABEL_ATTEMPT_LIMIT` for what that cost.
 *
 * `createRectangleIndex` is what makes that affordable. The placement loop used
 * to build a fresh array of every node rectangle plus every placed label for
 * each of eight candidate positions per label, and test all of them — quadratic
 * in the node count, per frame, and the reason the cliff existed at all. The
 * index buckets rectangles by grid cell so a candidate only tests the ones that
 * could actually touch it. `test/unit/graphLabelBudget.test.ts` pins that it
 * agrees with the brute-force sum on a fixed fixture.
 */

export interface LabelRectangle {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The area two rectangles share. Zero when they merely touch or miss. */
export function overlapArea(
  left: LabelRectangle,
  right: LabelRectangle,
): number {
  const width = Math.max(
    0,
    Math.min(left.right, right.right) - Math.max(left.left, right.left),
  );
  const height = Math.max(
    0,
    Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top),
  );
  return width * height;
}

/**
 * The grid cell edge, in device pixels. A label is about 14 device pixels tall
 * and a hundred wide at ratio 1, so a cell this size keeps most rectangles
 * inside two or three cells while still excluding almost everything.
 */
export const LABEL_GRID_CELL = 64;

export interface RectangleIndex {
  insert(rectangle: LabelRectangle): void;
  /** Total area `rectangle` shares with everything inserted so far. */
  overlap(rectangle: LabelRectangle): number;
}

function cellRange(
  rectangle: LabelRectangle,
  cellSize: number,
): { minX: number; maxX: number; minY: number; maxY: number } {
  return {
    minX: Math.floor(rectangle.left / cellSize),
    maxX: Math.floor(rectangle.right / cellSize),
    minY: Math.floor(rectangle.top / cellSize),
    maxY: Math.floor(rectangle.bottom / cellSize),
  };
}

/**
 * A spatial hash over rectangles. A rectangle is filed under every cell it
 * covers, so a query has to de-duplicate before summing or a wide rectangle
 * would be counted once per cell it spans — the cells hold indices into one
 * flat array for exactly that reason.
 */
export function createRectangleIndex(
  cellSize: number = LABEL_GRID_CELL,
): RectangleIndex {
  const rectangles: LabelRectangle[] = [];
  const cells = new Map<string, number[]>();
  const size = Math.max(1, cellSize);

  return {
    insert(rectangle: LabelRectangle): void {
      const index = rectangles.length;
      rectangles.push(rectangle);
      const range = cellRange(rectangle, size);
      for (let x = range.minX; x <= range.maxX; x += 1) {
        for (let y = range.minY; y <= range.maxY; y += 1) {
          const key = `${x}:${y}`;
          const bucket = cells.get(key);
          if (bucket) bucket.push(index);
          else cells.set(key, [index]);
        }
      }
    },
    overlap(rectangle: LabelRectangle): number {
      const range = cellRange(rectangle, size);
      const seen = new Set<number>();
      let total = 0;
      for (let x = range.minX; x <= range.maxX; x += 1) {
        for (let y = range.minY; y <= range.maxY; y += 1) {
          for (const index of cells.get(`${x}:${y}`) ?? []) {
            if (seen.has(index)) continue;
            seen.add(index);
            total += overlapArea(rectangle, rectangles[index]);
          }
        }
      }
      return total;
    },
  };
}

/** The share of the plot labels may cover before the budget calls it enough. */
export const LABEL_AREA_FRACTION = 0.18;

/**
 * Candidates the budget will consider before it stops, placed or not.
 *
 * This replaces a limit of 14 *consecutive* failures, which the first look at a
 * running graph showed to be wrong: labels are tried in citation order, the
 * most-cited papers are exactly the ones heaped together at the top of a
 * citations axis, and so the first fourteen candidates were all buried and the
 * pass ended having placed one label on a 500-node graph — with two thirds of
 * the plot empty and willing. A run of misses in one dense corner is not
 * evidence that the sparse corners are full.
 *
 * Counting every attempt instead keeps the bound the consecutive count was
 * really there for — the loop is O(attempts), not O(nodes) — while letting the
 * walk past a crowded neighbourhood reach the open space behind it.
 */
export const LABEL_ATTEMPT_LIMIT = 600;

export interface LabelBudget {
  /** Whether an ordinary — unselected, unhovered — label may still be tried. */
  hasRoom(): boolean;
  /** Record that a label of this area was placed. */
  placed(area: number): void;
  /** Record that a label found no clear position. */
  failed(): void;
}

/**
 * Two independent stops, because they catch different graphs. The area share
 * stops a sparse graph whose labels all find room but would tile the plot; the
 * attempt count stops a dense one where most candidates are buried, before the
 * loop grinds through thousands of them.
 */
export function createLabelBudget(
  plotArea: number,
  areaFraction: number = LABEL_AREA_FRACTION,
  attemptLimit: number = LABEL_ATTEMPT_LIMIT,
): LabelBudget {
  const allowance = Math.max(0, plotArea) * areaFraction;
  let used = 0;
  let attempts = 0;
  return {
    hasRoom(): boolean {
      return used < allowance && attempts < attemptLimit;
    },
    placed(area: number): void {
      used += Math.max(0, area);
      attempts += 1;
    },
    failed(): void {
      attempts += 1;
    },
  };
}

export interface TextMeasurer {
  measureText(text: string): { width: number };
}

export interface TextWidthCache {
  width(measurer: TextMeasurer, font: string, text: string): number;
}

/**
 * Measured label widths, kept across frames.
 *
 * `measureText` was called once per label per frame, which on a pan is the same
 * few hundred strings measured sixty times a second. Since Task 2 the label
 * font is fixed in screen space, so a width only changes when the string or the
 * font does — and the font is part of the key, so a resize that changes the
 * device pixel ratio simply starts a new generation of entries rather than
 * returning stale ones.
 */
export function createTextWidthCache(limit = 4096): TextWidthCache {
  const widths = new Map<string, number>();
  return {
    width(measurer: TextMeasurer, font: string, text: string): number {
      const key = `${font}${text}`;
      const cached = widths.get(key);
      if (cached !== undefined) return cached;
      const measured = measurer.measureText(text).width;
      // A graph whose labels all change every frame would otherwise grow this
      // without limit; dropping the whole map is cheaper than tracking ages,
      // and the next frame re-measures only what it actually draws.
      if (widths.size >= limit) widths.clear();
      widths.set(key, measured);
      return measured;
    },
  };
}
