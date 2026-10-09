# The Hop Rail's Story Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Citation hops rows read `{shown} papers · from {N}` with a
spinner while a hop grows, the line under them is Stop alone while running
and a gaps line at rest (D7, D12).

**Architecture:** A pure predicate (`lacksDetails`) and two runner queries
(`growingByHop`, `failedCount`) feed new `ScopeHopsInput` fields assembled in
`graphViewService.ts`; the pure rail model (`graphScopeRailModel.ts`) turns
them into rows and a progress line; `graphKeyRail.ts` renders them.

**Tech Stack:** TypeScript, Zotero 7 plugin, node:test + chai (unit),
zotero-plugin test runner (Zotero suite).

Spec: `docs/superpowers/specs/2026-10-09-hop-rail-story-design.md`.

## Global Constraints

- Branch `d7-hop-rail-story`. Gate every commit with `npm run check`
  (prettier, eslint, typecheck, unit tests). Commits: sentence-case subject,
  no type prefix, staged by path, ending with the session's attribution lines.
- Numbers go through `Intl.NumberFormat` (`COUNT_FORMAT`); the machine is
  de-CH (`1'200`), so tests derive grouped digits from a formatter, never a
  literal.
- Colours and animation live in `addon/content/graph.css`, never inline.
- Under the test tsconfig, `querySelectorAll` entries type as nullable: cast
  the array (`as HTMLElement[]`) or coerce with `?? ""`.
- The Zotero suite (`npm test`) runs once, in Task 4, with no `describe.only`
  left behind. Wait for the npm task to exit before any second run. `npm test`
  deletes the XPI; `npm run build` comes last.

---

### Task 1: `lacksDetails`

**Files:**

- Modify: `src/services/graphFocusService.ts` (beside `externalWorkToFocusNode`, ~line 80)
- Test: `test/unit/graphFocusService.test.ts`

**Interfaces:**

- Produces: `export const TITLE_UNAVAILABLE = "Title unavailable";` and
  `export function lacksDetails(node: Pick<CitationGraphNode, "title" | "year" | "citationCount">): boolean`
  in `src/services/graphFocusService.ts`.

- [ ] **Step 1: Write the failing test.** Add `lacksDetails` to the existing
      import from `../../src/services/graphFocusService` and append:

```ts
describe("lacksDetails", function () {
  it("holds for a node with no title, year or citation count", function () {
    expect(
      lacksDetails({
        title: "Title unavailable",
        year: null,
        citationCount: null,
      }),
    ).to.equal(true);
    expect(
      lacksDetails({ title: " ", year: null, citationCount: null }),
    ).to.equal(true);
  });

  it("fails once any one detail has landed", function () {
    expect(
      lacksDetails({ title: "A paper", year: null, citationCount: null }),
    ).to.equal(false);
    expect(
      lacksDetails({
        title: "Title unavailable",
        year: 2020,
        citationCount: null,
      }),
    ).to.equal(false);
    expect(
      lacksDetails({
        title: "Title unavailable",
        year: null,
        citationCount: 0,
      }),
    ).to.equal(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail.**
      Run: `npx node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/graphFocusService.test.ts`
      Expected: FAIL, `lacksDetails` is not exported.

- [ ] **Step 3: Implement.** In `graphFocusService.ts`, add above
      `externalWorkToFocusNode`, and change that function's
      `title: work.title?.trim() || "Title unavailable",` to
      `title: work.title?.trim() || TITLE_UNAVAILABLE,`:

```ts
/** The title an external node carries until its summary hydrates. */
export const TITLE_UNAVAILABLE = "Title unavailable";

/**
 * Nothing about the paper ever hydrated: no title, no year, no citation
 * count. The rail counts these as `without details` (D12); telling "still
 * hydrating" from "failed to" is D11's work.
 */
