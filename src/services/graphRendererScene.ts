import type {
  CitationGraphNode,
  GhostPreview,
  GraphAxisMetric,
  GraphScaleType,
} from "../domain/graphTypes";
import { publicationYearOrNull } from "../domain/valueNormalization";
import {
  getExternalWorkMetadata,
  getExternalWorkMetricValue,
  getExternalWorkNodeLabel,
} from "./externalWorkMetricRegistry";
import {
  clamp,
  hashString,
  metricExtent,
  metricNumber,
  numericColor,
  scaleValue,
} from "./graphMetricScale";
import type { GraphTheme } from "./graphTheme";
import {
  createLabelBudget,
  createRectangleIndex,
  createTextWidthCache,
} from "./graphLabelBudget";

interface Position {
  x: number;
  y: number;
}

interface Rectangle {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface RendererSceneContext {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  layout: {
    xMetric: GraphAxisMetric;
    xScale: GraphScaleType;
    yMetric: GraphAxisMetric;
    yScale: GraphScaleType;
    nodeSizeMetric: string;
    nodeColorMetric: string;
    nodeLabelMode: "title" | "author-year" | "none";
  };
  positions: Map<string, Position>;
  /** `positions` projected into canvas device pixels for the current frame. */
  screenPositions: Map<string, Position>;
  /** Device pixels per CSS pixel for the current frame. */
  ratio: number;
  /** The chrome's own font stack, so canvas text matches the DOM around it. */
  fontStack: string;
  projectToScreen(position: Position): Position;
  worldLengthForScreen(cssPixels: number): number;
  selectedKey: string | null;
  hoverKey: string | null;
  ghostPreview: GhostPreview | null;
  layoutNodes(): CitationGraphNode[];
  visibleNodes(): CitationGraphNode[];
  isNodeGhosted(node: CitationGraphNode): boolean;
  axisScale(
    nodes: CitationGraphNode[],
    axis: "x" | "y",
  ): {
    domain: [number, number];
    ticks: number[];
  } | null;
  nodeRadius(node: CitationGraphNode, domain?: [number, number] | null): number;
  isDarkMode(): boolean;
  getTheme(): GraphTheme;
  draw(): void;
}

const WORLD_WIDTH = 1100;
const WORLD_HEIGHT = 760;
const PLOT_LEFT = 105;
const PLOT_RIGHT = 1030;
const PLOT_TOP = 60;
const PLOT_BOTTOM = 675;
/**
 * Where a node whose value for the axis metric is missing is parked. The
 * renderer draws the separator and the NO DATA label for these lanes, so the
 * two have to agree about the world coordinate.
 */
export const MISSING_X = PLOT_LEFT - 35;
export const MISSING_Y = PLOT_BOTTOM + 35;
const NODE_GAP = 7;
const GRID_CELL_SIZE = 48;

function ghostMetricNumber(
  preview: GhostPreview,
  metric: GraphAxisMetric,
): number | null {
  if (metric === "free") return null;
  const direct =
    metric === "year"
      ? publicationYearOrNull(preview.year)
      : metric === "citations"
        ? preview.citationCount
        : metric === "references"
          ? preview.referenceCount
          : getExternalWorkMetricValue(preview.key, metric);
  return typeof direct === "number" && Number.isFinite(direct) ? direct : null;
}

function metricDomain(
  nodes: CitationGraphNode[],
  metric: string,
): [number, number] | null {
  return metricExtent(nodes, metric);
}

function ghostRadius(
  renderer: RendererSceneContext,
  preview: GhostPreview,
  nodes: CitationGraphNode[],
): number {
  const metric = renderer.layout.nodeSizeMetric;
  if (metric === "uniform") return 7;
  const value = getExternalWorkMetricValue(preview.key, metric);
  if (value === null) return 4;
  const domain = metricDomain(nodes, metric);
  if (!domain) return 7;
  if (domain[0] === domain[1]) return 11;
  const normalized = clamp((value - domain[0]) / (domain[1] - domain[0]), 0, 1);
  return Math.sqrt(16 + normalized * (324 - 16));
}

function ghostColor(
  renderer: RendererSceneContext,
  preview: GhostPreview,
  nodes: CitationGraphNode[],
): string {
  const theme = renderer.getTheme();
  const metric = renderer.layout.nodeColorMetric ?? "uniform";
  if (metric === "uniform") return theme.states.uniformFill;
  // A ghost is a preview of a paper that is not in the graph yet, so it belongs
  // to none of the assigned categories. Only a numeric metric can place it.
  if (
    metric === "publication-type" ||
    metric === "provider" ||
    metric === "open-access"
  ) {
    return theme.categorical.noValue;
  }
  const work = getExternalWorkMetadata(preview.key);
  if (metric === "retraction") {
    return work?.isRetracted
      ? theme.states.retracted
      : theme.categorical.noValue;
  }
  const value = getExternalWorkMetricValue(preview.key, metric);
  const domain = metricDomain(nodes, metric);
  if (value === null || !domain) return theme.categorical.noValue;
  const normalized =
    domain[0] === domain[1]
      ? 0.5
      : clamp((value - domain[0]) / (domain[1] - domain[0]), 0, 1);
  return numericColor(normalized, theme);
}

function maximumDisplacement(metric: GraphAxisMetric): number {
  if (metric === "year") return 36;
  if (metric === "free") return 0;
  return 52;
}

function anchorStrength(metric: GraphAxisMetric): number {
  if (metric === "year") return 0.14;
  return 0.09;
}

function gridCoordinate(value: number): number {
  return Math.floor(value / GRID_CELL_SIZE);
}

function gridKey(x: number, y: number): string {
  return `${x}:${y}`;
}

function clampAroundAnchor(
  position: Position,
  anchor: Position,
  maxX: number,
  maxY: number,
): void {
  position.x = clamp(position.x, anchor.x - maxX, anchor.x + maxX);
  position.y = clamp(position.y, anchor.y - maxY, anchor.y + maxY);
  position.x = clamp(position.x, PLOT_LEFT - 45, PLOT_RIGHT + 45);
  position.y = clamp(position.y, PLOT_TOP - 45, PLOT_BOTTOM + 45);
}

function relaxAnchoredNodes(
  renderer: RendererSceneContext,
  nodes: CitationGraphNode[],
  anchors: Map<string, Position>,
): void {
  if (nodes.length < 2) return;
  const ordered = [...nodes].sort((left, right) =>
    left.key.localeCompare(right.key),
  );
  const sizeValues =
    renderer.layout.nodeSizeMetric === "uniform"
      ? []
      : ordered
          .map((node) => metricNumber(node, renderer.layout.nodeSizeMetric))
          .filter((value): value is number => value !== null);
  const sizeDomain: [number, number] | null = sizeValues.length
    ? [Math.min(...sizeValues), Math.max(...sizeValues)]
    : null;
  const radii = new Map(
    ordered.map((node) => [node.key, renderer.nodeRadius(node, sizeDomain)]),
  );
  const maxX = maximumDisplacement(renderer.layout.xMetric);
  const maxY = maximumDisplacement(renderer.layout.yMetric);
  const springX = anchorStrength(renderer.layout.xMetric);
  const springY = anchorStrength(renderer.layout.yMetric);
  const iterations =
    ordered.length <= 500 ? 34 : ordered.length <= 1500 ? 22 : 14;

  for (const node of ordered) {
    const position = renderer.positions.get(node.key);
    const anchor = anchors.get(node.key);
    if (!position || !anchor) continue;
    const seed = hashString(node.key);
    const angle = ((seed % 360) * Math.PI) / 180;
    const jitter = 1.5 + ((seed >>> 9) % 35) / 10;
    position.x = anchor.x + Math.cos(angle) * Math.min(jitter, maxX);
    position.y = anchor.y + Math.sin(angle) * Math.min(jitter, maxY);
    clampAroundAnchor(position, anchor, maxX, maxY);
  }

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const forces = new Map<string, Position>();
    const grid = new Map<string, number[]>();

    for (const [index, node] of ordered.entries()) {
      const position = renderer.positions.get(node.key);
      const anchor = anchors.get(node.key);
      if (!position || !anchor) continue;
      forces.set(node.key, {
        x: (anchor.x - position.x) * springX,
        y: (anchor.y - position.y) * springY,
      });
      const key = gridKey(
        gridCoordinate(position.x),
        gridCoordinate(position.y),
      );
      const entries = grid.get(key) ?? [];
      entries.push(index);
      grid.set(key, entries);
    }

    for (const [index, node] of ordered.entries()) {
      const position = renderer.positions.get(node.key);
      if (!position) continue;
      const cellX = gridCoordinate(position.x);
      const cellY = gridCoordinate(position.y);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (const otherIndex of grid.get(gridKey(cellX + dx, cellY + dy)) ??
            []) {
            if (otherIndex <= index) continue;
            const other = ordered[otherIndex];
            const otherPosition = renderer.positions.get(other.key);
            if (!otherPosition) continue;
            let deltaX = otherPosition.x - position.x;
            let deltaY = otherPosition.y - position.y;
            let distance = Math.hypot(deltaX, deltaY);
            const required =
              (radii.get(node.key) ?? 7) +
              (radii.get(other.key) ?? 7) +
              NODE_GAP;
            if (distance >= required) continue;
            if (distance < 1e-5) {
              const angle =
                ((hashString(`${node.key}\u001f${other.key}`) % 360) *
                  Math.PI) /
                180;
              deltaX = Math.cos(angle);
              deltaY = Math.sin(angle);
              distance = 1;
            }
            const overlap = required - distance;
            const push = overlap * 0.82;
            const unitX = deltaX / distance;
            const unitY = deltaY / distance;
            const leftForce = forces.get(node.key)!;
            const rightForce = forces.get(other.key)!;
            leftForce.x -= unitX * push;
            leftForce.y -= unitY * push;
            rightForce.x += unitX * push;
            rightForce.y += unitY * push;
          }
        }
      }
    }

    let maximumMovement = 0;
    for (const node of ordered) {
      const position = renderer.positions.get(node.key);
      const anchor = anchors.get(node.key);
      const force = forces.get(node.key);
      if (!position || !anchor || !force) continue;
      const movementX = clamp(force.x * 0.62, -8, 8);
      const movementY = clamp(force.y * 0.62, -8, 8);
      position.x += movementX;
      position.y += movementY;
      clampAroundAnchor(position, anchor, maxX, maxY);
      maximumMovement = Math.max(
        maximumMovement,
        Math.hypot(movementX, movementY),
      );
    }
    if (maximumMovement < 0.08) break;
  }

  // Finish with a collision-only pass. The spring phase keeps every node near
  // its metric anchor; this pass removes the small residual overlaps left at
  // the spring/repulsion equilibrium without changing the anchor limits.
  for (let pass = 0; pass < 10; pass += 1) {
    const grid = new Map<string, number[]>();
    for (const [index, node] of ordered.entries()) {
      const position = renderer.positions.get(node.key);
      if (!position) continue;
      const key = gridKey(
        gridCoordinate(position.x),
        gridCoordinate(position.y),
      );
      const entries = grid.get(key) ?? [];
      entries.push(index);
      grid.set(key, entries);
    }
    let corrected = false;
    for (const [index, node] of ordered.entries()) {
      const position = renderer.positions.get(node.key);
      if (!position) continue;
      const cellX = gridCoordinate(position.x);
      const cellY = gridCoordinate(position.y);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (const otherIndex of grid.get(gridKey(cellX + dx, cellY + dy)) ??
            []) {
            if (otherIndex <= index) continue;
            const other = ordered[otherIndex];
            const otherPosition = renderer.positions.get(other.key);
            const anchor = anchors.get(node.key);
            const otherAnchor = anchors.get(other.key);
            if (!otherPosition || !anchor || !otherAnchor) continue;
            let deltaX = otherPosition.x - position.x;
            let deltaY = otherPosition.y - position.y;
            let distance = Math.hypot(deltaX, deltaY);
            const required =
              (radii.get(node.key) ?? 7) +
              (radii.get(other.key) ?? 7) +
              NODE_GAP;
            if (distance >= required - 0.02) continue;
            if (distance < 1e-5) {
              const angle =
                ((hashString(`${node.key}\u001f${other.key}`) % 360) *
                  Math.PI) /
                180;
              deltaX = Math.cos(angle);
              deltaY = Math.sin(angle);
              distance = 1;
            }
            const correction = (required - distance) / 2 + 0.08;
            const unitX = deltaX / distance;
            const unitY = deltaY / distance;
            position.x -= unitX * correction;
            position.y -= unitY * correction;
            otherPosition.x += unitX * correction;
            otherPosition.y += unitY * correction;
            clampAroundAnchor(position, anchor, maxX, maxY);
            clampAroundAnchor(otherPosition, otherAnchor, maxX, maxY);
            corrected = true;
          }
        }
      }
    }
    if (!corrected) break;
  }
}

