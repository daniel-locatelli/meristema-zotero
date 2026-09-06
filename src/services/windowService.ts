import { config } from "../../package.json";
import type { LibrarySnapshot } from "../domain/types";
import { positiveInteger } from "../domain/valueNormalization";
import { paneSelectedLibraryID } from "./paneLibrary";
import {
  destroyGraphView,
  getGraphViewController,
  renderGraphView,
} from "./graphViewService";
import { loadWholeLibrary } from "./zoteroLibraryService";
import {
  installDataSourceHoverTooltips,
  uninstallDataSourceHoverTooltips,
} from "./dataSourceTooltipService";
import {
  GRAPH_VIEW_BASE_TITLE,
  graphInstanceShouldRender,
  isGraphTabDescriptor,
  isLegacyDefaultTitle,
  multiCollectionGraphTitle,
  nextGraphViewTitle,
  selectReusableGraphInstance,
} from "./graphInstancePolicy";
import { getAvailableCitationLibraries } from "./citationLibraryService";

const TAB_TYPE = config.addonRef;
const TAB_STATE_FILTER_MARKER = "__meristemaStateFilterInstalled";
const TAB_HOOK_MARKER = "__meristemaTabHooksInstalled";
const NETWORK_ICON_TYPE = "meristema-network";
const CONTEXT_HANDLER_MARKER = "__meristemaContextHandlerInstalled";
const LIBRARY_FILTER_MARKER = "meristemaLibraryFilterInstalled";
const DETACHED_WINDOW_URL = `chrome://${config.addonRef}/content/graphWindow.xhtml`;
interface GraphInstanceState {
  instanceID: string;
  title: string;
  customTitle: boolean;
  tabID: string | null;
  libraryID: number | null;
  pendingSelectionItemIDs: number[];
  pendingSelectionMode: "replace" | "add";
  pendingFocusItemIDs: number[];
  pendingCollectionIDs: number[];
  mapScopeItemIDs: number[] | null;
  mapPinnedItemIDs: number[];
  detachedWindow: Window | null;
  detachedMount: HTMLElement | null;
  lastActivatedAt: number;
  dirty: boolean;
  renderGeneration: number;
}

interface GraphWindowState {
  instances: Map<string, GraphInstanceState>;
}

let graphInstanceSequence = 0;
let openViewRefreshGeneration = 0;
const graphStateByWindow = new Map<_ZoteroTypes.MainWindow, GraphWindowState>();

function graphState(win: _ZoteroTypes.MainWindow): GraphWindowState {
  const existing = graphStateByWindow.get(win);
  if (existing) return existing;
  const created: GraphWindowState = {
    instances: new Map(),
  };
  graphStateByWindow.set(win, created);
  return created;
}

function createGraphInstance(
  win: _ZoteroTypes.MainWindow,
  libraryID: number | null = null,
  titleBase?: string,
): GraphInstanceState {
  graphInstanceSequence += 1;
  const instanceID = `meristema-${Date.now().toString(36)}-${graphInstanceSequence.toString(36)}`;
  const state = graphState(win);
  const created: GraphInstanceState = {
    instanceID,
    title: nextGraphViewTitle(
      [...state.instances.values()].map((instance) => instance.title),
      titleBase,
    ),
    customTitle: false,
    tabID: null,
    libraryID,
    pendingSelectionItemIDs: [],
    pendingSelectionMode: "replace",
    pendingFocusItemIDs: [],
    pendingCollectionIDs: [],
    mapScopeItemIDs: null,
    mapPinnedItemIDs: [],
    detachedWindow: null,
    detachedMount: null,
    lastActivatedAt: Date.now(),
    dirty: false,
    renderGeneration: 0,
  };
  state.instances.set(instanceID, created);
  return created;
}

interface PendingGraphRequest {
  selectionItemIDs: number[];
  selectionMode: "replace" | "add";
  focusItemIDs: number[];
  collectionIDs: number[];
}

function consumePendingRequest(state: GraphInstanceState): PendingGraphRequest {
  const request = {
    selectionItemIDs: [...state.pendingSelectionItemIDs],
    selectionMode: state.pendingSelectionMode,
    focusItemIDs: [...state.pendingFocusItemIDs],
    collectionIDs: [...state.pendingCollectionIDs],
  };
  state.pendingSelectionItemIDs = [];
  state.pendingSelectionMode = "replace";
  state.pendingFocusItemIDs = [];
  state.pendingCollectionIDs = [];
  return request;
}

function firstRequestedItemID(request: PendingGraphRequest): number | null {
  return request.selectionItemIDs[0] ?? request.focusItemIDs[0] ?? null;
}

function defaultMainWindow(): _ZoteroTypes.MainWindow {
  const windows = Zotero.getMainWindows().filter(
    (candidate: any) => candidate?.ZoteroPane && !candidate.closed,
  );
  const activePane = Zotero.getActiveZoteroPane?.();
  const activeWindow = activePane
    ? windows.find((candidate: any) => candidate.ZoteroPane === activePane)
    : null;
  const win = activeWindow ?? windows[0];
  if (!win) throw new Error("No Zotero main window is available.");
  return win;
}

function tabs(win: _ZoteroTypes.MainWindow): any {
  const value = (win as any).Zotero_Tabs;
  if (!value) throw new Error("Zotero tabs are unavailable.");
  return value;
}

function liveHostWindow(
  preferred?: _ZoteroTypes.MainWindow | null,
): _ZoteroTypes.MainWindow {
  if (preferred && !(preferred as any).closed) return preferred;
  return defaultMainWindow();
}

