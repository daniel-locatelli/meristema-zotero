import { config } from "../../package.json";
import { positiveInteger } from "../domain/valueNormalization";
import { paneSelectedLibraryID } from "./paneLibrary";
import { updateCitationDataForItems } from "./citationUpdateService";
import { multiCollectionGraphTitle } from "./graphInstancePolicy";
import { contextCollectionIDs, contextRegularItems } from "./menuContext";
import {
  fillSavedGraphPopup as fillSavedGraphRows,
  hasSavedGraphRows,
} from "./savedGraphMenu";
import { listSavedGraphs } from "./savedGraphService";
import {
  getDefaultHostWindow,
  getOpenGraphViews,
  type OpenGraphViewInfo,
  openFocusItemsInNewTab,
  openFocusItemsInView,
  openGraphForCollections,
  openNewGraphWindow,
  openSavedGraph,
  renameGraphView,
  saveGraphView,
  saveGraphViewAs,
} from "./windowService";

const registeredMenuIDs: string[] = [];
const ICON = `chrome://${config.addonRef}/content/icons/network.svg`;
const OPEN_IN_DYNAMIC_ATTR = "data-meristema-open-view";

// Menu labels do not convey what the two intents cost: showing papers only
// draws connections already in the library, while exploring fetches
// references and citing works from the providers. Tooltips cannot be used for
// this — Gecko does not render them over an open menupopup — so the hint goes
// in acceltext, the only secondary text a menuitem will draw.
const MENU_HINTS: Record<string, string> = {
  "collection-new-graph-command": "library only",
  "new-graph-view-command": "library only",
  "open-focus-view-new-tab-command": "fetches online",
};

function menuHint(l10nID: string): string | undefined {
  return MENU_HINTS[l10nID.replace(`${config.addonRef}-`, "")];
}

function applyHint(context: any, hint: string): void {
  const element = safeContextValue(context, "menuElem") as
    HTMLElement | undefined;
  element?.setAttribute("acceltext", hint);
}

type MainWindow = _ZoteroTypes.MainWindow;
type MenuData = Record<string, unknown>;

interface MenuCommandContext {
  itemIDs: number[];
  libraryID: number;
}

function register(definition: Record<string, unknown>): void {
  const manager = (Zotero as any).MenuManager;
  if (!manager?.registerMenu) {
    throw new Error(
      "Zotero.MenuManager is unavailable. Zotero 9 or later is required.",
    );
  }
  const id = manager.registerMenu(definition);
  if (id) registeredMenuIDs.push(id);
}

function safeContextValue(context: any, key: string): any {
  try {
    return context?.[key];
  } catch {
    return null;
  }
}

function contextWindow(context?: any): MainWindow {
  const menuElem = safeContextValue(context, "menuElem") as
    HTMLElement | undefined;
  const candidate =
    (menuElem as any)?.ownerGlobal ?? menuElem?.ownerDocument?.defaultView;
  if (candidate?.ZoteroPane && !candidate.closed)
    return candidate as MainWindow;
  return getDefaultHostWindow();
}

function paneForContext(context?: any): any {
  return (contextWindow(context) as any).ZoteroPane;
}

function activeLibraryID(context?: any): number {
  const pane = paneForContext(context);
  const direct = paneSelectedLibraryID(pane);
  if (direct) return direct;

  const row = pane?.getCollectionTreeRow?.() as any;
  const fromRow = positiveInteger(row?.libraryID ?? row?.ref?.libraryID);
  if (fromRow) return fromRow;

  const selected = pane?.getSelectedItems?.() ?? [];
  const fromItem = positiveInteger(selected[0]?.libraryID);
  return fromItem ?? Zotero.Libraries.userLibraryID;
}

async function activeLibraryRegularItems(
  context?: any,
): Promise<Zotero.Item[]> {
  const items = (await Zotero.Items.getAll(
    activeLibraryID(context),
  )) as Zotero.Item[];
  return items.filter((item) => item?.isRegularItem?.() && !item.deleted);
}

