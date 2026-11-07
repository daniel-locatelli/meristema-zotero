# Meristema Reading sidebar and list tab (R1 step 2b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a reader work a reading list inside Zotero: a "Reading list"
section in the item pane for a paper in a list folder (steps in order, drag
and keyboard reordering, editable reasons, a read-state toggle, next up
highlighted), and the same list in a full-width tab.

**Architecture:** Builds on plan 2a
(`docs/superpowers/plans/2026-11-07-reading-plugin-core.md`). Pure step edits
go in `src/domain/listEdits.ts`. One DOM renderer, `src/zotero/listView.ts`,
draws a list into any container in either of two modes, `sidebar` or `tab`.
The item-pane section and the tab both call it. Every edit goes through
`listStore.editList` or `stateStore.markItems`, which rewrite the notes. A
small change bus (`src/zotero/changes.ts`) tells open views to redraw after
the stores change, whether the change came from this plugin, a sync or the
skill.

**Tech Stack:** as plan 2a.

Spec: `meristema-zotero/docs/superpowers/specs/2026-11-06-reading-lists-design.md`
section 2, the rows "Sidebar section" and "List tab".

## Global Constraints

- Everything in plan 2a's Global Constraints still binds. In particular:
  branch `plugin-core` in
  `C:\repos\github\daniel-locatelli\zotero-meristema-reading`, no push, the
  Zotero suite drives the running plugin only (never imports `src/zotero/`),
  `npm run check` before `npm test`, one `npm test` at a time, never stop the
  user's Zotero, exit codes read plainly, the commit message format with the
  two attribution lines, and no `.only`.
- Spec, verbatim: "Sidebar section | For a list folder, or a paper in one:
  steps in order, drag handles, editable reasons, a read-state toggle, next up
  highlighted." "List tab | Double-click a list: full-width cards to drag,
  reasons in full."
- Spec, verbatim: "The JSON is the source of truth. The plugin rewrites the
  readable part from it on every change." "A note with an unknown `version` or
  unparsable JSON is not a list; readers say so and never rewrite it." "A
  second one is ignored, and the plugin names it in the sidebar."
- Spec, verbatim: "**Next up** is a list's first step that is Reading, else its
  first Unread step."
