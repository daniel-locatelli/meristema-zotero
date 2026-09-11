# Scope Rail Folders Implementation Plan (B31)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redraw the rail's Scope folder rows as a tree with indent guides, a
filled square in place of the native checkbox, Zotero's selected-row fill for
a folder drawn as a region, and a hover tint over a parent's descendants.

**Architecture:** Three edits along the existing seams. The model
(`graphScopeRailModel.ts`) stops indenting the label and gains one pure
function, `scopeSquare`, that names the square's fill and dash from a row's
`state`, `selected` and `color`. The DOM builder (`graphKeyRail.ts`,
`scopeRowElement`) keeps the native checkbox in place, visually hidden, draws
a `span` square beside it, writes the depth onto the row wrapper as a CSS
variable, and toggles a reach class on descendant rows while the pointer is
over a parent's square. Every colour, indent and guide is CSS in `graph.css`.
The two handlers in `graphViewService.ts` (`toggleRow`, `selectRow`) do not
change.

**Tech Stack:** TypeScript, `node:test` + `chai` unit tests through
`test/nodeResolve.mjs`; the Zotero suite (`zotero-plugin test`, mocha +
chai) for anything that needs a DOM; plain CSS with `color-mix`.

Spec: `docs/superpowers/specs/2026-09-11-scope-rail-folders-design.md`, and
the picture beside it, `2026-09-11-scope-rail-folders-d.png`. Roadmap entry
B31 in `docs/superpowers/handoffs/2026-09-08-roadmap.md`.

## Global Constraints

- Branch `scope-rail-folders`, created off `main` at `9bc31ab` (Task 1
  creates it). Finish by fast-forwarding `main` to it; do not rebase or
  squash.
- The user runs `npm start` (zotero-plugin serve) beside a live Zotero. It
  rebuilds on every source edit or checkout and deletes
  `.scaffold/build/meristema.xpi`. **Never** stop Zotero or the serve
  process. `npm run build` is the last command of the plan, after the last
  `npm test`.
- `npm run check` (prettier, eslint, `tsc --noEmit` twice, the unit suite)
  must be green before every commit. `npm run lint:fix` formats.
- `npm test` launches the dev Zotero and runs `test/zotero`; the user allows
  it. It is slow (minutes). Run it only where a task says so, and twice at
  the end, keeping the logs: `npm test 2>&1 | tee <scratchpad>/test-N.log`.
  The suite was 44 passed, 0 failed on the last logged run;
  `savedGraphMenu.test.ts` "lists the saved graphs on the first showing" is
  a known intermittent and one failure there is not a regression.
- Zotero.debug output never reaches the runner log: every Zotero assertion
  carries its evidence in its message string.
- Selectors the Zotero suite depends on and that must keep their meaning:
  `.cm-scope-row` (the row wrapper), `.cm-scope-row-label` (its text is
  compared trimmed), `.cm-scope-row-count`, `.cm-scope-check` (the native
  checkbox: tests set `checked` and dispatch `change`, or call `click()`),
  `.cm-scope-row-selected` on the wrapper, `[data-collection-id]` on the row
  body.
- Exact values from the spec: 14 px indent per level; guide line colour
  `var(--cm-border)`; square 13 px with a 3 px radius; off outline 1.5 px at
  45 % ink; on fill `var(--cm-accent)`; mixed fill 45 % ink over paper with a
  white dash; region fill `var(--cm-row-color)`; selected row fill
  `var(--cm-accent)` with white label and count; square edge on a selected
  row 1 px in the label ink; reach tint
  `color-mix(in srgb, var(--cm-accent) 10%, transparent)`; a selected row is
  never tinted. No tick glyph in any state. No folding, no counts on parents,
  no folder icons.