function itemIDs(items: readonly Zotero.Item[]): number[] {
  return items
    .map((item) => positiveInteger(item.id))
    .filter((id): id is number => id !== null);
}

function report(error: unknown): void {
  Zotero.logError(error instanceof Error ? error : new Error(String(error)));
}

function openSettings(): void {
  const internalUtilities = Zotero.Utilities.Internal as any;
  if (typeof internalUtilities?.openPreferences !== "function") {
    throw new Error("Zotero preferences could not be opened.");
  }
  const preferenceWindow = internalUtilities.openPreferences(
    `${config.addonRef}-preferences`,
  );
  preferenceWindow?.focus?.();
}

function refreshItems(items: readonly Zotero.Item[]): void {
  if (!items.length) return;
  void updateCitationDataForItems([...items], {
    force: false,
    silent: false,
  }).catch(report);
}

async function openInNewFocusView(
  command: MenuCommandContext,
  hostWindow: MainWindow,
): Promise<void> {
  if (!command.itemIDs.length) return;
  await openFocusItemsInNewTab(command.itemIDs, hostWindow);
}

async function exploreInExistingView(
  view: OpenGraphViewInfo,
  command: MenuCommandContext,
  hostWindow: MainWindow,
): Promise<void> {
  if (!command.itemIDs.length) return;
  await openFocusItemsInView(view.instanceID, command.itemIDs, hostWindow);
}

function commandItem(
  l10nID: string,
  run: (context: any) => Promise<void> | void,
  l10nArgs?: Record<string, unknown>,
): MenuData {
  const hint = menuHint(l10nID);
  return {
    menuType: "menuitem",
    l10nID,
    ...(l10nArgs ? { l10nArgs: JSON.stringify(l10nArgs) } : {}),
    ...(hint
      ? {
          onShowing: (_event: Event, context: any) => {
            applyHint(context, hint);
          },
        }
      : {}),
    onCommand: (_event: Event, context: any) => {
      void Promise.resolve(run(context)).catch(report);
    },
  };
}

function itemCommand(context: any): MenuCommandContext {
  const items = contextRegularItems(context);
  return {
    itemIDs: itemIDs(items),
    libraryID: positiveInteger(items[0]?.libraryID) ?? activeLibraryID(context),
  };
}

function contextCommandItem(
  l10nID: string,
  isAvailable: (context: any) => boolean,
  run: (context: any) => Promise<void> | void,
  onShown?: (context: any) => void,
): MenuData {
  const hint = menuHint(l10nID);
  return {
    menuType: "menuitem",
    l10nID,
    icon: ICON,
    onShowing: (_event: Event, context: any) => {
      const available = isAvailable(context);
      context.setVisible(available);
      context.setEnabled(available);
      if (!available) return;
      if (hint) applyHint(context, hint);
      onShown?.(context);
    },
    onCommand: (_event: Event, context: any) => {
      void Promise.resolve(run(context)).catch(report);
    },
  };
}

// The item context menu is deliberately flat: every Meristema action sits
// directly in Zotero's own menu, identified by its icon rather than by a
// parent labelled "Meristema". "Add to" is the one exception, because it
// groups a row per open graph and the count of those is not known until the
// menu is showing.
function itemMenus(): MenuData[] {
  const hasItems = (context: any): boolean =>
    contextRegularItems(context).length > 0;
  return [
    contextCommandItem(
      `${config.addonRef}-open-focus-view-new-tab-command`,
      hasItems,
      async (context) => {
        await openInNewFocusView(itemCommand(context), contextWindow(context));
      },
      (context) => {
        const command = itemCommand(context);
        context.setL10nArgs(JSON.stringify({ count: command.itemIDs.length }));
      },
    ),
    addToSubmenu(),
  ];
}

/**
 * One row per open graph. The rows cannot be declared up front — how many
 * graphs are open is only known while the menu is showing — so the popup is
 * filled on `onShowing` and emptied again on `popuphidden`, the same shape the
 * saved-graph submenu uses.
 */