function selectedLibraryID(win: _ZoteroTypes.MainWindow): number {
  const panes = [Zotero.getActiveZoteroPane?.(), win.ZoteroPane].filter(
    (pane, index, values) => pane && values.indexOf(pane) === index,
  );
  for (const pane of panes as any[]) {
    const direct = paneSelectedLibraryID(pane);
    if (direct) return direct;
    const selectedItems = pane.getSelectedItems?.() ?? [];
    const fromItem = positiveInteger(selectedItems[0]?.libraryID);
    if (fromItem) return fromItem;
  }
  return Zotero.Libraries.userLibraryID;
}

function requestedLibraryID(
  win: _ZoteroTypes.MainWindow,
  libraryID?: number | null,
): number {
  return positiveInteger(libraryID) ?? selectedLibraryID(win);
}

function graphFilterMenu(document: Document): HTMLElement | null {
  const menus = document.querySelectorAll('div[role="menu"]');
  for (let menuIndex = 0; menuIndex < menus.length; menuIndex += 1) {
    const menu = menus.item(menuIndex) as HTMLElement | null;
    if (!menu || menu.style.display === "none") continue;
    const options = menu.querySelectorAll("option");
    let hasCollectionFilter = false;
    for (let optionIndex = 0; optionIndex < options.length; optionIndex += 1) {
      const option = options.item(optionIndex) as HTMLOptionElement | null;
      if (option?.textContent === "Whole library") {
        hasCollectionFilter = true;
        break;
      }
    }
    if (hasCollectionFilter) return menu;
  }
  return null;
}

function injectGraphLibraryFilter(
  document: Document,
  currentLibraryID: number,
  onSelectLibrary: (libraryID: number) => Promise<void>,
): void {
  const menu = graphFilterMenu(document);
  if (!menu || menu.querySelector('[data-meristema-library-filter="true"]')) {
    return;
  }

  const wrapper = document.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "label",
  );
  wrapper.dataset.meristemaLibraryFilter = "true";
  Object.assign(wrapper.style, {
    display: "grid",
    gridTemplateColumns: "105px minmax(0, 1fr)",
    gap: "8px",
    alignItems: "center",
    padding: "3px 3px 7px",
    marginBottom: "2px",
    borderBottom: "1px solid color-mix(in srgb, CanvasText 14%, transparent)",
  });

  const label = document.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "span",
  );
  label.textContent = "Library";
  label.style.fontSize = "11px";

  const select = document.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "select",
  ) as HTMLSelectElement;
  select.dataset.meristemaFilterSelect = "true";
  select.setAttribute("aria-label", "Graph library");
  for (const library of getAvailableCitationLibraries(currentLibraryID)) {
    const option = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "option",
    ) as HTMLOptionElement;
    option.value = String(library.libraryID);
    option.textContent = library.name;
    select.appendChild(option);
  }
  select.value = String(currentLibraryID);
  select.addEventListener("change", () => {
    const libraryID = positiveInteger(select.value);
    if (!libraryID || libraryID === currentLibraryID) return;
    select.disabled = true;
    void onSelectLibrary(libraryID).catch((error) => {
      select.disabled = false;
      select.value = String(currentLibraryID);
      reportAsyncError("Meristema: library selection failed", error);
    });
  });

  wrapper.append(label, select);
  menu.prepend(wrapper);
}

function installGraphLibraryFilter(
  document: Document,
  mount: Element,
  currentLibraryID: number,
  onSelectLibrary: (libraryID: number) => Promise<void>,
): void {
  const buttons = mount.querySelectorAll(".cm-command-actions button");
  let button: HTMLButtonElement | null = null;
  for (let index = 0; index < buttons.length; index += 1) {
    const candidate = buttons.item(index) as HTMLButtonElement | null;
    if (!candidate) continue;
    const label = String(
      candidate.getAttribute("aria-label") ?? candidate.title,
    );
    if (label.startsWith("Filter papers")) {
      button = candidate;
      break;
    }
  }
  if (!button || button.dataset[LIBRARY_FILTER_MARKER] === "true") return;
  button.dataset[LIBRARY_FILTER_MARKER] = "true";
  const inject = (): void =>
    injectGraphLibraryFilter(document, currentLibraryID, onSelectLibrary);
  button.addEventListener("click", inject);
  if (button.getAttribute("aria-expanded") === "true") inject();
}

function reportAsyncError(context: string, error: unknown): void {
  const detail =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : error === undefined
        ? "Promise rejected with undefined."
        : String(error);
  const wrapped = new Error(`${context}: ${detail}`);
  if (error instanceof Error && error.stack) {
    wrapped.stack = `${wrapped.stack}\nCaused by: ${error.stack}`;
  }
  Zotero.logError(wrapped);
}

async function waitForWindowLoad(win: Window): Promise<void> {
  if (win.document.readyState === "complete") return;
  await new Promise<void>((resolve) => {
    win.addEventListener("load", () => resolve(), { once: true });
  });
}

async function selectPaper(
  win: _ZoteroTypes.MainWindow,
  itemID: number,
): Promise<void> {
  const host = liveHostWindow(win);
  tabs(host).select("zotero-pane");
  await host.ZoteroPane.selectItem(itemID);
  host.focus();
}

