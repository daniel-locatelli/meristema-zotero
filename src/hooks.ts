import { config } from "../package.json";
import {
  closeCitationMetricsStore,
  initCitationMetricsStore,
} from "./services/citationMetricsStore";
import {
  closeExternalWorkCache,
  initExternalWorkCache,
} from "./services/externalWorkCacheService";
import { closePluginDatabase } from "./services/pluginDatabase";
import {
  startProviderResponseCache,
  stopProviderResponseCache,
  waitForProviderResponseCache,
} from "./services/providerResponseCacheService";
import { subscribeToCitationUpdates } from "./services/citationUpdateEvents";
import {
  startExternalDiscoveryRuntime,
  stopExternalDiscoveryRuntime,
} from "./services/externalDiscoveryService";
import {
  registerAutomaticCitationUpdates,
  unregisterAutomaticCitationUpdates,
  waitForCitationUpdates,
} from "./services/automaticUpdateCoordinator";
import {
  installCitationColumnTooltips,
  refreshCitationColumns,
  registerCitationColumns,
  uninstallCitationColumnTooltips,
  unregisterCitationColumns,
} from "./services/itemTreeColumnService";
import {
  refreshCitationItemPanes,
  registerCitationItemPane,
  unregisterCitationItemPane,
} from "./services/itemPaneService";
import { getShowMetricTooltipsEnabled } from "./services/citationPreferences";
import { registerMenus, unregisterMenus } from "./services/menuService";
import {
  registerPreferencePane,
  unregisterPreferenceObservers,
} from "./services/preferencePaneService";
import { clearCitationGraphSnapshots } from "./services/graphSnapshotStore";
import { clearFocusGraphCaches } from "./services/focusGraphCacheService";
import {
  clearWholeLibrarySnapshotCache,
  invalidateWholeLibrarySnapshot,
  markWholeLibraryMetricsDirty,
} from "./services/zoteroLibraryService";
import {
  clearLocalCitationExtractionCache,
  invalidateLocalCitationExtractionCache,
} from "./services/citationGraphService";
import { yieldToUI } from "./services/backgroundTaskService";
import {
  cancelPendingGraphRefreshes,
  closeGraphForWindow,
  closeGraphWindow,
  installGraphTabHooks,
  refreshOpenGraphViews,
} from "./services/windowService";
import {
  PAPER_DETAIL_STYLESHEET_HREF,
  PAPER_DETAIL_STYLESHEET_ID,
} from "./services/graphViewControls";

const MAIN_STYLESHEET_ID = `${config.addonRef}-main-stylesheet`;
const TAB_ICON_STYLESHEET_ID = `${config.addonRef}-tab-icon-stylesheet`;
const TEARDOWN_MARKER = `__${config.addonRef}RuntimeTeardownListener`;
let teardownStarted = false;
let unsubscribeUpdateListener: (() => void) | null = null;
let librarySnapshotNotifierID: string | null = null;
const VIEW_REFRESH_DEADLINE_MS = 5000;

function installStyles(win: _ZoteroTypes.MainWindow): void {
  const stylesheets: Array<[string, string]> = [
    [MAIN_STYLESHEET_ID, `chrome://${config.addonRef}/content/zoteroPane.css`],
    [TAB_ICON_STYLESHEET_ID, `chrome://${config.addonRef}/content/tabIcon.css`],
    [PAPER_DETAIL_STYLESHEET_ID, PAPER_DETAIL_STYLESHEET_HREF],
  ];
  for (const [id, href] of stylesheets) {
    if (win.document.getElementById(id)) continue;
    const link = win.document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "link",
    );
    link.id = id;
    link.setAttribute("rel", "stylesheet");
    link.setAttribute("href", href);
    (win.document.head ?? win.document.documentElement).appendChild(link);
  }
}

function syncMetricTooltipVisibility(win: _ZoteroTypes.MainWindow): void {
  const document = win.document;
  document.documentElement.dataset.meristemaTooltips =
    getShowMetricTooltipsEnabled() ? "enabled" : "disabled";
  const styleID = `${config.addonRef}-tooltip-visibility-style`;
  if (!document.getElementById(styleID)) {
    const style = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "style",
    );
    style.id = styleID;
    style.textContent =
      '[data-meristema-tooltips="disabled"] #meristema-central-tooltip { display: none !important; }';
    document.documentElement.appendChild(style);
  }
}

