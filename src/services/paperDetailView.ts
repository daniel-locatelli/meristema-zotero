/*
 * The paper detail view, as both hosts draw it: the graph's right pane
 * (graphViewService.ts) and the item pane section (itemPaneService.ts). Each
 * builder returns plain elements; what differs between the hosts — what "Show
 * in Zotero" does, whether a row can preview on the plot, whether import
 * offers a collection chooser — comes in through `PaperDetailHost`.
 *
 * Decisions that need no DOM are in paperDetailModel.ts.
 */
import type { ExternalWork } from "../domain/externalWork";
import type { CitationGraphNode } from "../domain/graphTypes";
import type { LibrarySnapshot, ZoteroPaper } from "../domain/types";
import {
  createIgnoredRelationIndex,
  findIgnoredRelation,
  type IgnoredRelationIndex,
} from "../domain/relationshipDescriptors";
import {
  createRelatedWorkLookupIndex,
  type RelatedWorkLookupIndex,
} from "../domain/workIdentity";
import {
  getCitationMetricRecord,
  getIgnoredRelations,
  ignoreProviderRelation,
  removeIgnoredRelation,
  removeManualRelation,
} from "./citationMetricsStore";
import { importExternalWork } from "./externalDiscoveryService";
import {
  externalWorkAuthorsText,
  externalWorkMetadataText,
} from "./externalWorkPresentationService";
import { externalWorkDisplayTitle } from "./externalWorkMetadataService";
import { createMetricNodeForItem } from "./itemMetricContext";
import { manualRelationsForSubject } from "./manualRelationshipPickerService";
import {
  formatMetricValue,
  getMetricDefinition,
  METRIC_DEFINITIONS,
  SUPPLEMENTARY_PROPERTY_DEFINITIONS,
} from "./metricRegistry";
import {
  ignoredRelationDescriptorFor,
  mergeRelationEntries,
  relationshipTabLabel,
  type DetailTab,
  type DetailTabLabel,
  type RelationEntry,
} from "./paperDetailModel";
import {
  citationDataSourceLabel,
  externalWorkURL,
} from "./providerPresentation";
import { getRelationshipPublicationState } from "./relationshipEvents";
import {
  getRelationshipReportedCounts,
  type RelationshipMutationEvent,
  type RelationshipViewDirection,
} from "./relationshipViewService";
import { clear, element, normalizeSearch, text } from "./graphViewControls";

export interface RowAction {
  label: string;
  title?: string;
  /** Rendered with `cm-primary-button`; default is secondary. */
  primary?: boolean;
  run(): void | Promise<void>;
}

export interface RelationshipContext {
  node: CitationGraphNode;
  direction: RelationshipViewDirection;
  ignoredIndex: IgnoredRelationIndex;
  referenceIndex?: RelatedWorkLookupIndex;
  /** Redraw the list after a manual relation is removed. */
  rerender(): void;
}

export interface PaperDetailHost {
  origin: "graph" | "item-pane";
  snapshot: LibrarySnapshot;
  /** Select the library item with this key in Zotero. */
  showInZotero(itemKey: string): void;
  /** Whether Add to Zotero opens the collection chooser first. */
  collectionChooser: boolean;
  /** Extra chip buttons on a row (Explore from this paper, Add as seed). */
  rowActions?(work: ExternalWork): readonly RowAction[];
  /** A click handler for a row when clicking it previews on the plot. */
  previewRow?(
    work: ExternalWork,
    context: RelationshipContext | null,
  ): (() => void) | null;
  clearPreview?(): void;
  /** Called after an ignore or a restore; the host publishes or applies it. */
  onRelationshipMutation(event: RelationshipMutationEvent): void;
}

export function runAction(
  button: HTMLButtonElement,
  action: () => void | Promise<void>,
): void {
  if (button.disabled) return;
  button.disabled = true;
  void Promise.resolve()
    .then(action)
    .catch((error: unknown) => {
      Zotero.logError(
        error instanceof Error ? error : new Error(String(error)),
      );
    })
    .finally(() => {
      if (button.isConnected) button.disabled = false;
    });
}