function renderDetachedWindow(
  hostWindow: _ZoteroTypes.MainWindow,
  instance: GraphInstanceState,
  snapshot: LibrarySnapshot,
  request: PendingGraphRequest = {
    selectionItemIDs: [],
    selectionMode: "replace",
    focusItemIDs: [],
    collectionIDs: [],
  },
): void {
  const popup = instance.detachedWindow;
  const mount = instance.detachedMount;
  if (!popup || popup.closed || !mount) return;
  instance.libraryID = snapshot.libraryID;
  instance.lastActivatedAt = Date.now();
  instance.dirty = false;
  const host = liveHostWindow(hostWindow);
  renderGraphView(popup.document, mount, snapshot, {
    mode: "window",
    onSelectPaper: (itemID) => {
      void selectPaper(host, itemID).catch((error) =>
        reportAsyncError("Meristema: paper selection failed", error),
      );
    },
    initialItemIDs: request.selectionItemIDs,
    initialItemMode: request.selectionMode,
    initialMapScopeItemIDs: instance.mapScopeItemIDs,
    initialMapPinnedItemIDs: instance.mapPinnedItemIDs,
    onMapScopeChange: (scopeItemIDs, pinnedItemIDs) => {
      instance.mapScopeItemIDs = scopeItemIDs ? [...scopeItemIDs] : null;
      instance.mapPinnedItemIDs = [...pinnedItemIDs];
    },
    initialFocusItemIDs: request.focusItemIDs,
    initialCollectionIDs: request.collectionIDs,
  });
  installGraphLibraryFilter(
    popup.document,
    mount,
    snapshot.libraryID,
    (libraryID) =>
      openGraphWindow(host, libraryID, {
        targetInstanceID: instance.instanceID,
      }),
  );
}

async function openDetachedGraphWindow(
  hostWindow: _ZoteroTypes.MainWindow,
  instance: GraphInstanceState,
  snapshot: LibrarySnapshot,
  request: PendingGraphRequest = {
    selectionItemIDs: [],
    selectionMode: "replace",
    focusItemIDs: [],
    collectionIDs: [],
  },
): Promise<void> {
  if (
    instance.detachedWindow &&
    !instance.detachedWindow.closed &&
    instance.detachedMount
  ) {
    renderDetachedWindow(hostWindow, instance, snapshot, request);
    instance.detachedWindow.focus();
    instance.lastActivatedAt = Date.now();
    return;
  }

  const popup = (hostWindow as any).openDialog?.(
    DETACHED_WINDOW_URL,
    instance.instanceID,
    "chrome,dialog=no,resizable,centerscreen,width=1200,height=820",
  ) as Window | null;
  if (!popup) throw new Error("Unable to open the Meristema window.");

  await waitForWindowLoad(popup);
  const mount = popup.document.getElementById(
    "meristema-window-root",
  ) as HTMLElement | null;
  if (!mount) {
    popup.close();
    throw new Error("Meristema window mount point is unavailable.");
  }

  instance.detachedWindow = popup;
  instance.detachedMount = mount;
  instance.libraryID = snapshot.libraryID;
  instance.lastActivatedAt = Date.now();
  installDataSourceHoverTooltips(popup.document);
  popup.document.title = instance.title;
  popup.addEventListener("focus", () => {
    instance.lastActivatedAt = Date.now();
  });
  popup.addEventListener(
    "unload",
    () => {
      if (instance.detachedWindow !== popup) return;
      destroyGraphView(mount);
      uninstallDataSourceHoverTooltips(popup.document);
      instance.detachedWindow = null;
      instance.detachedMount = null;
      if (!instance.tabID) {
        graphStateByWindow
          .get(hostWindow)
          ?.instances.delete(instance.instanceID);
      }
    },
    { once: true },
  );
  renderDetachedWindow(hostWindow, instance, snapshot, request);
  popup.focus();
}

function tabLibraryID(
  tab: any,
  win: _ZoteroTypes.MainWindow,
  instance?: GraphInstanceState | null,
): number {
  return (
    instance?.libraryID ??
    positiveInteger(tab?.data?.libraryID) ??
    selectedLibraryID(win)
  );
}

function updateTabData(
  tab: any,
  instance: GraphInstanceState,
  snapshot: LibrarySnapshot,
  itemID: number | null,
): void {
  if (!tab || typeof tab !== "object") return;
  tab.data ??= {};
  tab.data.graphInstanceID = instance.instanceID;
  tab.data.graphTitle = instance.title;
  tab.data.libraryID = snapshot.libraryID;
  tab.data.itemID = itemID ?? snapshot.papers[0]?.itemID ?? null;
}

function syncInstanceTitle(
  win: _ZoteroTypes.MainWindow,
  instance: GraphInstanceState,
): void {
  if (instance.tabID) {
    const manager = tabs(win);
    const tab = manager.getTabInfo(instance.tabID);
    if (tab) {
      tab.data ??= {};
      tab.data.graphTitle = instance.title;
      void manager.rename(instance.tabID, instance.title);
    }
  }
  if (instance.detachedWindow && !instance.detachedWindow.closed) {
    instance.detachedWindow.document.title = instance.title;
  }
}