- Defaults chosen by this plan, for the user to confirm (they are listed in
  the roadmap's manual checks):
  - The section appears for a regular paper selected inside the folder that
    holds the list. Zotero has no item pane for a selected folder.
  - The tab opens from the folder menu ("Open Reading List") and from an
    "Open as Tab" button in the section, not by double-click, because
    double-clicking a note already opens Zotero's note editor.
  - The state toggle cycles Unread, Reading, Read, Unread.
  - A rewrite keeps only the live steps, so a step whose paper left the folder
    goes for good at the next edit (spec: "A merged or deleted paper drops out
    of the list").
  - Alt+Up and Alt+Down move a focused step, as the keyboard path for drag.
- Colours come from Zotero's CSS variables in `addon/content/reading.css`,
  never inline in TypeScript.

## File Structure

```
src/domain/listEdits.ts        place, unplace, shift, reason, next state (create)
test/unit/listEdits.test.ts    (create)
src/zotero/changes.ts          change bus for open views (create)
src/zotero/stateStore.ts       stateOfItem, emits changes (modify)
src/zotero/notifier.ts         emits after clearing lists (modify)
src/zotero/listStore.ts        editList, labelOf exported (modify)
src/zotero/listView.ts         draws a list, wires edits (create)
src/zotero/listSection.ts      the item-pane section (create)
src/zotero/listTab.ts          the list tab (create, Task 3)
src/zotero/menus.ts            Open Reading List (modify, Task 3)
src/hooks.ts                   styles, section, tabs (modify)
addon/content/reading.css      (create)
addon/locale/en-US/mainWindow.ftl  (modify)
test/zotero/helpers.ts         drag, key, view helpers (modify)
test/zotero/listSection.test.ts    (create)
test/zotero/listTab.test.ts        (create, Task 3)
README.md                      (modify, Task 3)
```

---

### Task 1: Step edits

**Files:**

- Create: `src/domain/listEdits.ts`
- Test: `test/unit/listEdits.test.ts`

**Interfaces:**

- Consumes: `ReadingListStep`, `ResolvedList` from `src/format/readingList.ts`;
  `ReadState` from `src/format/readState.ts`.
- Produces:
  - `liveSteps(resolved: ResolvedList): ReadingListStep[]`
  - `placeStep(steps: readonly ReadingListStep[], key: string, beforeKey: string | null): ReadingListStep[]`
  - `unplaceStep(steps: readonly ReadingListStep[], key: string): ReadingListStep[]`
  - `shiftStep(steps: readonly ReadingListStep[], key: string, delta: -1 | 1): ReadingListStep[]`
  - `setWhy(steps: readonly ReadingListStep[], key: string, why: string): ReadingListStep[]`
  - `sameSteps(a: readonly ReadingListStep[], b: readonly ReadingListStep[]): boolean`
  - `nextState(state: ReadState): ReadState`

- [ ] **Step 1: Write the failing test**

`test/unit/listEdits.test.ts`:

```ts
import { describe, it } from "node:test";
import { expect } from "chai";
import {
  liveSteps,
  nextState,
  placeStep,
  sameSteps,
  setWhy,
  shiftStep,
  unplaceStep,
} from "../../src/domain/listEdits";

const A = { key: "AAAA2222", why: "first" };
const B = { key: "BBBB2222", why: "" };
const C = { key: "CCCC3333", why: "third" };
const keys = (steps: { key: string }[]) => steps.map((step) => step.key);

describe("liveSteps", () => {
  it("keeps the resolved steps and their reasons", () => {
    expect(
      liveSteps({
        steps: [
          { step: 1, key: A.key, why: A.why },
          { step: 2, key: C.key, why: C.why },
        ],
        unordered: [B.key],
      }),
    ).to.deep.equal([A, C]);
  });
});

describe("placeStep", () => {
  it("moves a step before another, keeping its reason", () => {
    expect(placeStep([A, B, C], C.key, A.key)).to.deep.equal([C, A, B]);
  });

  it("moves a step to the end", () => {
    expect(placeStep([A, B, C], A.key, null)).to.deep.equal([B, C, A]);
  });

  it("adds an unordered paper with no reason", () => {
    expect(placeStep([A, C], "DDDD4444", C.key)).to.deep.equal([
      A,
      { key: "DDDD4444", why: "" },
      C,
    ]);
  });

  it("changes nothing for a step placed before itself or before a stranger", () => {
    const steps = [A, B];
    expect(placeStep(steps, A.key, A.key)).to.equal(steps);
    expect(placeStep(steps, A.key, "ZZZZ9999")).to.equal(steps);
  });
});

describe("unplaceStep", () => {
  it("takes a step out", () => {
    expect(unplaceStep([A, B, C], B.key)).to.deep.equal([A, C]);
  });
});

describe("shiftStep", () => {
  it("moves a step one place either way", () => {
    expect(keys(shiftStep([A, B, C], A.key, 1))).to.deep.equal([
      B.key,
      A.key,
      C.key,
    ]);
    expect(keys(shiftStep([A, B, C], B.key, 1))).to.deep.equal([
      A.key,
      C.key,
      B.key,
    ]);
    expect(keys(shiftStep([A, B, C], C.key, -1))).to.deep.equal([
      A.key,
      C.key,
      B.key,
    ]);
  });

  it("leaves a step at an end where it is", () => {
    const steps = [A, B];
    expect(shiftStep(steps, A.key, -1)).to.equal(steps);
    expect(shiftStep(steps, B.key, 1)).to.equal(steps);
    expect(shiftStep(steps, "ZZZZ9999", 1)).to.equal(steps);
  });
});

describe("setWhy and sameSteps", () => {
  it("replaces one step's reason", () => {
    expect(setWhy([A, B], B.key, "because")).to.deep.equal([
      A,
      { key: B.key, why: "because" },
    ]);
  });

  it("compares keys and reasons in order", () => {
    expect(sameSteps([A, B], [{ ...A }, { ...B }])).to.equal(true);
    expect(sameSteps([A, B], [B, A])).to.equal(false);
    expect(sameSteps([A, B], [A, { key: B.key, why: "x" }])).to.equal(false);
    expect(sameSteps([A], [A, B])).to.equal(false);
  });
});

describe("nextState", () => {
  it("cycles Unread, Reading, Read", () => {
    expect(nextState("unread")).to.equal("reading");
    expect(nextState("reading")).to.equal("read");
    expect(nextState("read")).to.equal("unread");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run test:unit`
Expected: FAIL; `../../src/domain/listEdits` does not resolve.

- [ ] **Step 3: Write the implementation**

`src/domain/listEdits.ts`:

```ts
import type { ReadingListStep, ResolvedList } from "../format/readingList";
import type { ReadState } from "../format/readState";

/** The steps a reader sees, with their reasons: a step whose paper left the folder is gone. */
export function liveSteps(resolved: ResolvedList): ReadingListStep[] {
  return resolved.steps.map((step) => ({ key: step.key, why: step.why }));
}

/**
 * `steps` with `key` placed just before `beforeKey`, or last when `beforeKey`
 * is null. A step keeps its reason when it moves; a paper new to the steps
 * gets none. Placing a step before itself, or before a key not in the steps,
 * returns `steps` unchanged.
 */
export function placeStep(
  steps: readonly ReadingListStep[],
  key: string,
  beforeKey: string | null,
): ReadingListStep[] {
  if (key === beforeKey) return steps as ReadingListStep[];
  const moving = steps.find((step) => step.key === key) ?? { key, why: "" };
  const rest = steps.filter((step) => step.key !== key);
  const at =
    beforeKey === null
      ? rest.length
      : rest.findIndex((step) => step.key === beforeKey);
  if (at < 0) return steps as ReadingListStep[];
  return [...rest.slice(0, at), moving, ...rest.slice(at)];
}

/** `steps` without `key`: its paper goes back among the unordered. */
export function unplaceStep(
  steps: readonly ReadingListStep[],
  key: string,
): ReadingListStep[] {
  return steps.filter((step) => step.key !== key);
}

/** `steps` with `key` one place earlier (-1) or later (1); at an end, unchanged. */
export function shiftStep(
  steps: readonly ReadingListStep[],
  key: string,
  delta: -1 | 1,
): ReadingListStep[] {
  const index = steps.findIndex((step) => step.key === key);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= steps.length) {
    return steps as ReadingListStep[];
  }
  const before =
    delta < 0 ? steps[target].key : (steps[target + 1]?.key ?? null);
  return placeStep(steps, key, before);
}

export function setWhy(
  steps: readonly ReadingListStep[],
  key: string,
  why: string,
): ReadingListStep[] {
  return steps.map((step) => (step.key === key ? { key, why } : step));
}

export function sameSteps(
  a: readonly ReadingListStep[],
  b: readonly ReadingListStep[],
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (step, index) => step.key === b[index].key && step.why === b[index].why,
    )
  );
}

/** Where a step's toggle goes next: Unread, then Reading, then Read, then Unread. */
export function nextState(state: ReadState): ReadState {
  return state === "unread"
    ? "reading"
    : state === "reading"
      ? "read"
      : "unread";
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npm run lint:fix` then `npm run check`
Expected: exits 0; the new file's 12 tests pass along with the earlier ones.

- [ ] **Step 5: Commit**

```bash
git add src/domain/listEdits.ts test/unit/listEdits.test.ts
git commit
```

Message: `Move, add, take out and annotate a list's steps`, then the two
attribution lines.

---

### Task 2: The Reading list section

**Files:**

- Create: `src/zotero/changes.ts`, `src/zotero/listView.ts`,
  `src/zotero/listSection.ts`, `addon/content/reading.css`,
  `test/zotero/listSection.test.ts`
- Modify: `src/zotero/stateStore.ts`, `src/zotero/notifier.ts`,
  `src/zotero/listStore.ts`, `src/hooks.ts`,
  `addon/locale/en-US/mainWindow.ftl`, `test/zotero/helpers.ts`

**Interfaces:**

- Consumes: Task 1's edits; plan 2a's `listFor`, `FolderList`, `markItems`,
  `UnreadableStateError`, `enqueue`, `report`, `libraryLinkOf`, the notifier's
  `flush`.
- Produces:
  - `onChange(listener: () => void): () => void`, `emitChange(): void`
  - `stateOfItem(item: Zotero.Item): ReadState` (stateStore)
  - `editList(collectionID: number, edit: (steps: ReadingListStep[]) => ReadingListStep[]): Promise<void>`,
    `class UnreadableListError extends Error`, `labelOf(item: Zotero.Item): string`
    (listStore)
  - `renderList(container: HTMLElement, collectionID: number, options: ListViewOptions): void`,
    `interface ListViewOptions { mode: "sidebar" | "tab"; currentKey: string | null; onOpenTab?: () => void }`
  - `registerListSection(openTab: (collectionID: number) => void): void`,
    `unregisterListSection(): void`
  - DOM contract the tests read: container `.mr-list.mr-sidebar` (or
    `.mr-tab`), rows `li.mr-step[data-key]` with `.mr-handle`, `.mr-number`,
    `button.mr-state[data-state]`, `.mr-title`, `textarea.mr-why`; rows
    `li.mr-paper[data-key]` in `ul.mr-unordered`; `.mr-next`, `.mr-current`,
    `.mr-ignored`, `.mr-failure`, `.mr-topic`, `button.mr-open-tab`.

- [ ] **Step 1: Write the helpers and the failing cases**

Append to `test/zotero/helpers.ts`:

```ts
/** Drags `source` onto `target` the way the view listens for it. */
export function drag(win: any, source: Element, target: Element): void {
  const dataTransfer = new win.DataTransfer();
  const fire = (node: Element, type: string) =>
    node.dispatchEvent(
      new win.DragEvent(type, {
        bubbles: true,
        cancelable: true,
        dataTransfer,
      }),
    );
  fire(source, "dragstart");
  fire(target, "dragover");
  fire(target, "drop");
  fire(source, "dragend");
}

export function altArrow(
  win: any,
  target: Element,
  key: "ArrowUp" | "ArrowDown",
): void {
  target.dispatchEvent(
    new win.KeyboardEvent("keydown", { key, altKey: true, bubbles: true }),
  );
}

/** The keys of a view's rows of one kind, in order. */
export function rowKeys(view: Element | null, selector: string): string[] {
  if (!view) return [];
  return Array.from(view.querySelectorAll(selector)).map(
    (row) => (row as HTMLElement).dataset.key ?? "",
  );
}

export async function makeListNote(
  collectionID: number,
  html: string,
): Promise<Zotero.Item> {
  const note = new Zotero.Item("note");
  note.libraryID = Zotero.Libraries.userLibraryID;
  note.setNote(html);
  note.addTag("meristema-reading-list");
  note.setCollections([collectionID]);
  await note.saveTx();
  return note;
}
```

`test/zotero/listSection.test.ts`:

```ts
/// <reference types="mocha" />
import { expect } from "chai";
import {
  parseReadingList,
  writeReadingList,
  type ReadingListDoc,
  type ReadingListStep,
} from "../../src/format/readingList";
import { parseReadState, type ReadStateDoc } from "../../src/format/readState";
import {
  altArrow,
  drag,
  eraseStateNotes,
  idle,
  makeListNote,
  makePaper,
  rowKeys,
  stateNotes,
  waitFor,
} from "./helpers";

const TOPIC = "Section fixture";

describe("The Reading list section", function () {
  this.timeout(60_000);
  let win: any;
  let collection: Zotero.Collection;
  let a: Zotero.Item;
  let b: Zotero.Item;
  let c: Zotero.Item;
  let note: Zotero.Item;
  const extraNotes: number[] = [];

  const view = () =>
    win.document.querySelector(".mr-list.mr-sidebar") as HTMLElement | null;
  const row = (key: string) =>
    view()!.querySelector(`[data-key="${key}"]`) as HTMLElement;
  const stepsInNote = (): ReadingListStep[] => {
    const parsed = parseReadingList(note.getNote());
    expect(parsed.ok, `the list note parses: ${note.getNote()}`).to.equal(true);
    return (parsed as { ok: true; value: ReadingListDoc }).value.steps;
  };
  async function untilSteps(keys: string[]): Promise<void> {
    const ok = await waitFor(
      () => rowKeys(view(), ".mr-step").join() === keys.join(),
      10_000,
    );
    expect(
      ok,
      `the section shows ${keys}; it shows ${rowKeys(view(), ".mr-step")}`,
    ).to.equal(true);
  }

  before(async function () {
    win = Zotero.getMainWindows()[0];
    await eraseStateNotes();
    collection = new Zotero.Collection();
    collection.libraryID = Zotero.Libraries.userLibraryID;
    collection.name = TOPIC;
    await collection.saveTx();
    a = await makePaper("Paper A", undefined, collection.id);
    b = await makePaper("Paper B", undefined, collection.id);
    c = await makePaper("Paper C", undefined, collection.id);
    note = await makeListNote(
      collection.id,
      writeReadingList(
        {
          version: 1,
          topic: TOPIC,
          steps: [
            { key: a.key, why: "first" },
            { key: b.key, why: "" },
          ],
        },
        (key) => key,
        { kind: "user" },
      ),
    );
    await idle();
  });

  after(async function () {
    win.Zotero_Tabs.select("zotero-pane");
    await win.ZoteroPane.collectionsView.selectLibrary(
      Zotero.Libraries.userLibraryID,
    );
    await Zotero.Items.erase([note.id, ...extraNotes, a.id, b.id, c.id]);
    await collection.eraseTx();
    await eraseStateNotes();
    await idle();
  });

  it("shows the steps, the unordered papers and next up for a paper in the folder", async function () {
    await win.ZoteroPane.collectionsView.selectCollection(collection.id);
    await win.ZoteroPane.selectItem(b.id);
    await untilSteps([a.key, b.key]);
    expect(rowKeys(view(), ".mr-paper"), "unordered papers").to.deep.equal([
      c.key,
    ]);
    expect(rowKeys(view(), ".mr-next"), "next up").to.deep.equal([a.key]);
    expect(rowKeys(view(), ".mr-current"), "the selected paper").to.deep.equal([
      b.key,
    ]);
    expect(view()!.querySelector(".mr-topic")?.textContent).to.equal(TOPIC);
    expect(
      (row(a.key).querySelector(".mr-why") as HTMLTextAreaElement).value,
    ).to.equal("first");
  });

  it("moves a step with Alt+Down and rewrites the note", async function () {
    altArrow(win, row(a.key), "ArrowDown");
    await idle();
    expect(stepsInNote()).to.deep.equal([
      { key: b.key, why: "" },
      { key: a.key, why: "first" },
    ]);
    const html = note.getNote();
    expect(
      html.indexOf(`items/${b.key}`),
      "readable part rebuilt in the new order",
    ).to.be.lessThan(html.indexOf(`items/${a.key}`));
    await untilSteps([b.key, a.key]);
  });

  it("drops an unordered paper into the steps before the step it lands on", async function () {
    drag(win, row(c.key), row(b.key));
    await idle();
    expect(stepsInNote().map((step) => step.key)).to.deep.equal([
      c.key,
      b.key,
      a.key,
    ]);
    await untilSteps([c.key, b.key, a.key]);
  });

  it("takes a step out when it is dropped on the unordered papers", async function () {
    drag(
      win,
      row(a.key).querySelector(".mr-handle")!,
      view()!.querySelector(".mr-unordered")!,
    );
    await idle();
    expect(stepsInNote().map((step) => step.key)).to.deep.equal([c.key, b.key]);
    await untilSteps([c.key, b.key]);
    expect(rowKeys(view(), ".mr-paper")).to.deep.equal([a.key]);
  });

  it("saves an edited reason", async function () {
    const why = row(b.key).querySelector(".mr-why") as HTMLTextAreaElement;
    why.value = 'Read <this> & "that"';
    why.dispatchEvent(new win.Event("change", { bubbles: true }));
    await idle();
    expect(stepsInNote()).to.deep.equal([
      { key: c.key, why: "" },
      { key: b.key, why: 'Read <this> & "that"' },
    ]);
  });

  it("toggles a step's read state, and next up follows", async function () {
    (row(b.key).querySelector(".mr-state") as HTMLElement).click();
    await idle();
    const [stateNote] = await stateNotes();
    const parsed = parseReadState(stateNote.getNote());
    expect(
      (parsed as { ok: true; value: ReadStateDoc }).value.states[
        `user:${b.key}`
      ]?.state,
    ).to.equal("reading");
    expect(b.hasTag("_reading"), "the mirror tag").to.equal(true);
    const moved = await waitFor(
      () => rowKeys(view(), ".mr-next")[0] === b.key,
      10_000,
    );
    expect(
      moved,
      `next up is the Reading step; it is ${rowKeys(view(), ".mr-next")}`,
    ).to.equal(true);
  });

  it("names a second list note it ignores", async function () {
    const second = await makeListNote(
      collection.id,
      writeReadingList(
        { version: 1, topic: "Second list", steps: [] },
        (key) => key,
        {
          kind: "user",
        },
      ),
    );
    extraNotes.push(second.id);
    await idle();
    const named = await waitFor(
      () =>
        view()
          ?.querySelector(".mr-ignored")
          ?.textContent?.includes("Second list"),
      10_000,
    );
    expect(named, "the ignored note is named").to.equal(true);
  });

  it("says a list it cannot read and offers no editing", async function () {
    const broken = '<pre data-meristema-reading-list="1">{"version":2}</pre>';
    note.setNote(broken);
    await note.saveTx();
    await idle();
    const said = await waitFor(
      () =>
        view()
          ?.querySelector(".mr-failure")
          ?.textContent?.includes("unknown-version"),
      10_000,
    );
    expect(said, "the section says the list cannot be read").to.equal(true);
    expect(view()!.querySelectorAll(".mr-step, .mr-why").length).to.equal(0);
    expect(note.getNote(), "the note is left as it was").to.equal(broken);
  });
});
```

- [ ] **Step 2: Gate, then see the cases fail**

Run: `npm run lint:fix` then `npm run check`
Expected: exits 0.

Run: `npm test`
Expected: plan 2a's 9 cases pass. The new file's first case fails on "the
section shows ...", and the cases after it fail too.

- [ ] **Step 3: Write the change bus and the store additions**

`src/zotero/changes.ts`:

```ts
import { report } from "./report";

const listeners = new Set<() => void>();

/** Calls `listener` after the stores change; returns the unsubscribe. */
export function onChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitChange(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      report(error);
    }
  }
}
```

`src/zotero/stateStore.ts`: add the imports

```ts
import { stateOf } from "../format/readState";
import { emitChange } from "./changes";
```

(merge `stateOf` into the existing `../format/readState` import), add

```ts
/** A paper's read state, as the last read of the state note had it. */
export function stateOfItem(item: Zotero.Item): ReadState {
  return stateOf(doc, paperId(paperRefOf(item)));
}
```

and call `emitChange();` as the last statement inside the task of
`startStateStore`, of `markItems` (also before its `return` when
`next === doc`), and of `stateChanged`.

`src/zotero/notifier.ts`: import `emitChange` from `./changes` and, in
`flush`, call `emitChange();` right after `refreshStepColumn();`.

`src/zotero/listStore.ts`: export `labelOf` (it already exists; add
`export`), add the imports

```ts
import { liveSteps, sameSteps } from "../domain/listEdits";
import type { ReadingListStep } from "../format/readingList";
```

and append:

```ts
export class UnreadableListError extends Error {}

/**
 * Edits a folder's steps and rewrites its list note, the readable part rebuilt
 * from the JSON. `edit` gets the live steps, as readers resolve them. A list
 * that cannot be read is never rewritten.
 */
export function editList(
  collectionID: number,
  edit: (steps: ReadingListStep[]) => ReadingListStep[],
): Promise<void> {
  return enqueue(async () => {
    cache.delete(collectionID);
    const list = listFor(collectionID);
    if (!list?.doc || !list.resolved) {
      throw new UnreadableListError(
        "This folder's reading list cannot be read, so it was not changed.",
      );
    }
    const steps = liveSteps(list.resolved);
    const next = edit(steps);
    if (sameSteps(steps, next)) return;
    const collection = Zotero.Collections.get(
      collectionID,
    ) as Zotero.Collection;
    const note = Zotero.Items.get(list.noteID) as Zotero.Item;
    const doc: ReadingListDoc = {
      version: 1,
      topic: list.doc.topic,
      steps: next,
    };
    note.setNote(
      writeReadingList(
        doc,
        (key) => {
          const item = Zotero.Items.getByLibraryAndKey(
            collection.libraryID,
            key,
          );
          return item ? labelOf(item as Zotero.Item) : key;
        },
        libraryLinkOf(collection.libraryID),
      ),
    );
    await note.saveTx();
    cache.delete(collectionID);
  });
}
```

- [ ] **Step 4: Write the view**

`src/zotero/listView.ts`:

```ts
import {
  nextState,
  placeStep,
  setWhy,
  shiftStep,
  unplaceStep,
} from "../domain/listEdits";
import type { ReadingListStep, ResolvedStep } from "../format/readingList";
import { nextUp, type ReadState } from "../format/readState";
import { editList, labelOf, listFor, UnreadableListError } from "./listStore";
import { report } from "./report";
import { markItems, stateOfItem, UnreadableStateError } from "./stateStore";

const HTML = "http://www.w3.org/1999/xhtml";
const STATE_LABEL: Record<ReadState, string> = {
  unread: "Unread",
  reading: "Reading",
  read: "Read",
};

/** The key being dragged, shared by every view so a drag can cross rows. */
let dragged: string | null = null;

export interface ListViewOptions {
  mode: "sidebar" | "tab";
  /** The paper selected in the item list, marked in the sidebar. */
  currentKey: string | null;
  onOpenTab?: () => void;
}

function failed(error: unknown): void {
  if (
    error instanceof UnreadableStateError ||
    error instanceof UnreadableListError
  ) {
    Zotero.alert(Zotero.getMainWindow(), "Meristema Reading", error.message);
    return;
  }
  report(error);
}

function element<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElementNS(HTML, tag) as HTMLElementTagNameMap[K];
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function allowDrop(event: DragEvent): void {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
}

/** Draws a folder's reading list into `container`, wiring every edit to the stores. */
export function renderList(
  container: HTMLElement,
  collectionID: number,
  options: ListViewOptions,
): void {
  const doc = container.ownerDocument;
  container.replaceChildren();
  container.classList.add("mr-list", `mr-${options.mode}`);
  const list = listFor(collectionID);
  if (!list) {
    container.append(
      element(doc, "p", "mr-empty", "This folder holds no reading list."),
    );
    return;
  }
  for (const id of list.ignoredNoteIDs) {
    const other = Zotero.Items.get(id) as Zotero.Item | false;
    const title = other ? other.getNoteTitle() : String(id);
    container.append(
      element(
        doc,
        "p",
        "mr-ignored",
        `Ignored: a second list note, “${title}”. A folder keeps one list.`,
      ),
    );
  }
  if (!list.doc || !list.resolved) {
    container.append(
      element(
        doc,
        "p",
        "mr-failure",
        `This folder's reading list cannot be read (${list.failure}). Meristema Reading leaves it as it is.`,
      ),
    );
    return;
  }

  const collection = Zotero.Collections.get(collectionID) as Zotero.Collection;
  const itemOf = (key: string) =>
    Zotero.Items.getByLibraryAndKey(collection.libraryID, key) as
      Zotero.Item | false;
  const stateOfKey = (key: string): ReadState => {
    const item = itemOf(key);
    return item ? stateOfItem(item) : "unread";
  };
  const edit = (change: (steps: ReadingListStep[]) => ReadingListStep[]) => {
    void editList(collectionID, change).catch(failed);
  };
  const next = nextUp(list.resolved.steps, stateOfKey);

  container.append(element(doc, "div", "mr-topic", list.doc.topic));
  if (options.onOpenTab) {
    const open = element(doc, "button", "mr-open-tab", "Open as Tab");
    open.addEventListener("click", () => options.onOpenTab?.());
    container.append(open);
  }

  function paperParts(row: HTMLElement, key: string): void {
    const item = itemOf(key);
    const state = stateOfKey(key);
    const toggle = element(doc, "button", "mr-state", STATE_LABEL[state]);
    toggle.dataset.state = state;
    toggle.title = `Mark ${STATE_LABEL[nextState(state)]}`;
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      if (item) void markItems([item], nextState(state)).catch(failed);
    });
    const title = element(doc, "span", "mr-title", item ? labelOf(item) : key);
    title.addEventListener("click", () => {
      if (item) void Zotero.getActiveZoteroPane()?.selectItem(item.id);
    });
    row.append(toggle, title);
    row.dataset.key = key;
    if (key === next) row.classList.add("mr-next");
    if (key === options.currentKey) row.classList.add("mr-current");
    row.addEventListener("dragstart", (event) => {
      dragged = key;
      event.dataTransfer?.setData("text/plain", key);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragend", () => {
      dragged = null;
    });
  }

  function stepRow(step: ResolvedStep): HTMLElement {
    const row = element(doc, "li", "mr-step");
    row.tabIndex = 0;
    const handle = element(doc, "span", "mr-handle", "⠿");
    handle.draggable = true;
    handle.title = "Drag to reorder, or Alt+Up and Alt+Down";
    row.append(handle, element(doc, "span", "mr-number", String(step.step)));
    paperParts(row, step.key);
    const why = element(doc, "textarea", "mr-why");
    why.value = step.why;
    why.rows = options.mode === "tab" ? 3 : 1;
    why.placeholder = "Why read it";
    why.addEventListener("change", () =>
      edit((steps) => setWhy(steps, step.key, why.value)),
    );
    why.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        why.value = step.why;
        why.blur();
      }
    });
    row.append(why);
    row.addEventListener("keydown", (event) => {
      if (event.target === why || !event.altKey) return;
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      edit((steps) =>
        shiftStep(steps, step.key, event.key === "ArrowUp" ? -1 : 1),
      );
    });
    row.addEventListener("dragover", allowDrop);
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const moving = dragged;
      dragged = null;
      if (moving) edit((steps) => placeStep(steps, moving, step.key));
    });
    return row;
  }

  const steps = element(doc, "ol", "mr-steps");
  for (const step of list.resolved.steps) steps.append(stepRow(step));
  steps.addEventListener("dragover", allowDrop);
  steps.addEventListener("drop", (event) => {
    event.preventDefault();
    const moving = dragged;
    dragged = null;
    if (moving) edit((current) => placeStep(current, moving, null));
  });
  container.append(steps);

  container.append(
    element(doc, "div", "mr-unordered-title", "Not in the steps"),
  );
  const unordered = element(doc, "ul", "mr-unordered");
  for (const key of list.resolved.unordered) {
    const row = element(doc, "li", "mr-paper");
    row.draggable = true;
    paperParts(row, key);
    unordered.append(row);
  }
  unordered.addEventListener("dragover", allowDrop);
  unordered.addEventListener("drop", (event) => {
    event.preventDefault();
    const moving = dragged;
    dragged = null;
    if (moving) edit((current) => unplaceStep(current, moving));
  });
  container.append(unordered);
}
```

- [ ] **Step 5: Write the section, the styles, the strings and the startup wiring**

`src/zotero/listSection.ts`:

```ts
import { config } from "../../package.json";
import { onChange } from "./changes";
import { listFor } from "./listStore";
import { renderList } from "./listView";
import { report } from "./report";