- Commit messages are one sentence in the repo's style (see `git log`), no
  `feat:` prefix, ending with:

  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01PPNm3N5W7KxsysgGoWBB6T
  ```

## File Structure

- `src/services/graphScopeRailModel.ts` — the rows as data. Loses `INDENT`;
  `label` becomes the plain folder name. Gains `scopeSquare(row)`, the one
  place that says what the square shows.
- `src/services/graphKeyRail.ts` — `scopeRowElement` (around line 396)
  builds the row DOM. Gains the square span, the depth variable and the
  reach hover. Nothing else in the file changes.
- `addon/content/graph.css` lines 1178 to 1244 (`.cm-scope-rows` through
  `.cm-scope-row-count`) — replaced wholesale by the new rules.
- `test/unit/graphScopeRailModel.test.ts` — the label case changes; a new
  `describe` for `scopeSquare`.
- `test/zotero/graphScopeTree.test.ts` — new. The only nested-collection
  fixture in the suite; walks depth, the square's classes, the mixed parent
  and the reach hover through the rendered rail.
- `docs/superpowers/handoffs/2026-09-08-roadmap.md` — B31 ticked, three
  manual checks appended, the suite count updated.

---

### Task 1: The model drops the indent and names the square

**Files:**

- Modify: `src/services/graphScopeRailModel.ts`
- Test: `test/unit/graphScopeRailModel.test.ts`

**Interfaces:**

- Consumes: `ScopeRow` as it is (`state`, `selected`, `color`, `depth`).
- Produces: `export type ScopeSquareFill = "off" | "on" | "mixed" | "region"`,
  `export interface ScopeSquare { fill: ScopeSquareFill; dash: boolean }`,
  `export function scopeSquare(row: ScopeRow): ScopeSquare`. Task 2 writes
  `fill` into a class name `cm-scope-square-${fill}` and `dash` into
  `cm-scope-square-dash`.

- [ ] **Step 1: Create the branch**

```bash
git checkout -b scope-rail-folders main
```

Expected: `Switched to a new branch 'scope-rail-folders'`. The serve process
rebuilds and deletes the XPI; that is expected.

- [ ] **Step 2: Change the label case and add the square cases**

In `test/unit/graphScopeRailModel.test.ts`, replace the case named
`"indents the tree, keeps its order, and closes it with the two rows"` with:

```ts
it("keeps the tree's order with plain labels, and closes it with the two rows", function () {
  const model = buildScopeRailModel({
    collections: TREE,
    ticks: allCollectionsTicked(),
    includeUnfiled: true,
    includeExternal: false,
    seeds: [],
    scope: emptyScope(),
    regions: [],
    regionColors: new Map(),
  });
  // The indent is the row's padding now (B31), not spaces in the label.
  expect(model.rows.map((row) => row.label)).to.deep.equal([
    "PhD",
    "Reading",
    "Drafts",
    "Teaching",
    "Unfiled",
    "Not in Zotero",
  ]);
  expect(
    model.rows.map((row) => (row.kind === "collection" ? row.depth : null)),
  ).to.deep.equal([0, 1, 1, 0, null, null]);
  const last = model.rows.at(-1);
  expect(last?.kind).to.equal("external");
  expect(last?.state).to.equal("off");
  expect(last?.count).to.equal(1);
});
```

Add `scopeSquare` to the import from `../../src/services/graphScopeRailModel`,
and append this `describe` at the end of the file:

```ts
describe("scopeSquare", function () {
  // The square is the checkbox's face (B31): its fill is the row's state,
  // and a region's swatch wins over the accent because the row is already
  // on the selected fill and the square is what tells two regions apart.
  function rows(regions: number[], untick: number[] = []) {
    return buildScopeRailModel({
      collections: TREE,
      ticks: setCollectionTicks(allCollectionsTicked(), untick, false),
      includeUnfiled: true,
      includeExternal: false,
      seeds: [],
      scope: emptyScope(),
      regions,
      regionColors: new Map(regions.map((id) => [id, "#abcdef"])),
    }).rows;
  }

  it("is empty for an unticked folder", function () {
    expect(scopeSquare(rows([], [2])[3])).to.deep.equal({
      fill: "off",
      dash: false,
    });
  });

  it("is the accent for a ticked folder", function () {
    expect(scopeSquare(rows([])[3])).to.deep.equal({
      fill: "on",
      dash: false,
    });
  });

  it("is grey with a dash for a mixed parent", function () {
    expect(scopeSquare(rows([], [11])[0])).to.deep.equal({
      fill: "mixed",
      dash: true,
    });
  });

  it("takes the region swatch for a selected folder", function () {
    expect(scopeSquare(rows([2])[3])).to.deep.equal({
      fill: "region",
      dash: false,
    });
  });

  it("keeps the dash on a selected parent that is partly shown", function () {
    expect(scopeSquare(rows([1], [11])[0])).to.deep.equal({
      fill: "region",
      dash: true,
    });
  });

  it("only ever shows empty or the accent for Unfiled and Not in Zotero", function () {
    const model = rows([]);
    expect(scopeSquare(model[4])).to.deep.equal({ fill: "on", dash: false });
    expect(scopeSquare(model[5])).to.deep.equal({ fill: "off", dash: false });
  });
});
```

- [ ] **Step 3: Run the unit file to see it fail**

Run:

```bash
node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/graphScopeRailModel.test.ts
```

Expected: the label case fails on `"    Reading"` versus `"Reading"`, and
the `scopeSquare` cases fail with `scopeSquare is not a function` (or a
TypeScript import error).

- [ ] **Step 4: Implement**

In `src/services/graphScopeRailModel.ts`:

Delete the line `const INDENT = "    ";`.

Change the `label` doc comment and value on `ScopeCollectionRow` and in
`buildScopeRailModel`:

```ts
export interface ScopeCollectionRow {
  kind: "collection";
  collectionID: number;
  /** The folder's own name; the rail indents the row by `depth`. */
  label: string;
  depth: number;
```

```ts
      label: collection.name,
```

Add, after `ScopeRailInput` and before `COUNT_FORMAT`:

```ts
export type ScopeSquareFill = "off" | "on" | "mixed" | "region";

export interface ScopeSquare {
  fill: ScopeSquareFill;
  /** The white dash of a partly shown parent. */
  dash: boolean;
}

/**
 * What the square in front of a row shows (B31). The square is the native
 * checkbox's face: empty when the folder is off, the accent when it is shown,
 * grey with a dash when its descendants disagree. A folder drawn as a region
 * takes its swatch instead of the accent, because the row behind it is
 * already on the selected fill and the square is what tells two regions
 * apart; the dash survives on it, since the swatch says nothing about the
 * subtree.
 */
export function scopeSquare(row: ScopeRow): ScopeSquare {
  const dash = row.state === "mixed";
  if (row.selected && row.color) return { fill: "region", dash };
  if (dash) return { fill: "mixed", dash };
  return { fill: row.state === "on" ? "on" : "off", dash: false };
}
```

- [ ] **Step 5: Run the unit file to see it pass, then the full check**

```bash
node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/graphScopeRailModel.test.ts
npm run check
```

Expected: every case in the file passes; `npm run check` green. If prettier
complains, `npm run lint:fix` and rerun.

- [ ] **Step 6: Commit**

```bash
git add src/services/graphScopeRailModel.ts test/unit/graphScopeRailModel.test.ts
git commit -m "B31: the label is the plain folder name and scopeSquare names the square's fill

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PPNm3N5W7KxsysgGoWBB6T"
```

---

### Task 2: A Zotero case for the nested tree (written red)

**Files:**

- Create: `test/zotero/graphScopeTree.test.ts`

**Interfaces:**

- Consumes: the rail DOM as Task 3 will build it: the row wrapper
  `.cm-scope-row` carries `style="--cm-depth: N"`; inside its
  `.cm-scope-check-label` sit the hidden `input.cm-scope-check` and a
  `span.cm-scope-square` with `cm-scope-square-{off|on|mixed|region}` and,
  when dashed, `cm-scope-square-dash`; a descendant row wears
  `cm-scope-row-reach` while the pointer is over its ancestor's
  `.cm-scope-check-label`.

- [ ] **Step 1: Write the test file**

`test/zotero/graphScopeTree.test.ts`:

```ts
/// <reference types="mocha" />
import { expect } from "chai";
import { config } from "../../package.json";
import { delay } from "./visualHarness";

const PARENT_NAME = "Tree fixture parent";
const CHILD_NAME = "Tree fixture child";

function shown(popup: Element): Promise<void> {
  return new Promise((resolve) => {
    if ((popup as any).state === "open") return resolve();
    popup.addEventListener("popupshown", () => resolve(), { once: true });
  });
}

function customMenu(popup: Element, l10nID: string): any {
  const menu = Array.from(popup.children).find(
    (child) => (child as HTMLElement).dataset?.l10nId === l10nID,
  );
  expect(menu, `menu ${l10nID}`).to.exist;
  return menu;
}

async function waitFor<T>(
  probe: () => T | null | undefined | false,
  timeoutMs: number,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await delay(50);
  }
}

