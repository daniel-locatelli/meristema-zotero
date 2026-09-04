import { config } from "../../package.json";
import type {
  CitationGraphModel,
  CitationGraphNode,
} from "../domain/graphTypes";
import type { LibrarySnapshot } from "../domain/types";
import { refreshExternalRelationships } from "./externalDiscoveryService";
import { getMissingPaperRecommendations } from "./missingPaperRecommendationService";
import {
  confirmCitationMatch,
  confirmCitationMatchCandidate,
  getCitationMetricRecord,
} from "./citationMetricsStore";
import {
  getRelationshipViewSnapshot,
  getRelationshipViewSnapshotFromWorks,
  RELATIONSHIP_VIEW_LIMIT,
  notifyRelationshipMutation,
  subscribeRelationshipMutations,
} from "./relationshipViewService";
import {
  subscribeManualRelationChanges,
  subscribeRelationshipPublications,
} from "./relationshipEvents";
import { createMetricNodeForItem } from "./itemMetricContext";
import {
  createPaperOverviewActionBar,
  type PaperOverviewOpenAction,
} from "./paperOverviewActionsService";
import { formatMetricValue } from "./metricRegistry";
import { updateCitationDataForItems } from "./citationUpdateService";
import {
  buildCitationGraph,
  getCachedCitationGraph,
  getCachedCitationGraphForSnapshot,
} from "./citationGraphService";
import { ensureSourceMetricsForNodes } from "./sourceMetricsService";
import {
  openGraphAndSelectItemsInNewTab,
  openFocusItemsInNewTab,
  refreshOpenGraphViews,
} from "./windowService";
import { loadWholeLibrary } from "./zoteroLibraryService";
import { clear, text } from "./graphViewControls";
import {
  createBadges,
  createDetailTabs,
  createOverviewMetrics,
  createRelationshipList,
  createSimilarSection,
  detailSection,
  type PaperDetailHost,
  type RelationshipList,
} from "./paperDetailView";
import type { DetailTab } from "./paperDetailModel";

const HTML_NS = "http://www.w3.org/1999/xhtml";
const PANE_ID = "meristema-item-pane";
const RELATION_LIMIT = RELATIONSHIP_VIEW_LIMIT;
interface PaneTabState {
  itemKey: string;
  active: DetailTab;
}
let registeredPaneID: string | false | null = null;
let unsubscribeRelationshipMutations: (() => void) | null = null;
let unsubscribeRelationshipPublications: (() => void) | null = null;
let unsubscribeManualRelationChanges: (() => void) | null = null;
let scheduledPaneRefresh: ReturnType<typeof setTimeout> | null = null;
const refreshCallbacks = new Map<Element, () => Promise<void>>();
const paneSubjects = new Map<Element, { libraryID: number; itemKey: string }>();
const paneTabState = new WeakMap<HTMLElement, PaneTabState>();
const activeLists = new WeakMap<HTMLElement, RelationshipList>();

function el<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElementNS(
    HTML_NS,
    tag,
  ) as HTMLElementTagNameMap[K];
  if (className) node.className = className;
  return node;
}

function runUIAction(context: string, action: () => Promise<void>): void {
  void action().catch((error: unknown) => {
    const normalized =
      error instanceof Error
        ? error
        : new Error(
            `Meristema: ${context} failed (${
              error === undefined ? "undefined rejection" : String(error)
            })`,
          );
    Zotero.logError(normalized);
  });
}

function summaryForItem(item: Zotero.Item): string {
  const node = createMetricNodeForItem(item);
  const parts = [
    node.citationCount === null ? null : `${node.citationCount} C`,
    node.referenceCount === null ? null : `${node.referenceCount} R`,
    node.citationVelocity === null
      ? null
      : `${formatMetricValue("citation-rate", node.citationVelocity)}/y`,
  ].filter(Boolean);
  return parts.join(" · ") || "No citation data";
}

function itemByKey(libraryID: number, itemKey: string): Zotero.Item | null {
  try {
    return (
      (Zotero.Items as any).getByLibraryAndKey?.(libraryID, itemKey) ?? null
    );
  } catch {
    return null;
  }
}

