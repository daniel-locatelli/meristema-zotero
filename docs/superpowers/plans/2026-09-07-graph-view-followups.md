# Graph View Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the graph toolbar the same on every path, name paper graphs after their first paper, stop offering folders to open views, and remove Back and Forward.

**Architecture:** The graph view keeps its two seed buttons rendered and toggles `disabled` from `setSeeded`. The history stacks and their two buttons are deleted from the view along with the options that fed them. A pure `paperGraphTitle` in the instance policy shapes a paper title into a tab name, and the two item openers in the window service pass it as the title base. The folder menu loses its injected entries.

**Tech Stack:** Zotero 7 plugin, TypeScript, hand-built DOM, Node test runner with chai under `test/unit`.

Spec: `docs/superpowers/specs/2026-09-07-graph-view-followups-design.md`

## Global Constraints

- `npm run check` is the gate (prettier, eslint, typecheck, unit tests). It must be green at the end of every task. Never run `npm test`; the user's `npm start` holds the Zotero profile. Never start or stop Zotero.
- Unit tests run in plain Node: `node --import ./test/nodeResolve.mjs --test <file>`. They must not touch `Zotero.*` or the DOM at load.
- Commit messages: sentence-case subject, no type prefix, body optional, and these two trailers on every commit:
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa
  ```
- Prettier formats the Markdown under `docs/` and `README.md`. Run `npx prettier --write <file>` on any doc you edit before committing.
- Branch: `graph-view-followups`, from `main` at da28c10.
- Line numbers below are approximate ("around line N"). Grep for the quoted code rather than trusting the number.
- The view's user-facing name is "Graph". "Explore" names the act of seeding and its controls. Code comments may keep "Focus" as the internal name of the projection.

---

### Task 1: Keep the Seeds and Explore buttons in the toolbar

**Files:**

- Modify: `src/services/graphViewService.ts` (around lines 577, 659, 710, 1578)
- Modify: `addon/content/graph.css:770-772`

**Interfaces:**

- Consumes: nothing.
- Produces: nothing other tasks rely on.

No unit test: the graph view is DOM-bound. Typecheck and the gate cover the edit.

- [ ] **Step 1: Drop the hiding class from both menus**

Around line 577, change

```ts
    "cm-focus-seed-menu cm-menu-wrapper cm-focus-only",
```

to

```ts
    "cm-focus-seed-menu cm-menu-wrapper",
```

Around line 659, change

```ts
    "cm-menu-wrapper cm-focus-only",
```

to

```ts
    "cm-menu-wrapper",
```

- [ ] **Step 2: Disable the buttons while there are no seeds**

Around line 710, replace the whole `setSeeded` function and add a call after it:

```ts
// The Seeds and Explore buttons stay in the toolbar on every path so the
// view keeps one shape; without seeds there is nothing for them to show,
// so they are disabled rather than hidden.
const setSeeded = (seeded: boolean): void => {
  root.dataset.seeded = seeded ? "true" : "false";
  focusSeedButton.disabled = !seeded;
  focusSettingsButton.disabled = !seeded;
  refreshButton.title = seeded
    ? "Refresh references and citing papers for the current Explore seeds."
    : "Refresh metadata and citation counts for the currently visible papers.";
  if (!seeded) {
    refreshButton.removeAttribute("aria-busy");
    refreshButton.disabled = false;
  }
};
setSeeded(false);
```

- [ ] **Step 3: Reset the seed label when the projection ends**

Around line 1578, in `updateFocusBar`, change the early return

```ts
if (!focusProjection) {
  closeFocusSeedPopover();
  closeFocusSettingsPopover();
  updateNavigationButtons();
  return;
}
```

to

```ts
if (!focusProjection) {
  closeFocusSeedPopover();
  closeFocusSettingsPopover();
  focusSeedButtonLabel.textContent = "0 seeds";
  focusSeedButton.title = "Papers this graph was built from.";
  updateNavigationButtons();
  return;
}
```

(Task 2 deletes the `updateNavigationButtons()` line; leave it in place here.)

- [ ] **Step 4: Delete the CSS rule**

In `addon/content/graph.css` around line 770, delete:

```css
.meristema-root[data-seeded="false"] .cm-focus-only {
  display: none;
}
```

Then run `grep -rn "cm-focus-only" src addon test` and confirm no output.

- [ ] **Step 5: Run the gate**

Run: `npm run check`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/services/graphViewService.ts addon/content/graph.css
git commit -F - <<'EOF'
Keep the Seeds and Explore buttons in the toolbar without seeds

They are disabled rather than hidden, so the view has the same toolbar
whichever way the tab was opened.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa
EOF
```