function addToSubmenu(): MenuData {
  return {
    menuType: "submenu",
    l10nID: `${config.addonRef}-add-to-submenu`,
    icon: ICON,
    onShowing: (_event: Event, context: any) => {
      const available = contextRegularItems(context).length > 0;
      context.setVisible(available);
      context.setEnabled(available);
      if (!available) return;
      const menuElem = safeContextValue(context, "menuElem") as
        HTMLElement | undefined;
      const popup =
        menuElem?.localName === "menupopup"
          ? menuElem
          : (menuElem?.querySelector("menupopup") as HTMLElement | null);
      if (!popup) return;
      const hostWindow = contextWindow(context);
      const command = itemCommand(context);
      const document = popup.ownerDocument as any;
      popup
        .querySelectorAll(`[${OPEN_IN_DYNAMIC_ATTR}="add-to"]`)
        .forEach((node) => node.remove());
      for (const view of getOpenGraphViews(hostWindow)) {
        const item = document.createXULElement("menuitem");
        item.setAttribute(OPEN_IN_DYNAMIC_ATTR, "add-to");
        item.setAttribute("class", "menuitem-iconic");
        item.setAttribute("image", ICON);
        item.setAttribute(
          "label",
          view.active ? `✓ ${view.title}` : view.title,
        );
        item.setAttribute("acceltext", "adds as seeds");
        item.addEventListener(
          "command",
          () => {
            void exploreInExistingView(view, command, hostWindow).catch(report);
          },
          { once: true },
        );
        popup.appendChild(item);
      }
      popup.addEventListener(
        "popuphidden",
        () => {
          popup
            .querySelectorAll(`[${OPEN_IN_DYNAMIC_ATTR}="add-to"]`)
            .forEach((node) => node.remove());
        },
        { once: true },
      );
    },
    menus: [
      {
        menuType: "menuitem",
        l10nID: `${config.addonRef}-add-to-empty-command`,
        onShowing: (_event: Event, context: any) => {
          context.setEnabled(false);
          const entry = safeContextValue(context, "menuElem") as
            HTMLElement | undefined;
          const popup = entry?.parentElement;
          if (!popup) return;
          context.setVisible(
            popup.querySelectorAll(`[${OPEN_IN_DYNAMIC_ATTR}="add-to"]`)
              .length === 0,
          );
        },
      },
    ],
  };
}

// A folder opens as a collection-scoped graph rather than as a bag of item
// IDs: `openGraphForCollections` drives the graph's own collection filter, so
// the scope follows the folder as papers are added to it and subcollections
// come along. Open views are not offered: that filter is a scope, not an
// addition, so showing a folder in an existing graph could only replace what
// it was showing, and a graph is re-scoped from inside it with filters and
// seeds anyway.
function collectionMenus(): MenuData[] {
  // The label names the folders rather than the feature: right-clicking PhD
  // offers "New PhD Graph", and three folders offer "New Graph from 3
  // Folders". Which it is is only known while the menu is showing, so both the
  // name and the count travel as l10n arguments.
  const scope = (
    context: any,
  ): { collectionIDs: number[]; title: string } | null => {
    const collectionIDs = contextCollectionIDs(context);
    if (!collectionIDs.length) return null;
    const title = multiCollectionGraphTitle(
      collectionIDs.map(
        (collectionID) => (Zotero.Collections.get(collectionID) as any)?.name,
      ),
    );
    return title === null ? null : { collectionIDs, title };
  };

  return [
    contextCommandItem(
      `${config.addonRef}-collection-new-graph-command`,
      (context) => scope(context) !== null,
      async (context) => {
        const target = scope(context);
        if (!target) return;
        await openGraphForCollections(
          target.collectionIDs,
          contextWindow(context),
          { newInstance: true },
        );
      },
      (context) => {
        const target = scope(context);
        if (!target) return;
        context.setL10nArgs(
          JSON.stringify({
            graph: target.title,
            count: target.collectionIDs.length,
          }),
        );
      },
    ),
  ];
}