function paneSubjectItem(
  item: Zotero.Item | null | undefined,
): Zotero.Item | null {
  let current = item ?? null;
  const visited = new Set<number>();
  while (current) {
    if (current.isRegularItem?.() && !current.deleted) return current;
    const currentID = Number(current.id);
    if (Number.isFinite(currentID)) {
      if (visited.has(currentID)) return null;
      visited.add(currentID);
    }
    const parentID = Number(
      (current as any).parentItemID ??
        (current as any).parentID ??
        (current as any).getSource?.() ??
        0,
    );
    if (!Number.isFinite(parentID) || parentID <= 0) return null;
    current = (Zotero.Items.get(parentID) as Zotero.Item | null) ?? null;
  }
  return null;
}

async function graphNodeForItem(item: Zotero.Item): Promise<{
  node: CitationGraphNode;
  graph: CitationGraphModel;
  snapshot: LibrarySnapshot;
}> {
  const snapshot = await loadWholeLibrary(Number(item.libraryID));
  const graph =
    getCachedCitationGraphForSnapshot(snapshot) ?? buildCitationGraph(snapshot);
  const node =
    graph.nodes.find((candidate) => candidate.itemKey === String(item.key)) ??
    createMetricNodeForItem(item);
  return { node, graph, snapshot };
}

interface CachedItemPaneLibrarySnapshot {
  expiresAt: number;
  promise: Promise<LibrarySnapshot>;
}

const itemPaneLibrarySnapshots = new Map<
  number,
  CachedItemPaneLibrarySnapshot
>();
const ITEM_PANE_LIBRARY_SNAPSHOT_TTL_MS = 10_000;

async function relationshipLibrarySnapshot(
  libraryID: number,
): Promise<LibrarySnapshot> {
  const now = Date.now();
  const cached = itemPaneLibrarySnapshots.get(libraryID);
  if (cached && cached.expiresAt > now) return cached.promise;
  const promise = loadWholeLibrary(libraryID).catch((error: unknown) => {
    if (itemPaneLibrarySnapshots.get(libraryID)?.promise === promise) {
      itemPaneLibrarySnapshots.delete(libraryID);
    }
    throw error;
  });
  itemPaneLibrarySnapshots.set(libraryID, {
    expiresAt: now + ITEM_PANE_LIBRARY_SNAPSHOT_TTL_MS,
    promise,
  });
  return promise;
}

function renderMatchConfirmation(
  document: Document,
  container: HTMLElement,
  item: Zotero.Item,
  rerender: () => void,
): void {
  const record = getCitationMetricRecord(
    Number(item.libraryID),
    String(item.key),
  );
  if (!record) return;
  if (record.identityConflict) {
    const warning = el(document, "section", "meristema-match-warning");
    warning.append(
      text(document, "strong", "Scholarly identity conflict"),
      text(
        document,
        "p",
        "Zotero and the provider returned conflicting stable identifiers. Meristema kept the Zotero data and did not merge the provider record.",
      ),
    );
    container.appendChild(warning);
    return;
  }
  if (!record.matchConfirmed && record.status === "success") {
    const warning = el(document, "section", "meristema-match-warning");
    warning.append(
      text(document, "strong", "Confirm scholarly-record match"),
      text(
        document,
        "p",
        `Citation data were matched using ${record.matchedBy ?? "a fallback identifier"}. Confirm that the provider record is the same work.`,
      ),
    );
    const confirm = el(document, "button", "cm-primary-button");
    confirm.type = "button";
    confirm.textContent = "Confirm match";
    confirm.addEventListener("click", () => {
      runUIAction("confirming a citation match", async () => {
        confirm.disabled = true;
        await confirmCitationMatch(Number(item.libraryID), String(item.key));
        rerender();
      });
    });
    warning.appendChild(confirm);
    container.appendChild(warning);
  }
  if (record.matchCandidates.length > 0) {
    const warning = el(document, "section", "meristema-match-warning");
    warning.append(
      text(document, "strong", "Choose the matching scholarly record"),
      text(
        document,
        "p",
        "The exact-title fallback returned multiple or contradictory records.",
      ),
    );
    for (const candidate of record.matchCandidates) {
      const card = el(document, "article", "meristema-candidate");
      card.append(
        text(
          document,
          "div",
          candidate.title ?? "Untitled",
          "meristema-candidate-title",
        ),
        text(
          document,
          "div",
          [
            candidate.authors.slice(0, 3).join(", "),
            candidate.year,
            candidate.doi,
          ]
            .filter(Boolean)
            .join(" · "),
          "cm-detail-meta",
        ),
      );
      const use = el(document, "button", "cm-secondary-button");
      use.type = "button";
      use.textContent = "Use this match";
      use.addEventListener("click", () => {
        runUIAction("confirming a citation-match candidate", async () => {
          use.disabled = true;
          await confirmCitationMatchCandidate(
            Number(item.libraryID),
            String(item.key),
            candidate,
          );
          await updateCitationDataForItems([item], {
            force: true,
            silent: true,
          });
          rerender();
        });
      });
      card.appendChild(use);
      warning.appendChild(card);
    }
    container.appendChild(warning);
  }
}