/**
 * Measured label widths, kept between frames. The label font is fixed in screen
 * space, so a width is valid until the string or the font changes and both are
 * in the key — one cache for the module is enough, and it survives the pan that
 * used to re-measure every visible label sixty times a second.
 */
const labelWidths = createTextWidthCache();

/**
 * The label-placement bounds are a world rectangle around the plot, projected
 * into device pixels so labels can be tested in the same space they are drawn.
 */
function labelBounds(renderer: RendererSceneContext): Rectangle {
  const topLeft = renderer.projectToScreen({
    x: PLOT_LEFT - 45,
    y: PLOT_TOP - 25,
  });
  const bottomRight = renderer.projectToScreen({
    x: PLOT_RIGHT + 115,
    y: PLOT_BOTTOM + 40,
  });
  return {
    left: topLeft.x,
    right: bottomRight.x,
    top: topLeft.y,
    bottom: bottomRight.y,
  };
}

function withinLabelBounds(rectangle: Rectangle, bounds: Rectangle): boolean {
  return (
    rectangle.left >= bounds.left &&
    rectangle.right <= bounds.right &&
    rectangle.top >= bounds.top &&
    rectangle.bottom <= bounds.bottom
  );
}

export function projectRendererPositions(
  renderer: RendererSceneContext,
  preserveFreeX = false,
  preserveFreeY = false,
): void {
  // Filters must not change the graph's coordinate system. Project every
  // local node so a selected paper keeps exactly the position it had before
  // being filtered out.
  const nodes = renderer.layoutNodes();
  const xScale = renderer.axisScale(nodes, "x");
  const yScale = renderer.axisScale(nodes, "y");
  const anchors = new Map<string, Position>();

  for (const [index, node] of nodes.entries()) {
    const position = renderer.positions.get(node.key);
    if (!position) continue;
    let x = position.x;
    let y = position.y;

    if (renderer.layout.xMetric === "free") {
      if (!preserveFreeX) {
        const angle = (index * 2.399963229728653) % (Math.PI * 2);
        x =
          WORLD_WIDTH / 2 + Math.cos(angle) * (60 + Math.sqrt(index + 1) * 18);
      }
    } else if (xScale) {
      const value = metricNumber(node, renderer.layout.xMetric);
      x =
        value === null || (renderer.layout.xScale === "log" && value <= 0)
          ? MISSING_X
          : PLOT_LEFT +
            clamp(
              scaleValue(
                value,
                xScale.domain[0],
                xScale.domain[1],
                renderer.layout.xScale,
              ),
              0,
              1,
            ) *
              (PLOT_RIGHT - PLOT_LEFT);
    }

    if (renderer.layout.yMetric === "free") {
      if (!preserveFreeY) {
        const angle = (index * 2.399963229728653) % (Math.PI * 2);
        y =
          WORLD_HEIGHT / 2 + Math.sin(angle) * (60 + Math.sqrt(index + 1) * 18);
      }
    } else if (yScale) {
      const value = metricNumber(node, renderer.layout.yMetric);
      y =
        value === null || (renderer.layout.yScale === "log" && value <= 0)
          ? MISSING_Y
          : PLOT_BOTTOM -
            clamp(
              scaleValue(
                value,
                yScale.domain[0],
                yScale.domain[1],
                renderer.layout.yScale,
              ),
              0,
              1,
            ) *
              (PLOT_BOTTOM - PLOT_TOP);
    }

    position.x = x;
    position.y = y;
    anchors.set(node.key, { x, y });
  }

  if (
    renderer.layout.xMetric !== "free" &&
    renderer.layout.yMetric !== "free"
  ) {
    relaxAnchoredNodes(renderer, nodes, anchors);
  }
}