export function lacksDetails(
  node: Pick<CitationGraphNode, "title" | "year" | "citationCount">,
): boolean {
  const title = node.title.trim();
  return (
    (title === "" || title === TITLE_UNAVAILABLE) &&
    node.year === null &&
    node.citationCount === null
  );
}
```

- [ ] **Step 4: Run it to see it pass.** Same command. Expected: PASS.
- [ ] **Step 5: `npm run check`, then commit**
      `git add src/services/graphFocusService.ts test/unit/graphFocusService.test.ts`,
      subject `A paper drawn with no details is told apart (D12)`.

---

### Task 2: The runner says which hops grow and how many failed

**Files:**

- Modify: `src/services/graphHopFillRunner.ts` (interface ~lines 172-195, implementation ~lines 539-575)
- Test: `test/unit/graphHopFillRunner.test.ts`

**Interfaces:**

- Produces, on `HopFillRunner`:
  - `growingByHop(depth: number, direction: HopDirection): boolean[]`:
    index `hop` is true when the last plan, made at this direction and depth,
    still holds papers at `hop - 1` it will expand (not waiting on the cap).
    Index 0 is always false. All false with no matching plan.
  - `failedCount(visibleKeys: ReadonlySet<string>, direction: HopDirection): number`:
    the visible keys in the direction's failed set. The deferral limit's
    failures are in that set too (`limitFailed` is a subset of `failed`).
- Removes: `reportedByHop`. The `reported` map stays; the planner orders by it.

- [ ] **Step 1: Write the failing tests.** In the `createHopFillRunner`
      describe, append:

```ts
it("says which hops still grow while the plan holds their parents", async function () {
  const fake = fakeHost();
  const runner = createHopFillRunner(fake.host);
  expect(runner.growingByHop(2, "cited-by"), "no plan yet").to.deep.equal([
    false,
    false,
    false,
  ]);
  // Stopped, the frame still plans but nothing lands: hop 1's a and b stay
  // queued, so hop 2 is the hop still growing.
  runner.stop();
  runner.wake();
  await fake.settle();
  expect(runner.growingByHop(2, "cited-by")).to.deep.equal([
    false,
    false,
    true,
  ]);
  expect(
    runner.growingByHop(2, "references"),
    "another direction's plan is not this one",
  ).to.deep.equal([false, false, false]);
  expect(
    runner.growingByHop(3, "cited-by"),
    "nor another depth's",
  ).to.deep.equal([false, false, false, false]);
  runner.resume();
  runner.wake();
  await fake.settle();
  expect(runner.growingByHop(2, "cited-by"), "drained").to.deep.equal([
    false,
    false,
    false,
  ]);
});

it("counts the visible failures in the direction", async function () {
  const fake = fakeHost();
  fake.failing.add("a");
  const runner = createHopFillRunner(fake.host);
  runner.wake();
  await fake.settle();
  expect(runner.failedCount(new Set(["a", "b"]), "cited-by")).to.equal(1);
  expect(
    runner.failedCount(new Set(["b"]), "cited-by"),
    "a hidden failure is not counted",
  ).to.equal(0);
  expect(
    runner.failedCount(new Set(["a", "b"]), "references"),
    "failure is per direction",
  ).to.equal(0);
});
```

Also delete the two `expect(runner.reportedByHop(...)).to.deep.equal([...]);`
statements (in "counts a landing against its hop's cap and stops at the cap"
and in the cap/reset case near line 400). Each test keeps its other
assertions.

- [ ] **Step 2: Run to see the new tests fail.**
      Run: `npx node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/graphHopFillRunner.test.ts`
      Expected: FAIL, `runner.growingByHop is not a function`.

- [ ] **Step 3: Implement.** In the `HopFillRunner` interface, replace the
      `reportedByHop(...)` member and its doc comment with:

```ts
  /**
   * Per hop, whether the last plan still holds papers one hop up that it
   * will expand, not waiting on the cap: the rail spins that row. False for
   * every hop until a plan exists for this direction and this depth, as
   * `drainedByHop`.
   */
  growingByHop(depth: number, direction: HopDirection): boolean[];
  /**
   * The visible papers whose expansion failed this session in the direction,
   * the deferral limit's included (they are in `failed` too).
   */
  failedCount(
    visibleKeys: ReadonlySet<string>,
    direction: HopDirection,
  ): number;
```

In the returned object, replace the `reportedByHop: (entries, depth, direction) => { ... },`
property and the comment above it ("A heuristic on purpose...") with:

```ts
    growingByHop: (depth, direction) => {
      const growing = Array.from({ length: depth + 1 }, () => false);
      if (!lastPlan || direction !== lastDirection || depth !== lastDepth)
        return growing;
      for (let hop = 1; hop <= depth; hop += 1) {
        // `remainingByHop` counts the cap's waiting papers too; those do not
        // move until Fetch more, so they do not spin the row.
        const above = hop - 1;
        growing[hop] =
          (lastPlan.remainingByHop[above] ?? 0) -
            (lastPlan.waitingByHop[above] ?? 0) >
          0;
      }
      return growing;
    },
    failedCount: (visibleKeys, direction) => {
      let count = 0;
      for (const key of failed[direction]) {
        if (visibleKeys.has(key)) count += 1;
      }
      return count;
    },
