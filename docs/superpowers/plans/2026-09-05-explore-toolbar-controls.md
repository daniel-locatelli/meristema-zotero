# Explore Controls in the Plot Toolbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Explore view's second band and put its seeds button and four settings dropdowns into the plot toolbar as two popover buttons.

**Architecture:** Everything lives in `createGraphView` in `src/services/graphViewService.ts`, which builds the toolbar DOM by hand and wires popovers the same way for Add Node, Export and the appearance panel. The seeds popover already exists and only gets re-parented; the four `<select>` elements are re-parented into a new settings popover. A tiny pure helper decides whether a popover would overflow the window's right edge, so it can be unit-tested under plain Node.

**Tech Stack:** TypeScript, hand-built DOM, `addon/content/graph.css`, Node's built-in test runner with chai (`npm run test:unit`), `npm run check` (lint, typecheck, unit tests).

## Global Constraints

Copied from `docs/superpowers/specs/2026-09-05-explore-toolbar-controls-design.md`.

- The band (`.cm-focus-bar`) is removed; its controls sit in the plot toolbar immediately after the filter button and before Add Node.
- The two wrappers carry the class `cm-focus-only`; the rule `.meristema-root[data-view-kind="map"] .cm-focus-only { display: none; }` hides them in Collection Graph tabs.
- Seeds: a `cm-toolbar-button` in a `cm-menu-wrapper`, built with `iconButtonContent`, icon `document`, label text unchanged (`N seeds`), with `aria-haspopup="dialog"`, `aria-expanded`, `aria-controls`.
- Settings: a `cm-toolbar-button` in a `cm-menu-wrapper`, icon `settings`, label "Settings", `aria-haspopup="dialog"`, `aria-expanded`, `aria-controls`.
- The settings popover is `.cm-appearance-panel .cm-appearance-panel--below`; rows use `.cm-appearance-section` and `.cm-appearance-row` with labels Direction, Scope, Ranking, Limit.
- The four `<select>` elements, their options, values and `change` listeners are untouched.
- Both popovers: button toggles `hidden` and `aria-expanded`; outside pointerdown closes without `preventDefault` or `stopPropagation`; Escape closes and returns focus to the button; opening one closes the other.
- Right-edge fallback: on open, if the button's left plus the popover's width exceeds the window's inner width, the popover gets `cm-popover-end` (`right: 0; left: auto`); the class is removed on the next open before measuring.
- CSS to add, verbatim:

```css
.meristema-root[data-view-kind="map"] .cm-focus-only {
  display: none;
}
.cm-appearance-panel--below {
  top: calc(100% + 6px);
  bottom: auto;
  width: min(320px, calc(100vw - 38px));
}
.cm-appearance-panel--below.cm-popover-end,
.cm-focus-seed-popover.cm-popover-end {
  right: 0;
  left: auto;
}
```

- CSS to delete: `.cm-focus-bar`, `.cm-focus-bar[hidden]`, `.cm-focus-bar .cm-select`.
- Unit tests under `test/unit` run in plain Node: nothing they import may touch `Zotero.*` or the DOM at load.
- Commit messages: sentence-case subject, no type prefix, trailers `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa`.
- `npm start` may be holding the Zotero profile; do not run `npm test` (real Zotero) during a task. `npm run check` is the gate.

---

## File map

- Create `src/services/popoverPlacement.ts`: one pure function, `popoverOverflowsEnd`.
- Create `test/unit/popoverPlacement.test.ts`: its tests.
- Modify `src/services/graphViewService.ts`: toolbar assembly (~line 585), the focus bar block (~lines 611–697), `updateFocusBar` (~line 1548), the seed popover handlers (~lines 1569–1596), the listener cleanup block (~line 3737).
- Modify `addon/content/graph.css`: delete the band rules (~lines 764–779), retarget the seed button rules (~lines 780–795), add the new rules.

---

### Task 1: Popover right-edge helper

**Files:**
- Create: `src/services/popoverPlacement.ts`
- Test: `test/unit/popoverPlacement.test.ts`

**Interfaces:**
- Produces: `popoverOverflowsEnd(buttonLeft: number, popoverWidth: number, windowWidth: number): boolean` — true when a popover anchored at `buttonLeft` and `popoverWidth` wide would extend past `windowWidth`.

- [ ] **Step 1: Write the failing test**

Create `test/unit/popoverPlacement.test.ts`:

```ts
import { describe, it } from "node:test";
import { expect } from "chai";
import { popoverOverflowsEnd } from "../../src/services/popoverPlacement";

describe("popoverOverflowsEnd", function () {
  it("is false when the popover fits before the window's right edge", function () {
    expect(popoverOverflowsEnd(100, 320, 1000)).to.equal(false);
  });

  it("is false when the popover ends exactly at the right edge", function () {
    expect(popoverOverflowsEnd(680, 320, 1000)).to.equal(false);
  });

  it("is true when the popover would extend past the right edge", function () {
    expect(popoverOverflowsEnd(700, 320, 1000)).to.equal(true);
  });

  it("is false when a measurement is missing or zero", function () {
    expect(popoverOverflowsEnd(700, 0, 1000)).to.equal(false);
    expect(popoverOverflowsEnd(700, 320, 0)).to.equal(false);
    expect(popoverOverflowsEnd(Number.NaN, 320, 1000)).to.equal(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import ./test/nodeResolve.mjs --test test/unit/popoverPlacement.test.ts`
Expected: FAIL, the module `../../src/services/popoverPlacement` cannot be found.

- [ ] **Step 3: Write the implementation**

Create `src/services/popoverPlacement.ts`:

```ts
/**
 * Whether a popover anchored to its button's left edge would run past the
 * window's right edge. A zero or non-finite measurement means "cannot tell",
 * which keeps the default start alignment.
 */
export function popoverOverflowsEnd(
  buttonLeft: number,
  popoverWidth: number,
  windowWidth: number,
): boolean {
  if (
    !Number.isFinite(buttonLeft) ||
    !Number.isFinite(popoverWidth) ||
    !Number.isFinite(windowWidth) ||
    popoverWidth <= 0 ||
    windowWidth <= 0
  ) {
    return false;
  }
  return buttonLeft + popoverWidth > windowWidth;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import ./test/nodeResolve.mjs --test test/unit/popoverPlacement.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/popoverPlacement.ts test/unit/popoverPlacement.test.ts
git commit -m "Add the popover right-edge helper

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa"
```

---

### Task 2: Seeds and Settings buttons in the toolbar, band removed

**Files:**
- Modify: `src/services/graphViewService.ts` (toolbar assembly ~585–593; focus bar block ~611–697; `updateFocusBar` ~1548–1567; seed popover handlers ~1569–1596; cleanup block ~3737–3745)
- Modify: `addon/content/graph.css` (~764–795, plus new rules)

**Interfaces:**
- Consumes: `popoverOverflowsEnd(buttonLeft, popoverWidth, windowWidth): boolean` from `src/services/popoverPlacement.ts` (Task 1).
- Consumes (existing, `src/services/graphViewControls.ts`): `element(document, tag, className?)`, `text(document, tag, content, className?)`, `icon(document, name)`, `iconButtonContent(document, name, label)`; icon names `document` and `settings` exist in `src/services/uiIconService.ts`.

- [ ] **Step 1: Add the import**

In `src/services/graphViewService.ts`, next to the other `./` imports (any position among them; the file imports from `./graphViewControls` around line 73), add:

```ts
import { popoverOverflowsEnd } from "./popoverPlacement";
```

- [ ] **Step 2: Rebuild the seeds button and add the settings popover**

Replace the block that begins `const focusBar = element(document, "section", "cm-focus-bar");` and ends with the `focusBar.append(...)` call (currently ~lines 611–697) with the following. The `<select>` construction loops are copied unchanged from the current code.