export function hitTestRenderer(
  renderer: RendererSceneContext,
  x: number,
  y: number,
): CitationGraphNode | null {
  const nodes = renderer.visibleNodes();
  const sizeValues =
    renderer.layout.nodeSizeMetric === "uniform"
      ? []
      : renderer
          .layoutNodes()
          .map((node) => metricNumber(node, renderer.layout.nodeSizeMetric))
          .filter((value): value is number => value !== null);
  const sizeDomain: [number, number] | null = sizeValues.length
    ? [Math.min(...sizeValues), Math.max(...sizeValues)]
    : null;
  let best: CitationGraphNode | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const node of nodes) {
    const position = renderer.positions.get(node.key);
    if (!position) continue;
    // The node is drawn at a fixed size on screen, so its world-space reach
    // shrinks as the view zooms in. Test against that, not against the raw
    // radius, or the hit target drifts away from what the pointer can see.
    const radius = renderer.worldLengthForScreen(
      renderer.nodeRadius(node, sizeDomain),
    );
    const tolerance = renderer.worldLengthForScreen(6);
    const distance = Math.hypot(position.x - x, position.y - y);
    if (distance > radius + tolerance) continue;
    // A world radius is no longer bounded below by MIN_NODE_RADIUS — at 8x it
    // is a fraction of a unit — so the ranking floor has to be an epsilon
    // rather than 1, which would flatten the ordering when zoomed in.
    const score = distance / Math.max(1e-6, radius);
    const priority =
      node.key === renderer.selectedKey
        ? -0.1
        : node.key === renderer.hoverKey
          ? -0.05
          : 0;
    if (score + priority < bestScore) {
      best = node;
      bestScore = score + priority;
    }
  }
  return best;
}