const ICON = `chrome://${config.addonRef}/content/icons/reading.svg`;
let paneKey: string | false = false;
let unsubscribe: (() => void) | null = null;
const refreshers = new Map<HTMLElement, () => Promise<void>>();

/** The selected folder, when it holds a list and `item` is a paper in it. */
function listFolderOf(item: Zotero.Item | null): number | null {
  if (!item?.isRegularItem?.()) return null;
  const collectionID =
    Zotero.getActiveZoteroPane()?.getSelectedCollection(true);
  if (!collectionID) return null;
  const collection = Zotero.Collections.get(collectionID) as
    Zotero.Collection | false;
  if (!collection || !collection.hasItem(item.id)) return null;
  return listFor(collectionID) ? collectionID : null;
}

export function registerListSection(
  openTab: (collectionID: number) => void,
): void {
  if (paneKey) return;
  paneKey = Zotero.ItemPaneManager.registerSection({
    paneID: "reading-list",
    pluginID: config.addonID,
    header: { l10nID: `${config.addonRef}-section-header`, icon: ICON },
    sidenav: { l10nID: `${config.addonRef}-section-sidenav`, icon: ICON },
    onInit: ({
      body,
      refresh,
    }: {
      body: HTMLElement;
      refresh: () => Promise<void>;
    }) => {
      refreshers.set(body, refresh);
    },
    onDestroy: ({ body }: { body: HTMLElement }) => {
      refreshers.delete(body);
    },
    onItemChange: ({
      item,
      tabType,
      setEnabled,
    }: {
      item: Zotero.Item;
      tabType: string;
      setEnabled: (enabled: boolean) => void;
    }) => {
      setEnabled(tabType === "library" && listFolderOf(item) !== null);
    },
    onRender: ({ body, item }: { body: HTMLElement; item: Zotero.Item }) => {
      const collectionID = listFolderOf(item);
      if (collectionID === null) {
        body.replaceChildren();
        return;
      }
      renderList(body, collectionID, {
        mode: "sidebar",
        currentKey: item.key,
        onOpenTab: () => openTab(collectionID),
      });
    },
  } as any);
  unsubscribe = onChange(() => {
    for (const refresh of refreshers.values()) void refresh().catch(report);
  });
}