export function button(
  document: Document,
  label: string | DocumentFragment,
  className: string,
  title?: string,
): HTMLButtonElement {
  const node = element(document, "button", className);
  node.type = "button";
  if (typeof label === "string") node.textContent = label;
  else node.appendChild(label);
  if (title) node.title = title;
  return node;
}

export function externalWorkTitle(work: ExternalWork): string {
  return externalWorkDisplayTitle(work) ?? "Title unavailable";
}

function localPaperByKey(
  snapshot: LibrarySnapshot,
): ReadonlyMap<string, ZoteroPaper> {
  return new Map(snapshot.papers.map((paper) => [paper.itemKey, paper]));
}

/**
 * One block of a body, in the rhythm `.cm-detail-section` sets: padding above
 * and below, and a hairline between it and the block before it.
 */
export function detailSection(
  document: Document,
  ...children: readonly Node[]
): HTMLElement {
  const wrapper = element(document, "section", "cm-detail-section");
  wrapper.append(...children);
  return wrapper;
}

/* ---------------------------------------------------------------- tabs */

function publicationStateFor(
  libraryID: number,
  node: CitationGraphNode,
  direction: RelationshipViewDirection,
) {
  return (
    getRelationshipPublicationState(libraryID, node.itemKey, direction) ??
    getRelationshipPublicationState(
      Zotero.Libraries.userLibraryID,
      node.itemKey,
      direction,
    )
  );
}

function tabLabelFor(
  libraryID: number,
  node: CitationGraphNode,
  tab: DetailTab,
): DetailTabLabel {
  if (tab === "overview") {
    return { name: "Overview", count: null, title: "This paper's metrics" };
  }
  const reported = getRelationshipReportedCounts(libraryID, node);
  return relationshipTabLabel(
    tab,
    publicationStateFor(libraryID, node, tab),
    tab === "references" ? reported.referenceCount : reported.citationCount,
  );
}

function applyTabLabel(target: HTMLButtonElement, label: DetailTabLabel): void {
  const document = target.ownerDocument;
  clear(target);
  target.append(text(document, "span", label.name, "cm-detail-tab-label"));
  if (label.count !== null) {
    target.append(text(document, "span", label.count, "cm-detail-tab-count"));
  }
  target.title = label.title;
}

export function createDetailTabs(
  document: Document,
  options: {
    node: CitationGraphNode;
    libraryID: number;
    active: DetailTab;
    onSelect(tab: DetailTab): void;
  },
): { root: HTMLDivElement; updateCounts(node: CitationGraphNode): void } {
  const root = element(document, "div", "cm-detail-tabs");
  const tabs: DetailTab[] = ["overview", "cited-by", "references"];
  for (const tab of tabs) {
    const entry = button(document, "", "");
    entry.dataset.mode = tab;
    entry.dataset.selected = String(tab === options.active);
    applyTabLabel(entry, tabLabelFor(options.libraryID, options.node, tab));
    entry.addEventListener("click", () => options.onSelect(tab));
    root.appendChild(entry);
  }
  return {
    root,
    updateCounts(node) {
      for (const tab of tabs) {
        const entry = root.querySelector<HTMLButtonElement>(
          `button[data-mode="${tab}"]`,
        );
        if (entry)
          applyTabLabel(entry, tabLabelFor(options.libraryID, node, tab));
      }
    },
  };
}

/* -------------------------------------------------------------- badges */

export function createBadges(
  document: Document,
  subject: CitationGraphNode | ExternalWork,
  extra: { manual?: boolean; ignored?: boolean } = {},
): HTMLDivElement | null {
  const badges = element(document, "div", "cm-badges");
  const add = (label: string, className?: string): void => {
    badges.appendChild(text(document, "span", label, className));
  };
  if (extra.manual) add("Manual");
  if (subject.isOpenAccess) add("Open Access");
  if (extra.ignored) add("Ignored Relationship");
  if (subject.isRetracted) add("Retracted", "cm-badge-danger");
  if ("matchConfirmed" in subject) {
    if (subject.isTop1Percent) add("Top 1%");
    else if (subject.isTop10Percent) add("Top 10%");
    if (!subject.matchConfirmed)
      add("Match needs confirmation", "cm-badge-warning");
  }
  return badges.childElementCount ? badges : null;
}