// Row building lives in savedGraphMenu.ts, which knows nothing of Zotero, so
// the first-showing behaviour is unit-tested; this only supplies the DOM,
// the listing and the open action.
function fillSavedGraphPopup(
  popup: HTMLElement,
  libraryID: number,
  hostWindow: MainWindow,
): Promise<void> {
  const document = popup.ownerDocument as any;
  return fillSavedGraphRows(popup as any, {
    list: () => listSavedGraphs(libraryID),
    createRow: () => {
      const item = document.createXULElement("menuitem");
      item.setAttribute("image", ICON);
      return item;
    },
    open: (graph) => {
      void openSavedGraph(graph.id, hostWindow)
        .then((result) => {
          if (result === "deleted") {
            (hostWindow as any).alert?.("This graph was deleted.");
          }
        })
        .catch(report);
    },
    formatModified: (iso) =>
      new Date(iso).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      }),
  });
}

function openSavedGraphSubmenu(): MenuData {
  return {
    menuType: "submenu",
    l10nID: `${config.addonRef}-open-saved-graph-submenu`,
    icon: ICON,
    onShowing: (_event: Event, context: any) => {
      const menuElem = safeContextValue(context, "menuElem") as
        HTMLElement | undefined;
      const popup =
        menuElem?.localName === "menupopup"
          ? menuElem
          : (menuElem?.querySelector("menupopup") as HTMLElement | null);
      if (!popup) return;
      void fillSavedGraphPopup(
        popup,
        activeLibraryID(context),
        contextWindow(context),
      ).catch(report);
    },
    menus: [
      {
        menuType: "menuitem",
        l10nID: `${config.addonRef}-open-saved-graph-empty-command`,
        onShowing: (_event: Event, context: any) => {
          context.setEnabled(false);
          // Created on the submenu's first showing, after the fill above has
          // usually already run, so decide visibility from the rows present.
          const entry = safeContextValue(context, "menuElem") as
            HTMLElement | undefined;
          const popup = entry?.parentElement;
          if (popup) context.setVisible(!hasSavedGraphRows(popup as any));
        },
      },
    ],
  };
}

/**
 * Save and Save as… act on the active graph. With no graph tab open there is
 * nothing to save, so the entry is disabled rather than absent: a command that
 * comes and goes is harder to find than one that is greyed.
 */
function graphStateCommand(
  l10nID: string,
  run: (view: OpenGraphViewInfo, hostWindow: MainWindow) => Promise<unknown>,
): MenuData {
  return {
    menuType: "menuitem",
    l10nID,
    icon: ICON,
    onShowing: (_event: Event, context: any) => {
      const active = getOpenGraphViews(contextWindow(context)).find(
        (view) => view.active,
      );
      context.setEnabled(Boolean(active));
    },
    onCommand: (_event: Event, context: any) => {
      const hostWindow = contextWindow(context);
      const active = getOpenGraphViews(hostWindow).find((view) => view.active);
      if (!active) return;
      void Promise.resolve(run(active, hostWindow)).catch(report);
    },
  };
}

function toolsSubmenu(): MenuData {
  return {
    menuType: "submenu",
    l10nID: `${config.addonRef}-tools-submenu`,
    icon: ICON,
    menus: [
      commandItem(`${config.addonRef}-new-graph-view-command`, (context) =>
        openNewGraphWindow(contextWindow(context), activeLibraryID(context)),
      ),
      openSavedGraphSubmenu(),
      graphStateCommand(`${config.addonRef}-save-command`, (view, win) =>
        saveGraphView(view.instanceID, win),
      ),
      graphStateCommand(`${config.addonRef}-save-as-command`, (view, win) =>
        saveGraphViewAs(view.instanceID, win),
      ),
      { menuType: "separator" },
      commandItem(
        `${config.addonRef}-refresh-library-command`,
        async (context) => {
          refreshItems(await activeLibraryRegularItems(context));
        },
      ),
      commandItem(`${config.addonRef}-refresh-command`, (context) => {
        refreshItems(contextRegularItems(context));
      }),
      { menuType: "separator" },
      commandItem(`${config.addonRef}-settings-command`, () => {
        openSettings();
      }),
    ],
  };
}