export function unregisterListSection(): void {
  unsubscribe?.();
  unsubscribe = null;
  refreshers.clear();
  if (!paneKey) return;
  try {
    Zotero.ItemPaneManager.unregisterSection(paneKey);
  } catch (error) {
    report(error);
  }
  paneKey = false;
}
```

`addon/content/reading.css`:

```css
.mr-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mr-topic {
  font-weight: 600;
}
.mr-steps,
.mr-unordered {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 20px;
}
.mr-step,
.mr-paper {
  display: grid;
  grid-template-columns: auto auto auto 1fr;
  align-items: center;
  gap: 4px 6px;
  padding: 4px;
  border-radius: 5px;
  border: 1px solid var(--material-border-quinary, transparent);
}
.mr-paper {
  grid-template-columns: auto 1fr;
  cursor: grab;
}
.mr-step .mr-why {
  grid-column: 1 / -1;
}
.mr-handle {
  cursor: grab;
  color: var(--fill-secondary);
}
.mr-number {
  font-variant-numeric: tabular-nums;
  color: var(--fill-secondary);
}
.mr-title {
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mr-next {
  border-color: var(--color-accent);
}
.mr-current {
  background: var(--fill-quinary);
}
.mr-state {
  font-size: 0.9em;
}
.mr-state[data-state="reading"] {
  color: var(--color-accent);
}
.mr-state[data-state="read"] {
  color: var(--fill-secondary);
}
.mr-why {
  resize: vertical;
  font: inherit;
  width: 100%;
  box-sizing: border-box;
}
.mr-unordered-title,
.mr-ignored,
.mr-failure,
.mr-empty {
  color: var(--fill-secondary);
  margin: 0;
}
.mr-unordered:empty::after {
  content: "Drop a step here to take it out of the steps.";
  color: var(--fill-tertiary);
  font-size: 0.9em;
}
.mr-open-tab {
  align-self: flex-start;
}
.mr-tab-scroll {
  overflow: auto;
  height: 100%;
  padding: 16px;
  box-sizing: border-box;
  background: var(--material-background);
}
.mr-tab {
  max-width: 760px;
  margin: 0 auto;
}
.mr-tab .mr-step {
  padding: 10px 12px;
}
.mr-tab .mr-title {
  white-space: normal;
}
```

Append to `addon/locale/en-US/mainWindow.ftl`:

```
section-header =
    .label = Reading list
section-sidenav =
    .tooltiptext = Reading list
```

`src/hooks.ts`: add the stylesheet and the section. Add the import
`import { registerListSection, unregisterListSection } from "./zotero/listSection";`
and these definitions above `onStartup`:

```ts
const STYLESHEET_ID = `${config.addonRef}-stylesheet`;

function installStyles(win: _ZoteroTypes.MainWindow): void {
  const doc = win.document;
  if (doc.getElementById(STYLESHEET_ID)) return;
  const link = doc.createElementNS("http://www.w3.org/1999/xhtml", "link");
  link.id = STYLESHEET_ID;
  link.setAttribute("rel", "stylesheet");
  link.setAttribute("href", `chrome://${config.addonRef}/content/reading.css`);
  (doc.head ?? doc.documentElement).appendChild(link);
}

function removeStyles(win: _ZoteroTypes.MainWindow): void {
  win.document.getElementById(STYLESHEET_ID)?.remove();
}
```

In `onMainWindowLoad`, after the FTL line, call `installStyles(win);`. In
`onStartup`, after `await registerStepColumn();`, call
`registerListSection(() => undefined);` (Task 3 passes the tab opener). In
`onShutdown`, first call `unregisterListSection();`, and before
`addon.data.alive = false;` call
`for (const win of Zotero.getMainWindows()) removeStyles(win);`.

- [ ] **Step 6: Gate, then run the Zotero suite**

Run: `npm run lint:fix` then `npm run check`
Expected: exits 0.

Run: `npm test`
Expected: `17 passing` (9 from plan 2a, 8 here), exit 0. A failing case's
assertion message carries the evidence. Find the cause before changing code,
and re-run twice any case that looks timing-dependent.

- [ ] **Step 7: Commit**

```bash
git add src/zotero/changes.ts src/zotero/listView.ts src/zotero/listSection.ts src/zotero/stateStore.ts src/zotero/notifier.ts src/zotero/listStore.ts src/hooks.ts addon/content/reading.css addon/locale/en-US/mainWindow.ftl test/zotero/helpers.ts test/zotero/listSection.test.ts
git commit
```

Message: `Work a reading list from the item pane: reorder, annotate, mark`,
then the two attribution lines.

---

### Task 3: The list tab

**Files:**

- Create: `src/zotero/listTab.ts`, `test/zotero/listTab.test.ts`
- Modify: `src/zotero/menus.ts`, `src/hooks.ts`,
  `addon/locale/en-US/mainWindow.ftl`, `README.md`

**Interfaces:**

- Consumes: Task 2's `renderList`, `onChange`, `registerListSection`; plan
  2a's `listFor`, menus.
- Produces: `installTabHooks(win)`, `openListTab(collectionID: number, win?): void`,
  `startListTabs()`, `closeListTabs()`; tab type `meristemareading-list`, tab
  id `meristemareading-list-<collectionID>`; menu l10n id
  `meristemareading-open-reading-list`.

- [ ] **Step 1: Write the failing cases**

`test/zotero/listTab.test.ts`:

```ts
/// <reference types="mocha" />
import { expect } from "chai";
import { config } from "../../package.json";
import {
  parseReadingList,
  writeReadingList,
  type ReadingListDoc,
} from "../../src/format/readingList";
import {
  altArrow,
  collectionMenuEntry,
  command,
  idle,
  makeListNote,
  makePaper,
  rowKeys,
  waitFor,
} from "./helpers";

const OPEN = `${config.addonRef}-open-reading-list`;
const TAB_TYPE = `${config.addonRef}-list`;
const TOPIC = "Tab fixture";

describe("The list tab", function () {
  this.timeout(60_000);
  let win: any;
  let collection: Zotero.Collection;
  let x: Zotero.Item;
  let y: Zotero.Item;
  let note: Zotero.Item;

  const listTabs = () =>
    (win.Zotero_Tabs._tabs as any[]).filter((tab) => tab.type === TAB_TYPE);
  const view = () =>
    win.document.querySelector(".mr-list.mr-tab") as HTMLElement | null;

  async function openFromMenu(): Promise<void> {
    win.Zotero_Tabs.select("zotero-pane");
    const { popup, entry } = await collectionMenuEntry(
      win,
      collection.id,
      OPEN,
    );
    expect(
      Boolean(entry) && !entry.hidden,
      "Open Reading List offered",
    ).to.equal(true);
    command(entry);
    popup.hidePopup();
  }

  before(async function () {
    win = Zotero.getMainWindows()[0];
    collection = new Zotero.Collection();
    collection.libraryID = Zotero.Libraries.userLibraryID;
    collection.name = TOPIC;
    await collection.saveTx();
    x = await makePaper("Paper X", undefined, collection.id);
    y = await makePaper("Paper Y", undefined, collection.id);
    note = await makeListNote(
      collection.id,
      writeReadingList(
        {
          version: 1,
          topic: TOPIC,
          steps: [
            { key: x.key, why: "why x" },
            { key: y.key, why: "" },
          ],
        },
        (key) => key,
        { kind: "user" },
      ),
    );
    await idle();
  });

  after(async function () {
    for (const tab of listTabs()) win.Zotero_Tabs.close(tab.id);
    win.Zotero_Tabs.select("zotero-pane");
    await win.ZoteroPane.collectionsView.selectLibrary(
      Zotero.Libraries.userLibraryID,
    );
    await Zotero.Items.erase([note.id, x.id, y.id]);
    await collection.eraseTx();
    await idle();
  });

  it("opens the list in a tab from the folder menu, reasons in full", async function () {
    await openFromMenu();
    const tab = await waitFor(() => listTabs()[0], 10_000);
    expect(tab, "the list tab").to.exist;
    expect(tab.title).to.equal(TOPIC);
    const shown = await waitFor(
      () => rowKeys(view(), ".mr-step").join() === [x.key, y.key].join(),
      10_000,
    );
    expect(shown, `the tab's cards: ${rowKeys(view(), ".mr-step")}`).to.equal(
      true,
    );
    const why = view()!.querySelector(
      `[data-key="${x.key}"] .mr-why`,
    ) as HTMLTextAreaElement;
    expect(why.value).to.equal("why x");
    expect(why.rows, "reasons in full").to.equal(3);
  });

  it("reorders from the tab and rewrites the note", async function () {
    altArrow(win, view()!.querySelector(`[data-key="${y.key}"]`)!, "ArrowUp");
    await idle();
    const parsed = parseReadingList(note.getNote());
    expect(
      (parsed as { ok: true; value: ReadingListDoc }).value.steps.map(
        (step) => step.key,
      ),
    ).to.deep.equal([y.key, x.key]);
    const redrawn = await waitFor(
      () => rowKeys(view(), ".mr-step").join() === [y.key, x.key].join(),
      10_000,
    );
    expect(redrawn, "the tab redraws").to.equal(true);
  });

  it("selects the open tab rather than opening a second", async function () {
    await openFromMenu();
    await idle();
    expect(listTabs(), "list tabs").to.have.length(1);
    expect(win.Zotero_Tabs.selectedID).to.equal(listTabs()[0].id);
  });

  it("closes", async function () {
    win.Zotero_Tabs.close(listTabs()[0].id);
    const gone = await waitFor(() => !view(), 10_000);
    expect(gone, "the tab's view is gone").to.equal(true);
  });
});
```

- [ ] **Step 2: Gate, then see the cases fail**

Run: `npm run lint:fix` then `npm run check`
Expected: exits 0.

Run: `npm test`
Expected: the 17 earlier cases pass, and the first list-tab case fails on
"Open Reading List offered".

- [ ] **Step 3: Write the tab**

`src/zotero/listTab.ts`:

```ts
import { config } from "../../package.json";
import { onChange } from "./changes";
import { listFor } from "./listStore";
import { renderList } from "./listView";
import { report } from "./report";

const TAB_TYPE = `${config.addonRef}-list`;
const HOOK_MARKER = "__meristemaReadingTabHooks";
const views = new Map<
  string,
  { container: HTMLElement; collectionID: number }
>();
let unsubscribe: (() => void) | null = null;

/**
 * Keeps list tabs out of Zotero's saved session: a restored tab would come
 * back with no view, so the reader reopens it from the folder instead.
 */
export function installTabHooks(win: _ZoteroTypes.MainWindow): void {
  const manager = win.Zotero_Tabs;
  if (!manager || manager[HOOK_MARKER]) return;
  const getState = manager.getState.bind(manager);
  manager.getState = (): any[] =>
    getState().filter(
      (tab: any) =>
        String(tab?.type ?? "").replace(/-unloaded$/, "") !== TAB_TYPE,
    );
  manager[HOOK_MARKER] = true;
}

function render(tabID: string): void {
  const view = views.get(tabID);
  if (!view) return;
  renderList(view.container, view.collectionID, {
    mode: "tab",
    currentKey: null,
  });
}

/** Opens a folder's list as a tab, or selects the tab already showing it. */
export function openListTab(
  collectionID: number,
  win: _ZoteroTypes.MainWindow = Zotero.getMainWindow(),
): void {
  const manager = win.Zotero_Tabs;
  const tabID = `${TAB_TYPE}-${collectionID}`;
  if ((manager._tabs as any[]).some((tab) => tab.id === tabID)) {
    manager.select(tabID);
    return;
  }
  const list = listFor(collectionID);
  if (!list) return;
  const collection = Zotero.Collections.get(collectionID) as
    Zotero.Collection | false;
  const title =
    list.doc?.topic || (collection ? collection.name : "Reading list");
  const { container } = manager.add({
    id: tabID,
    type: TAB_TYPE,
    title,
    data: { collectionID },
    select: true,
    onClose: () => {
      views.delete(tabID);
    },
  });
  const scroll = container.ownerDocument.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  ) as HTMLElement;
  scroll.className = "mr-tab-scroll";
  const body = container.ownerDocument.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  ) as HTMLElement;
  scroll.append(body);
  container.append(scroll);
  views.set(tabID, { container: body, collectionID });
  render(tabID);
}

