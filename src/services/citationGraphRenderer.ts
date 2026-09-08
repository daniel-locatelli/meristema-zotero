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
  MISSING_X,
  MISSING_Y,
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
  offscreenPanDelta,
  projectToScreen,
  projectToWorld,
  screenLengthToWorld,
} from "./graphViewport";
import {
  axisInsets,
  fillTrackedText,
  fitInsets,
  plotRect,
  resolveChromeFontStack,
  GRAPH_FALLBACK_FONT_STACK,
  GRAPH_TYPE_SCALE,
  type PlotAxisState,
  type PlotRect,
} from "./graphPlotFrame";
import {
  arrivalDirection,
  curveControlPoint,
  edgeBaseOpacity,
  edgeLineInset,
  reciprocalEdgeKeys,
  shouldDrawArrowhead,
  ARROWHEAD_SEAM_OVERLAP_CSS,
  ARROWHEAD_SIZE_CSS,
  EDGE_CURVE_APEX_CSS,
} from "./graphEdgeStyle";
import { isContextMenuKey } from "./nodeMenu";

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
  /**
   * A right-click, Shift+F10 or the ContextMenu key on a node, after the node
   * has been selected. Client coordinates, so the caller can place a menu
   * with `getBoundingClientRect()` on whatever pane it lives in.
   */
  onNodeContextMenu?: (
    node: CitationGraphNode,
    clientX: number,
    clientY: number,
  ) => void;
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
/**
 * What the Key rail's emphasis leaves a non-matching node at, and how long it
 * takes to get there. Emphasis dims; it never hides, and it never removes — the
 * counts, the exports and the filter panel all still see every paper.
 */