function withDeadline<T>(
  operation: Promise<T>,
  milliseconds: number,
  label: string,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error(`${label} timed out after ${milliseconds} ms`));
    }, milliseconds);
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Removing an item is the one library change nothing else re-renders for: an
 * add or a modify runs through the citation update, which ends with a graph
 * refresh, but a trash or a delete only reaches this observer. Without this,
 * an open graph keeps the gone item's node until something else refreshes
 * it. The refresh restores the view's state, so a graph seeded on the item
 * simply loses that seed.
 */
let removalRefreshTimer: ReturnType<typeof setTimeout> | null = null;
const REMOVAL_REFRESH_DELAY_MS = 250;

function scheduleRemovalRefresh(): void {
  if (removalRefreshTimer) clearTimeout(removalRefreshTimer);
  removalRefreshTimer = setTimeout(() => {
    removalRefreshTimer = null;
    if (!addon.data.alive) return;
    void withDeadline(
      refreshOpenGraphViews(),
      VIEW_REFRESH_DEADLINE_MS,
      "Graph view refresh after item removal",
      cancelPendingGraphRefreshes,
    ).catch((error: unknown) => {
      Zotero.debug(
        `Meristema: graph refresh after item removal failed: ${String(error)}`,
      );
    });
  }, REMOVAL_REFRESH_DELAY_MS);
}

function registerLibrarySnapshotInvalidation(): void {
  if (librarySnapshotNotifierID) return;
  const observer = {
    notify(
      event: string,
      type: string,
      ids: Array<number | string>,
      extraData?: Record<string, { libraryID?: number }>,
    ): void {
      if (type !== "item") return;
      if (event === "delete" || event === "trash") scheduleRemovalRefresh();
      const libraryIDs = new Set<number>();
      for (const id of ids) {
        const itemID = Number(id);
        const detail = extraData?.[String(id)] ?? extraData?.[itemID];
        const libraryID = Number(
          detail?.libraryID ??
            (Number.isFinite(itemID)
              ? (Zotero.Items.get(itemID) as Zotero.Item | null)?.libraryID
              : 0),
        );
        if (Number.isFinite(libraryID) && libraryID > 0) {
          libraryIDs.add(libraryID);
        }
      }
      if (!libraryIDs.size) {
        invalidateWholeLibrarySnapshot();
        invalidateLocalCitationExtractionCache();
        clearCitationGraphSnapshots();
        clearFocusGraphCaches();
        return;
      }
      for (const libraryID of libraryIDs) {
        invalidateWholeLibrarySnapshot(libraryID);
        invalidateLocalCitationExtractionCache(libraryID);
      }
      clearCitationGraphSnapshots();
      clearFocusGraphCaches();
    },
  };
  librarySnapshotNotifierID = Zotero.Notifier.registerObserver(
    observer,
    ["item"],
    "meristema-library-snapshot-cache",
  );
}

function unregisterLibrarySnapshotInvalidation(): void {
  if (removalRefreshTimer) {
    clearTimeout(removalRefreshTimer);
    removalRefreshTimer = null;
  }
  if (!librarySnapshotNotifierID) return;
  Zotero.Notifier.unregisterObserver(librarySnapshotNotifierID);
  librarySnapshotNotifierID = null;
}

function installUpdateRefreshListener(): void {
  if (unsubscribeUpdateListener) return;
  unsubscribeUpdateListener = subscribeToCitationUpdates(async (event) => {
    markWholeLibraryMetricsDirty();
    // Presentation refreshes all read the same completed store snapshot, but
    // must not execute as one uninterrupted main-thread burst. Give Zotero an
    // input/paint opportunity between the item tree, item pane, and graph.
    if (event.refreshColumns) {
      refreshCitationColumns();
      await yieldToUI(16);
    }
    if (event.refreshItemPanes) {
      refreshCitationItemPanes();
      await yieldToUI(16);
    }
    if (event.refreshGraph) {
      await withDeadline(
        refreshOpenGraphViews(),
        VIEW_REFRESH_DEADLINE_MS,
        "Graph view refresh",
        cancelPendingGraphRefreshes,
      );
    }
  });
}

