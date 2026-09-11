/// <reference lib="dom" />

import type { ExternalWork } from "../domain/externalWork";
import type {
  CitationGraphNode,
  GraphLayoutOptions,
} from "../domain/graphTypes";
import type { LibrarySnapshot, ZoteroPaper } from "../domain/types";
import {
  buildCitationGraph,
  getCitationGraphSnapshot,
  warmLocalCitationRelations,
} from "./citationGraphService";
import {
  applyCitationGraphDelta,
  cloneCitationGraphModel,
  createCitationGraphIndex,
  invalidateCitationGraphSnapshot,
} from "./graphSnapshotStore";
import {
  CitationGraphRenderer,
  type GraphViewTransform,
} from "./citationGraphRenderer";
import {
  resolveLibrarySelection,
  type LibrarySelectionResolution,
} from "./librarySelection";
import {
  hydrateExternalWorksMetadata,
  refreshExternalRelationships,
  selectedRelationshipCacheIsFresh,
} from "./externalDiscoveryService";
import {
  normalizeDOI,
  stableExternalWorkIdentity,
} from "../domain/workIdentity";
import {
  emptyGraphViewState,
  MAX_GRAPH_REGIONS,
  resolveGraphViewSeeds,
  seedFromNode,
  type GraphViewState,
} from "./graphViewState";
import { createSwatchLedgerStore, swatchIndexFor } from "./graphSwatchLedger";
import { getMissingPaperRecommendations } from "./missingPaperRecommendationService";
import { mergeRelatedWorkLists } from "./relationshipStoreService";
import { externalWorkURL } from "./providerPresentation";
import {
  getRelationshipViewSnapshot,
  RELATIONSHIP_VIEW_LIMIT,
  notifyRelationshipMutation,
  relationshipPreviewSourceKeys,
  relationshipWorkKey,
  subscribeRelationshipMutations,
  type RelationshipMutationEvent,
} from "./relationshipViewService";
import {
  notifyManualRelationChange,
  subscribeRelationshipPublications,
  type RelationshipPublicationEvent,
} from "./relationshipEvents";
import {
  collectionScopeIDs,
  createPaperFilterController,
  describeExternalWork,
  describeZoteroPaper,
  type PaperListDescriptor,
} from "./paperListViewService";
import {
  allCollectionsTicked,
  computeGraphScope,
  expandTicksThroughDescendants,
  onlyCollectionsTicked,
  purgeHiddenKeys,
  setCollectionTicks,
  type GraphScopeResult,
  type GraphViewCollectionTicks,
  type ScopePaper,
} from "./graphScopeModel";
import {
  buildScopeRailModel,
  nextRegionSelection,
  seedRowLabel,
  type ScopeSeedRow,
} from "./graphScopeRailModel";
import {
  exportGraphCSV,
  exportGraphJSON,
  exportGraphPNG,
} from "./exportService";
import {
  libraryPaperID,
  seedPaperID,
  seedPopoverList,
  type LibrarySearchState,
  type SeedPopoverPaper,
} from "./seedPopoverRows";
import { createMetricNodeForItem } from "./itemMetricContext";
import { updateCitationDataForItems } from "./citationUpdateService";
import { createUpdateProgress } from "./updateProgressService";
import { SerializedTaskQueue } from "./serializedTaskQueue";
import { mapCooperatively } from "./backgroundTaskService";
import { automaticFocusSeedRefreshPlan } from "./relationshipRefreshPolicy";
import {
  ensureSourceMetricsForNodes,
  graphLayoutUsesSourceMetrics,
} from "./sourceMetricsService";
import { buildKeyModel } from "./graphKeyModel";
import { createKeyRail, type RailEmphasis } from "./graphKeyRail";
import {
  attachPaneResizer,
  collectionLabelsByID,
  clear,
  createAxesAppearance,
  element,
  ensureStyles,
  externalWorkTitle,
  formatCount,
  graphNodeSearchText,
  icon,
  iconButtonContent,
  networkLogo,
  normalizeSearch,
  scoreLibraryPaperSearch,
  text,
  type LibraryPaperSearchEntry,
} from "./graphViewControls";
import {
  clampMenuPosition,
  openPaperEntry,
  type BestAttachmentType,
  type OpenPaperEntry,
} from "./nodeMenu";
import { popoverShouldAnchorEnd } from "./popoverPlacement";
import { insideSelectDropdown } from "./selectDropdown";
import {
  appendRelatedWorkRows,
  button,
  createBadges,
  createDetailTabs,
  createImportArea,
  createOverviewMetrics,
  createRelationshipList,
  createSimilarSection,
  detailSection,
  type PaperDetailHost,
  type RelationshipList,
  type RowAction,
} from "./paperDetailView";
import { createIcon, PANE_TOGGLE_ICON_SIZE } from "./uiIconService";
import type { IconName } from "./uiIconService";
import {
  applyGraphThemeToDocument,
  graphThemeFor,
  observeGraphScheme,
  resolveGraphScheme,
  seedColorAt,
} from "./graphTheme";
import {
  additiveGraphModel,
  buildGraphFocusProjection,
  reachedKeysOf,
  externalWorkToFocusNode,
  synchronizeExternalFocusNode,
  type GraphFocusDirection,
  type GraphFocusLocality,
  type GraphFocusProjection,
  type GraphFocusState,
} from "./graphFocusService";
import {
  focusProjectionCacheKey,
  getCachedFocusProjection,
  getFocusRelationshipFragment,
  invalidateFocusRelationshipFragment,
  setCachedFocusProjection,
  setFocusRelationshipFragment,
} from "./focusGraphCacheService";
import {
  getGraphAppearance,
  resetFocusGraphAppearance,
  resetGraphAppearance,
  setFocusGraphAppearance,
  setGraphAppearance,
} from "./citationPreferences";
import { normalizedScopeItemIDs } from "./graphScopePolicy";
import {
  bindZoteroPane,
  PANE_MINIMUM,
  type ZoteroPaneState,
} from "./zoteroPaneSync";

export type GraphFocusResult = "selected" | "revealed" | "not-found";

export interface SavedGraphMenuEntry {
  id: number;
  name: string;
  /** ISO 8601, shown beside the name so two graphs with one name can be told apart. */
  modified: string;
}

/**
 * What the Graph menu asks its host for. The view knows nothing about the
 * database or the instance; it shows what the host lists and reports what
 * the host returns.
 */
export interface GraphViewSavedGraphsHost {
  list(): Promise<SavedGraphMenuEntry[]>;
  /** Opens a fresh, empty graph in a new tab. */
  newGraph(): Promise<void>;
  /**
   * Saves the graph, prompting for a name when it is still scratch. Resolves
   * to the saved name, or null when the user cancelled or the write failed.
   */
  save(): Promise<string | null>;
  /** Always prompts for a name. Resolves as `save` does. */
  saveAs(): Promise<string | null>;
  /** "deleted" when the row vanished between listing and opening. */
  open(id: number): Promise<"opened" | "deleted">;
  /** Asks the user to confirm. Resolves true when the row was deleted. */
  remove(id: number): Promise<boolean>;
}

export interface GraphViewController {
  /**
   * Mirror Zotero's item selection: select the one present node, emphasise
   * several, clear on none. Never adds nodes, never reports back. With
   * `adopt`, a selection that matches nothing in this graph leaves the view's
   * own selection alone instead of clearing it — what a freshly rendered view
   * wants when it takes on the list's current selection.
   */
  applyLibrarySelection(
    itemIDs: readonly number[],
    options?: { adopt?: boolean },
  ): void;
  addFocusItems(itemIDs: readonly number[]): GraphFocusResult;
  openCollections(collectionIDs: readonly number[]): GraphFocusResult;
  /** The graph as a recipe: seeds, Explore settings, filters, camera, title. */
  getState(): GraphViewState;
  /** Rebuilds the graph from a recipe. Seeds whose item is gone are dropped. */
  applyState(state: GraphViewState): GraphFocusResult;
  /**
   * An external seed with this identity was imported as the item with this
   * key. The seed turns local now when the view's library lists the item.
   */
  markExternalSeedImported(identityKey: string, itemKey: string): void;
  /** Shows a short message in the toolbar for a moment; null clears it. */
  setStatus(message: string | null): void;
  setActive(active: boolean): void;
}

const FOCUS_RELATIONSHIP_CACHE_LIMIT = 200;
const LIBRARY_SEARCH_DEBOUNCE_MS = 180;
const LOCAL_CITATION_WARMUP_DELAY_MS = 1200;
const AUTOMATIC_FOCUS_REFRESH = automaticFocusSeedRefreshPlan();
/**
 * A collapsed detail pane: the resizer is hidden and the shell drops its
 * track, so all 36px are a single strip wide enough for the toolbar's toggle.
 * The pane can then be reopened from the toggle that closed it rather than
 * only by double-clicking the splitter.
 */
const COLLAPSED_DETAIL_WIDTH = "36px";

const cleanupByMount = new WeakMap<Element, () => void>();
const controllerByMount = new WeakMap<Element, GraphViewController>();

export function getGraphViewController(
  mount: Element,
): GraphViewController | null {
  return controllerByMount.get(mount) ?? null;
}

export interface GraphViewOptions {
  mode: "tab" | "window";
  onSelectPaper: (itemID: number) => void | Promise<void>;
  /** Opens the item's best attachment in Zotero; the node menu's "Open PDF". */
  onOpenAttachment?: (itemID: number) => void | Promise<void>;
  /**
   * The graph's own selection changed by the user's hand: the local node's
   * item, or null on a deselect or an external node. Not fired for
   * selections `applyLibrarySelection` makes.
   */
  onGraphSelection?: (itemID: number | null) => void;
  initialFocusItemIDs?: readonly number[] | null;
  initialCollectionIDs?: readonly number[];
  /** Applied after the initial request, so a request wins where both speak. */
  initialState?: GraphViewState | null;
  /** The custom title the host gave this view, reported back in `getState`. */
  title?: string | null;
  /**
   * Fires after seeds, Explore settings, filters or the title change, once
   * per animation frame. Camera moves never fire it; read `getState()` for
   * the camera when it is needed.
   */
  onStateChange?: (state: GraphViewState) => void;
  /**
   * Add to Zotero wrote the item an external work now is. The host records
   * the key against the instance and any view rebuilt meanwhile, then
   * refreshes so the seed resolves to the library item.
   */
  onExternalWorkImported?: (identityKey: string, itemKey: string) => void;
  /** Backs the toolbar's Graph menu. Without it the menu is disabled. */
  savedGraphs?: GraphViewSavedGraphsHost | null;
}

function localPaperByKey(snapshot: LibrarySnapshot): Map<string, ZoteroPaper> {
  return new Map(snapshot.papers.map((paper) => [paper.itemKey, paper]));
}

export function destroyGraphView(mount: Element): void {
  cleanupByMount.get(mount)?.();
  cleanupByMount.delete(mount);
  controllerByMount.delete(mount);
}