function instanceForTab(
  win: _ZoteroTypes.MainWindow,
  tab: any,
): GraphInstanceState | null {
  if (!isGraphTabDescriptor(tab)) return null;
  const state = graphState(win);
  const instanceID = String(tab?.data?.graphInstanceID ?? "").trim();
  if (instanceID) {
    const existing = state.instances.get(instanceID);
    if (existing) {
      existing.tabID = tab.id;
      existing.libraryID =
        positiveInteger(tab?.data?.libraryID) ?? existing.libraryID;
      return existing;
    }
  }
  if (!tab?.id) return null;
  const created = createGraphInstance(
    win,
    positiveInteger(tab?.data?.libraryID),
  );
  const restoredTitleRaw = String(tab?.data?.graphTitle ?? "").trim();
  // "Collection Graph" and "Explore" (and their numbered siblings) were the
  // default names of the previous version's two tab kinds; treat them as
  // absent so restored tabs fall through to a freshly generated title.
  const restoredTitle = isLegacyDefaultTitle(restoredTitleRaw)
    ? ""
    : restoredTitleRaw;
  if (restoredTitle) {
    created.title = restoredTitle;
    created.customTitle = true;
  }
  created.tabID = tab.id;
  tab.data ??= {};
  tab.data.graphInstanceID = created.instanceID;
  // Stop the stale kind key from propagating into future session stores.
  if (tab.data) delete tab.data.graphKind;
  return created;
}

function instanceForTabID(
  win: _ZoteroTypes.MainWindow,
  tabID: string | null | undefined,
): GraphInstanceState | null {
  if (!tabID) return null;
  const state = graphState(win);
  for (const instance of state.instances.values()) {
    if (instance.tabID === tabID) return instance;
  }
  try {
    const tab = tabs(win).getTabInfo(tabID);
    return isGraphTabDescriptor(tab) ? instanceForTab(win, tab) : null;
  } catch {
    return null;
  }
}

function liveInstances(win: _ZoteroTypes.MainWindow): GraphInstanceState[] {
  const state = graphState(win);
  const manager = tabs(win);
  for (const tab of manager._tabs ?? []) {
    if (isGraphTabDescriptor(tab)) instanceForTab(win, tab);
  }
  for (const [instanceID, instance] of [...state.instances.entries()]) {
    if (instance.tabID) {
      try {
        if (!manager.getTabInfo(instance.tabID)) instance.tabID = null;
      } catch {
        instance.tabID = null;
      }
    }
    if (
      !instance.tabID &&
      (!instance.detachedWindow || instance.detachedWindow.closed)
    ) {
      state.instances.delete(instanceID);
    }
  }
  return [...state.instances.values()];
}

function activeOrRecentInstance(
  win: _ZoteroTypes.MainWindow,
  libraryID?: number | null,
): GraphInstanceState | null {
  const manager = tabs(win);
  instanceForTabID(win, manager.selectedID);
  return selectReusableGraphInstance(
    liveInstances(win).filter(
      (instance) => !libraryID || instance.libraryID === libraryID,
    ),
    manager.selectedID,
  );
}

/**
 * Register custom-tab hooks as soon as the Zotero main window is available.
 * Zotero restores saved tabs during window startup, so delaying this until the
 * user first opens Meristema can leave a stale plugin tab without a
 * restoreState hook.
 */
export function installGraphTabHooks(win: _ZoteroTypes.MainWindow): void {
  const manager = tabs(win);
  if (!manager[TAB_STATE_FILTER_MARKER]) {
    const originalGetState = manager.getState.bind(manager);
    manager.getState = (): any[] =>
      originalGetState().filter((tab: any) => {
        const type = String(tab?.type ?? "").replace(/-unloaded$/, "");
        return type !== TAB_TYPE;
      });
    manager[TAB_STATE_FILTER_MARKER] = true;
  }
  if (manager[TAB_HOOK_MARKER]) return;
  manager.tabHooks ??= {};
  manager.tabHooks.restoreState ??= {};
  manager.tabHooks.getTitle ??= {};
  manager.tabHooks.focusFirst ??= {};
  manager.tabHooks.refocus ??= {};
  manager.tabHooks.moveToNewWindow ??= {};
  manager.tabHooks.restoreState[TAB_TYPE] = async () => ({ itemID: null });
  manager.tabHooks.getTitle[TAB_TYPE] = async (tab: any) =>
    String(tab?.data?.graphTitle ?? GRAPH_VIEW_BASE_TITLE);
  const focus = (tab: any): void => {
    const container = manager.getTabContent(tab.id);
    (container?.querySelector(".cm-search") as HTMLElement | null)?.focus();
  };
  manager.tabHooks.focusFirst[TAB_TYPE] = focus;
  manager.tabHooks.refocus[TAB_TYPE] = focus;
  manager.tabHooks.moveToNewWindow[TAB_TYPE] = async (tab: any) => {
    try {
      const instance = instanceForTab(win, tab);
      if (!instance) throw new Error("Meristema instance is unavailable.");
      const libraryID = tabLibraryID(tab, win, instance);
      const snapshot = await loadWholeLibrary(libraryID);
      const request = consumePendingRequest(instance);
      await openDetachedGraphWindow(win, instance, snapshot, request);
      instance.tabID = null;
      manager.close(tab.id);
    } catch (error) {
      reportAsyncError(
        "Meristema: moving the tab to a new window failed",
        error,
      );
    }
  };
  manager[TAB_HOOK_MARKER] = true;
}

function hideGlobalContextPane(
  win: _ZoteroTypes.MainWindow,
  container: HTMLElement,
): void {
  const controller = (win as any).ZoteroContextPane;
  const contextPane = win.document.getElementById("zotero-context-pane");
  controller?.splitter?.setAttribute?.("hidden", "true");
  contextPane?.setAttribute("collapsed", "true");
  if (controller?.sidenav) controller.sidenav.hidden = true;

  const tabContent = container as HTMLElement & {
    setBottomPlaceholderHeight?: (height: number) => void;
    setContextPaneOpen?: (open: boolean) => void;
  };
  tabContent.setBottomPlaceholderHeight?.(0);
  tabContent.setContextPaneOpen?.(false);
}