```

Then fix the one caller so the project compiles: in
`src/services/graphViewService.ts` `scopeHopsInput()`, the
`reportedByHop: hopModel ? hopFill.reportedByHop(...) : [],` property stays
for now but must compile, so replace its value with `[]`. (Task 3 removes the
field.)

- [ ] **Step 4: Run to see them pass.** Same command. Expected: PASS.
- [ ] **Step 5: `npm run check`, then commit**
      `git add src/services/graphHopFillRunner.ts src/services/graphViewService.ts test/unit/graphHopFillRunner.test.ts`,
      subject `The fill says which hops still grow and how many failed (D7)`.

---

### Task 3: The rail model, its wiring and its rendering

**Files:**

- Modify: `src/services/graphScopeRailModel.ts` (`ScopeHopsInput` ~70-103,
  `ScopeHopRow` ~105-121, `ScopeHopsProgress` ~123-138,
  `buildScopeHopsBlock` ~306-386)
- Modify: `src/services/graphViewService.ts` (`scopeHopsInput()` ~3988)
- Modify: `src/services/graphKeyRail.ts` (`hopsBlockElement` ~653,
  `hopRowElement` ~690, `progressLine` ~752)
- Modify: `addon/content/graph.css` (`.cm-scope-hop-reported` ~1835,
  `.cm-scope-hop-progress` ~1856)
- Test: `test/unit/graphScopeRailModel.test.ts` (~436-715)

**Interfaces:**

- Consumes: `lacksDetails` (Task 1); `hopFill.growingByHop`,
  `hopFill.failedCount` (Task 2).
- Produces (DOM, read by Task 4's Zotero tests):
  - each `.cm-scope-hop-row` carries `data-shown` and `data-available`
    (numbers), and `aria-busy="true"` while spinning;
  - `.cm-scope-hop-from` holds `· from {N}`; `.cm-scope-hop-spinner` is the
    spinner;
  - `.cm-scope-hop-progress` carries `data-kind` (`running` | `refusing` |
    `rest`) and `data-left` (parents still queued while running, else `0`);
  - `.cm-scope-hop-details` is the rest state's second line, a sibling right
    after `.cm-scope-hop-progress`.

- [ ] **Step 1: Write the failing tests.** In
      `test/unit/graphScopeRailModel.test.ts`, replace `hopsInput` with:

```ts
function hopsInput(overrides: Partial<ScopeHopsInput> = {}): ScopeHopsInput {
  return {
    direction: "cited-by",
    depth: 2,
    enabled: [true, true, true, true, true, true, true],
    shownByHop: [1, 4, 9],
    availableByHop: [1, 5, 12],
    expandedByHop: [0, 1, 3],
    growingByHop: [false, false, false],
    failed: 0,
    lacksDetails: 0,
    colours: null,
    fill: null,
    drainedByHop: [true, false, false],
    cut: { mostCited: 0, arrival: 0, intent: "most-cited" },
    ...overrides,
  };
}
```

Delete every `reportedByHop: [...]` override in the file (the depth-6
cases). Then make these replacements in the `the Citation hops block`
describe:

In "lists Seeds, the open hops and one Fetch row", replace the hop 1 and
hop 2 expectations with:

```ts
expect(block.rows[1]).to.include({
  count: `${count(4)} papers`,
  from: `from ${count(1)}`,
  shown: 4,
  available: 5,
  spinning: false,
  checkbox: true,
});
expect(block.rows[2]).to.include({
  count: `${count(9)} papers`,
  from: `from ${count(3)}`,
});
expect(block.rows[3]).to.include({
  count: "not fetched",
  from: null,
  fetchButton: true,
  dimmed: true,
  enabled: true,
});
```

In "offers no Fetch row while the deepest open hop is empty", the hop 2
expectation becomes `{ count: "0 papers", fetchButton: false }` and add
`expandedByHop: [0, 0, 0]` to its input, then
`expect(block.rows[2].from).to.equal(null);`.

In "keeps 0/0 while the hop above has a paper in flight or one that failed",
rename it to "reads 0 papers while the hop above has a paper in flight or one
that failed" and expect `{ count: "0 papers" }`.

In "dims an unticked hop and carries no button at depth 6", expect
`count: "0 papers"` (shown 0) instead of `"0/1"`.

Replace "prints the progress line in its three states under the deepest open
hop" and "keeps a Resume on the line once the deferral limit has failed
papers" with:

```ts
it("reads 1 paper in the singular", function () {
  const block = railWithHops(hopsInput({ shownByHop: [1, 1, 9] }))!.hops!;
  expect(block.rows[1].count).to.equal("1 paper");
});

it("spins the rows still growing while the fill runs, and no other", function () {
  const running = railWithHops(
    hopsInput({
      depth: 3,
      shownByHop: [1, 4, 9, 2],
      availableByHop: [1, 5, 12, 2],
      expandedByHop: [0, 1, 3, 1],
      growingByHop: [false, false, true, true],
      drainedByHop: [true, false, false, false],
      fill: { remaining: 7, waiting: 0, paused: false },
    }),
  )!.hops!;
  expect(running.rows.map((row) => row.spinning)).to.deep.equal([
    false,
    false,
    true,
    true,
    false,
  ]);
  const stopped = railWithHops(
    hopsInput({
      growingByHop: [false, false, true],
      fill: { remaining: 7, waiting: 0, paused: true },
    }),
  )!.hops!;
  expect(stopped.rows.some((row) => row.spinning)).to.equal(false);
  const refused = railWithHops(
    hopsInput({
      growingByHop: [false, false, true],
      fill: {
        remaining: 7,
        waiting: 0,
        paused: false,
        refusal: { providers: ["semantic-scholar"], retryAt: 1 },
      },
    }),
  )!.hops!;
  expect(refused.rows.some((row) => row.spinning)).to.equal(false);
});