export function renderGraphView(
  document: Document,
  mount: Element,
  snapshot: LibrarySnapshot,
  options: GraphViewOptions,
): HTMLElement {
  destroyGraphView(mount);
  ensureStyles(document);
  clear(mount);
  const sharedGraphSnapshot = getCitationGraphSnapshot(snapshot);
  const libraryModel = cloneCitationGraphModel(sharedGraphSnapshot.model);
  const model = {
    nodes: [...libraryModel.nodes],
    edges: [...libraryModel.edges],
    statistics: { ...libraryModel.statistics },
  };
  let libraryGraphIndex = sharedGraphSnapshot.index;
  let libraryGraphRevision = sharedGraphSnapshot.signature;
  let libraryGraphRevisionCounter = 0;
  const markLibraryGraphChanged = (invalidateShared = true): void => {
    libraryGraphIndex = createCitationGraphIndex(libraryModel);
    libraryGraphRevisionCounter += 1;
    libraryGraphRevision = `${sharedGraphSnapshot.signature}:local:${libraryGraphRevisionCounter}`;
    if (invalidateShared) invalidateCitationGraphSnapshot(snapshot.libraryID);
  };
  const paperByKey = localPaperByKey(snapshot);
  const collectionLabels = collectionLabelsByID(snapshot);
  let visibleKeys = new Set(model.nodes.map((node) => node.key));
  /** What the filter admits, before the search box. See `applyFilters`. */
  let scopeKeys = new Set(visibleKeys);
  /** Folder tree lookups, built once: the snapshot's folders never move. */
  const descendantsByID = new Map<number, readonly number[]>(
    snapshot.collections.map((collection) => [
      collection.collectionID,
      collection.includedCollectionIDs.filter(
        (id) => id !== collection.collectionID,
      ),
    ]),
  );
  /**
   * A graph opened on folders is `none`, so a folder made later does not
   * quietly appear in it; a library graph is `all`, so it does. The base is
   * set here, once, and unticking rows never flips it.
   */
  let collectionTicks: GraphViewCollectionTicks = options.initialCollectionIDs
    ?.length
    ? onlyCollectionsTicked([
        ...collectionScopeIDs(
          options.initialCollectionIDs,
          snapshot.collections,
        ),
      ])
    : allCollectionsTicked();
  let includeUnfiled = true;
  let includeExternal = true;
  /**
   * The folders drawn as regions on the plot. A folder graph opens showing
   * its own folder, capped the same way any later selection is.
   */
  let regions: number[] = options.initialCollectionIDs?.length
    ? [...options.initialCollectionIDs].slice(0, MAX_GRAPH_REGIONS)
    : [];
  /** Which swatch each region's folder holds. Never dealt by rank; see B12. */
  const swatches = createSwatchLedgerStore();
  /** Which seed-palette index each seed key holds. */
  const seedSwatches = createSwatchLedgerStore();
  /** Papers the reader removed one by one, by node key. */
  const hiddenKeys = new Set<string>();
  /** What the last `applyFilters` decided, for the rail to print. */
  let lastScope: GraphScopeResult | null = null;
  let selectedNode: CitationGraphNode | null = null;
  let detailTabs: ReturnType<typeof createDetailTabs> | null = null;

  /**
   * What the shared paper detail view needs from this host: the graph selects
   * a paper by moving to its node, a row can ghost itself on the plot, and an
   * ignore or a restore is applied to the model before it is published.
   */
  const graphHost: PaperDetailHost = {
    origin: "graph",
    snapshot,
    collectionChooser: true,
    workImported: (work, item) => {
      const identityKey = stableExternalWorkIdentity(work);
      if (!identityKey) return;
      markExternalSeedImported(identityKey, String(item.key));
      options.onExternalWorkImported?.(identityKey, String(item.key));
    },
    showInZotero: (itemKey) => {
      const paper = paperByKey.get(itemKey);
      if (paper) void selectPaper(paper.itemID);
    },
    rowActions: (work) => {
      const focusNode = focusNodeForWork(work);
      const actions: RowAction[] = [];
      if (focusProjection && !focusProjection.seedKeys.has(focusNode.key)) {
        actions.push({
          label: "Add as seed",
          title:
            "Add this paper as a seed of this graph without adding it to Zotero.",
          run: () => {
            addFocusSeed(focusNode);
          },
        });
      }
      return actions;
    },
    previewRow: (work, context) => () => {
      const sourceKeys = context
        ? relationshipPreviewSourceKeys(model, context.node, work, visibleKeys)
        : (work.citingNodeKeys ?? []).filter((key) => visibleKeys.has(key));
      if (!sourceKeys.length) {
        renderer?.setGhostPreview(null);
        return;
      }
      renderer?.setGhostPreview({
        key: work.providerWorkID ?? work.doi ?? work.title ?? "external",
        title: externalWorkTitle(work),
        authors: work.authors ?? [],
        year: work.year,
        citationCount: work.citationCount ?? null,
        referenceCount: work.referenceCount ?? null,
        sourceKeys,
      });
    },
    clearPreview: () => renderer?.setGhostPreview(null),
    onRelationshipMutation: (event) => {
      applyRelationshipMutationToGraph(event);
      notifyRelationshipMutation(event);
    },
  };
  let focusProjection: GraphFocusProjection | null = null;
  const focusSeedRegistry = new Map<string, CitationGraphNode>();
  const focusRelationships = new Map<
    string,
    { references: ExternalWork[]; citedBy: ExternalWork[] }
  >();
  const focusRefreshInFlight = new Map<string, Promise<void>>();
  const focusRefreshTimers = new Map<string, number>();
  const focusRefreshQueue = new SerializedTaskQueue();
  let focusRefreshEpoch = 0;
  let focusRefreshCount = 0;
  let focusLoadActive = false;
  let focusRebuildFrame = 0;
  let activeRelationshipView: {
    itemKey: string;
    direction: "references" | "cited-by";
  } | null = null;
  let refreshActiveRelationshipView: (() => void) | null = null;
  let activeRelationshipList: RelationshipList | null = null;
  let relationshipDetailRefreshFrame = 0;
  let relationshipGraphRefreshTimer = 0;
  let renderer: CitationGraphRenderer | null = null;
  let cleaned = false;
  let viewActive = true;
  /**
   * True while the view is selecting a node itself — a synced library
   * selection, a restore, an opened state — so the selection is not reported
   * back to Zotero as if the user had clicked it.
   */
  let suppressSelectionReport = false;
  /** Runs `run` with selection reporting off, restoring the previous state. */
  const withoutSelectionReport = <T>(run: () => T): T => {
    const previous = suppressSelectionReport;
    suppressSelectionReport = true;
    try {
      return run();
    } finally {
      suppressSelectionReport = previous;
    }
  };
  /** The nodes a multi-item library selection emphasises, until the user moves on. */
  let libraryEmphasisKeys: ReadonlySet<string> | null = null;
  /** What the Key rail is emphasising (hover or pinned), or null. */
  let railEmphasisKeys: ReadonlySet<string> | null = null;
  /** The rail wins while it is emphasising; otherwise the library selection shows. */
  const applyEmphasis = (): void => {
    renderer?.setEmphasis(railEmphasisKeys ?? libraryEmphasisKeys);
  };
  let inactiveRelationshipDirty = false;
  let applyFilters = (): void => undefined;
  /**
   * Tells the host the recipe changed. Assigned once `getState` exists; the
   * filter controller below closes over it long before that.
   */
  let notifyStateChange: () => void = () => undefined;
  let markExternalSeedImported = (
    _identityKey: string,
    _itemKey: string,
  ): void => undefined;
  /** Rebuild the Key from the graph as it now stands. Assigned once the rail exists. */
  let refreshKeyRail = (): void => undefined;
  /** Rebuild the Scope rows and hand the renderer their regions. Assigned once the rail exists. */
  let refreshScopeRail: () => void = () => undefined;
  /**
   * The regions the renderer should draw, coloured from the swatch ledger.
   * Assigned once the plot model exists; `toggleRow`/`selectRow` close over
   * it long before that.
   */
  let regionsForRenderer: () => Array<{
    collectionID: number;
    color: string;
    nodeKeys: ReadonlySet<string>;
  }> = () => [];
  /** What the search is currently matching, so the Key can name that mark. */
  let searchMatchKeys: Set<string> | null = null;
  const initialLayout = getGraphAppearance();
  const selectPaper = async (itemID: number): Promise<void> => {
    try {
      await options.onSelectPaper(itemID);
    } catch (error) {
      Zotero.logError(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  };

  const root = element(document, "div", "meristema-root");
  root.dataset.mode = options.mode;

  // The chrome reads the same tokens the canvas draws with. The scheme is
  // re-resolved on every change rather than read from a held media query,
  // which goes stale in a chrome document — see graphTheme.ts.
  const applyTheme = (): void => {
    applyGraphThemeToDocument(
      root,
      graphThemeFor(resolveGraphScheme(document.defaultView)),
    );
  };
  applyTheme();
  const disposeThemeObserver = observeGraphScheme(
    document.defaultView,
    applyTheme,
  );

  // Zotero has no toolbar spanning its window. It gives each pane a toolbar
  // inside it — `#zotero-toolbar-collection-tree` in the collections pane,
  // `#zotero-toolbar-item-tree` in the items pane — so the band across the top
  // of the library is two toolbars cut by the pane splitter, and the trees
  // below them start at the same y in every tab. This view followed suit: the
  // identity goes in the rail's toolbar, everything that acts on the graph
  // goes in the plot's, and neither spans the width.
  const plotToolbar = element(document, "div", "cm-plot-toolbar");
  const identity = element(document, "div", "cm-command-identity");
  const titleRow = element(document, "div", "cm-title-row");
  // The heading names the view for anyone navigating by headings, and the tab
  // or window title already says it on screen, so it is taken out of the
  // layout rather than out of the document.
  const viewTitle = text(document, "h1", "Graph", "cm-visually-hidden");
  titleRow.append(networkLogo(document), viewTitle);
  const summary = text(
    document,
    "p",
    `${formatCount(snapshot.statistics.totalPapers)} nodes - ${formatCount(model.statistics.edges)} links`,
    "cm-library-summary",
  );
  identity.append(titleRow, summary);

  const toolbar = element(document, "div", "cm-command-actions");
  const graphFilterDescriptors = new Map<string, PaperListDescriptor>();
  const descriptorForGraphNode = (
    node: CitationGraphNode,
  ): PaperListDescriptor | null => {
    if (node.kind === "external" && node.externalWork) {
      return {
        ...describeExternalWork(
          node.externalWork as ExternalWork,
          snapshot.libraryID,
          true,
          false,
          paperByKey,
        ),
        key: node.key,
      };
    }
    const paper = paperByKey.get(node.itemKey);
    if (!paper) return null;
    return {
      ...describeZoteroPaper(paper),
      key: node.key,
      year: node.year,
      citationCount: node.citationCount,
      referenceCount: node.referenceCount,
      tags: node.tags,
      collectionIDs: node.collectionIDs,
      isOpenAccess: node.isOpenAccess,
      isRetracted: node.isRetracted,
    };
  };
  const rebuildGraphFilterDescriptors = (): void => {
    graphFilterDescriptors.clear();
    for (const node of model.nodes) {
      const descriptor = descriptorForGraphNode(node);
      if (descriptor) graphFilterDescriptors.set(node.key, descriptor);
    }
  };
  rebuildGraphFilterDescriptors();
  const graphFilter = createPaperFilterController({
    document,
    // The rail's tree is where a graph's folders live now; a second, silent
    // folder control inside the popover would be a way to say the same thing
    // twice and disagree.
    buttonClassName: "cm-toolbar-button",
    getDescriptors: () => [...graphFilterDescriptors.values()],
    onChange: () => {
      applyFilters();
      notifyStateChange();
    },
  });
  const similarButton = element(document, "button", "cm-toolbar-button");
  similarButton.type = "button";
  similarButton.append(iconButtonContent(document, "similar", "Similar"));
  similarButton.title =
    "Find papers related to the currently visible papers without adding them automatically.";
  const exportWrap = element(document, "div", "cm-menu-wrapper");
  const exportButton = element(document, "button", "cm-toolbar-button");
  exportButton.type = "button";
  exportButton.append(iconButtonContent(document, "export", "Export"));
  exportButton.title = "Export only the currently visible citation graph.";
  exportButton.setAttribute("aria-expanded", "false");
  const exportMenu = element(document, "div", "cm-export-menu");
  exportMenu.hidden = true;
  for (const [format, label] of [
    ["png", "PNG image"],
    ["json", "JSON graph data"],
    ["csv", "CSV citation links"],
  ]) {
    const button = element(document, "button");
    button.type = "button";
    button.dataset.format = format;
    button.textContent = label;
    exportMenu.appendChild(button);
  }
  exportWrap.append(exportButton, exportMenu);
  // The Graph menu: the document commands. Built like the Export menu, one
  // popup under one toolbar button, so the two read as siblings. Open is a
  // group inside the same popup rather than a nested hover menu: a hand-built
  // submenu is a second thing to keep open, and a list of names with a
  // heading says "open one of these" just as well.
  const graphWrap = element(
    document,
    "div",
    "cm-menu-wrapper cm-graph-menu-wrap",
  );
  const graphButton = element(document, "button", "cm-toolbar-button");
  graphButton.type = "button";
  graphButton.append(iconButtonContent(document, "document", "File"));
  graphButton.title = "New, open, save, or save this graph as a new one.";
  graphButton.setAttribute("aria-expanded", "false");
  graphButton.setAttribute("aria-controls", "meristema-graph-menu");
  const graphMenu = element(document, "div", "cm-export-menu cm-graph-menu");
  graphMenu.id = "meristema-graph-menu";
  graphMenu.hidden = true;
  const newGraphButton = element(document, "button");
  newGraphButton.type = "button";
  newGraphButton.dataset.action = "new";
  newGraphButton.textContent = "New Graph";
  const saveButton = element(document, "button");
  saveButton.type = "button";
  saveButton.dataset.action = "save";
  saveButton.textContent = "Save";
  const saveAsButton = element(document, "button");
  saveAsButton.type = "button";
  saveAsButton.dataset.action = "save-as";
  saveAsButton.textContent = "Save as…";
  const graphMenuHeading = text(
    document,
    "div",
    "Open",
    "cm-graph-menu-heading",
  );
  const graphMenuList = element(document, "div", "cm-graph-menu-list");
  graphMenu.append(
    newGraphButton,
    graphMenuHeading,
    graphMenuList,
    saveButton,
    saveAsButton,
  );
  graphWrap.append(graphButton, graphMenu);
  if (!options.savedGraphs) {
    graphButton.disabled = true;
    graphButton.title = "Saved graphs are not available in this view.";
  }
  // Short confirmations ("Saved", "Autosave failed") beside the toolbar.
  const toolbarStatus = element(document, "span", "cm-toolbar-status");
  toolbarStatus.setAttribute("role", "status");
  toolbarStatus.hidden = true;
  const refreshButton = element(document, "button", "cm-toolbar-button");
  refreshButton.type = "button";
  refreshButton.append(iconButtonContent(document, "refresh", "Refresh"));
  refreshButton.title =
    "Refresh metadata and citation counts for the currently visible papers.";
  const searchWrap = element(document, "label", "cm-search-wrap");
  searchWrap.appendChild(icon(document, "search"));
  const search = element(document, "input", "cm-search");
  search.type = "search";
  search.placeholder = "Search all fields";
  search.setAttribute("aria-label", "Search all fields in the current view");
  searchWrap.appendChild(search);

  // The things that act on the graph, then the search at the far right — the
  // order and the alignment of `#zotero-items-toolbar`, which ends
  // with a flexible spacer and the quick search. The search is the only
  // elastic item, so it takes the slack and everything else keeps its size.
  const focusSeedMenu = element(
    document,
    "div",
    "cm-focus-seed-menu cm-menu-wrapper",
  );
  const focusSeedPopover = element(document, "div", "cm-focus-seed-popover");
  focusSeedPopover.id = "meristema-focus-seed-popover";
  focusSeedPopover.hidden = true;
  focusSeedPopover.setAttribute("role", "dialog");
  focusSeedPopover.setAttribute("aria-label", "Explore seeds");
  const focusSeedSearchWrap = element(
    document,
    "label",
    "cm-focus-seed-search-wrap",
  );
  focusSeedSearchWrap.appendChild(icon(document, "search"));
  const focusSeedSearch = element(document, "input", "cm-focus-seed-search");
  focusSeedSearch.type = "search";
  focusSeedSearch.placeholder = "Search seeds or library";
  focusSeedSearch.setAttribute(
    "aria-label",
    "Search seeds and the Zotero library",
  );
  focusSeedSearchWrap.appendChild(focusSeedSearch);
  const focusSeedResults = element(document, "div", "cm-focus-seed-results");
  focusSeedResults.setAttribute("role", "list");
  focusSeedPopover.append(focusSeedSearchWrap, focusSeedResults);
  focusSeedMenu.appendChild(focusSeedPopover);

  const focusDirection = element(document, "select", "cm-select");
  for (const [value, label] of [
    ["both", "References + cited by"],
    ["references", "References"],
    ["cited-by", "Cited by"],
  ] as const) {
    const option = element(document, "option");
    option.value = value;
    option.textContent = label;
    focusDirection.appendChild(option);
  }
  const focusLocality = element(document, "select", "cm-select");
  for (const [value, label] of [
    ["all", "All known papers"],
    ["local", "In Zotero only"],
  ] as const) {
    const option = element(document, "option");
    option.value = value;
    option.textContent = label;
    focusLocality.appendChild(option);
  }
  // Direction and scope are settings of the graph, so they live with the
  // graph display settings behind the Key rail's gear, as that panel's first
  // section. They mean nothing without a seed, so the section is hidden
  // while the graph is seedless. Ranking and the per-seed limit are gone:
  // every neighbour a seed has is shown.
  const exploreSection = element(
    document,
    "fieldset",
    "cm-appearance-section cm-explore-section",
  );
  exploreSection.hidden = true;
  exploreSection.style.display = "none";
  exploreSection.appendChild(text(document, "legend", "Explore"));
  for (const [label, control] of [
    ["Direction", focusDirection],
    ["Scope", focusLocality],
  ] as const) {
    const row = element(document, "label", "cm-appearance-row");
    row.append(text(document, "span", label), control);
    exploreSection.appendChild(row);
  }

  // File first: the menu that owns the document leads the bar, as it does in
  // any application, and the actions on the document follow it (B21). The
  // search box stays at the far right as the bar's one elastic item.
  toolbar.append(
    graphWrap,
    graphFilter.root,
    similarButton,
    exportWrap,
    refreshButton,
  );
  plotToolbar.append(toolbar, toolbarStatus, searchWrap);

  // The rail's "+ Add seed" link stays on every path so the view keeps one
  // shape: it is how the first seed is added, so it is always live. The
  // Explore section behind the gear has nothing to set until there is a seed,
  // so it is hidden rather than disabled.
  const setSeeded = (seeded: boolean): void => {
    root.dataset.seeded = seeded ? "true" : "false";
    exploreSection.hidden = !seeded;
    exploreSection.style.display = seeded ? "" : "none";
    refreshButton.title = seeded
      ? "Refresh references and citing papers for the current Explore seeds."
      : "Refresh metadata and citation counts for the currently visible papers.";
    if (!seeded) {
      refreshButton.removeAttribute("aria-busy");
      refreshButton.disabled = false;
    }
  };
  setSeeded(false);

  const main = element(document, "main", "cm-main");
  /*
   * The plot and the things that act on it, in one column — Zotero's
   * `#zotero-items-pane-container`, which holds the items toolbar above the
   * items tree.
   */
  const plotPane = element(document, "div", "cm-plot-pane");
  const graphArea = element(document, "section", "cm-graph-area");
  const canvas = element(document, "canvas", "cm-graph-canvas");
  canvas.setAttribute(
    "aria-label",
    "Interactive citation graph. Arrows point from citing papers to cited papers.",
  );
  graphArea.appendChild(canvas);
  const zoom = element(document, "div", "cm-zoom-controls");
  // Drawn glyphs, not typed ones: "+", "−" and "⌖" each sat on the font's
  // baseline rather than in the middle of the button they were centred in.
  for (const [action, glyph, description] of [
    ["in", "zoom-in", "Zoom in"],
    ["out", "zoom-out", "Zoom out"],
    ["fit", "fit", "Fit graph to view"],
  ] as [string, IconName, string][]) {
    const button = element(document, "button", "cm-rail-button");
    button.type = "button";
    button.dataset.action = action;
    button.append(icon(document, glyph));
    button.title = description;
    button.setAttribute("aria-label", description);
    zoom.appendChild(button);
  }
  // Mounted into the rail's footer further down, once the rail exists. It stays
  // out of the plot's corner, where it sat on top of the graph.

  // A graph view only draws connections between papers already in the
  // library, so opening one on a single item renders a single node. Without
  // this the view looks broken rather than empty by definition.
  const emptyState = element(document, "div", "cm-empty-state");
  emptyState.hidden = true;
  const emptyStateTitle = text(document, "p", "", "cm-empty-state-title");
  const emptyStateBody = text(document, "p", "", "cm-empty-state-body");
  emptyState.append(emptyStateTitle, emptyStateBody);
  graphArea.appendChild(emptyState);

  // The node's right-click menu. Two items: the seed toggle and Explore-from.
  // It lives in the graph area so it is clamped to the plot, not the window.
  const nodeMenu = element(document, "div", "cm-node-menu");
  nodeMenu.hidden = true;
  nodeMenu.setAttribute("role", "menu");
  nodeMenu.setAttribute("aria-label", "Paper actions");
  const nodeMenuOpen = element(document, "button", "cm-node-menu-item");
  nodeMenuOpen.type = "button";
  nodeMenuOpen.setAttribute("role", "menuitem");
  nodeMenuOpen.hidden = true;
  const nodeMenuSeed = element(document, "button", "cm-node-menu-item");
  nodeMenuSeed.type = "button";
  nodeMenuSeed.setAttribute("role", "menuitem");
  const nodeMenuRemove = element(document, "button", "cm-node-menu-item");
  nodeMenuRemove.type = "button";
  nodeMenuRemove.setAttribute("role", "menuitem");
  nodeMenuRemove.textContent = "Remove from graph";
  nodeMenu.append(nodeMenuOpen, nodeMenuSeed, nodeMenuRemove);
  graphArea.appendChild(nodeMenu);
  let nodeMenuTarget: CitationGraphNode | null = null;
  let nodeMenuOpenEntry: OpenPaperEntry | null = null;
  let currentLayout = initialLayout;
  let cameraFrame = 0;
  /**
   * A camera handed in with a state. The seeds' automatic relationship check
   * ends with a fit, which would throw a restored camera away; while this is
   * set, that fit places the camera here instead.
   */
  let restoredCamera: GraphViewTransform | null = null;
  let focusFitGeneration = 0;
  const focusPostRefreshFitSeeds = new Set<string>();
  const cancelCameraFrame = (): void => {
    if (!cameraFrame) return;
    const view = document.defaultView;
    if (view) view.cancelAnimationFrame(cameraFrame);
    else clearTimeout(cameraFrame);
    cameraFrame = 0;
  };
  const scheduleCameraAction = (action: () => void): void => {
    cancelCameraFrame();
    const view = document.defaultView;
    const run = (): void => {
      cameraFrame = 0;
      if (!cleaned) action();
    };
    cameraFrame = view
      ? view.requestAnimationFrame(run)
      : (setTimeout(run, 0) as unknown as number);
  };
  const scheduleFocusFit = (): void => {
    cancelCameraFrame();
    const generation = ++focusFitGeneration;
    const view = document.defaultView;
    let previousWidth = -1;
    let previousHeight = -1;
    let previousNodeCount = -1;
    let stableFrames = 0;
    let attempts = 0;

    const check = (): void => {
      cameraFrame = 0;
      if (cleaned || !focusProjection || generation !== focusFitGeneration) {
        return;
      }
      renderer?.resizeViewport();
      const rect = renderer?.getCanvas().getBoundingClientRect();
      const nodeCount = focusProjection.nodes.length;
      const ready = Boolean(rect && rect.width >= 240 && rect.height >= 180);
      const stable =
        ready &&
        Math.abs(rect!.width - previousWidth) < 0.5 &&
        Math.abs(rect!.height - previousHeight) < 0.5 &&
        nodeCount === previousNodeCount;
      stableFrames = stable ? stableFrames + 1 : 0;
      previousWidth = rect?.width ?? previousWidth;
      previousHeight = rect?.height ?? previousHeight;
      previousNodeCount = nodeCount;
      attempts += 1;

      if (stableFrames >= 2 || attempts >= 24) {
        if (restoredCamera) {
          renderer?.setViewTransform(restoredCamera);
          // The seeds' automatic relationship check ends with one more fit
          // once every seed has reported; the camera stays armed until then.
          if (!focusPostRefreshFitSeeds.size) restoredCamera = null;
        } else {
          renderer?.fitVisibleNodes();
        }
        return;
      }
      cameraFrame = view
        ? view.requestAnimationFrame(check)
        : (setTimeout(check, 16) as unknown as number);
    };

    cameraFrame = view
      ? view.requestAnimationFrame(check)
      : (setTimeout(check, 0) as unknown as number);
  };
  const fitCurrentGraph = (): void => {
    if (focusProjection) renderer?.fitVisibleNodes();
    else renderer?.fitView();
  };
  let sourceMetricsRefreshActive = false;
  const refreshSourceMetricsForLayout = (layout: GraphLayoutOptions): void => {
    if (!graphLayoutUsesSourceMetrics(layout) || sourceMetricsRefreshActive)
      return;
    sourceMetricsRefreshActive = true;
    const candidates = model.nodes.filter(
      (node) => node.kind !== "external" && visibleKeys.has(node.key),
    );
    void ensureSourceMetricsForNodes(candidates, () => {
      if (cleaned || !graphLayoutUsesSourceMetrics(currentLayout)) return;
      renderer?.setLayout(currentLayout);
      fitCurrentGraph();
    })
      .then((updated) => {
        if (
          !updated ||
          cleaned ||
          !graphLayoutUsesSourceMetrics(currentLayout)
        ) {
          return;
        }
        renderer?.setLayout(currentLayout);
        fitCurrentGraph();
        if (selectedNode) renderOverview(selectedNode);
      })
      .finally(() => {
        sourceMetricsRefreshActive = false;
      });
  };
  const appearance = createAxesAppearance(
    document,
    initialLayout,
    model.nodes,
    (layout) => {
      currentLayout = layout;
      renderer?.setLayout(layout);
      fitCurrentGraph();
      refreshSourceMetricsForLayout(layout);
    },
    (layout) => {
      if (focusProjection) setFocusGraphAppearance(layout);
      else setGraphAppearance(layout);
    },
    () =>
      focusProjection
        ? resetFocusGraphAppearance(getGraphAppearance())
        : resetGraphAppearance(),
  );
  appearance.panel.prepend(exploreSection);
  currentLayout = appearance.getLayout();
  /*
   * Both of these panels used to close only by pressing their own button
   * again, which is not how a menu behaves anywhere else in Zotero. The
   * appearance panel had a closer, but it was on the graph area — and since
   * the panel moved into the rail's footer, a click on the rail, on either
   * toolbar or on the detail pane never reached it. These sit on the
   * document, like the Focus seed popover's above, so any pointer landing
   * outside the control dismisses it. Capture phase, so the click that
   * closes still does whatever it was aimed at.
   */
  const closeAppearanceOnOutsidePointer = (event: Event): void => {
    if (appearance.panel.hidden) return;
    const target = event.target as Node | null;
    if (target && appearance.root.contains(target)) return;
    if (insideSelectDropdown(target)) return;
    appearance.close();
  };
  const closeAppearanceOnEscape = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || appearance.panel.hidden) return;
    appearance.close();
    appearance.button.focus();
  };
  document.addEventListener(
    "pointerdown",
    closeAppearanceOnOutsidePointer,
    true,
  );
  document.addEventListener("keydown", closeAppearanceOnEscape, true);

  const detailShell = element(document, "div", "cm-detail-shell");
  const resizer = element(document, "div", "cm-detail-resizer");
  resizer.tabIndex = 0;
  resizer.setAttribute("role", "separator");
  const detail = element(
    document,
    "aside",
    "cm-detail-panel meristema-paper-detail",
  );
  /*
   * The pane in three parts, top to bottom: a toolbar level with the other two
   * panes' that holds the pane's navigation and never moves, then Zotero's
   * item-pane header — `item-pane-header` above `item-details` — and then the
   * body, which is the only part that scrolls. Everything the panel draws goes
   * in the body; the toolbar and the header are written only by `setDetailNav`
   * and `setDetailHeader`, so a view that clears the body has to name its own
   * rather than inherit the last one's.
   */
  const detailToolbar = element(document, "div", "cm-detail-toolbar");
  const detailNav = element(document, "div", "cm-detail-nav");
  const detailToggle = element(document, "button", "cm-detail-toggle");
  detailToggle.type = "button";
  /*
   * The toggle first, then the tabs. The Key rail's toggle sits at the rail's
   * inner edge — the one facing the plot — so this one sits at the detail
   * pane's inner edge too: the two flank the plot and both point outward. At
   * the far end it read as a fourth tab crowded against "References 57", and
   * a chevron beside a tab row is an overflow control, not a pane control.
   */
  detailToolbar.append(detailToggle, detailNav);
  const detailHeader = element(document, "header", "cm-detail-header");
  const detailBody = element(document, "div", "cm-detail-body");
  detail.append(detailToolbar, detailHeader, detailBody);
  detailShell.append(resizer, detail);
  // Width and collapse for both side panes belong to Zotero's own panes: the
  // collections pane on the left, the item pane on the right. The graph draws
  // what they say and writes back what its handles do.
  const hostWindow = document.defaultView as Window;
  const collectionsPane = bindZoteroPane("collections", hostWindow);
  const itemPane = bindZoteroPane("item", hostWindow);

  const applyDetailState = (state: ZoteroPaneState): void => {
    detailShell.dataset.collapsed = String(state.collapsed);
    detailShell.style.width = state.collapsed
      ? COLLAPSED_DETAIL_WIDTH
      : `${Math.round(state.width)}px`;
    // Mirror the Key rail: hide the drag handle while collapsed so a drag
    // from the collapsed state can't reopen the graph's pane without
    // Zotero's item pane following (see attachPaneResizer's onMove below).
    resizer.hidden = state.collapsed;
  };
  applyDetailState(itemPane.read());
  /**
   * One emphasis, whatever raised it. A Seeds row lights that seed and the
   * papers it reached — which is the seed's edges, since every edge a seed
   * has runs to one of them.
   */
  const emphasisKeys = (
    emphasis: RailEmphasis | null,
  ): ReadonlySet<string> | null => {
    if (!emphasis) return null;
    if (emphasis.kind === "key") {
      const matches = emphasis.entry.matches;
      if (!matches) return null;
      return new Set(
        model.nodes.filter((node) => matches(node)).map((node) => node.key),
      );
    }
    if (emphasis.kind === "seed") {
      const reached =
        focusProjection?.reachedBySeed.get(emphasis.seedKey) ??
        new Set<string>();
      return new Set([emphasis.seedKey, ...reached]);
    }
    const collectionID = emphasis.collectionID;
    return new Set(
      model.nodes
        .filter((node) => node.collectionIDs.includes(collectionID))
        .map((node) => node.key),
    );
  };
  const keyRail = createKeyRail({
    document,
    onEmphasise: (emphasis: RailEmphasis | null) => {
      railEmphasisKeys = emphasisKeys(emphasis);
      applyEmphasis();
    },
    onScope: {
      toggleRow: (row, ticked) => {
        if (row.kind === "collection") {
          // The cascade: toggling a parent writes the same tick to its whole
          // subtree, because a graph scoped to a parent already drew it.
          collectionTicks = setCollectionTicks(
            collectionTicks,
            row.cascadeIDs,
            ticked,
          );
          // Unticking a selected folder clears its region, the mirror of
          // selecting an unticked one ticking it: a region with nothing
          // inside says nothing. The tick above was written for the whole
          // cascade (the clicked folder and every descendant), so a
          // descendant that held its own region independently goes out of
          // scope too — filter against the whole cascade, not just the
          // clicked row's own ID, or that descendant's now-empty region
          // would linger in `regions` and occupy one of the four slots.
          if (!ticked) {
            const droppedIDs = new Set(row.cascadeIDs);
            regions = regions.filter((id) => !droppedIDs.has(id));
          }
        } else if (row.kind === "unfiled") {
          includeUnfiled = ticked;
        } else {
          includeExternal = ticked;
        }
        ensureSwatchesFor();
        applyFilters();
        notifyStateChange();
      },
      selectRow(row, selected) {
        if (row.kind !== "collection") return;
        // Selecting an unticked folder ticks it first: an out-of-scope
        // folder has no papers on the plot, so its region would be empty.
        if (selected && row.state === "off") {
          this.toggleRow(row, true);
        }
        regions = nextRegionSelection(
          regions,
          row.collectionID,
          MAX_GRAPH_REGIONS,
        );
        ensureSwatchesFor();
        notifyStateChange();
        // refreshScopeRail() below already calls regionsForRenderer() and
        // hands the result to renderer.setRegions — a direct call here
        // would just repeat that work with the same answer.
        refreshScopeRail();
      },
      removeSeed: (seedKey) => removeFocusSeed(seedKey),
      addSeed: (anchor) => openFocusSeedPopover(anchor),
      showAllHidden: () => {
        if (!hiddenKeys.size) return;
        hiddenKeys.clear();
        applyFilters();
        notifyStateChange();
      },
    },
    onCollapsedChange: (collapsed) => collectionsPane.setCollapsed(collapsed),
  });
  {
    const state = collectionsPane.read();
    keyRail.setWidth(state.width);
    keyRail.setCollapsed(state.collapsed);
  }
  const unsubscribeCollectionsPane = collectionsPane.subscribe((state) => {
    keyRail.setWidth(state.width);
    keyRail.setCollapsed(state.collapsed);
  });
  const unsubscribeItemPane = itemPane.subscribe((state) => {
    applyDetailState(state);
    syncDetailToggle();
  });
  // The two controls that used to float over the plot's corners. The
  // appearance panel opens upward from the footer, so it still has the whole
  // window's height to open into.
  keyRail.footer.append(zoom, appearance.root);
  // The counts name what the Key is a key to, so they sit above it, in the
  // rail's own toolbar rather than in a band across the window.
  keyRail.toolbar.prepend(identity);
  plotPane.append(plotToolbar, graphArea);
  // The seed panel is anchored to the rail's "+ Add seed" link but floats over
  // the plot's left edge, so it hangs off the plot pane and keeps its 430px
  // width rather than being squeezed into the rail.
  focusSeedMenu.classList.add("cm-focus-seed-menu--rail");
  plotPane.appendChild(focusSeedMenu);
  main.append(keyRail.root, plotPane, detailShell);
  root.appendChild(main);
  mount.appendChild(root);

  const libraryPaperByID = new Map(
    snapshot.papers.map((paper) => [paper.itemID, paper]),
  );
  let librarySearchGeneration = 0;
  let librarySearchTimer: number | null = null;

  const searchLibraryPapers = async (
    query: string,
  ): Promise<LibraryPaperSearchEntry[]> => {
    const search = new Zotero.Search();
    search.libraryID = snapshot.libraryID;
    search.addCondition("quicksearch-titleCreatorYear", "contains", query);
    const resultIDs = (await search.search()) as number[];
    return mapCooperatively(
      resultIDs,
      (itemID) => {
        const paper = libraryPaperByID.get(Number(itemID));
        if (!paper) return null;
        let shortTitle = "";
        let court = "";
        let citationKey = "";
        try {
          const item = Zotero.Items.get(paper.itemID) as Zotero.Item | null;
          shortTitle = String(item?.getField?.("shortTitle") ?? "");
          court = String(item?.getField?.("court") ?? "");
          citationKey = String(item?.getField?.("citationKey") ?? "");
        } catch (error) {
          Zotero.debug(
            `Meristema: could not rank item ${paper.itemID}: ${String(error)}`,
          );
        }
        return {
          paper,
          titleText: normalizeSearch(paper.title),
          authorText: normalizeSearch(paper.authors.join(" ")),
          mainPropertyText: normalizeSearch(
            [
              paper.sourceTitle ?? "",
              paper.year ?? "",
              paper.publicationDate ?? "",
              shortTitle,
              court,
              citationKey,
            ].join(" "),
          ),
        };
      },
      { forceEvery: 20 },
    ).then((entries) =>
      entries.filter((entry): entry is LibraryPaperSearchEntry =>
        Boolean(entry),
      ),
    );
  };

  /**
   * The library papers that match `query`, best first, capped at fifty. Null
   * when the search failed. Resolves early and empty when a newer search has
   * started, so a stale result is never rendered over a fresh one.
   */
  async function rankLibraryPapers(
    query: string,
    generation: number,
  ): Promise<ZoteroPaper[] | null> {
    const index = await searchLibraryPapers(query).catch((error) => {
      Zotero.logError(
        error instanceof Error ? error : new Error(String(error)),
      );
      return null;
    });
    if (generation !== librarySearchGeneration) return [];
    if (!index) return null;
    const matches: Array<{
      entry: LibraryPaperSearchEntry;
      score: number;
    }> = [];
    const compareMatches = (
      left: { entry: LibraryPaperSearchEntry; score: number },
      right: { entry: LibraryPaperSearchEntry; score: number },
    ): number =>
      right.score - left.score ||
      left.entry.paper.title.localeCompare(right.entry.paper.title, undefined, {
        sensitivity: "base",
      });
    await mapCooperatively(
      index,
      (entry) => {
        if (generation !== librarySearchGeneration) return;
        const score = scoreLibraryPaperSearch(entry, query);
        const candidate = { entry, score };
        const insertion = matches.findIndex(
          (current) => compareMatches(candidate, current) < 0,
        );
        if (insertion < 0) matches.push(candidate);
        else matches.splice(insertion, 0, candidate);
        if (matches.length > 50) matches.pop();
      },
      { forceEvery: 100 },
    );
    return matches.map(({ entry }) => entry.paper);
  }

  const updateEmptyState = (visibleCount: number): void => {
    // A seeded view fetches its own neighbours, so an empty projection there
    // is a transient loading state rather than a misunderstanding worth
    // explaining.
    if (focusProjection || visibleCount > 1) {
      emptyState.hidden = true;
      return;
    }
    emptyState.hidden = false;
    emptyStateTitle.textContent = visibleCount
      ? "Only one paper in this graph"
      : "This graph is empty";
    emptyStateBody.textContent = visibleCount
      ? "Without seeds, a graph shows how papers you already have cite each " +
        "other, so a single paper has nothing to connect to. Add more with " +
        "the + button in the toolbar, or select several papers in your " +
        "Zotero library, right-click, and choose “Show in” this graph. To " +
        "look beyond your library, right-click a paper and choose " +
        "“Explore in” this graph for its references and citing works."
      : "Without seeds, a graph shows how papers you already have cite each " +
        "other. Add papers with the + button in the toolbar, or select " +
        "several in your Zotero library and right-click → “Show in New " +
        "Graph”. To find work you do not have yet, right-click a paper and " +
        "choose “Explore in New Graph”.";
  };

  const updateSummary = (): void => {
    const renderedKeys = new Set(visibleKeys);
    updateEmptyState(renderedKeys.size);
    // Every path that changes what the graph shows already ends here, so this
    // is the one place the Key has to be rebuilt from.
    refreshKeyRail();
    const base = `${formatCount(renderedKeys.size)} nodes - ${formatCount(
      renderer?.getVisibleEdgeCount() ?? 0,
    )} links`;
    summary.textContent = base;
  };

  const focusStateFromControls = (seedKeys: string[]): GraphFocusState => ({
    seedKeys: [...new Set(seedKeys)],
    direction: focusDirection.value as GraphFocusDirection,
    locality: focusLocality.value as GraphFocusLocality,
    ranking: "relevance",
    maxPerDirection: Number.POSITIVE_INFINITY,
  });

  const resolveFocusSeed = (
    candidate: CitationGraphNode,
  ): CitationGraphNode => {
    const local =
      candidate.itemID > 0
        ? libraryModel.nodes.find(
            (node) =>
              node.key === candidate.key || node.itemID === candidate.itemID,
          )
        : null;
    const seed = local ?? candidate;
    focusSeedRegistry.set(seed.key, seed);
    return seed;
  };

  const seedRelationshipGraph = (
    seed: CitationGraphNode,
  ): typeof libraryModel => {
    if (libraryModel.nodes.some((node) => node.key === seed.key)) {
      return libraryModel;
    }
    return {
      nodes: [...libraryModel.nodes, seed],
      edges: [...libraryModel.edges],
      statistics: { ...libraryModel.statistics },
    };
  };

  const cacheFocusRelationships = (
    seedKey: string,
    relationships: { references: ExternalWork[]; citedBy: ExternalWork[] },
  ): void => {
    setFocusRelationshipFragment(snapshot.libraryID, seedKey, relationships);
  };

  const ensureFocusRelationships = (
    seed: CitationGraphNode,
  ): { references: ExternalWork[]; citedBy: ExternalWork[] } => {
    const existing = focusRelationships.get(seed.key);
    if (existing) return existing;
    const shared = getFocusRelationshipFragment(snapshot.libraryID, seed.key);
    if (shared) {
      focusRelationships.set(seed.key, shared);
      return shared;
    }
    const graph = seedRelationshipGraph(seed);
    const cachedReferences = getRelationshipViewSnapshot(
      graph,
      seed,
      "references",
      snapshot.libraryID,
      FOCUS_RELATIONSHIP_CACHE_LIMIT,
      { queueBackgroundHydration: false },
    ).works;
    const embeddedReferences = (
      seed.externalWork?.references?.length
        ? seed.externalWork.references
        : seed.references
    ) as ExternalWork[];
    const relationships = {
      // Some providers include references in the paper summary itself. Use
      // those immediately instead of waiting for a second endpoint request.
      references: mergeRelatedWorkLists(
        cachedReferences,
        embeddedReferences,
      ) as ExternalWork[],
      citedBy: getRelationshipViewSnapshot(
        graph,
        seed,
        "cited-by",
        snapshot.libraryID,
        FOCUS_RELATIONSHIP_CACHE_LIMIT,
        { queueBackgroundHydration: false },
      ).works,
    };
    focusRelationships.set(seed.key, relationships);
    cacheFocusRelationships(seed.key, relationships);
    return relationships;
  };

  const externalWorkForFocusSeed = (seed: CitationGraphNode): ExternalWork => {
    const external = seed.externalWork;
    return {
      ...(external ?? {
        provider: seed.provider ?? "manual",
        providerWorkID: seed.providerWorkID,
        doi: seed.doi,
        title: seed.title || null,
        year: seed.year,
        authors: [...seed.authors],
      }),
      provider: external?.provider ?? seed.provider ?? "manual",
      providerWorkID: seed.providerWorkID ?? external?.providerWorkID ?? null,
      doi: seed.doi ?? external?.doi ?? null,
      title: seed.title || external?.title || null,
      year: seed.year ?? external?.year ?? null,
      publicationDate:
        seed.publicationDate ?? external?.publicationDate ?? null,
      authors: seed.authors.length
        ? [...seed.authors]
        : [...(external?.authors ?? [])],
      sourceTitle: seed.sourceTitle ?? external?.sourceTitle ?? null,
      citationCount: seed.citationCount ?? external?.citationCount ?? null,
      referenceCount: seed.referenceCount ?? external?.referenceCount ?? null,
      references: external?.references?.length
        ? [...external.references]
        : [...seed.references],
    };
  };

  const prepareExternalFocusSeedForRefresh = async (
    seed: CitationGraphNode,
  ): Promise<boolean> => {
    if (seed.itemID > 0) return true;

    let work = externalWorkForFocusSeed(seed);
    let refreshable = synchronizeExternalFocusNode(seed, work);
    if (!refreshable) {
      // External relationship cards can initially contain only a title/year.
      // Resolve one paper summary cooperatively before attempting both
      // relationship directions, then promote the provisional cache subject
      // when a DOI or provider work ID becomes available.
      const hydrated = await hydrateExternalWorksMetadata(
        [work],
        false,
        1,
        true,
        true,
      );
      work = hydrated[0] ?? work;
      refreshable = synchronizeExternalFocusNode(seed, work);
    }

    focusSeedRegistry.set(seed.key, seed);
    if (refreshable) {
      const relationships = focusRelationships.get(seed.key);
      const embedded = seed.externalWork?.references ?? [];
      if (relationships && embedded.length) {
        relationships.references = mergeRelatedWorkLists(
          relationships.references,
          embedded,
        ) as ExternalWork[];
        cacheFocusRelationships(seed.key, relationships);
      }
      scheduleFocusRebuild();
    }
    return refreshable;
  };

  let removeFocusSeed = (_key: string): void => undefined;

  // Assigned once libraryNodeForItem exists (below); a library search row
  // needs the node for a paper so it can be seeded or selected.
  let libraryNodeForSeedRow = (_itemID: number): CitationGraphNode | null =>
    null;
  let libraryState: LibrarySearchState = { status: "idle" };
  /** The library paper behind each listed row, by `libraryPaperID`. */
  const libraryPaperBySeedRowID = new Map<string, ZoteroPaper>();
  /** The seed node behind each listed seed row, by `seedPaperID`. */
  const seedNodeBySeedRowID = new Map<string, CitationGraphNode>();

  const closeFocusSeedPopover = (restoreFocus = false): void => {
    focusSeedPopover.hidden = true;
    keyRail.addSeedAnchor().setAttribute("aria-expanded", "false");
    focusSeedSearch.value = "";
    librarySearchGeneration += 1;
    libraryState = { status: "idle" };
    libraryPaperBySeedRowID.clear();
    clear(focusSeedResults);
    if (restoreFocus) keyRail.addSeedAnchor().focus();
  };

  const seedPopoverPaperForNode = (
    node: CitationGraphNode,
  ): SeedPopoverPaper => ({
    id: seedPaperID(node),
    title: node.title || "Untitled paper",
    authors: node.authors,
    year: node.year,
    sourceTitle: node.sourceTitle,
  });
  const seedPopoverPaperForLibrary = (
    paper: ZoteroPaper,
  ): SeedPopoverPaper => ({
    id: libraryPaperID(paper.itemID),
    title: paper.title || "Untitled item",
    authors: paper.authors,
    year: paper.year,
    sourceTitle: paper.sourceTitle,
  });

  const renderFocusSeedResults = (): void => {
    // Adding or removing a seed re-renders the list; the reader's place in
    // it and the box they are typing in both survive.
    const scrollTop = focusSeedResults.scrollTop;
    clear(focusSeedResults);
    seedNodeBySeedRowID.clear();
    const seeds = focusProjection?.seeds ?? [];
    for (const seed of seeds) seedNodeBySeedRowID.set(seedPaperID(seed), seed);
    const list = seedPopoverList({
      query: focusSeedSearch.value,
      seeds: seeds.map(seedPopoverPaperForNode),
      library: libraryState,
    });
    if (list.kind === "placeholder") {
      focusSeedResults.appendChild(
        text(document, "p", list.message, "cm-placeholder"),
      );
      return;
    }
    for (const { paper, isSeed } of list.rows) {
      const row = element(document, "div", "cm-focus-seed-result");
      row.setAttribute("role", "listitem");
      const select = element(document, "button", "cm-focus-seed-result-main");
      select.type = "button";
      // Selecting must never build a node: only a node the graph already
      // holds can be selected, so a row without one says so and does nothing.
      const existingNode: CitationGraphNode | null =
        seedNodeBySeedRowID.get(paper.id) ??
        model.nodes.find((node) => libraryPaperID(node.itemID) === paper.id) ??
        null;
      select.title = existingNode
        ? `Select ${paper.title} in the graph`
        : "Not in this graph";
      const title = text(
        document,
        "span",
        paper.title,
        "cm-focus-seed-result-title",
      );
      const metadata = [
        paper.authors.slice(0, 2).join(", "),
        paper.year === null ? "" : String(paper.year),
        paper.sourceTitle ?? "",
      ]
        .filter(Boolean)
        .join(" · ");
      select.append(title);
      if (metadata) {
        select.append(
          text(document, "span", metadata, "cm-focus-seed-result-meta"),
        );
      }
      const nodeForRow = (): CitationGraphNode | null => {
        const seed = seedNodeBySeedRowID.get(paper.id);
        if (seed) return seed;
        const libraryPaper = libraryPaperBySeedRowID.get(paper.id);
        return libraryPaper ? libraryNodeForSeedRow(libraryPaper.itemID) : null;
      };
      select.addEventListener("click", () => {
        // selectNode is false when the node is no longer drawn; nothing to do then.
        if (existingNode && renderer?.selectNode(existingNode.key, false)) {
          closeFocusSeedPopover();
        }
      });
      row.appendChild(select);
      const toggle = element(
        document,
        "button",
        isSeed ? "cm-focus-seed-result-remove" : "cm-focus-seed-result-add",
      );
      toggle.type = "button";
      toggle.textContent = isSeed ? "×" : "+";
      toggle.title = isSeed
        ? `Remove ${paper.title} from the seeds`
        : `Add ${paper.title} as a seed`;
      toggle.setAttribute("aria-label", toggle.title);
      toggle.addEventListener("click", (event) => {
        event.stopPropagation();
        const node = nodeForRow();
        if (!node) return;
        if (isSeed) removeFocusSeed(node.key);
        else addFocusSeed(node);
        // The projection change re-rendered the list; the box keeps the query
        // and the focus so the next seed is one keystroke away.
        focusSeedSearch.focus();
      });
      row.appendChild(toggle);
      focusSeedResults.appendChild(row);
    }
    focusSeedResults.scrollTop = scrollTop;
  };

  const updateFocusBar = (): void => {
    // The Seeds heading in the rail carries the count now.
    if (!focusProjection) {
      if (!focusSeedPopover.hidden) renderFocusSeedResults();
      return;
    }
    if (!focusSeedPopover.hidden) renderFocusSeedResults();
    focusDirection.value = focusProjection.state.direction;
    focusLocality.value = focusProjection.state.locality;
  };

  // Anchors a popover to its button's right edge when the start-anchored box
  // would run past the plot pane. The pane, not the window, is what clips:
  // `.cm-plot-pane` is `overflow: hidden`, so a popover is cut at the pane's
  // edge long before it reaches the window's. The width bound is set here for
  // the same reason — CSS can say `100vw`, which is the window, but nothing in
  // the sheet can say "no wider than the pane" from inside a wrapper whose
  // containing block is the toolbar. Measured on every open; the class and the
  // bound are cleared first so a widened pane gets the defaults back. Resizing
  // the pane while a popover is open leaves them stale until the next open,
  // which is acceptable for a menu dismissed by almost any interaction.
  const alignPopover = (wrapper: HTMLElement, popover: HTMLElement): void => {
    popover.classList.remove("cm-popover-end");
    popover.style.maxWidth = "";
    const pane = plotPane.getBoundingClientRect();
    if (pane.width > 0) {
      popover.style.maxWidth = `${Math.max(0, pane.width - 16)}px`;
    }
    const button = wrapper.getBoundingClientRect();
    const anchorEnd = popoverShouldAnchorEnd({
      buttonLeft: button.left,
      buttonRight: button.right,
      popoverWidth: popover.getBoundingClientRect().width,
      containerLeft: pane.left,
      containerRight: pane.right,
    });
    if (anchorEnd) popover.classList.add("cm-popover-end");
  };

  const openFocusSeedPopover = (anchor: HTMLElement): void => {
    const opening = focusSeedPopover.hidden;
    focusSeedPopover.hidden = !opening;
    anchor.setAttribute("aria-expanded", String(opening));
    if (!opening) return;
    // Anchored to the rail's link, positioned over the plot: the pane is what
    // clips, so it is what the flip and the width bound are measured against,
    // exactly as when the anchor was a toolbar button.
    const pane = plotPane.getBoundingClientRect();
    const link = anchor.getBoundingClientRect();
    focusSeedMenu.style.top = `${Math.max(0, link.top - pane.top)}px`;
    renderFocusSeedResults();
    alignPopover(focusSeedMenu, focusSeedPopover);
    document.defaultView?.setTimeout(() => focusSeedSearch.focus(), 0);
  };
  const runLibrarySearch = (): void => {
    const query = focusSeedSearch.value.trim();
    librarySearchGeneration += 1;
    if (!query) {
      libraryState = { status: "idle" };
      libraryPaperBySeedRowID.clear();
      renderFocusSeedResults();
      return;
    }
    const generation = librarySearchGeneration;
    libraryState = { status: "searching" };
    renderFocusSeedResults();
    void rankLibraryPapers(query, generation)
      .then((papers) => {
        if (generation !== librarySearchGeneration || focusSeedPopover.hidden) {
          return;
        }
        libraryPaperBySeedRowID.clear();
        if (papers) {
          for (const paper of papers) {
            libraryPaperBySeedRowID.set(libraryPaperID(paper.itemID), paper);
          }
        }
        libraryState = papers
          ? { status: "done", papers: papers.map(seedPopoverPaperForLibrary) }
          : { status: "failed" };
        renderFocusSeedResults();
      })
      .catch((error: unknown) => {
        Zotero.logError(
          error instanceof Error ? error : new Error(String(error)),
        );
        if (generation !== librarySearchGeneration || focusSeedPopover.hidden)
          return;
        libraryState = { status: "failed" };
        renderFocusSeedResults();
      });
  };
  focusSeedSearch.addEventListener("input", () => {
    // A new keystroke retires any search still in flight, so its late result
    // can never render over what the reader is typing now.
    librarySearchGeneration += 1;
    libraryState = focusSeedSearch.value.trim()
      ? { status: "searching" }
      : { status: "idle" };
    if (librarySearchTimer !== null) {
      if (document.defaultView) {
        document.defaultView.clearTimeout(librarySearchTimer);
      } else {
        clearTimeout(librarySearchTimer);
      }
      librarySearchTimer = null;
    }
    const run = (): void => {
      librarySearchTimer = null;
      runLibrarySearch();
    };
    librarySearchTimer = document.defaultView
      ? document.defaultView.setTimeout(run, LIBRARY_SEARCH_DEBOUNCE_MS)
      : (setTimeout(run, LIBRARY_SEARCH_DEBOUNCE_MS) as unknown as number);
    // Show "Searching library…" (or the seed list again) on the keystroke
    // rather than when the debounce finally fires.
    renderFocusSeedResults();
  });
  // Capture phase and no preventDefault: the pointerdown that closes a
  // popover still reaches whatever it was aimed at.
  const closeFocusSeedPopoverOnOutsidePointer = (event: Event): void => {
    if (focusSeedPopover.hidden) return;
    const target = event.target as Node | null;
    if (target && focusSeedMenu.contains(target)) return;
    if (target && keyRail.addSeedAnchor().contains(target)) return;
    closeFocusSeedPopover();
  };
  const closeFocusSeedPopoverOnEscape = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || focusSeedPopover.hidden) return;
    closeFocusSeedPopover(true);
  };
  document.addEventListener(
    "pointerdown",
    closeFocusSeedPopoverOnOutsidePointer,
    true,
  );
  document.addEventListener("keydown", closeFocusSeedPopoverOnEscape, true);

  /**
   * Seeds hold a palette index for as long as they live, not a position.
   *
   * Read-only (B24): the colours come off the ledger as it would stand with
   * these seeds live, and nothing is written back. The allocating half is
   * `ensureSwatchesFor`, called from the paths that reach
   * `notifyStateChange`; a reader on any other path — the search box's
   * `input` listener through `applyFilters`, a tooltip, an export preview —
   * sees the same colours because allocation is deterministic, and leaves
   * the saved ledger exactly as it found it.
   */
  const seedColorsFor = (
    projection: GraphFocusProjection,
  ): Map<string, string> => {
    const theme = renderer?.getTheme() ?? graphThemeFor("light");
    const keys = projection.state.seedKeys;
    const ledger = seedSwatches.peek(keys, theme.seeds.length);
    return new Map(
      keys.map((key) => [
        key,
        seedColorAt(swatchIndexFor(ledger, key) ?? 0, theme),
      ]),
    );
  };

  /**
   * The allocating half of the two colour readers (B24): make the current
   * regions and seeds the live keys of their ledgers and keep the result.
   * Called only where `notifyStateChange` follows in the same tick, so every
   * allocation — and every release — that lands in a ledger is persisted.
   * Everything else reads through `peek` and mutates nothing.
   */
  const ensureSwatchesFor = (): void => {
    const theme = renderer?.getTheme() ?? graphThemeFor("light");
    swatches.ensure(
      regions.map((id) => String(id)),
      theme.categorical.swatches.length,
    );
    seedSwatches.ensure(
      focusProjection?.state.seedKeys ?? [],
      theme.seeds.length,
    );
  };

  /** Reached papers the library already holds; they wear the thin ring. */
  const inLibraryReachedKeys = (
    projection: GraphFocusProjection,
  ): Set<string> => {
    const local = new Set(
      libraryModel.nodes
        .filter((node) => node.kind !== "external")
        .map((node) => node.key),
    );
    return new Set(
      [...reachedKeysOf(projection)].filter((key) => local.has(key)),
    );
  };

  const applySeedProjection = (
    projection: GraphFocusProjection,
    projectionOptions: { fit?: boolean } = {},
  ): void => {
    setSeeded(true);
    focusProjection = projection;
    // The projection is an addition, not a replacement: the library graph
    // stays, and the seeds' external neighbours are merged into it. Unticking
    // a folder can then never remove a paper a seed brought in, and adding a
    // seed can never remove anything at all.
    const merged = additiveGraphModel(libraryModel, projection);
    model.nodes.splice(0, model.nodes.length, ...merged.nodes);
    model.edges.splice(0, model.edges.length, ...merged.edges);
    model.statistics.nodes = merged.nodes.length;
    model.statistics.edges = merged.edges.length;
    model.statistics.resolvedNodes = merged.nodes.filter(
      (node) => node.citationCount !== null || node.referenceCount !== null,
    ).length;
    model.statistics.isolatedNodes = merged.nodes.filter(
      (node) =>
        !merged.edges.some(
          (edge) => edge.source === node.key || edge.target === node.key,
        ),
    ).length;
    rebuildGraphFilterDescriptors();
    renderer?.syncModel({ draw: false });
    renderer?.setSeedKeys(projection.seedKeys, false);
    ensureSwatchesFor();
    renderer?.setSeedColors(seedColorsFor(projection), false);
    renderer?.setInLibraryReachedKeys(inLibraryReachedKeys(projection), false);
    applyFilters();
    if (projectionOptions.fit) scheduleFocusFit();
    updateFocusBar();
    notifyStateChange();
  };

  const seedsForState = (state: GraphFocusState): CitationGraphNode[] =>
    state.seedKeys
      .map(
        (key) =>
          focusSeedRegistry.get(key) ??
          libraryModel.nodes.find((node) => node.key === key) ??
          model.nodes.find((node) => node.key === key) ??
          null,
      )
      .filter((node): node is CitationGraphNode => Boolean(node))
      .map(resolveFocusSeed);

  const projectionForState = (
    state: GraphFocusState,
  ): GraphFocusProjection | null => {
    const seeds = seedsForState(state);
    for (const seed of seeds) ensureFocusRelationships(seed);
    const normalizedState = {
      ...state,
      seedKeys: seeds.map((seed) => seed.key),
    };
    const cacheKey = focusProjectionCacheKey(
      snapshot.libraryID,
      libraryGraphRevision,
      normalizedState,
    );
    const cached = getCachedFocusProjection(cacheKey);
    if (cached) return cached;
    const projection = buildGraphFocusProjection({
      graph: libraryModel,
      index: libraryGraphIndex,
      state: normalizedState,
      seeds,
      relationships: focusRelationships,
    });
    if (projection) setCachedFocusProjection(cacheKey, projection);
    return projection;
  };

  const rebuildCurrentFocus = (options: { fit?: boolean } = {}): boolean => {
    if (!focusProjection) return false;
    if (!viewActive) {
      inactiveRelationshipDirty = true;
      return true;
    }
    const projection = projectionForState(
      focusStateFromControls(focusProjection.state.seedKeys),
    );
    if (!projection) return false;
    applySeedProjection(projection, options);
    return true;
  };

  const scheduleFocusRebuild = (): void => {
    if (!focusProjection || focusRebuildFrame) return;
    if (!viewActive) {
      inactiveRelationshipDirty = true;
      return;
    }
    const view = document.defaultView;
    const run = (): void => {
      focusRebuildFrame = 0;
      if (!cleaned) rebuildCurrentFocus();
    };
    focusRebuildFrame = view
      ? view.requestAnimationFrame(run)
      : (setTimeout(run, 0) as unknown as number);
  };

  const activateFocusState = (
    state: GraphFocusState,
    options: { fit?: boolean; selectKey?: string } = {},
  ): boolean => {
    const projection = projectionForState(state);
    if (!projection) return false;
    focusDirection.value = projection.state.direction;
    focusLocality.value = projection.state.locality;
    applySeedProjection(projection, { fit: options.fit });
    const selectedKey = options.selectKey ?? projection.seeds[0].key;
    if (visibleKeys.has(selectedKey)) {
      // The seed the projection lands on is the view's own choice, not a
      // click: Zotero's list must not follow it.
      withoutSelectionReport(() => renderer?.selectNode(selectedKey, false));
    }
    return true;
  };

  const updateFocusRefreshState = (): void => {
    focusLoadActive = focusRefreshCount > 0;
    if (!focusProjection) return;
    refreshButton.disabled = focusLoadActive;
    refreshButton.title = focusLoadActive
      ? `Updating connections for ${focusRefreshCount} seed${focusRefreshCount === 1 ? "" : "s"}…`
      : "Refresh references and citing papers for the current Explore seeds.";
    refreshButton.setAttribute("aria-busy", String(focusLoadActive));
  };

  const scheduleFocusTask = (callback: () => void, delay = 0): number =>
    document.defaultView
      ? document.defaultView.setTimeout(callback, delay)
      : (setTimeout(callback, delay) as unknown as number);

  const clearFocusTask = (timer: number): void => {
    if (document.defaultView) document.defaultView.clearTimeout(timer);
    else clearTimeout(timer);
  };

  const resetFocusRefreshTracking = (shutdown = false): void => {
    focusRefreshEpoch += 1;
    for (const timer of focusRefreshTimers.values()) {
      clearFocusTask(timer);
    }
    focusRefreshTimers.clear();
    focusRefreshInFlight.clear();
    focusPostRefreshFitSeeds.clear();
    // Keep one serial queue across focus changes. Replacing the queue while a
    // request is active would allow the old and new seed updates to overlap.
    if (shutdown) focusRefreshQueue.close();
    focusRefreshCount = 0;
    updateFocusRefreshState();
  };

  const refreshFocusSeedConnections = (
    seed: CitationGraphNode,
    forceRefresh: boolean,
    epoch: number,
    mode: "automatic" | "manual",
  ): Promise<void> => {
    const existing = focusRefreshInFlight.get(seed.key);
    if (existing) return existing;

    const directions = (["references", "cited-by"] as const).filter(
      (direction) =>
        forceRefresh || !selectedRelationshipCacheIsFresh(seed, direction),
    );
    if (!directions.length) return Promise.resolve();

    focusRefreshCount += 1;
    updateFocusRefreshState();
    const task = focusRefreshQueue
      .enqueue(async () => {
        if (cleaned || epoch !== focusRefreshEpoch) return;
        if (seed.itemID <= 0) {
          await prepareExternalFocusSeedForRefresh(seed);
          if (cleaned || epoch !== focusRefreshEpoch) return;
        }
        for (const direction of directions) {
          if (cleaned || epoch !== focusRefreshEpoch) return;
          try {
            await refreshExternalRelationships(
              seed,
              libraryModel.nodes,
              direction,
              {
                maximum:
                  mode === "automatic"
                    ? AUTOMATIC_FOCUS_REFRESH.membershipLimit
                    : FOCUS_RELATIONSHIP_CACHE_LIMIT,
                refreshMembership: true,
                // Provider I/O is asynchronous, but the singleton progress popup
                // remains visible while cooperative background processing runs.
                silent: false,
                queueBackgroundHydration: true,
                showBackgroundProgress:
                  mode === "automatic"
                    ? AUTOMATIC_FOCUS_REFRESH.showBackgroundProgress
                    : true,
                mode,
                ...(seed.itemID <= 0
                  ? {
                      providerLimit: 3,
                      providerWorkIDs:
                        seed.provider && seed.providerWorkID
                          ? { [seed.provider]: seed.providerWorkID }
                          : {},
                    }
                  : {}),
                // Focus refreshes need membership and counts first. Optional
                // summaries are hydrated cooperatively after the graph is
                // usable, avoiding a long foreground pause.
                metadataHydrationLimit: 0,
                summaryLookupLimit: 0,
                onMembershipResolved: (resolution) => {
                  if (cleaned || epoch !== focusRefreshEpoch) return;
                  if (resolution.reportedCount !== null) {
                    if (direction === "references") {
                      seed.referenceCount = resolution.reportedCount;
                    } else {
                      seed.citationCount = resolution.reportedCount;
                    }
                  }
                  const relationships = ensureFocusRelationships(seed);
                  const published = getRelationshipViewSnapshot(
                    seedRelationshipGraph(seed),
                    seed,
                    direction,
                    snapshot.libraryID,
                    FOCUS_RELATIONSHIP_CACHE_LIMIT,
                    { queueBackgroundHydration: false },
                  ).works;
                  if (direction === "references") {
                    relationships.references = published;
                  } else {
                    relationships.citedBy = published;
                  }
                  cacheFocusRelationships(seed.key, relationships);
                  scheduleFocusRebuild();
                },
                onMetadataHydrated: () => {
                  if (
                    cleaned ||
                    epoch !== focusRefreshEpoch ||
                    !focusProjection?.seedKeys.has(seed.key)
                  ) {
                    return;
                  }
                  scheduleFocusRebuild();
                },
              },
            );
            if (cleaned || epoch !== focusRefreshEpoch) return;
            const relationships = ensureFocusRelationships(seed);
            const refreshed = getRelationshipViewSnapshot(
              seedRelationshipGraph(seed),
              seed,
              direction,
              snapshot.libraryID,
              FOCUS_RELATIONSHIP_CACHE_LIMIT,
              { queueBackgroundHydration: false },
            ).works;
            if (direction === "references") {
              relationships.references = refreshed;
            } else {
              relationships.citedBy = refreshed;
            }
            cacheFocusRelationships(seed.key, relationships);
          } catch (error) {
            Zotero.logError(
              error instanceof Error ? error : new Error(String(error)),
            );
          }

          // Yield between directions so provider result normalization cannot
          // monopolize Zotero's UI thread.
          await new Promise<void>((resolve) => {
            scheduleFocusTask(resolve, 0);
          });
        }
      })
      .finally(() => {
        if (epoch !== focusRefreshEpoch) return;
        focusRefreshInFlight.delete(seed.key);
        focusRefreshCount = Math.max(0, focusRefreshCount - 1);
        updateFocusRefreshState();
      });
    focusRefreshInFlight.set(seed.key, task);
    return task;
  };

  const loadFocusConnections = (
    seeds: CitationGraphNode[],
    options: {
      forceRefresh?: boolean;
      mode?: "automatic" | "manual";
    } = {},
  ): Promise<void> => {
    const forceRefresh = options.forceRefresh === true;
    const mode = options.mode ?? "automatic";
    const uniqueSeeds = [
      ...new Map(seeds.map((seed) => [seed.key, seed])).values(),
    ];
    if (!uniqueSeeds.length) return Promise.resolve();
    const epoch = focusRefreshEpoch;
    return Promise.all(
      uniqueSeeds.map((seed) =>
        refreshFocusSeedConnections(seed, forceRefresh, epoch, mode),
      ),
    ).then(() => {
      if (cleaned || epoch !== focusRefreshEpoch || !focusProjection) return;
      if (uniqueSeeds.some((seed) => focusProjection?.seedKeys.has(seed.key))) {
        rebuildCurrentFocus();
      }
    });
  };

  const queueAutomaticFocusConnectionUpdate = (
    seed: CitationGraphNode,
    forceRefresh: boolean = AUTOMATIC_FOCUS_REFRESH.forceRefresh,
    fitAfterRefresh = false,
  ): void => {
    if (fitAfterRefresh) focusPostRefreshFitSeeds.add(seed.key);
    const previous = focusRefreshTimers.get(seed.key);
    if (previous !== undefined) {
      clearFocusTask(previous);
    }
    const epoch = focusRefreshEpoch;
    const timer = scheduleFocusTask(() => {
      focusRefreshTimers.delete(seed.key);
      if (
        cleaned ||
        epoch !== focusRefreshEpoch ||
        !focusProjection?.seedKeys.has(seed.key)
      ) {
        focusPostRefreshFitSeeds.delete(seed.key);
        // `restoredCamera` stays armed here; the next fit consumes it.
        return;
      }
      void loadFocusConnections([seed], {
        mode: "automatic",
        forceRefresh,
      }).finally(() => {
        if (cleaned || epoch !== focusRefreshEpoch) return;
        focusPostRefreshFitSeeds.delete(seed.key);
        if (!focusPostRefreshFitSeeds.size && focusProjection) {
          // The initial seed-only fit is useful for immediate feedback, but
          // once all newly introduced seeds have published their relationship
          // membership the complete node cloud must be fitted exactly once.
          rebuildCurrentFocus({ fit: true });
        }
      });
    }, AUTOMATIC_FOCUS_REFRESH.startDelayMs);
    focusRefreshTimers.set(seed.key, timer);
  };

  const enterFocusSeeds = (
    seedCandidates: readonly CitationGraphNode[],
    options: { state?: GraphFocusState } = {},
  ): boolean => {
    const seeds = [
      ...new Map(
        seedCandidates.map((candidate) => {
          const seed = resolveFocusSeed(candidate);
          return [seed.key, seed] as const;
        }),
      ).values(),
    ];
    if (!seeds.length) return false;
    const purged = purgeHiddenKeys(
      hiddenKeys,
      seeds.map((seed) => seed.key),
    );
    hiddenKeys.clear();
    for (const key of purged) hiddenKeys.add(key);
    const enteringFromLibrary = !focusProjection;
    if (!enteringFromLibrary) resetFocusRefreshTracking();
    const state =
      options.state ?? focusStateFromControls(seeds.map((seed) => seed.key));
    const normalizedState = {
      ...state,
      seedKeys: state.seedKeys.length
        ? [...state.seedKeys]
        : seeds.map((seed) => seed.key),
    };
    if (
      !activateFocusState(normalizedState, {
        fit: false,
        selectKey: seeds[0].key,
      })
    ) {
      return false;
    }
    scheduleFocusFit();
    for (const seed of seeds) {
      queueAutomaticFocusConnectionUpdate(seed, false, true);
    }
    return true;
  };

  const addFocusSeeds = (candidates: readonly CitationGraphNode[]): boolean => {
    const seeds = [
      ...new Map(
        candidates.map((candidate) => {
          const seed = resolveFocusSeed(candidate);
          return [seed.key, seed] as const;
        }),
      ).values(),
    ];
    if (!seeds.length) return false;
    if (!focusProjection) return enterFocusSeeds(seeds);

    const missingSeeds = seeds.filter(
      (seed) => !focusProjection?.seedKeys.has(seed.key),
    );
    if (!missingSeeds.length) return true;

    const purged = purgeHiddenKeys(
      hiddenKeys,
      missingSeeds.map((seed) => seed.key),
    );
    hiddenKeys.clear();
    for (const key of purged) hiddenKeys.add(key);

    for (const seed of missingSeeds) ensureFocusRelationships(seed);
    const state = focusStateFromControls([
      ...new Set([
        ...focusProjection.state.seedKeys,
        ...missingSeeds.map((seed) => seed.key),
      ]),
    ]);
    if (
      !activateFocusState(state, {
        fit: true,
        selectKey: missingSeeds[0].key,
      })
    ) {
      return false;
    }
    for (const seed of missingSeeds) {
      queueAutomaticFocusConnectionUpdate(seed, false, true);
    }
    return true;
  };

  const addFocusSeed = (candidate: CitationGraphNode): boolean =>
    addFocusSeeds([candidate]);

  removeFocusSeed = (key: string): void => {
    if (!focusProjection || !focusProjection.seedKeys.has(key)) return;
    const remaining = focusProjection.state.seedKeys.filter(
      (seedKey) => seedKey !== key,
    );
    if (!remaining.length) {
      clearSeeds();
      return;
    }
    activateFocusState(focusStateFromControls(remaining), { fit: true });
  };

  /** A paper the reader does not need. Seeds cannot be hidden. */
  const hideFromGraph = (key: string): void => {
    if (focusProjection?.seedKeys.has(key)) return;
    if (hiddenKeys.has(key)) return;
    hiddenKeys.add(key);
    applyFilters();
    notifyStateChange();
  };

  const replaceLibraryGraph = (
    next: ReturnType<typeof buildCitationGraph>,
  ): void => {
    libraryModel.nodes.splice(0, libraryModel.nodes.length, ...next.nodes);
    libraryModel.edges.splice(0, libraryModel.edges.length, ...next.edges);
    Object.assign(libraryModel.statistics, next.statistics);
    markLibraryGraphChanged(false);
    if (focusProjection) {
      rebuildCurrentFocus();
      return;
    }
    model.nodes.splice(0, model.nodes.length, ...libraryModel.nodes);
    model.edges.splice(0, model.edges.length, ...libraryModel.edges);
    Object.assign(model.statistics, libraryModel.statistics);
    rebuildGraphFilterDescriptors();
    renderer?.syncModel();
    applyFilters();
  };

  const clearSeeds = (): void => {
    resetFocusRefreshTracking();
    focusProjection = null;
    setSeeded(false);
    focusRelationships.clear();
    focusSeedRegistry.clear();
    restoredCamera = null;
    model.nodes.splice(0, model.nodes.length, ...libraryModel.nodes);
    model.edges.splice(0, model.edges.length, ...libraryModel.edges);
    Object.assign(model.statistics, libraryModel.statistics);
    rebuildGraphFilterDescriptors();
    renderer?.syncModel({ draw: false });
    renderer?.setSeedKeys(new Set(), false);
    renderer?.setSeedColors(new Map(), false);
    renderer?.setInLibraryReachedKeys(new Set(), false);
    ensureSwatchesFor();
    updateFocusBar();
    applyFilters();
    notifyStateChange();
  };

  /**
   * The panel's header, which is the one thing outside the body: it survives a
   * `clear(detailBody)`, so every view that clears the body names it again.
   * Zotero's `item-pane-header` carries the title and the creator-year line and
   * nothing else, so the badges stay with the body below.
   */
  const setDetailHeader = (title: string, meta?: string | null): void => {
    clear(detailHeader);
    detailHeader.append(text(document, "h2", title, "cm-detail-title"));
    if (meta) detailHeader.append(text(document, "p", meta, "cm-detail-meta"));
  };

  /**
   * The toolbar's navigation slot, left of the collapse toggle: the tab row on
   * a paper, the way back on the graph-wide similar list, nothing when no
   * paper is selected. Like the header, it survives `clear(detailBody)`, so
   * every view names its own.
   */
  const setDetailNav = (...children: readonly Node[]): void => {
    clear(detailNav);
    detailNav.append(...children);
  };

  function appendPaperHeader(
    node: CitationGraphNode,
    activeMode: "overview" | "cited-by" | "references",
  ): void {
    selectedNode = node;
    setDetailHeader(
      node.title,
      [node.authors.slice(0, 5).join(", "), node.sourceTitle, node.year]
        .filter(Boolean)
        .join(" · "),
    );
    const badges = createBadges(document, node);
    if (badges) detailHeader.appendChild(badges);
    /*
     * The DOI, as a link. It is the paper's address, so it belongs with the
     * paper's name and not behind a button called "Open DOI" — a button that
     * only ever did what clicking the identifier does, while the identifier
     * itself was nowhere on screen to click.
     */
    const doi = node.doi?.trim();
    if (doi) {
      const link = element(document, "a", "cm-detail-doi");
      link.href = `https://doi.org/${encodeURIComponent(doi)}`;
      link.textContent = doi;
      link.title = "Open this paper's DOI in the default browser.";
      link.addEventListener("click", (event) => {
        event.preventDefault();
        Zotero.launchURL(link.href);
      });
      detailHeader.appendChild(link);
    }

    detailTabs = createDetailTabs(document, {
      node,
      libraryID: snapshot.libraryID,
      active: activeMode,
      onSelect: (tab) => {
        if (tab === "overview") renderOverview(node);
        else showRelationList(node, tab);
      },
    });
    setDetailNav(detailTabs.root);
  }

  function applyRelationshipMutationToGraph(
    event: RelationshipMutationEvent,
  ): void {
    const localRelatedKey =
      event.work.inLibraryItemKey ?? event.work.zoteroItemKey ?? null;
    const externalRelatedNode = model.nodes.find(
      (node) =>
        node.kind === "external" &&
        node.externalWork &&
        relationshipWorkKey(node.externalWork as ExternalWork) ===
          relationshipWorkKey(event.work),
    );
    const relatedKey = localRelatedKey ?? externalRelatedNode?.key ?? null;
    let shouldRebuildFocus = false;

    if (focusProjection && !focusLoadActive) {
      for (const seed of focusProjection.seeds) {
        if (seed.itemKey !== event.subjectItemKey) continue;
        const relationships = ensureFocusRelationships(seed);
        const list =
          event.direction === "references"
            ? relationships.references
            : relationships.citedBy;
        const identity = relationshipWorkKey(event.work);
        if (event.ignored) {
          const filtered = list.filter(
            (candidate) => relationshipWorkKey(candidate) !== identity,
          );
          if (event.direction === "references") {
            relationships.references = filtered;
          } else {
            relationships.citedBy = filtered;
          }
        } else if (
          !list.some((candidate) => relationshipWorkKey(candidate) === identity)
        ) {
          list.push(event.work);
        }
        cacheFocusRelationships(seed.key, relationships);
        shouldRebuildFocus = true;
      }
    }

    if (!relatedKey) {
      if (shouldRebuildFocus) scheduleFocusRebuild();
      return;
    }
    const source =
      event.direction === "references" ? event.subjectItemKey : relatedKey;
    const target =
      event.direction === "references" ? relatedKey : event.subjectItemKey;
    const mutate = (edges: typeof model.edges): void => {
      if (event.ignored) {
        for (let index = edges.length - 1; index >= 0; index -= 1) {
          const edge = edges[index];
          if (edge.source === source && edge.target === target) {
            edges.splice(index, 1);
          }
        }
      } else if (
        !edges.some((edge) => edge.source === source && edge.target === target)
      ) {
        edges.push({
          key: `${source}>${target}`,
          source,
          target,
          provenance: event.work.provider,
          manual: false,
        });
      }
    };
    mutate(model.edges);
    if (localRelatedKey) {
      mutate(libraryModel.edges);
      const relation = {
        key: `${source}>${target}`,
        source,
        target,
        provenance: event.work.provider,
        manual: false,
      };
      applyCitationGraphDelta(
        snapshot.libraryID,
        event.ignored
          ? { removedEdges: [{ source, target }] }
          : { addedEdges: [relation] },
      );
      markLibraryGraphChanged(false);
    } else {
      invalidateCitationGraphSnapshot(snapshot.libraryID);
    }
    renderer?.setRelationshipHidden(source, target, event.ignored);
    model.statistics.edges = model.edges.length;
    libraryModel.statistics.edges = libraryModel.edges.length;
    if (shouldRebuildFocus) scheduleFocusRebuild();
    updateSummary();
  }

  const nodesForRelationshipPublication = (
    event: RelationshipPublicationEvent,
  ): CitationGraphNode[] => {
    const byKey = new Map<string, CitationGraphNode>();
    for (const candidate of [
      ...libraryModel.nodes,
      ...model.nodes,
      ...focusSeedRegistry.values(),
    ]) {
      if (candidate.itemKey !== event.subjectItemKey) continue;
      if (candidate.itemID > 0 && event.libraryID !== snapshot.libraryID) {
        continue;
      }
      byKey.set(candidate.key, candidate);
    }
    return [...byKey.values()];
  };

  const applyRelationshipPublicationToNode = (
    node: CitationGraphNode,
    event: RelationshipPublicationEvent,
  ): void => {
    if (event.direction === "references") {
      if (event.reportedCount !== null) {
        node.referenceCount = event.reportedCount;
        node.referenceCountProvider = event.reportedCountProvider;
      }
      node.resolvedReferenceCount = event.identifiedCount;
      if (node.externalWork) {
        if (event.reportedCount !== null) {
          node.externalWork.referenceCount = event.reportedCount;
        }
        node.externalWork.resolvedReferenceCount = event.identifiedCount;
      }
      return;
    }
    if (event.reportedCount !== null) {
      node.citationCount = event.reportedCount;
      node.citationCountProvider = event.reportedCountProvider;
      if (node.externalWork) {
        node.externalWork.citationCount = event.reportedCount;
      }
    }
  };

  const scheduleSelectedPaperRefresh = (
    itemKey: string,
    direction?: "references" | "cited-by",
  ): void => {
    if (relationshipDetailRefreshFrame || cleaned) return;
    const run = (): void => {
      relationshipDetailRefreshFrame = 0;
      if (cleaned || selectedNode?.itemKey !== itemKey) return;
      if (activeRelationshipView) {
        if (
          !direction ||
          (activeRelationshipView.itemKey === itemKey &&
            activeRelationshipView.direction === direction)
        ) {
          refreshActiveRelationshipView?.();
        }
        return;
      }
      const current =
        model.nodes.find((candidate) => candidate.itemKey === itemKey) ??
        libraryModel.nodes.find((candidate) => candidate.itemKey === itemKey) ??
        selectedNode;
      renderOverview(current);
    };
    relationshipDetailRefreshFrame = document.defaultView
      ? document.defaultView.setTimeout(run, 30)
      : (setTimeout(run, 30) as unknown as number);
  };

  const scheduleRelationshipGraphRefresh = (): void => {
    if (relationshipGraphRefreshTimer || cleaned) return;
    const run = (): void => {
      relationshipGraphRefreshTimer = 0;
      if (cleaned || focusProjection) return;
      renderer?.setLayout(renderer.getLayout());
      updateSummary();
    };
    relationshipGraphRefreshTimer = document.defaultView
      ? document.defaultView.setTimeout(run, 30)
      : (setTimeout(run, 30) as unknown as number);
  };

  const applyRelationshipPublication = (
    event: RelationshipPublicationEvent,
  ): void => {
    if (event.phase === "membership-published") {
      invalidateCitationGraphSnapshot(event.libraryID);
    } else if (event.phase === "metadata-published") {
      invalidateFocusRelationshipFragment(
        event.libraryID,
        event.subjectItemKey,
      );
    }
    const affected = nodesForRelationshipPublication(event);
    if (!affected.length) return;
    for (const node of affected) {
      applyRelationshipPublicationToNode(node, event);
    }
    const subject =
      affected.find((node) => model.nodes.includes(node)) ?? affected[0];
    if (!subject) return;

    if (event.phase === "membership-published") {
      if (focusProjection?.seedKeys.has(subject.key)) {
        const relationships = ensureFocusRelationships(subject);
        const published = getRelationshipViewSnapshot(
          seedRelationshipGraph(subject),
          subject,
          event.direction,
          snapshot.libraryID,
          FOCUS_RELATIONSHIP_CACHE_LIMIT,
          { queueBackgroundHydration: false },
        ).works;
        if (event.direction === "references") {
          relationships.references = published;
        } else {
          relationships.citedBy = published;
        }
        cacheFocusRelationships(subject.key, relationships);
        scheduleFocusRebuild();
      } else {
        scheduleRelationshipGraphRefresh();
      }
    }

    // Summary hydration does not change graph membership or topology. A full
    // focus reconstruction for 1,000+ neighbours was one of the largest UI
    // stalls after background retrieval. Refresh only the selected details;
    // graph metadata is picked up by the next ordinary graph rebuild.

    if (selectedNode?.itemKey !== event.subjectItemKey) return;
    detailTabs?.updateCounts(subject);
    if (
      activeRelationshipView?.itemKey === event.subjectItemKey &&
      activeRelationshipView.direction === event.direction
    ) {
      scheduleSelectedPaperRefresh(event.subjectItemKey, event.direction);
      return;
    }
    if (
      activeRelationshipView === null &&
      (event.phase === "membership-published" ||
        event.phase === "metadata-published")
    ) {
      scheduleSelectedPaperRefresh(event.subjectItemKey);
    }
  };

  const focusNodeForWork = (work: ExternalWork): CitationGraphNode => {
    const localKey = work.inLibraryItemKey ?? work.zoteroItemKey ?? null;
    const local = localKey
      ? libraryModel.nodes.find(
          (node) =>
            node.itemKey.toLocaleUpperCase() === localKey.toLocaleUpperCase(),
        )
      : null;
    return local ?? externalWorkToFocusNode(work, "seed");
  };

  let similarSection: ReturnType<typeof createSimilarSection> | null = null;
  let similarRequestGeneration = 0;

  /**
   * The Similar papers block under a paper's Overview. The section is built
   * once per Overview and reused, so a second click on the button reruns the
   * search in place rather than stacking a second list under the first.
   */
  const loadInlineSimilarResults = (
    seedNodes: CitationGraphNode[],
  ): Promise<void> => {
    if (!similarSection?.root.isConnected) {
      similarSection = createSimilarSection(document, graphHost, () =>
        getMissingPaperRecommendations(
          seedNodes,
          model.nodes,
          50,
          seedNodes.length <= 1 ? 1 : 2,
        ),
      );
      detailBody.appendChild(similarSection.root);
    }
    return similarSection.start();
  };

  const showGraphSimilarResults = async (
    seedNodes: CitationGraphNode[],
  ): Promise<void> => {
    const generation = ++similarRequestGeneration;
    similarSection = null;
    activeRelationshipView = null;
    refreshActiveRelationshipView = null;
    activeRelationshipList?.destroy();
    activeRelationshipList = null;
    renderer?.setGhostPreview(null);
    const returnNode = selectedNode;
    clear(detailBody);

    /*
     * The way back is navigation, so it goes where the tab row it replaces
     * went: the toolbar, above a header that names the list the way it names a
     * paper.
     */
    const back = element(document, "button", "cm-secondary-button");
    back.type = "button";
    back.append(
      icon(document, "chevron-left"),
      document.createTextNode(returnNode ? "Back to paper" : "Close"),
    );
    back.title = returnNode
      ? "Return to the previously selected paper"
      : "Close graph-wide similar-paper results";
    back.addEventListener("click", () => renderOverview(returnNode));
    setDetailNav(back);
    detailTabs = null;
    setDetailHeader(
      "Similar papers for current graph",
      `Based on ${formatCount(seedNodes.length)} currently visible graph papers.`,
    );
    const results = element(document, "section", "cm-graph-similar-results");
    results.appendChild(
      text(document, "p", "Finding similar papers…", "cm-placeholder"),
    );
    detailBody.appendChild(results);

    try {
      const works = await getMissingPaperRecommendations(
        seedNodes,
        model.nodes,
        50,
        seedNodes.length <= 1 ? 1 : 2,
      );
      if (
        cleaned ||
        generation !== similarRequestGeneration ||
        !results.isConnected
      ) {
        return;
      }
      clear(results);
      if (!works.length) {
        results.appendChild(
          text(
            document,
            "p",
            "No external works were found.",
            "cm-placeholder",
          ),
        );
        return;
      }
      const list = element(document, "div", "cm-external-list");
      appendRelatedWorkRows(
        document,
        list,
        works.map((work, providerOrder) => ({
          work,
          manualRelation: null,
          ignoredRelation: null,
          providerOrder,
        })),
        graphHost,
      );
      results.appendChild(list);
    } catch (error) {
      if (
        !cleaned &&
        generation === similarRequestGeneration &&
        results.isConnected
      ) {
        clear(results);
        results.appendChild(
          text(
            document,
            "p",
            "Graph-wide similar-paper search failed.",
            "cm-placeholder",
          ),
        );
      }
      throw error;
    }
  };

  function showRelationList(
    node: CitationGraphNode,
    direction: "references" | "cited-by",
  ): void {
    activeRelationshipView = { itemKey: node.itemKey, direction };
    refreshActiveRelationshipView = null;
    renderer?.setGhostPreview(null);
    similarRequestGeneration += 1;
    similarSection = null;
    clear(detailBody);
    appendPaperHeader(node, direction);
    activeRelationshipList?.destroy();
    const list = createRelationshipList(document, {
      host: graphHost,
      node,
      direction,
      readSnapshot: (refreshing) =>
        getRelationshipViewSnapshot(
          model,
          node,
          direction,
          snapshot.libraryID,
          RELATIONSHIP_VIEW_LIMIT,
          refreshing ? { queueBackgroundHydration: false } : undefined,
        ),
      refreshRelationships: async (signal) => {
        await refreshExternalRelationships(node, model.nodes, direction, {
          maximum: RELATIONSHIP_VIEW_LIMIT,
          refreshMembership: true,
          silent: true,
          mode: "manual",
          queueBackgroundHydration: true,
          signal,
          onMembershipResolved: (resolution) => {
            if (resolution.reportedCount === null) return;
            if (direction === "references") {
              node.referenceCount = resolution.reportedCount;
            } else {
              node.citationCount = resolution.reportedCount;
            }
          },
        });
        if (signal.cancelled) return;
        // An update to a seed's relationships changes what the Explore
        // projection is built from, so the cached fragment is replaced and the
        // current view rebuilt before the list redraws.
        if (focusProjection?.seedKeys.has(node.key)) {
          const works = getRelationshipViewSnapshot(
            model,
            node,
            direction,
            snapshot.libraryID,
            RELATIONSHIP_VIEW_LIMIT,
          ).works;
          const relationships = ensureFocusRelationships(node);
          if (direction === "references") {
            relationships.references = works;
          } else {
            relationships.citedBy = works;
          }
          cacheFocusRelationships(node.key, relationships);
          rebuildCurrentFocus();
        }
      },
      onManualChange: (changes) => {
        if (!changes.length) return;
        invalidateCitationGraphSnapshot(snapshot.libraryID);
        invalidateFocusRelationshipFragment(snapshot.libraryID, node.key);
        replaceLibraryGraph(buildCitationGraph(snapshot));
        renderer?.setLayout(renderer.getLayout());
        updateSummary();
        // An open item pane is showing the same relations from the same store.
        notifyManualRelationChange();
      },
      updateCounts: (current) => detailTabs?.updateCounts(current),
    });
    activeRelationshipList = list;
    detailBody.appendChild(list.root);
    refreshActiveRelationshipView = (): void => {
      if (
        cleaned ||
        activeRelationshipView?.itemKey !== node.itemKey ||
        activeRelationshipView.direction !== direction
      ) {
        return;
      }
      list.refresh();
    };
  }

  /**
   * "Add as seed" or "Remove seed" for the paper the detail pane shows. One
   * button in one slot, so the pane reads the same on a library paper and on
   * an external work, seeded graph or not.
   */
  const seedToggleButton = (node: CitationGraphNode): HTMLButtonElement => {
    const isSeed = Boolean(focusProjection?.seedKeys.has(node.key));
    const toggle = element(document, "button", "cm-secondary-button");
    toggle.type = "button";
    toggle.textContent = isSeed ? "Remove seed" : "Add as seed";
    toggle.title = isSeed
      ? "Remove this paper from the seeds of this graph."
      : "Add this paper as a seed of this graph without changing Zotero.";
    toggle.addEventListener("click", () => {
      if (isSeed) {
        removeFocusSeed(node.key);
        // Removing the last seed exits Explore, and that path restores the
        // library selection and re-renders the pane itself a frame later.
        if (focusProjection) renderOverview(node);
        return;
      }
      if (addFocusSeed(node)) renderOverview(node);
    });
    return toggle;
  };

  function renderOverview(node: CitationGraphNode | null): void {
    activeRelationshipView = null;
    refreshActiveRelationshipView = null;
    activeRelationshipList?.destroy();
    activeRelationshipList = null;
    renderer?.setGhostPreview(null);
    similarRequestGeneration += 1;
    similarSection = null;
    clear(detailBody);
    if (!node) {
      selectedNode = null;
      setDetailNav();
      detailTabs = null;
      setDetailHeader("Paper details");
      detailBody.append(
        detailSection(
          document,
          text(
            document,
            "p",
            "Select a paper to inspect its metrics, references and citing works.",
            "cm-placeholder",
          ),
        ),
      );
      return;
    }

    appendPaperHeader(node, "overview");
    detailBody.appendChild(createOverviewMetrics(document, node));

    if (node.kind === "external" && node.externalWork) {
      const work = node.externalWork as ExternalWork;
      const actions = element(document, "div", "cm-detail-actions");
      actions.style.flexWrap = "wrap";

      const localKey = work.inLibraryItemKey ?? work.zoteroItemKey ?? null;
      const localItem = localKey
        ? ((Zotero.Items as any).getByLibraryAndKey?.(
            snapshot.libraryID,
            localKey,
          ) as Zotero.Item | null)
        : null;
      if (localItem) {
        const show = element(document, "button", "cm-secondary-button");
        show.type = "button";
        show.textContent = "Show in Zotero";
        show.addEventListener("click", () => void selectPaper(localItem.id));
        actions.appendChild(show);
      } else {
        const importArea = createImportArea(
          document,
          work,
          graphHost,
          (imported) => {
            if (node.externalWork) {
              node.externalWork.inLibraryItemKey = String(imported.key);
            }
            const show = button(
              document,
              "Show in Zotero",
              "cm-secondary-button",
            );
            show.addEventListener("click", () => void selectPaper(imported.id));
            actions.prepend(show);
          },
        );
        actions.appendChild(importArea.addButton);
        detailBody.appendChild(importArea.root);
      }

      const sourceURL = externalWorkURL(work);
      if (sourceURL) {
        const open = element(document, "button", "cm-secondary-button");
        open.type = "button";
        open.textContent = work.doi ? "Open DOI" : "Open provider record";
        open.addEventListener("click", () => Zotero.launchURL(sourceURL));
        actions.appendChild(open);
      }

      const similar = element(document, "button", "cm-primary-button");
      similar.type = "button";
      similar.textContent = "Similar";
      similar.addEventListener("click", () => {
        void loadInlineSimilarResults([node]).catch((error: unknown) => {
          Zotero.logError(
            error instanceof Error ? error : new Error(String(error)),
          );
        });
      });
      actions.appendChild(similar);
      actions.appendChild(seedToggleButton(node));

      const update = element(document, "button", "cm-secondary-button");
      update.type = "button";
      update.textContent = "Update connections";
      update.addEventListener("click", () => {
        if (update.disabled) return;
        update.disabled = true;
        void (async () => {
          for (const direction of ["references", "cited-by"] as const) {
            await refreshExternalRelationships(
              node,
              libraryModel.nodes,
              direction,
              {
                maximum: RELATIONSHIP_VIEW_LIMIT,
                refreshMembership: true,
                silent: true,
                mode: "manual",
                queueBackgroundHydration: true,
                onMembershipResolved: (resolution) => {
                  if (resolution.reportedCount === null) return;
                  if (direction === "references") {
                    node.referenceCount = resolution.reportedCount;
                  } else {
                    node.citationCount = resolution.reportedCount;
                  }
                },
              },
            );
            await new Promise<void>((resolve) => {
              scheduleFocusTask(resolve, 0);
            });
          }
        })()
          .then(() => {
            const relationships = ensureFocusRelationships(node);
            relationships.references = getRelationshipViewSnapshot(
              seedRelationshipGraph(node),
              node,
              "references",
              snapshot.libraryID,
              RELATIONSHIP_VIEW_LIMIT,
            ).works;
            relationships.citedBy = getRelationshipViewSnapshot(
              seedRelationshipGraph(node),
              node,
              "cited-by",
              snapshot.libraryID,
              RELATIONSHIP_VIEW_LIMIT,
            ).works;
            cacheFocusRelationships(node.key, relationships);
            if (focusProjection?.seedKeys.has(node.key)) rebuildCurrentFocus();
            if (!cleaned) renderOverview(node);
          })
          .catch((error: unknown) => {
            Zotero.logError(
              error instanceof Error ? error : new Error(String(error)),
            );
          })
          .finally(() => {
            if (update.isConnected) update.disabled = false;
          });
      });
      actions.appendChild(update);
      detailBody.appendChild(detailSection(document, actions));
    } else {
      /*
       * One button. "Show in Zotero" repeated what a double-click on the
       * circle already does; "Open DOI" repeated the DOI in the header, which
       * is now a link; "Open in ›" was a menu of one entry that swapped the
       * whole view out from under the reader, which is not what a button in a
       * detail panel should do; and "Refresh" repeated the toolbar's, which
       * covers this paper along with every other visible one. What is left is
       * the action that fetches something the reader cannot reach by
       * clicking what is already on screen, and the seed toggle, which is
       * one of the three ways to add a seed.
       */
      const actions = element(document, "div", "cm-detail-actions");
      const similar = element(document, "button", "cm-primary-button");
      similar.type = "button";
      similar.append(
        icon(document, "similar"),
        document.createTextNode("Find similar papers"),
      );
      similar.title =
        "Find papers similar to this one using scholarly-data providers. Results are shown for review and are not added to Zotero automatically.";
      similar.addEventListener("click", () => {
        if (similar.disabled) return;
        similar.disabled = true;
        void Promise.resolve(loadInlineSimilarResults([node]))
          .catch((error: unknown) => {
            Zotero.logError(
              error instanceof Error ? error : new Error(String(error)),
            );
          })
          .finally(() => {
            if (similar.isConnected) similar.disabled = false;
          });
      });
      actions.appendChild(similar);
      actions.appendChild(seedToggleButton(node));
      detailBody.appendChild(detailSection(document, actions));
    }
  }

  const closeNodeMenu = (restoreFocus = false): void => {
    if (nodeMenu.hidden) return;
    nodeMenu.hidden = true;
    nodeMenuTarget = null;
    nodeMenuOpenEntry = null;
    if (restoreFocus) canvas.focus();
  };
  const showOpenEntry = (entry: OpenPaperEntry | null): void => {
    nodeMenuOpenEntry = entry;
    nodeMenuOpen.hidden = entry === null;
    nodeMenuOpen.textContent = entry?.label ?? "";
  };
  /**
   * Zotero caches the best-attachment state per item for its own list; the
   * menu reads that cache so it can open with the right label at once and,
   * when the cache is cold, asks for the state and relabels while it is still
   * open on the same node.
   */
  const applyOpenEntry = (node: CitationGraphNode): void => {
    const item =
      node.kind === "external"
        ? null
        : (Zotero.Items.get(node.itemID) as Zotero.Item | false) || null;
    const cached = item?.getBestAttachmentStateCached?.() ?? null;
    const attachment: BestAttachmentType =
      cached && "exists" in cached
        ? cached.exists
          ? cached.type
          : "none"
        : null;
    const itemURL = item?.getField?.("url") ?? null;
    showOpenEntry(openPaperEntry(node, attachment, itemURL));
    if (!item || attachment !== null) return;
    void item
      .getBestAttachmentState()
      .then(
        (state: {
          type: Exclude<BestAttachmentType, null>;
          exists: boolean;
        }) => {
          if (nodeMenuTarget !== node || nodeMenu.hidden) return;
          showOpenEntry(
            openPaperEntry(node, state.exists ? state.type : "none", itemURL),
          );
        },
      )
      .catch(() => undefined);
  };
  const nodeMenuItems = (): HTMLButtonElement[] =>
    [nodeMenuOpen, nodeMenuSeed, nodeMenuRemove].filter((item) => !item.hidden);
  const openNodeMenu = (
    node: CitationGraphNode,
    clientX: number,
    clientY: number,
  ): void => {
    closeFocusSeedPopover();
    nodeMenuTarget = node;
    const isSeed = Boolean(focusProjection?.seedKeys.has(node.key));
    nodeMenuSeed.textContent = isSeed ? "Remove seed" : "Add as seed";
    nodeMenuRemove.hidden = isSeed;
    applyOpenEntry(node);
    nodeMenu.hidden = false;
    // Measured after it is shown, so offsetWidth is the laid-out width.
    const pane = graphArea.getBoundingClientRect();
    const { left, top } = clampMenuPosition({
      x: clientX - pane.left,
      y: clientY - pane.top,
      menuWidth: nodeMenu.offsetWidth,
      menuHeight: nodeMenu.offsetHeight,
      paneWidth: pane.width,
      paneHeight: pane.height,
    });
    nodeMenu.style.left = `${left}px`;
    nodeMenu.style.top = `${top}px`;
    nodeMenuItems()[0]?.focus();
  };
  nodeMenuOpen.addEventListener("click", () => {
    const entry = nodeMenuOpenEntry;
    closeNodeMenu(true);
    if (!entry) return;
    if (entry.target.kind === "url") {
      Zotero.launchURL(entry.target.url);
      return;
    }
    void Promise.resolve(options.onOpenAttachment?.(entry.target.itemID)).catch(
      (error: unknown) => {
        Zotero.logError(
          error instanceof Error ? error : new Error(String(error)),
        );
      },
    );
  });
  nodeMenuSeed.addEventListener("click", () => {
    const node = nodeMenuTarget;
    closeNodeMenu(true);
    if (!node) return;
    if (focusProjection?.seedKeys.has(node.key)) removeFocusSeed(node.key);
    else addFocusSeed(node);
  });
  nodeMenuRemove.addEventListener("click", () => {
    const node = nodeMenuTarget;
    closeNodeMenu(true);
    if (node) hideFromGraph(node.key);
  });
  nodeMenu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeNodeMenu(true);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = nodeMenuItems();
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    items[(index + step + items.length) % items.length]?.focus();
  });
  const closeNodeMenuOnOutsidePointer = (event: Event): void => {
    if (nodeMenu.hidden) return;
    const target = event.target as Node | null;
    if (target && nodeMenu.contains(target)) return;
    closeNodeMenu();
  };
  const closeNodeMenuOnWheel = (): void => closeNodeMenu();
  const closeNodeMenuOnResize = (): void => closeNodeMenu();
  document.addEventListener("pointerdown", closeNodeMenuOnOutsidePointer, true);
  canvas.addEventListener("wheel", closeNodeMenuOnWheel, { passive: true });
  document.defaultView?.addEventListener("resize", closeNodeMenuOnResize);

  const handleGraphSelection = (node: CitationGraphNode | null): void => {
    closeNodeMenu();
    renderOverview(node);
    if (suppressSelectionReport) return;
    if (libraryEmphasisKeys) {
      libraryEmphasisKeys = null;
      applyEmphasis();
    }
    options.onGraphSelection?.(
      node && node.kind !== "external" ? node.itemID : null,
    );
  };

  renderer = new CitationGraphRenderer({
    canvas,
    model,
    layout: currentLayout,
    collectionLabels,
    onSelectionChange: handleGraphSelection,
    onOpenNode: (node) => {
      if (node.kind === "external" && node.externalWork) {
        const url = externalWorkURL(node.externalWork as ExternalWork);
        if (url) Zotero.launchURL(url);
        return;
      }
      void selectPaper(node.itemID);
    },
    onBackgroundInteraction: appearance.close,
    onNodeContextMenu: openNodeMenu,
  });
  const scopeSeedRows = (): ScopeSeedRow[] => {
    const colors = focusProjection
      ? seedColorsFor(focusProjection)
      : new Map<string, string>();
    return (focusProjection?.state.seedKeys ?? []).map((key) => {
      const node =
        focusSeedRegistry.get(key) ??
        model.nodes.find((candidate) => candidate.key === key) ??
        null;
      return {
        key,
        label: node
          ? seedRowLabel({
              authors: node.authors,
              year: node.year,
              title: node.title,
            })
          : "Unknown paper",
        color:
          colors.get(key) ??
          seedColorAt(0, renderer?.getTheme() ?? graphThemeFor("light")),
      };
    });
  };

  /**
   * The regions handed to the renderer: each region's folder colour, from
   * the swatch ledger, and its papers currently on the plot. Colour follows
   * the folder's key through the ledger, so ticking or unticking one folder
   * can never repaint another's swatch (backlog B12).
   *
   * Read-only (B24): the colour comes off the ledger as it would stand with
   * these regions live, and nothing is written back. `refreshScopeRail`
   * calls this on every `applyFilters`, which the search box's `input`
   * listener runs without `notifyStateChange` following; the allocating
   * half is `ensureSwatchesFor`, on the paths that do persist. Allocation is
   * deterministic, so a colour read here is the colour the ensure lands on.
   */
  regionsForRenderer = (): Array<{
    collectionID: number;
    color: string;
    nodeKeys: ReadonlySet<string>;
  }> => {
    const theme = renderer?.getTheme() ?? graphThemeFor("light");
    const ledger = swatches.peek(
      regions.map((id) => String(id)),
      theme.categorical.swatches.length,
    );
    return regions.map((collectionID) => ({
      collectionID,
      color:
        theme.categorical.swatches[
          swatchIndexFor(ledger, String(collectionID)) ?? 0
        ],
      nodeKeys: new Set(
        model.nodes
          .filter(
            (node) =>
              visibleKeys.has(node.key) &&
              node.collectionIDs.includes(collectionID),
          )
          .map((node) => node.key),
      ),
    }));
  };

  refreshScopeRail = (): void => {
    if (!lastScope) return;
    const drawnRegions = regionsForRenderer();
    renderer?.setRegions(drawnRegions);
    keyRail.renderScope(
      buildScopeRailModel({
        collections: snapshot.collections,
        ticks: collectionTicks,
        includeUnfiled,
        includeExternal,
        seeds: scopeSeedRows(),
        scope: lastScope,
        regions,
        regionColors: new Map(
          drawnRegions.map((region) => [region.collectionID, region.color]),
        ),
      }),
    );
  };

  refreshKeyRail = (): void => {
    const active = renderer;
    if (!active) return;
    keyRail.render(
      buildKeyModel({
        layout: active.getLayout(),
        assignment: active.getCategoryAssignment(),
        // What the filter admits — not the whole library. A graph opened on a
        // folder is the library with a filter over it, so handing the Key every
        // node made it name folders whose papers are nowhere on screen.
        nodes: active.getScopeNodes(),
        // The ramp and the radii are still derived from the whole model, so
        // filtering moves nothing; the Key reads its ranges from the same set
        // the canvas did, or it would print a scale the plot is not using.
        scaleNodes: model.nodes,
        theme: active.getTheme(),
        edgeCount: active.getVisibleEdgeCount(),
        states: {
          selectedKey: selectedNode?.key ?? null,
          seedKeys: focusProjection
            ? new Set(focusProjection.state.seedKeys)
            : new Set<string>(),
          searchMatches: searchMatchKeys,
          visibleKeys:
            visibleKeys.size === model.nodes.length ? null : visibleKeys,
        },
      }),
    );
    refreshScopeRail();
  };
  renderOverview(null);
  refreshSourceMetricsForLayout(currentLayout);

  const onGraphAreaPointerDown = (event: PointerEvent): void => {
    const target = event.target as Element | null;
    // A click on the canvas is the spec's background click: it releases a pin.
    // Only the canvas: the overlays above it are graph controls, and those must
    // not discard the currently selected paper. Closing the appearance panel
    // was this handler's other job and is the document closer's now — the panel
    // moved into the rail's footer, which is not inside the graph area.
    if (target === canvas) keyRail.release();
  };
  graphArea.addEventListener("pointerdown", onGraphAreaPointerDown, true);

  applyFilters = (): void => {
    const tokens = normalizeSearch(search.value).split(/\s+/).filter(Boolean);
    const scope = computeGraphScope({
      papers: model.nodes.map((node): ScopePaper => ({
        key: node.key,
        collectionIDs: node.collectionIDs,
        inLibrary: node.kind !== "external",
      })),
      seedKeys: focusProjection?.seedKeys ?? new Set<string>(),
      reachedKeys: focusProjection
        ? reachedKeysOf(focusProjection)
        : new Set<string>(),
      ticks: collectionTicks,
      includeUnfiled,
      includeExternal,
      hiddenKeys,
      // Tags, item type, year and the data-quality switches. Not the search
      // box: it narrows what is drawn without moving a count the rail prints.
      facetAdmits: (key) => {
        const descriptor = graphFilterDescriptors.get(key);
        return descriptor ? graphFilter.matches(descriptor) : false;
      },
    });
    lastScope = scope;
    // Two sets, not one. `scopeKeys` is what the graph is a graph *of* — the
    // Key and the colour assignment are built from it. `visibleKeys` narrows
    // it by the search box, which is a transient lens and must not reshuffle
    // the swatches under the reader as they type.
    scopeKeys = scope.visibleKeys;
    const matchesSearch = (node: CitationGraphNode): boolean => {
      if (!tokens.length) return true;
      const searchable = graphNodeSearchText(node);
      return tokens.every((token) => searchable.includes(token));
    };
    visibleKeys = new Set(
      model.nodes
        .filter((node) => scopeKeys.has(node.key) && matchesSearch(node))
        .map((node) => node.key),
    );
    renderer?.setScopeKeys(scopeKeys);
    renderer?.setVisibleKeys(visibleKeys, false);
    if (libraryEmphasisKeys) {
      const kept = new Set(
        [...libraryEmphasisKeys].filter((key) => visibleKeys.has(key)),
      );
      libraryEmphasisKeys = kept.size ? kept : null;
      applyEmphasis();
    }
    const matches = tokens.length ? new Set(visibleKeys) : null;
    searchMatchKeys = matches;
    renderer?.setSearchMatches(matches);
    updateSummary();
    refreshKeyRail();
  };
  search.addEventListener("input", applyFilters);
  for (const control of [focusDirection, focusLocality]) {
    control.addEventListener("change", () => {
      if (!focusProjection) return;
      scheduleFocusRebuild();
      notifyStateChange();
    });
  }
  similarButton.addEventListener("click", () => {
    if (similarButton.disabled) return;
    const visibleNodes = model.nodes.filter((node) =>
      visibleKeys.has(node.key),
    );
    if (!visibleNodes.length) return;
    similarButton.disabled = true;
    void showGraphSimilarResults(visibleNodes)
      .catch((error: unknown) => {
        Zotero.logError(
          error instanceof Error ? error : new Error(String(error)),
        );
      })
      .finally(() => {
        if (similarButton.isConnected) similarButton.disabled = false;
      });
  });
  const closeExportMenu = (): void => {
    exportMenu.hidden = true;
    exportButton.setAttribute("aria-expanded", "false");
  };
  exportButton.addEventListener("click", () => {
    closeGraphMenu();
    exportMenu.hidden = !exportMenu.hidden;
    exportButton.setAttribute("aria-expanded", String(!exportMenu.hidden));
  });
  const closeExportMenuOnOutsidePointer = (event: Event): void => {
    if (exportMenu.hidden) return;
    const target = event.target as Node | null;
    if (target && exportWrap.contains(target)) return;
    closeExportMenu();
  };
  const closeExportMenuOnEscape = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || exportMenu.hidden) return;
    closeExportMenu();
    exportButton.focus();
  };
  document.addEventListener(
    "pointerdown",
    closeExportMenuOnOutsidePointer,
    true,
  );
  document.addEventListener("keydown", closeExportMenuOnEscape, true);
  exportMenu.addEventListener("click", (event) => {
    const target = (event.target as Element).closest(
      "button",
    ) as HTMLButtonElement | null;
    if (!target || !renderer) return;
    closeExportMenu();
    let task: Promise<void> | null = null;
    if (target.dataset.format === "png") {
      task = exportGraphPNG(document, renderer.getCanvas(), snapshot);
    } else if (target.dataset.format === "json") {
      task = exportGraphJSON(document, snapshot, model, visibleKeys);
    } else if (target.dataset.format === "csv") {
      task = exportGraphCSV(document, snapshot, model, visibleKeys);
    }
    void task?.catch((error: unknown) => {
      Zotero.logError(
        error instanceof Error ? error : new Error(String(error)),
      );
    });
  });
  let statusTimer = 0;
  const setStatus = (message: string | null): void => {
    if (cleaned) return;
    const view = document.defaultView;
    if (statusTimer) {
      if (view) view.clearTimeout(statusTimer);
      else clearTimeout(statusTimer);
      statusTimer = 0;
    }
    toolbarStatus.textContent = message ?? "";
    toolbarStatus.hidden = !message;
    if (!message) return;
    const hide = (): void => {
      statusTimer = 0;
      toolbarStatus.hidden = true;
      toolbarStatus.textContent = "";
    };
    statusTimer = view
      ? view.setTimeout(hide, 2500)
      : (setTimeout(hide, 2500) as unknown as number);
  };

  const formatSavedDate = (iso: string): string => {
    const time = Date.parse(iso);
    return Number.isFinite(time)
      ? new Date(time).toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : "";
  };
  const setGraphMenuMessage = (message: string): void => {
    graphMenuList.replaceChildren(
      text(document, "p", message, "cm-graph-menu-empty"),
    );
  };
  let graphMenuListGeneration = 0;
  const rebuildGraphMenuList = async (): Promise<void> => {
    const host = options.savedGraphs;
    if (!host) return;
    const generation = ++graphMenuListGeneration;
    let entries: SavedGraphMenuEntry[];
    try {
      entries = await host.list();
    } catch (error) {
      Zotero.logError(
        error instanceof Error ? error : new Error(String(error)),
      );
      if (generation === graphMenuListGeneration) {
        setGraphMenuMessage("Saved graphs could not be listed.");
      }
      return;
    }
    if (generation !== graphMenuListGeneration || cleaned) return;
    if (!entries.length) {
      setGraphMenuMessage("No saved graphs yet.");
      return;
    }
    graphMenuList.replaceChildren(
      ...entries.map((entry) => {
        const row = element(document, "div", "cm-graph-menu-row");
        const openButton = element(document, "button");
        openButton.type = "button";
        openButton.dataset.action = "open";
        openButton.dataset.id = String(entry.id);
        openButton.append(
          text(document, "span", entry.name, "cm-graph-menu-name"),
          text(
            document,
            "span",
            formatSavedDate(entry.modified),
            "cm-graph-menu-date",
          ),
        );
        const deleteButton = element(
          document,
          "button",
          "cm-graph-menu-delete",
        );
        deleteButton.type = "button";
        deleteButton.dataset.action = "delete";
        deleteButton.dataset.id = String(entry.id);
        deleteButton.textContent = "×";
        deleteButton.setAttribute("aria-label", `Delete ${entry.name}`);
        deleteButton.title = `Delete ${entry.name}`;
        row.append(openButton, deleteButton);
        return row;
      }),
    );
  };
  const closeGraphMenu = (): void => {
    graphMenu.hidden = true;
    graphButton.setAttribute("aria-expanded", "false");
  };
  const openGraphMenu = (): void => {
    closeExportMenu();
    graphMenu.hidden = false;
    graphButton.setAttribute("aria-expanded", "true");
    setGraphMenuMessage("Loading…");
    void rebuildGraphMenuList();
  };
  graphButton.addEventListener("click", () => {
    if (graphButton.disabled) return;
    if (graphMenu.hidden) openGraphMenu();
    else closeGraphMenu();
  });
  const closeGraphMenuOnOutsidePointer = (event: Event): void => {
    if (graphMenu.hidden) return;
    const target = event.target as Node | null;
    if (target && graphWrap.contains(target)) return;
    closeGraphMenu();
  };
  const closeGraphMenuOnEscape = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || graphMenu.hidden) return;
    closeGraphMenu();
    graphButton.focus();
  };
  document.addEventListener(
    "pointerdown",
    closeGraphMenuOnOutsidePointer,
    true,
  );
  document.addEventListener("keydown", closeGraphMenuOnEscape, true);
  let graphMenuBusy = false;
  graphMenu.addEventListener("click", (event) => {
    const host = options.savedGraphs;
    const target = (event.target as Element).closest(
      "button",
    ) as HTMLButtonElement | null;
    if (!host || !target || graphMenuBusy) return;
    const action = target.dataset.action;
    const id = Number(target.dataset.id);
    const run = async (): Promise<void> => {
      if (action === "save" || action === "save-as") {
        closeGraphMenu();
        const name = await (action === "save" ? host.save() : host.saveAs());
        if (cleaned) return;
        if (name) setStatus("Saved");
        return;
      }
      if (action === "open" && Number.isInteger(id)) {
        const result = await host.open(id);
        if (cleaned) return;
        if (result === "opened") {
          closeGraphMenu();
          return;
        }
        setGraphMenuMessage("This graph was deleted.");
        // Let the message be read before the list replaces it.
        const view = document.defaultView;
        await new Promise<void>((resolve) =>
          view ? view.setTimeout(resolve, 1200) : setTimeout(resolve, 1200),
        );
        if (cleaned) return;
        if (!graphMenu.hidden) await rebuildGraphMenuList();
        return;
      }
      if (action === "delete" && Number.isInteger(id)) {
        const removed = await host.remove(id);
        if (cleaned) return;
        if (removed) await rebuildGraphMenuList();
      }
    };
    graphMenuBusy = true;
    void run()
      .catch((error: unknown) => {
        Zotero.logError(
          error instanceof Error ? error : new Error(String(error)),
        );
        if (cleaned) return;
        const message =
          action === "delete"
            ? "Could not delete"
            : action === "open"
              ? "Could not open"
              : "Save failed";
        setStatus(message);
      })
      .finally(() => {
        graphMenuBusy = false;
      });
  });
  newGraphButton.addEventListener("click", () => {
    closeGraphMenu();
    void Promise.resolve(options.savedGraphs?.newGraph?.()).catch(
      (error: unknown) => {
        Zotero.logError(
          error instanceof Error ? error : new Error(String(error)),
        );
      },
    );
  });
  refreshButton.addEventListener("click", () => {
    if (refreshButton.disabled) return;
    if (focusProjection) {
      void loadFocusConnections(focusProjection.seeds, {
        forceRefresh: true,
        mode: "manual",
      }).catch((error: unknown) => {
        Zotero.logError(
          error instanceof Error ? error : new Error(String(error)),
        );
      });
      return;
    }
    const visibleNodes = model.nodes.filter((node) =>
      visibleKeys.has(node.key),
    );
    const items = visibleNodes
      .filter((node) => node.kind !== "external" && node.itemID > 0)
      .map((node) => Zotero.Items.get(node.itemID) as Zotero.Item | null)
      .filter((item): item is Zotero.Item => Boolean(item));
    const externalNodes = visibleNodes.filter(
      (node) => node.kind === "external" && Boolean(node.externalWork),
    );
    if (!items.length && !externalNodes.length) return;

    refreshButton.disabled = true;
    const externalProgress = externalNodes.length
      ? createUpdateProgress({
          document,
          title: "Refreshing visible external papers",
          message: `Resolving metadata and citation counts for ${externalNodes.length} paper${externalNodes.length === 1 ? "" : "s"}…`,
          total: externalNodes.length,
        })
      : null;
    const localTask = items.length
      ? updateCitationDataForItems(items, {
          force: false,
          progressDocument: document,
        })
      : Promise.resolve(null);
    const externalTask = externalNodes.length
      ? hydrateExternalWorksMetadata(
          externalNodes.map((node) => node.externalWork as ExternalWork),
          true,
          Number.POSITIVE_INFINITY,
          false,
          true,
        )
      : Promise.resolve([] as ExternalWork[]);

    void Promise.all([localTask, externalTask])
      .then(([, hydratedExternalWorks]) => {
        if (cleaned) return;
        hydratedExternalWorks.forEach((work, index) => {
          const node = externalNodes[index];
          if (!node) return;
          synchronizeExternalFocusNode(node, work);
          if (node.externalWork) Object.assign(node.externalWork, work);
        });
        externalProgress?.finish(
          `Refreshed ${hydratedExternalWorks.length} external paper${hydratedExternalWorks.length === 1 ? "" : "s"}.`,
        );
        replaceLibraryGraph(buildCitationGraph(snapshot));
        renderer?.setLayout(currentLayout);
        rebuildGraphFilterDescriptors();
        applyFilters();
        updateSummary();
        if (selectedNode) {
          const current =
            model.nodes.find(
              (candidate) => candidate.key === selectedNode?.key,
            ) ?? selectedNode;
          renderOverview(current);
        }
      })
      .catch((error: unknown) => {
        externalProgress?.fail("External-paper refresh failed.");
        Zotero.logError(
          error instanceof Error ? error : new Error(String(error)),
        );
      })
      .finally(() => {
        if (refreshButton.isConnected) refreshButton.disabled = false;
      });
  });
  zoom.addEventListener("click", (event) => {
    const target = (event.target as Element).closest(
      "button",
    ) as HTMLButtonElement | null;
    if (target?.dataset.action === "in") renderer?.zoomBy(1.22);
    if (target?.dataset.action === "out") renderer?.zoomBy(1 / 1.22);
    if (target?.dataset.action === "fit") fitCurrentGraph();
  });

  /**
   * The chevron points the way the pane will move: out to the right edge while
   * it is open, back in from it once it is closed.
   */
  function syncDetailToggle(): void {
    const isCollapsed = detailShell.dataset.collapsed === "true";
    const label = isCollapsed ? "Show paper details" : "Hide paper details";
    detailToggle.title = label;
    detailToggle.setAttribute("aria-label", label);
    detailToggle.setAttribute("aria-expanded", String(!isCollapsed));
    detailToggle.replaceChildren(
      createIcon(
        document,
        isCollapsed ? "chevron-left" : "chevron-right",
        PANE_TOGGLE_ICON_SIZE,
      ),
    );
  }

  function setDetailCollapsed(next: boolean): void {
    applyDetailState({ width: itemPane.read().width, collapsed: next });
    itemPane.setCollapsed(next);
    syncDetailToggle();
  }

  const detachDetailResizer = attachPaneResizer({
    handle: resizer,
    edge: "end",
    minimum: PANE_MINIMUM.item,
    maximum: () =>
      Math.max(PANE_MINIMUM.item, root.getBoundingClientRect().width * 0.7),
    collapseThreshold: 60,
    origin: () => root.getBoundingClientRect().right,
    onBegin: () => itemPane.beginLocalChange(),
    onMove: (width) => {
      applyDetailState({ width, collapsed: false });
      itemPane.write(width);
    },
    onRelease: (release) => {
      if (release.kind === "collapse") setDetailCollapsed(true);
      else itemPane.write(release.width);
    },
    onEnd: () => {
      itemPane.endLocalChange();
      syncDetailToggle();
    },
    onToggle: () =>
      setDetailCollapsed(detailShell.dataset.collapsed !== "true"),
  });
  detailToggle.addEventListener("click", () => {
    setDetailCollapsed(detailShell.dataset.collapsed !== "true");
  });

  const detachRailResizer = attachPaneResizer({
    handle: keyRail.resizer,
    edge: "start",
    minimum: PANE_MINIMUM.collections,
    maximum: () =>
      Math.max(
        PANE_MINIMUM.collections,
        root.getBoundingClientRect().width * 0.5,
      ),
    collapseThreshold: 60,
    origin: () => keyRail.root.getBoundingClientRect().left,
    onBegin: () => collectionsPane.beginLocalChange(),
    onMove: (width) => {
      keyRail.setWidth(width);
      collectionsPane.write(width);
    },
    onRelease: (release) => {
      if (release.kind === "collapse") {
        keyRail.setCollapsed(true);
        collectionsPane.setCollapsed(true);
      } else {
        collectionsPane.write(release.width);
      }
    },
    onEnd: () => collectionsPane.endLocalChange(),
    onToggle: () => {
      const next = !keyRail.isCollapsed();
      keyRail.setCollapsed(next);
      collectionsPane.setCollapsed(next);
    },
  });
  syncDetailToggle();

  const unsubscribeRelationshipMutations = subscribeRelationshipMutations(
    (event) => {
      if (
        cleaned ||
        event.origin === "graph" ||
        event.libraryID !== snapshot.libraryID
      ) {
        return;
      }
      if (!viewActive) {
        inactiveRelationshipDirty = true;
        return;
      }
      applyRelationshipMutationToGraph(event);
      if (
        activeRelationshipView?.itemKey === event.subjectItemKey &&
        activeRelationshipView.direction === event.direction
      ) {
        document.defaultView?.setTimeout(() => {
          if (!cleaned) refreshActiveRelationshipView?.();
        }, 0);
      }
    },
  );
  const unsubscribeRelationshipPublications = subscribeRelationshipPublications(
    (event) => {
      if (cleaned) return;
      if (!viewActive) {
        inactiveRelationshipDirty = true;
        return;
      }
      applyRelationshipPublication(event);
    },
  );

  const libraryNodeForItem = (itemID: number): CitationGraphNode | null => {
    let node = libraryModel.nodes.find(
      (candidate) => candidate.itemID === itemID,
    );
    if (node) return node;
    const item = Zotero.Items.get(itemID) as Zotero.Item | null;
    if (
      !item ||
      Number(item.libraryID) !== snapshot.libraryID ||
      !item.isRegularItem?.()
    ) {
      return null;
    }
    node = createMetricNodeForItem(item);
    libraryModel.nodes.push(node);
    markLibraryGraphChanged();
    return node;
  };

  libraryNodeForSeedRow = libraryNodeForItem;

  const reconcileInactiveView = (): void => {
    if (!inactiveRelationshipDirty || cleaned) return;
    inactiveRelationshipDirty = false;
    if (focusProjection) {
      for (const seed of focusProjection.seeds) {
        const relationships = ensureFocusRelationships(seed);
        relationships.references = getRelationshipViewSnapshot(
          seedRelationshipGraph(seed),
          seed,
          "references",
          snapshot.libraryID,
          FOCUS_RELATIONSHIP_CACHE_LIMIT,
          { queueBackgroundHydration: false },
        ).works;
        relationships.citedBy = getRelationshipViewSnapshot(
          seedRelationshipGraph(seed),
          seed,
          "cited-by",
          snapshot.libraryID,
          FOCUS_RELATIONSHIP_CACHE_LIMIT,
          { queueBackgroundHydration: false },
        ).works;
        cacheFocusRelationships(seed.key, relationships);
      }
      rebuildCurrentFocus();
    } else {
      replaceLibraryGraph(buildCitationGraph(snapshot));
      renderer?.setLayout(currentLayout);
      applyFilters();
      updateSummary();
    }
    if (selectedNode) {
      const current =
        model.nodes.find((node) => node.key === selectedNode?.key) ??
        selectedNode;
      renderOverview(current);
    }
  };

  const addFocusItems = (itemIDs: readonly number[]): GraphFocusResult => {
    const nodes = normalizedScopeItemIDs(itemIDs)
      .map((itemID) => libraryNodeForItem(itemID))
      .filter((node): node is CitationGraphNode => Boolean(node));
    return nodes.length && addFocusSeeds(nodes) ? "selected" : "not-found";
  };

  const getState = (): GraphViewState => {
    const seeds = focusProjection
      ? focusProjection.state.seedKeys
          .map((key) => focusSeedRegistry.get(key) ?? null)
          .filter((node): node is CitationGraphNode => node !== null)
          .map(seedFromNode)
          .filter((seed): seed is NonNullable<typeof seed> => seed !== null)
      : [];
    const filters = graphFilter.state();
    // The graph's folders live in the ticks now. The field stays on the type
    // because the detail pane's relationship lists still filter by folder
    // through the same controller.
    filters.collectionIDs = [];
    return {
      ...emptyGraphViewState(),
      seeds,
      explore: {
        direction: focusDirection.value as GraphFocusDirection,
        locality: focusLocality.value as GraphFocusLocality,
      },
      filters,
      collections: collectionTicks,
      includeUnfiled,
      includeExternal,
      hiddenKeys: [...hiddenKeys],
      regions: [...regions],
      swatches: swatches.state(),
      seedSwatches: seedSwatches.state(),
      camera: renderer?.getViewTransform() ?? null,
      title: options.title ?? null,
    };
  };

  let stateChangeTimer = 0;
  /**
   * The host hears about a state change once per turn, not once per edit.
   * The coalescing is a timer and not an animation frame on purpose: a
   * recipe is not a paint, and Gecko runs no frame callback while the
   * window is occluded. On a frame the state a restore or an import settles
   * on could sit unreported for as long as nothing repainted, and the saved
   * graph would keep the state before it.
   */
  notifyStateChange = (): void => {
    if (!options.onStateChange || stateChangeTimer || cleaned) return;
    const view = document.defaultView;
    const run = (): void => {
      stateChangeTimer = 0;
      if (!cleaned) options.onStateChange?.(getState());
    };
    stateChangeTimer = view
      ? view.setTimeout(run, 0)
      : (setTimeout(run, 0) as unknown as number);
  };

  const applyState = (state: GraphViewState): GraphFocusResult =>
    // Opening a saved graph, or restoring a tab, selects a seed of its own
    // accord; Zotero's list must not follow that.
    withoutSelectionReport(() => {
      focusDirection.value = state.explore.direction;
      focusLocality.value = state.explore.locality;
      if (focusProjection) clearSeeds();
      graphFilter.setState({ ...state.filters, collectionIDs: [] });
      // A version 1 recipe named the folders it was scoped to and drew each
      // one's whole subtree, so its ticks are expanded once here — and only
      // here. Ticks the rail wrote are already closed under the cascade, and
      // expanding them would resurrect a child unticked under a ticked parent.
      collectionTicks = state.ticksNeedDescendants
        ? expandTicksThroughDescendants(state.collections, descendantsByID)
        : state.collections;
      includeUnfiled = state.includeUnfiled;
      includeExternal = state.includeExternal;
      hiddenKeys.clear();
      for (const key of state.hiddenKeys) hiddenKeys.add(key);
      regions = [...state.regions];
      swatches.restore(state.swatches);
      seedSwatches.restore(state.seedSwatches);
      applyFilters();
      const nodeForItemKey = (itemKey: string): CitationGraphNode | null => {
        const paper = paperByKey.get(itemKey);
        return paper ? libraryNodeForItem(paper.itemID) : null;
      };
      const { nodes } = resolveGraphViewSeeds(state.seeds, {
        nodeForItemKey,
        nodeForDOI: (doi) =>
          libraryModel.nodes.find((node) => normalizeDOI(node.doi) === doi) ??
          null,
      });
      if (nodes.length) {
        restoredCamera = state.camera;
        if (!addFocusSeeds(nodes)) {
          restoredCamera = null;
          return "not-found";
        }
        return "selected";
      }
      if (state.seeds.length) {
        // That camera framed a projection that no longer resolves; pointing the
        // library graph at it would land on nothing.
        return "not-found";
      }
      if (state.camera) {
        const camera = state.camera;
        scheduleCameraAction(() => renderer?.setViewTransform(camera));
      }
      return "selected";
    });

  /**
   * An external seed became a library item. Its registry node learns the
   * key, so the state carries it from now on. When the library already lists
   * the item, which is the case for a view rebuilt after the import, the
   * state is resolved again and the seed turns local at once; otherwise the
   * host's refresh does it with the next snapshot.
   */
  markExternalSeedImported = (identityKey, itemKey): void => {
    let touched = false;
    for (const node of focusSeedRegistry.values()) {
      const work = node.externalWork;
      if (!work || node.itemID > 0) continue;
      if (stableExternalWorkIdentity(work) !== identityKey) continue;
      work.inLibraryItemKey = itemKey;
      touched = true;
    }
    if (!touched) return;
    if (paperByKey.has(itemKey)) applyState(getState());
    else notifyStateChange();
  };

  applyFilters();

  const controller: GraphViewController = {
    markExternalSeedImported,
    applyLibrarySelection(itemIDs, options) {
      if (!renderer) return;
      const active = renderer;
      let resolution: LibrarySelectionResolution | undefined;
      try {
        // Only what the graph already renders: `libraryNodeForItem` would
        // create nodes and invalidate the shared snapshot, and this runs on
        // every list selection.
        const keyByItemID = new Map<number, string>();
        for (const node of model.nodes) {
          if (node.kind === "external") continue;
          if (!Number.isInteger(node.itemID) || node.itemID <= 0) continue;
          if (!keyByItemID.has(node.itemID)) {
            keyByItemID.set(node.itemID, node.key);
          }
        }
        resolution = resolveLibrarySelection(
          itemIDs,
          (itemID) => keyByItemID.get(itemID) ?? null,
          visibleKeys,
        );
      } catch (error) {
        Zotero.debug(
          `Meristema: resolving the library selection failed: ${String(error)}`,
        );
        return;
      }
      // A fresh view adopts the list's selection; it must not undo the
      // selection the render itself just restored. Under the additive model
      // the graph holds the whole library, so "nothing matches" is no longer
      // the test for that: a list row the reader never chose resolves to a
      // node that is genuinely on the plot, and adopting it would throw away
      // the seed a saved graph just opened on. The view's own selection wins;
      // an emphasis from the list still applies, since it is not a selection.
      const keepsOwnSelection =
        Boolean(options?.adopt) && active.getSelectedKey() !== null;
      if (
        options?.adopt &&
        !keepsOwnSelection &&
        !resolution.select &&
        !resolution.emphasise
      ) {
        return;
      }
      if (keepsOwnSelection && !resolution.emphasise && !libraryEmphasisKeys) {
        return;
      }
      // Nothing to do: the same node is selected and no emphasis moves.
      if (
        resolution.select === active.getSelectedKey() &&
        !resolution.emphasise &&
        !libraryEmphasisKeys
      ) {
        return;
      }
      const applied = resolution;
      withoutSelectionReport(() => {
        if (keepsOwnSelection) {
          // Its selection stands; only the emphasis below moves.
        } else if (applied.select) {
          active.selectNode(applied.select, false);
          active.panToNodeIfOffscreen(applied.select);
        } else {
          active.clearSelection();
        }
        libraryEmphasisKeys = applied.emphasise;
        applyEmphasis();
      });
    },
    addFocusItems,
    openCollections(collectionIDs: readonly number[]) {
      const known = collectionIDs.filter((collectionID: number) =>
        snapshot.collections.some(
          (entry) => entry.collectionID === collectionID,
        ),
      );
      // Every requested folder must exist. Silently graphing the subset that
      // happens to resolve would show a scope the user did not ask for.
      if (!known.length || known.length !== collectionIDs.length) {
        return "not-found";
      }
      if (focusProjection) clearSeeds();
      collectionTicks = onlyCollectionsTicked([
        ...collectionScopeIDs(known, snapshot.collections),
      ]);
      applyFilters();
      scheduleCameraAction(() => renderer?.fitVisibleNodes());
      return "selected";
    },
    getState,
    applyState,
    setStatus,
    setActive(active) {
      viewActive = active;
      if (!active) {
        appearance.close();
        return;
      }
      renderer?.resizeViewport();
      reconcileInactiveView();
    },
  };
  controllerByMount.set(mount, controller);

  // Everything the host asked this view to open selects nodes of its own
  // accord: none of it is a click, so Zotero's list must not follow it.
  withoutSelectionReport(() => {
    if (options.initialFocusItemIDs?.length) {
      controller.addFocusItems(options.initialFocusItemIDs);
    } else if (options.initialCollectionIDs?.length) {
      controller.openCollections(options.initialCollectionIDs);
    }
    if (options.initialState) {
      const request = Boolean(
        options.initialFocusItemIDs?.length ||
        options.initialCollectionIDs?.length,
      );
      if (request) {
        // The request already shaped the graph; the state fills in what the
        // request does not name, and a request never names filters.
        focusDirection.value = options.initialState.explore.direction;
        focusLocality.value = options.initialState.explore.locality;
        // The graph's folders live in the ticks the request already set; the
        // filter controller no longer scopes the graph by folder.
        graphFilter.setState({
          ...options.initialState.filters,
          collectionIDs: [],
        });
        if (focusProjection) scheduleFocusRebuild();
      } else {
        applyState(options.initialState);
      }
    }
  });
  updateSummary();
  const localCitationWarmupItemIDs = [
    ...(options.initialFocusItemIDs ?? []),
  ].filter((itemID, index, values) => values.indexOf(itemID) === index);
  const runLocalCitationWarmup = (): void => {
    if (!localCitationWarmupItemIDs.length) return;
    void warmLocalCitationRelations(snapshot, localCitationWarmupItemIDs)
      .then((changed) => {
        if (!changed || cleaned) return;
        invalidateCitationGraphSnapshot(snapshot.libraryID);
        if (!viewActive) {
          inactiveRelationshipDirty = true;
          return;
        }
        replaceLibraryGraph(buildCitationGraph(snapshot));
        renderer?.setLayout(currentLayout);
        updateSummary();
      })
      .catch((error: unknown) => {
        Zotero.debug(
          `Meristema: background local-relation extraction failed: ${String(error)}`,
        );
      });
  };
  let localCitationWarmupTimer = localCitationWarmupItemIDs.length
    ? document.defaultView
      ? document.defaultView.setTimeout(
          runLocalCitationWarmup,
          LOCAL_CITATION_WARMUP_DELAY_MS,
        )
      : (setTimeout(
          runLocalCitationWarmup,
          LOCAL_CITATION_WARMUP_DELAY_MS,
        ) as unknown as number)
    : 0;
  const cleanup = (): void => {
    cleaned = true;
    document.removeEventListener(
      "pointerdown",
      closeGraphMenuOnOutsidePointer,
      true,
    );
    document.removeEventListener("keydown", closeGraphMenuOnEscape, true);
    if (statusTimer) {
      const view = document.defaultView;
      if (view) view.clearTimeout(statusTimer);
      else clearTimeout(statusTimer);
      statusTimer = 0;
    }
    graphMenuListGeneration += 1;
    if (stateChangeTimer) {
      const view = document.defaultView;
      if (view) view.clearTimeout(stateChangeTimer);
      else clearTimeout(stateChangeTimer);
      stateChangeTimer = 0;
    }
    disposeThemeObserver();
    activeRelationshipList?.destroy();
    activeRelationshipList = null;
    refreshActiveRelationshipView = null;
    if (localCitationWarmupTimer) {
      if (document.defaultView) {
        document.defaultView.clearTimeout(localCitationWarmupTimer);
      } else {
        clearTimeout(localCitationWarmupTimer);
      }
      localCitationWarmupTimer = 0;
    }
    if (librarySearchTimer !== null) {
      if (document.defaultView) {
        document.defaultView.clearTimeout(librarySearchTimer);
      } else {
        clearTimeout(librarySearchTimer);
      }
      librarySearchTimer = null;
    }
    resetFocusRefreshTracking(true);
    cancelCameraFrame();
    if (focusRebuildFrame) {
      document.defaultView?.cancelAnimationFrame(focusRebuildFrame);
      clearTimeout(focusRebuildFrame);
      focusRebuildFrame = 0;
    }
    if (relationshipDetailRefreshFrame) {
      document.defaultView?.clearTimeout(relationshipDetailRefreshFrame);
      clearTimeout(relationshipDetailRefreshFrame);
      relationshipDetailRefreshFrame = 0;
    }
    if (relationshipGraphRefreshTimer) {
      document.defaultView?.clearTimeout(relationshipGraphRefreshTimer);
      clearTimeout(relationshipGraphRefreshTimer);
      relationshipGraphRefreshTimer = 0;
    }
    controllerByMount.delete(mount);
    unsubscribeRelationshipMutations();
    unsubscribeRelationshipPublications();
    graphFilter.destroy();
    document.removeEventListener(
      "pointerdown",
      closeAppearanceOnOutsidePointer,
      true,
    );
    document.removeEventListener("keydown", closeAppearanceOnEscape, true);
    document.removeEventListener(
      "pointerdown",
      closeExportMenuOnOutsidePointer,
      true,
    );
    document.removeEventListener("keydown", closeExportMenuOnEscape, true);
    document.removeEventListener(
      "pointerdown",
      closeFocusSeedPopoverOnOutsidePointer,
      true,
    );
    document.removeEventListener(
      "keydown",
      closeFocusSeedPopoverOnEscape,
      true,
    );
    graphArea.removeEventListener("pointerdown", onGraphAreaPointerDown, true);
    document.removeEventListener(
      "pointerdown",
      closeNodeMenuOnOutsidePointer,
      true,
    );
    canvas.removeEventListener("wheel", closeNodeMenuOnWheel);
    document.defaultView?.removeEventListener("resize", closeNodeMenuOnResize);
    detachRailResizer();
    detachDetailResizer();
    unsubscribeCollectionsPane();
    unsubscribeItemPane();
    collectionsPane.dispose();
    itemPane.dispose();
    keyRail.destroy();
    renderer?.destroy();
    renderer = null;
  };
  cleanupByMount.set(mount, cleanup);
  return root;
}
