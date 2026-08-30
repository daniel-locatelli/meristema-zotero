import type {
  CitationGraphModel,
  CitationGraphNode,
  GhostPreview,
  GraphLayoutOptions,
  GraphNodeColorMetric,
  MetricID,
} from "../domain/graphTypes";
import { formatMetricValue, getMetricDefinition } from "./metricRegistry";
import {
  axisTicksForVisibleDomain,
  visibleMetricDomain,
  type GraphAxisViewport,
} from "./graphAxisTickEnhancer";
import { ensureExternalWorkMetrics } from "./externalWorkMetricRegistry";
import {
  drawRendererGhost,
  drawRendererLabels,
  hitTestRenderer,
  projectRendererPositions,
  type RendererSceneContext,
} from "./graphRendererScene";
import { isFilteredPreservedNode, renderedGraphKeys } from "./graphVisibility";
import {
  axisScaleForNodes,
  clamp,
  metricExtent,
  metricNumber,
  numericColor,
  scaleValue,
  type AxisScale,
} from "./graphMetricScale";
import {
  graphThemeFor,
  observeGraphScheme,
  resolveGraphScheme,
  type GraphTheme,
} from "./graphTheme";
import {
  assignCategories,
  type CategoryAssignment,
} from "./graphCategoryAssignment";
import {
  devicePixelScale,
  projectToScreen,
  projectToWorld,
  screenLengthToWorld,
} from "./graphViewport";

interface Position {
  x: number;
  y: number;
}

interface FitViewOptions {
  /**
   * Include the complete metric plot rectangle in the fitted bounds. This is
   * useful for the library-wide analytical view, but it makes a small Focus
   * neighbourhood appear unnecessarily distant from the user.
   */
  includeAxisBounds?: boolean;
  /** Maximum zoom applied by the fit operation. */
  maxScale?: number;
}

export interface GraphViewTransform {
  x: number;
  y: number;
  scale: number;
}

export interface CitationGraphRendererOptions {
  canvas: HTMLCanvasElement;
  model: CitationGraphModel;
  layout: GraphLayoutOptions;
  /** Display names for the collections a colouring can name. */
  collectionLabels: ReadonlyMap<number, string>;
  onSelectionChange: (node: CitationGraphNode | null) => void;
  onOpenNode: (node: CitationGraphNode) => void;
  onBackgroundInteraction?: () => void;
}

const WORLD_WIDTH = 1100;
const WORLD_HEIGHT = 760;
const PLOT_LEFT = 105;
const PLOT_RIGHT = 1030;
const PLOT_TOP = 60;
const PLOT_BOTTOM = 675;
/**
 * Node radii are CSS pixels on screen, not world units: they are multiplied by
 * the canvas's device pixel scale when drawn and stay that size at every zoom.
 * The layout relaxation still spaces nodes by these numbers in world units,
 * which is what keeps a fitted view roughly free of overlap.
 */
const MIN_NODE_RADIUS = 4;
const MAX_NODE_RADIUS = 18;
const MAX_CANVAS_DIMENSION = 8192;
const MAX_CANVAS_PIXELS = 16_777_216;

function isMetricID(value: GraphNodeColorMetric): value is MetricID {
  return ![
    "collection",
    "publication-type",
    "provider",
    "open-access",
    "retraction",
  ].includes(value);
}