it("is Stop alone while the fill runs", function () {
  const block = railWithHops(
    hopsInput({ fill: { remaining: 7, waiting: 0, paused: false } }),
  )!.hops!;
  expect(block.progress).to.deep.equal({
    afterHop: 2,
    kind: "running",
    text: "",
    details: null,
    action: "stop",
    actionLabel: "Stop",
    countdown: null,
    title: null,
    left: 7,
  });
});

it("names what a Stop left unexpanded, with Resume", function () {
  const block = railWithHops(
    hopsInput({ fill: { remaining: 7, waiting: 3, paused: true } }),
  )!.hops!;
  expect(block.progress).to.deep.equal({
    afterHop: 2,
    kind: "rest",
    text: `${count(10)} not expanded`,
    details: null,
    action: "resume",
    actionLabel: "Resume",
    countdown: null,
    title: null,
    left: 0,
  });
});

it("offers Fetch more for the papers waiting on the cap", function () {
  const block = railWithHops(
    hopsInput({ fill: { remaining: 0, waiting: 1800, paused: false } }),
  )!.hops!;
  expect(block.progress).to.include({
    kind: "rest",
    text: `${count(1800)} not expanded`,
    action: "more",
    actionLabel: "Fetch more",
  });
});

// B72: a refusal storm ends with the plan empty and every paper limit-failed.
// The line carries the only Resume that brings them back (ADR 0014).
it("keeps a Resume on the line once the deferral limit has failed papers", function () {
  const block = railWithHops(
    hopsInput({
      failed: 4,
      fill: { remaining: 0, waiting: 0, paused: false, gaveUp: 4 },
    }),
  )!.hops!;
  expect(block.progress).to.include({
    kind: "rest",
    text: `${count(4)} failed`,
    action: "resume",
    actionLabel: "Resume",
  });
});

it("names every gap at rest, in order, with details on their own line", function () {
  const block = railWithHops(
    hopsInput({
      failed: 12,
      lacksDetails: 40,
      fill: { remaining: 180, waiting: 0, paused: true },
    }),
  )!.hops!;
  expect(block.progress).to.include({
    kind: "rest",
    text: `${count(180)} not expanded · ${count(12)} failed`,
    details: `${count(40)} without details`,
    action: "resume",
  });
});

it("carries no button for gaps nothing on the rail recovers", function () {
  const block = railWithHops(
    hopsInput({ failed: 2, lacksDetails: 5, fill: null }),
  )!.hops!;
  expect(block.progress).to.include({
    kind: "rest",
    text: `${count(2)} failed`,
    details: `${count(5)} without details`,
    action: null,
    actionLabel: null,
  });
});

it("draws no line when nothing is missing and nothing runs", function () {
  expect(railWithHops(hopsInput({ fill: null }))!.hops!.progress).to.equal(
    null,
  );
});
```

In "names the one provider refusing, with a countdown and Stop", the expected
object becomes:

```ts
{
  afterHop: 2,
  kind: "refusing",
  text: `${citationDataSourceLabel("semantic-scholar")} refusing`,
  details: null,
  action: "stop",
  actionLabel: "Stop",
  countdown: { retryAt: 1_234 },
  title: null,
  left: 0,
}
```

"counts several refusing providers" and "lets a refusal win over Fetch more"
stay as they are.

- [ ] **Step 2: Run to see them fail.**
      Run: `npx node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/graphScopeRailModel.test.ts`
      Expected: FAIL (type errors at runtime are stripped, so the failures
      are the new strings, e.g. expected `'4/5'` to equal `'4 papers'`).

- [ ] **Step 3: Implement the model.** In `graphScopeRailModel.ts`:

In `ScopeHopsInput`, delete `reportedByHop` and its comment, and add after
`availableByHop`:

```ts
  /**
   * Per hop, the visible papers one hop up whose list in the direction is
   * stored: the parents the hop came from. Index 0 is 0.
   */
  expandedByHop: readonly number[];
  /** Per hop, whether the plan still holds parents one hop up to expand. */
  growingByHop: readonly boolean[];
  /** Visible papers whose expansion failed in this direction (D12). */
  failed: number;
  /** Visible hop papers drawn without details (`lacksDetails`, D12). */
  lacksDetails: number;