function command(element: Element): void {
  const win = element.ownerDocument.defaultView as any;
  element.dispatchEvent(new win.Event("command", { bubbles: true }));
}

/**
 * The Scope rail's folder tree (B31), walked through the plugin's own chrome
 * with the suite's only nested fixture: one parent folder with one child.
 * The other rail suites use flat folders, so nothing else exercises the
 * depth, the guides' variable, the mixed parent's square, or the reach tint
 * a parent's square casts over its descendants.
 */
describe("The graph's Scope tree", function () {
  let win: any;
  let tabID: string | null = null;
  let parentID: number | null = null;
  let childID: number | null = null;
  let fixtureIDs: number[] = [];

  function graphRoot(): HTMLElement {
    const root = tabContent()?.querySelector(
      ".meristema-root",
    ) as HTMLElement | null;
    expect(root, "the graph is rendered").to.exist;
    return root as HTMLElement;
  }

  function tabContent(): HTMLElement | null {
    if (!tabID) return null;
    return (win.Zotero_Tabs.getTabContent(tabID) as HTMLElement) ?? null;
  }

  function graphTabs(): any[] {
    return (win.Zotero_Tabs._tabs as any[]).filter(
      (tab) => tab.type === config.addonRef,
    );
  }

  /** The row wrapper for a folder, found through the body's ID. */
  function scopeRow(id: number): HTMLElement {
    const body = graphRoot().querySelector(
      `.cm-scope-row [data-collection-id="${id}"]`,
    );
    expect(body, `a Scope row body for collection ${id}`).to.exist;
    return body!.closest(".cm-scope-row") as HTMLElement;
  }

  function checkbox(id: number): HTMLInputElement {
    return scopeRow(id).querySelector(".cm-scope-check") as HTMLInputElement;
  }

  function square(id: number): HTMLElement {
    const node = scopeRow(id).querySelector(".cm-scope-square");
    expect(node, `a square on the row for collection ${id}`).to.exist;
    return node as HTMLElement;
  }

  function squareFill(id: number): string {
    const fills = Array.from(square(id).classList)
      .map((name) => /^cm-scope-square-(off|on|mixed|region)$/.exec(name)?.[1])
      .filter((name): name is string => Boolean(name));
    return fills.join(",");
  }

  function label(id: number): string {
    return scopeRow(id).querySelector(".cm-scope-row-label")?.textContent ?? "";
  }

  before(async function () {
    this.timeout(60_000);
    win = Zotero.getMainWindows()[0];
    const libraryID = Zotero.Libraries.userLibraryID;
    const parent = new Zotero.Collection();
    parent.libraryID = libraryID;
    parent.name = PARENT_NAME;
    parentID = await parent.saveTx();
    const child = new Zotero.Collection();
    child.libraryID = libraryID;
    child.name = CHILD_NAME;
    child.parentID = parentID;
    childID = await child.saveTx();
    for (const [name, id] of [
      [PARENT_NAME, parentID],
      [CHILD_NAME, childID],
    ] as const) {
      const item = new Zotero.Item("journalArticle");
      item.libraryID = libraryID;
      item.setField("title", `${name} paper`);
      item.setField("date", "2021");
      item.addToCollection(id);
      fixtureIDs.push(await item.saveTx());
    }

    const doc = win.document as Document;
    const already = new Set(graphTabs().map((tab) => tab.id));
    const toolsPopup = doc.getElementById("menu_ToolsPopup")!;
    let showing = shown(toolsPopup);
    (toolsPopup as any).openPopup(null, "after_start", 0, 0, false, false);
    await showing;
    const tools = customMenu(toolsPopup, `${config.addonRef}-tools-submenu`);
    showing = shown(tools.menupopup);
    tools.openMenu(true);
    await showing;
    command(
      customMenu(tools.menupopup, `${config.addonRef}-new-graph-view-command`),
    );
    (toolsPopup as any).hidePopup();

    const tab = await waitFor(
      () => graphTabs().find((candidate) => !already.has(candidate.id)),
      20_000,
    );
    expect(tab, "the graph's tab").to.exist;
    tabID = tab!.id;
    win.Zotero_Tabs.select(tabID);
    const rail = await waitFor(
      () => tabContent()?.querySelector(".cm-scope-section .cm-scope-count"),
      30_000,
    );
    expect(rail, "the rail's Scope section").to.exist;
    await waitFor(
      () => graphRoot().querySelector(`[data-collection-id="${childID}"]`),
      10_000,
    );
  });

  after(async function () {
    this.timeout(30_000);
    if (tabID) win.Zotero_Tabs.close(tabID);
    await delay(300);
    for (const id of fixtureIDs) await Zotero.Items.erase(id);
    fixtureIDs = [];
    // The child first: erasing a parent takes its subtree with it, and a
    // second erase of the child would then find nothing.
    for (const id of [childID, parentID]) {
      if (id === null) continue;
      const collection = Zotero.Collections.get(id) as any;
      if (collection) await collection.eraseTx();
    }
  });

  it("indents the child by its depth and keeps the label plain", function () {
    expect(
      scopeRow(parentID!).style.getPropertyValue("--cm-depth").trim(),
      "the parent sits at depth 0",
    ).to.equal("0");
    expect(
      scopeRow(childID!).style.getPropertyValue("--cm-depth").trim(),
      "the child sits at depth 1",
    ).to.equal("1");
    expect(
      label(childID!),
      "the label carries no leading spaces; the indent is the row's",
    ).to.equal(CHILD_NAME);
  });

  it("fills both squares while both folders are shown", function () {
    expect(checkbox(parentID!).checked, "the parent is ticked").to.equal(true);
    expect(squareFill(parentID!), "so its square is on").to.equal("on");
    expect(squareFill(childID!), "and so is the child's").to.equal("on");
    expect(
      square(childID!).classList.contains("cm-scope-square-dash"),
      "no dash on a fully shown folder",
    ).to.equal(false);
  });

  it("tints the child's row while the pointer is over the parent's square", async function () {
    const boxLabel = scopeRow(parentID!).querySelector(
      ".cm-scope-check-label",
    ) as HTMLElement;
    boxLabel.dispatchEvent(new win.PointerEvent("pointerenter"));
    expect(
      scopeRow(childID!).classList.contains("cm-scope-row-reach"),
      "the child is in the parent's reach",
    ).to.equal(true);
    expect(
      scopeRow(parentID!).classList.contains("cm-scope-row-reach"),
      "the parent itself is not tinted",
    ).to.equal(false);
    boxLabel.dispatchEvent(new win.PointerEvent("pointerleave"));
    expect(
      scopeRow(childID!).classList.contains("cm-scope-row-reach"),
      "the tint leaves with the pointer",
    ).to.equal(false);
  });

  it("draws the parent mixed when the child is unticked, and refills both on the parent's click", async function () {
    this.timeout(15_000);
    const childBox = checkbox(childID!);
    childBox.checked = false;
    childBox.dispatchEvent(new win.Event("change"));
    await waitFor(() => checkbox(parentID!).indeterminate, 5_000);
    expect(
      checkbox(parentID!).indeterminate,
      "the native box still reads indeterminate for a screen reader",
    ).to.equal(true);
    expect(squareFill(parentID!), "the parent's square is mixed").to.equal(
      "mixed",
    );
    expect(
      square(parentID!).classList.contains("cm-scope-square-dash"),
      "with the dash",
    ).to.equal(true);
    expect(squareFill(childID!), "the child's square is empty").to.equal("off");

    checkbox(parentID!).click();
    await waitFor(() => squareFill(childID!) === "on", 5_000);
    expect(squareFill(parentID!), "the parent is on again").to.equal("on");
    expect(squareFill(childID!), "and the cascade refilled the child").to.equal(
      "on",
    );
    expect(checkbox(parentID!).indeterminate, "no longer mixed").to.equal(
      false,
    );
  });

  it("gives a selected folder's square the region swatch", async function () {
    this.timeout(15_000);
    const body = scopeRow(parentID!).querySelector(
      `[data-collection-id="${parentID}"]`,
    ) as HTMLButtonElement;
    body.click();
    await waitFor(
      () => scopeRow(parentID!).classList.contains("cm-scope-row-selected"),
      5_000,
    );
    expect(squareFill(parentID!), "the square takes the region fill").to.equal(
      "region",
    );
    expect(
      scopeRow(parentID!).style.getPropertyValue("--cm-row-color").trim(),
      "the row carries the swatch the renderer handed it",
    ).to.not.equal("");
    expect(
      squareFill(childID!),
      "the child is only shown, not a region",
    ).to.equal("on");
    body.click();
    await waitFor(
      () => !scopeRow(parentID!).classList.contains("cm-scope-row-selected"),
      5_000,
    );
    expect(
      squareFill(parentID!),
      "clearing the region returns the accent",
    ).to.equal("on");
  });
});
```

- [ ] **Step 2: Check and run the suite once to see the new file fail**

```bash
npm run lint:fix
npm run check
npm test 2>&1 | tee "$SCRATCH/test-red.log"
```

(`$SCRATCH` is this session's scratchpad directory.) Expected: `npm run
check` green (the file typechecks against the `test` project; it uses only
selectors). The suite reports the five new cases; at least "indents the
child by its depth" and "fills both squares" fail, since no row carries
`--cm-depth` or a `.cm-scope-square` yet. Every pre-existing case still
passes. Note the pass/fail count in the log's last lines.

- [ ] **Step 3: Commit the red test**

```bash
git add test/zotero/graphScopeTree.test.ts
git commit -m "B31: a Zotero case for the nested tree, red until the rail draws the square

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PPNm3N5W7KxsysgGoWBB6T"
```

---

### Task 3: The rail draws the square, the depth, and the reach

**Files:**

- Modify: `src/services/graphKeyRail.ts` (`scopeRowElement`, around lines
  396 to 447; the import block at lines 22 to 26)

**Interfaces:**

- Consumes: `scopeSquare` from Task 1; `ScopeRow.depth`, `cascadeIDs`,
  `collectionID`.
- Produces: the DOM shape Task 2's test reads and Task 4's CSS styles:
  `.cm-scope-row[style*="--cm-depth"]`, `.cm-scope-check-label >