export function drawRendererLabels(
  renderer: RendererSceneContext,
  nodes: CitationGraphNode[],
  radii: Map<string, number>,
): void {
  if (renderer.layout.nodeLabelMode === "none") return;
  const context = renderer.context;
  // No node-count cliff any more: every node is a candidate, ordered by
  // importance, and the budget below decides where to stop. A 219-node graph
  // and a 221-node one now differ by one label rather than by all of them.
  const ordered = [...nodes].sort((left, right) => {
    const priority = (node: CitationGraphNode): number =>
      node.key === renderer.selectedKey
        ? 3
        : node.key === renderer.hoverKey
          ? 2
          : 1;
    return (
      priority(right) - priority(left) ||
      (right.citationCount ?? -1) - (left.citationCount ?? -1) ||
      left.key.localeCompare(right.key)
    );
  });

  const ratio = renderer.ratio;
  const bounds = labelBounds(renderer);
  const font = `${11 * ratio}px ${renderer.fontStack}`;
  context.save();
  context.font = font;
  context.textBaseline = "middle";
  // Node rectangles and placed labels share one spatial index — the loop used
  // to concatenate both arrays and test all of them for each of eight
  // candidates per label, which is the quadratic cost the 220-node cliff was
  // hiding. A candidate now only meets the rectangles in its own cells.
  const obstacles = createRectangleIndex();
  for (const node of nodes) {
    const position = renderer.screenPositions.get(node.key);
    if (!position) continue;
    const radius = (radii.get(node.key) ?? 7 * ratio) + 3 * ratio;
    obstacles.insert({
      left: position.x - radius,
      right: position.x + radius,
      top: position.y - radius,
      bottom: position.y + radius,
    });
  }
  // The budget is a share of the plot that is actually on screen, so zooming
  // in — which grows the visible plot without adding nodes — reveals more
  // labels continuously rather than at a threshold.
  const visible = {
    left: Math.max(bounds.left, 0),
    right: Math.min(bounds.right, renderer.canvas.width),
    top: Math.max(bounds.top, 0),
    bottom: Math.min(bounds.bottom, renderer.canvas.height),
  };
  const budget = createLabelBudget(
    Math.max(0, visible.right - visible.left) *
      Math.max(0, visible.bottom - visible.top),
  );

  for (const node of ordered) {
    const position = renderer.screenPositions.get(node.key);
    if (!position) continue;
    // Selected and hovered nodes are always labelled; they sort first, so the
    // budget can stop the loop outright once it is spent.
    const important =
      node.key === renderer.selectedKey || node.key === renderer.hoverKey;
    if (!important && !budget.hasRoom()) break;
    const label =
      renderer.layout.nodeLabelMode === "author-year"
        ? `${node.authors[0]?.split(/\s+/).at(-1) ?? "Unknown"}${node.year ? ` (${node.year})` : ""}`
        : node.title;
    const shortened = label.length > 42 ? `${label.slice(0, 39)}…` : label;
    const width =
      Math.ceil(labelWidths.width(context, font, shortened)) + 4 * ratio;
    const height = 14 * ratio;
    const radius = radii.get(node.key) ?? 7 * ratio;
    const gap = radius + 6 * ratio;
    const candidates = [
      { x: position.x + gap, y: position.y, align: "left" as const },
      { x: position.x - gap, y: position.y, align: "right" as const },
      {
        x: position.x,
        y: position.y - gap - 4 * ratio,
        align: "center" as const,
      },
      {
        x: position.x,
        y: position.y + gap + 4 * ratio,
        align: "center" as const,
      },
      { x: position.x + gap, y: position.y - gap, align: "left" as const },
      { x: position.x + gap, y: position.y + gap, align: "left" as const },
      { x: position.x - gap, y: position.y - gap, align: "right" as const },
      { x: position.x - gap, y: position.y + gap, align: "right" as const },
    ];

    const evaluated = candidates.map((candidate) => {
      const left =
        candidate.align === "left"
          ? candidate.x
          : candidate.align === "right"
            ? candidate.x - width
            : candidate.x - width / 2;
      const rectangle: Rectangle = {
        left,
        right: left + width,
        top: candidate.y - height / 2,
        bottom: candidate.y + height / 2,
      };
      const overlap = obstacles.overlap(rectangle);
      return {
        ...candidate,
        rectangle,
        overlap: withinLabelBounds(rectangle, bounds)
          ? overlap
          : overlap + 1_000_000,
      };
    });
    const clearCandidate = evaluated.find(
      (candidate) => candidate.overlap === 0,
    );
    const chosen =
      clearCandidate ??
      (important
        ? evaluated.reduce((best, candidate) =>
            candidate.overlap < best.overlap ? candidate : best,
          )
        : null);
    if (!chosen) {
      budget.failed();
      continue;
    }

    obstacles.insert(chosen.rectangle);
    if (!important) budget.placed(width * height);
    const defaultPlacement = chosen === evaluated[0];
    if (!defaultPlacement) {
      const labelEdgeX = clamp(
        position.x,
        chosen.rectangle.left,
        chosen.rectangle.right,
      );
      const labelEdgeY = clamp(
        position.y,
        chosen.rectangle.top,
        chosen.rectangle.bottom,
      );
      context.beginPath();
      context.moveTo(position.x, position.y);
      context.lineTo(labelEdgeX, labelEdgeY);
      context.strokeStyle = renderer.getTheme().inks.muted;
      context.lineWidth = 0.8 * ratio;
      context.stroke();
    }

    const ghosted = renderer.isNodeGhosted(node);
    context.globalAlpha = ghosted ? 0.58 : 1;
    context.textAlign = chosen.align;
    context.fillStyle = renderer.getTheme().inks.primary;
    context.fillText(shortened, chosen.x, chosen.y);
    context.globalAlpha = 1;
  }
  context.restore();
}

