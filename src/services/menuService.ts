import { config } from "../../package.json";
import { positiveInteger } from "../domain/valueNormalization";
import { updateCitationDataForItems } from "./citationUpdateService";
import {
  getDefaultHostWindow,
  getOpenGraphViews,
  type OpenGraphViewInfo,
  openGraphAndSelectItemsInNewTab,
  openGraphAndSelectItemsInView,
  openFocusItemsInNewTab,
  openFocusItemsInView,
  openGraphInView,
  openNewFocusWindow,
  openNewGraphWindow,
  renameGraphView,
} from "./windowService";
import { loadWholeLibrary } from "./zoteroLibraryService";

const registeredMenuIDs: string[] = [];
const ICON = `chrome://${config.addonRef}/content/icons/network.svg`;
const OPEN_IN_DYNAMIC_ATTR = "data-meristema-open-view";

// Menu labels do not convey the difference between the two views: a Citation
// Map only draws connections between papers already in the library, while a
// Focus View fetches references and citing works from the providers. Tooltips
// cannot be used for this — Gecko does not render them over an open menupopup —
// so the hint goes in acceltext, the only secondary text a menuitem will draw.
const MENU_HINTS: Record<string, string> = {
  "show-items-command": "library only",
  "show-items-new-tab-command": "library only",
  "new-graph-view-command": "library only",
  "open-focus-view-command": "fetches online",
  "open-focus-view-new-tab-command": "fetches online",
  "new-focus-view-command": "fetches online",
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
  collectionID: number | null;
  libraryID: number;
}

type MenuContextResolver = (
  context: any,
) => Promise<MenuCommandContext> | MenuCommandContext;

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
  const direct = positiveInteger(pane?.getSelectedLibraryID?.());
  if (direct) return direct;

  const row = pane?.getCollectionTreeRow?.() as any;
  const fromRow = positiveInteger(row?.libraryID ?? row?.ref?.libraryID);
  if (fromRow) return fromRow;

  const selected = pane?.getSelectedItems?.() ?? [];
  const fromItem = positiveInteger(selected[0]?.libraryID);
  return fromItem ?? Zotero.Libraries.userLibraryID;
}

function selectedRegularItems(context: any): Zotero.Item[] {
  const contextual = Array.isArray(context?.items) ? context.items : [];
  const selected = paneForContext(context)?.getSelectedItems?.() ?? [];
  return (contextual.length ? contextual : selected).filter(
    (item: Zotero.Item) => item?.isRegularItem?.() && !item.deleted,
  );
}

function selectedCollection(context?: any): any | null {
  const pane = paneForContext(context);
  const candidates = [
    safeContextValue(context, "collection"),
    safeContextValue(context, "collectionTreeRow"),
    safeContextValue(context, "row"),
    pane?.getCollectionTreeRow?.(),
    pane?.getSelectedCollection?.(),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (
      typeof candidate.isCollection === "function" &&
      !candidate.isCollection()
    ) {
      continue;
    }
    const ref = candidate.ref ?? candidate.collection ?? candidate;
    const collectionID = positiveInteger(
      ref.collectionID ?? ref.id ?? candidate.collectionID ?? candidate.id,
    );
    if (!collectionID) continue;
    const collection = Zotero.Collections.get(collectionID) as any;
    if (collection) return collection;
  }
  return null;
}

async function activeLibraryRegularItems(
  context?: any,
): Promise<Zotero.Item[]> {
  const items = (await Zotero.Items.getAll(
    activeLibraryID(context),
  )) as Zotero.Item[];
  return items.filter((item) => item?.isRegularItem?.() && !item.deleted);
}