function beginTeardown(closeGraphTab = true): void {
  if (teardownStarted) return;
  teardownStarted = true;
  addon.data.alive = false;
  unsubscribeUpdateListener?.();
  unsubscribeUpdateListener = null;
  stopProviderResponseCache();
  stopExternalDiscoveryRuntime();
  clearCitationGraphSnapshots();
  clearFocusGraphCaches();
  clearWholeLibrarySnapshotCache();
  clearLocalCitationExtractionCache();
  unregisterLibrarySnapshotInvalidation();
  cancelPendingGraphRefreshes();
  for (const action of [
    unregisterAutomaticCitationUpdates,
    unregisterPreferenceObservers,
    unregisterCitationItemPane,
    unregisterMenus,
    unregisterCitationColumns,
  ]) {
    try {
      action();
    } catch (error) {
      Zotero.debug(`Meristema: shutdown cleanup failed: ${String(error)}`);
    }
  }
  try {
    closeGraphWindow(closeGraphTab);
  } catch (error) {
    Zotero.debug(`Meristema: graph cleanup failed: ${String(error)}`);
  }
}

async function onStartup(): Promise<void> {
  teardownStarted = false;
  addon.data.alive = true;
  await Promise.all([Zotero.initializationPromise, Zotero.unlockPromise]);
  // Restored Meristema tabs can render during UI restoration. Initialize
  // both persistent stores before waiting for uiReady so no restored tab can
  // read from, or write to, an uninitialized external-work cache.
  await Promise.all([initCitationMetricsStore(), initExternalWorkCache()]);
  startExternalDiscoveryRuntime();
  startProviderResponseCache();
  installUpdateRefreshListener();
  registerLibrarySnapshotInvalidation();
  await Zotero.uiReadyPromise;
  for (const win of Zotero.getMainWindows()) await onMainWindowLoad(win);
  await registerCitationColumns();
  registerCitationItemPane();
  await registerPreferencePane();
  registerMenus();
  registerAutomaticCitationUpdates();
  addon.data.initialized = true;
  Zotero.debug("Meristema: startup completed");
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  // This hook can race startup during session restoration. The initializers
  // are idempotent and ensure the graph never observes an empty cache mirror.
  await Promise.all([initCitationMetricsStore(), initExternalWorkCache()]);
  // Install the custom tab hook immediately. Zotero may restore saved tabs
  // before the user has ever opened Meristema in this session.
  try {
    installGraphTabHooks(win);
  } catch (error) {
    Zotero.debug(`Meristema: tab-hook installation deferred: ${String(error)}`);
  }
  win.MozXULElement.insertFTLIfNeeded(`${config.addonRef}-mainWindow.ftl`);
  installStyles(win);
  syncMetricTooltipVisibility(win);
  installCitationColumnTooltips(win);
  const runtime = win as any;
  if (!runtime[TEARDOWN_MARKER]) {
    runtime[TEARDOWN_MARKER] = true;
    win.addEventListener(
      "close",
      () => {
        const others = Zotero.getMainWindows().filter(
          (candidate: _ZoteroTypes.MainWindow) =>
            candidate !== win && !(candidate as any).closed,
        );
        if (!others.length) beginTeardown(false);
        else closeGraphForWindow(win);
      },
      { once: true },
    );
  }
}

async function onMainWindowUnload(win: _ZoteroTypes.MainWindow): Promise<void> {
  const others = Zotero.getMainWindows().filter(
    (candidate: _ZoteroTypes.MainWindow) =>
      candidate !== win && !(candidate as any).closed,
  );
  if (!others.length) beginTeardown(false);
  else closeGraphForWindow(win);
  uninstallCitationColumnTooltips(win);
  win.document.getElementById(MAIN_STYLESHEET_ID)?.remove();
  win.document.getElementById(TAB_ICON_STYLESHEET_ID)?.remove();
}

async function onShutdown(): Promise<void> {
  beginTeardown();
  await waitForCitationUpdates();
  await waitForProviderResponseCache();
  await closeExternalWorkCache().catch((error: unknown) =>
    Zotero.logError(error instanceof Error ? error : new Error(String(error))),
  );
  await closeCitationMetricsStore().catch((error: unknown) =>
    Zotero.logError(error instanceof Error ? error : new Error(String(error))),
  );
  await closePluginDatabase().catch((error: unknown) =>
    Zotero.logError(error instanceof Error ? error : new Error(String(error))),
  );
  delete (Zotero as any)[config.addonInstance];
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
};