function prepareContainer(
  win: _ZoteroTypes.MainWindow,
  instance: GraphInstanceState,
  container: HTMLElement,
): void {
  container.setAttribute("flex", "1");
  Object.assign(container.style, {
    display: "flex",
    flex: "1 1 0",
    flexDirection: "column",
    alignItems: "stretch",
    width: "100%",
    minWidth: "0",
    minHeight: "0",
    overflow: "hidden",
  });

  const marked = container as HTMLElement & Record<string, unknown>;
  if (!marked[CONTEXT_HANDLER_MARKER]) {
    container.addEventListener("tab-selection-change", (event: Event) => {
      const selected = Boolean(
        (event as CustomEvent<{ selected?: boolean }>).detail?.selected,
      );
      getGraphViewController(container)?.setActive(selected);
      if (selected) {
        instance.lastActivatedAt = Date.now();
        hideGlobalContextPane(win, container);
        if (instance.dirty) {
          instance.dirty = false;
          void refreshGraphInstance(win, instance).catch((error) =>
            reportAsyncError("Meristema: deferred graph refresh failed", error),
          );
        }
      }
    });
    marked[CONTEXT_HANDLER_MARKER] = true;
  }

  if (tabs(win).selectedID === container.id) {
    hideGlobalContextPane(win, container);
  }
}

function renderTab(
  win: _ZoteroTypes.MainWindow,
  instance: GraphInstanceState,
  container: HTMLElement,
  snapshot: LibrarySnapshot,
): void {
  instance.libraryID = snapshot.libraryID;
  instance.dirty = false;
  instance.renderGeneration += 1;
  const generation = instance.renderGeneration;
  prepareContainer(win, instance, container);
  installDataSourceHoverTooltips(win.document);
  let attempts = 10;
  const render = (): void => {
    if (win.closed || generation !== instance.renderGeneration) return;
    if (!container.isConnected && attempts > 0) {
      attempts -= 1;
      win.setTimeout(() => win.requestAnimationFrame(render), 50);
      return;
    }
    const request = consumePendingRequest(instance);
    renderGraphView(win.document, container, snapshot, {
      mode: "tab",
      onSelectPaper: (itemID) => {
        void selectPaper(win, itemID).catch((error) =>
          reportAsyncError("Meristema: paper selection failed", error),
        );
      },
      initialItemIDs: request.selectionItemIDs,
      initialItemMode: request.selectionMode,
      initialMapScopeItemIDs: instance.mapScopeItemIDs,
      initialMapPinnedItemIDs: instance.mapPinnedItemIDs,
      onMapScopeChange: (scopeItemIDs, pinnedItemIDs) => {
        instance.mapScopeItemIDs = scopeItemIDs ? [...scopeItemIDs] : null;
        instance.mapPinnedItemIDs = [...pinnedItemIDs];
      },
      initialFocusItemIDs: request.focusItemIDs,
      initialCollectionIDs: request.collectionIDs,
    });
    getGraphViewController(container)?.setActive(
      tabs(win).selectedID === instance.tabID,
    );
    installGraphLibraryFilter(
      win.document,
      container,
      snapshot.libraryID,
      (libraryID) =>
        openGraphWindow(win, libraryID, {
          targetInstanceID: instance.instanceID,
        }),
    );
  };
  win.requestAnimationFrame(render);
}

function instanceMount(
  win: _ZoteroTypes.MainWindow,
  instance: GraphInstanceState,
): HTMLElement | null {
  if (
    instance.detachedWindow &&
    !instance.detachedWindow.closed &&
    instance.detachedMount
  ) {
    return instance.detachedMount;
  }
  if (!instance.tabID) return null;
  try {
    return tabs(win).getTabContent(instance.tabID) as HTMLElement | null;
  } catch {
    return null;
  }
}

function activateInstance(
  win: _ZoteroTypes.MainWindow,
  instance: GraphInstanceState,
): void {
  instance.lastActivatedAt = Date.now();
  if (instance.detachedWindow && !instance.detachedWindow.closed) {
    instance.detachedWindow.focus();
  } else if (instance.tabID) {
    tabs(win).select(instance.tabID);
    win.focus();
  }
}

function activateGraphItems(
  win: _ZoteroTypes.MainWindow,
  instance: GraphInstanceState,
  itemIDs: readonly number[],
  action: "add-map" | "add-focus",
): boolean {
  const mount = instanceMount(win, instance);
  if (!mount) return false;
  const controller = getGraphViewController(mount);
  controller?.setActive(true);
  const result =
    action === "add-focus"
      ? controller?.addFocusItems(itemIDs)
      : controller?.addMapItems(itemIDs);
  if (!result || result === "not-found") return false;
  activateInstance(win, instance);
  return true;
}

function activateGraphCollection(
  win: _ZoteroTypes.MainWindow,
  instance: GraphInstanceState,
  collectionIDs: readonly number[],
): boolean {
  const mount = instanceMount(win, instance);
  if (!mount) return false;
  const controller = getGraphViewController(mount);
  controller?.setActive(true);
  const result = controller?.openCollections(collectionIDs);
  if (!result || result === "not-found") return false;
  activateInstance(win, instance);
  return true;
}