---

### Task 2: Remove Back and Forward

**Files:**

- Modify: `src/services/graphViewService.ts` (regions listed per step)
- Modify: `addon/content/graph.css:187-205`
- Modify: `src/services/uiIconService.ts:15-16` and `:47-59`
- Modify: `test/zotero/graphViewVisual.test.ts:421-431`
- Modify: `README.md:47` and `:61`

**Interfaces:**

- Consumes: nothing.
- Produces: `exitFocus()` takes no options; `enterFocusSeeds` and `enterFocus` options lose `pushHistory`. No other file calls these.

No unit test: the view is DOM-bound. After the edits, `grep -n "focusBack\|focusForward\|mapSelectionBack\|mapSelectionForward\|focusReturnState\|focusReturnForward\|suppressSelectionHistory\|historyBackButton\|historyForwardButton\|historyControls\|updateNavigationButtons\|cloneFocusState\|restoreFocusState\|restoreMapSelection\|pushHistory\|preserveFocusReturn" src/services/graphViewService.ts` must print nothing; typecheck catches anything missed.

- [ ] **Step 1: Delete the history state**

Around line 322, delete these seven declarations (keep `librarySelectedKeyBeforeFocus`, which `exitFocus` still uses):

```ts
const focusBack: GraphFocusState[] = [];
const focusForward: GraphFocusState[] = [];
const mapSelectionBack: Array<string | null> = [];
const mapSelectionForward: Array<string | null> = [];
let focusReturnState: GraphFocusState | null = null;
let focusReturnForward: GraphFocusState[] = [];
```

and, two lines further down:

```ts
let suppressSelectionHistory = false;
```

- [ ] **Step 2: Delete the buttons**

Around line 403, delete the block from `const historyControls = element(...)` through `historyControls.append(historyBackButton, historyForwardButton);` (16 lines). Around line 708, change

```ts
plotToolbar.append(historyControls, toolbar, searchWrap);
```

to

```ts
plotToolbar.append(toolbar, searchWrap);
```

- [ ] **Step 3: Delete the state helpers**

Around line 1319, delete:

```ts
const cloneFocusState = (state: GraphFocusState): GraphFocusState => ({
  ...state,
  seedKeys: [...state.seedKeys],
});
```

Around line 1483, delete:

```ts
const updateNavigationButtons = (): void => {
  historyBackButton.disabled = focusProjection
    ? false
    : mapSelectionBack.length === 0;
  historyForwardButton.disabled = focusProjection
    ? focusForward.length === 0
    : mapSelectionForward.length === 0 && focusReturnState === null;
};
```

Then delete every remaining `updateNavigationButtons();` line. There are nine, in: `updateFocusBar` (two), `enterFocusSeeds`, `addFocusSeeds`, `removeFocusSeed`, `exitFocus`'s `restoreSelection`, `handleGraphSelection`, after `renderOverview(null);` near the renderer construction, and `restoreMapSelection` (which Step 6 deletes whole).

- [ ] **Step 4: Strip the history from the seed entry points**

In `enterFocusSeeds` (around line 2035), change the options type

```ts
    options: {
      pushHistory?: boolean;
      state?: GraphFocusState;
    } = {},
```

to

```ts
    options: { state?: GraphFocusState } = {},
```

and delete, inside `if (enteringFromLibrary) {`:

```ts
if (options.pushHistory !== false) {
  focusReturnState = null;
  focusReturnForward = [];
  mapSelectionForward.splice(0);
}
```

and, after that block:

```ts
if (focusProjection && options.pushHistory !== false) {
  focusBack.push(cloneFocusState(focusProjection.state));
  focusForward.splice(0);
  updateNavigationButtons();
}
```

In `enterFocus` (around line 2118), change the options type the same way:

```ts
    options: { state?: GraphFocusState } = {},
```

In `addFocusSeeds` (around line 2142), delete:

```ts
focusBack.push(cloneFocusState(focusProjection.state));
focusForward.splice(0);
updateNavigationButtons();
```

In `removeFocusSeed` (around line 2178), delete the same three lines.

Around line 2192, delete:

```ts
const restoreFocusState = (state: GraphFocusState): boolean =>
  activateFocusState(cloneFocusState(state), { fit: true });
```

- [ ] **Step 5: Simplify exitFocus and the selection handler**

Around line 2214, change

```ts
  const exitFocus = (options: { preserveFocusReturn?: boolean } = {}): void => {
    resetFocusRefreshTracking();
    focusProjection = null;
    setSeeded(false);
    if (!options.preserveFocusReturn) focusReturnState = null;
    if (!options.preserveFocusReturn) focusReturnForward = [];
    focusRelationships.clear();
    focusSeedRegistry.clear();
    focusBack.splice(0);
    focusForward.splice(0);
```

to

```ts
  const exitFocus = (): void => {
    resetFocusRefreshTracking();
    focusProjection = null;
    setSeeded(false);
    focusRelationships.clear();
    focusSeedRegistry.clear();
```

Further down in the same function, change `restoreSelection`

```ts
const restoreSelection = (): void => {
  const node = restoreSelectedKey
    ? model.nodes.find((candidate) => candidate.key === restoreSelectedKey)
    : null;
  suppressSelectionHistory = true;
  if (node) renderer?.selectNode(node.key, false);
  else renderer?.clearSelection();
  suppressSelectionHistory = false;
  updateNavigationButtons();
};
```

to

```ts
const restoreSelection = (): void => {
  const node = restoreSelectedKey
    ? model.nodes.find((candidate) => candidate.key === restoreSelectedKey)
    : null;
  if (node) renderer?.selectNode(node.key, false);
  else renderer?.clearSelection();
};
```

Around line 3039, change `handleGraphSelection`

```ts
const handleGraphSelection = (node: CitationGraphNode | null): void => {
  if (!suppressSelectionHistory && !focusProjection) {
    const previousKey = selectedNode?.key ?? null;
    const nextKey = node?.key ?? null;
    if (previousKey !== nextKey) {
      mapSelectionBack.push(previousKey);
      if (mapSelectionBack.length > 100) mapSelectionBack.shift();
      mapSelectionForward.splice(0);
      focusReturnState = null;
      focusReturnForward = [];
    }
  }
  renderOverview(node);
  updateNavigationButtons();
};
```

to

```ts
const handleGraphSelection = (node: CitationGraphNode | null): void => {
  renderOverview(node);
};
```

- [ ] **Step 6: Delete the click handlers**

Around line 3186, delete `restoreMapSelection` and both listeners: everything from `const restoreMapSelection = (key: string | null): void => {` through the closing `});` of `historyForwardButton.addEventListener(...)`, ending just before `similarButton.addEventListener("click", () => {`. About 58 lines.

- [ ] **Step 7: Confirm nothing is left**

Run the grep from the task header. Expected: no output.

- [ ] **Step 8: Delete the CSS**

In `addon/content/graph.css` around line 187, delete the `.cm-history-controls` rule, the comment block that follows it, and the `.meristema-root .cm-history-controls button` rule, so that `.cm-title-row h1,` immediately follows the rule that ends `gap: 8px;\n}`. Run `grep -n "history" addon/content/graph.css`; expected: no output.

- [ ] **Step 9: Delete the arrow icons**

In `src/services/uiIconService.ts`, delete the two union members

