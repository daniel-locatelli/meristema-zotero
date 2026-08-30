# Collection Context Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Right-clicking a folder in Zotero's collection tree offers to open that folder's papers in a Collection Graph, and nothing appears on rows that are not folders.

**Architecture:** The graph already supports collection scoping end to end — `windowService.openGraphForCollection()` exists and is currently unused, and it drives `graphFilter.setCollectionID()`, the same live filter the graph's own dropdown drives (subcollections included via `includedCollectionIDs`). This work is wiring: extract the two menu-context predicates into a pure, unit-testable module; widen two seams in `menuService.ts` so a second context menu can reuse them; register the collection menu.

**Tech Stack:** TypeScript, Zotero 9 `Zotero.MenuManager` plugin API, XUL menu elements, Mocha + Chai run inside Zotero via `zotero-plugin test`.

## Global Constraints

- **The menu context is the only source of truth about the right-clicked row.** Never read `ZoteroPane.getSelectedItems()`, `getSelectedCollection()` or `getCollectionTreeRow()` to decide whether a menu entry applies. That fallback is what made the entries appear on every row. `activeLibraryID()` may still consult the pane — it answers "which library is the user in", not "what was right-clicked".
- Target Zotero 9 or later; `Zotero.MenuManager` is required and `register()` already throws without it.
- No new `.ftl` strings. The folder entry reuses `show-items-new-tab-command` ("Open in New Collection Graph").
- Folders get the graph action only. No Explore (focus) entry, no Refresh entry.
- Every commit must pass `npx eslint .` and `npm run typecheck` clean. `npm run check` also runs Prettier across the repo and currently fails on an untracked `prefs.js` in the repo root that is not part of this work — run the two commands separately, plus `npx prettier --check` on the files you touched.
- Commit messages: sentence-case subject describing the behaviour change, no `feat:`/`fix:` prefixes (match the existing log). End every commit message with the two trailer lines used by the previous two commits on this branch (`Co-Authored-By:` and `Claude-Session:`); copy them verbatim from `git log -1 --format=%B HEAD`.
- Work on branch `collection-context-menu`, which already carries the spec (`cfa7af2`) and the menu-visibility fix (`9b0dc61`).

---

## File Structure

| File                                                                                       | Responsibility                                                                                                                  |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `src/services/menuContext.ts` (**create**)                                                 | Pure predicates reading a Zotero menu context. No Zotero globals, no DOM. The single place that decides what was right-clicked. |
| `src/services/menuService.ts` (**modify**)                                                 | Menu construction and registration only. Imports its predicates from `menuContext.ts`.                                          |
| `test/architecture.test.ts` (**modify**)                                                   | Unit tests for the predicates, appended as new `it(...)` blocks inside the existing `describe("Architecture foundations")`.     |
| `docs/superpowers/specs/2026-08-28-collection-context-menu-design.md` (**modify**, Task 4) | Status flips to `implemented`.                                                                                                  |

`src/services/windowService.ts` is **not** modified. `openGraphForCollection` is used exactly as it stands.

---

## Task 1: Extract the menu-context predicates and test them

This task moves existing behaviour into a testable module and adds the regression suite for the bug fixed in `9b0dc61`. It also adds `contextCollectionID`, which Task 3 consumes.

**Files:**

- Create: `src/services/menuContext.ts`
- Modify: `src/services/menuService.ts` (delete the local `contextRegularItems`, currently lines 98–109, and import instead)
- Test: `test/architecture.test.ts`

**Interfaces:**

- Consumes: `positiveInteger` from `../domain/valueNormalization` — signature `positiveInteger(value: unknown): number | null`, returning `null` for zero, negatives, non-integers and non-numbers.
- Produces:
  - `contextRegularItems(context: any): Zotero.Item[]`
  - `contextCollectionID(context: any): number | null`

- [ ] **Step 1: Write the failing tests**

Append these two `it(...)` blocks to `test/architecture.test.ts`, immediately before the file's final `});` (currently line 1573, which closes `describe("Architecture foundations")`).