```

Replace `ScopeHopRow`'s `count`/`reported` members with:

```ts
/** `{shown} papers`, the seed count, `not fetched`, `none yet` or `none found`. */
count: string;
/** `from {n}` while some parents one hop up are expanded, else null. */
from: string | null;
/** The hop still grows: its parents are in a running plan. */
spinning: boolean;
/** Shown and stored at the hop: the row's data attributes, not its text. */
shown: number;
available: number;
```

Replace `ScopeHopsProgress` with:

```ts
export interface ScopeHopsProgress {
  /** The row the line follows: the deepest open hop. */
  afterHop: number;
  /** Expanding; cooling down on a refusal; or at rest with something missing. */
  kind: "running" | "refusing" | "rest";
  /** Empty while running: the spinners and `from N` say it. */
  text: string;
  /** At rest only: `{n} without details`, on its own line. */
  details: string | null;
  action: "stop" | "resume" | "more" | null;
  actionLabel: "Stop" | "Resume" | "Fetch more" | null;
  /**
   * Set while the fill cools down. `retryAt` is fixed for the cool-down, so
   * the model does not change from second to second; the rail counts down to
   * it in place.
   */
  countdown: { retryAt: number } | null;
  /** The refusing providers' names, when the line counts them. */
  title: string | null;
  /** The parents still queued while running, else 0: the line's `data-left`. */
  left: number;
}
```

In `buildScopeHopsBlock`, move `const fill = input.fill;` and
`const refusal = fill?.refusal ?? null;` above the rows loop, add

```ts
const running =
  fill !== null &&
  fill.remaining > 0 &&
  !fill.paused &&
  !(refusal && refusal.providers.length > 0);
const papers = (n: number): string =>
  n === 1 ? "1 paper" : `${COUNT_FORMAT.format(n)} papers`;
```

and replace the pushed row's `count` and `reported` properties with:

```ts
      count:
        hop === 0
          ? COUNT_FORMAT.format(shown)
          : !opened
            ? "not fetched"
            : available === 0 && drainedAbove
              ? emptyWord
              : papers(shown),
      from:
        opened && hop > 0 && (input.expandedByHop[hop] ?? 0) > 0
          ? `from ${COUNT_FORMAT.format(input.expandedByHop[hop] ?? 0)}`
          : null,
      spinning: opened && hop > 0 && running && input.growingByHop[hop] === true,
      shown,
      available,
```

Replace everything from `let progress: ScopeHopsProgress | null = null;`
to the end of the `else if (fill && (fill.gaveUp ?? 0) > 0) { ... }` block
with:

```ts
let progress: ScopeHopsProgress | null = null;
if (refusal && refusal.providers.length > 0) {
  // While every candidate refuses, raising the cap would only defer more
  // papers, so the refusal wins over Fetch more (ADR 0013).
  const names = refusal.providers.map((provider) =>
    citationDataSourceLabel(provider),
  );
  progress = {
    afterHop: input.depth,
    kind: "refusing",
    text:
      names.length === 1
        ? `${names[0]} refusing`
        : `${COUNT_FORMAT.format(names.length)} providers refusing`,
    details: null,
    action: "stop",
    actionLabel: "Stop",
    countdown: { retryAt: refusal.retryAt },
    title: names.length === 1 ? null : names.join(", "),
    left: 0,
  };
} else if (running) {
  progress = {
    afterHop: input.depth,
    kind: "running",
    text: "",
    details: null,
    action: "stop",
    actionLabel: "Stop",
    countdown: null,
    title: null,
    left: fill?.remaining ?? 0,
  };
} else {
  // At rest: name only what is missing, each with the button that recovers
  // it (D12). A Stop's papers come back with Resume, the cap's with Fetch
  // more, and the deferral limit's with Resume (ADR 0014).
  const stopped = fill?.paused === true && fill.remaining > 0;
  const notExpanded =
    (stopped ? (fill?.remaining ?? 0) : 0) + (fill?.waiting ?? 0);
  const parts: string[] = [];
  if (notExpanded > 0)
    parts.push(`${COUNT_FORMAT.format(notExpanded)} not expanded`);
  if (input.failed > 0)
    parts.push(`${COUNT_FORMAT.format(input.failed)} failed`);
  const details =
    input.lacksDetails > 0
      ? `${COUNT_FORMAT.format(input.lacksDetails)} without details`
      : null;
  const action: ScopeHopsProgress["action"] = stopped
    ? "resume"
    : (fill?.waiting ?? 0) > 0
      ? "more"
      : (fill?.gaveUp ?? 0) > 0
        ? "resume"
        : null;
  if (parts.length || details) {
    progress = {
      afterHop: input.depth,
      kind: "rest",
      text: parts.join(" · "),
      details,
      action,
      actionLabel:
        action === "resume"
          ? "Resume"
          : action === "more"
            ? "Fetch more"
            : null,
      countdown: null,
      title: null,
      left: 0,
    };
  }
}
```

`HOP_EXPANSION_CAP` may now be unused in this file: remove its import if
eslint says so.

- [ ] **Step 4: Run to see the model pass.** Same command as Step 2.
      Expected: PASS.

- [ ] **Step 5: Wire the service.** In `graphViewService.ts`, add
      `lacksDetails` to the import from `./graphFocusService` (or add that
      import). Above `scopeHopsInput`, add:

```ts
/**
 * Per hop, the visible parents one hop up whose list is stored, and the
 * visible hop papers drawn without details (D7, D12). Both read stored
 * facts, so a reopened graph reads the same.
 */