interface OpenGraphOptions {
  newInstance?: boolean;
  targetInstanceID?: string | null;
  request?: PendingGraphRequest;
  /**
   * Names a newly created view after what it shows, e.g. "PhD Graph" for a
   * graph opened from the PhD folder. Ignored when an existing view is reused:
   * re-scoping a graph does not rename the tab out from under the user.
   */
  titleBase?: string;
}

function requestedInstance(
  win: _ZoteroTypes.MainWindow,
  options: OpenGraphOptions,
): GraphInstanceState | null {
  if (options.newInstance) return null;
  if (options.targetInstanceID) {
    const target = graphState(win).instances.get(options.targetInstanceID);
    if (target) return target;
  }
  return activeOrRecentInstance(win);
}

function setPendingRequest(
  instance: GraphInstanceState,
  request: PendingGraphRequest,
): void {
  instance.pendingSelectionItemIDs = [...request.selectionItemIDs];
  instance.pendingSelectionMode = request.selectionMode;
  instance.pendingFocusItemIDs = [...request.focusItemIDs];
  instance.pendingCollectionIDs = [...request.collectionIDs];
}

function emptyRequest(): PendingGraphRequest {
  return {
    selectionItemIDs: [],
    selectionMode: "replace",
    focusItemIDs: [],
    collectionIDs: [],
  };
}

async function refreshGraphInstance(
  win: _ZoteroTypes.MainWindow,
  instance: GraphInstanceState,
): Promise<void> {
  const libraryID = instance.libraryID ?? selectedLibraryID(win);
  const snapshot = await loadWholeLibrary(libraryID);
  if (instance.detachedWindow && !instance.detachedWindow.closed) {
    renderDetachedWindow(win, instance, snapshot);
    return;
  }
  if (!instance.tabID) return;
  const manager = tabs(win);
  const tab = manager.getTabInfo(instance.tabID);
  const container = manager.getTabContent(instance.tabID) as HTMLElement | null;
  if (!tab || !container) return;
  updateTabData(tab, instance, snapshot, null);
  renderTab(win, instance, container, snapshot);
}

export async function openGraphWindow(
  hostWindow?: _ZoteroTypes.MainWindow,
  libraryID?: number | null,
  options: OpenGraphOptions = {},
): Promise<void> {
  const win = hostWindow ?? defaultMainWindow();
  installGraphTabHooks(win);
  liveInstances(win);
  const targetLibraryID = requestedLibraryID(win, libraryID);
  const snapshot = await loadWholeLibrary(targetLibraryID);
  if (!snapshot.papers.length) {
    throw new Error(
      `${snapshot.libraryName} contains no regular Zotero items for Meristema.`,
    );
  }

  let instance = requestedInstance(win, options);
  if (!instance) {
    instance = createGraphInstance(win, targetLibraryID, options.titleBase);
  }
  const previousLibraryID = instance.libraryID;
  if (previousLibraryID !== null && previousLibraryID !== targetLibraryID) {
    instance.mapScopeItemIDs = null;
    instance.mapPinnedItemIDs = [];
  }
  if (options.request) setPendingRequest(instance, options.request);
  instance.libraryID = targetLibraryID;
  instance.lastActivatedAt = Date.now();

  if (instance.detachedWindow && !instance.detachedWindow.closed) {
    await openDetachedGraphWindow(
      win,
      instance,
      snapshot,
      consumePendingRequest(instance),
    );
    return;
  }

  const manager = tabs(win);
  if (instance.tabID) {
    const tab = manager.getTabInfo(instance.tabID);
    const container = manager.getTabContent(
      instance.tabID,
    ) as HTMLElement | null;
    if (tab && container) {
      const requestItemID =
        instance.pendingSelectionItemIDs[0] ??
        instance.pendingFocusItemIDs[0] ??
        null;
      updateTabData(tab, instance, snapshot, requestItemID);
      if (options.request || previousLibraryID !== snapshot.libraryID) {
        renderTab(win, instance, container, snapshot);
      }
      activateInstance(win, instance);
      return;
    }
    instance.tabID = null;
  }

  const request = {
    selectionItemIDs: [...instance.pendingSelectionItemIDs],
    selectionMode: instance.pendingSelectionMode,
    focusItemIDs: [...instance.pendingFocusItemIDs],
    collectionIDs: [...instance.pendingCollectionIDs],
  };
  const result: any = manager.add({
    id: instance.instanceID,
    type: TAB_TYPE,
    title: instance.title,
    data: {
      itemID: firstRequestedItemID(request) ?? snapshot.papers[0].itemID,
      libraryID: snapshot.libraryID,
      graph: true,
      graphInstanceID: instance.instanceID,
      graphTitle: instance.title,
      icon: NETWORK_ICON_TYPE,
    },
    select: true,
    onClose: () => {
      destroyGraphView(result.container);
      if (instance.tabID === result.id) instance.tabID = null;
      instance.pendingSelectionItemIDs = [];
      instance.pendingSelectionMode = "replace";
      instance.pendingFocusItemIDs = [];
      instance.pendingCollectionIDs = [];
      instance.mapScopeItemIDs = null;
      instance.mapPinnedItemIDs = [];
      if (!instance.detachedWindow || instance.detachedWindow.closed) {
        graphStateByWindow.get(win)?.instances.delete(instance.instanceID);
      }
    },
  });
  if (result.id === "zotero-pane" || result.container?.id === "zotero-pane") {
    throw new Error(
      "Meristema refused to mount into Zotero's reserved library tab.",
    );
  }
  instance.tabID = result.id;
  instance.libraryID = snapshot.libraryID;
  instance.lastActivatedAt = Date.now();
  renderTab(win, instance, result.container, snapshot);
}