/* ------------------------------------------------------------- metrics */

function advancedMetrics(
  document: Document,
  node: CitationGraphNode,
): HTMLElement {
  const details = element(document, "details", "cm-advanced-details");
  details.appendChild(text(document, "summary", "Advanced"));
  const rows = element(document, "dl", "cm-metric-list");
  const append = (label: string, value: string, description: string): void => {
    const term = text(document, "dt", label);
    term.title = description;
    rows.append(term, text(document, "dd", value));
  };
  for (const metric of METRIC_DEFINITIONS) {
    if (metric.itemPane !== "advanced") continue;
    append(
      metric.label,
      formatMetricValue(metric.id, metric.value(node)),
      metric.description,
    );
  }
  for (const property of SUPPLEMENTARY_PROPERTY_DEFINITIONS) {
    if (property.itemPane !== "advanced") continue;
    const value = property.value(node);
    append(
      property.label,
      value === null || value === undefined || value === ""
        ? "—"
        : property.format(value),
      property.description,
    );
  }
  details.appendChild(rows);
  return details;
}

/**
 * Three figures — FWCI, citations per year, percentile — or one sentence when
 * none is known, then Advanced with the rest of the registry. The tab row
 * above already states the citation and reference counts.
 */
export function createOverviewMetrics(
  document: Document,
  node: CitationGraphNode,
): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const headline = [
    ["FWCI", formatMetricValue("fwci", node.fwci), "fwci"],
    [
      "Citations / year",
      node.citationVelocity === null
        ? "—"
        : formatMetricValue("citation-rate", node.citationVelocity),
      "citation-rate",
    ],
    [
      "Percentile",
      formatMetricValue("citation-percentile", node.citationPercentile),
      "citation-percentile",
    ],
  ] as const;
  if (headline.every(([, value]) => value === "—")) {
    fragment.appendChild(
      detailSection(
        document,
        text(
          document,
          "p",
          "No impact metrics for this paper yet. Refresh the view to fetch them.",
          "cm-placeholder",
        ),
      ),
    );
  } else {
    const rows = element(document, "dl", "cm-metric-strip cm-metric-list");
    for (const [label, value, metric] of headline) {
      const term = text(document, "dt", label);
      term.title = getMetricDefinition(metric).description;
      rows.append(term, text(document, "dd", value));
    }
    fragment.appendChild(detailSection(document, rows));
  }
  fragment.appendChild(
    detailSection(document, advancedMetrics(document, node)),
  );
  return fragment;
}

/* -------------------------------------------------------------- import */

export function createCollectionChooser(
  document: Document,
  snapshot: LibrarySnapshot,
): { root: HTMLDivElement; selected: Set<number> } {
  const root = element(document, "div", "cm-collection-chooser");
  const selected = new Set<number>();
  const search = element(document, "input", "cm-collection-search");
  search.type = "search";
  search.placeholder = "Search collections";
  const list = element(document, "div", "cm-collection-tree");
  const render = (): void => {
    clear(list);
    const query = normalizeSearch(search.value);
    for (const collection of snapshot.collections) {
      if (query && !normalizeSearch(collection.path).includes(query)) continue;
      const label = element(document, "label", "cm-collection-choice");
      label.style.paddingInlineStart = `${collection.depth * 15 + 5}px`;
      const checkbox = element(document, "input");
      checkbox.type = "checkbox";
      checkbox.checked = selected.has(collection.collectionID);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selected.add(collection.collectionID);
        else selected.delete(collection.collectionID);
      });
      label.append(checkbox, text(document, "span", collection.name));
      list.appendChild(label);
    }
  };
  search.addEventListener("input", render);
  root.append(search, list);
  render();
  return { root, selected };
}

/**
 * Add to Zotero. With `host.collectionChooser` the button opens an area with
 * the chooser and Cancel / Add paper; without it the work is imported into no
 * collection at once. Either way `onImported` receives the new item.
 */