input.cm-scope-check + span.cm-scope-square.cm-scope-square-{fill}[.cm-scope-square-dash]`,
  `.cm-scope-row-reach` on descendant wrappers during hover.

- [ ] **Step 1: Import `scopeSquare`**

Change the import at the top of `src/services/graphKeyRail.ts`:

```ts
import {
  scopeSquare,
  type ScopeRailModel,
  type ScopeRow,
  type ScopeSeedRow,
} from "./graphScopeRailModel";
```

- [ ] **Step 2: Replace `scopeRowElement`**

Replace the whole function with:

```ts
function scopeRowElement(row: ScopeRow): HTMLElement {
  const wrapper = element(document, "div", "cm-scope-row");
  // The indent is the row's padding, one step per level, and the guides
  // are drawn in that padding by CSS; the label itself stays plain (B31).
  const depth = row.kind === "collection" ? row.depth : 0;
  wrapper.style.setProperty("--cm-depth", String(depth));
  if (row.selected) {
    wrapper.classList.add("cm-scope-row-selected");
    if (row.color) wrapper.style.setProperty("--cm-row-color", row.color);
  }

  // The native checkbox stays, visually hidden, so the keyboard, a screen
  // reader and the `change` handler are unchanged; the square beside it is
  // its face, and the label wraps both so a click on the square is a click
  // on the box.
  const boxLabel = element(document, "label", "cm-scope-check-label");
  const box = element(document, "input", "cm-scope-check") as HTMLInputElement;
  box.type = "checkbox";
  box.checked = row.state !== "off";
  // A parent whose descendants disagree draws mixed; clicking it commits to
  // ticked, which is what writes the same tick to the whole subtree.
  box.indeterminate = row.state === "mixed";
  box.title = `Show ${row.label} on the plot`;
  box.addEventListener("change", () =>
    options.onScope.toggleRow(row, box.checked),
  );
  const square = element(document, "span", "cm-scope-square");
  square.setAttribute("aria-hidden", "true");
  const face = scopeSquare(row);
  square.classList.add(`cm-scope-square-${face.fill}`);
  if (face.dash) square.classList.add("cm-scope-square-dash");
  boxLabel.append(box, square);

  // Hovering a parent's square tints every descendant's row, so the reach
  // of the tick shows before the click. The rows are rebuilt on every
  // render, so a tint never outlives the rows it was written to.
  if (row.kind === "collection" && row.cascadeIDs.length > 1) {
    const collectionID = row.collectionID;
    const reach = (on: boolean): void => {
      const rows = wrapper.parentElement;
      if (!rows) return;
      for (const id of row.cascadeIDs) {
        if (id === collectionID) continue;
        rows
          .querySelector(`[data-collection-id="${id}"]`)
          ?.closest(".cm-scope-row")
          ?.classList.toggle("cm-scope-row-reach", on);
      }
    };
    boxLabel.addEventListener("pointerenter", () => reach(true));
    boxLabel.addEventListener("pointerleave", () => reach(false));
  }

  const body = element(
    document,
    "button",
    "cm-scope-row-body",
  ) as HTMLButtonElement;
  body.type = "button";
  body.setAttribute("aria-pressed", row.selected ? "true" : "false");
  const name = text(document, "span", row.label, "cm-scope-row-label");
  name.title = `${row.label} — click to draw this folder as a region`;
  const count = text(
    document,
    "span",
    COUNT_FORMAT.format(row.count),
    "cm-scope-row-count",
  );
  body.append(name, count);
  if (row.kind === "collection") {
    const collectionID = row.collectionID;
    body.setAttribute("data-collection-id", String(collectionID));
    body.addEventListener("click", () =>
      options.onScope.selectRow(row, !row.selected),
    );
    body.addEventListener("pointerenter", () => {
      if (!pinned) options.onEmphasise({ kind: "collection", collectionID });
    });
    body.addEventListener("pointerleave", () => {
      if (!pinned) options.onEmphasise(null);
    });
  } else {
    body.disabled = true;
  }

  wrapper.append(boxLabel, body);
  return wrapper;
}
```

- [ ] **Step 3: Check, then run the suite once**

```bash
npm run check
npm test 2>&1 | tee "$SCRATCH/test-dom.log"
```

Expected: `npm run check` green. The suite: all five `graphScopeTree` cases
pass, and the count is the red run's total with 0 failed (49 passed if the
red run reported 49 cases). If "tints the child's row" fails, the likely
cause is `wrapper.parentElement` being null because the row is not yet
appended; that cannot happen after `renderScope` finishes, so check that the
test found the row through `graphRoot()` and not a stale tab.

- [ ] **Step 4: Commit**

```bash
git add src/services/graphKeyRail.ts
git commit -m "B31: the rail draws a square over the hidden checkbox, writes the depth, and tints a parent's reach

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PPNm3N5W7KxsysgGoWBB6T"
```

---

### Task 4: The CSS: tree guides, the square, the selected fill

**Files:**

- Modify: `addon/content/graph.css` lines 1178 to 1244 (from
  `.cm-scope-rows {` through the closing brace of `.cm-scope-row-count`)

Use the `frontend-design:frontend-design` skill for this task: the user
called B31 a frontend-design pass. The picture to match is
`docs/superpowers/specs/2026-09-11-scope-rail-folders-d.png`.

**Interfaces:**

- Consumes: the DOM from Task 3 and the tokens the file already defines at
  its top: `--cm-border`, `--cm-accent`, `--cm-muted`, `Canvas`,
  `CanvasText`; `--cm-row-color` set inline on a selected wrapper.
- Produces: nothing programmatic. No test reads computed style.

- [ ] **Step 1: Replace the block**

Delete everything from `.cm-scope-rows {` (line 1178) to the closing brace of
`.cm-scope-row-count` (line 1244) and put this in its place:

```css
.cm-scope-rows {
  display: grid;
  max-height: 40vh;
  margin-top: 8px;
  overflow: auto;
  overscroll-behavior: contain;
}
/*
 * A folder row is indented one step per level of depth, and a guide runs
 * down each ancestor level inside that indent, so a child sits visibly under
 * its parent and a deep tree keeps its shape (B31). The guides are one
 * gradient, one line every step, clipped to the indent's width; they start
 * under the centre of a parent's square (3 px label padding + 6.5 px).
 */
.cm-scope-row {
  --cm-step: 14px;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding-inline-start: calc(var(--cm-depth, 0) * var(--cm-step));
  border-radius: 3px;
  font-size: 12px;
  background-image: repeating-linear-gradient(
    to right,
    var(--cm-border) 0 1px,
    transparent 1px var(--cm-step)
  );
  background-repeat: no-repeat;
  background-position: 9px 0;
  background-size: calc(var(--cm-depth, 0) * var(--cm-step)) 100%;
}
/* Hovering a parent's square shows the reach of its tick; a selected row is
   never tinted, since white labels must not sit on a lightened blue. */
.cm-scope-row-reach:not(.cm-scope-row-selected) {
  background-color: color-mix(in srgb, var(--cm-accent) 10%, transparent);
}
/* Zotero's own selected-row style: the row fills with the accent and the
   text goes white. Two regions differ only by their squares. */
.cm-scope-row-selected {
  background-color: var(--cm-accent);
  background-image: none;
  color: white;
}
.cm-scope-check-label {
  position: relative;
  display: flex;
  align-items: center;
  padding: 3px;
  cursor: pointer;
}
/* The native checkbox stays for the keyboard, the screen reader and the
   change handler; the square beside it is its face. */
.meristema-root .cm-scope-check {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  border: 0;
  opacity: 0;
}
.cm-scope-square {
  box-sizing: border-box;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 13px;
  height: 13px;
  border: 1.5px solid color-mix(in srgb, CanvasText 45%, transparent);
  border-radius: 3px;
  background: transparent;
}
.cm-scope-square-on {
  border-color: var(--cm-accent);
  background: var(--cm-accent);
}
.cm-scope-square-mixed {
  border-color: transparent;
  background: color-mix(in srgb, CanvasText 45%, Canvas);
}
.cm-scope-square-region {
  border-color: var(--cm-row-color, var(--cm-accent));
  background: var(--cm-row-color, var(--cm-accent));
}
/* No tick glyph in any state: the only mark is the mixed parent's dash. */
.cm-scope-square-dash::after {
  content: "";
  width: 7px;
  height: 2px;
  border-radius: 1px;
  background: white;
}
/* On the selected fill the square wears a 1 px edge in the label ink, so a
   swatch close to the accent still separates from the row. */
.cm-scope-row-selected .cm-scope-square {
  border: 1px solid currentColor;
}
.meristema-root .cm-scope-check:focus-visible + .cm-scope-square {
  outline: 2px solid var(--cm-accent);
  outline-offset: 1px;
}
.cm-scope-row-selected .cm-scope-check:focus-visible + .cm-scope-square {
  outline-color: currentColor;
}
.cm-scope-row-body {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  background: none;
  border: 0;
  padding: 3px 4px;
  font: inherit;
  color: inherit;
  text-align: start;
  cursor: pointer;
}
.cm-scope-row-body:hover {
  background: color-mix(in srgb, CanvasText 8%, transparent);
  border-radius: 4px;
}
.cm-scope-row-selected .cm-scope-row-body:hover {
  background: color-mix(in srgb, white 12%, transparent);
}
.cm-scope-row-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  /* A deep name in a narrow rail is cut, not wrapped. */
  white-space: nowrap;
}
.cm-scope-row-count {
  flex: 0 0 auto;
  color: var(--cm-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.cm-scope-row-selected .cm-scope-row-count {
  color: inherit;
}
```

Notes for the implementer:

- The old `.cm-scope-check { width: 15px; height: 15px }` and the
  `.cm-scope-row-selected { border-color …; background: var(--cm-surface-paper) }`
  rules are gone on purpose; the 1.5 px transparent border on every row goes
  with them, and the rows' 1 px grid gap goes so the guides run unbroken.
- `--cm-step` is a local variable so the padding, the gradient period and the
  clip width cannot drift apart.
- `.cm-scope-row-selected` sets `background-image: none` so the guides do not
  cross the accent fill, which is what the picture shows.

- [ ] **Step 2: Format and check**

```bash
npm run lint:fix
npm run check
```

Expected: green. Prettier may reflow the gradient; that is fine.

- [ ] **Step 3: Look at it**

The serve process has already rebuilt into the live Zotero. Ask nothing of
the user here; instead read the two frames the visual suite writes, if a
prior `npm test` left any in `.scaffold/visual/`, or skip to Task 5, whose
double run refreshes them. The visual harness does not screenshot the rail
on its own, so the real check is the manual batch in Task 5.

- [ ] **Step 4: Commit**

```bash
git add addon/content/graph.css
git commit -m "B31: indent guides, a filled square in place of the checkbox, and the selected fill for a region

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PPNm3N5W7KxsysgGoWBB6T"
```

---

### Task 5: Verify twice, merge, build, close the entry

**Files:**

- Modify: `docs/superpowers/handoffs/2026-09-08-roadmap.md` (the B31 line
  at ~206; the end of the "Manual verification" list, just above the
  paragraph beginning "Note for whoever walks this batch"; the "Zotero suite"
  section's count sentence at ~512; the Log at the end)

Use `superpowers:verification-before-completion` before any claim in this
task.

- [ ] **Step 1: Run the Zotero suite twice, keeping the logs**

```bash
npm test 2>&1 | tee "$SCRATCH/test-final-1.log"
npm test 2>&1 | tee "$SCRATCH/test-final-2.log"
```

Expected: both runs `N passed, 0 failed`, where N is the previous 44 plus the
five new cases. A single failure of `savedGraphMenu` "lists the saved graphs
on the first showing" is the known intermittent; any other failure is a
regression to fix before going on. If a `graphScopeTree` case fails on one
run and passes on the other, it is timing-shaped: widen its `waitFor`, do
not loosen the assertion.

- [ ] **Step 2: Tick B31 and append the manual checks**

In the roadmap, change the B31 entry to:

```markdown
- [x] B31 the rail does not show subfolders clearly. Asked 2026-09-11: nesting
      is invisible and the cascade is illegible; widened by the user to a
      redesign of the folder rows. Spec approved the same day:
      `2026-09-11-scope-rail-folders-design.md` (indent guides, a filled
      square in place of the checkbox, Zotero's selected-row fill for a
      region). Built the same day on `scope-rail-folders`, plan
      `2026-09-11-scope-rail-folders.md`; the handlers did not change, the
      marks did. Three checks in the manual batch
```

Append to the Manual verification list, directly above the paragraph that
begins "Note for whoever walks this batch":

```markdown
- [ ] B31: open a graph whose library has a folder with subfolders. A child
      row sits 14 px in from its parent with a thin guide line running down
      the levels above it; no leading spaces in any label. Untick one child:
      the parent's square turns grey with a white dash and the screen reader
      (Narrator, or NVDA if installed) announces the parent's checkbox as
      partially checked or mixed. Hover the parent's square, not its name:
      the child rows take a faint blue tint that leaves with the pointer.
- [ ] B31: narrow the rail (drag the splitter) with a deeply nested folder
      that has a long name: the name ends in an ellipsis on one line, and
      the count stays at the right edge.
- [ ] B31: click a folder's name to draw it as a region, then switch
      Appearance to Dark. The whole row is filled with the accent blue, the
      label and count are white, and the square is the region's swatch with
      a white edge; click a second folder and the two rows read as the same
      blue with different squares.
```

Update the "Zotero suite" section's sentence "The suite is fully green as of
2026-09-10: 39 passed, 0 failed." to name the new count and date, in the same
form, and add one Log entry at the end of the file in the style of the
existing ones (date, B31, one paragraph: what changed, where the plan is,
both final runs' counts).

- [ ] **Step 3: Check and commit the docs**

```bash
npm run check
git add docs/superpowers/handoffs/2026-09-08-roadmap.md
git commit -m "Tick B31: the Scope rail's folder rows are a tree with a filled square; three checks in the manual batch

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PPNm3N5W7KxsysgGoWBB6T"
```

- [ ] **Step 4: Fast-forward main and build**

```bash
git checkout main
git merge --ff-only scope-rail-folders
git branch -d scope-rail-folders
npm run build
```

Expected: `Fast-forward`; `npm run build` ends with the XPI at
`.scaffold/build/meristema.xpi`. Confirm with:

```bash
ls -l .scaffold/build/meristema.xpi
git log --oneline -6
```

Do **not** push: `main` already carried two unpushed docs commits when this
plan was written and the user did not ask for a push. Say so in the closing
message and let the user decide.

- [ ] **Step 5: Report**

Tell the user, in one short message: B31 is built and on `main`, the XPI is
rebuilt, the two final suite counts, that `main` is ahead of `origin/main`
and unpushed, and that three B31 checks await them in the roadmap's manual
batch.

---

## Self-review against the spec

- Tree: indent as padding (Task 4), 14 px per level (Task 4 `--cm-step`),
  guides in `--cm-border` (Task 4), `white-space: pre` gone and ellipsis kept
  (Task 4), `INDENT` gone (Task 1), no folding (no task adds any).
- The square: 13 px, 3 px radius, each of the five states (Task 1 names them,
  Task 4 paints them), no tick glyph, Unfiled and Not in Zotero only off or
  on (Task 1's last case), native checkbox hidden and still `indeterminate`
  (Task 3 keeps it, Task 2 asserts it).
- Selected row: accent fill, white label and count, 1 px edge on the square,
  paper background and coloured border removed (Task 4).
- Clicks: handlers untouched (no task edits `graphViewService.ts`).
- Cascade: hover tint on descendants from the square only, never on a
  selected row (Task 3 hooks the label, Task 4 excludes `.cm-scope-row-selected`).
- Themes: only existing tokens and `--cm-row-color` are used (Task 4).
- Testing: unit label case and `scopeSquare` (Task 1); DOM shape, mixed
  parent, reach, region colour (Task 2); `graphScopeRail.test.ts` unchanged
  and expected green (Task 5); three manual checks (Task 5).