export async function openNewGraphWindow(
  hostWindow?: _ZoteroTypes.MainWindow,
  libraryID?: number | null,
): Promise<void> {
  await openGraphWindow(hostWindow, libraryID, { newInstance: true });
}

export interface OpenGraphViewInfo {
  instanceID: string;
  title: string;
  tabID: string | null;
  active: boolean;
  detached: boolean;
}

export function getOpenGraphViews(
  hostWindow?: _ZoteroTypes.MainWindow,
): OpenGraphViewInfo[] {
  const win = hostWindow ?? defaultMainWindow();
  const selectedTabID = tabs(win).selectedID;
  return liveInstances(win)
    .sort((left, right) => right.lastActivatedAt - left.lastActivatedAt)
    .map((instance) => ({
      instanceID: instance.instanceID,
      title: instance.title,
      tabID: instance.tabID,
      active:
        instance.tabID === selectedTabID ||
        Boolean(
          instance.detachedWindow &&
          !instance.detachedWindow.closed &&
          instance.detachedWindow.document.hasFocus?.(),
        ),
      detached: Boolean(
        instance.detachedWindow && !instance.detachedWindow.closed,
      ),
    }));
}

export function renameGraphView(
  tabID: string,
  title: string,
  hostWindow?: _ZoteroTypes.MainWindow,
): void {
  const win = hostWindow ?? defaultMainWindow();
  const instance = instanceForTabID(win, tabID);
  if (!instance) {
    throw new Error("The selected tab is not a Meristema view.");
  }
  const normalized = title.trim();
  if (!normalized) throw new Error("Meristema view names cannot be empty.");
  instance.title = normalized;
  instance.customTitle = true;
  syncInstanceTitle(win, instance);
}

interface OpenItemViewOptions {
  newInstance?: boolean;
  targetInstanceID?: string | null;
}

function itemCommandInstance(
  win: _ZoteroTypes.MainWindow,
  options: OpenItemViewOptions,
): GraphInstanceState | null {
  if (options.newInstance) return null;
  if (options.targetInstanceID) {
    return graphState(win).instances.get(options.targetInstanceID) ?? null;
  }
  return activeOrRecentInstance(win);
}

function regularItemsByID(itemIDs: readonly number[]): Zotero.Item[] {
  return [...new Set(itemIDs)]
    .map((itemID) => Zotero.Items.get(itemID) as Zotero.Item | null)
    .filter((item): item is Zotero.Item =>
      Boolean(item?.isRegularItem?.() && !item.deleted),
    );
}

export async function openGraphAndSelectItems(
  itemIDs: readonly number[],
  hostWindow?: _ZoteroTypes.MainWindow,
  options: OpenItemViewOptions = {},
): Promise<void> {
  const win = hostWindow ?? defaultMainWindow();
  const items = regularItemsByID(itemIDs);
  if (!items.length) throw new Error("No regular Zotero items were selected.");
  const libraryID =
    positiveInteger(items[0].libraryID) ?? selectedLibraryID(win);
  const ids = items
    .filter((item) => Number(item.libraryID) === libraryID)
    .map((item) => Number(item.id));
  const instance = itemCommandInstance(win, options);
  const canExtendExistingScope = instance?.libraryID === libraryID;
  if (
    canExtendExistingScope &&
    activateGraphItems(win, instance, ids, "add-map")
  ) {
    return;
  }
  await openGraphWindow(win, libraryID, {
    newInstance: options.newInstance,
    targetInstanceID: options.targetInstanceID ?? instance?.instanceID,
    request: {
      ...emptyRequest(),
      selectionItemIDs: ids,
      selectionMode: canExtendExistingScope ? "add" : "replace",
    },
  });
}

export async function openGraphAndSelectItemsInNewTab(
  itemIDs: readonly number[],
  hostWindow?: _ZoteroTypes.MainWindow,
): Promise<void> {
  await openGraphAndSelectItems(itemIDs, hostWindow, {
    newInstance: true,
  });
}

export async function openGraphAndSelectItemsInView(
  instanceID: string,
  itemIDs: readonly number[],
  hostWindow?: _ZoteroTypes.MainWindow,
): Promise<void> {
  await openGraphAndSelectItems(itemIDs, hostWindow, {
    targetInstanceID: instanceID,
  });
}

export async function openFocusItem(
  itemID: number,
  hostWindow?: _ZoteroTypes.MainWindow,
): Promise<void> {
  await openFocusItems([itemID], hostWindow);
}

export async function openFocusItems(
  itemIDs: readonly number[],
  hostWindow?: _ZoteroTypes.MainWindow,
  options: OpenItemViewOptions = {},
): Promise<void> {
  const win = hostWindow ?? defaultMainWindow();
  const items = regularItemsByID(itemIDs);
  if (!items.length) throw new Error("No regular Zotero items were selected.");
  const libraryID =
    positiveInteger(items[0].libraryID) ?? selectedLibraryID(win);
  const ids = items
    .filter((item) => Number(item.libraryID) === libraryID)
    .map((item) => Number(item.id));
  const instance = itemCommandInstance(win, options);
  if (
    instance?.libraryID === libraryID &&
    activateGraphItems(win, instance, ids, "add-focus")
  ) {
    return;
  }
  await openGraphWindow(win, libraryID, {
    newInstance: options.newInstance,
    targetInstanceID: options.targetInstanceID ?? instance?.instanceID,
    request: {
      ...emptyRequest(),
      focusItemIDs: ids,
    },
  });
}