export function createImportArea(
  document: Document,
  work: ExternalWork,
  host: PaperDetailHost,
  onImported: (item: Zotero.Item) => void,
): { root: HTMLElement; addButton: HTMLButtonElement } {
  const root = element(document, "div", "cm-import-area");
  root.hidden = true;
  const addButton = button(document, "Add to Zotero", "cm-primary-button");
  const finish = async (collectionIDs: number[]): Promise<void> => {
    const items = await importExternalWork(
      work,
      host.snapshot.libraryID,
      collectionIDs,
    );
    const imported = items[0];
    if (!imported) throw new Error("No item was imported.");
    work.inLibraryItemKey = String(imported.key);
    root.replaceChildren(text(document, "p", "Added to Zotero.", "cm-success"));
    root.hidden = false;
    addButton.remove();
    onImported(imported);
  };
  if (!host.collectionChooser) {
    addButton.addEventListener("click", () => {
      addButton.textContent = "Adding…";
      runAction(addButton, async () => {
        try {
          await finish([]);
        } catch (error) {
          addButton.textContent = "Import failed — try again";
          throw error;
        }
      });
    });
    return { root, addButton };
  }
  // Building the chooser is deferred to the first click: a related-work list
  // can have dozens of not-yet-imported rows, and eagerly building a
  // collection tree for each one is wasted work no one may ever see.
  let chooser: { root: HTMLDivElement; selected: Set<number> } | null = null;
  const build = (): void => {
    if (chooser) return;
    chooser = createCollectionChooser(document, host.snapshot);
    const confirm = button(document, "Add paper", "cm-primary-button");
    const cancel = button(document, "Cancel", "cm-secondary-button");
    confirm.addEventListener("click", () => {
      confirm.textContent = "Adding…";
      runAction(confirm, async () => {
        try {
          await finish([...chooser!.selected]);
        } catch (error) {
          confirm.textContent = "Import failed — try again";
          throw error;
        }
      });
    });
    cancel.addEventListener("click", () => {
      root.hidden = true;
      addButton.hidden = false;
    });
    const buttons = element(document, "div", "cm-detail-actions");
    buttons.append(cancel, confirm);
    root.append(
      text(document, "h4", "Choose collections"),
      chooser.root,
      buttons,
    );
  };
  addButton.addEventListener("click", () => {
    build();
    addButton.hidden = true;
    root.hidden = false;
  });
  return { root, addButton };
}

/* ---------------------------------------------------------------- rows */

function ignoredRelationFor(
  context: RelationshipContext,
  libraryID: number,
  work: ExternalWork,
) {
  return findIgnoredRelation(
    context.ignoredIndex,
    ignoredRelationDescriptorFor(
      context.node,
      libraryID,
      context.direction,
      work,
      getCitationMetricRecord,
      context.referenceIndex,
    ),
  );
}