```ts
  | "arrow-left"
  | "arrow-right"
```

and the two entries

```ts
  "arrow-left": [
    "M20 11H7.83l5.58-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2Z",
  ],
  "arrow-right": [
    "M4 11h12.17l-5.58-5.59L12 4l8 8-8 8-1.41-1.41L16.17 13H4v-2Z",
  ],
```

Replace the comment above them with:

```ts
/*
 * The two chevrons, drawn rather than typed. They were "‹" and "›" set as
 * button text, and a text glyph sits on its font's baseline: the chevrons
 * are shorter than their line box, so both looked a pixel or two high
 * inside a centred button. These are centred on the viewBox instead, so
 * they cannot drift.
 */
```

- [ ] **Step 10: Drop the history buttons from the visual test**

In `test/zotero/graphViewVisual.test.ts` around line 421, change the comment and loop

```ts
    /*
     * The navigation glyphs are drawn, not typed. A text arrow sits on its
     * font's baseline and rides the maths axis, so it reads high in a centred
     * button however the button is aligned; an svg centred on its own viewBox
     * cannot. This asserts the geometry, which is what was actually wrong.
     */
    for (const selector of [
      ".cm-history-controls button:first-child",
      ".cm-history-controls button:last-child",
      ".cm-key-toggle",
    ]) {
```

to

```ts
    /*
     * The toggle glyph is drawn, not typed. A text chevron sits on its font's
     * baseline, so it reads high in a centred button however the button is
     * aligned; an svg centred on its own viewBox cannot. This asserts the
     * geometry, which is what was actually wrong.
     */
    for (const selector of [".cm-key-toggle"]) {
```

This suite runs inside Zotero only; do not try to run it.

- [ ] **Step 11: Update the README**

Around line 47, change

```markdown
Add "seed" papers to a graph and it shows their references, citing papers, or both. Add or remove seeds, include papers outside Zotero, rank and limit neighbours, and move backward or forward through previous seed states. Remove the last seed and the graph returns to your library.
```

to

```markdown
Add "seed" papers to a graph and it shows their references, citing papers, or both. Add or remove seeds, include papers outside Zotero, and rank and limit neighbours. Remove the last seed and the graph returns to your library.
```

Around line 61, change the end of the sentence `Each view keeps its own scope, seeds, filters, selection, camera, and navigation history.` to `Each view keeps its own scope, seeds, filters, selection, and camera.`

- [ ] **Step 12: Run the gate**

Run: `npx prettier --write README.md && npm run check`
Expected: green.

- [ ] **Step 13: Commit**

```bash
git add src/services/graphViewService.ts addon/content/graph.css src/services/uiIconService.ts test/zotero/graphViewVisual.test.ts README.md
git commit -F - <<'EOF'
Remove Back and Forward from the graph view

Seed changes act on the projection directly. The seed-state and
selection history stacks, the two buttons and their arrow icons go.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa
EOF
```

---

### Task 3: Name a graph opened from papers after the first paper

**Files:**

- Modify: `src/services/graphInstancePolicy.ts` (after `multiCollectionGraphTitle`, around line 60)
- Modify: `test/unit/architecture.test.ts` (import list around line 104; new test after the `nextGraphViewTitle` test around line 354)
- Modify: `src/services/windowService.ts` (import around line 16; `openGraphAndSelectItems` around line 1049; `openFocusItems` around line 1107)

**Interfaces:**

- Consumes: `OpenGraphOptions.titleBase`, existing, applied only when a new instance is created.
- Produces: `paperGraphTitle(title: unknown, maxLength = 40): string | null` and `PAPER_GRAPH_TITLE_LENGTH = 40`.

- [ ] **Step 1: Write the failing test**

In `test/unit/architecture.test.ts`, add `paperGraphTitle,` to the import list from `../../src/services/graphInstancePolicy` (alphabetical, after `nextGraphViewTitle,`). After the test `"names every new view Graph and numbers the rest"`, add:

```ts
it("names a paper graph after the paper, cut at a word when long", function () {
  expect(paperGraphTitle("Attention Is All You Need")).to.equal(
    "Attention Is All You Need",
  );
  expect(
    paperGraphTitle(
      "A Survey of Graph Neural Networks for Citation Recommendation in Digital Libraries",
    ),
  ).to.equal("A Survey of Graph Neural Networks for…");
  // A title with no break before the limit is cut at the limit itself.
  expect(paperGraphTitle("x".repeat(50))).to.equal(`${"x".repeat(40)}…`);
  expect(paperGraphTitle("  ")).to.equal(null);
  expect(paperGraphTitle(undefined)).to.equal(null);
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `node --import ./test/nodeResolve.mjs --test test/unit/architecture.test.ts`
Expected: the file fails to load with a SyntaxError naming `paperGraphTitle` as a missing export.

- [ ] **Step 3: Implement the helper**

In `src/services/graphInstancePolicy.ts`, after `multiCollectionGraphTitle`, add:

```ts
/** Longest paper title a tab carries before it is cut. */
export const PAPER_GRAPH_TITLE_LENGTH = 40;

/**
 * The name a graph opened from papers carries: the first paper's title, cut
 * at the last word boundary that fits and closed with an ellipsis when it is
 * longer than a tab can show. A blank title has no graph name, and callers
 * fall back to the generic base.
 */