export class CitationGraphRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly model: CitationGraphModel;
  private readonly positions = new Map<string, Position>();
  /**
   * The world positions projected into canvas device pixels, refreshed once per
   * frame. Every draw call reads this rather than applying the transform to the
   * canvas context, so text, strokes and radii keep a fixed size as the view
   * zooms.
   */
  private readonly screenPositions = new Map<string, Position>();
  /** Device pixels per CSS pixel, refreshed once per frame. */
  private ratio = 1;
  private readonly collectionLabels: ReadonlyMap<number, string>;
  private theme: GraphTheme = graphThemeFor("light");
  private categoryAssignment: CategoryAssignment | null = null;
  private categoryAssignmentKey = "";
  private readonly onSelectionChange: (node: CitationGraphNode | null) => void;
  private readonly onOpenNode: (node: CitationGraphNode) => void;
  private readonly onBackgroundInteraction: () => void;
  private visibleKeys: Set<string>;
  private searchMatches: Set<string> | null = null;
  private readonly hiddenEdgeKeys = new Set<string>();
  private layout: GraphLayoutOptions;
  private selectedKey: string | null = null;
  private pinnedKeys = new Set<string>();
  private seedKeys = new Set<string>();
  private hoverKey: string | null = null;
  private ghostPreview: GhostPreview | null = null;
  private transform = { x: 0, y: 0, scale: 1 };
  private pointer = {
    down: false,
    panning: false,
    x: 0,
    y: 0,
    startX: 0,
    startY: 0,
    moved: false,
    draggedKey: null as string | null,
  };
  private resizeObserver: ResizeObserver | null = null;
  private disposeSchemeObserver: (() => void) | null = null;
  private initialFitFrame: number | null = null;
  private initialFitComplete = false;
  private canvasError = false;
  private canvasErrorLogged = false;
  private destroyed = false;

  constructor(options: CitationGraphRendererOptions) {
    this.canvas = options.canvas;
    const context = this.canvas.getContext("2d");
    if (!context) throw new Error("Meristema requires a 2D canvas context.");
    this.context = context;
    this.model = options.model;
    this.layout = { ...options.layout };
    this.collectionLabels = options.collectionLabels;
    this.onSelectionChange = options.onSelectionChange;
    this.onOpenNode = options.onOpenNode;
    this.onBackgroundInteraction =
      options.onBackgroundInteraction ?? (() => undefined);
    this.visibleKeys = new Set(this.model.nodes.map((node) => node.key));

    this.initializePositions();
    this.installEvents();

    const view = this.canvas.ownerDocument.defaultView;
    this.theme = graphThemeFor(resolveGraphScheme(view));
    this.disposeSchemeObserver = observeGraphScheme(view, this.onSchemeChange);

    const ResizeObserverConstructor = (view as any)?.ResizeObserver as
      typeof ResizeObserver | undefined;
    if (ResizeObserverConstructor) {
      this.resizeObserver = new ResizeObserverConstructor(() => {
        this.resizeViewport();
        if (!this.initialFitComplete) this.scheduleInitialFit();
      });
      this.resizeObserver.observe(this.canvas.parentElement ?? this.canvas);
    } else {
      view?.addEventListener("resize", this.resizeViewport);
    }

    this.resizeViewport();
    this.draw();
    this.scheduleInitialFit();
  }

  private axisTickTarget(axis: "x" | "y"): number {
    const rect = this.canvas.getBoundingClientRect();
    const available =
      axis === "x"
        ? Math.max(1, rect.width - 72)
        : Math.max(1, rect.height - 56);
    const spacing = axis === "x" ? 115 : 72;
    const viewportTarget = available / spacing;
    const zoomFactor = Math.sqrt(clamp(this.transform.scale, 0.2, 8));
    return Math.round(
      clamp(viewportTarget * zoomFactor, 2, axis === "x" ? 24 : 28),
    );
  }

  private axisViewport(): GraphAxisViewport {
    const rect = this.canvas.getBoundingClientRect();
    return {
      canvasWidth: this.canvas.width,
      canvasHeight: this.canvas.height,
      canvasCssWidth: rect.width,
      transform: this.transform,
    };
  }

  private axisScale(
    nodes: CitationGraphNode[],
    axis: "x" | "y",
  ): AxisScale | null {
    const metric = axis === "x" ? this.layout.xMetric : this.layout.yMetric;
    const scale = axis === "x" ? this.layout.xScale : this.layout.yScale;
    const base = axisScaleForNodes(nodes, metric, scale, 6);
    if (!base) return null;
    if (metric === "free") return base;
    const visibleDomain = visibleMetricDomain(
      this.axisViewport(),
      axis,
      base.domain,
      scale,
    );
    return {
      domain: base.domain,
      ticks: axisTicksForVisibleDomain(
        visibleDomain,
        metric,
        scale,
        this.axisTickTarget(axis),
      ),
    };
  }

  private scheduleInitialFit(): void {
    if (
      this.destroyed ||
      this.initialFitComplete ||
      this.initialFitFrame !== null
    ) {
      return;
    }
    const view = this.canvas.ownerDocument.defaultView;
    if (!view) return;

    let previousWidth = -1;
    let previousHeight = -1;
    let stableFrames = 0;
    let attempts = 0;
    const check = (): void => {
      this.initialFitFrame = null;
      if (this.destroyed || this.initialFitComplete) return;
      this.resizeViewport();
      const rect = (
        this.canvas.parentElement ?? this.canvas
      ).getBoundingClientRect();
      const ready = rect.width >= 240 && rect.height >= 180;
      if (ready) {
        if (
          Math.abs(rect.width - previousWidth) < 0.5 &&
          Math.abs(rect.height - previousHeight) < 0.5
        ) {
          stableFrames += 1;
        } else {
          stableFrames = 0;
        }
        previousWidth = rect.width;
        previousHeight = rect.height;
        if (stableFrames >= 2) {
          this.fitView();
          return;
        }
      }
      attempts += 1;
      if (attempts < 120) {
        this.initialFitFrame = view.requestAnimationFrame(check);
      }
    };
    this.initialFitFrame = view.requestAnimationFrame(check);
  }

  private markViewAdjusted(): void {
    this.initialFitComplete = true;
    if (this.initialFitFrame !== null) {
      this.canvas.ownerDocument.defaultView?.cancelAnimationFrame(
        this.initialFitFrame,
      );
      this.initialFitFrame = null;
    }
  }

  private initializePositions(): void {
    this.model.nodes.forEach((node, index) => {
      this.initializeNodePosition(node, index);
    });
    this.projectPositionsToLayout();
  }

  private initializeNodePosition(node: CitationGraphNode, index: number): void {
    const angle = (index * 2.399963229728653) % (Math.PI * 2);
    const radius = 25 + Math.sqrt(index + 1) * 17;
    this.positions.set(node.key, {
      x: WORLD_WIDTH / 2 + Math.cos(angle) * radius,
      y: WORLD_HEIGHT / 2 + Math.sin(angle) * radius,
    });
  }

  private installEvents(): void {
    this.canvas.tabIndex = 0;
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);
    this.canvas.addEventListener("pointerleave", this.onPointerLeave);
    this.canvas.addEventListener("dblclick", this.onDoubleClick);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.canvas.addEventListener("keydown", this.onKeyDown);
  }

  private layoutNodes(): CitationGraphNode[] {
    return this.model.nodes;
  }

  private renderedKeys(): Set<string> {
    return renderedGraphKeys(
      this.visibleKeys,
      this.selectedKey,
      this.pinnedKeys,
    );
  }

  private visibleNodes(): CitationGraphNode[] {
    const rendered = this.renderedKeys();
    return this.model.nodes.filter((node) => rendered.has(node.key));
  }

  private isNodeGhosted(node: CitationGraphNode): boolean {
    return isFilteredPreservedNode(
      node.key,
      this.visibleKeys,
      this.selectedKey,
      this.pinnedKeys,
    );
  }

  private visibleEdges() {
    const rendered = this.renderedKeys();
    return this.model.edges.filter(
      (edge) =>
        rendered.has(edge.source) &&
        rendered.has(edge.target) &&
        !this.hiddenEdgeKeys.has(`${edge.source}>${edge.target}`),
    );
  }

  private projectPositionsToLayout(
    preserveFreeX = false,
    preserveFreeY = false,
  ): void {
    projectRendererPositions(
      this as unknown as RendererSceneContext,
      preserveFreeX,
      preserveFreeY,
    );
  }

  private pixelRatio(): number {
    return devicePixelScale(
      this.canvas.width,
      this.canvas.getBoundingClientRect().width,
    );
  }

  /**
   * The only bridge from world coordinates to the canvas. No draw call may read
   * `this.transform` itself.
   */
  private projectToScreen(position: Position): Position {
    return projectToScreen(position, this.transform);
  }

  private screenToWorld(clientX: number, clientY: number): Position {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = devicePixelScale(this.canvas.width, rect.width);
    return projectToWorld(
      { x: (clientX - rect.left) * ratio, y: (clientY - rect.top) * ratio },
      this.transform,
    );
  }

  private nodeRadius(
    node: CitationGraphNode,
    domain?: [number, number] | null,
  ): number {
    const metric = this.layout.nodeSizeMetric;
    if (metric === "uniform") return 7;
    const value = metricNumber(node, metric);
    if (value === null) return MIN_NODE_RADIUS;
    const metricNodes = this.layoutNodes();
    const resolved = domain ?? metricExtent(metricNodes, metric);
    if (!resolved) return 7;
    if (resolved[0] === resolved[1]) {
      const hasMissingValues = metricNodes.some(
        (visibleNode) => metricNumber(visibleNode, metric) === null,
      );
      return hasMissingValues
        ? MAX_NODE_RADIUS
        : (MIN_NODE_RADIUS + MAX_NODE_RADIUS) / 2;
    }
    const normalized = clamp(
      scaleValue(value, resolved[0], resolved[1], "linear"),
      0,
      1,
    );
    return Math.sqrt(
      MIN_NODE_RADIUS * MIN_NODE_RADIUS +
        normalized *
          (MAX_NODE_RADIUS * MAX_NODE_RADIUS -
            MIN_NODE_RADIUS * MIN_NODE_RADIUS),
    );
  }

  /**
   * A CSS-pixel screen length expressed in world units at the current zoom.
   * Hit testing stays in world space while what it must match — the drawn node
   * — is now a fixed size on screen, so the two meet here.
   */
  private worldLengthForScreen(cssPixels: number): number {
    return screenLengthToWorld(cssPixels * this.pixelRatio(), this.transform);
  }

  private hitTest(x: number, y: number): CitationGraphNode | null {
    return hitTestRenderer(this as unknown as RendererSceneContext, x, y);
  }

  private onPointerDown = (event: PointerEvent): void => {
    this.markViewAdjusted();
    this.canvas.setPointerCapture?.(event.pointerId);
    const world = this.screenToWorld(event.clientX, event.clientY);
    const node = this.hitTest(world.x, world.y);
    const canDragNode = Boolean(
      node &&
      (this.layout.xMetric === "free" || this.layout.yMetric === "free"),
    );
    this.pointer = {
      down: true,
      panning: !node,
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      draggedKey: canDragNode ? node!.key : null,
    };
    if (node) {
      this.selectedKey = node.key;
      this.onSelectionChange(node);
      this.draw();
    }
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (this.pointer.down && this.pointer.draggedKey) {
      if (
        Math.hypot(
          event.clientX - this.pointer.startX,
          event.clientY - this.pointer.startY,
        ) > 3
      ) {
        this.pointer.moved = true;
      }
      const position = this.positions.get(this.pointer.draggedKey);
      if (position) {
        const world = this.screenToWorld(event.clientX, event.clientY);
        if (this.layout.xMetric === "free") position.x = world.x;
        if (this.layout.yMetric === "free") position.y = world.y;
        this.canvas.style.cursor = "move";
        this.draw();
      }
      return;
    }
    if (this.pointer.down && this.pointer.panning) {
      if (
        Math.hypot(
          event.clientX - this.pointer.startX,
          event.clientY - this.pointer.startY,
        ) > 4
      ) {
        this.pointer.moved = true;
      }
      const rect = this.canvas.getBoundingClientRect();
      const ratio = this.canvas.width / Math.max(1, rect.width);
      this.transform.x += (event.clientX - this.pointer.x) * ratio;
      this.transform.y += (event.clientY - this.pointer.y) * ratio;
      this.pointer.x = event.clientX;
      this.pointer.y = event.clientY;
      this.draw();
      return;
    }
    const world = this.screenToWorld(event.clientX, event.clientY);
    const node = this.hitTest(world.x, world.y);
    const key = node?.key ?? null;
    if (key !== this.hoverKey) {
      this.hoverKey = key;
      this.canvas.style.cursor = node
        ? this.layout.xMetric === "free" || this.layout.yMetric === "free"
          ? "move"
          : "pointer"
        : "grab";
      this.canvas.title = node ? this.tooltipForNode(node) : "";
      this.draw();
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    this.canvas.releasePointerCapture?.(event.pointerId);
    const wasBackgroundClick =
      this.pointer.down && this.pointer.panning && !this.pointer.moved;
    this.pointer.down = false;
    this.pointer.panning = false;
    this.pointer.draggedKey = null;
    if (wasBackgroundClick) {
      const world = this.screenToWorld(event.clientX, event.clientY);
      if (!this.hitTest(world.x, world.y)) {
        this.clearSelection();
        this.onBackgroundInteraction();
      }
    }
  };

  private onPointerLeave = (): void => {
    if (!this.pointer.down) {
      this.hoverKey = null;
      this.canvas.title = "";
      this.draw();
    }
  };

  private onDoubleClick = (event: MouseEvent): void => {
    const world = this.screenToWorld(event.clientX, event.clientY);
    const node = this.hitTest(world.x, world.y);
    if (node) this.onOpenNode(node);
  };

  private onWheel = (event: WheelEvent): void => {
    this.markViewAdjusted();
    event.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const ratio = this.canvas.width / Math.max(1, rect.width);
    const screenX = (event.clientX - rect.left) * ratio;
    const screenY = (event.clientY - rect.top) * ratio;
    const factor = Math.exp(-event.deltaY * 0.0012);
    const nextScale = clamp(this.transform.scale * factor, 0.15, 8);
    const worldX = (screenX - this.transform.x) / this.transform.scale;
    const worldY = (screenY - this.transform.y) / this.transform.scale;
    this.transform.scale = nextScale;
    this.transform.x = screenX - worldX * nextScale;
    this.transform.y = screenY - worldY * nextScale;
    this.draw();
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key.toLocaleLowerCase() === "f") this.fitView();
    if (event.key === "Escape") {
      this.clearSelection();
      this.onBackgroundInteraction();
    }
  };

  private readonly onSchemeChange = (): void => {
    this.draw();
  };

  /**
   * Re-resolve the scheme from scratch. A `MediaQueryList` held across an
   * appearance change keeps a stale `matches` in a chrome document, so the
   * theme is never cached across frames.
   */
  private refreshTheme(): void {
    this.theme = graphThemeFor(
      resolveGraphScheme(this.canvas.ownerDocument.defaultView),
    );
  }

  public getTheme(): GraphTheme {
    return this.theme;
  }

  private isDarkMode(): boolean {
    return this.theme.scheme === "dark";
  }

  /**
   * The rank-based assignment for the active colouring, rebuilt only when the
   * metric, the node set or the scheme actually changes.
   */
  private categories(): CategoryAssignment {
    const key = `${this.layout.nodeColorMetric}${this.model.nodes.length}${this.theme.scheme}`;
    if (!this.categoryAssignment || this.categoryAssignmentKey !== key) {
      this.categoryAssignment = assignCategories(
        this.model.nodes,
        this.layout.nodeColorMetric,
        this.theme,
        { labelFor: (id) => this.collectionLabels.get(id) ?? null },
      );
      this.categoryAssignmentKey = key;
    }
    return this.categoryAssignment;
  }

  private nodeColors(
    node: CitationGraphNode,
    colorDomain: [number, number] | null,
  ): string[] {
    const metric = this.layout.nodeColorMetric;
    if (!isMetricID(metric)) return this.categories().colorsFor(node);
    const value = metricNumber(node, metric);
    if (value === null || !colorDomain) {
      return [this.theme.categorical.noValue];
    }
    return [
      numericColor(
        scaleValue(value, colorDomain[0], colorDomain[1], "linear"),
        this.theme,
      ),
    ];
  }

  private drawNode(
    node: CitationGraphNode,
    position: Position,
    radius: number,
    colors: string[],
  ): void {
    const context = this.context;
    const ratio = this.ratio;
    const ghosted = this.isNodeGhosted(node);
    context.save();
    if (ghosted) context.globalAlpha = 0.46;
    const slice = (Math.PI * 2) / Math.max(1, colors.length);
    colors.forEach((color, index) => {
      context.beginPath();
      context.moveTo(position.x, position.y);
      context.arc(
        position.x,
        position.y,
        radius,
        -Math.PI / 2 + slice * index,
        -Math.PI / 2 + slice * (index + 1),
      );
      context.closePath();
      context.fillStyle = color;
      context.fill();
    });
    context.beginPath();
    context.arc(position.x, position.y, radius, 0, Math.PI * 2);
    context.lineWidth = (node.isRetracted ? 3 : 1.1) * ratio;
    if (ghosted) context.setLineDash([4 * ratio, 3 * ratio]);
    context.strokeStyle = node.isRetracted
      ? this.theme.states.retracted
      : this.theme.inks.primary;
    context.stroke();
    context.restore();
    if (this.searchMatches?.has(node.key)) {
      context.beginPath();
      context.arc(position.x, position.y, radius + 8.5 * ratio, 0, Math.PI * 2);
      context.lineWidth = 2.5 * ratio;
      context.strokeStyle = this.theme.states.searchMatch;
      context.stroke();
    }
    if (this.seedKeys.has(node.key)) {
      context.save();
      context.beginPath();
      context.arc(position.x, position.y, radius + 4 * ratio, 0, Math.PI * 2);
      context.lineWidth = 2.4 * ratio;
      if (ghosted) context.setLineDash([5 * ratio, 3 * ratio]);
      context.strokeStyle = this.theme.states.seed;
      context.stroke();
      context.restore();
    }
    if (node.key === this.selectedKey) {
      context.save();
      context.beginPath();
      context.arc(position.x, position.y, radius + 5.5 * ratio, 0, Math.PI * 2);
      context.lineWidth = 3 * ratio;
      if (ghosted) context.setLineDash([6 * ratio, 4 * ratio]);
      context.strokeStyle = this.theme.states.selected;
      context.stroke();
      context.restore();
    } else if (node.key === this.hoverKey) {
      context.beginPath();
      context.arc(position.x, position.y, radius + 3 * ratio, 0, Math.PI * 2);
      context.lineWidth = 2 * ratio;
      context.strokeStyle = this.theme.states.selected;
      context.stroke();
    }
  }

  private drawArrow(
    source: Position,
    target: Position,
    targetRadius: number,
    connection: "citation" | "reference" | null,
    dimmed: boolean,
    ghosted: boolean,
  ): void {
    const context = this.context;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / length;
    const uy = dy / length;
    const ratio = this.ratio;
    const endX = target.x - ux * (targetRadius + 2 * ratio);
    const endY = target.y - uy * (targetRadius + 2 * ratio);
    const edges = this.theme.edges;
    const connected =
      connection === "citation" ? edges.incoming : edges.outgoing;
    context.save();
    if (ghosted) context.globalAlpha = 0.58;
    context.beginPath();
    context.moveTo(source.x, source.y);
    context.lineTo(endX, endY);
    context.strokeStyle = connection
      ? connected
      : dimmed
        ? edges.dimmed
        : edges.base;
    context.lineWidth = (connection ? 2.15 : 1) * ratio;
    context.setLineDash(ghosted ? [6 * ratio, 5 * ratio] : []);
    if (connection) {
      context.shadowColor = connected;
      context.shadowBlur = 3 * ratio;
    }
    context.stroke();
    const size = (connection ? 6.25 : 5) * ratio;
    context.beginPath();
    context.moveTo(endX, endY);
    context.lineTo(
      endX - ux * size - uy * size * 0.7,
      endY - uy * size + ux * size * 0.7,
    );
    context.lineTo(
      endX - ux * size + uy * size * 0.7,
      endY - uy * size - ux * size * 0.7,
    );
    context.closePath();
    context.fillStyle = context.strokeStyle;
    context.fill();
    context.restore();
  }

  private drawAxes(nodes: CitationGraphNode[]): void {
    const context = this.context;
    const ratio = this.ratio;
    const axisLeft = 58 * ratio;
    const axisRight = this.canvas.width - 14 * ratio;
    const axisTop = 14 * ratio;
    const axisBottom = this.canvas.height - 42 * ratio;
    const foreground = this.theme.inks.muted;

    context.save();
    context.strokeStyle = foreground;
    context.fillStyle = foreground;
    context.lineWidth = Math.max(1, ratio);
    context.font = `${Math.round(11 * ratio)}px sans-serif`;

    if (this.layout.xMetric !== "free") {
      context.beginPath();
      context.moveTo(axisLeft, axisBottom);
      context.lineTo(axisRight, axisBottom);
      context.stroke();
      const scale = this.axisScale(nodes, "x");
      if (scale) {
        for (const tick of scale.ticks) {
          const worldX =
            PLOT_LEFT +
            scaleValue(
              tick,
              scale.domain[0],
              scale.domain[1],
              this.layout.xScale,
            ) *
              (PLOT_RIGHT - PLOT_LEFT);
          const x = this.projectToScreen({ x: worldX, y: 0 }).x;
          if (x < axisLeft || x > axisRight) continue;
          context.beginPath();
          context.moveTo(x, axisBottom);
          context.lineTo(x, axisBottom + 5 * ratio);
          context.stroke();
          context.textAlign = "center";
          context.textBaseline = "top";
          context.fillText(
            formatMetricValue(this.layout.xMetric, tick),
            x,
            axisBottom + 7 * ratio,
          );
        }
      } else {
        context.textAlign = "center";
        context.textBaseline = "bottom";
        context.fillText(
          "No visible data",
          (axisLeft + axisRight) / 2,
          axisBottom - 7 * ratio,
        );
      }
      context.font = `600 ${Math.round(12 * ratio)}px sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "bottom";
      context.fillText(
        getMetricDefinition(this.layout.xMetric).label,
        (axisLeft + axisRight) / 2,
        this.canvas.height - 3 * ratio,
      );
    }

    if (this.layout.yMetric !== "free") {
      context.beginPath();
      context.moveTo(axisLeft, axisTop);
      context.lineTo(axisLeft, axisBottom);
      context.stroke();
      const scale = this.axisScale(nodes, "y");
      if (scale) {
        for (const tick of scale.ticks) {
          const worldY =
            PLOT_BOTTOM -
            scaleValue(
              tick,
              scale.domain[0],
              scale.domain[1],
              this.layout.yScale,
            ) *
              (PLOT_BOTTOM - PLOT_TOP);
          const y = this.projectToScreen({ x: 0, y: worldY }).y;
          if (y < axisTop || y > axisBottom) continue;
          context.beginPath();
          context.moveTo(axisLeft - 5 * ratio, y);
          context.lineTo(axisLeft, y);
          context.stroke();
          context.textAlign = "right";
          context.textBaseline = "middle";
          context.fillText(
            formatMetricValue(this.layout.yMetric, tick),
            axisLeft - 8 * ratio,
            y,
          );
        }
      } else {
        context.textAlign = "left";
        context.textBaseline = "top";
        context.fillText("No visible data", axisLeft + 8 * ratio, axisTop);
      }
      context.save();
      context.translate(13 * ratio, (axisTop + axisBottom) / 2);
      context.rotate(-Math.PI / 2);
      context.font = `600 ${Math.round(12 * ratio)}px sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "top";
      context.fillText(getMetricDefinition(this.layout.yMetric).label, 0, 0);
      context.restore();
    }
    context.restore();
  }

  private drawLabels(
    nodes: CitationGraphNode[],
    radii: Map<string, number>,
  ): void {
    drawRendererLabels(this as unknown as RendererSceneContext, nodes, radii);
  }

  private drawGhost(preview: GhostPreview): void {
    drawRendererGhost(this as unknown as RendererSceneContext, preview);
  }

  private draw(): void {
    if (this.destroyed || this.canvasError) return;
    this.refreshTheme();
    try {
      if (this.destroyed) return;
      const context = this.context;
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, this.canvas.width, this.canvas.height);
      context.fillStyle = this.theme.surfaces.paper;
      context.fillRect(0, 0, this.canvas.width, this.canvas.height);
      this.ratio = this.pixelRatio();
      this.screenPositions.clear();
      for (const [key, position] of this.positions) {
        this.screenPositions.set(key, this.projectToScreen(position));
      }

      const nodes = this.visibleNodes();
      const metricNodes = this.layoutNodes();
      const sizeDomain =
        this.layout.nodeSizeMetric === "uniform"
          ? null
          : metricExtent(metricNodes, this.layout.nodeSizeMetric);
      const colorDomain = isMetricID(this.layout.nodeColorMetric)
        ? metricExtent(metricNodes, this.layout.nodeColorMetric)
        : null;
      // Radii are device pixels from here down, so a node keeps its size as the
      // view zooms.
      const radii = new Map(
        nodes.map((node) => [
          node.key,
          this.nodeRadius(node, sizeDomain) * this.ratio,
        ]),
      );
      const selectedKey = this.selectedKey;
      const edges = [...this.visibleEdges()].sort((left, right) => {
        const a =
          selectedKey !== null &&
          (left.source === selectedKey || left.target === selectedKey);
        const b =
          selectedKey !== null &&
          (right.source === selectedKey || right.target === selectedKey);
        return Number(a) - Number(b);
      });

      for (const edge of edges) {
        const source = this.screenPositions.get(edge.source);
        const target = this.screenPositions.get(edge.target);
        if (!source || !target) continue;
        const connection =
          selectedKey === null
            ? null
            : edge.target === selectedKey
              ? "citation"
              : edge.source === selectedKey
                ? "reference"
                : null;
        this.drawArrow(
          source,
          target,
          radii.get(edge.target) ?? 7 * this.ratio,
          connection,
          selectedKey !== null && connection === null,
          Boolean(
            selectedKey &&
            !this.visibleKeys.has(selectedKey) &&
            (edge.source === selectedKey || edge.target === selectedKey),
          ),
        );
      }

      for (const node of nodes) {
        const position = this.screenPositions.get(node.key);
        if (!position) continue;
        this.drawNode(
          node,
          position,
          radii.get(node.key) ?? 7 * this.ratio,
          this.nodeColors(node, colorDomain),
        );
      }
      this.drawLabels(nodes, radii);
      if (this.ghostPreview) this.drawGhost(this.ghostPreview);
      this.drawAxes(metricNodes);
      context.restore();
    } catch (error) {
      this.canvasError = true;
      if (!this.canvasErrorLogged) {
        this.canvasErrorLogged = true;
        Zotero.logError(
          error instanceof Error
            ? error
            : new Error(`Meristema canvas rendering failed: ${String(error)}`),
        );
      }
    }
  }

  private tooltipForNode(node: CitationGraphNode): string {
    const collections = this.categories().labelsFor(node);
    return [
      node.title,
      node.authors.slice(0, 3).join(", "),
      node.year ? String(node.year) : "",
      node.citationCount === null ? "" : `${node.citationCount} citations`,
      collections.length ? collections.join(" · ") : "Unfiled",
      node.isRetracted ? "RETRACTED" : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  public setPinnedKeys(keys: ReadonlySet<string>, draw = true): void {
    this.pinnedKeys = new Set(keys);
    if (draw) this.draw();
  }

  public setSeedKeys(keys: ReadonlySet<string>, draw = true): void {
    this.seedKeys = new Set(keys);
    if (draw) this.draw();
  }

  public syncModel(options: { project?: boolean; draw?: boolean } = {}): void {
    const validKeys = new Set(this.model.nodes.map((node) => node.key));
    for (const key of [...this.positions.keys()]) {
      if (!validKeys.has(key)) this.positions.delete(key);
    }
    this.model.nodes.forEach((node, index) => {
      if (!this.positions.has(node.key))
        this.initializeNodePosition(node, index);
    });
    this.visibleKeys = new Set(
      [...this.visibleKeys].filter((key) => validKeys.has(key)),
    );
    this.pinnedKeys = new Set(
      [...this.pinnedKeys].filter((key) => validKeys.has(key)),
    );
    this.seedKeys = new Set(
      [...this.seedKeys].filter((key) => validKeys.has(key)),
    );
    if (this.selectedKey && !validKeys.has(this.selectedKey)) {
      this.selectedKey = null;
      this.onSelectionChange(null);
    }
    if (options.project !== false) {
      this.projectPositionsToLayout(
        this.layout.xMetric === "free",
        this.layout.yMetric === "free",
      );
    }
    if (options.draw !== false) this.draw();
  }

  public setNodePositions(
    positions: ReadonlyMap<string, { x: number; y: number }>,
  ): void {
    for (const [key, position] of positions) {
      if (!this.model.nodes.some((node) => node.key === key)) continue;
      this.positions.set(key, { x: position.x, y: position.y });
    }
    this.draw();
  }

  public setVisibleKeys(keys: Set<string>, draw = true): void {
    this.visibleKeys = new Set(keys);
    const rendered = this.renderedKeys();
    if (this.hoverKey && !rendered.has(this.hoverKey)) {
      this.hoverKey = null;
      this.canvas.title = "";
    }
    // Filtering is a visibility operation, not a layout operation. Keeping
    // positions fixed preserves the user's mental map and lets a selected
    // filtered node remain at its normal metric-derived coordinates.
    if (draw) this.draw();
  }

  public setSearchMatches(keys: Set<string> | null, draw = true): void {
    this.searchMatches = keys ? new Set(keys) : null;
    if (draw) this.draw();
  }

  public clearSelection(): void {
    if (this.selectedKey === null) return;
    this.selectedKey = null;
    this.onSelectionChange(null);
    this.draw();
  }

  public selectNode(key: string, center = true): boolean {
    const node = this.model.nodes.find((candidate) => candidate.key === key);
    if (!node) return false;
    this.selectedKey = key;
    this.onSelectionChange(node);
    if (center) {
      const position = this.positions.get(key);
      if (position) {
        this.transform.x =
          this.canvas.width / 2 - position.x * this.transform.scale;
        this.transform.y =
          this.canvas.height / 2 - position.y * this.transform.scale;
      }
    }
    this.draw();
    return true;
  }

  /**
   * Add a local Zotero node discovered after this graph snapshot was opened.
   * It remains outside the filter result until the view is refreshed, but can
   * immediately be selected and rendered through the same filtered-selection
   * path as every other local node.
   */
  public addNode(node: CitationGraphNode): CitationGraphNode {
    const existing = this.model.nodes.find(
      (candidate) => candidate.key === node.key,
    );
    if (existing) {
      Object.assign(existing, node);
      return existing;
    }
    this.model.nodes.push(node);
    this.initializeNodePosition(node, this.model.nodes.length - 1);
    this.projectPositionsToLayout(
      this.layout.xMetric === "free",
      this.layout.yMetric === "free",
    );
    this.draw();
    return node;
  }

  public setLayout(layout: GraphLayoutOptions): void {
    const previous = this.layout;
    this.layout = { ...layout };
    this.projectPositionsToLayout(
      previous.xMetric === "free" && layout.xMetric === "free",
      previous.yMetric === "free" && layout.yMetric === "free",
    );
    this.draw();
  }

  public getLayout(): GraphLayoutOptions {
    return { ...this.layout };
  }

  public setGhostPreview(preview: GhostPreview | null): void {
    this.ghostPreview = preview;
    this.draw();
    if (!preview) return;
    void ensureExternalWorkMetrics(preview.key).then(() => {
      if (this.ghostPreview?.key === preview.key) this.draw();
    });
  }

  public setRelationshipHidden(
    sourceItemKey: string,
    targetItemKey: string,
    hidden: boolean,
  ): void {
    const key = `${sourceItemKey}>${targetItemKey}`;
    if (hidden) this.hiddenEdgeKeys.add(key);
    else this.hiddenEdgeKeys.delete(key);
    this.draw();
  }

  public getVisibleEdgeCount(): number {
    return this.visibleEdges().length;
  }

  public resizeViewport = (): void => {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = this.canvas.ownerDocument.defaultView?.devicePixelRatio ?? 1;
    const rawWidth = Math.max(1, Math.round(rect.width * ratio));
    const rawHeight = Math.max(1, Math.round(rect.height * ratio));
    const dimensionScale = Math.min(
      1,
      MAX_CANVAS_DIMENSION / rawWidth,
      MAX_CANVAS_DIMENSION / rawHeight,
      Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, rawWidth * rawHeight)),
    );
    const width = Math.max(1, Math.round(rawWidth * dimensionScale));
    const height = Math.max(1, Math.round(rawHeight * dimensionScale));
    if (
      this.canvasError ||
      this.canvas.width !== width ||
      this.canvas.height !== height
    ) {
      // Reassigning the bitmap dimensions resets a 2D context that entered an
      // error state after an oversized or transiently invalid allocation.
      this.canvas.width = width;
      this.canvas.height = height;
      this.canvasError = false;
      this.projectPositionsToLayout(
        this.layout.xMetric === "free",
        this.layout.yMetric === "free",
      );
      this.draw();
    }
  };

  public zoomBy(factor: number): void {
    this.markViewAdjusted();
    const centerX = this.canvas.width / 2;
    const centerY = this.canvas.height / 2;
    const next = clamp(this.transform.scale * factor, 0.15, 8);
    const worldX = (centerX - this.transform.x) / this.transform.scale;
    const worldY = (centerY - this.transform.y) / this.transform.scale;
    this.transform.scale = next;
    this.transform.x = centerX - worldX * next;
    this.transform.y = centerY - worldY * next;
    this.draw();
  }

  public getViewTransform(): GraphViewTransform {
    return { ...this.transform };
  }

  public setViewTransform(transform: GraphViewTransform, draw = true): void {
    if (
      !Number.isFinite(transform.x) ||
      !Number.isFinite(transform.y) ||
      !Number.isFinite(transform.scale)
    ) {
      return;
    }
    this.markViewAdjusted();
    this.resizeViewport();
    this.transform = {
      x: transform.x,
      y: transform.y,
      scale: clamp(transform.scale, 0.15, 8),
    };
    if (draw) this.draw();
  }

  public fitView(options: FitViewOptions = {}): void {
    this.markViewAdjusted();
    this.resizeViewport();
    const includeAxisBounds = options.includeAxisBounds ?? true;
    const nodes = this.visibleNodes();
    const positions = nodes
      .map((node) => this.positions.get(node.key))
      .filter((position): position is Position => Boolean(position));
    if (!positions.length) {
      this.transform = { x: 0, y: 0, scale: 1 };
      this.draw();
      return;
    }
    const xCoordinates = positions.map((position) => position.x);
    const yCoordinates = positions.map((position) => position.y);
    if (includeAxisBounds && this.layout.xMetric !== "free") {
      xCoordinates.push(PLOT_LEFT, PLOT_RIGHT);
    }
    if (includeAxisBounds && this.layout.yMetric !== "free") {
      yCoordinates.push(PLOT_TOP, PLOT_BOTTOM);
    }
    // Labels are drawn to the right of most nodes. Keep additional horizontal
    // room without forcing the complete world/axis rectangle into the fit.
    const leftPadding = MAX_NODE_RADIUS + 48;
    const rightPadding = MAX_NODE_RADIUS + 185;
    const topPadding = MAX_NODE_RADIUS + 46;
    const bottomPadding = MAX_NODE_RADIUS + 62;
    const minX = Math.min(...xCoordinates) - leftPadding;
    const maxX = Math.max(...xCoordinates) + rightPadding;
    const minY = Math.min(...yCoordinates) - topPadding;
    const maxY = Math.max(...yCoordinates) + bottomPadding;
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const screenLeft = 64;
    const screenRight = 32;
    const screenTop = 28;
    const screenBottom = this.layout.xMetric === "free" ? 32 : 72;
    const availableWidth = Math.max(
      1,
      this.canvas.width - screenLeft - screenRight,
    );
    const availableHeight = Math.max(
      1,
      this.canvas.height - screenTop - screenBottom,
    );
    const scale = clamp(
      Math.min(availableWidth / width, availableHeight / height),
      0.15,
      options.maxScale ?? 5,
    );
    this.transform.scale = scale;
    this.transform.x =
      screenLeft + (availableWidth - width * scale) / 2 - minX * scale;
    this.transform.y =
      screenTop + (availableHeight - height * scale) / 2 - minY * scale;
    this.draw();
  }

  /** Fit the currently rendered paper cloud without fitting the full axes. */
  public fitVisibleNodes(): void {
    this.fitView({ includeAxisBounds: false, maxScale: 3.25 });
  }

  /** Fit a specific set of rendered papers without changing visibility. */
  public fitKeys(keys: ReadonlySet<string>, maxScale = 3.25): void {
    this.markViewAdjusted();
    this.resizeViewport();
    const positions = this.model.nodes
      .filter((node) => keys.has(node.key))
      .map((node) => this.positions.get(node.key))
      .filter((position): position is Position => Boolean(position));
    if (!positions.length) return;

    const leftPadding = MAX_NODE_RADIUS + 48;
    const rightPadding = MAX_NODE_RADIUS + 185;
    const topPadding = MAX_NODE_RADIUS + 46;
    const bottomPadding = MAX_NODE_RADIUS + 62;
    const minX =
      Math.min(...positions.map((position) => position.x)) - leftPadding;
    const maxX =
      Math.max(...positions.map((position) => position.x)) + rightPadding;
    const minY =
      Math.min(...positions.map((position) => position.y)) - topPadding;
    const maxY =
      Math.max(...positions.map((position) => position.y)) + bottomPadding;
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const screenLeft = 64;
    const screenRight = 32;
    const screenTop = 28;
    const screenBottom = this.layout.xMetric === "free" ? 32 : 72;
    const availableWidth = Math.max(
      1,
      this.canvas.width - screenLeft - screenRight,
    );
    const availableHeight = Math.max(
      1,
      this.canvas.height - screenTop - screenBottom,
    );
    const scale = clamp(
      Math.min(availableWidth / width, availableHeight / height),
      0.15,
      maxScale,
    );
    this.transform.scale = scale;
    this.transform.x =
      screenLeft + (availableWidth - width * scale) / 2 - minX * scale;
    this.transform.y =
      screenTop + (availableHeight - height * scale) / 2 - minY * scale;
    this.draw();
  }

  public getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.initialFitFrame !== null) {
      this.canvas.ownerDocument.defaultView?.cancelAnimationFrame(
        this.initialFitFrame,
      );
      this.initialFitFrame = null;
    }
    this.resizeObserver?.disconnect();
    this.disposeSchemeObserver?.();
    this.disposeSchemeObserver = null;
    const view = this.canvas.ownerDocument.defaultView;
    view?.removeEventListener("resize", this.resizeViewport);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
    this.canvas.removeEventListener("dblclick", this.onDoubleClick);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("keydown", this.onKeyDown);
  }
}