export function appendRelatedWorkRows(
  document: Document,
  list: HTMLElement,
  entries: readonly RelationEntry[],
  host: PaperDetailHost,
  context?: RelationshipContext,
): void {
  const libraryID = host.snapshot.libraryID;
  const paperByKey = localPaperByKey(host.snapshot);
  const subjectIsLibraryItem =
    context !== undefined &&
    context.node.kind !== "external" &&
    context.node.itemID > 0;

  for (const entry of entries) {
    const { work, manualRelation } = entry;
    const card = element(document, "article", "cm-external-card");
    if (work.isRetracted) card.classList.add("cm-external-retracted");
    const localKey = work.inLibraryItemKey ?? null;
    const localTitle = localKey
      ? paperByKey.get(localKey)?.title?.trim()
      : null;
    const title = text(document, "h3", localTitle || externalWorkTitle(work));
    if (manualRelation) {
      title.title =
        context?.direction === "references"
          ? "Reference added manually in Meristema"
          : "Citing paper added manually in Meristema";
    }
    card.appendChild(title);
    card.appendChild(
      text(document, "p", externalWorkAuthorsText(work), "cm-detail-meta"),
    );
    const metadataText = externalWorkMetadataText(
      work,
      work.recommendationScore,
    );
    if (metadataText)
      card.appendChild(text(document, "p", metadataText, "cm-detail-meta"));

    const identityRow = element(document, "div", "cm-detail-actions");
    identityRow.style.justifyContent = "space-between";
    identityRow.style.width = "100%";
    const url = externalWorkURL(work);
    if (url) {
      const link = element(document, "a");
      link.href = url;
      link.textContent = work.doi?.trim()
        ? `DOI: ${work.doi.trim()}`
        : `Open ${citationDataSourceLabel(work.provider)} record`;
      link.style.minWidth = "0";
      link.style.overflowWrap = "anywhere";
      link.addEventListener("click", (event) => {
        event.preventDefault();
        Zotero.launchURL(url);
      });
      identityRow.appendChild(link);
    }

    const actions = element(document, "div", "cm-detail-actions");
    let importArea: {
      root: HTMLElement;
      addButton: HTMLButtonElement;
    } | null = null;
    if (localKey) {
      const show = button(document, "Show in Zotero", "cm-primary-button");
      show.addEventListener("click", () => host.showInZotero(localKey));
      actions.appendChild(show);
    } else {
      importArea = createImportArea(document, work, host, () => {
        const show = button(document, "Show in Zotero", "cm-primary-button");
        show.addEventListener("click", () => {
          if (work.inLibraryItemKey) host.showInZotero(work.inLibraryItemKey);
        });
        actions.prepend(show);
      });
      actions.appendChild(importArea.addButton);
    }
    for (const action of host.rowActions?.(work) ?? []) {
      const extra = button(
        document,
        action.label,
        action.primary ? "cm-primary-button" : "cm-secondary-button",
        action.title,
      );
      extra.addEventListener("click", () =>
        runAction(extra, () => action.run()),
      );
      actions.appendChild(extra);
    }

    let activeIgnoredRelation = entry.ignoredRelation;
    const badges = element(document, "div", "cm-badges");
    const syncBadges = (): void => {
      clear(badges);
      const fresh = createBadges(document, work, {
        manual: Boolean(manualRelation),
        ignored: Boolean(activeIgnoredRelation),
      });
      if (fresh) {
        while (fresh.firstChild) badges.appendChild(fresh.firstChild);
      }
      if (badges.childElementCount) {
        if (!badges.parentElement) card.insertBefore(badges, identityRow);
      } else {
        badges.remove();
      }
    };

    if (manualRelation && context) {
      const remove = button(
        document,
        "Remove manual relation",
        "cm-secondary-button",
      );
      remove.addEventListener("click", () =>
        runAction(remove, async () => {
          await removeManualRelation(manualRelation.id);
          context.rerender();
        }),
      );
      actions.appendChild(remove);
    } else if (context && subjectIsLibraryItem && work.provider !== "manual") {
      const toggle = button(document, "", "cm-secondary-button");
      const syncToggle = (): void => {
        toggle.textContent = activeIgnoredRelation
          ? "Restore relationship"
          : "Mark incorrect";
        toggle.title = activeIgnoredRelation
          ? "Restore this relationship to the citation graph"
          : "Hide only this relationship edge from the citation graph";
      };
      toggle.addEventListener("click", () =>
        runAction(toggle, async () => {
          if (activeIgnoredRelation) {
            await removeIgnoredRelation(activeIgnoredRelation.id);
            activeIgnoredRelation = null;
          } else {
            const descriptor = ignoredRelationDescriptorFor(
              context.node,
              libraryID,
              context.direction,
              work,
              getCitationMetricRecord,
              context.referenceIndex,
            );
            await ignoreProviderRelation({
              ...descriptor,
              providerWorkID: descriptor.providerWorkID ?? "",
              doi: descriptor.doi ?? "",
              normalizedTitle: descriptor.normalizedTitle ?? "",
            });
            activeIgnoredRelation = findIgnoredRelation(
              createIgnoredRelationIndex(getIgnoredRelations(libraryID)),
              descriptor,
            );
          }
          host.clearPreview?.();
          syncToggle();
          syncBadges();
          host.onRelationshipMutation({
            origin: host.origin,
            libraryID,
            subjectItemKey: context.node.itemKey,
            direction: context.direction,
            work,
            ignored: Boolean(activeIgnoredRelation),
          });
        }),
      );
      syncToggle();
      actions.appendChild(toggle);
    }
    identityRow.appendChild(actions);
    if (importArea) card.appendChild(importArea.root);
    card.appendChild(identityRow);
    syncBadges();

    if (work.abstract) {
      const disclosure = element(document, "details", "cm-abstract-disclosure");
      disclosure.append(
        text(document, "summary", "Abstract"),
        text(document, "p", work.abstract),
      );
      card.appendChild(disclosure);
    }

    const preview = host.previewRow?.(work, context ?? null) ?? null;
    if (preview) {
      const show = (): void => {
        if (activeIgnoredRelation) host.clearPreview?.();
        else preview();
      };
      card.style.cursor = "pointer";
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.title = "Click to preview this paper on the graph";
      card.addEventListener("click", (event) => {
        const target = event.target as Element | null;
        if (target?.closest("a, button, input, select, summary")) return;
        show();
      });
      card.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        show();
      });
    }
    list.appendChild(card);
  }
}