// Zotero appends "Show in Library" to every tab context menu except the
// library tab's, and wires it to ZoteroPane.selectItem(tab.data.itemID). A
// graph tab carries no itemID, so the entry is inert — clicking it does
// nothing. Hide it rather than leave a dead command sitting on our tabs.
//
// This runs from onShowing, which MenuManager calls after tabs.js has appended
// the native entries, so they are present to be found. Nothing is restored
// afterwards because nothing needs to be: tabs.js builds the popup fresh on
// every open and removes it again on popuphidden.
function hideInertTabEntries(context: any): void {
  const anchor = safeContextValue(context, "menuElem") as
    HTMLElement | undefined;
  const popup = anchor?.parentElement as HTMLElement | null | undefined;
  if (!popup) return;
  let label: string;
  try {
    label = String((Zotero as any).getString("general.showInLibrary"));
  } catch {
    return;
  }
  for (const node of Array.from(popup.children)) {
    const element = node as HTMLElement;
    if (
      element.localName === "menuitem" &&
      element.getAttribute("label") === label
    ) {
      element.hidden = true;
    }
  }
}

function tabRenameItem(): MenuData {
  return {
    menuType: "menuitem",
    l10nID: `${config.addonRef}-rename-view-command`,
    onShowing: (_event: Event, context: any) => {
      const tabType = String(
        safeContextValue(context, "tabType") ?? "",
      ).replace(/-unloaded$/, "");
      const isGraphTab = tabType === config.addonRef;
      context.setVisible(isGraphTab);
      context.setEnabled(isGraphTab);
      if (isGraphTab) hideInertTabEntries(context);
    },
    onCommand: (_event: Event, context: any) => {
      const tabID = String(safeContextValue(context, "tabID") ?? "");
      if (!tabID || tabID === "zotero-pane") return;
      const hostWindow = contextWindow(context);
      const current = getOpenGraphViews(hostWindow).find(
        (view) => view.tabID === tabID,
      );
      if (!current) return;
      // Services.prompt gives the dialog a real title; window.prompt would
      // title it "[JavaScript Application]".
      const value = { value: current.title };
      const accepted = Services.prompt.prompt(
        hostWindow as unknown as mozIDOMWindowProxy,
        "Meristema",
        "Rename view",
        value,
        "",
        { value: false },
      );
      if (!accepted) return;
      const normalized = String(value.value ?? "").trim();
      if (!normalized) return;
      try {
        renameGraphView(tabID, normalized, hostWindow);
      } catch (error) {
        report(error);
      }
    },
  };
}

export function registerMenus(): void {
  if (registeredMenuIDs.length) return;
  register({
    menuID: "meristema-tools-menu",
    pluginID: config.addonID,
    target: "main/menubar/tools",
    menus: [toolsSubmenu()],
  });
  register({
    menuID: "meristema-item-context-menu",
    pluginID: config.addonID,
    target: "main/library/item",
    menus: itemMenus(),
  });
  register({
    menuID: "meristema-collection-context-menu",
    pluginID: config.addonID,
    target: "main/library/collection",
    menus: collectionMenus(),
  });
  register({
    menuID: "meristema-tab-context-menu",
    pluginID: config.addonID,
    target: "main/tab",
    menus: [tabRenameItem()],
  });
}

export function unregisterMenus(): void {
  const manager = (Zotero as any).MenuManager;
  for (const id of registeredMenuIDs.splice(0)) {
    try {
      manager?.unregisterMenu?.(id);
    } catch (error) {
      Zotero.debug(
        `Meristema: failed to unregister menu ${id}: ${String(error)}`,
      );
    }
  }
}