```ts
  const focusSeedMenu = element(
    document,
    "div",
    "cm-focus-seed-menu cm-menu-wrapper cm-focus-only",
  );
  const focusSeedButton = element(document, "button", "cm-toolbar-button");
  focusSeedButton.type = "button";
  focusSeedButton.setAttribute("aria-haspopup", "dialog");
  focusSeedButton.setAttribute("aria-expanded", "false");
  focusSeedButton.setAttribute("aria-controls", "meristema-focus-seed-popover");
  focusSeedButton.append(iconButtonContent(document, "document", "0 seeds"));
  const focusSeedButtonLabel = focusSeedButton.querySelector(
    "span",
  ) as HTMLSpanElement;
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
  focusSeedSearch.placeholder = "Search seeds";
  focusSeedSearch.setAttribute("aria-label", "Search Explore seeds");
  focusSeedSearchWrap.appendChild(focusSeedSearch);
  const focusSeedResults = element(document, "div", "cm-focus-seed-results");
  focusSeedResults.setAttribute("role", "list");
  focusSeedPopover.append(focusSeedSearchWrap, focusSeedResults);
  focusSeedMenu.append(focusSeedButton, focusSeedPopover);

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
  const focusRanking = element(document, "select", "cm-select");
  for (const [value, label] of [
    ["relevance", "Relevance"],
    ["most-cited", "Most cited"],
    ["most-recent", "Most recent"],
    ["local-first", "In Zotero first"],
  ] as const) {
    const option = element(document, "option");
    option.value = value;
    option.textContent = label;
    focusRanking.appendChild(option);
  }
  const focusLimit = element(document, "select", "cm-select");
  for (const value of [10, 25, 50, 100, 200]) {
    const option = element(document, "option");
    option.value = String(value);
    option.textContent = `${value} per seed per side`;
    if (value === 25) option.selected = true;
    focusLimit.appendChild(option);
  }

  // The four Explore settings, in a popover that reads as the appearance
  // panel's sibling but opens downward from the toolbar.
  const focusSettingsMenu = element(
    document,
    "div",
    "cm-menu-wrapper cm-focus-only",
  );
  const focusSettingsButton = element(
    document,
    "button",
    "cm-toolbar-button",
  );
  focusSettingsButton.type = "button";
  focusSettingsButton.append(
    iconButtonContent(document, "settings", "Settings"),
  );
  focusSettingsButton.title =
    "Direction, scope, ranking and limit for the current Explore view.";
  focusSettingsButton.setAttribute("aria-haspopup", "dialog");
  focusSettingsButton.setAttribute("aria-expanded", "false");
  focusSettingsButton.setAttribute(
    "aria-controls",
    "meristema-focus-settings-popover",
  );
  const focusSettingsPopover = element(
    document,
    "div",
    "cm-appearance-panel cm-appearance-panel--below",
  );
  focusSettingsPopover.id = "meristema-focus-settings-popover";
  focusSettingsPopover.hidden = true;
  focusSettingsPopover.setAttribute("role", "dialog");
  focusSettingsPopover.setAttribute("aria-label", "Explore settings");
  const focusSettingsSection = element(
    document,
    "div",
    "cm-appearance-section",
  );
  for (const [label, control] of [
    ["Direction", focusDirection],
    ["Scope", focusLocality],
    ["Ranking", focusRanking],
    ["Limit", focusLimit],
  ] as const) {
    const row = element(document, "label", "cm-appearance-row");
    row.append(text(document, "span", label), control);
    focusSettingsSection.appendChild(row);
  }
  focusSettingsPopover.appendChild(focusSettingsSection);
  focusSettingsMenu.append(focusSettingsButton, focusSettingsPopover);
```

- [ ] **Step 3: Put both wrappers into the toolbar and drop the band**

Change the toolbar assembly (currently ~lines 586–593):

```ts
  toolbar.append(
    graphFilter.root,
    focusSeedMenu,
    focusSettingsMenu,
    addNodeWrap,
    similarButton,
    exportWrap,
    refreshButton,
  );
  plotToolbar.append(historyControls, toolbar, searchWrap);
```

Then change `plotPane.append(plotToolbar, focusBar, graphArea);` (~line 981) to:

```ts
  plotPane.append(plotToolbar, graphArea);
```

Note: the toolbar is assembled before the seed block in the current file order. Move the whole block from Step 2 to sit before `toolbar.append(...)`, directly after `searchWrap.appendChild(search);`, so the wrappers exist when appended. `setViewKind` (defined just after the toolbar assembly) does not reference them, so it can stay where it is.

- [ ] **Step 4: Rewrite `updateFocusBar` without the band**

Directly after `closeFocusSeedPopover` (~line 1468), add its sibling:

```ts
  const closeFocusSettingsPopover = (restoreFocus = false): void => {
    focusSettingsPopover.hidden = true;
    focusSettingsButton.setAttribute("aria-expanded", "false");
    if (restoreFocus) focusSettingsButton.focus();
  };
```

Then replace the start of `updateFocusBar` (~line 1548):

```ts
  const updateFocusBar = (): void => {
    if (!focusProjection) {
      closeFocusSeedPopover();
      closeFocusSettingsPopover();
      updateNavigationButtons();
      return;
    }
```

The rest of the function (label text, title, `renderFocusSeedResults`, the four `.value` writes, `updateNavigationButtons`) is unchanged.

- [ ] **Step 5: Wire open, close, alignment and exclusivity**

Replace the seed popover handlers (from `focusSeedButton.addEventListener("click", ...)` through the two `document.addEventListener` calls, ~lines 1569–1596) with:

```ts
  // Anchors a popover to its button's right edge when the start-anchored
  // box would run past the window. Measured on every open; the class is
  // cleared first so a widened window gets the default back.
  const alignPopover = (wrapper: HTMLElement, popover: HTMLElement): void => {
    popover.classList.remove("cm-popover-end");
    const win = document.defaultView;
    if (!win) return;
    const overflows = popoverOverflowsEnd(
      wrapper.getBoundingClientRect().left,
      popover.getBoundingClientRect().width,
      win.innerWidth,
    );
    if (overflows) popover.classList.add("cm-popover-end");
  };

  focusSeedButton.addEventListener("click", () => {
    const opening = focusSeedPopover.hidden;
    if (opening) closeFocusSettingsPopover();
    focusSeedPopover.hidden = !opening;
    focusSeedButton.setAttribute("aria-expanded", String(opening));
    if (!opening) return;
    renderFocusSeedResults();
    alignPopover(focusSeedMenu, focusSeedPopover);
    document.defaultView?.setTimeout(() => focusSeedSearch.focus(), 0);
  });
  focusSeedSearch.addEventListener("input", renderFocusSeedResults);
  focusSettingsButton.addEventListener("click", () => {
    const opening = focusSettingsPopover.hidden;
    if (opening) closeFocusSeedPopover();
    focusSettingsPopover.hidden = !opening;
    focusSettingsButton.setAttribute("aria-expanded", String(opening));
    if (opening) alignPopover(focusSettingsMenu, focusSettingsPopover);
  });
  // Capture phase and no preventDefault: the pointerdown that closes a
  // popover still reaches whatever it was aimed at.
  const closeFocusSeedPopoverOnOutsidePointer = (event: Event): void => {
    if (focusSeedPopover.hidden) return;
    const target = event.target as Node | null;
    if (target && focusSeedMenu.contains(target)) return;
    closeFocusSeedPopover();
  };
  const closeFocusSeedPopoverOnEscape = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || focusSeedPopover.hidden) return;
    closeFocusSeedPopover(true);
  };
  const closeFocusSettingsOnOutsidePointer = (event: Event): void => {
    if (focusSettingsPopover.hidden) return;
    const target = event.target as Node | null;
    if (target && focusSettingsMenu.contains(target)) return;
    closeFocusSettingsPopover();
  };
  const closeFocusSettingsOnEscape = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || focusSettingsPopover.hidden) return;
    closeFocusSettingsPopover(true);
  };
  document.addEventListener(
    "pointerdown",
    closeFocusSeedPopoverOnOutsidePointer,
    true,
  );
  document.addEventListener("keydown", closeFocusSeedPopoverOnEscape, true);
  document.addEventListener(
    "pointerdown",
    closeFocusSettingsOnOutsidePointer,
    true,
  );
  document.addEventListener("keydown", closeFocusSettingsOnEscape, true);
```

`closeFocusSeedPopover` (~line 1468) is unchanged; `closeFocusSettingsPopover` was added beside it in Step 4.

- [ ] **Step 6: Extend the cleanup block**

In the cleanup function (~line 3737), after the `closeFocusSeedPopoverOnEscape` removal, add:

```ts
    document.removeEventListener(
      "pointerdown",
      closeFocusSettingsOnOutsidePointer,
      true,
    );
    document.removeEventListener("keydown", closeFocusSettingsOnEscape, true);
```

- [ ] **Step 7: Update the stylesheet**

In `addon/content/graph.css`, delete these three rules (~lines 764–779):

```css
.cm-focus-bar { ... }
.cm-focus-bar[hidden] { ... }
.cm-focus-bar .cm-select { ... }
```

Delete the four seed-button rules that styled the old band button (~lines 783–795): `.cm-focus-seed-button`, `.cm-focus-seed-chevron`, and `.cm-focus-seed-button[aria-expanded="true"] .cm-focus-seed-chevron`. Keep `.cm-focus-seed-menu { flex: 0 0 auto; }`.

Add, directly after the `.cm-focus-seed-menu` rule:

```css
.meristema-root[data-view-kind="map"] .cm-focus-only {
  display: none;
}
.cm-appearance-panel--below {
  top: calc(100% + 6px);
  bottom: auto;
  width: min(320px, calc(100vw - 38px));
}
.cm-appearance-panel--below.cm-popover-end,
.cm-focus-seed-popover.cm-popover-end {
  right: 0;
  left: auto;
}
.cm-appearance-panel--below .cm-appearance-row .cm-select {
  min-height: 28px;
}
```

Confirm `.cm-focus-seed-popover` still has `left: 0` and `top: calc(100% + 6px)` so it opens under the toolbar button; those lines are unchanged.

- [ ] **Step 8: Run the checks**

Run: `npm run check`
Expected: lint clean, typecheck clean, unit tests pass (159 including Task 1's four). If the typechecker reports `focusBar` or `focusSeedButtonChevron` as unresolved, a reference to the deleted band survived; remove it.

- [ ] **Step 9: Commit**

```bash
git add src/services/graphViewService.ts addon/content/graph.css
git commit -m "Move the Explore seeds and settings into the plot toolbar

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa"
```

---

### Task 3: Spec status and manual walk-through notes

**Files:**
- Modify: `docs/superpowers/specs/2026-09-05-explore-toolbar-controls-design.md` (the `**Status:**` line)

- [ ] **Step 1: Mark the spec implemented**

Change `**Status:** Approved` to `**Status:** Implemented`.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-09-05-explore-toolbar-controls-design.md
git commit -m "Mark the Explore toolbar spec implemented

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa"
```

The manual walk-through in real Zotero (both view kinds, both popovers, outside click, Escape, narrow window) and `npm test` are done by the user once `npm start` is stopped; they are not part of any task.