export function startListTabs(): void {
  if (unsubscribe) return;
  unsubscribe = onChange(() => {
    for (const tabID of views.keys()) render(tabID);
  });
}

export function closeListTabs(): void {
  unsubscribe?.();
  unsubscribe = null;
  for (const win of Zotero.getMainWindows()) {
    for (const tabID of views.keys()) {
      try {
        win.Zotero_Tabs.close(tabID);
      } catch (error) {
        report(error);
      }
    }
  }
  views.clear();
}
```

`src/zotero/menus.ts`: import `openListTab` from `./listTab` and add this
entry to the array that `collectionMenus()` returns, after Make Reading List:

```ts
    {
      menuType: "menuitem",
      l10nID: `${config.addonRef}-open-reading-list`,
      icon: ICON,
      onShowing: (_event: Event, context: any) => {
        const id = contextCollectionID(context);
        const available = id !== null && listFor(id) !== null;
        context.setVisible(available);
        context.setEnabled(available);
      },
      onCommand: (_event: Event, context: any) => {
        const id = contextCollectionID(context);
        if (id !== null) openListTab(id);
      },
    },
```

`src/hooks.ts`: import `closeListTabs`, `installTabHooks`, `openListTab` and
`startListTabs` from `./zotero/listTab`. In `onMainWindowLoad`, call
`installTabHooks(win);`. In `onStartup`, replace
`registerListSection(() => undefined);` with
`registerListSection((collectionID) => openListTab(collectionID));` followed
by `startListTabs();`. In `onShutdown`, call `closeListTabs();` first.

Append to `addon/locale/en-US/mainWindow.ftl`:

```
open-reading-list =
    .label = Open Reading List