const hopRailCounts = (): {
  expandedByHop: number[];
  lacksDetails: number;
} => {
  const expandedByHop = Array.from({ length: hopDepth + 1 }, () => 0);
  let lacking = 0;
  if (hopModel && lastScope) {
    for (const [key, entry] of hopModel.entries) {
      if (!lastScope.visibleKeys.has(key)) continue;
      if (entry.expanded && entry.hop < hopDepth)
        expandedByHop[entry.hop + 1] = (expandedByHop[entry.hop + 1] ?? 0) + 1;
      if (entry.hop >= 1) {
        const node = hopSubject(key);
        if (node && lacksDetails(node)) lacking += 1;
      }
    }
  }
  return { expandedByHop, lacksDetails: lacking };
};
```

In `scopeHopsInput()`, delete the `reportedByHop` property and add:

```ts
      ...hopRailCounts(),
      growingByHop: hopModel
        ? hopFill.growingByHop(hopDepth, hopDirection)
        : [],
      failed: lastScope
        ? hopFill.failedCount(lastScope.visibleKeys, hopDirection)
        : 0,
```

- [ ] **Step 6: Render.** In `graphKeyRail.ts`:

In `hopsBlockElement`, replace the loop body's progress append with:

```ts
if (block.progress && block.progress.afterHop === row.hop) {
  rows.append(...progressLines(block.progress));
}
```

In `hopRowElement`, after `wrapper.dataset.hop = String(row.hop);` add:

```ts
// The counts behind the row's words, for the suite: the text no longer
// carries `available` (D7).
wrapper.dataset.shown = String(row.shown);
wrapper.dataset.available = String(row.available);
if (row.spinning) wrapper.setAttribute("aria-busy", "true");
```

and replace the `else { ... }` branch that appends the count and
`row.reported` with:

```ts
    } else {
      body.appendChild(text(document, "span", row.count, "cm-scope-row-count"));
      if (row.from) {
        body.appendChild(
          text(document, "span", `· ${row.from}`, "cm-scope-hop-from"),
        );
      }
      if (row.spinning) {
        const spinner = element(document, "span", "cm-scope-hop-spinner");
        spinner.setAttribute("aria-hidden", "true");
        body.appendChild(spinner);
      }
    }