```typescript
it("reads right-clicked items only from the menu context", function () {
  const paper = { isRegularItem: () => true, deleted: false, id: 11 };
  const trashedPaper = { isRegularItem: () => true, deleted: true, id: 12 };
  const note = { isRegularItem: () => false, deleted: false, id: 13 };

  expect(
    contextRegularItems({ items: [paper, note, trashedPaper] }),
  ).to.deep.equal([paper]);
  expect(contextRegularItems({ items: [note] })).to.deep.equal([]);
  expect(contextRegularItems({ items: [] })).to.deep.equal([]);
  expect(contextRegularItems({})).to.deep.equal([]);
  expect(contextRegularItems(null)).to.deep.equal([]);

  // A context that throws on property access must not take the menu down.
  const hostile = new Proxy(
    {},
    {
      get() {
        throw new Error("context property is unavailable");
      },
    },
  );
  expect(contextRegularItems(hostile)).to.deep.equal([]);

  // The predicate must never reach for the pane. A pane offering a paper
  // must not rescue a context that was right-clicked on a note.
  const withPane = {
    items: [note],
    ZoteroPane: { getSelectedItems: () => [paper] },
  };
  expect(contextRegularItems(withPane)).to.deep.equal([]);
});

it("treats only real collection rows as folders", function () {
  const collectionRow = {
    isCollection: () => true,
    ref: { id: 42, libraryID: 1 },
  };
  expect(contextCollectionID({ collectionTreeRow: collectionRow })).to.equal(
    42,
  );

  // Every other row type in the collection tree fails the predicate. These
  // are the rows the menu used to appear on.
  for (const row of [
    { isCollection: () => false, ref: { libraryID: 1 } }, // My Library / group root
    { isCollection: () => false, ref: { id: 7 } }, // saved search
    { isCollection: () => false, ref: {} }, // Trash, Unfiled, Duplicates
  ]) {
    expect(contextCollectionID({ collectionTreeRow: row })).to.equal(null);
  }

  // A collection row with no usable ID is not a folder either.
  expect(
    contextCollectionID({
      collectionTreeRow: { isCollection: () => true, ref: {} },
    }),
  ).to.equal(null);
  expect(
    contextCollectionID({
      collectionTreeRow: { isCollection: () => true, ref: { id: 0 } },
    }),
  ).to.equal(null);

  // A row that is not a tree row at all.
  expect(contextCollectionID({ collectionTreeRow: {} })).to.equal(null);
  expect(contextCollectionID({})).to.equal(null);
  expect(contextCollectionID(null)).to.equal(null);

  // No pane fallback: a selected collection elsewhere must not make a
  // library row look like a folder.
  const withPane = {
    collectionTreeRow: { isCollection: () => false, ref: { libraryID: 1 } },
    ZoteroPane: {
      getSelectedCollection: () => ({ id: 42 }),
      getCollectionTreeRow: () => collectionRow,
    },
  };
  expect(contextCollectionID(withPane)).to.equal(null);
});
```

Add the import to the top of `test/architecture.test.ts`, alongside the other `src/services/*` imports (they sit around lines 28–36):

```typescript
import {
  contextCollectionID,
  contextRegularItems,
} from "../src/services/menuContext";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`

Expected: the build step fails before Mocha runs, because `../src/services/menuContext` does not exist. The message names the missing module. That is the correct failure for this step — do not proceed until you have seen it.

- [ ] **Step 3: Write the implementation**

Create `src/services/menuContext.ts` with exactly this content:

```typescript
import { positiveInteger } from "../domain/valueNormalization";

// Everything in this module answers one question: what did the user
// right-click? The answer comes from the menu context Zotero hands to
// `onShowing` and from nowhere else.
//
// Reading `ZoteroPane` here is what broke the menus before. When the
// right-clicked row was not a collection, or held no regular items, a pane
// fallback answered with whatever happened to be selected elsewhere and
// reported the entries available — so they appeared on My Library, Trash,
// Unfiled Items, saved searches, group roots, notes and attachments alike.
// These predicates take no fallback. An unrecognised row is not a match.

function contextValue(context: any, key: string): any {
  try {
    return context?.[key];
  } catch {
    return null;
  }
}

/** The regular, untrashed items the user right-clicked. */
export function contextRegularItems(context: any): Zotero.Item[] {
  const items = contextValue(context, "items");
  if (!Array.isArray(items)) return [];
  return items.filter(
    (item: Zotero.Item) => item?.isRegularItem?.() && !item.deleted,
  );
}

/**
 * The ID of the collection the user right-clicked, or null when the row is
 * anything else: a library or group root, a saved search, Trash, Unfiled
 * Items, Duplicate Items, Publications, a feed.
 *
 * Returns the ID rather than the collection so this module needs no Zotero
 * globals. `openGraphForCollection` performs the lookup itself.
 */
export function contextCollectionID(context: any): number | null {
  const row = contextValue(context, "collectionTreeRow");
  if (row?.isCollection?.() !== true) return null;
  const ref = contextValue(row, "ref");
  return positiveInteger(ref?.id ?? ref?.collectionID);
}
```

