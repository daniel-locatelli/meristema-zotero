# Reading plan view (R1 step 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the shipped "Reading plan" graph view real: x is a new Reading
step metric, y is citations, colour is a new Read state colouring, a reading
path joins each ticked list's steps, and the view is offered only when a ticked
folder holds a reading list.

**Architecture:** Meristema reads the two notes itself with a vendored copy of
the format (`src/readingFormat/`, byte-identical to
`zotero-meristema-reading/src/format/`, plus its fixtures). A pure
`src/domain/readingPlan.ts` turns the notes and the ticked folders into a
`ReadingPlan` (step per paper, state per paper, one path per list). A Zotero
loader (`src/services/readingNoteSource.ts`) reads the notes; a notifier
publishes changes; the graph view recomputes the plan on every scope redraw
and hands it to the renderer, the way it hands over seed marks and regions.

**Tech Stack:** TypeScript, zotero-plugin-scaffold, node:test + chai (unit),
mocha in Zotero (`npm test`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-11-06-reading-lists-design.md`, section 3.
- Meristema needs only the notes, never the Meristema Reading plugin.
- The view's row reads "Needs a reading list in a ticked folder" when no
  ticked folder holds a readable list note (replaces "Arrives with reading
  state").
- x: **Reading step** (1…n; a list's unordered papers at n+1; a paper in no
  ticked list after the last step). y: citations. Colour: **Read state**
  (Unread, Reading, Read). No shapes for read state. Nothing is greyed.
- Read state colours are fixed per state, the same on every graph (user,
  2026-11-07): from `theme.ramp`, Unread `ramp[0]`, Reading `ramp[2]`, Read
  `ramp[4]`. A node with no paper id (an external hop paper) is "Not in
  library" in `theme.categorical.noValue`.
- A paper in two ticked lists takes its step from the first ticked list folder
  in folder-tree order (default; recorded in the roadmap's R1 decisions). Each
  list still draws its own path; a path never joins two lists.
- The reading path is drawn apart from citation edges: never added to
  `model.edges`.
- `src/readingFormat/` and `test/fixtures/reading-format/` are byte-identical
  copies of `zotero-meristema-reading` at 6db87e1 (`src/format/`, `fixtures/`):
  never edit them here; a drift test compares them with the sibling repo when
  it is present.
- Read state is per paper: id `doi:<normalized DOI>` from the DOI field only,
  else `user:<key>` / `group-<id>:<key>`; absent means Unread.
- One list note per folder: the oldest by date added, then key. Unreadable
  notes are skipped (a folder whose list cannot be read has no list).
- State notes: standalone, untrashed, tagged `meristema-reading-state`, in My
  Library; every readable one merged with `mergeReadStates`.
- No `.only` committed. Gate on exit codes, never through a pipe.
- `npm test` launches its own Zotero; never stop the user's zotero.exe; one
  foreground run at a time; full suite every 4 or 5 commits.
- Commits: sentence-case subject, staged by path, message ends with exactly:
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_011u94ZUBSZPgEppAcs8Tck8
  ```

---

## File structure

| File                                                           | Does                                                                    |
| -------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `src/readingFormat/{common,doi,html,readingList,readState}.ts` | Vendored format (read and write; only reads are used).                  |
| `src/readingFormat/SOURCE.md`                                  | Where the copy came from and how to refresh it.                         |
| `test/fixtures/reading-format/**`                              | Vendored fixtures.                                                      |
| `test/unit/readingFormatFixtures.test.ts`                      | The plugin's fixtures runner, import paths changed.                     |
| `test/unit/readingFormatDrift.test.ts`                         | Byte-compares the copy with `../zotero-meristema-reading` when present. |
| `src/domain/readingPlan.ts`                                    | Pure: notes + ticked folders → `ReadingPlan`.                           |
| `src/services/readingNoteSource.ts`                            | Zotero: reads list notes, folder papers, state notes, paper ids.        |
| `src/services/readingNoteEvents.ts`                            | Pub/sub: "a reading note or a folder's papers may have changed".        |
| `src/hooks.ts`                                                 | Registers the notifier that publishes those events.                     |
| metric, colouring, renderer, views files                       | See tasks 3–6.                                                          |
| `test/zotero/graphReadingPlan.test.ts`                         | The Zotero case.                                                        |

---

### Task 1: Vendor the format and its fixtures

**Files:**

- Create: `src/readingFormat/common.ts`, `doi.ts`, `html.ts`, `readingList.ts`, `readState.ts` (copies)
- Create: `src/readingFormat/SOURCE.md`
- Create: `test/fixtures/reading-format/` (copy of the whole `fixtures/` dir)
- Create: `test/unit/readingFormatFixtures.test.ts`, `test/unit/readingFormatDrift.test.ts`
- Modify: `.prettierignore` (and the eslint ignore list in `eslint.config.*` only if eslint flags the copies)

**Interfaces:**

- Produces: `src/readingFormat/readingList.ts` exports `parseReadingList`,
  `resolveReadingList`, `READING_LIST_TAG`, types `FolderItem`,
  `ReadingListDoc`; `src/readingFormat/readState.ts` exports
  `parseReadState`, `mergeReadStates`, `stateOf`, `emptyReadState`,
  `paperId`, `READ_STATE_TAG`, types `ReadState`, `ReadStateDoc`, `PaperRef`;
  `src/readingFormat/common.ts` exports type `LibraryLink`.

- [ ] **Step 1: Copy the files**

```bash
SRC=../zotero-meristema-reading
git -C $SRC rev-parse --short HEAD   # expect 6db87e1
mkdir -p src/readingFormat test/fixtures/reading-format
cp $SRC/src/format/*.ts src/readingFormat/
cp -r $SRC/fixtures/. test/fixtures/reading-format/
cp $SRC/test/unit/fixtures.test.ts test/unit/readingFormatFixtures.test.ts
```

- [ ] **Step 2: Point the runner at the copies**

In `test/unit/readingFormatFixtures.test.ts` replace every
`"../../src/format/` with `"../../src/readingFormat/`, and the root line with:

```ts
const root = fileURLToPath(
  new URL("../fixtures/reading-format/", import.meta.url),
);
```

Change nothing else in the runner.

- [ ] **Step 3: Write `src/readingFormat/SOURCE.md`**

```markdown
# Vendored reading-list format

Byte-identical copy of `zotero-meristema-reading/src/format/` (and its
`fixtures/` in `test/fixtures/reading-format/`) at commit 6db87e1. The contract
is `test/fixtures/reading-format/README.md`. Do not edit here: change the
format in zotero-meristema-reading, then copy `src/format/*.ts` and
`fixtures/` over again. `test/unit/readingFormatDrift.test.ts` fails when the
copy and a sibling checkout differ.
```

- [ ] **Step 4: Write the drift test**

```ts
import { describe, it } from "node:test";
import { expect } from "chai";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { URL, fileURLToPath } from "node:url";

const here = fileURLToPath(new URL("../../", import.meta.url));
const sibling = join(here, "..", "zotero-meristema-reading");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

function sameTree(ours: string, theirs: string, only?: RegExp): void {
  const pick = (dir: string): string[] =>
    files(dir)
      .map((path) => relative(dir, path).split("\\").join("/"))
      .filter((path) => !only || only.test(path))
      .sort();
  const mine = pick(ours);
  expect(mine, `files under ${ours}`).to.deep.equal(pick(theirs));
  for (const path of mine) {
    expect(
      readFileSync(join(ours, path)).equals(readFileSync(join(theirs, path))),
      `${path} differs from zotero-meristema-reading; copy it over again`,
    ).to.equal(true);
  }
}

describe("vendored reading format", { skip: !existsSync(sibling) }, () => {
  it("matches zotero-meristema-reading/src/format", () => {
    sameTree(
      join(here, "src", "readingFormat"),
      join(sibling, "src", "format"),
      /\.ts$/,
    );
  });
  it("matches zotero-meristema-reading/fixtures", () => {
    sameTree(
      join(here, "test", "fixtures", "reading-format"),
      join(sibling, "fixtures"),
    );
  });
});
```

- [ ] **Step 5: Keep prettier off the copies**

Append to `.prettierignore`:

```
src/readingFormat/*.ts
test/fixtures/reading-format/
```

- [ ] **Step 6: Run the gate**

Run: `npm run check` and read the exit code plainly.
Expected: exit 0; the fixtures runner's cases and the two drift cases pass.
If eslint flags the copies, add `src/readingFormat/**` to the eslint ignores
rather than editing the copies. If `tsc` flags them, stop and report (the two
repos share the tsconfig, so it should not).

- [ ] **Step 7: Prove the drift test bites**

Append a space to `test/fixtures/reading-format/README.md`, run
`npm run test:unit`, expect the drift case to fail naming `README.md`, then
`git checkout -- test/fixtures/reading-format/README.md` (or delete the space)
and rerun to green.

- [ ] **Step 8: Commit**

```bash
git add src/readingFormat test/fixtures/reading-format test/unit/readingFormatFixtures.test.ts test/unit/readingFormatDrift.test.ts .prettierignore
git commit -m "Vendor the reading-list format and its fixtures from zotero-meristema-reading"
```

---

### Task 2: The reading plan, pure

**Files:**

- Create: `src/domain/readingPlan.ts`
- Test: `test/unit/readingPlan.test.ts`

**Interfaces:**

- Consumes: Task 1's `parseReadingList`, `resolveReadingList`,
  `parseReadState`, `mergeReadStates`, `stateOf`, `emptyReadState`.
- Produces:

```ts
export interface ReadingListNote {
  key: string;
  dateAdded: string;
  html: string;
}
export interface ReadingFolder {
  collectionID: number;
  notes: ReadingListNote[]; // the folder's tagged standalone notes
  papers: FolderItem[]; // the folder's own regular items {key, title}
}
export interface ReadingStateNote {
  key: string;
  html: string;
}
export interface ReadingSource {
  folders: ReadingFolder[]; // folders holding ≥ 1 tagged list note
  stateNotes: ReadingStateNote[];
  paperIds: ReadonlyMap<string, string>; // node key (item key) → paper id
}
export interface ReadingPath {
  collectionID: number;
  topic: string;
  keys: string[];
}
export interface ReadingPlan {
  paths: ReadingPath[]; // one per ticked readable list, tree order
  stepByKey: ReadonlyMap<string, number>;
  afterLast: number; // where a paper in no ticked list sits
  stateByKey: ReadonlyMap<string, ReadState>;
}
export const EMPTY_READING_SOURCE: ReadingSource;
export function readStateFromNotes(
  notes: readonly ReadingStateNote[],
): ReadStateDoc;
export function buildReadingPlan(
  source: ReadingSource,
  tickedInTreeOrder: readonly number[],
): ReadingPlan;
export function readingStepOf(
  plan: ReadingPlan | null,
  key: string,
): number | null;
```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it } from "node:test";
import { expect } from "chai";
import {
  EMPTY_READING_SOURCE,
  buildReadingPlan,
  readStateFromNotes,
  readingStepOf,
  type ReadingSource,
} from "../../src/domain/readingPlan";

const A = "AAAAAAA2";
const B = "BBBBBBB3";
const C = "CCCCCCC4";
const D = "DDDDDDD5";

const list = (topic: string, keys: string[]): string =>
  `<h1>Reading list - ${topic}</h1><pre data-meristema-reading-list="1">${JSON.stringify(
    { version: 1, topic, steps: keys.map((key) => ({ key, why: "" })) },
  )}</pre>`;
const state = (states: Record<string, [string, string]>): string =>
  `<pre data-meristema-reading-state="1">${JSON.stringify({
    version: 1,
    states: Object.fromEntries(
      Object.entries(states).map(([id, [s, at]]) => [id, { state: s, at }]),
    ),
  })}</pre>`;
const papers = (...keys: string[]) =>
  keys.map((key) => ({ key, title: `Title ${key}` }));

function source(over: Partial<ReadingSource> = {}): ReadingSource {
  return {
    folders: [
      {
        collectionID: 1,
        notes: [
          {
            key: "NNNNNNN6",
            dateAdded: "2026-01-01 00:00:00",
            html: list("One", [B, A]),
          },
        ],
        papers: papers(A, B, C),
      },
    ],
    stateNotes: [],
    paperIds: new Map([
      [A, `user:${A}`],
      [B, "doi:10.1000/b"],
      [C, `user:${C}`],
      [D, `user:${D}`],
    ]),
    ...over,
  };
}

describe("buildReadingPlan", () => {
  it("numbers a ticked list's steps from 1 and puts its unordered papers at n+1", () => {
    const plan = buildReadingPlan(source(), [1]);
    expect(plan.paths).to.deep.equal([
      { collectionID: 1, topic: "One", keys: [B, A] },
    ]);
    expect(plan.stepByKey.get(B)).to.equal(1);
    expect(plan.stepByKey.get(A)).to.equal(2);
    expect(plan.stepByKey.get(C)).to.equal(3);
    expect(plan.afterLast).to.equal(4);
    expect(readingStepOf(plan, D)).to.equal(4);
  });

  it("ignores lists in unticked folders", () => {
    const plan = buildReadingPlan(source(), []);
    expect(plan.paths).to.deep.equal([]);
    expect(plan.stepByKey.size).to.equal(0);
    expect(readingStepOf(plan, A)).to.equal(1);
    expect(readingStepOf(null, A)).to.equal(null);
  });

  it("uses the oldest note by date added, then key", () => {
    const folder = {
      collectionID: 1,
      notes: [
        {
          key: "ZZZZZZZ9",
          dateAdded: "2026-01-01 00:00:00",
          html: list("Late key", [A]),
        },
        {
          key: "YYYYYYY8",
          dateAdded: "2026-02-01 00:00:00",
          html: list("Newer", [B]),
        },
        {
          key: "XXXXXXX7",
          dateAdded: "2026-01-01 00:00:00",
          html: list("Oldest", [C]),
        },
      ],
      papers: papers(A, B, C),
    };
    const plan = buildReadingPlan(source({ folders: [folder] }), [1]);
    expect(plan.paths[0].topic).to.equal("Oldest");
  });

  it("skips a folder whose list note cannot be read", () => {
    const folder = {
      collectionID: 1,
      notes: [
        {
          key: "NNNNNNN6",
          dateAdded: "2026-01-01 00:00:00",
          html: "<p>no data</p>",
        },
      ],
      papers: papers(A),
    };
    const plan = buildReadingPlan(source({ folders: [folder] }), [1]);
    expect(plan.paths).to.deep.equal([]);
  });

  it("gives a paper in two lists the step of the first ticked list, and keeps both paths", () => {
    const two = source({
      folders: [
        {
          collectionID: 1,
          notes: [
            {
              key: "NNNNNNN6",
              dateAdded: "2026-01-01 00:00:00",
              html: list("One", [A, B]),
            },
          ],
          papers: papers(A, B),
        },
        {
          collectionID: 2,
          notes: [
            {
              key: "MMMMMMM6",
              dateAdded: "2026-01-01 00:00:00",
              html: list("Two", [C, D, B]),
            },
          ],
          papers: papers(B, C, D),
        },
      ],
    });
    const plan = buildReadingPlan(two, [2, 1]);
    expect(plan.paths.map((p) => p.collectionID)).to.deep.equal([2, 1]);
    expect(plan.stepByKey.get(B)).to.equal(3);
    expect(plan.stepByKey.get(A)).to.equal(1);
    expect(plan.afterLast).to.equal(4);
  });

  it("reads every paper's state, Unread when absent", () => {
    const plan = buildReadingPlan(
      source({
        stateNotes: [
          {
            key: "SSSSSSS2",
            html: state({ "doi:10.1000/b": ["read", "2026-11-01T00:00:00Z"] }),
          },
          {
            key: "TTTTTTT3",
            html: state({ [`user:${A}`]: ["reading", "2026-11-01T00:00:00Z"] }),
          },
        ],
      }),
      [],
    );
    expect(plan.stateByKey.get(B)).to.equal("read");
    expect(plan.stateByKey.get(A)).to.equal("reading");
    expect(plan.stateByKey.get(C)).to.equal("unread");
    expect(plan.stateByKey.has("external:1")).to.equal(false);
  });
});

describe("readStateFromNotes", () => {
  it("merges readable notes and skips unreadable ones", () => {
    const doc = readStateFromNotes([
      {
        key: "SSSSSSS2",
        html: state({ "doi:10.1000/b": ["read", "2026-11-01T00:00:00Z"] }),
      },
      {
        key: "TTTTTTT3",
        html: state({ "doi:10.1000/b": ["unread", "2026-11-02T00:00:00Z"] }),
      },
      { key: "UUUUUUU4", html: "<p>broken</p>" },
    ]);
    expect(doc.states["doi:10.1000/b"].state).to.equal("unread");
  });

  it("is empty with no notes", () => {
    expect(readStateFromNotes([])).to.deep.equal({ version: 1, states: {} });
    expect(EMPTY_READING_SOURCE.folders).to.deep.equal([]);
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npm run test:unit`
Expected: FAIL, cannot find module `../../src/domain/readingPlan`.

- [ ] **Step 3: Implement**

```ts
import {
  parseReadingList,
  resolveReadingList,
  type FolderItem,
} from "../readingFormat/readingList";
import {
  emptyReadState,
  mergeReadStates,
  parseReadState,
  stateOf,
  type ReadState,
  type ReadStateDoc,
} from "../readingFormat/readState";

/*
 * R1 step 3: what the Reading plan view draws, from the two notes Meristema
 * Reading writes (spec 2026-11-06, section 3). Pure; the Zotero reads are in
 * services/readingNoteSource.ts.
 */

export interface ReadingListNote {
  key: string;
  dateAdded: string;
  html: string;
}

export interface ReadingFolder {
  collectionID: number;
  notes: ReadingListNote[];
  papers: FolderItem[];
}

export interface ReadingStateNote {
  key: string;
  html: string;
}

export interface ReadingSource {
  folders: ReadingFolder[];
  stateNotes: ReadingStateNote[];
  /** Node key (the item key) to paper id, for every paper in the graph's library. */
  paperIds: ReadonlyMap<string, string>;
}

export interface ReadingPath {
  collectionID: number;
  topic: string;
  /** The list's ordered steps, first to last; unordered papers are not on it. */
  keys: string[];
}

export interface ReadingPlan {
  paths: ReadingPath[];
  stepByKey: ReadonlyMap<string, number>;
  /** The step a paper in no ticked list sits at: one past every list's last. */
  afterLast: number;
  stateByKey: ReadonlyMap<string, ReadState>;
}

export const EMPTY_READING_SOURCE: ReadingSource = {
  folders: [],
  stateNotes: [],
  paperIds: new Map(),
};

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A folder's list note, as Meristema Reading picks it: oldest, then smallest key. */
function oldest(notes: readonly ReadingListNote[]): ReadingListNote | null {
  return (
    [...notes].sort(
      (a, b) => compare(a.dateAdded, b.dateAdded) || compare(a.key, b.key),
    )[0] ?? null
  );
}

/** Every readable state note merged; an unreadable one is left out. */
export function readStateFromNotes(
  notes: readonly ReadingStateNote[],
): ReadStateDoc {
  return [...notes]
    .sort((a, b) => compare(a.key, b.key))
    .map((note) => parseReadState(note.html))
    .reduce<ReadStateDoc>(
      (doc, parsed) => (parsed.ok ? mergeReadStates(doc, parsed.value) : doc),
      emptyReadState(),
    );
}

/**
 * The plan for the ticked folders, given in folder-tree order. A paper in two
 * ticked lists takes the first list's step; every list keeps its own path.
 */
export function buildReadingPlan(
  source: ReadingSource,
  tickedInTreeOrder: readonly number[],
): ReadingPlan {
  const byID = new Map(source.folders.map((f) => [f.collectionID, f]));
  const paths: ReadingPath[] = [];
  const stepByKey = new Map<string, number>();
  let afterLast = 1;
  for (const collectionID of tickedInTreeOrder) {
    const folder = byID.get(collectionID);
    const note = folder ? oldest(folder.notes) : null;
    if (!folder || !note) continue;
    const parsed = parseReadingList(note.html);
    if (!parsed.ok) continue;
    const resolved = resolveReadingList(parsed.value, folder.papers);
    const n = resolved.steps.length;
    for (const step of resolved.steps) {
      if (!stepByKey.has(step.key)) stepByKey.set(step.key, step.step);
    }
    for (const key of resolved.unordered) {
      if (!stepByKey.has(key)) stepByKey.set(key, n + 1);
    }
    afterLast = Math.max(afterLast, n + (resolved.unordered.length ? 2 : 1));
    paths.push({
      collectionID,
      topic: parsed.value.topic,
      keys: resolved.steps.map((step) => step.key),
    });
  }
  const doc = readStateFromNotes(source.stateNotes);
  const stateByKey = new Map<string, ReadState>();
  for (const [key, id] of source.paperIds)
    stateByKey.set(key, stateOf(doc, id));
  return { paths, stepByKey, afterLast, stateByKey };
}

/** A node's Reading step: its list step, else one past the last; null with no plan. */
export function readingStepOf(
  plan: ReadingPlan | null,
  key: string,
): number | null {
  if (!plan) return null;
  return plan.stepByKey.get(key) ?? plan.afterLast;
}
```

- [ ] **Step 4: Run to green**

Run: `npm run test:unit` — expected PASS (exit 0).

- [ ] **Step 5: Commit**

```bash
git add src/domain/readingPlan.ts test/unit/readingPlan.test.ts
git commit -m "Build the reading plan from list and state notes"
```

---

### Task 3: Reading step metric and Read state colouring

**Files:**

- Modify: `src/domain/graphTypes.ts` (`MetricID` gains `"reading-step"`; `GraphNodeColorMetric` gains `"read-state"`)
- Modify: `src/services/metricRegistry.ts` (a definition after `citation-sequence`)
- Modify: `src/services/graphLayoutAvailability.ts` (`metricHasData`, `colourOptionHasData`)
- Modify: `src/services/graphCategoryAssignment.ts` (`nodeCategory`, `assignCategories`, a fixed-colour assigner)
- Modify: `src/services/graphKeyModel.ts` (`CATEGORICAL_COLOR_LABELS`)
- Modify: `src/services/graphViewControls.ts` (`categoricalDefinitions`)
- Modify: `src/services/graphViews.ts` (`COLOUR_METRICS`, `metricWord`)
- Modify: `src/services/graphRendererScene.ts:235-242` (ghost colour)
- Modify: `src/services/dataSourceTooltipService.ts` (source for `reading-step`; follow how `citation-sequence` is handled at :160-196)
- Modify: `src/services/citationGraphRenderer.ts` (`setReadingPlan`, `metricNumber`, `categories()`)
- Test: `test/unit/graphCategoryAssignment.test.ts`, `test/unit/graphLayoutAvailability.test.ts`, `test/unit/graphMetricLists.test.ts`, `test/unit/graphKeyModel.test.ts` (extend)

**Interfaces:**

- Consumes: Task 2's `ReadingPlan`, `readingStepOf`.
- Produces: `CitationGraphRenderer.setReadingPlan(plan: ReadingPlan | null, draw = true): void`;
  `AssignCategoriesOptions.readStateOf?: (key: string) => ReadState | undefined`;
  metric id `"reading-step"`, colour id `"read-state"`.

- [ ] **Step 1: Write the failing tests**

In `test/unit/graphCategoryAssignment.test.ts` add (reuse the file's existing
node helper and theme; names below assume `node(key)` and `graphThemeFor("light")`,
adapt to what the file uses):

```ts
describe("read-state colouring", () => {
  const theme = graphThemeFor("light");
  const states = new Map([
    ["a", "unread"],
    ["b", "reading"],
    ["c", "read"],
    ["d", "read"],
  ] as const);
  const assign = () =>
    assignCategories(
      [node("a"), node("b"), node("c"), node("d"), node("x")],
      "read-state",
      theme,
      {
        ledger: emptySwatchLedger(),
        readStateOf: (key) => states.get(key as "a"),
      },
    );

  it("colours each state from a fixed ramp stop, in reading order", () => {
    const result = assign();
    expect(
      result.entries.map((e) => [e.label, e.count, e.color]),
    ).to.deep.equal([
      ["Unread", 1, theme.ramp[0]],
      ["Reading", 1, theme.ramp[2]],
      ["Read", 2, theme.ramp[4]],
    ]);
    expect(result.other).to.equal(null);
    expect(result.noValue?.label).to.equal("Not in library");
    expect(result.colorFor(node("x"))).to.equal(theme.categorical.noValue);
    expect(result.labelFor(node("c"))).to.equal("Read");
  });

  it("never moves the swatch ledger", () => {
    const ledger = emptySwatchLedger();
    const result = assignCategories([node("a")], "read-state", theme, {
      ledger,
      readStateOf: () => "read",
    });
    expect(result.ledger).to.equal(ledger);
  });

  it("keeps a state's colour when another state is absent", () => {
    const result = assignCategories([node("c")], "read-state", theme, {
      ledger: emptySwatchLedger(),
      readStateOf: () => "read",
    });
    expect(result.entries).to.have.length(1);
    expect(result.entries[0].color).to.equal(theme.ramp[4]);
  });
});
```

In `test/unit/graphLayoutAvailability.test.ts` add:

```ts
it("always offers Reading step and Read state; their data arrives on the renderer", () => {
  expect(metricHasData([], "reading-step")).to.equal(true);
  expect(colourOptionHasData([], "read-state")).to.equal(true);
});
```

In `test/unit/graphMetricLists.test.ts`, assert `axisMetricDefinitions()`
includes `reading-step` and `nodeSizeMetricDefinitions()` and
`nodeColorMetricDefinitions()` do not.

Renderer: in a new `test/unit/citationGraphRendererReading.test.ts`, using the
doubles in `test/unit/graphRendererDoubles.ts` as
`citationGraphRendererRegions.test.ts` does:

```ts
it("reads Reading step from the plan, and nothing without one", () => {
  const renderer = new CitationGraphRenderer({
    canvas: new FakeCanvas() as unknown as HTMLCanvasElement,
    model: model([node("a"), node("z")]),
    layout: FREE_LAYOUT,
    collectionLabels: new Map(),
    onSelectionChange: () => undefined,
    onOpenNode: () => undefined,
  });
  expect(renderer.metricNumber(node("a"), "reading-step")).to.equal(null);
  renderer.setReadingPlan({
    paths: [],
    stepByKey: new Map([["a", 2]]),
    afterLast: 3,
    stateByKey: new Map(),
  });
  expect(renderer.metricNumber(node("a"), "reading-step")).to.equal(2);
  expect(renderer.metricNumber(node("z"), "reading-step")).to.equal(3);
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npm run test:unit` — expected FAIL (type errors / unknown metric).

- [ ] **Step 3: Implement**

`graphTypes.ts`: add `| "reading-step"` to `MetricID` and `| "read-state"`
to `GraphNodeColorMetric`.

`metricRegistry.ts`, after the `citation-sequence` entry:

```ts
  {
    id: "reading-step",
    label: "Reading step",
    group: "Library",
    description:
      "A paper's place in the reading list of a ticked folder (Meristema Reading). Papers the list leaves unordered sit one step after its last; papers in no ticked list sit after every list.",
    interpretation:
      "A paper in two ticked lists takes its step from the first list in folder order.",
    valueType: "integer",
    column: false,
    itemPane: false,
    graph: {
      axis: true,
      logarithmic: false,
      nodeSize: false,
      nodeColor: false,
      filter: false,
    },
    // The step is the renderer's map (setReadingPlan), not a node field.
    value: () => null,
  },
```

`graphLayoutAvailability.ts`: in `metricHasData`, beside the
`citation-sequence` early return:

```ts
// Reading step is the renderer's map too, from the reading-list notes.
if (metric === "reading-step") return true;
```

and in `colourOptionHasData` add `case "read-state":` beside
`case "citation-hop": case "seed-links": return true;`.

`graphCategoryAssignment.ts`:

```ts
import type { ReadState } from "../readingFormat/readState";

const READ_STATE_ORDER: readonly ReadState[] = ["unread", "reading", "read"];
const READ_STATE_LABELS: Record<ReadState, string> = {
  unread: "Unread",
  reading: "Reading",
  read: "Read",
};
/** Fixed ramp stops, so a state is the same colour on every graph (user, 2026-11-07). */
const READ_STATE_RAMP: Record<ReadState, number> = {
  unread: 0,
  reading: 2,
  read: 4,
};
const NOT_IN_LIBRARY = "Not in library";
```

Add `readStateOf?: (key: string) => ReadState | undefined;` to
`AssignCategoriesOptions` (doc comment: "The Read state colouring's source:
the reading plan's state per library paper"). In `nodeCategory` add a fifth
parameter `readStateOf?: (key: string) => ReadState | undefined` and a branch:

```ts
if (metric === "read-state") {
  const state = readStateOf?.(node.key);
  return state
    ? { key: `read-state:${state}`, label: READ_STATE_LABELS[state] }
    : null;
}
```

In `assignCategories`, after the seed-links early return:

```ts
if (metric === "read-state") return assignReadStates(nodes, theme, options);
```

and the assigner, modelled on `assignSeedLinkTiers`:

```ts
/**
 * Read state is categorical but fixed: Unread, Reading, Read in that order,
 * each from its own ramp stop, so the ledger is neither read nor moved and no
 * state collapses into Other. A paper with no state (not in the library) is
 * the no-value grey.
 */
function assignReadStates(
  nodes: CitationGraphNode[],
  theme: GraphTheme,
  options: AssignCategoriesOptions,
): CategoryAssignment {
  const ref = (node: CitationGraphNode): CategoryRef | null =>
    nodeCategory(node, "read-state", undefined, undefined, options.readStateOf);
  const counts = new Map<ReadState, number>();
  let noValueCount = 0;
  for (const node of nodes) {
    const state = options.readStateOf?.(node.key);
    if (state) counts.set(state, (counts.get(state) ?? 0) + 1);
    else noValueCount += 1;
  }
  const colorOf = (state: ReadState): string =>
    theme.ramp[Math.min(READ_STATE_RAMP[state], theme.ramp.length - 1)];
  const entries: CategoryEntry[] = READ_STATE_ORDER.filter((s) =>
    counts.has(s),
  ).map((state) => ({
    key: `read-state:${state}`,
    label: READ_STATE_LABELS[state],
    count: counts.get(state) ?? 0,
    color: colorOf(state),
  }));
  const noValue: CategoryEntry | null = noValueCount
    ? {
        key: NO_VALUE_KEY,
        label: NOT_IN_LIBRARY,
        count: noValueCount,
        color: theme.categorical.noValue,
      }
    : null;
  return {
    metric: "read-state",
    entries,
    other: null,
    noValue,
    ledger: options.ledger,
    colorFor(node) {
      const state = options.readStateOf?.(node.key);
      return state ? colorOf(state) : theme.categorical.noValue;
    },
    labelFor(node) {
      return ref(node)?.label ?? NOT_IN_LIBRARY;
    },
    keyFor(node) {
      return ref(node)?.key ?? null;
    },
  };
}
```

`graphKeyModel.ts`: add `"read-state": "Read state",` to
`CATEGORICAL_COLOR_LABELS`.

`graphViewControls.ts` `categoricalDefinitions`, after seed-links:

```ts
    {
      value: "read-state",
      label: "Read state",
      description:
        "Colour papers Unread, Reading or Read, from Meristema Reading's read state.",
      available: colourOptionHasData(nodes, "read-state"),
    },
```

`graphViews.ts`: add `"read-state"` to `COLOUR_METRICS`, and
`"read-state": "read state",` to `metricWord`'s `special` map.

`graphRendererScene.ts` ghost colour: add `metric === "read-state" ||` to the
categorical list returning `theme.categorical.noValue`.

`dataSourceTooltipService.ts`: give `reading-step` the source Zotero (the
notes are in Zotero), following the `citation-sequence` case; if the switch
is exhaustive, tsc points at it.

`citationGraphRenderer.ts`:

```ts
import { readingStepOf, type ReadingPlan } from "../domain/readingPlan";
// fields
  private readingPlan: ReadingPlan | null = null;
  private readingPlanRevision = 0;

  /**
   * What the reading-list notes put on the plot: each paper's step and read
   * state, and each ticked list's path; null when the view has none yet.
   */
  public setReadingPlan(plan: ReadingPlan | null, draw = true): void {
    this.readingPlan = plan;
    this.readingPlanRevision += 1;
    this.categoryAssignment = null;
    if (draw) this.draw();
  }
```

In `metricNumber`, before the fallback:

```ts
if (metric === "reading-step") {
  return readingStepOf(this.readingPlan, node.key);
}
```

In `categories()`, append `${this.readingPlanRevision}` to the key (with
the same U+001F separator the others use) and pass
`readStateOf: (nodeKey) => this.readingPlan?.stateByKey.get(nodeKey),`.

`readingStepOf` returns `afterLast` for an external node too; that is the
spec's "a paper in no list … sits after the last one".

- [ ] **Step 4: Run to green**

Run: `npm run check` — expected exit 0. Fix any list-asserting test that now
sees the new ids by updating its expectation (and say which in the report).

- [ ] **Step 5: Commit**

```bash
git add src/domain/graphTypes.ts src/services/metricRegistry.ts src/services/graphLayoutAvailability.ts src/services/graphCategoryAssignment.ts src/services/graphKeyModel.ts src/services/graphViewControls.ts src/services/graphViews.ts src/services/graphRendererScene.ts src/services/dataSourceTooltipService.ts src/services/citationGraphRenderer.ts test/unit
git commit -m "Add the Reading step metric and the Read state colouring"
```

---

### Task 4: Draw the reading path

**Files:**

- Modify: `src/services/citationGraphRenderer.ts` (`drawReadingPaths`, called in `draw()` after `this.drawRegions(plot)` and before the edge loop)
- Modify: `src/services/graphTheme.ts` (`GraphStateTokens.readingPath`, both themes)
- Test: `test/unit/citationGraphRendererReading.test.ts` (extend)

**Interfaces:**

- Consumes: Task 3's `readingPlan` field and `setReadingPlan`.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Write the failing test**

Read `test/unit/graphRendererDoubles.ts` to see how the fake context records
calls (`lastRegionStroke` shows the pattern). Add cases:

1. Nodes `a` (100,100), `b` (200,100), `c` (300,100) pinned with
   `setNodePositions`; `setReadingPlan` with one path `[a, b, c]`: after the
   draw, the context recorded one `setLineDash` with a non-empty array, a
   `moveTo(100,100)` then `lineTo(200,100)`, `lineTo(300,100)` in the
   `readingPath` stroke colour, before the first node fill.
2. Two paths `[a, b]` and `[c]`: exactly one polyline is stroked (a path of
   one visible node draws nothing) and it never contains `c`.
3. A path whose middle node is hidden (not in `visibleNodes()`, e.g.
   filtered out by scope in the doubles): the line joins `a` to `c`.
4. No plan, or a plan with no paths: no `readingPath` stroke.

- [ ] **Step 2: Run to see it fail**

Run: `npm run test:unit` — expected FAIL.

- [ ] **Step 3: Implement**

`graphTheme.ts`: add to `GraphStateTokens`

```ts
/** The dashed line joining a reading list's steps (R1), apart from citation edges. */
readingPath: string;
```

and give each theme a value: use the theme's own `inks.muted` value for each
scheme (copy the literal so the token stands alone). If
`test/unit/graphPalette.test.ts` enumerates state tokens, extend it.

Renderer:

```ts
  /**
   * Each ticked list's steps joined in order, a dashed line under the
   * citation edges and the nodes. A step hidden by scope or filters is
   * skipped, so the line joins the visible steps either side of it; a list
   * is never joined to another.
   */
  private drawReadingPaths(plot: PlotRect): void {
    const paths = this.readingPlan?.paths ?? [];
    if (!paths.length) return;
    const visible = new Set(this.visibleNodes().map((node) => node.key));
    const context = this.context;
    context.save();
    context.beginPath();
    context.rect(plot.left, plot.top, plot.width, plot.height);
    context.clip();
    context.strokeStyle = this.theme.states.readingPath;
    context.lineWidth = 1.5 * this.ratio;
    context.lineJoin = "round";
    context.setLineDash([6 * this.ratio, 4 * this.ratio]);
    for (const path of paths) {
      const points = path.keys
        .filter((key) => visible.has(key))
        .map((key) => this.screenPositions.get(key))
        .filter((point): point is { x: number; y: number } => Boolean(point));
      if (points.length < 2) continue;
      context.beginPath();
      context.moveTo(points[0].x, points[0].y);
      for (const point of points.slice(1)) context.lineTo(point.x, point.y);
      context.stroke();
    }
    context.restore();
  }
```

Check what `this.screenPositions` holds at that point of `draw()` (device
pixels, as `drawRegions` uses via `projectToScreen`); if it is filled later
in the frame, project with `this.projectToScreen(this.positions.get(key))`
instead, as `drawRegions` does. Call it right after `this.drawRegions(plot);`.

- [ ] **Step 4: Run to green**

Run: `npm run check` — expected exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/services/citationGraphRenderer.ts src/services/graphTheme.ts test/unit
git commit -m "Draw each ticked reading list's path apart from citation edges"
```

---

### Task 5: Read the notes in Zotero and feed the graph

**Files:**

- Create: `src/services/readingNoteSource.ts`
- Create: `src/services/readingNoteEvents.ts`
- Modify: `src/hooks.ts` (register/unregister the notifier, beside `registerLibrarySnapshotInvalidation`)
- Modify: `src/services/graphViews.ts` (export `treeOrder` as `foldersInTreeOrder`)
- Modify: `src/services/graphViewService.ts` (load, recompute, push to renderer, unsubscribe on cleanup)
- Test: `test/unit/readingNoteEvents.test.ts`

**Interfaces:**

- Consumes: Task 2's `ReadingSource`, `buildReadingPlan`, `EMPTY_READING_SOURCE`; Task 3's `setReadingPlan`.
- Produces:

```ts
// readingNoteSource.ts
export async function loadReadingSource(
  libraryID: number,
  collectionIDs: readonly number[],
  itemIDs: readonly number[],
): Promise<ReadingSource>;
// readingNoteEvents.ts
export function subscribeReadingNotesChanged(listener: () => void): () => void;
export function publishReadingNotesChanged(): void;
// graphViewService.ts, inside the view closure
let readingPlan: ReadingPlan;            // the last plan pushed to the renderer
const readingListTicked = (): boolean;   // readingPlan.paths.length > 0, for Task 6
```

- [ ] **Step 1: Events, test first**

`test/unit/readingNoteEvents.test.ts`:

```ts
import { describe, it } from "node:test";
import { expect } from "chai";
import {
  publishReadingNotesChanged,
  subscribeReadingNotesChanged,
} from "../../src/services/readingNoteEvents";

describe("reading note events", () => {
  it("calls each listener until it unsubscribes", () => {
    let calls = 0;
    const off = subscribeReadingNotesChanged(() => (calls += 1));
    publishReadingNotesChanged();
    off();
    publishReadingNotesChanged();
    expect(calls).to.equal(1);
  });
});
```

Implement `readingNoteEvents.ts` in the same shape as
`src/services/libraryFolderEvents.ts` (a `Set` of listeners; a throwing
listener must not stop the others, if that file guards it so).

- [ ] **Step 2: The loader**

```ts
import type { LibraryLink } from "../readingFormat/common";
import { READING_LIST_TAG } from "../readingFormat/readingList";
import { paperId, READ_STATE_TAG } from "../readingFormat/readState";
import type { ReadingFolder, ReadingSource } from "../domain/readingPlan";

/*
 * Reads what the Reading plan view needs straight from Zotero, as Meristema
 * Reading writes it; Meristema Reading itself need not be installed.
 */

function libraryLinkOf(libraryID: number): LibraryLink {
  const library = Zotero.Libraries.get(libraryID) as any;
  return library?.libraryType === "group"
    ? { kind: "group", id: Zotero.Groups.getGroupIDFromLibraryID(libraryID) }
    : { kind: "user" };
}

function isTaggedNote(item: Zotero.Item, tag: string): boolean {
  return (
    item.isNote() && item.isTopLevelItem() && !item.deleted && item.hasTag(tag)
  );
}

async function taggedNotes(
  libraryID: number,
  tag: string,
): Promise<Zotero.Item[]> {
  const tagID = Zotero.Tags.getID(tag);
  if (!tagID) return [];
  const ids = await Zotero.Tags.getTagItems(libraryID, tagID);
  const items = await Zotero.Items.getAsync(ids);
  return items.filter((item: Zotero.Item) => item && isTaggedNote(item, tag));
}

export async function loadReadingSource(
  libraryID: number,
  collectionIDs: readonly number[],
  itemIDs: readonly number[],
): Promise<ReadingSource> {
  const listNotes = await taggedNotes(libraryID, READING_LIST_TAG);
  const wanted = new Set(collectionIDs);
  const notesByFolder = new Map<number, Zotero.Item[]>();
  for (const note of listNotes) {
    for (const id of note.getCollections()) {
      if (!wanted.has(id)) continue;
      notesByFolder.set(id, [...(notesByFolder.get(id) ?? []), note]);
    }
  }
  const folders: ReadingFolder[] = [];
  for (const [collectionID, notes] of notesByFolder) {
    const collection = Zotero.Collections.get(collectionID);
    if (!collection) continue;
    const children = collection.getChildItems(false, false) as Zotero.Item[];
    folders.push({
      collectionID,
      notes: notes.map((note) => ({
        key: note.key,
        dateAdded: note.dateAdded,
        html: note.getNote(),
      })),
      papers: children
        .filter((item) => item.isRegularItem())
        .map((item) => ({
          key: item.key,
          title: String(item.getField("title")),
        })),
    });
  }
  const stateNotes = (
    await taggedNotes(Zotero.Libraries.userLibraryID, READ_STATE_TAG)
  ).map((note) => ({ key: note.key, html: note.getNote() }));
  const link = libraryLinkOf(libraryID);
  const paperIds = new Map<string, string>();
  for (const item of (await Zotero.Items.getAsync([
    ...itemIDs,
  ])) as Zotero.Item[]) {
    if (!item?.isRegularItem() || item.deleted) continue;
    paperIds.set(
      item.key,
      paperId({
        doi: String(item.getField("DOI") ?? "") || null,
        library: link,
        key: item.key,
      }),
    );
  }
  return { folders, stateNotes, paperIds };
}
```

(Same reads as `zotero-meristema-reading/src/zotero/items.ts` and
`listStore.ts`; keep them in step.)

- [ ] **Step 3: The notifier**

In `src/hooks.ts`, beside `registerLibrarySnapshotInvalidation`, register a
`Zotero.Notifier` observer on `["item", "collection-item"]` with id
`"meristema-reading-notes"` that calls `publishReadingNotesChanged()` on every
event (add, modify, delete, trash, and every collection-item change: a paper
filed into or out of a list folder changes its steps). Unregister it where the
others are unregistered on shutdown. The view debounces, so the observer does
no filtering.

- [ ] **Step 4: Wire the graph view**

In `graphViewService.ts`, inside the view closure (near `viewFolders`):

```ts
let readingSource: ReadingSource = EMPTY_READING_SOURCE;
let readingPlan: ReadingPlan = buildReadingPlan(EMPTY_READING_SOURCE, []);
let readingLoad = 0;
const tickedFoldersInTreeOrder = (): number[] =>
  foldersInTreeOrder(viewFolders())
    .filter((folder) =>
      isCollectionTicked(collectionTicks, folder.collectionID),
    )
    .map((folder) => folder.collectionID);
const pushReadingPlan = (draw: boolean): void => {
  readingPlan = buildReadingPlan(readingSource, tickedFoldersInTreeOrder());
  renderer?.setReadingPlan(readingPlan, draw);
};
const reloadReadingSource = async (): Promise<void> => {
  const load = ++readingLoad;
  const source = await loadReadingSource(
    snapshot.libraryID,
    snapshot.collections.map((c) => c.collectionID),
    libraryModel.nodes.flatMap((n) => (n.itemID ? [n.itemID] : [])),
  );
  if (cleaned || load !== readingLoad) return;
  readingSource = source;
  pushReadingPlan(true);
  refreshViewChip();
};
const readingReload = debounce(() => void reloadReadingSource(), 250);
const unsubscribeReadingNotes = subscribeReadingNotesChanged(() => {
  if (!cleaned) readingReload();
});
```

Use the repo's existing debounce helper if there is one (grep `debounce`);
otherwise a `setTimeout` held in a variable and cleared on cleanup. Use the
real names for `itemID`, `libraryModel` and `snapshot.libraryID` as they are
in the closure (the explore map: nodes carry `itemID`, the snapshot carries
`libraryID`). Then:

- call `void reloadReadingSource()` once after the renderer is created (where
  `setSeedMarks` is first sent);
- in `refreshScopeRail`, right after `renderer?.setRegions(drawnRegions);`,
  call `pushReadingPlan(false)` (ticks changed; the redraw that follows
  paints it). If `setRegions` there draws immediately, call
  `pushReadingPlan(false)` before it instead, so one frame carries both;
- after `replaceLibraryGraph` / a renderer rebuild, re-send `readingPlan`
  exactly where seed marks are re-sent;
- in cleanup, call `unsubscribeReadingNotes()` and clear the debounce timer.

`graphViews.ts`: rename `treeOrder` to `foldersInTreeOrder` and export it
(update its one caller).

- [ ] **Step 5: Run the gate**

Run: `npm run check` — expected exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/services/readingNoteSource.ts src/services/readingNoteEvents.ts src/hooks.ts src/services/graphViews.ts src/services/graphViewService.ts test/unit/readingNoteEvents.test.ts
git commit -m "Read reading-list and state notes into the graph and follow their changes"
```

---

### Task 6: The Reading plan view, live

**Files:**

- Modify: `src/services/graphViews.ts` (needs, availability, the view definition)
- Modify: `src/services/graphViewsMenu.ts` (rows and gallery cards read live needs)
- Modify: `src/services/graphViewService.ts` (pass the live needs)
- Test: `test/unit/graphViews.test.ts`, `test/unit/graphViewsMenu.test.ts`, `test/zotero/graphViews.test.ts` (update the three "Arrives with reading state" expectations)

**Interfaces:**

- Consumes: Task 5's `readingPlan` in the view closure.
- Produces:

```ts
export type GraphViewNeeds = "reading-list";
export function graphViewIsAvailable(view: GraphViewDefinition, met?: ReadonlySet<GraphViewNeeds>): boolean;
export function graphViewAvailabilityLine(view: GraphViewDefinition, met?: ReadonlySet<GraphViewNeeds>): string | null;
// GraphViewsMenuOptions and createViewGallery's options gain:
metNeeds?: () => ReadonlySet<GraphViewNeeds>;
```

- [ ] **Step 1: Write the failing unit tests**

In `test/unit/graphViews.test.ts`, replace the "Arrives with reading state"
case with:

```ts
it("offers Reading plan only when a ticked folder holds a reading list", () => {
  const view = SHIPPED_GRAPH_VIEWS.find((v) => v.id === "reading-plan")!;
  expect(graphViewIsAvailable(view)).to.equal(false);
  expect(graphViewAvailabilityLine(view)).to.equal(
    "Needs a reading list in a ticked folder",
  );
  const met = new Set(["reading-list"] as const);
  expect(graphViewIsAvailable(view, met)).to.equal(true);
  expect(graphViewAvailabilityLine(view, met)).to.equal(null);
  expect(view.appearance).to.deep.include({
    xMetric: "reading-step",
    yMetric: "citations",
    nodeColorMetric: "read-state",
  });
});
```

In `test/unit/graphViewsMenu.test.ts` the gallery-tag case expects the new
line by default, and a new case passes `metNeeds: () => new Set(["reading-list"])`
and expects the reading-plan row without `aria-disabled` and with no note;
for the gallery, a case that flips `metNeeds` between two `show()` calls and
sees the card's `aria-disabled` and status tag follow.

- [ ] **Step 2: Run to see them fail**

Run: `npm run test:unit` — expected FAIL.

- [ ] **Step 3: Implement**

`graphViews.ts`:

```ts
export type GraphViewNeeds = "reading-list";
const NO_NEEDS: ReadonlySet<GraphViewNeeds> = new Set();

const NEEDS_LINE: Record<GraphViewNeeds, string> = {
  "reading-list": "Needs a reading list in a ticked folder",
};

export function graphViewAvailabilityLine(
  view: GraphViewDefinition,
  met: ReadonlySet<GraphViewNeeds> = NO_NEEDS,
): string | null {
  return graphViewIsAvailable(view, met) || view.availability === "ready"
    ? null
    : NEEDS_LINE[view.availability.needs];
}

export function graphViewIsAvailable(
  view: GraphViewDefinition,
  met: ReadonlySet<GraphViewNeeds> = NO_NEEDS,
): boolean {
  return view.availability === "ready" || met.has(view.availability.needs);
}
```

The shipped view:

```ts
  {
    id: "reading-plan",
    name: "Reading plan",
    summary: "Reading step × citations, colour read state. What to read next.",
    paragraph:
      "Your ticked reading lists in reading order, higher the more they are cited, coloured by what you have read; a dashed line joins each list's steps.",
    icon: "view-reading-plan",
    appearance: { ...BASE, xMetric: "reading-step", nodeColorMetric: "read-state" },
    regions: null,
    filters: null,
    explore: null,
    requires: "none",
    availability: { needs: "reading-list" },
  },
```

`graphViewsMenu.ts`: `row()` takes the met set and passes it to both
helpers; `refresh` reads `o.metNeeds?.() ?? new Set()` once per draw. In
`createViewGallery`, keep each shipped card and its tag in an array; move the
availability flagging (class, `aria-disabled`, the status tag's text and
presence) into a `flag(card, view, met)` helper run at build and at the top
of every `show()`, and let the click handler read the card's current state.
`show()`'s early return must still happen only when nothing changed: compare
the met set's signature too.

`graphViewService.ts`: pass to both `createGraphViewsMenu` and
`createViewGallery`:

```ts
    metNeeds: () => new Set(readingPlan.paths.length ? (["reading-list"] as const) : []),
```

(`readingPlan` is declared after the menu; the callback runs only once the
menu is open, as the `display` actions do — say so in a comment.) After
`reloadReadingSource` and `pushReadingPlan`, the gallery, if shown, must be
re-shown so its cards re-flag: call `maybeShowGallery()` (or whatever
`refreshViewChip` path re-runs `viewGallery.show`), not a new code path.

- [ ] **Step 4: Update the Zotero case's expectation**

`test/zotero/graphViews.test.ts` "ignores a click on a greyed view": expect
the text "Needs a reading list in a ticked folder".

- [ ] **Step 5: Run the gate**

Run: `npm run check` — expected exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/services/graphViews.ts src/services/graphViewsMenu.ts src/services/graphViewService.ts test/unit/graphViews.test.ts test/unit/graphViewsMenu.test.ts test/zotero/graphViews.test.ts
git commit -m "Offer the Reading plan view once a ticked folder holds a reading list"
```

---

### Task 7: The Zotero case

**Files:**

- Create: `test/zotero/graphReadingPlan.test.ts`

**Interfaces:**

- Consumes: everything above, through the real UI.

- [ ] **Step 1: Write the case**

Model the setup on `test/zotero/graphFolderRegions.test.ts:123-279` (create
a collection and items, open the graph via Tools › Meristema › New Graph,
tick a folder through `.cm-scope-row [data-collection-id] .cm-scope-check`,
clean up with `Zotero.Items.erase` and `collection.eraseTx()`), and the menu
reads on `test/zotero/graphViews.test.ts` (`viewRow`). Write notes with the
vendored writers so the HTML is exactly what Meristema Reading writes:

```ts
import { writeReadingList } from "../../src/readingFormat/readingList";
import {
  emptyReadState,
  setState,
  writeReadState,
  READ_STATE_TAG,
} from "../../src/readingFormat/readState";

async function standaloneNote(
  html: string,
  tag: string,
  collectionID?: number,
): Promise<Zotero.Item> {
  const note = new Zotero.Item("note");
  note.libraryID = Zotero.Libraries.userLibraryID;
  note.setNote(html);
  note.addTag(tag);
  if (collectionID) note.addToCollection(collectionID);
  await note.saveTx({ skipSelect: true });
  return note;
}
```

(Read `writeReadingList`'s signature in `src/readingFormat/readingList.ts`
for the labels and library-link arguments.) Fixture: folder "Reading R1"
with papers P1 (DOI `10.1000/r1a`), P2, P3; a list note with steps
`[P2, P1]` (P3 left unordered); a state note with P1 Read and P2 Reading,
written through `setState` with real ISO times. Every item and note this
case makes is erased in `after`, including the state note (never leave a
state note in the test profile: other suites must not see one).

Cases, in one `describe`:

1. Before ticking, the view menu's reading-plan row has `aria-disabled="true"`
   and reads "Needs a reading list in a ticked folder".
2. After ticking the folder, the row is enabled; choosing it applies the
   view: the gear's x select reads `reading-step`, the colour select
   `read-state`, the Key's colour subheading reads "Read state" with entries
   Unread 1, Reading 1, Read 1 (P3, P2, P1).
3. Positions: probe the canvas the way `graphScopeRail.test.ts:161-236`
   does, or read `renderer.metricNumber` through whatever test hook the
   view exposes; P2 is at step 1, P1 at 2, P3 at 3, in that x order left
   to right. Pick the probe that already exists; do not add a production
   hook if a test-only one is available.
4. Editing the state note (P3 → Read via `setState` + `setNote` +
   `saveTx`) updates the Key to Reading 1, Read 2 within a `waitFor`.
5. Unticking the folder greys the row again.

Put the evidence in assertion messages (Zotero.debug never reaches the runner
log).

- [ ] **Step 2: Typecheck and lint before spending a run**

Run: `npm run check` — expected exit 0.

- [ ] **Step 3: Run it alone**

Temporarily `describe.only` the new suite, run `npm test` in the foreground
(wait for the task to exit before any second run), expect all cases green,
then remove `.only`.

- [ ] **Step 4: Run the full suite**

Run: `npm test` — expected exit 0, no failures. Then `npm run build` (the
test run deletes the XPI).

- [ ] **Step 5: Commit**

```bash
git add test/zotero/graphReadingPlan.test.ts
git commit -m "Prove the Reading plan view on a real reading list in Zotero"
```

---

### Task 8: Docs and the roadmap

**Files:**

- Modify: `docs/superpowers/handoffs/roadmap.md`
- Modify: `docs/superpowers/specs/2026-11-06-reading-lists-design.md` (section 3: the fixed colours, first-list rule, vendored copy)

- [ ] **Step 1: Spec**

In section 3 add, as bullets: "Meristema's copy is vendored
(`src/readingFormat/`, `test/fixtures/reading-format/`) and checked against
a sibling checkout"; "Read state colours are fixed per state"; "A paper in two
ticked lists takes the first list's step (folder-tree order)".

- [ ] **Step 2: Roadmap**

R1 entry: step 3 built; next is the R1 manual walk and decisions, then the
rename. Add to "R1 decisions for the user": the first-list rule; the view's
summary and paragraph copy; Read state colours (ramp stops 0, 2, 4); papers
in no ticked list sit one step after the last. Add a manual check under
"Manual verification": install `.scaffold/build/meristema.xpi`; tick a
folder with a reading list (made by Meristema Reading); choose View › Reading
plan; the papers line up by step, the dashed path joins the steps in order,
colours read Unread/Reading/Read in the Key in both themes; mark a paper Read
in Meristema Reading and see the graph recolour within a second; tick two
list folders and see two separate paths; untick and see the row grey.

- [ ] **Step 3: Format and commit**

Run: `npx prettier --write docs/superpowers/handoffs/roadmap.md docs/superpowers/specs/2026-11-06-reading-lists-design.md`, then `npm run check` (exit 0).

```bash
git add docs/superpowers/handoffs/roadmap.md docs/superpowers/specs/2026-11-06-reading-lists-design.md
git commit -m "Record R1 step 3: the Reading plan view and what to walk by hand"
```