function openActionsFor(
  document: Document,
  item: Zotero.Item,
): readonly PaperOverviewOpenAction[] {
  const itemID = Number(item.id);
  const hostWindow = document.defaultView as _ZoteroTypes.MainWindow;
  return [
    {
      label: "Collection Graph",
      title: "Open this paper in a new Collection Graph tab.",
      action: () => openGraphAndSelectItemsInNewTab([itemID], hostWindow),
    },
    {
      label: "Explore",
      title: "Open this paper as the seed of a new Explore view.",
      action: () => openFocusItemsInNewTab([itemID], hostWindow),
    },
  ];
}

function renderOverview(
  document: Document,
  container: HTMLElement,
  item: Zotero.Item,
  host: PaperDetailHost,
  rerender: () => void,
  loadSnapshot: () => Promise<void>,
): void {
  const node = createMetricNodeForItem(item);
  renderMatchConfirmation(document, container, item, rerender);
  const badges = createBadges(document, node);
  if (badges) container.appendChild(detailSection(document, badges));
  container.appendChild(createOverviewMetrics(document, node));

  void ensureSourceMetricsForNodes([node])
    .then((updated) => {
      if (updated > 0 && container.isConnected) rerender();
    })
    .catch((error: unknown) => {
      Zotero.logError(
        error instanceof Error ? error : new Error(String(error)),
      );
    });

  // The rows the section draws read `host.snapshot`, so the library snapshot
  // has to be in hand before the first of them exists — but only here, which is
  // why the Overview itself never waits on it.
  const similar = createSimilarSection(document, host, async () => {
    await loadSnapshot();
    const { node: selected, graph } = await graphNodeForItem(item);
    return getMissingPaperRecommendations([selected], graph.nodes, 50, 2);
  });
  const actions = createPaperOverviewActionBar({
    document,
    actionsClass: "cm-detail-actions",
    primaryButtonClass: "cm-primary-button",
    secondaryButtonClass: "cm-secondary-button",
    openActions: openActionsFor(document, item),
    // `start()` rethrows after it has drawn its own failure state; the action
    // bar's own `invoke` catches and logs what comes back out.
    onSimilar: () => similar.start(),
    onRefresh: async () => {
      await updateCitationDataForItems([item], {
        force: false,
        progressDocument: document,
      });
      rerender();
    },
  });
  container.append(detailSection(document, actions.root), similar.root);
}