export function manualWorkForItemKey(
  libraryID: number,
  relatedItemKey: string,
): ExternalWork | null {
  const related = (Zotero.Items as any).getByLibraryAndKey?.(
    libraryID,
    relatedItemKey,
  ) as Zotero.Item | false | undefined;
  if (!related) return null;
  const node = createMetricNodeForItem(related);
  return {
    provider: "manual",
    providerWorkID: null,
    doi: node.doi,
    title: node.title,
    year: node.year,
    authors: node.authors,
    sourceTitle: node.sourceTitle,
    abstract: null,
    citationCount: node.citationCount,
    referenceCount: node.referenceCount,
    isOpenAccess: node.isOpenAccess,
    openAccessStatus: node.openAccessStatus,
    isRetracted: node.isRetracted,
    zoteroItemKey: relatedItemKey,
    inLibraryItemKey: relatedItemKey,
  };
}

/** Manual relations for a subject, as entries the rows can draw. */
export function manualEntriesFor(
  libraryID: number,
  node: CitationGraphNode,
  direction: RelationshipViewDirection,
) {
  if (node.kind === "external" || node.itemID <= 0) return [];
  return manualRelationsForSubject(
    libraryID,
    node.itemKey,
    direction === "references" ? "reference" : "cited-by",
  ).map(({ relation, relatedItemKey }) => ({
    relation,
    work: manualWorkForItemKey(libraryID, relatedItemKey),
  }));
}

/** The entries for a relationship list, ready for `appendRelatedWorkRows`. */
export function relationshipEntries(
  libraryID: number,
  context: RelationshipContext,
  providerWorks: readonly ExternalWork[],
): RelationEntry[] {
  return mergeRelationEntries(
    manualEntriesFor(libraryID, context.node, context.direction),
    providerWorks,
    (work) => ignoredRelationFor(context, libraryID, work),
  );
}

export function relationshipContextFor(
  libraryID: number,
  node: CitationGraphNode,
  direction: RelationshipViewDirection,
  rerender: () => void,
): RelationshipContext {
  return {
    node,
    direction,
    ignoredIndex: createIgnoredRelationIndex(getIgnoredRelations(libraryID)),
    referenceIndex:
      direction === "references"
        ? createRelatedWorkLookupIndex(
            getCitationMetricRecord(libraryID, node.itemKey)?.references ?? [],
          )
        : undefined,
    rerender,
  };
}

/* ------------------------------------------------------------- similar */

export function createSimilarSection(
  document: Document,
  host: PaperDetailHost,
  load: () => Promise<ExternalWork[]>,
): { root: HTMLElement; start(): Promise<void> } {
  const root = element(document, "section", "cm-inline-similar-results");
  let generation = 0;
  const heading = (): HTMLElement => text(document, "h3", "Similar papers");
  return {
    root,
    async start() {
      const mine = ++generation;
      clear(root);
      root.append(
        heading(),
        text(document, "p", "Finding similar papers…", "cm-placeholder"),
      );
      try {
        const works = await load();
        if (mine !== generation || !root.isConnected) return;
        clear(root);
        root.appendChild(heading());
        if (!works.length) {
          root.appendChild(
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
          host,
        );
        root.appendChild(list);
      } catch (error) {
        if (mine === generation && root.isConnected) {
          clear(root);
          root.append(
            heading(),
            text(
              document,
              "p",
              "Similar-paper search failed.",
              "cm-placeholder",
            ),
          );
        }
        throw error;
      }
    },
  };
}