```

Replace `function progressLine(progress: ScopeHopsProgress): HTMLElement { ... }`
with:

```ts
function progressLines(progress: ScopeHopsProgress): HTMLElement[] {
  const line = element(document, "p", "cm-scope-hop-progress");
  line.dataset.kind = progress.kind;
  line.dataset.left = String(progress.left);
  if (progress.title) line.title = progress.title;
  const parts: HTMLElement[] = [];
  if (progress.text) parts.push(text(document, "span", progress.text));
  const countdown = progress.countdown;
  if (countdown) {
    // Only this span changes each second. The model's `retryAt` is fixed,
    // so its signature holds, the Scope section is not rebuilt, and focus
    // stays on Stop while the countdown runs (B50).
    const span = text(
      document,
      "span",
      formatRetryIn(countdown.retryAt - now()),
      "cm-scope-hop-countdown",
    );
    parts.push(span);
    const view = document.defaultView;
    if (view) {
      countdownTimer = view.setInterval(() => {
        span.textContent = formatRetryIn(countdown.retryAt - now());
      }, 1000);
    }
  }
  const action = progress.action;
  if (action && progress.actionLabel) {
    // Its own class, not the hidden line's `cm-scope-show-all`: the two sit
    // in the same Scope section, and a `querySelector` for one must never
    // answer with the other (the progress line is rendered above it).
    const control = element(document, "button", "cm-scope-hop-action");
    control.type = "button";
    control.textContent = progress.actionLabel;
    control.addEventListener("click", () =>
      options.onScope.fillControl(action),
    );
    parts.push(control);
  }
  parts.forEach((part, index) => {
    if (index > 0) line.append(text(document, "span", " · "));
    line.append(part);
  });
  if (!progress.details) return [line];
  return [line, text(document, "p", progress.details, "cm-scope-hop-details")];
}
```

- [ ] **Step 7: Style.** In `addon/content/graph.css`, rename the
      `.cm-scope-hop-reported` rule to `.cm-scope-hop-from` and change its
      comment to `/* `182 papers · from 40` is one phrase: pull the body's 6px
gap in to one 11px space (B91). */`. After the `.cm-scope-hop-progress`
      rule add:

```css
.cm-scope-hop-details {
  margin: 0 0 4px 32px;
  color: var(--cm-muted);
  font-size: calc(11 * var(--cm-font-unit));
  font-variant-numeric: tabular-nums;
}
/* A hop still growing (D7): a ring with one quarter open, turning. */
.cm-scope-hop-spinner {
  flex: 0 0 auto;
  box-sizing: border-box;
  width: calc(9 * var(--cm-font-unit));
  height: calc(9 * var(--cm-font-unit));
  border: 1.5px solid var(--cm-muted);
  border-inline-end-color: transparent;
  border-radius: 50%;
  animation: cm-scope-hop-spin 0.9s linear infinite;
}
@keyframes cm-scope-hop-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .cm-scope-hop-spinner {
    animation: none;
  }
}
```

- [ ] **Step 8: `npm run check`.** Expected: PASS. If typecheck fails in
      `test/zotero/hostButtonHeight.test.ts` on `reported`, that is Task 4's;
      make the minimal fixture fix described there now so the gate passes.
- [ ] **Step 9: Commit**
      `git add src/services/graphScopeRailModel.ts src/services/graphViewService.ts src/services/graphKeyRail.ts addon/content/graph.css test/unit/graphScopeRailModel.test.ts`
      (plus `test/zotero/hostButtonHeight.test.ts` if touched), subject
      `The hop rows say how many papers and where from, and the line says what is missing (D7, D12)`.

---

### Task 4: The Zotero suites read the new rail

**Files:**

- Modify: `test/zotero/graphCitationHops.test.ts` (helpers ~585-620; reads
  at ~1213-1238, ~1503, ~1549, ~1951, ~2111)
- Modify: `test/zotero/hostButtonHeight.test.ts` (fixture ~205-225; B91 case
  ~299-372)

**Interfaces:**

- Consumes: Task 3's DOM: `data-shown`, `data-available`, `aria-busy`,
  `.cm-scope-hop-from`, `.cm-scope-hop-spinner`, `.cm-scope-hop-progress`'s
  `data-kind` and `data-left`.

- [ ] **Step 1: hostButtonHeight fixture.** In `HOP_ROW_MODEL`'s hop row,
      replace `count: "73/173", reported: null,` with
      `count: "73 papers", from: "from 12", spinning: false, shown: 73, available: 173,`.

- [ ] **Step 2: B91 case.** Rename it to
      `"keeps one space between a hop row's count and where it came from"`,
      update its doc comment's phrase to `182 papers · from 40`, and in it:
  - the render override becomes
    `rows: [{ ...hops.rows[0], count: "182 papers", from: "from 40" }],`
  - every `.cm-scope-hop-reported` selector and the probe's class become
    `.cm-scope-hop-from`; rename the `reported` variable to `from` and its
    message to `"the hop row carries where it came from"`;
  - the final message reads
    `` `the count and its source sit one space (${measured.space.toFixed(1)}px) ` + `apart, but the gap is ${measured.gap.toFixed(1)}px` ``.

- [ ] **Step 3: The hops suite's helpers.** In `graphCitationHops.test.ts`,
      replace `hopCounts`, `progressText` and `isExpanding` with:

```ts
/** The row's shown and stored counts, from its data attributes. */
function hopCounts(hop: number): { shown: number; available: number } | null {
  const row = hopRow(hop) as HTMLElement | null;
  if (!row?.dataset.shown || !row.dataset.available) return null;
  // The Fetch row is not opened; it carries the attributes but no count.
  if (!row.querySelector(".cm-scope-row-count")) return null;
  return {
    shown: Number(row.dataset.shown),
    available: Number(row.dataset.available),
  };
}

/** The row's `from {n}` text, or null while it has none. */
function hopFromText(hop: number): string | null {
  const text = hopRow(hop)?.querySelector(".cm-scope-hop-from")?.textContent;
  return text ? normalize(text) : null;
}

/**
 * The runner's progress line as `[{kind} left={n}] {text}`, absent while it
 * has nothing to say. The running line has no text of its own (D7), so the
 * kind and the queued count come from its data attributes.
 */
function progressText(): string {
  const line = graphRoot().querySelector(
    ".cm-scope-hop-progress",
  ) as HTMLElement | null;
  if (!line) return "no progress line";
  return `[${line.dataset.kind} left=${line.dataset.left}] ${normalize(line.textContent)}`;
}