function renderPane(
  document: Document,
  body: HTMLElement,
  item: Zotero.Item,
  setSectionSummary?: (summary: string) => void,
): void {
  const itemKey = String(item.key);
  const libraryID = Number(item.libraryID);
  const previousState = paneTabState.get(body);
  let active: DetailTab =
    previousState?.itemKey === itemKey ? previousState.active : "overview";
  paneTabState.set(body, { itemKey, active });
  activeLists.get(body)?.destroy();
  activeLists.delete(body);

  const render = (): void => {
    setSectionSummary?.(summaryForItem(item));
    activeLists.get(body)?.destroy();
    activeLists.delete(body);
    clear(body);
    const shell = el(
      document,
      "div",
      "meristema-paper-detail meristema-item-pane",
    );
    const content = el(document, "div", "meristema-pane-content");
    const node = createMetricNodeForItem(item);
    const tabs = createDetailTabs(document, {
      node,
      libraryID,
      active,
      onSelect: (tab) => {
        active = tab;
        paneTabState.set(body, { itemKey, active });
        render();
      },
    });
    shell.append(tabs.root, content);
    body.appendChild(shell);

    // The Overview needs no library snapshot to draw, and waiting on one would
    // stall every pane behind a whole-library load. Only the parts that read
    // `host.snapshot` — the similar-paper rows and the relationship lists —
    // load it, and each does so before drawing its first row.
    let loadedSnapshot: LibrarySnapshot | null = null;
    const host: PaperDetailHost = {
      origin: "item-pane",
      get snapshot() {
        if (!loadedSnapshot) {
          throw new Error("Meristema: library snapshot not loaded yet.");
        }
        return loadedSnapshot;
      },
      collectionChooser: false,
      showInZotero: (itemKey) => {
        const related = itemByKey(libraryID, itemKey);
        if (related) Zotero.getActiveZoteroPane?.()?.selectItem?.(related.id);
      },
      onRelationshipMutation: (event) => notifyRelationshipMutation(event),
    };

    if (active === "overview") {
      renderOverview(document, content, item, host, render, async () => {
        loadedSnapshot = await relationshipLibrarySnapshot(libraryID);
      });
      return;
    }

    const direction = active;
    content.appendChild(text(document, "p", "Loading…", "cm-placeholder"));
    void relationshipLibrarySnapshot(libraryID)
      .then((snapshot) => {
        if (!content.isConnected) return;
        loadedSnapshot = snapshot;
        clear(content);
        const graph = getCachedCitationGraph(libraryID);
        const libraryWorks = graph?.nodes ?? snapshot.papers;
        const list = createRelationshipList(document, {
          host,
          node,
          direction,
          readSnapshot: (refreshing) =>
            graph
              ? getRelationshipViewSnapshot(
                  graph,
                  node,
                  direction,
                  libraryID,
                  RELATION_LIMIT,
                  refreshing ? { queueBackgroundHydration: false } : undefined,
                )
              : getRelationshipViewSnapshotFromWorks(
                  node,
                  direction,
                  libraryID,
                  libraryWorks,
                  direction === "references" ? node.references : [],
                  RELATION_LIMIT,
                  refreshing ? { queueBackgroundHydration: false } : undefined,
                ),
          refreshRelationships: (signal) =>
            refreshExternalRelationships(node, libraryWorks, direction, {
              maximum: RELATIONSHIP_VIEW_LIMIT,
              refreshMembership: true,
              silent: true,
              mode: "manual",
              queueBackgroundHydration: true,
              signal,
            }).then(() => undefined),
          onManualChange: () => void refreshOpenGraphViews(),
          updateCounts: (current) => tabs.updateCounts(current),
        });
        activeLists.set(body, list);
        content.appendChild(list.root);
      })
      .catch((error: unknown) => {
        if (content.isConnected) {
          clear(content);
          content.appendChild(
            text(
              document,
              "p",
              "Unable to load relationships.",
              "cm-placeholder",
            ),
          );
        }
        Zotero.logError(
          error instanceof Error ? error : new Error(String(error)),
        );
      });
  };
  render();
}

function renderPaneForItem(
  document: Document,
  body: HTMLElement,
  item: Zotero.Item,
  setEnabled: ((enabled: boolean) => void) | null,
  setSectionSummary: (summary: string) => void,
): void {
  const subject = paneSubjectItem(item);
  setEnabled?.(Boolean(subject));
  if (!subject) {
    paneSubjects.delete(body);
    activeLists.get(body)?.destroy();
    activeLists.delete(body);
    clear(body);
    return;
  }
  paneSubjects.set(body, {
    libraryID: Number(subject.libraryID),
    itemKey: String(subject.key),
  });
  renderPane(document, body, subject, setSectionSummary);
}

