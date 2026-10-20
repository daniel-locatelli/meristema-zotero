# D16 Gallery Saved Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The view gallery offers the reader's saved views as a row of chips
between the six shipped cards and the Start blank / Import footer.

**Architecture:** `createViewGallery` (`src/services/graphViewsMenu.ts`)
gains a `listSaved` callback, the one the View dropdown already uses. Each
`show` reads it, compares a signature of the list with the last one drawn,
and redraws the chip row only when it differs. The service passes
`listSavedGraphViews`. Styles go under `.cm-view-gallery-saved*` in
`addon/content/graph.css`.

**Tech Stack:** TypeScript, Zotero 7 plugin, node:test + chai unit tests on a
`FakeElement` DOM.

Spec: `docs/superpowers/specs/2026-10-20-gallery-saved-views-design.md`.

## Global Constraints

- Gate: `npm run check` (prettier on code and docs, eslint, both typechecks,
  unit tests). No Zotero suite run is part of this plan.
- Heading text exactly `My views`; the row is `role="group"` with
  `aria-label="My views"` (an `aria-label`, not `aria-labelledby`: several
  graph tabs share the main window's document, so a fixed id would repeat).
- A chip: the 16px `view-user` icon (the view's own `icon`) and the name; its
  `title` is `view.paragraph`, or `view.summary` when the paragraph is empty.
- No edit control on a chip.
- Commits: sentence-case subject, no type prefix, staged by path, ending with
  the two trailers:

  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_011u94ZUBSZPgEppAcs8Tck8
  ```

- Work on branch `d16-gallery-saved-views` (already exists, holds the spec).

---

### Task 1: The gallery's saved-view chips

**Files:**

- Modify: `src/services/graphViewsMenu.ts` (`createViewGallery`, from the
  `// ----- gallery` divider to the save panel divider)
- Modify: `src/services/graphViewService.ts` (the `createViewGallery(document, {`
  call, near line 1011)
- Modify: `addon/content/graph.css` (after the `.cm-view-gallery-footer` rule)
- Test: `test/unit/graphViewsMenu.test.ts`

**Interfaces:**

- Produces: `createViewGallery(document, { shipped, listSaved, onChoose, onBlank, onImport })`
  where `listSaved: () => GraphViewDefinition[]`. Classes:
  `cm-view-gallery-saved-heading`, `cm-view-gallery-saved` (the row),
  `cm-view-gallery-saved-chip`, `cm-view-gallery-saved-name`.

- [ ] **Step 1: Write the failing tests**

In `test/unit/graphViewsMenu.test.ts`, change the first import to also bring
the type:

```ts
import {
  SHIPPED_GRAPH_VIEWS,
  type GraphViewDefinition,
} from "../../src/services/graphViews";
```

In the D34 block's `gallery` helper, add `listSaved: () => [],` after
`shipped: SHIPPED_GRAPH_VIEWS,`.

Insert this block directly before `describe("the save panel's Copy JSON (D31)"`:

```ts
describe("the gallery's saved views (D16)", function () {
  const saved = (
    id: string,
    name: string,
    paragraph: string,
  ): GraphViewDefinition => ({
    ...(SHIPPED_GRAPH_VIEWS[0] as GraphViewDefinition),
    id,
    name,
    paragraph,
    summary: `${name} summary.`,
    icon: "view-user",
    requires: "none",
    availability: "ready",
  });
  const build = (
    listSaved: () => GraphViewDefinition[],
    onChoose: (view: GraphViewDefinition) => void = () => {},
  ) => {
    const gallery = createViewGallery(fakeDocument, {
      shipped: SHIPPED_GRAPH_VIEWS,
      listSaved,
      onChoose,
      onBlank: () => {},
      onImport: () => {},
    });
    return { gallery, root: gallery.root as unknown as FakeElement };
  };
  const chips = (root: FakeElement): FakeElement[] =>
    root.all("cm-view-gallery-saved-chip");

  it("draws no heading and no row without saved views", function () {
    const { gallery, root } = build(() => []);
    gallery.show(10);
    expect(root.one("cm-view-gallery-saved-heading").hidden).to.equal(true);
    expect(root.one("cm-view-gallery-saved").hidden).to.equal(true);
    expect(chips(root)).to.have.length(0);
  });

  it("gives each saved view a chip, titled by its paragraph or else its summary", function () {
    const { gallery, root } = build(() => [
      saved("u1", "Thesis core", "My core set."),
      saved("u2", "Review set", ""),
    ]);
    gallery.show(10);
    const heading = root.one("cm-view-gallery-saved-heading");
    const row = root.one("cm-view-gallery-saved");
    expect(heading.hidden).to.equal(false);
    expect(heading.textContent).to.equal("My views");
    expect(row.hidden).to.equal(false);
    expect(row.getAttribute("role")).to.equal("group");
    expect(row.getAttribute("aria-label")).to.equal("My views");
    expect(
      chips(root).map((c) => c.one("cm-view-gallery-saved-name").textContent),
    ).to.deep.equal(["Thesis core", "Review set"]);
    expect(chips(root).map((c) => c.title)).to.deep.equal([
      "My core set.",
      "Review set summary.",
    ]);
    expect(chips(root).map((c) => c.dataset.viewId)).to.deep.equal([
      "u1",
      "u2",
    ]);
  });

  it("applies a saved view when its chip is clicked", function () {
    const chosen: string[] = [];
    const { gallery, root } = build(
      () => [saved("u1", "Thesis core", ""), saved("u2", "Review set", "")],
      (view) => chosen.push(view.id),
    );
    gallery.show(10);
    chips(root)[1]?.click();
    expect(chosen).to.deep.equal(["u2"]);
  });

  it("draws a view saved since the last show, and leaves an unchanged row alone", function () {
    let list = [saved("u1", "Thesis core", "")];
    const { gallery, root } = build(() => list);
    gallery.show(10);
    expect(chips(root)).to.have.length(1);
    list = [...list, saved("u2", "Review set", "")];
    gallery.show(10);
    expect(chips(root).map((c) => c.dataset.viewId)).to.deep.equal([
      "u1",
      "u2",
    ]);
    const row = root.one("cm-view-gallery-saved");
    const before = row.children;
    list = [...list];
    gallery.show(10);
    expect(row.children, "the same nodes, not a redraw").to.equal(before);
  });
});
```

(`FakeElement.replaceChildren` assigns a new array, so `to.equal(before)`,
a reference check, proves no redraw happened.)

- [ ] **Step 2: Run the tests to see them fail**

Run: `npm run test:unit`
Expected: the four D16 cases FAIL (`a .cm-view-gallery-saved-heading`
expected to exist); every other case passes.

- [ ] **Step 3: Implement the chips in `createViewGallery`**

In `src/services/graphViewsMenu.ts`, add `listSaved` to the options type:

```ts
  o: {
    shipped: readonly GraphViewDefinition[];
    /** The reader's saved views, read at every `show` (D16). */
    listSaved: () => GraphViewDefinition[];
    onChoose: (view: GraphViewDefinition) => void;
    onBlank: () => void;
    onImport: () => void;
  },
```

Insert, directly before the `// Start blank and Import sit on a line below the cards`
comment:

```ts
// The reader's saved views are a row of chips between the cards and the
// footer (D16), drawn only when there are some. The row is redrawn only
// when the list's signature changes, so an unchanged show stays a no-op.
const savedHeading = text(
  document,
  "div",
  "My views",
  "cm-view-gallery-saved-heading",
);
const savedRow = element(document, "div", "cm-view-gallery-saved");
savedRow.setAttribute("role", "group");
savedRow.setAttribute("aria-label", "My views");
savedHeading.hidden = true;
savedRow.hidden = true;
let savedSignature: string | null = null;
const drawSaved = (): boolean => {
  const titled = o.listSaved().map((view) => ({
    view,
    title: view.paragraph || view.summary,
  }));
  const signature = JSON.stringify(
    titled.map(({ view, title }) => [view.id, view.name, title]),
  );
  if (signature === savedSignature) return false;
  savedSignature = signature;
  savedRow.replaceChildren(
    ...titled.map(({ view, title }) => {
      const chip = element(document, "button", "cm-view-gallery-saved-chip");
      chip.type = "button";
      chip.dataset.viewId = view.id;
      chip.title = title;
      chip.append(
        createIcon(document, view.icon, 16),
        text(document, "span", view.name, "cm-view-gallery-saved-name"),
      );
      chip.addEventListener("click", () => o.onChoose(view));
      return chip;
    }),
  );
  savedHeading.hidden = titled.length === 0;
  savedRow.hidden = titled.length === 0;
  return true;
};
```

Change the panel's children:

```ts
panel.append(heading, grid, savedHeading, savedRow, footer);
```

Change `show` so the saved row is read first and counts as a change:

```ts
    show(count) {
      const line = `How do you want to look at these ${count.toLocaleString()} papers?`;
      const savedChanged = drawSaved();
      // `maybeShowGallery` runs at the end of every filter pass. Writing the
      // same heading into a gallery that is already up would re-invalidate
      // its blurred compositing layer each time, so an unchanged show is a
      // no-op.
      if (!root.hidden && heading.textContent === line && !savedChanged) {
        return;
      }
      heading.textContent = line;
      root.hidden = false;
    },
```

- [ ] **Step 4: Pass the service's saved list**

In `src/services/graphViewService.ts`, in the `createViewGallery(document, {`
call, add after `shipped: SHIPPED_GRAPH_VIEWS,`:

```ts
    listSaved: listSavedGraphViews,
```

(`listSavedGraphViews` is already imported; the dropdown passes it the same
way.)

- [ ] **Step 5: Style the row**

In `addon/content/graph.css`, after the `.cm-view-gallery-footer { … }` rule:

```css
/* The reader's saved views (D16): a heading, then chips that wrap and, past
   two lines, scroll in their own box so the panel grows by at most that. */
.cm-view-gallery-saved-heading {
  margin: 14px 0 6px;
  font-size: calc(11 * var(--cm-font-unit));
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  opacity: 0.7;
}
.cm-view-gallery-saved {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: calc(2 * 28px + 6px);
  overflow: auto;
}
.cm-view-gallery-saved-heading[hidden],
.cm-view-gallery-saved[hidden] {
  display: none;
}
.meristema-root .cm-view-gallery-saved-chip {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--cm-border-soft);
  border-radius: 14px;
  background: var(--cm-surface-raised);
  font: inherit;
  cursor: pointer;
}
.meristema-root .cm-view-gallery-saved-chip:hover {
  border-color: var(--cm-accent);
}
```

- [ ] **Step 6: Run the gate**

Run: `npm run check`
Expected: prettier, eslint and both typechecks clean; all unit tests pass,
the four D16 cases among them. If prettier reports files, run
`npx prettier --write <files>` and rerun.

- [ ] **Step 7: Commit**

```bash
git add src/services/graphViewsMenu.ts src/services/graphViewService.ts addon/content/graph.css test/unit/graphViewsMenu.test.ts
git commit -m "The gallery offers the reader's saved views as a row of chips under the cards (D16)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011u94ZUBSZPgEppAcs8Tck8"
```

### Task 2: Roadmap and retirement

**Files:**

- Modify: `docs/superpowers/handoffs/roadmap.md`
- Delete: `docs/superpowers/plans/2026-10-20-gallery-saved-views.md`,
  `docs/superpowers/specs/2026-10-20-gallery-saved-views-design.md`

- [ ] **Step 1: Remove D16's entry**

In `roadmap.md`, find the `## Views, gallery and menus` section (by content).
Its only entry is D16; delete the heading, the D16 entry and the blank line
after it, so `## The rail and the Key` is followed by
`## Seeds, selection and the detail surfaces`.

- [ ] **Step 2: Add the manual check**

In the `## Manual verification` section, directly after the B111 entry (the
one that begins `- [ ] B111: narrow the Zotero window`), add:

```markdown
- [ ] D16: save a view, then open View → Choose a view…: under the six cards
      a "My views" line lists it as a chip (icon and name), its tooltip the
      paragraph you gave it, or its summary when you gave none. Clicking the
      chip applies the view and closes the gallery. With no saved views the
      line is absent. In both themes.
```

- [ ] **Step 3: Delete the plan and the spec**

```bash
git rm -q docs/superpowers/plans/2026-10-20-gallery-saved-views.md docs/superpowers/specs/2026-10-20-gallery-saved-views-design.md
```

- [ ] **Step 4: Gate and commit**

Run: `npm run check` (prettier covers the roadmap). Expected: clean.

```bash
git add docs/superpowers/handoffs/roadmap.md
git commit -m "D16 ships: its roadmap entry gives way to a manual check, and its spec and plan retire

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011u94ZUBSZPgEppAcs8Tck8"
```
