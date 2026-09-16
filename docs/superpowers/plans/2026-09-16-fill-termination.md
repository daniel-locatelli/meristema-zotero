# A Fill That Can Finish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A hop fill always terminates: a paper whose true answer is "no citers"
is stored as such, and no paper can be deferred without end (B72).

**Architecture:** Three rules, each in a pure function with one call site. A
work-ID hint the asking provider supplied backs an empty first page, so it is
an answer rather than a failure. An empty answer does not end an expansion
while another candidate can still be asked. A paper deferred three times with
nothing ever stored is failed for the session, and Resume undoes exactly those
failures.

**Tech Stack:** TypeScript, Zotero 7 plugin (`zotero-plugin-scaffold`),
`node:test` + `chai` for unit tests, the Zotero test runner for integration.

Spec: `docs/superpowers/specs/2026-09-16-fill-termination-design.md`.
Defect: B72 in `docs/superpowers/handoffs/2026-09-08-roadmap.md`.

## Global Constraints

- `npm run check` must pass before any commit: it runs
  `prettier --check . && eslint .`, then `tsc --noEmit && tsc --noEmit -p test`,
  then `npm run test:unit`.
- Unit tests run with `npm run test:unit`. A single file runs with
  `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/<file>.test.ts`.
- The Zotero suite runs with `npm test`, which launches a second Zotero. Wait
  for the task to finish before starting another run, or the next one fails on
  a locked `cert9.db`. It also deletes `.scaffold/build/meristema.xpi`, so the
  XPI is rebuilt last (Task 7).
- Do not run `npm test` while a live measurement is in progress, and ask before
  stopping a running Zotero: the user usually has a session open.
- ADR 0013 stands. `outcomeRefused` is not narrowed; a skipped provider still
  makes a landing refused.
- `DEFERRAL_LIMIT` is **3**.
- Docs are prettier-formatted. In the roadmap, list continuation lines are
  indented **6 spaces**; check that after formatting, because prettier can
  rewrap a long code span onto a 4-space line.
- Do not push. Commit locally only.

---

### Task 1: A work-ID hint backs an empty first page

**Files:**

- Modify: `src/services/relationshipRefreshPolicy.ts:292-312`
- Modify: `src/services/externalDiscoveryService.ts:1387-1397`
- Test: `test/unit/relationshipRefreshPolicy.test.ts:259-279`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `unbackedEmptyList(input: { fill: boolean; firstPageEmpty: boolean; matched: boolean; reportedCount: number | null; hinted: boolean }): boolean`.

- [ ] **Step 1: Write the failing test**

In `test/unit/relationshipRefreshPolicy.test.ts`, replace the whole
`describe("unbackedEmptyList", ...)` block with this one. The shared fixture
gains `hinted: false`, because the new field is required:

```ts
describe("unbackedEmptyList", function () {
  const empty = {
    fill: true,
    firstPageEmpty: true,
    matched: false,
    reportedCount: null,
    hinted: false,
  };

  it("fails a fill's empty first page with no match and no count behind it", function () {
    expect(unbackedEmptyList(empty)).to.equal(true);
  });

  it("trusts it with a lookup match or a reported count, and on manual paths", function () {
    expect(unbackedEmptyList({ ...empty, matched: true })).to.equal(false);
    expect(unbackedEmptyList({ ...empty, reportedCount: 12 })).to.equal(false);
    expect(unbackedEmptyList({ ...empty, fill: false })).to.equal(false);
    expect(unbackedEmptyList({ ...empty, firstPageEmpty: false })).to.equal(
      false,
    );
  });

  // B72: the fill hints the work ID for every external paper, so the lookup
  // that would supply a match is skipped on purpose. The hint is the backing:
  // the provider emitted this DOI in one of its own citation links.
  it("trusts it when the asking provider's own work-ID hint stands behind it", function () {
    expect(unbackedEmptyList({ ...empty, hinted: true })).to.equal(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/relationshipRefreshPolicy.test.ts
```

Expected: FAIL. The new case reports `expected true to equal false`, because
`hinted` is ignored today.

- [ ] **Step 3: Write the minimal implementation**

In `src/services/relationshipRefreshPolicy.ts`, replace `unbackedEmptyList` and
its doc comment with:

```ts
/**
 * Whether an empty first page is a failure rather than an empty list. A fill
 * trusts an empty list only when something stands behind it: a lookup match, a
 * reported count, or a work-ID hint the asking provider itself supplied.
 * OpenCitations answers 200 with `[]` for a DOI it does not index, and its
 * lookup no longer matches at all (410 Gone, B63), so its DOI fallback would
 * otherwise store "no citers" for every paper it has never seen. A hint is
 * different in kind: the provider emitted that identifier in one of its own
 * citation links, so it does index the paper, and the fill skips the lookup
 * that would have matched it (B72). Manual paths keep today's rule.
 */
export function unbackedEmptyList(input: {
  fill: boolean;
  firstPageEmpty: boolean;
  matched: boolean;
  reportedCount: number | null;
  hinted: boolean;
}): boolean {
  return (
    input.fill &&
    input.firstPageEmpty &&
    !input.matched &&
    !input.hinted &&
    input.reportedCount === null
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run the same command as Step 2. Expected: PASS, all cases in the file.

- [ ] **Step 5: Pass the hint at the call site**

In `src/services/externalDiscoveryService.ts`, in the empty-page branch at
`:1387-1397`, add the `hinted` argument:

```ts
if (!page.length) {
  if (
    unbackedEmptyList({
      fill: requestOptions?.retryRefusals === false,
      firstPageEmpty: pages === 1 && collectedWorks.length === 0,
      matched: Boolean(match),
      reportedCount,
      hinted: Boolean(hintedProviderWorkID),
    })
  ) {
    return failed();
  }
  endpointExhausted = true;
  break;
}
```

- [ ] **Step 6: Typecheck and run the whole unit suite**

Run:

```bash
npm run typecheck && npm run test:unit
```

Expected: no type errors; the unit suite passes (631 tests before this plan's
additions, one more now).

- [ ] **Step 7: Commit**

```bash
git add src/services/relationshipRefreshPolicy.ts src/services/externalDiscoveryService.ts test/unit/relationshipRefreshPolicy.test.ts
git commit -m "B72: a provider's own work-ID hint backs its empty list"
```

---

### Task 2: An empty answer does not end the expansion

**Files:**

- Modify: `src/services/relationshipRefreshPolicy.ts:259-290`
- Modify: `src/services/externalDiscoveryService.ts:1519-1525`, `:1684-1703`, `:2039-2047`
- Test: `test/unit/relationshipRefreshPolicy.test.ts:244-257`

**Interfaces:**

- Consumes: nothing from Task 1.
- Produces: `fillStopsAt(snapshot: { refused: boolean; succeeded: boolean; empty: boolean }, hasNextCandidate: boolean): boolean`.

- [ ] **Step 1: Write the failing test**

In `test/unit/relationshipRefreshPolicy.test.ts`, replace the whole
`describe("fillStopsAt", ...)` block with this one. Every existing call gains
the two new arguments:

```ts
describe("fillStopsAt", function () {
  it("stops on an answer with works, or a failure, today's rule", function () {
    expect(
      fillStopsAt({ refused: false, succeeded: true, empty: false }, true),
    ).to.equal(true);
    expect(
      fillStopsAt({ refused: false, succeeded: false, empty: true }, true),
    ).to.equal(true);
  });

  it("stops on a refusal that still collected a usable partial list", function () {
    expect(
      fillStopsAt({ refused: true, succeeded: true, empty: false }, true),
    ).to.equal(true);
  });

  it("does not stop on a refusal with nothing usable", function () {
    expect(
      fillStopsAt({ refused: true, succeeded: false, empty: true }, true),
    ).to.equal(false);
  });

  // B72: OpenCitations answering "no citers" ended the expansion, so OpenAlex
  // was never asked for any of the frontier papers, though it was answering.
  it("asks the next candidate past an empty answer, and stops at the last one", function () {
    expect(
      fillStopsAt({ refused: false, succeeded: true, empty: true }, true),
      "a candidate is left to ask",
    ).to.equal(false);
    expect(
      fillStopsAt({ refused: false, succeeded: true, empty: true }, false),
      "nobody else can be asked, so the empty list stands",
    ).to.equal(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/relationshipRefreshPolicy.test.ts
```

Expected: FAIL on "asks the next candidate past an empty answer" with
`expected true to equal false`.

- [ ] **Step 3: Write the minimal implementation**

In `src/services/relationshipRefreshPolicy.ts`, replace `fillStopsAt` and its
doc comment with:

```ts
/**
 * Whether a fill expansion stops at this snapshot (ADR 0013): an answer with
 * works or a failure always ends it, and so does a refusal that still
 * collected a usable partial list, keeping one answering provider per
 * expansion. A refusal with nothing usable moves the expansion on to the next
 * candidate, and so does an empty answer while a candidate is left to ask
 * (B72) — only the last candidate's empty list stands as "no citers".
 */
export function fillStopsAt(
  snapshot: { refused: boolean; succeeded: boolean; empty: boolean },
  hasNextCandidate: boolean,
): boolean {
  if (snapshot.refused) return snapshot.succeeded;
  if (snapshot.succeeded && snapshot.empty) return !hasNextCandidate;
  return true;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run the same command as Step 2. Expected: PASS.

- [ ] **Step 5: Ask past an empty answer at the call site**

In `src/services/externalDiscoveryService.ts`, replace `askUntilNotRefused`
(`:1679-1703`, comment included) with:

```ts
/**
 * A fill expansion's candidates, asked one at a time until one answers with
 * works, fails, or refuses with a usable partial list. A refusal with nothing
 * usable moves the expansion straight on to the next candidate, and so does an
 * empty answer while another candidate is left (B72); the last candidate's
 * empty list stands. Each candidate is asked at most once.
 */
async function askUntilNotRefused(
  candidates: readonly CitationProviderID[],
  ask: (provider: CitationProviderID) => Promise<RelationshipProviderSnapshot>,
  cancelled: () => boolean,
): Promise<RelationshipProviderSnapshot[]> {
  const results: RelationshipProviderSnapshot[] = [];
  const asked: CitationProviderID[] = [];
  for (
    let provider = nextFillProvider(candidates, asked);
    provider !== null;
    provider = nextFillProvider(candidates, asked)
  ) {
    if (cancelled()) break;
    const snapshot = await ask(provider);
    results.push(snapshot);
    asked.push(provider);
    if (
      fillStopsAt(
        { ...snapshot, empty: snapshot.works.length === 0 },
        nextFillProvider(candidates, asked) !== null,
      )
    ) {
      break;
    }
  }
  return results;
}
```

- [ ] **Step 6: Move `answeredBy`'s rule and its documented contract**

In `src/services/externalDiscoveryService.ts`, at the `answeredBy` field's
declaration (`:1523`), replace the comment:

```ts
/** The provider whose window this landing clears: the last usable snapshot to contribute works, else the last usable one. */
answeredBy: CitationProviderID | null;
```

Then, in the `options.onMembershipResolved?.({ ... })` call after the commit
(`:2039-2047`), compute it from the usable snapshots instead of requiring
exactly one. Insert the `const` immediately before that call and use it in the
object:

```ts
// An expansion may now hold an empty answer and a later non-empty one
// (B72), so "exactly one usable snapshot" no longer identifies who
// answered. The window to clear belongs to whoever last gave us works, or,
// when every answer was empty, to the last provider that answered at all.
const answered =
  [...usable]
    .reverse()
    .find((snapshot) => snapshot.identifiedWorks.length > 0) ??
  usable[usable.length - 1];
options.onMembershipResolved?.({
  complete: selection.complete,
  provider: publishedReported.provider,
  reportedCount: publishedReported.count,
  identifiedCount: committed.length,
  refusedBy,
  skipped,
  answeredBy: answered.provider,
});
```

- [ ] **Step 7: Typecheck and run the whole unit suite**

Run:

```bash
npm run typecheck && npm run test:unit
```

Expected: no type errors; the unit suite passes.

- [ ] **Step 8: Commit**

```bash
git add src/services/relationshipRefreshPolicy.ts src/services/externalDiscoveryService.ts test/unit/relationshipRefreshPolicy.test.ts
git commit -m "B72: an empty answer does not end the expansion while a candidate remains"
```

---

### Task 3: The deferral limit, in the runner's model

**Files:**

- Modify: `src/services/graphHopRunnerModel.ts:18-93`
- Test: `test/unit/graphHopRunnerModel.test.ts:51-131`

**Interfaces:**

- Consumes: nothing from Tasks 1-2.
- Produces: `DEFERRAL_LIMIT: number` (3) and `HopLandingInput.deferrals: number`, both exported from `src/services/graphHopRunnerModel.ts`. Task 4 imports both.

- [ ] **Step 1: Write the failing test**

In `test/unit/graphHopRunnerModel.test.ts`, add `DEFERRAL_LIMIT` to the import
list from `../../src/services/graphHopRunnerModel` (keep the list alphabetical:
it goes after `COOL_DOWN_MS`).

Then add `deferrals: 0` to **every** existing `hopLandingEffects({ ... })` call
in the file — there are seven, at `:58`, `:80`, `:101`, `:117`, `:148`, `:167`
and `:184` — since the field is required and the file will not compile while
one is missing. None of them changes meaning: `:58`, `:101` and `:117` are not
refused, `:148` and `:184` pass `stored: true`, which is decided before the
refusal branch, and `:167` is the refusal that defers, which `0 < 3` still
does.

Then add these two cases at the end of the `describe("a refused landing", ...)`
block (it opens at `:164`), immediately before its closing `});` — that is
where the refusal cases live, not the landing block above it:

```ts
// B72: a provider that refuses for good pins every paper it was eligible
// for, because a merely skipped provider makes the landing refused and
// `markFailed` is only reached when it is not. The count is what makes that
// branch reachable again, so the plan can drain.
it("fails a paper the deferral limit has run out for", function () {
  const refused = {
    epoch: 1,
    currentEpoch: 1,
    cleaned: false,
    stored: false,
    refused: true,
  };
  expect(
    hopLandingEffects({ ...refused, deferrals: DEFERRAL_LIMIT - 1 }).defer,
    "one deferral short of the limit still waits",
  ).to.equal(true);
  expect(
    hopLandingEffects({ ...refused, deferrals: DEFERRAL_LIMIT }),
  ).to.deep.equal({
    countExpanded: false,
    markFailed: true,
    defer: false,
    applyToModel: true,
  });
});

it("counts a stored summary as expanded however often it was deferred", function () {
  expect(
    hopLandingEffects({
      epoch: 1,
      currentEpoch: 1,
      cleaned: false,
      stored: true,
      refused: true,
      deferrals: DEFERRAL_LIMIT + 5,
    }),
  ).to.deep.equal({
    countExpanded: true,
    markFailed: false,
    defer: false,
    applyToModel: true,
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/graphHopRunnerModel.test.ts
```

Expected: FAIL — `DEFERRAL_LIMIT` is not exported, so the file does not compile.

- [ ] **Step 3: Write the minimal implementation**

In `src/services/graphHopRunnerModel.ts`, add the `deferrals` field to
`HopLandingInput`, immediately after `refused`:

```ts
/**
 * How many times this paper has already been deferred in this direction
 * with nothing ever stored. Read only when the landing is refused.
 */
deferrals: number;
```

Add the limit beside the effects, above `hopLandingEffects`:

```ts
/**
 * How many times a paper may be deferred with nothing stored before it fails
 * for the session. Without it a provider that refuses for good pins every
 * paper it was eligible for, because a skipped provider makes every landing
 * refused and `markFailed` is only reached when it is not (B72).
 */
export const DEFERRAL_LIMIT = 3;
```

Then replace the `refused` branch of `hopLandingEffects` with:

```ts
// A refusal is not a failure (ADR 0013): the paper stays in the plan, and
// nothing in the store changed, so there is nothing to apply. But it may not
// stay for ever: at the limit it falls through and fails, so the plan can
// drain while a provider refuses for good (B72). Resume brings it back.
if (input.refused && input.deferrals < DEFERRAL_LIMIT) {
  return {
    countExpanded: false,
    markFailed: false,
    defer: true,
    applyToModel: false,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run the same command as Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/graphHopRunnerModel.ts test/unit/graphHopRunnerModel.test.ts
git commit -m "B72: a paper deferred to the limit fails for the session"
```

---

### Task 4: The runner counts deferrals, and Resume undoes the limit's failures

**Files:**

- Modify: `src/services/graphHopFillRunner.ts:186-196`, `:207-245`, `:287-312`, `:372-413`
- Test: `test/unit/graphHopFillRunner.test.ts:172-620`

**Interfaces:**

- Consumes: `DEFERRAL_LIMIT` and `HopLandingInput.deferrals` from Task 3.
- Produces: no new exports. `HopFillRunner`'s interface is unchanged; `retryNow()` gains the behaviour of clearing the limit's failures.

- [ ] **Step 1: Write the failing tests**

In `test/unit/graphHopFillRunner.test.ts`, add these two cases at the end of
the `describe("createHopFillRunner", ...)` block, before its closing `});`:

```ts
// B72: both providers refuse for good. The paper is deferred while the
// ladder climbs, then fails, so the plan drains instead of re-asking it for
// ever — and Resume, which is the reader saying "try again now", brings it
// back.
it("fails a paper the deferral limit ran out for, and Resume brings it back", async function () {
  const fake = fakeHost();
  fake.entries.delete("b");
  fake.refusing.add(S2);
  fake.refusing.add(OC);
  const runner = createHopFillRunner(fake.host);
  runner.wake();
  await fake.settle();
  await fake.advance(30_000);
  await fake.advance(60_000);
  await fake.advance(120_000);
  expect(
    fake.calls.expanded,
    "deferred three times, then asked once more and failed",
  ).to.deep.equal(["a", "a", "a", "a"]);
  await fake.advance(300_000);
  expect(
    fake.calls.expanded,
    "the limit failed it, so no later window asks it again",
  ).to.deep.equal(["a", "a", "a", "a"]);
  expect(runner.state(), "the plan drained").to.equal(null);
  fake.refusing.clear();
  runner.retryNow();
  await fake.settle();
  expect(fake.calls.expanded.slice(4)).to.deep.equal(["a"]);
});

it("keeps a paper failed the ordinary way out across Resume", async function () {
  const fake = fakeHost();
  fake.failing.add("a");
  const runner = createHopFillRunner(fake.host);
  runner.wake();
  await fake.settle();
  expect(fake.calls.expanded).to.deep.equal(["a", "b"]);
  runner.retryNow();
  await fake.settle();
  expect(
    fake.calls.expanded,
    "a provider answered nothing usable: that is not the limit's failure",
  ).to.deep.equal(["a", "b"]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/graphHopFillRunner.test.ts
```

Expected: FAIL. The first case reports five or more entries in
`fake.calls.expanded` (the paper is asked again at every window end), and
`runner.state()` is not null.

- [ ] **Step 3: Carry the count beside the deadline**

In `src/services/graphHopFillRunner.ts`, import the two new names by replacing
the `DEFERRAL_LIMIT`-less import block from `./graphHopRunnerModel` — add
`DEFERRAL_LIMIT,` as the first entry, keeping the rest as they are:

```ts
import {
  DEFERRAL_LIMIT,
  NO_OUTCOME,
  answer,
  deferUntil,
  endAll,
  excluded,
  hopCoolDown,
  hopLandingEffects,
  hopRejectionEffects,
  outcomeRefused,
  refuse,
  type HopExpandOutcome,
  type ProviderWindows,
} from "./graphHopRunnerModel";
```

Replace the `deferrals` declaration (`:189-190`) with the count beside it, and
add the set that records what the limit failed:

```ts
/**
 * A refused paper's key, when its deferral ends, and how many times it has
 * been deferred with nothing stored, by direction.
 */
const deferrals = perDirection(
  () => new Map<string, { until: number; count: number }>(),
);
/**
 * The papers the deferral limit failed, by direction. Resume brings these
 * back; a paper a provider answered nothing usable for stays out (B72).
 */
const limitFailed = perDirection(() => new Set<string>());
```

In `plan()` (`:213-216`), read the deadline off the record:

```ts
const deferredKeys = new Set<string>();
for (const [key, { until }] of deferrals[direction]) {
  if (until > now) deferredKeys.add(key);
}
```

In `coolDown()` (`:234-237`), likewise:

```ts
for (const key of current.deferred) {
  const until = deferrals[lastDirection].get(key)?.until;
  if (until !== undefined && until > now) deferralEnds.push(until);
}
```

- [ ] **Step 4: Count the deferral, and record what the limit failed**

In `expand()`, replace the block from the `hopLandingEffects` call through
`if (effects.markFailed) failed[direction].add(key);` (`:287-311`) with:

```ts
// What the landing means is decided by `hopLandingEffects`
// (graphHopRunnerModel.ts): expanded is a stored summary, refused is
// deferred until the limit runs out, anything else failed for the
// session, and a stale epoch drops all three.
const deferred = deferrals[direction].get(key)?.count ?? 0;
const effects = hopLandingEffects({
  epoch: startEpoch,
  currentEpoch: epoch,
  cleaned: disposed,
  stored: host.stored(key, direction),
  refused: outcomeRefused(outcome),
  deferrals: deferred,
});
if (effects.defer) {
  refusedLanding = true;
  const until = deferUntil(
    windows,
    [...outcome.refusedBy, ...outcome.skipped],
    host.now(),
  );
  // The count is kept even when no window is ahead, so a deferral the
  // plan does not hold back still counts against the limit.
  deferrals[direction].set(key, {
    until: until ?? 0,
    count: deferred + 1,
  });
  return;
}
if (!effects.applyToModel) return;
deferrals[direction].delete(key);
if (effects.countExpanded) {
  const hop = host.hopOf(key) ?? 0;
  const counts = expanded[direction];
  counts[hop] = (counts[hop] ?? 0) + 1;
}
if (effects.markFailed) {
  failed[direction].add(key);
  // Only the limit's failures come back on Resume.
  if (deferred >= DEFERRAL_LIMIT) limitFailed[direction].add(key);
}
```

- [ ] **Step 5: Let Resume undo the limit's failures**

In the returned object, replace `retryNow` (`:381-386`) and add one line to
`reset` (`:405-410`):

```ts
    retryNow: () => {
      windows = endAll(windows, host.now());
      for (const direction of DIRECTIONS) {
        deferrals[direction].clear();
        // The reader is asking to try again now, which is exactly the case the
        // deferral limit should yield to (B72). A paper a provider answered
        // nothing usable for is not the limit's, and stays out.
        for (const key of limitFailed[direction]) failed[direction].delete(key);
        limitFailed[direction].clear();
      }
      coolingUntil = null;
      wake();
    },
```

```ts
for (const direction of DIRECTIONS) {
  failed[direction].clear();
  limitFailed[direction].clear();
  deferrals[direction].clear();
  expanded[direction] = [];
  caps[direction] = [];
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run:

```bash
node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/graphHopFillRunner.test.ts
```

Expected: PASS, the whole file — the existing deferral and window cases
included.

- [ ] **Step 7: Run the full check**

Run:

```bash
npm run check
```

Expected: prettier and eslint clean, no type errors, the unit suite green.

- [ ] **Step 8: Commit**

```bash
git add src/services/graphHopFillRunner.ts test/unit/graphHopFillRunner.test.ts
git commit -m "B72: the fill counts deferrals, and Resume undoes the limit's failures"
```

---

### Task 5: The Zotero case nobody built

**Files:**

- Modify: `test/zotero/graphCitationHops.test.ts` (new `describe` block after
  the B50 block, which ends at `:1333`)

**Interfaces:**

- Consumes: the behaviour of Tasks 1-4, through the running plugin.
- Produces: nothing other tasks use.

This is the case B72 says no test builds: one provider sitting out a window
while another returns an empty first page against a hinted work ID. The B50
case refuses _every_ provider, which is the case where nothing can be stored
anyway.

- [ ] **Step 1: Write the failing test**

In `test/zotero/graphCitationHops.test.ts`, add this block immediately after
the closing `});` of `describe("under provider refusals (B50)", ...)`. It
reuses the file's existing helpers (`openNewGraphTab`, `dismissGallery`,
`waitFor`, `delay`, `graphRoot`, `tabContent`, `progressText`, `hopRowText`,
`nodeMenuEntry`, `normalize`, `currentTabID`, `win`):

```ts
/**
 * B72: a fill must finish even while one provider refuses for good. Semantic
 * Scholar answers HTTP 429 throughout, so it sits out a window and every
 * landing counts as refused; OpenCitations answers, but returns an empty
 * citation list for every paper except the seed. Those hop-1 papers are
 * external, so the fill hints their work ID and the lookup that would back
 * their empty list is skipped. Before the fix each one was deferred for
 * ever and `n left` never fell; now each is stored as "no citers" and the
 * plan drains.
 */
describe("when one provider sits out and another has no citers (B72)", function () {
  let drainTabID: string | null = null;
  let drainItemID: number | null = null;
  let realRequest: any = null;

  const SEED_CITATIONS = new RegExp(
    `opencitations\\.net/index/v1/citations/(${REFUSAL_DOI.replace(
      /[.]/g,
      "\\.",
    )}|${encodeURIComponent(REFUSAL_DOI).replace(/[.]/g, "\\.")})`,
    "i",
  );

  /** Semantic Scholar refuses; OpenCitations answers, emptily, past the seed. */
  function refuseS2AndEmptyCiters(): void {
    if (realRequest) return;
    realRequest = Zotero.HTTP.request;
    (Zotero.HTTP as any).request = async (
      method: string,
      url: string,
      options?: unknown,
    ) => {
      if (/^https:\/\/api\.semanticscholar\.org\//.test(url)) {
        return { status: 429, responseText: "", getResponseHeader: () => null };
      }
      if (
        /opencitations\.net\/index\/v1\/citations\//.test(url) &&
        !SEED_CITATIONS.test(url)
      ) {
        return {
          status: 200,
          responseText: "[]",
          getResponseHeader: () => null,
        };
      }
      return realRequest.call(Zotero.HTTP, method, url, options);
    };
  }

  function answerAgain(): void {
    if (!realRequest) return;
    (Zotero.HTTP as any).request = realRequest;
    realRequest = null;
  }

  before(async function () {
    this.timeout(90_000);
    const item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField("title", `${REFUSAL_TITLE} (drain)`);
    item.setField("date", "2012");
    item.setField("DOI", REFUSAL_DOI);
    drainItemID = await item.saveTx();

    drainTabID = await openNewGraphTab();
    currentTabID = drainTabID;
    win.Zotero_Tabs.select(drainTabID);
    const rail = await waitFor(
      () =>
        tabContent(drainTabID)?.querySelector(
          ".cm-scope-section .cm-scope-count",
        ),
      30_000,
    );
    expect(rail, "the drain tab's Scope section").to.exist;
    await dismissGallery(drainTabID);
  });

  after(async function () {
    this.timeout(30_000);
    let failure: unknown = null;
    const record = (error: unknown): void => {
      if (failure === null) failure = error;
    };
    try {
      answerAgain();
    } catch (error) {
      record(error);
    }
    try {
      if (drainTabID) win.Zotero_Tabs.close(drainTabID);
      await delay(500);
    } catch (error) {
      record(error);
    }
    drainTabID = null;
    currentTabID = null;
    try {
      if (drainItemID !== null) await Zotero.Items.erase(drainItemID);
      drainItemID = null;
    } catch (error) {
      record(error);
    }
    if (failure !== null) throw failure;
  });

  it("drains the plan instead of re-asking papers with no citers", async function () {
    this.timeout(240_000);
    refuseS2AndEmptyCiters();
    try {
      (await nodeMenuEntry("Add as seed", `${REFUSAL_TITLE} (drain)`)).click();
      // Hop 1 arrives from the seed's own citers, which answer normally.
      const filled = await waitFor(
        () => (/\d+\s*\/\s*\d+/.test(hopRowText(1)) ? hopRowText(1) : null),
        120_000,
      );
      expect(filled, `hop 1 never filled; it read "${hopRowText(1)}"`).to.exist;
      // Every hop-1 paper answers empty against a hinted work ID while
      // Semantic Scholar sits out, so before the fix `n left` held for ever.
      const drained = await waitFor(
        () => (!/\d+ left/.test(progressText()) ? progressText() : null),
        180_000,
      );
      expect(
        drained,
        `the plan never drained; the line reads "${progressText()}", ` +
          `hop 1 "${hopRowText(1)}"`,
      ).to.exist;
    } finally {
      answerAgain();
    }
  });
});
```

- [ ] **Step 2: Run the Zotero suite to verify the new case fails on the old build**

First check out the pre-fix code into a scratch worktree so the case can be
seen red, or stash the four source changes:

```bash
git stash push src/services/relationshipRefreshPolicy.ts src/services/externalDiscoveryService.ts src/services/graphHopRunnerModel.ts src/services/graphHopFillRunner.ts
npm test
```

Expected: FAIL — "the plan never drained", with the line still reading
`N left`. Then restore:

```bash
git stash pop
```

Wait for the run to finish before starting another: a second run hits `EBUSY`
on `cert9.db`.

- [ ] **Step 3: Run the Zotero suite against the fix**

Run:

```bash
npm test
```

Expected: the new case passes and the suite is green (87 passed, 0 failed
before this plan's addition; 88 now).

- [ ] **Step 4: Run it a second time**

Run `npm test` again, after the first task has finished. Timing-shaped cases
are run twice in this repo before they are believed.

Expected: green both times.

- [ ] **Step 5: Commit**

```bash
git add test/zotero/graphCitationHops.test.ts
git commit -m "B72: the Zotero case for a sitting-out provider and an empty hinted list"
```

---

### Task 6: The records

**Files:**

- Create: `docs/adr/0014-an-empty-list-is-an-answer-when-something-backs-it.md`
- Modify: `CONTEXT.md:119-129`
- Modify: `docs/superpowers/handoffs/2026-09-08-roadmap.md` (B72's entry, and
  the "Manual verification" section at `:1279`)

**Interfaces:**

- Consumes: the behaviour built in Tasks 1-5.
- Produces: nothing code depends on.

- [ ] **Step 1: Write ADR 0014**

Create `docs/adr/0014-an-empty-list-is-an-answer-when-something-backs-it.md`,
in the voice of the existing ADRs (see `docs/adr/0013-a-refusal-is-not-a-failure.md`):

```markdown
# An empty list is an answer when something backs it

A fill trusts an empty first page when a lookup match, a reported count, or a
work-ID hint the asking provider itself supplied stands behind it. A hint is
backing because the provider emitted that identifier in one of its own citation
links, and the fill skips the lookup that would otherwise match it. Unbacked, an
empty page is still a failure and is still never stored.

An empty answer does not end an expansion while another candidate can be asked.
This refines ADR 0013's "one answering provider per expansion": the expansion
stops at works, at a failure, or at a refusal with a usable partial list, and
the last candidate's empty list stands as "no citers". The window cleared by a
landing belongs to the last usable snapshot that contributed works, or, when
every answer was empty, to the last provider that answered.

A paper deferred three times with nothing ever stored fails for the session, so
`markFailed` is reachable while a provider holds an open window. Resume undoes
those failures and only those: a paper a provider answered nothing usable for
stays out.

ADR 0013 otherwise stands, and `outcomeRefused` is unchanged: a provider
sitting out a window still makes a landing refused. Rejected: narrowing it, so
a never-asked provider fails the paper outright, which in a refusal storm
empties the plan — the failure mode 0013 exists to prevent.
```

- [ ] **Step 2: Widen the vocabulary in CONTEXT.md**

In `CONTEXT.md`, replace the **Failed** entry (`:119-123`) and add two entries
after **Refused** (`:125-129`):

```markdown
**Failed**:
A paper whose expansion in the current direction returned nothing usable this
session with no provider refusing or skipped, or which reached the deferral
limit. It leaves the fill until the graph is reopened; Resume brings back only
the papers the limit failed.
_Avoid_: broken, stale, missing
```

```markdown
**Backed**:
What lets a fill trust an empty list: a lookup match, a reported count, or a
work-ID hint the asking provider itself supplied. An unbacked empty list is a
failure and is never stored.
_Avoid_: verified, confirmed

**Empty answer**:
A snapshot that succeeded with no works. It ends an expansion only when no
candidate is left to ask; while one remains, the next is asked past it.
_Avoid_: no results, blank list, zero hits

**Deferral limit**:
How many times a paper may be deferred with nothing stored before it fails for
the session. Three. It is what lets a fill finish while a provider refuses for
good.
_Avoid_: retry count, max retries
```

- [ ] **Step 3: Tick B72 and add the manual check**

In `docs/superpowers/handoffs/2026-09-08-roadmap.md`, change B72's `- [ ]` to
`- [x]` and append to its entry, at the same 6-space indentation:

```
      Fixed 2026-09-16 from
      `docs/superpowers/specs/2026-09-16-fill-termination-design.md` and
      `docs/superpowers/plans/2026-09-16-fill-termination.md`: a work-ID hint
      from the asking provider backs an empty list, an empty answer does not
      end the expansion while a candidate remains, and a paper deferred three
      times fails for the session, with Resume undoing only those failures
      (ADR 0014). The Zotero case B72 says nobody built now exists.
```

Then add to the "Manual verification" section (`:1279`):

```
- [ ] B72: fill hop 3 on the user's own profile while Semantic Scholar is
      refusing, and confirm the progress line ends rather than alternating
      expanding and refusing — `n left` must reach zero. Spot-check a 2026
      frontier paper: it should read as expanded with no citers, not be
      re-asked. Compare against the 2026-09-16 probe, where the same ~20 DOIs
      were fetched 10 to 16 times.
```

- [ ] **Step 4: Format the docs and audit the indentation**

Run:

```bash
npx prettier --write docs/adr/0014-an-empty-list-is-an-answer-when-something-backs-it.md CONTEXT.md docs/superpowers/handoffs/2026-09-08-roadmap.md
```

Then check that no continuation line in the roadmap's B72 entry or the new
manual check lost its 6-space indent:

```bash
awk 'NR>=1195 && NR<=1290' docs/superpowers/handoffs/2026-09-08-roadmap.md | grep -n "^ \{1,5\}[^ ]\|^ \{7,\}[^ ]"
```

Expected: no output. If a line was rewrapped to 4 spaces, it is a long code
span breaking across lines — reword it so the span fits on one line.

- [ ] **Step 5: Run the full check**

Run:

```bash
npm run check
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add docs/adr/0014-an-empty-list-is-an-answer-when-something-backs-it.md CONTEXT.md docs/superpowers/handoffs/2026-09-08-roadmap.md
git commit -m "B72: ADR 0014, the vocabulary, and the roadmap"
```

---

### Task 7: The XPI, built last

**Files:**

- Build output only: `.scaffold/build/meristema.xpi`

**Interfaces:**

- Consumes: everything above.
- Produces: the XPI the user installs to walk the manual check.

`npm test` deletes the XPI, and so does the `zotero-plugin serve` watcher on
any source edit, so this is the last thing done.

- [ ] **Step 1: Confirm the Zotero suite has finished**

No `npm test` task may still be running, and no `zotero-plugin serve` watcher
may be active. Ask the user before stopping any Zotero process.

- [ ] **Step 2: Build**

Run:

```bash
npm run build
```

Expected: `npm run check` passes, then the XPI is written to
`.scaffold/build/meristema.xpi`.

- [ ] **Step 3: Report, and do not push**

Tell the user the XPI is built and the manual check is queued in the roadmap's
batch. Leave the commits local: this work is not pushed.
