import { config } from "../../package.json";
import { positiveInteger } from "../domain/valueNormalization";
import { updateCitationDataForItems } from "./citationUpdateService";
import { contextRegularItems } from "./menuContext";
import {
  getDefaultHostWindow,
  getOpenGraphViews,
  type OpenGraphViewInfo,
  openGraphAndSelectItemsInNewTab,
  openGraphAndSelectItemsInView,
  openFocusItemsInNewTab,
  openFocusItemsInView,
  openNewFocusWindow,
  openNewGraphWindow,
  renameGraphView,
} from "./windowService";

const registeredMenuIDs: string[] = [];
const ICON = `chrome://${config.addonRef}/content/icons/network.svg`;
const OPEN_IN_DYNAMIC_ATTR = "data-meristema-open-view";

// Menu labels do not convey the difference between the two views: a Citation
// Map only draws connections between papers already in the library, while a
// Focus View fetches references and citing works from the providers. Tooltips
// cannot be used for this — Gecko does not render them over an open menupopup —
// so the hint goes in acceltext, the only secondary text a menuitem will draw.
const MENU_HINTS: Record<string, string> = {
  "show-items-new-tab-command": "library only",
  "new-graph-view-command": "library only",
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
  const direct = positiveInteger(pane?.getSelectedLibraryID?.());
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

async function openInNewMap(
  command: MenuCommandContext,
  hostWindow: MainWindow,
): Promise<void> {
  if (!command.itemIDs.length) return;
  await openGraphAndSelectItemsInNewTab(command.itemIDs, hostWindow);
}

async function openInNewFocusView(
  command: MenuCommandContext,
  hostWindow: MainWindow,
): Promise<void> {
  if (!command.itemIDs.length) return;
  await openFocusItemsInNewTab(command.itemIDs, hostWindow);
}

async function openInExistingView(
  view: OpenGraphViewInfo,
  command: MenuCommandContext,
  hostWindow: MainWindow,
): Promise<void> {
  if (!command.itemIDs.length) return;
  if (view.kind === "focus") {
    await openFocusItemsInView(view.instanceID, command.itemIDs, hostWindow);
    return;
  }
  await openGraphAndSelectItemsInView(
    view.instanceID,
    command.itemIDs,
    hostWindow,
  );
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

function injectOpenViewItems(context: any): void {
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
        void openInExistingView(view, itemCommand(context), hostWindow).catch(
          report,
        );
      },
      { once: true },
    );
    previous.after(item);
    previous = item;
  }
  popup.addEventListener("popuphidden", clear, { once: true });
}

function contextCommandItem(
  l10nID: string,
  run: (context: any) => Promise<void> | void,
  onShown?: (context: any) => void,
): MenuData {
  const hint = menuHint(l10nID);
  return {
    menuType: "menuitem",
    l10nID,
    icon: ICON,
    onShowing: (_event: Event, context: any) => {
      const available = contextRegularItems(context).length > 0;
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
// parent labelled "Meristema". The open-view entries are injected as siblings
// because their number is only known while the menu is showing.
function itemMenus(): MenuData[] {
  return [
    contextCommandItem(
      `${config.addonRef}-show-items-new-tab-command`,
      async (context) => {
        await openInNewMap(itemCommand(context), contextWindow(context));
      },
    ),
    contextCommandItem(
      `${config.addonRef}-open-focus-view-new-tab-command`,
      async (context) => {
        await openInNewFocusView(itemCommand(context), contextWindow(context));
      },
      injectOpenViewItems,
    ),
    contextCommandItem(`${config.addonRef}-refresh-command`, (context) => {
      refreshItems(contextRegularItems(context));
    }),
  ];
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