Now delete the local copy from `src/services/menuService.ts`. Remove this whole block (the comment and function, currently lines 98–109):

```typescript
// The right-clicked rows arrive on the menu context, and that is the only
// place they may be read from. Falling back to the pane selection would answer
// with whatever happened to be selected elsewhere, which is how these entries
// ended up appearing on every row Zotero opens a context menu on — notes,
// attachments, and rows that hold no items at all.
function contextRegularItems(context: any): Zotero.Item[] {
  const items = safeContextValue(context, "items");
  if (!Array.isArray(items)) return [];
  return items.filter(
    (item: Zotero.Item) => item?.isRegularItem?.() && !item.deleted,
  );
}
```

and add the import directly below the existing `import { updateCitationDataForItems } from "./citationUpdateService";` line:

```typescript
import { contextRegularItems } from "./menuContext";
```

Leave `safeContextValue` in `menuService.ts` — `contextWindow`, `injectOpenViewItems` and `tabRenameItem` still use it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`

Expected: PASS. Both new tests appear under "Architecture foundations". If `npm test` cannot launch Zotero in your environment, say so rather than skipping — the tests are the deliverable of this task, and a green `typecheck` is not a substitute.

- [ ] **Step 5: Verify lint and types**

Run: `npx prettier --check src/services/menuContext.ts src/services/menuService.ts test/architecture.test.ts && npx eslint . && npm run typecheck`

Expected: all three clean, no output beyond the script banners. If Prettier reports style issues, run `npx prettier --write` on those three files and re-run.

- [ ] **Step 6: Commit**

```bash
git add src/services/menuContext.ts src/services/menuService.ts test/architecture.test.ts
git commit -m "Put the right-clicked-row predicates behind a tested seam"
```

Include the two trailer lines from `git log -1 --format=%B HEAD` in the message body.

---

## Task 2: Widen the two menu seams

Pure refactor. The item menu must behave identically afterwards. This task exists as its own review gate because it changes shared helpers that Task 3 then depends on; a reviewer can reject the seam shape without rejecting the folder feature.

**Files:**

- Modify: `src/services/menuService.ts` (`injectOpenViewItems` at lines 213–255, `contextCommandItem` at lines 257–281, `itemMenus` at lines 283–307 — line numbers shift once Task 1 lands, locate by name)

**Interfaces:**

- Consumes: `contextRegularItems` from `./menuContext` (Task 1); `OpenGraphViewInfo` from `./windowService`, whose fields are `instanceID: string`, `title: string`, `kind: "map" | "focus"`, `tabID: string | null`, `active: boolean`, `detached: boolean`.
- Produces:
  - `contextCommandItem(l10nID: string, isAvailable: (context: any) => boolean, run: (context: any) => Promise<void> | void, onShown?: (context: any) => void): MenuData`
  - `injectViewItems(context: any, views: readonly OpenGraphViewInfo[], hint: string | ((view: OpenGraphViewInfo) => string), run: (view: OpenGraphViewInfo) => void): void`

- [ ] **Step 1: Generalise the injector**

Replace the whole `injectOpenViewItems` function with `injectViewItems`. It no longer fetches or filters the views, and no longer knows what clicking one does — the caller supplies all three.

```typescript
// Sibling menuitems, one per open view, inserted after the anchor entry while
// the popup is showing. They cannot be declared up front because the number of
// open views is only known at that moment. They are removed again on
// popuphidden so the next opening rebuilds them.
function injectViewItems(
  context: any,
  views: readonly OpenGraphViewInfo[],
  hint: string | ((view: OpenGraphViewInfo) => string),
  run: (view: OpenGraphViewInfo) => void,
): void {
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
  if (!views.length) return;

  const document = popup.ownerDocument as any;
  let previous: HTMLElement = anchor;
  for (const view of views) {
    const item = document.createXULElement("menuitem");
    item.setAttribute(OPEN_IN_DYNAMIC_ATTR, "true");
    item.setAttribute("class", "menuitem-iconic");
    item.setAttribute("image", ICON);
    item.setAttribute("label", view.active ? `✓ ${view.title}` : view.title);
    item.setAttribute(
      "acceltext",
      typeof hint === "function" ? hint(view) : hint,
    );
    item.addEventListener("command", () => run(view), { once: true });
    previous.after(item);
    previous = item;
  }
  popup.addEventListener("popuphidden", clear, { once: true });
}
```

Note the one deliberate behaviour change: `clear()` now runs before the empty-view check, so a popup reopened after the last view closed no longer keeps stale entries. The old code returned early and left them in place until `popuphidden`.

- [ ] **Step 2: Restore `isAvailable` as a parameter**

Replace `contextCommandItem` with:

```typescript
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
```

- [ ] **Step 3: Update `itemMenus` to the new signatures**

Replace `itemMenus` with the version below. The behaviour is unchanged: same three entries, same order, same acceltexts, and every open view is still offered (both `map` and `focus`), because `openInExistingView` already branches on `view.kind`.

```typescript
// The item context menu is deliberately flat: every Meristema action sits
// directly in Zotero's own menu, identified by its icon rather than by a
// parent labelled "Meristema".
function itemMenus(): MenuData[] {
  const hasItems = (context: any): boolean =>
    contextRegularItems(context).length > 0;
  return [
    contextCommandItem(
      `${config.addonRef}-show-items-new-tab-command`,
      hasItems,
      async (context) => {
        await openInNewMap(itemCommand(context), contextWindow(context));
      },
    ),
    contextCommandItem(
      `${config.addonRef}-open-focus-view-new-tab-command`,
      hasItems,
      async (context) => {
        await openInNewFocusView(itemCommand(context), contextWindow(context));
      },
      (context) => {
        const hostWindow = contextWindow(context);
        injectViewItems(
          context,
          getOpenGraphViews(hostWindow),
          (view) => (view.kind === "focus" ? "add as seeds" : "add to graph"),
          (view) => {
            void openInExistingView(
              view,
              itemCommand(context),
              hostWindow,
            ).catch(report);
          },
        );
      },
    ),
    contextCommandItem(
      `${config.addonRef}-refresh-command`,
      hasItems,
      (context) => {
        refreshItems(contextRegularItems(context));
      },
    ),
  ];
}
```

- [ ] **Step 4: Verify lint and types**

Run: `npx prettier --check src/services/menuService.ts && npx eslint . && npm run typecheck`

Expected: all clean. A TypeScript error naming `injectOpenViewItems` means a call site was missed — there was only one, inside `itemMenus`.

- [ ] **Step 5: Run the test suite**

Run: `npm test`

Expected: PASS, unchanged from Task 1. These tests do not cover the XUL glue this task touched — that needs the manual check in Task 4. Nothing here is verified by automation beyond "it still compiles and nothing else broke"; say so plainly in the commit rather than implying the refactor is proven.

- [ ] **Step 6: Commit**

```bash
git add src/services/menuService.ts
git commit -m "Open the menu helpers up to a second context menu"
```

Include the two trailer lines from `git log -1 --format=%B HEAD` in the message body.

---

## Task 3: Register the folder menu

**Files:**

- Modify: `src/services/menuService.ts` (add `collectionMenus`, extend `registerMenus`)

**Interfaces:**

- Consumes: `contextCollectionID` from `./menuContext` (Task 1); `contextCommandItem` and `injectViewItems` (Task 2); `openGraphForCollection` from `./windowService`, signature `openGraphForCollection(collectionID: number, hostWindow?: _ZoteroTypes.MainWindow, options?: { newInstance?: boolean; targetInstanceID?: string | null }): Promise<void>`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Import the two new symbols**

In `src/services/menuService.ts`, extend the `./menuContext` import added in Task 1:

```typescript
import { contextCollectionID, contextRegularItems } from "./menuContext";
```

and add `openGraphForCollection` to the existing `./windowService` import block, keeping the block's alphabetical-ish ordering — place it directly after `openFocusItemsInView`:

```typescript
  openGraphForCollection,