export function registerCitationItemPane(): void {
  if (registeredPaneID) return;
  const manager = (Zotero as any).ItemPaneManager;
  if (!manager?.registerSection) {
    Zotero.debug("Meristema: Zotero ItemPaneManager is unavailable.");
    return;
  }
  registeredPaneID = manager.registerSection({
    paneID: PANE_ID,
    pluginID: config.addonID,
    // The section variant of the network icon is drawn at 80% so it sits with
    // Zotero's own header and sidenav icons instead of over-filling its box.
    header: {
      l10nID: "meristema-item-pane-header",
      icon: `chrome://${config.addonRef}/content/icons/network-section.svg`,
    },
    sidenav: {
      l10nID: "meristema-item-pane-sidenav",
      icon: `chrome://${config.addonRef}/content/icons/network-section.svg`,
    },
    onInit: ({
      body,
      refresh,
    }: {
      body: HTMLElement;
      refresh: () => Promise<void>;
    }) => {
      refreshCallbacks.set(body, refresh);
    },
    onDestroy: ({ body }: { body: HTMLElement }) => {
      refreshCallbacks.delete(body);
      paneSubjects.delete(body);
      paneTabState.delete(body);
      activeLists.get(body)?.destroy();
      activeLists.delete(body);
    },
    onItemChange: ({
      doc,
      body,
      item,
      setEnabled,
      setSectionSummary,
    }: {
      doc: Document;
      body: HTMLElement;
      item: Zotero.Item;
      setEnabled: (enabled: boolean) => void;
      setSectionSummary: (summary: string) => void;
    }) => {
      renderPaneForItem(doc, body, item, setEnabled, setSectionSummary);
    },
    onRender: ({
      doc,
      body,
      item,
      setSectionSummary,
    }: {
      doc: Document;
      body: HTMLElement;
      item: Zotero.Item;
      setSectionSummary: (summary: string) => void;
    }) => {
      renderPaneForItem(doc, body, item, null, setSectionSummary);
    },
  });
  unsubscribeRelationshipMutations ??= subscribeRelationshipMutations(
    (event) => {
      if (event.origin === "item-pane") return;
      scheduleCitationItemPaneRefresh(event.libraryID, event.subjectItemKey);
    },
  );
  unsubscribeRelationshipPublications ??= subscribeRelationshipPublications(
    (event) => {
      if (event.phase !== "metadata-published") return;
      scheduleCitationItemPaneRefresh(event.libraryID, event.subjectItemKey);
    },
  );
  // The graph's detail pane adds and removes manual relations too, and the
  // ping says only that something changed, so every open pane re-reads.
  unsubscribeManualRelationChanges ??= subscribeManualRelationChanges(() => {
    scheduleCitationItemPaneRefresh();
  });
}

const pendingPaneRefreshes = new Set<string>();
let pendingFullPaneRefresh = false;

function itemPaneRefreshKey(libraryID: number, itemKey: string): string {
  return `${libraryID}:${itemKey.toLocaleUpperCase()}`;
}

function scheduleCitationItemPaneRefresh(
  libraryID?: number,
  itemKey?: string,
): void {
  if (libraryID === undefined || !itemKey) {
    pendingFullPaneRefresh = true;
  } else {
    pendingPaneRefreshes.add(itemPaneRefreshKey(libraryID, itemKey));
  }
  if (scheduledPaneRefresh !== null) return;
  scheduledPaneRefresh = setTimeout(() => {
    scheduledPaneRefresh = null;
    const fullRefresh = pendingFullPaneRefresh;
    const requested = new Set(pendingPaneRefreshes);
    pendingFullPaneRefresh = false;
    pendingPaneRefreshes.clear();
    for (const [body, refresh] of refreshCallbacks) {
      const subject = paneSubjects.get(body);
      if (
        !fullRefresh &&
        (!subject ||
          !requested.has(
            itemPaneRefreshKey(subject.libraryID, subject.itemKey),
          ))
      ) {
        continue;
      }
      void refresh().catch((error) =>
        Zotero.debug(`Meristema: item-pane refresh failed: ${String(error)}`),
      );
    }
  }, 30);
}

export function refreshCitationItemPanes(): void {
  for (const refresh of refreshCallbacks.values()) {
    void refresh().catch((error) =>
      Zotero.debug(`Meristema: item-pane refresh failed: ${String(error)}`),
    );
  }
}

export function unregisterCitationItemPane(): void {
  if (typeof registeredPaneID === "string") {
    try {
      (Zotero as any).ItemPaneManager?.unregisterSection?.(registeredPaneID);
    } catch (error) {
      Zotero.debug(`Meristema: item pane cleanup failed: ${String(error)}`);
    }
  }
  registeredPaneID = null;
  unsubscribeRelationshipMutations?.();
  unsubscribeRelationshipMutations = null;
  unsubscribeRelationshipPublications?.();
  unsubscribeRelationshipPublications = null;
  unsubscribeManualRelationChanges?.();
  unsubscribeManualRelationChanges = null;
  if (scheduledPaneRefresh !== null) {
    clearTimeout(scheduledPaneRefresh);
    scheduledPaneRefresh = null;
  }
  pendingPaneRefreshes.clear();
  pendingFullPaneRefresh = false;
  refreshCallbacks.clear();
  paneSubjects.clear();
  itemPaneLibrarySnapshots.clear();
}