/** The progress line while the runner has work in hand. */
function isExpanding(line: string): boolean {
  return /^\[running left=\d+\]/.test(line);
}
```

(If `hopRow` already returns `HTMLElement | null`, drop the cast.)

- [ ] **Step 4: The reads.** Replace, in this file:
  - `.to.match(/^expanding · \d+ left/);` (end of "keeps Refresh pressable
    while the fill runs") → `.to.match(/^\[running left=\d+\]/);`
  - each `/ left · Resume$/` (two, in the Stop-and-reopen case) →
    `/ not expanded( · [^·]+ failed)? · Resume$/` (the held paper may land
    as a failure)
  - `/1 left · Resume$/` (the refusal case, "2. Stop pauses it") →
    `/\] 1 not expanded · Resume$/`
  - in `leftCount()`, the regex `/^expanding · (.+?) left/` →
    `/^\[running left=(\d+)\]/`, and update its doc comment to "The queued
    count of a running line, or null while the line is anything else."
  - Then grep the file for `expanding ·`, ` left`, `gave up`, `waiting` and
    `of ` inside regexes or string compares, and convert any remaining read
    of the old strings the same way. `none yet`, `not fetched`,
    `refusing · retry in` and the Seeds count are unchanged.

- [ ] **Step 5: `from N` survives a reopen.** In the Stop-and-reopen case
      (the one that awaits the `not expanded … Resume` line twice), capture
      before closing the tab, right after the first wait passes:

```ts
const fromBefore = hopFromText(2);
expect(fromBefore, `hop 2 carries no from; ladder ${ladder()}`).to.match(
  /^· from \d+$/,
);
```

and after the reopened line's `expect(line, ...).to.exist;` add:

```ts
expect(hopFromText(2), `the reopened hop 2 read "${hopRowText(2)}"`).to.equal(
  fromBefore,
);
```

- [ ] **Step 6: Lint before the suite.** `npm run check`. Expected: PASS.
- [ ] **Step 7: Run the full Zotero suite** (it is due; this is the only run
      in the plan): `npm test`, output to a log file, wait for the npm task to
      exit. Expected: 110 passed, 0 failed (no case is added: the reopen
      assertion rides an existing case). Only the floor-drag case is a
      known flake; rerun its file alone before debugging it. Any other
      failure: superpowers:systematic-debugging, with evidence in assertion
      messages (Zotero.debug never reaches the runner log).

- [ ] **Step 8: Commit**
      `git add test/zotero/graphCitationHops.test.ts test/zotero/hostButtonHeight.test.ts`,
      subject `The suites read the hop rows' new words (D7)`.

---

### Task 5: Docs, roadmap, build

**Files:**

- Modify: `docs/superpowers/specs/2026-10-09-hop-rail-story-design.md`
- Modify: `docs/superpowers/handoffs/roadmap.md`

- [ ] **Step 1: Bring the spec in line with what was built.** In its Data
      section, replace the bullet beginning "The runner's `state()` gains" with:
      "The runner gains `growingByHop(depth, direction)` (true for a hop while
      its last plan, at that direction and depth, still holds parents one hop
      up not waiting on the cap) and `failedCount(visibleKeys, direction)`
      (the deferral limit's failures are already in `failed`).
      `reportedByHop` is removed." In "The line under the rows", the button
      rule reads: "**Resume** when stopped with papers still planned; else
      **Fetch more** when any wait on the cap; else **Resume** when any gave
      up; else none." And `without details` counts visible hop papers.
- [ ] **Step 2: Roadmap.** Delete the D7 and D12 entries. Narrow B51 to:
      "B51 opening a deeper hop: establish whether the shallower hop's queued
      parents stay in the plan (its row now keeps spinning while they do)".
      Delete D11's sentence "Also decide whether unresolved papers are drawn
      at all" only if it is still there and unchanged; otherwise leave D11.
      Add to Manual verification:
      "- [ ] D7/D12: fill a seeded graph to hop 2: the growing rows spin and
      read `n papers · from N`, the line under them is Stop alone; press Stop:
      the line reads `n not expanded · Resume`, and `n without details` sits
      under it if any paper has no title, year or count. Reopen the saved
      graph: `from N` reads the same."
      Update "Last full run" with Task 4's count and commit, and add a Log
      line for the session.
- [ ] **Step 3: `npx prettier --write` the two docs, `npm run check`, commit**
      `git add docs/superpowers/specs/2026-10-09-hop-rail-story-design.md docs/superpowers/handoffs/roadmap.md`,
      subject `D7 and D12 ship; the roadmap says so`.
- [ ] **Step 4: Build last.** `npm run build`; confirm
      `.scaffold/build/meristema.xpi` exists with a fresh timestamp.