export async function openFocusItemsInNewTab(
  itemIDs: readonly number[],
  hostWindow?: _ZoteroTypes.MainWindow,
): Promise<void> {
  await openFocusItems(itemIDs, hostWindow, {
    newInstance: true,
  });
}

export async function openFocusItemsInView(
  instanceID: string,
  itemIDs: readonly number[],
  hostWindow?: _ZoteroTypes.MainWindow,
): Promise<void> {
  await openFocusItems(itemIDs, hostWindow, {
    targetInstanceID: instanceID,
  });
}

export async function openGraphForCollections(
  collectionIDs: readonly number[],
  hostWindow?: _ZoteroTypes.MainWindow,
  options: OpenItemViewOptions = {},
): Promise<void> {
  const win = hostWindow ?? defaultMainWindow();
  const collections = collectionIDs.map(
    (collectionID) => Zotero.Collections.get(collectionID) as any,
  );
  // All or nothing. Graphing the folders that happen to resolve would show a
  // scope the user did not ask for, and silently at that.
  if (!collections.length || collections.some((collection) => !collection)) {
    throw new Error("The selected Zotero collections are unavailable.");
  }
  const libraryID =
    positiveInteger(collections[0].libraryID) ?? selectedLibraryID(win);
  const instance = itemCommandInstance(win, options);
  if (
    instance?.libraryID === libraryID &&
    activateGraphCollection(win, instance, collectionIDs)
  ) {
    return;
  }
  await openGraphWindow(win, libraryID, {
    newInstance: options.newInstance,
    targetInstanceID: options.targetInstanceID ?? instance?.instanceID,
    titleBase:
      multiCollectionGraphTitle(
        collections.map((collection) => collection?.name),
      ) ?? undefined,
    request: {
      ...emptyRequest(),
      collectionIDs: [...collectionIDs],
    },
  });
}

export async function refreshOpenGraphViews(): Promise<void> {
  const generation = ++openViewRefreshGeneration;
  const snapshotByLibrary = new Map<number, Promise<LibrarySnapshot>>();
  const getSnapshot = (libraryID: number): Promise<LibrarySnapshot> => {
    let pending = snapshotByLibrary.get(libraryID);
    if (!pending) {
      pending = loadWholeLibrary(libraryID);
      snapshotByLibrary.set(libraryID, pending);
    }
    return pending;
  };

  for (const [win] of [...graphStateByWindow.entries()]) {
    if (generation !== openViewRefreshGeneration) return;
    if ((win as any).closed) {
      graphStateByWindow.delete(win);
      continue;
    }
    const manager = tabs(win);
    for (const instance of liveInstances(win)) {
      if (generation !== openViewRefreshGeneration) return;
      const hasDetached = Boolean(
        instance.detachedWindow &&
        !instance.detachedWindow.closed &&
        instance.detachedMount,
      );
      const isSelectedTab = Boolean(
        instance.tabID && manager.selectedID === instance.tabID,
      );
      if (!graphInstanceShouldRender(hasDetached, isSelectedTab)) {
        instance.dirty = true;
        continue;
      }
      try {
        const libraryID = instance.libraryID ?? selectedLibraryID(win);
        const snapshot = await getSnapshot(libraryID);
        if (generation !== openViewRefreshGeneration) return;
        if (hasDetached) {
          renderDetachedWindow(win, instance, snapshot);
        } else if (instance.tabID) {
          const tab = manager.getTabInfo(instance.tabID);
          const container = manager.getTabContent(
            instance.tabID,
          ) as HTMLElement | null;
          if (!tab || !container) continue;
          updateTabData(tab, instance, snapshot, null);
          renderTab(win, instance, container, snapshot);
        }
      } catch (error) {
        reportAsyncError("Meristema: graph refresh failed", error);
      }
    }
  }
}

export function cancelPendingGraphRefreshes(): void {
  openViewRefreshGeneration += 1;
}

export function closeGraphForWindow(
  win: _ZoteroTypes.MainWindow,
  closeTab = true,
): void {
  const state = graphStateByWindow.get(win);
  if (!state) return;
  const manager = tabs(win);
  for (const instance of [...state.instances.values()]) {
    if (instance.detachedWindow && !instance.detachedWindow.closed) {
      if (instance.detachedMount) {
        destroyGraphView(instance.detachedMount);
      }
      instance.detachedWindow.close();
    }
    instance.detachedWindow = null;
    instance.detachedMount = null;

    const tabID = instance.tabID;
    if (!tabID) continue;
    try {
      if (!closeTab) {
        const container = manager.getTabContent(tabID);
        if (container) destroyGraphView(container);
      } else if (manager.getTabInfo(tabID)) {
        manager.close(tabID);
      }
    } catch {
      // Window or tab may already be closed.
    }
    instance.tabID = null;
  }
  state.instances.clear();
  graphStateByWindow.delete(win);
}

export function closeGraphWindow(closeTab = true): void {
  for (const win of [...graphStateByWindow.keys()]) {
    closeGraphForWindow(win, closeTab);
  }
}

export function getDefaultHostWindow(): _ZoteroTypes.MainWindow {
  return defaultMainWindow();
}