```

- [ ] **Step 2: Add `collectionMenus`**

Insert this function directly after `itemMenus` in `src/services/menuService.ts`:

```typescript
// A folder opens as a collection-scoped graph rather than as a bag of item
// IDs: `openGraphForCollection` drives the graph's own collection filter, so
// the scope follows the folder as papers are added to it and subcollections
// come along. That filter is a scope, not an addition — opening a folder in an
// existing graph replaces what it was showing, which is why the injected
// entries read "show this folder" and not the item menu's "add to graph".
//
// Explore views are left out. A focus view is seeded by item IDs and has no
// collection to re-scope, so there is nothing coherent to offer.
function collectionMenus(): MenuData[] {
  return [
    contextCommandItem(
      `${config.addonRef}-show-items-new-tab-command`,
      (context) => contextCollectionID(context) !== null,
      async (context) => {
        const collectionID = contextCollectionID(context);
        if (collectionID === null) return;
        await openGraphForCollection(collectionID, contextWindow(context), {
          newInstance: true,
        });
      },
      (context) => {
        const collectionID = contextCollectionID(context);
        if (collectionID === null) return;
        const hostWindow = contextWindow(context);
        injectViewItems(
          context,
          getOpenGraphViews(hostWindow).filter((view) => view.kind === "map"),
          "show this folder",
          (view) => {
            void openGraphForCollection(collectionID, hostWindow, {
              targetInstanceID: view.instanceID,
            }).catch(report);
          },
        );
      },
    ),
  ];
}
```

- [ ] **Step 3: Register it**

In `registerMenus`, add a third `register(...)` call between the existing item and tab registrations:

```typescript
register({
  menuID: "meristema-collection-context-menu",
  pluginID: config.addonID,
  target: "main/library/collection",
  menus: collectionMenus(),
});
```

`unregisterMenus` needs no change — it drains `registeredMenuIDs`, which `register()` appends to.

- [ ] **Step 4: Verify lint and types**

Run: `npx prettier --check src/services/menuService.ts && npx eslint . && npm run typecheck`

Expected: all clean.

- [ ] **Step 5: Run the test suite**

Run: `npm test`

Expected: PASS. Note for the commit message and your report: these tests cover the folder _predicate_, not the folder _menu_. Whether the entry actually appears and opens a scoped graph is unverified until Task 4.

- [ ] **Step 6: Commit**

```bash
git add src/services/menuService.ts
git commit -m "Offer a folder to a Collection Graph from the collection tree"
```

Include the two trailer lines from `git log -1 --format=%B HEAD` in the message body.

---

## Task 4: Verify in a running Zotero and close the spec

Everything automated is green by now, and none of it has opened a menu. This task is the only evidence that the feature works. Do not skip it and do not report the feature as working on the strength of Tasks 1–3.

**Files:**

- Modify: `docs/superpowers/specs/2026-08-28-collection-context-menu-design.md` (line 4, `Status:`)

- [ ] **Step 1: Launch Zotero with the plugin**

Run: `npm start`

This is `zotero-plugin serve`. It launches a development Zotero profile with the plugin loaded and reloads on source changes. It needs a desktop session; if you cannot open a GUI, stop here and hand the checklist below to the user rather than guessing at the results.

- [ ] **Step 2: Walk the checklist**

Work through all six checks and record the actual result of each, not the expected one.

1. Right-click a folder that contains papers → "Open in New Collection Graph" appears, with `library only` beside it. Clicking it opens a new graph tab whose filter button shows the folder's name and whose nodes are that folder's papers.
2. Right-click a folder that has subcollections → the graph includes papers from the subcollections too.
3. Right-click each of: My Library, Trash, Unfiled Items, Duplicate Items, a saved search, and a group library root → **no** Meristema entry on any of them. This is the regression that motivated the work.
4. With a Collection Graph tab open, right-click a _different_ folder → an entry named after that open graph appears below the first one, reading `show this folder`. Clicking it re-scopes the open graph to the new folder rather than opening a second tab.
5. With an Explore view open and no Collection Graph open, right-click a folder → only "Open in New Collection Graph" appears. The Explore view is **not** offered.
6. Right-click a paper, then a note, then an attachment → the item menu is unchanged: three entries on the paper, nothing on the note or the attachment.

- [ ] **Step 3: Flip the spec status**

Only if all six checks passed. Edit line 4 of `docs/superpowers/specs/2026-08-28-collection-context-menu-design.md`:

```
Status: implemented
```

If a check failed, leave the status at `designed`, write down what actually happened, and stop for review instead of patching blind — a failure here means the design missed something, not that the code needs a nudge.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-08-28-collection-context-menu-design.md
git commit -m "Mark the folder Collection Graph design implemented"
```

Include the two trailer lines from `git log -1 --format=%B HEAD` in the message body.

- [ ] **Step 5: Report**

State which of the six checks you ran yourself and which, if any, the user still needs to run. Name the branch (`collection-context-menu`) and list the commits. If `npm start` was unavailable, say that plainly and present the checklist as outstanding — an unverified feature reported as verified is worse than an unverified one reported honestly.