export function paperGraphTitle(
  title: unknown,
  maxLength = PAPER_GRAPH_TITLE_LENGTH,
): string | null {
  const trimmed = String(title ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!trimmed) return null;
  if (trimmed.length <= maxLength) return trimmed;
  const head = trimmed.slice(0, maxLength);
  const lastSpace = head.lastIndexOf(" ");
  const cut = lastSpace > 0 ? head.slice(0, lastSpace) : head;
  return `${cut.trimEnd()}…`;
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `node --import ./test/nodeResolve.mjs --test test/unit/architecture.test.ts`
Expected: all tests in the file pass.

- [ ] **Step 5: Pass the title from the item openers**

In `src/services/windowService.ts`, add `paperGraphTitle,` to the import list from `./graphInstancePolicy` (alphabetical, after `nextGraphViewTitle,`).

Directly above `export async function openGraphAndSelectItems(` add:

```ts
/** The title Zotero shows for an item, or an empty string. */
function itemDisplayTitle(item: any): string {
  return String(
    item?.getDisplayTitle?.() || item?.getField?.("title") || "",
  ).trim();
}
```

In `openGraphAndSelectItems`, change the `openGraphWindow` call

```ts
await openGraphWindow(win, libraryID, {
  newInstance: options.newInstance,
  targetInstanceID: options.targetInstanceID ?? instance?.instanceID,
  request: {
    ...emptyRequest(),
    selectionItemIDs: ids,
    selectionMode: canExtendExistingScope ? "add" : "replace",
  },
});
```

to

```ts
await openGraphWindow(win, libraryID, {
  newInstance: options.newInstance,
  targetInstanceID: options.targetInstanceID ?? instance?.instanceID,
  titleBase: paperGraphTitle(itemDisplayTitle(items[0])) ?? undefined,
  request: {
    ...emptyRequest(),
    selectionItemIDs: ids,
    selectionMode: canExtendExistingScope ? "add" : "replace",
  },
});
```

In `openFocusItems`, change

```ts
await openGraphWindow(win, libraryID, {
  newInstance: options.newInstance,
  targetInstanceID: options.targetInstanceID ?? instance?.instanceID,
  request: {
    ...emptyRequest(),
    focusItemIDs: ids,
  },
});
```

to

```ts
await openGraphWindow(win, libraryID, {
  newInstance: options.newInstance,
  targetInstanceID: options.targetInstanceID ?? instance?.instanceID,
  titleBase: paperGraphTitle(itemDisplayTitle(items[0])) ?? undefined,
  request: {
    ...emptyRequest(),
    focusItemIDs: ids,
  },
});
```

`titleBase` is read only inside `if (!instance) { createGraphInstance(...) }` in `openGraphWindow`, so adding papers or seeds to an open view leaves its title alone.

- [ ] **Step 6: Run the gate**

Run: `npm run check`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add src/services/graphInstancePolicy.ts test/unit/architecture.test.ts src/services/windowService.ts
git commit -F - <<'EOF'
Name a graph opened from papers after its first paper

Show in New Graph and Explore in New Graph title the tab with the first
selected paper's title, cut at a word when it is long. Folder graphs
keep their folder name and Tools › New Graph stays "Graph".

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa
EOF
```

---

### Task 4: Folders open new graphs only

**Files:**

- Modify: `src/services/menuService.ts` (comment above `collectionMenus` around line 340-354; the `injectViewItems` call around line 393-411)
- Modify: `docs/superpowers/specs/2026-09-07-graph-view-followups-design.md:4`

**Interfaces:** none.

No unit test: the menu service is untested under Node. Typecheck and eslint (unused variables) cover it.

- [ ] **Step 1: Rewrite the comment**

Above `function collectionMenus(): MenuData[] {`, replace this whole comment:

```ts
// A folder opens as a collection-scoped graph rather than as a bag of item
// IDs: `openGraphForCollection` drives the graph's own collection filter, so
// the scope follows the folder as papers are added to it and subcollections
// come along. That filter is a scope, not an addition — opening a folder in an
// existing graph replaces what it was showing, which is why the injected
// entries read "Show in <graph>" and not the item menu's "add to graph". They
// cannot honestly say "add": the filter holds one collection, so a second
// folder would displace the first rather than join it.
//
// A seeded graph is offered too: showing a folder in it drops the seeds and
// draws the folder, which is what "Show in" promises.
```

with:

```ts
// A folder opens as a collection-scoped graph rather than as a bag of item
// IDs: `openGraphForCollections` drives the graph's own collection filter, so
// the scope follows the folder as papers are added to it and subcollections
// come along. Open views are not offered: that filter is a scope, not an
// addition, so showing a folder in an existing graph could only replace what
// it was showing, and a graph is re-scoped from inside it with filters and
// seeds anyway.
```

- [ ] **Step 2: Drop the injected entries**

Inside `collectionMenus()`, in the `onShowing` callback of the `collection-new-graph-command` item, delete from `const hostWindow = contextWindow(context);` through the closing `);` of the `injectViewItems(...)` call, so the callback ends after `context.setL10nArgs(...)`. Then, in `MENU_HINTS` near the top of the file, leave `"collection-new-graph-command": "library only"` in place; it hints the remaining entry.

Run `grep -n "replaces contents\|Show \${folders} folders" src/services/menuService.ts`; expected: no output.

- [ ] **Step 3: Mark the spec implemented**

In `docs/superpowers/specs/2026-09-07-graph-view-followups-design.md`, change `**Status:** Draft` to `**Status:** Implemented`.

- [ ] **Step 4: Run the gate**

Run: `npx prettier --write docs/superpowers/specs/2026-09-07-graph-view-followups-design.md && npm run check`
Expected: green. eslint fails if `hostWindow` or `folders` survived unused.

- [ ] **Step 5: Commit**

```bash
git add src/services/menuService.ts docs/superpowers/specs/2026-09-07-graph-view-followups-design.md
git commit -F - <<'EOF'
Offer folders a new graph only

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa
EOF
```

---

## Manual verification (user, after the branch lands)

Run `npm start`, then in Zotero:

1. Tools › Meristema › New Graph opens "Graph" with Seeds and Explore in the toolbar, grayed out, and no Back or Forward buttons.
2. Right-click a paper › Explore in New Graph: the tab is titled after the paper, Seeds reads "1 seed", both buttons enabled.
3. Seeds › remove the seed: the library graph appears, both buttons gray out and read "0 seeds", the title stays.
4. Right-click a paper › Show in New Graph: titled after the paper, buttons grayed.
5. Right-click a folder: only "New … Graph" is offered.