const EMPHASIS_ALPHA = 0.25;
const EMPHASIS_EASE_MS = 120;

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
  /**
   * The chrome's own font stack. Read off the canvas rather than hard-coded so
   * the axis furniture is set in the same face as the DOM around it; re-read on
   * resize rather than per frame, because `getComputedStyle` forces a reflow.
   */
  private fontStack = GRAPH_FALLBACK_FONT_STACK;
  private readonly collectionLabels: ReadonlyMap<number, string>;
  private theme: GraphTheme = graphThemeFor("light");
  private categoryAssignment: CategoryAssignment | null = null;
  private categoryAssignmentKey = "";
  private readonly onSelectionChange: (node: CitationGraphNode | null) => void;
  private readonly onOpenNode: (node: CitationGraphNode) => void;
  private readonly onBackgroundInteraction: () => void;
  private readonly onNodeContextMenu: (
    node: CitationGraphNode,
    clientX: number,
    clientY: number,
  ) => void;
  private visibleKeys: Set<string>;
  /**
   * The keys the *filter* admits, before the search box narrows them further.
   *
   * A graph opened on a folder is the whole library with a filter over it, so
   * "which categories exist" cannot be asked of the model — it would rank the
   * library's folders and hand the swatches to folders the graph is not
   * showing. It is asked of this instead. The search is deliberately not part
   * of it: typing in the box would otherwise reshuffle every colour on screen.
   */
  private scopeKeys: Set<string>;
  /** Bumped whenever `scopeKeys` changes, so the assignment cache can notice. */
  private scopeRevision = 0;
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
  /** The keys the Key rail is emphasising, or null when it is emphasising none. */
  private emphasisKeys: ReadonlySet<string> | null = null;
  /** How far into the emphasis the ease has travelled: 0 none, 1 full. */
  private emphasisAmount = 0;
  private emphasisFrame: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private resizeFrame: number | null = null;
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
    this.onNodeContextMenu = options.onNodeContextMenu ?? (() => undefined);
    this.visibleKeys = new Set(this.model.nodes.map((node) => node.key));
    this.scopeKeys = new Set(this.visibleKeys);

    this.initializePositions();
    this.installEvents();

    const view = this.canvas.ownerDocument.defaultView;
    this.theme = graphThemeFor(resolveGraphScheme(view));
    this.disposeSchemeObserver = observeGraphScheme(view, this.onSchemeChange);

    const ResizeObserverConstructor = (view as any)?.ResizeObserver as
      typeof ResizeObserver | undefined;
    if (ResizeObserverConstructor) {
      // Resizing the viewport reassigns the canvas bitmap and redraws, which
      // is layout-affecting work; doing it synchronously inside the callback
      // makes the observer deliver a second notification for the same frame,
      // and Gecko reports that as an uncaught "ResizeObserver loop completed
      // with undelivered notifications" on the window. Coalescing onto the
      // next frame ends the loop and collapses a drag-resize's flood of
      // callbacks into one resize per frame.
      this.resizeObserver = new ResizeObserverConstructor(() => {
        if (this.resizeFrame !== null) return;
        const frameView = this.canvas.ownerDocument.defaultView;
        const run = (): void => {
          this.cancelScheduledResize();
          this.resizeViewport();
          if (!this.initialFitComplete) this.scheduleInitialFit();
        };
        this.resizeFrame = frameView
          ? frameView.requestAnimationFrame(run)
          : (setTimeout(run, 0) as unknown as number);
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

  /** Drop the pending coalesced resize, if one is waiting. */
  private cancelScheduledResize(): void {
    if (this.resizeFrame === null) return;
    this.canvas.ownerDocument.defaultView?.cancelAnimationFrame(
      this.resizeFrame,
    );
    this.resizeFrame = null;
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
    this.canvas.addEventListener("contextmenu", this.onContextMenu);
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

  private axesState(): PlotAxisState {
    return {
      xFree: this.layout.xMetric === "free",
      yFree: this.layout.yMetric === "free",
    };
  }

  /** The paper rectangle, in canvas device pixels, for the current frame. */
  private plotRect(): PlotRect {
    return plotRect(
      this.canvas.width,
      this.canvas.height,
      axisInsets(this.ratio, this.axesState()),
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
    // A right button belongs to the context menu: it must neither pan, drag nor clear the selection.
    if (event.button !== 0) return;
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

  private onContextMenu = (event: MouseEvent): void => {
    const world = this.screenToWorld(event.clientX, event.clientY);
    const node = this.hitTest(world.x, world.y);
    // The background keeps the browser's own menu.
    if (!node) return;
    event.preventDefault();
    this.selectedKey = node.key;
    this.onSelectionChange(node);
    this.draw();
    this.onNodeContextMenu(node, event.clientX, event.clientY);
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
    if (isContextMenuKey(event) && this.selectedKey !== null) {
      const node = this.model.nodes.find(
        (candidate) => candidate.key === this.selectedKey,
      );
      const position = this.nodeClientPosition(this.selectedKey);
      if (!node || !position) return;
      event.preventDefault();
      this.onNodeContextMenu(node, position.x, position.y);
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

  /**
   * The category assignment the canvas is drawing with.
   *
   * The Key rail reads it from here rather than assigning again, because the
   * two agreeing is the whole point: a rail that computed its own would name
   * the right colours only for as long as the two computations stayed
   * identical.
   */
  public getCategoryAssignment(): CategoryAssignment {
    return this.categories();
  }

  public getTheme(): GraphTheme {
    return this.theme;
  }

  /**
   * The nodes inside the active filter — what the graph is a graph *of*.
   *
   * The Key counts these rather than the model, so a graph opened on a folder
   * names that folder's colours and not the library's. It is not
   * `visibleNodes()`: that one follows the search box and carries the selection
   * and the pins, all of which change on a click.
   */
  public getScopeNodes(): CitationGraphNode[] {
    if (this.scopeKeys.size === this.model.nodes.length)
      return this.model.nodes;
    return this.model.nodes.filter((node) => this.scopeKeys.has(node.key));
  }

  /** Narrow what the graph is a graph of. Null restores the whole model. */
  public setScopeKeys(keys: ReadonlySet<string> | null): void {
    const next = keys
      ? new Set(keys)
      : new Set(this.model.nodes.map((node) => node.key));
    if (
      next.size === this.scopeKeys.size &&
      [...next].every((key) => this.scopeKeys.has(key))
    ) {
      return;
    }
    this.scopeKeys = next;
    this.scopeRevision += 1;
  }

  private isDarkMode(): boolean {
    return this.theme.scheme === "dark";
  }

  /**
   * The rank-based assignment for the active colouring, rebuilt only when the
   * metric, the node set or the scheme actually changes.
   */
  private categories(): CategoryAssignment {
    const key = `${this.layout.nodeColorMetric}${this.model.nodes.length}${this.theme.scheme}${this.scopeRevision}`;
    if (!this.categoryAssignment || this.categoryAssignmentKey !== key) {
      this.categoryAssignment = assignCategories(
        this.getScopeNodes(),
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
    emphasis: number,
  ): void {
    const context = this.context;
    const ratio = this.ratio;
    const ghosted = this.isNodeGhosted(node);
    // An outer state so the rings below fade with the disc they belong to.
    context.save();
    context.globalAlpha = emphasis;
    context.save();
    if (ghosted) context.globalAlpha = 0.46 * emphasis;
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
    context.restore();
  }

  private drawArrow(
    source: Position,
    target: Position,
    targetRadius: number,
    connection: "citation" | "reference" | null,
    dimmed: boolean,
    ghosted: boolean,
    /** Device pixels the edge bows off its chord; zero draws a straight line. */
    curveApex: number,
    /** The alpha an unlit edge is drawn at, falling as the mesh thickens. */
    baseOpacity: number,
    /** The Key rail's emphasis, 1 when this edge belongs to what is emphasised. */
    emphasis: number,
  ): void {
    const context = this.context;
    const ratio = this.ratio;
    const edges = this.theme.edges;
    const connected =
      connection === "citation" ? edges.incoming : edges.outgoing;
    // A reciprocal pair overdraws as one line when both are straight, so each
    // bows to its own side of the chord. The arrowhead then has to follow the
    // curve's tangent at the target rather than the chord's direction.
    const control =
      curveApex === 0
        ? { x: (source.x + target.x) / 2, y: (source.y + target.y) / 2 }
        : curveControlPoint(source, target, curveApex);
    const arrival = arrivalDirection(control, target);
    const headDrawn = shouldDrawArrowhead(
      this.transform.scale,
      connection !== null,
    );
    const headSize = ARROWHEAD_SIZE_CSS * ratio;
    // The head's tip sits just off the node it points at; the line stops at the
    // head's base rather than running under it to the tip, so the two never
    // composite over each other through the edge's own transparency.
    const tipInset = targetRadius + 2 * ratio;
    const tipX = target.x - arrival.x * tipInset;
    const tipY = target.y - arrival.y * tipInset;
    const lineInset = edgeLineInset(
      tipInset,
      headSize,
      headDrawn,
      ARROWHEAD_SEAM_OVERLAP_CSS * ratio,
    );
    const endX = target.x - arrival.x * lineInset;
    const endY = target.y - arrival.y * lineInset;

    context.save();
    // A lit edge keeps its full strength however dense the graph is — lighting
    // it is the whole point of the selection.
    context.globalAlpha =
      (ghosted ? 0.58 : 1) *
      (connection ? 1 : Math.max(0, baseOpacity)) *
      emphasis;
    context.beginPath();
    context.moveTo(source.x, source.y);
    if (curveApex === 0) context.lineTo(endX, endY);
    else context.quadraticCurveTo(control.x, control.y, endX, endY);
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

    if (headDrawn) {
      const size = headSize;
      const ux = arrival.x;
      const uy = arrival.y;
      context.beginPath();
      context.moveTo(tipX, tipY);
      context.lineTo(
        tipX - ux * size - uy * size * 0.7,
        tipY - uy * size + ux * size * 0.7,
      );
      context.lineTo(
        tipX - ux * size + uy * size * 0.7,
        tipY - uy * size - ux * size * 0.7,
      );
      context.closePath();
      context.fillStyle = context.strokeStyle;
      context.fill();
    }
    context.restore();
  }

  /**
   * The screen coordinate of a tick, in canvas device pixels. The tick's world
   * position is the same one `projectRendererPositions` places nodes at, so a
   * gridline lands exactly under the nodes that share its value.
   */
  private tickScreenPosition(
    axis: "x" | "y",
    scale: AxisScale,
    tick: number,
  ): number {
    if (axis === "x") {
      const worldX =
        PLOT_LEFT +
        scaleValue(tick, scale.domain[0], scale.domain[1], this.layout.xScale) *
          (PLOT_RIGHT - PLOT_LEFT);
      return this.projectToScreen({ x: worldX, y: 0 }).x;
    }
    const worldY =
      PLOT_BOTTOM -
      scaleValue(tick, scale.domain[0], scale.domain[1], this.layout.yScale) *
        (PLOT_BOTTOM - PLOT_TOP);
    return this.projectToScreen({ x: 0, y: worldY }).y;
  }

  /**
   * Whether any node is actually parked in an axis's no-data lane. Mirrors the
   * test `projectRendererPositions` makes when it places them, so the lane's
   * separator and label appear only when there is something in the lane.
   */
  private hasParkedNodes(nodes: CitationGraphNode[], axis: "x" | "y"): boolean {
    const metric = axis === "x" ? this.layout.xMetric : this.layout.yMetric;
    if (metric === "free") return false;
    const scale = axis === "x" ? this.layout.xScale : this.layout.yScale;
    return nodes.some((node) => {
      const value = metricNumber(node, metric);
      return value === null || (scale === "log" && value <= 0);
    });
  }

  /**
   * The lane an axis parks its valueless nodes in: a dashed separator between
   * the lane and the data, and a NO DATA label at the far end of the lane,
   * away from the corner where the two lanes meet.
   *
   * The x lane is a narrow vertical strip, so its label is rotated to fit. The
   * y lane is a wide horizontal one and reads horizontally; rotating it would
   * cost legibility for nothing.
   */
  private drawNoDataLane(
    plot: PlotRect,
    axis: "x" | "y",
    nodes: CitationGraphNode[],
  ): void {
    if (!this.hasParkedNodes(nodes, axis)) return;
    const context = this.context;
    const ratio = this.ratio;
    const size = Math.round(GRAPH_TYPE_SCALE.gutter * ratio);
    const pad = 8 * ratio;

    context.save();
    context.strokeStyle = this.theme.surfaces.hairline;
    context.fillStyle = this.theme.inks.muted;
    context.lineWidth = Math.max(1, ratio);
    context.setLineDash([4 * ratio, 4 * ratio]);
    context.font = `${size}px ${this.fontStack}`;

    if (axis === "x") {
      const separator = this.projectToScreen({
        x: (MISSING_X + PLOT_LEFT) / 2,
        y: 0,
      }).x;
      const lane = this.projectToScreen({ x: MISSING_X, y: 0 }).x;
      if (separator > plot.left && separator < plot.right) {
        context.beginPath();
        context.moveTo(separator, plot.top);
        context.lineTo(separator, plot.bottom);
        context.stroke();
      }
      if (lane > plot.left && lane < plot.right) {
        context.setLineDash([]);
        context.save();
        context.translate(lane, plot.top + pad);
        context.rotate(-Math.PI / 2);
        context.textAlign = "right";
        context.textBaseline = "middle";
        fillTrackedText(context, "No data", 0, 0, size);
        context.restore();
      }
    } else {
      const separator = this.projectToScreen({
        x: 0,
        y: (MISSING_Y + PLOT_BOTTOM) / 2,
      }).y;
      const lane = this.projectToScreen({ x: 0, y: MISSING_Y }).y;
      if (separator > plot.top && separator < plot.bottom) {
        context.beginPath();
        context.moveTo(plot.left, separator);
        context.lineTo(plot.right, separator);
        context.stroke();
      }
      if (lane > plot.top && lane < plot.bottom) {
        context.setLineDash([]);
        context.textAlign = "right";
        context.textBaseline = "middle";
        fillTrackedText(context, "No data", plot.right - pad, lane, size);
      }
    }
    context.restore();
  }

  /**
   * Everything that belongs beneath the nodes: the paper the plot is printed
   * on, a gridline at every tick, and the no-data lanes. The frame, the ticks
   * and the axis titles go on top, in `drawAxes`.
   */
  private drawPlotBackdrop(
    plot: PlotRect,
    nodes: CitationGraphNode[],
    xScale: AxisScale | null,
    yScale: AxisScale | null,
  ): void {
    const context = this.context;
    const ratio = this.ratio;

    context.save();
    context.fillStyle = this.theme.surfaces.paper;
    context.fillRect(plot.left, plot.top, plot.width, plot.height);
    context.beginPath();
    context.rect(plot.left, plot.top, plot.width, plot.height);
    context.clip();

    context.strokeStyle = this.theme.surfaces.grid;
    context.lineWidth = Math.max(1, ratio);
    if (this.layout.xMetric !== "free" && xScale) {
      for (const tick of xScale.ticks) {
        const x = this.tickScreenPosition("x", xScale, tick);
        if (x < plot.left || x > plot.right) continue;
        context.beginPath();
        context.moveTo(x, plot.top);
        context.lineTo(x, plot.bottom);
        context.stroke();
      }
    }
    if (this.layout.yMetric !== "free" && yScale) {
      for (const tick of yScale.ticks) {
        const y = this.tickScreenPosition("y", yScale, tick);
        if (y < plot.top || y > plot.bottom) continue;
        context.beginPath();
        context.moveTo(plot.left, y);
        context.lineTo(plot.right, y);
        context.stroke();
      }
    }

    this.drawNoDataLane(plot, "x", nodes);
    this.drawNoDataLane(plot, "y", nodes);
    context.restore();
  }

  /**
   * The frame around the plot, the ticks hanging outside it, and the axis
   * titles. The frame replaces the two bare axis lines this used to draw: one
   * hairline rectangle says the same thing and closes the figure.
   */
  private drawAxes(
    plot: PlotRect,
    xScale: AxisScale | null,
    yScale: AxisScale | null,
  ): void {
    const context = this.context;
    const ratio = this.ratio;
    const foreground = this.theme.inks.muted;
    const tickSize = Math.round(GRAPH_TYPE_SCALE.tick * ratio);
    const titleSize = Math.round(GRAPH_TYPE_SCALE.axisTitle * ratio);

    context.save();
    context.strokeStyle = this.theme.surfaces.hairline;
    context.lineWidth = Math.max(1, ratio);
    context.strokeRect(plot.left, plot.top, plot.width, plot.height);

    context.strokeStyle = foreground;
    context.fillStyle = foreground;
    context.font = `${tickSize}px ${this.fontStack}`;

    if (this.layout.xMetric !== "free") {
      if (xScale) {
        for (const tick of xScale.ticks) {
          const x = this.tickScreenPosition("x", xScale, tick);
          if (x < plot.left || x > plot.right) continue;
          context.beginPath();
          context.moveTo(x, plot.bottom);
          context.lineTo(x, plot.bottom + 5 * ratio);
          context.stroke();
          context.textAlign = "center";
          context.textBaseline = "top";
          context.fillText(
            formatMetricValue(this.layout.xMetric, tick),
            x,
            plot.bottom + 7 * ratio,
          );
        }
      } else {
        context.textAlign = "center";
        context.textBaseline = "bottom";
        context.fillText(
          "No visible data",
          (plot.left + plot.right) / 2,
          plot.bottom - 7 * ratio,
        );
      }
      context.font = `600 ${titleSize}px ${this.fontStack}`;
      context.textAlign = "center";
      context.textBaseline = "bottom";
      fillTrackedText(
        context,
        getMetricDefinition(this.layout.xMetric).label,
        (plot.left + plot.right) / 2,
        this.canvas.height - 3 * ratio,
        titleSize,
      );
    }

    if (this.layout.yMetric !== "free") {
      context.font = `${tickSize}px ${this.fontStack}`;
      if (yScale) {
        for (const tick of yScale.ticks) {
          const y = this.tickScreenPosition("y", yScale, tick);
          if (y < plot.top || y > plot.bottom) continue;
          context.beginPath();
          context.moveTo(plot.left - 5 * ratio, y);
          context.lineTo(plot.left, y);
          context.stroke();
          context.textAlign = "right";
          context.textBaseline = "middle";
          context.fillText(
            formatMetricValue(this.layout.yMetric, tick),
            plot.left - 8 * ratio,
            y,
          );
        }
      } else {
        context.textAlign = "left";
        context.textBaseline = "top";
        context.fillText("No visible data", plot.left + 8 * ratio, plot.top);
      }
      context.save();
      context.translate(13 * ratio, (plot.top + plot.bottom) / 2);
      context.rotate(-Math.PI / 2);
      context.font = `600 ${titleSize}px ${this.fontStack}`;
      context.textAlign = "center";
      context.textBaseline = "top";
      fillTrackedText(
        context,
        getMetricDefinition(this.layout.yMetric).label,
        0,
        0,
        titleSize,
      );
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
      this.ratio = this.pixelRatio();
      const axes = this.axesState();
      // With no metric on either axis there is no plot to inset, so the paper
      // stays edge to edge and no frame is drawn around a rectangle that means
      // nothing. Otherwise the panel is the surround and the paper is the plot.
      const framed = !axes.xFree || !axes.yFree;
      const plot = this.plotRect();
      context.fillStyle = framed
        ? this.theme.surfaces.panel
        : this.theme.surfaces.paper;
      context.fillRect(0, 0, this.canvas.width, this.canvas.height);
      this.screenPositions.clear();
      for (const [key, position] of this.positions) {
        this.screenPositions.set(key, this.projectToScreen(position));
      }

      const nodes = this.visibleNodes();
      const metricNodes = this.layoutNodes();
      const xScale = axes.xFree ? null : this.axisScale(metricNodes, "x");
      const yScale = axes.yFree ? null : this.axisScale(metricNodes, "y");
      if (framed) this.drawPlotBackdrop(plot, metricNodes, xScale, yScale);
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

      const reciprocal = reciprocalEdgeKeys(edges);
      const baseOpacity = edgeBaseOpacity(edges.length);
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
        // A positive apex, not a signed one: each half bows to its own chord's
        // left, and the two halves traverse the chord in opposite directions.
        const curveApex = reciprocal.has(`${edge.source}>${edge.target}`)
          ? EDGE_CURVE_APEX_CSS * this.ratio
          : 0;
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
          curveApex,
          baseOpacity,
          // An edge belongs to an emphasised group if either end does, so the
          // group's connections out into the graph stay legible.
          Math.max(
            this.emphasisAlphaFor(edge.source),
            this.emphasisAlphaFor(edge.target),
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
          this.emphasisAlphaFor(node.key),
        );
      }
      this.drawLabels(nodes, radii);
      if (this.ghostPreview) this.drawGhost(this.ghostPreview);
      if (framed) this.drawAxes(plot, xScale, yScale);
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
    this.setScopeKeys(
      new Set([...this.scopeKeys].filter((key) => validKeys.has(key))),
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

  /** How strongly a node — or an edge's endpoint — is drawn right now. */
  private emphasisAlphaFor(key: string): number {
    if (!this.emphasisKeys || this.emphasisAmount <= 0) return 1;
    if (this.emphasisKeys.has(key)) return 1;
    return 1 - (1 - EMPHASIS_ALPHA) * this.emphasisAmount;
  }

  /**
   * Emphasise a set of nodes, or release the emphasis with null.
   *
   * This dims what does not match; it never hides it, and it never touches
   * `visibleKeys`. Filtering has its own home in the filter panel, where it is
   * reflected in the counts and in every export — a second, quieter way to make
   * papers disappear would leave the two disagreeing about what is in the
   * graph. The Key names the encoding and points at it. That is the whole job.
   */
  public setEmphasis(keys: ReadonlySet<string> | null): void {
    const next = keys && keys.size ? new Set(keys) : null;
    const sameKeys =
      (next === null && this.emphasisKeys === null) ||
      (next !== null &&
        this.emphasisKeys !== null &&
        next.size === this.emphasisKeys.size &&
        [...next].every((key) => this.emphasisKeys!.has(key)));
    if (sameKeys) return;
    // The keys change immediately; only the strength eases, so releasing one
    // entry and hovering the next does not flash the whole graph back to full.
    this.emphasisKeys = next;
    this.animateEmphasis(next ? 1 : 0);
  }

  private animateEmphasis(target: number): void {
    const view = this.canvas.ownerDocument.defaultView;
    if (this.emphasisFrame !== null) {
      view?.cancelAnimationFrame(this.emphasisFrame);
      this.emphasisFrame = null;
    }
    // A fresh query every time: Gecko does not restyle an open document when
    // the underlying preference changes, so a cached one goes stale.
    const reduced = Boolean(
      view?.matchMedia("(prefers-reduced-motion: reduce)")?.matches,
    );
    const from = this.emphasisAmount;
    if (reduced || !view || from === target) {
      this.emphasisAmount = target;
      this.draw();
      return;
    }
    const start = Date.now();
    const step = (): void => {
      this.emphasisFrame = null;
      if (this.destroyed) return;
      const progress = Math.min(1, (Date.now() - start) / EMPHASIS_EASE_MS);
      this.emphasisAmount = from + (target - from) * progress;
      this.draw();
      if (progress < 1) this.emphasisFrame = view.requestAnimationFrame(step);
    };
    this.emphasisFrame = view.requestAnimationFrame(step);
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
   * Bring a node into view without changing the zoom. Returns true when the
   * view moved. A node already inside the canvas, with two node radii in
   * device pixels to spare, leaves the camera where the user put it.
   */
  public panToNodeIfOffscreen(key: string): boolean {
    const node = this.model.nodes.find((candidate) => candidate.key === key);
    const position = node ? this.positions.get(key) : undefined;
    if (!node || !position) return false;
    const margin = this.nodeRadius(node) * this.pixelRatio() * 2;
    const delta = offscreenPanDelta(
      this.projectToScreen(position),
      margin,
      this.canvas.width,
      this.canvas.height,
    );
    if (delta.x === 0 && delta.y === 0) return false;
    this.markViewAdjusted();
    this.transform.x += delta.x;
    this.transform.y += delta.y;
    this.draw();
    return true;
  }

  /**
   * Where a node is on screen, in client coordinates, or null when the node
   * has no position. The inverse of `screenToWorld`, for a menu that opens
   * from the keyboard and has no pointer to sit under.
   */
  public nodeClientPosition(key: string): { x: number; y: number } | null {
    const position = this.positions.get(key);
    if (!position) return null;
    const rect = this.canvas.getBoundingClientRect();
    const ratio = devicePixelScale(this.canvas.width, rect.width);
    const screen = this.projectToScreen(position);
    return { x: rect.left + screen.x / ratio, y: rect.top + screen.y / ratio };
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
      this.fontStack = resolveChromeFontStack(this.canvas);
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
    // Ratio-scaled, and defined as the axis furniture plus a margin, so a
    // fitted node can never land beneath a tick label on a scaled display.
    const gutters = fitInsets(this.pixelRatio(), this.axesState());
    const availableWidth = Math.max(
      1,
      this.canvas.width - gutters.left - gutters.right,
    );
    const availableHeight = Math.max(
      1,
      this.canvas.height - gutters.top - gutters.bottom,
    );
    const scale = clamp(
      Math.min(availableWidth / width, availableHeight / height),
      0.15,
      options.maxScale ?? 5,
    );
    this.transform.scale = scale;
    this.transform.x =
      gutters.left + (availableWidth - width * scale) / 2 - minX * scale;
    this.transform.y =
      gutters.top + (availableHeight - height * scale) / 2 - minY * scale;
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
    // Ratio-scaled, and defined as the axis furniture plus a margin, so a
    // fitted node can never land beneath a tick label on a scaled display.
    const gutters = fitInsets(this.pixelRatio(), this.axesState());
    const availableWidth = Math.max(
      1,
      this.canvas.width - gutters.left - gutters.right,
    );
    const availableHeight = Math.max(
      1,
      this.canvas.height - gutters.top - gutters.bottom,
    );
    const scale = clamp(
      Math.min(availableWidth / width, availableHeight / height),
      0.15,
      maxScale,
    );
    this.transform.scale = scale;
    this.transform.x =
      gutters.left + (availableWidth - width * scale) / 2 - minX * scale;
    this.transform.y =
      gutters.top + (availableHeight - height * scale) / 2 - minY * scale;
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
    if (this.emphasisFrame !== null) {
      this.canvas.ownerDocument.defaultView?.cancelAnimationFrame(
        this.emphasisFrame,
      );
      this.emphasisFrame = null;
    }
    this.resizeObserver?.disconnect();
    this.cancelScheduledResize();
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
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("keydown", this.onKeyDown);
  }
}