```

- [ ] **Step 4: Gate, then run the Zotero suite**

Run: `npm run lint:fix` then `npm run check`
Expected: exits 0.

Run: `npm test`
Expected: `21 passing`, exit 0.

- [ ] **Step 5: Add the section and the tab to the README**

In `README.md`'s "The plugin" list, after the Step bullet, add:

```md
- **Reading list** (item pane, for a paper in a list folder): the steps in
  order, next up outlined. Drag a step's handle, or press Alt+Up and Alt+Down,
  to reorder it. Drop a paper from "Not in the steps" onto a step to add it,
  and drop a step there to take it out. Click a state to move it through
  Unread, Reading and Read, and type a reason under a step.
- **Open Reading List** (folder menu, or Open as Tab in the section): the same
  list as full-width cards, reasons in full.
```

Run: `npm run lint:fix` then `npm run check`
Expected: exits 0.

- [ ] **Step 6: Commit and build**

```bash
git add src/zotero/listTab.ts src/zotero/menus.ts src/hooks.ts addon/locale/en-US/mainWindow.ftl test/zotero/listTab.test.ts README.md
git commit
```

Message: `Open a reading list as a tab of full-width cards`, then the two
attribution lines.

Run: `npm run build` (after the last `npm test`, since a test run deletes the
XPI). Expected: exits 0.