async function collectionRegularItems(collection: any): Promise<Zotero.Item[]> {
  const collectionID = positiveInteger(
    collection?.id ?? collection?.collectionID,
  );
  const libraryID = positiveInteger(collection?.libraryID);
  if (!collectionID || !libraryID) return [];
  const snapshot = await loadWholeLibrary(libraryID);
  const descriptor = snapshot.collections.find(
    (entry) => entry.collectionID === collectionID,
  );
  const included = new Set(
    descriptor?.includedCollectionIDs?.length
      ? descriptor.includedCollectionIDs
      : [collectionID],
  );
  return snapshot.papers
    .filter((paper) =>
      paper.collectionIDs.some((candidate) => included.has(candidate)),
    )
    .map((paper) => Zotero.Items.get(paper.itemID) as Zotero.Item | null)
    .filter((item): item is Zotero.Item =>
      Boolean(item?.isRegularItem?.() && !item.deleted),
    );
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

async function focusItemIDs(command: MenuCommandContext): Promise<number[]> {
  if (command.itemIDs.length) return command.itemIDs;
  if (!command.collectionID) return [];
  const collection = Zotero.Collections.get(command.collectionID) as any;
  return collection ? itemIDs(await collectionRegularItems(collection)) : [];
}

async function openInNewMap(
  command: MenuCommandContext,
  hostWindow: MainWindow,
): Promise<void> {
  if (command.itemIDs.length) {
    await openGraphAndSelectItemsInNewTab(command.itemIDs, hostWindow);
    return;
  }
  if (command.collectionID) {
    const ids = await focusItemIDs(command);
    if (ids.length) {
      await openGraphAndSelectItemsInNewTab(ids, hostWindow);
      return;
    }
  }
  await openNewGraphWindow(hostWindow, command.libraryID);
}

async function openInNewFocusView(
  command: MenuCommandContext,
  hostWindow: MainWindow,
): Promise<void> {
  const ids = await focusItemIDs(command);
  if (!ids.length) return;
  await openFocusItemsInNewTab(ids, hostWindow);
}

async function openInExistingView(
  view: OpenGraphViewInfo,
  command: MenuCommandContext,
  hostWindow: MainWindow,
): Promise<void> {
  if (view.kind === "focus") {
    const ids = await focusItemIDs(command);
    if (!ids.length) return;
    await openFocusItemsInView(view.instanceID, ids, hostWindow);
    return;
  }
  if (command.itemIDs.length) {
    await openGraphAndSelectItemsInView(
      view.instanceID,
      command.itemIDs,
      hostWindow,
    );
    return;
  }
  if (command.collectionID) {
    const ids = await focusItemIDs(command);
    if (ids.length) {
      await openGraphAndSelectItemsInView(view.instanceID, ids, hostWindow);
      return;
    }
  }
  await openGraphInView(view.instanceID, hostWindow, command.libraryID);
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

function injectOpenViewItems(context: any, resolve: MenuContextResolver): void {
  const anchor = safeContextValue(context, "menuElem") as
    HTMLElement | undefined;
  const popup = anchor?.parentElement as HTMLElement | null | undefined;
  if (!anchor || !popup) return;

  const clear = (): void => {
    popup
      .querySelectorAll(`[${OPEN_IN_DYNAMIC_ATTR}]`)
      .forEach((node) => node.remove());
  };
  clear();

  const hostWindow = contextWindow(context);
  const openViews = getOpenGraphViews(hostWindow);
  if (!openViews.length) return;

  const document = popup.ownerDocument as any;
  let previous: HTMLElement = anchor;
  for (const view of openViews) {
    const item = document.createXULElement("menuitem");
    item.setAttribute(OPEN_IN_DYNAMIC_ATTR, "true");
    item.setAttribute("class", "menuitem-iconic");
    item.setAttribute("image", ICON);
    item.setAttribute("label", view.active ? `✓ ${view.title}` : view.title);
    item.setAttribute(
      "acceltext",
      view.kind === "focus" ? "add as seeds" : "add to graph",
    );
    item.addEventListener(
      "command",
      () => {
        void Promise.resolve(resolve(context))
          .then((command) => openInExistingView(view, command, hostWindow))
          .catch(report);
      },
      { once: true },
    );
    previous.after(item);
    previous = item;
  }
  popup.addEventListener("popuphidden", clear, { once: true });
}

function itemResolver(context: any): MenuCommandContext {
  const items = selectedRegularItems(context);
  return {
    itemIDs: itemIDs(items),
    collectionID: null,
    libraryID: positiveInteger(items[0]?.libraryID) ?? activeLibraryID(context),
  };
}

function collectionResolver(context: any): MenuCommandContext {
  const collection = selectedCollection(context);
  return {
    itemIDs: [],
    collectionID: positiveInteger(collection?.id ?? collection?.collectionID),
    libraryID:
      positiveInteger(collection?.libraryID) ?? activeLibraryID(context),
  };
}

function contextCommandItem(
  l10nID: string,
  run: (context: any) => Promise<void> | void,
  isAvailable: (context: any) => boolean,
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

// The context menus are deliberately flat: every Meristema action sits
// directly in Zotero's own menu, identified by its icon rather than by a
// parent labelled "Meristema". The open-view entries are injected as siblings
// because their number is only known while the menu is showing.
function contextMenus(
  resolve: MenuContextResolver,
  isAvailable: (context: any) => boolean,
  refresh: (context: any) => Promise<void> | void,
): MenuData[] {
  return [
    contextCommandItem(
      `${config.addonRef}-show-items-new-tab-command`,
      async (context) => {
        await openInNewMap(
          await Promise.resolve(resolve(context)),
          contextWindow(context),
        );
      },
      isAvailable,
    ),
    contextCommandItem(
      `${config.addonRef}-open-focus-view-new-tab-command`,
      async (context) => {
        await openInNewFocusView(
          await Promise.resolve(resolve(context)),
          contextWindow(context),
        );
      },
      isAvailable,
      (context) => injectOpenViewItems(context, resolve),
    ),
    contextCommandItem(
      `${config.addonRef}-refresh-command`,
      refresh,
      isAvailable,
    ),
  ];
}

function itemMenus(): MenuData[] {
  return contextMenus(
    itemResolver,
    (context) => selectedRegularItems(context).length > 0,
    (context) => {
      refreshItems(selectedRegularItems(context));
    },
  );
}

function collectionMenus(): MenuData[] {
  return contextMenus(
    collectionResolver,
    (context) => Boolean(selectedCollection(context)),
    async (context) => {
      const collection = selectedCollection(context);
      if (collection) refreshItems(await collectionRegularItems(collection));
    },
  );
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
      commandItem(`${config.addonRef}-new-focus-view-command`, (context) =>
        openNewFocusWindow(contextWindow(context), activeLibraryID(context)),
      ),
      commandItem(
        `${config.addonRef}-refresh-library-command`,
        async (context) => {
          refreshItems(await activeLibraryRegularItems(context));
        },
      ),
      { menuType: "separator" },
      commandItem(`${config.addonRef}-settings-command`, () => {
        openSettings();
      }),
    ],
  };
}

function tabRenameItem(): MenuData {
  return {
    menuType: "menuitem",
    l10nID: `${config.addonRef}-rename-view-command`,
    onShowing: (_event: Event, context: any) => {
      const tabType = String(
        safeContextValue(context, "tabType") ?? "",
      ).replace(/-unloaded$/, "");
      context.setVisible(tabType === config.addonRef);
      context.setEnabled(tabType === config.addonRef);
    },
    onCommand: (_event: Event, context: any) => {
      const tabID = String(safeContextValue(context, "tabID") ?? "");
      if (!tabID || tabID === "zotero-pane") return;
      const hostWindow = contextWindow(context);
      const current = getOpenGraphViews(hostWindow).find(
        (view) => view.tabID === tabID,
      );
      if (!current) return;
      const next = (hostWindow as any).prompt?.(
        "Rename Meristema view",
        current.title,
      );
      if (next === null || next === undefined) return;
      const normalized = String(next).trim();
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