export function drawRendererGhost(
  renderer: RendererSceneContext,
  preview: GhostPreview,
): void {
  const ratio = renderer.ratio;
  const sources = preview.sourceKeys
    .map((key) => renderer.screenPositions.get(key))
    .filter((position): position is Position => Boolean(position));
  // The scatter placement below is world-space, like the axis scales it reads
  // from; only the final position is projected.
  const worldSources = preview.sourceKeys
    .map((key) => renderer.positions.get(key))
    .filter((position): position is Position => Boolean(position));
  const centroidX = worldSources.length
    ? worldSources.reduce((sum, source) => sum + source.x, 0) /
      worldSources.length
    : (PLOT_LEFT + PLOT_RIGHT) / 2;
  const centroidY = worldSources.length
    ? worldSources.reduce((sum, source) => sum + source.y, 0) /
      worldSources.length
    : (PLOT_TOP + PLOT_BOTTOM) / 2;
  const seed = hashString(preview.key);
  const angle = ((seed % 360) * Math.PI) / 180;
  const radius = 70 + (seed % 31);
  let x = clamp(centroidX + Math.cos(angle) * radius, PLOT_LEFT, PLOT_RIGHT);
  let y = clamp(centroidY + Math.sin(angle) * radius, PLOT_TOP, PLOT_BOTTOM);

  // External previews use the same full-graph metric domains as local nodes.
  // This keeps previews aligned with stable axes while filters are active.
  const nodes = renderer.layoutNodes();
  const displayedRadius = ghostRadius(renderer, preview, nodes) * ratio;
  const displayedColor = ghostColor(renderer, preview, nodes);
  const xScale = renderer.axisScale(nodes, "x");
  const yScale = renderer.axisScale(nodes, "y");
  const xValue = ghostMetricNumber(preview, renderer.layout.xMetric);
  const yValue = ghostMetricNumber(preview, renderer.layout.yMetric);
  const missingX =
    renderer.layout.xMetric !== "free" &&
    (xValue === null || (renderer.layout.xScale === "log" && xValue <= 0));
  const missingY =
    renderer.layout.yMetric !== "free" &&
    (yValue === null || (renderer.layout.yScale === "log" && yValue <= 0));

  if (renderer.layout.xMetric !== "free") {
    if (missingX) {
      x = MISSING_X;
    } else if (xScale && xValue !== null) {
      x =
        PLOT_LEFT +
        clamp(
          scaleValue(
            xValue,
            xScale.domain[0],
            xScale.domain[1],
            renderer.layout.xScale,
          ),
          0,
          1,
        ) *
          (PLOT_RIGHT - PLOT_LEFT);
    }
  }
  if (renderer.layout.yMetric !== "free") {
    if (missingY) {
      y = MISSING_Y;
    } else if (yScale && yValue !== null) {
      y =
        PLOT_BOTTOM -
        clamp(
          scaleValue(
            yValue,
            yScale.domain[0],
            yScale.domain[1],
            renderer.layout.yScale,
          ),
          0,
          1,
        ) *
          (PLOT_BOTTOM - PLOT_TOP);
    }
  }

  const screen = renderer.projectToScreen({ x, y });
  const context = renderer.context;
  context.save();
  context.setLineDash([6 * ratio, 5 * ratio]);
  context.lineWidth = ratio;
  for (const source of sources) {
    context.beginPath();
    context.moveTo(source.x, source.y);
    context.lineTo(screen.x, screen.y);
    context.strokeStyle = renderer.getTheme().inks.muted;
    context.stroke();
  }
  context.beginPath();
  context.arc(screen.x, screen.y, displayedRadius, 0, Math.PI * 2);
  context.fillStyle = displayedColor;
  context.globalAlpha = 0.72;
  context.fill();
  context.globalAlpha = 1;
  context.lineWidth = 1.5 * ratio;
  context.strokeStyle = renderer.getTheme().surfaces.hairline;
  context.stroke();
  context.setLineDash([]);
  if (missingX || missingY) {
    context.fillStyle = renderer.getTheme().inks.primary;
    context.font = `600 ${11 * ratio}px ${renderer.fontStack}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("?", screen.x, screen.y + 0.5 * ratio);
  }
  const label = getExternalWorkNodeLabel(
    preview.key,
    renderer.layout.nodeLabelMode,
    preview.title,
    preview.authors,
    preview.year,
  );
  if (label) {
    const shortened = label.length > 42 ? `${label.slice(0, 39)}…` : label;
    context.fillStyle = renderer.getTheme().inks.primary;
    context.font = `${11 * ratio}px ${renderer.fontStack}`;
    context.textAlign = "center";
    context.textBaseline = "alphabetic";
    context.fillText(
      shortened,
      screen.x,
      screen.y + displayedRadius + 13 * ratio,
    );
  }
  context.restore();
}
