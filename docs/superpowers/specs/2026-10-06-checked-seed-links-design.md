# Checked Seed Links

Brainstormed 2026-10-06; revised the same day after an adversarial review.
Fixes B78, the undercount the shared-citers spec
(`2026-09-28-shared-citers-design.md`, "The cut undercounts") stated and left.

## Problem

A seed's hop-1 list is cut at 50 (ADR 0015). Under Citers, a paper citing
seeds A and B that made only A's cut has one seed parent, so it reads k = 1:
the Seeds linked colouring misgrades it and `Shared by ≥ 2` drops it. Under
References the same happens to a paper cited by A and B that missed B's cut.

## Decisions

| question     | decision                                                                                                                                                                                                                                |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What a link  | **A real parent.** A link the check finds makes the seed a parent of the hop-1 paper and draws its edge, so k, the colouring, the shared rule and the seed-coloured edges agree. The paper does not join the seed's stored list.        |
| Directions   | **Both.** Citers reads each hop-1 paper's reference list; References reads each seed's.                                                                                                                                                 |
| The source   | **A separate check pass**: OpenAlex batches over the seeds and hop-1 papers, not `referenced_works` added to the citer pages. It covers saved graphs and hop-1 lists other providers filled, and leaves the relationship storage alone. |
| The gate     | **An OpenAlex key, OpenAlex enabled, and two or more seeds**, on both the fetch and the read. Keyless or one-seed graphs keep today's count, even with a cache from an earlier keyed session.                                           |
| The Key note | **Unchanged**: `Only hop 1 is graded, by the links fetched.` is still true.                                                                                                                                                             |
| Out of scope | Links among hop-1 papers or deeper; adding the paper to the seed's list or its hop count; keyless providers; one work reaching hop 1 under two keys (an existing identity issue the check can make visible as two k = 2 papers).        |

## Design

### Identifiers

One pure rule, `openAlexIdentifiersOf(node)` in `graphSeedLinks.ts`, for
seeds and hop-1 papers alike:

- OpenAlex ID: `node.providerWorkID` when `node.provider === "openalex"`;
  else `sourceMetrics.libraryUpdateState.providerWorkIDs.openalex`; else the
  external work's `providerWorkID` when its provider is OpenAlex. Passed
  through `shortOpenAlexID`, accepted only if it matches `/^W\d+$/i`, and
  upper-cased. Anything else is no ID.
- DOI: `normalizeDOI(node.doi)`.

Cache aliases are `openalex:W…` (upper case W, as the batch code sends) and
`doi:…` (normalised).

### The check

`openAlexSeedLinkService.ts` (new) takes papers as
`{key, openAlexID?, doi?}` and returns, per key, a check:
`{openAlexID: string, references: string[]}` (upper-case `W…` IDs via
`shortOpenAlexID`), or not-found.

- Batches of `Math.min(100, providerExecutionPolicy("openalex").batchSize)`,
  as `librarySourceMetricsService.ts` does: papers with an OpenAlex ID go by
  `filter=ids.openalex:…`, the rest by `filter=doi:…`. `per_page=200`, and
  results are matched back to the asked papers by normalised ID or DOI, never
  by position.
- `select=id,doi,referenced_works`, and nothing else: no title field. The
  response observer (`providerResponseCacheService.ts`) drops OpenAlex records
  without a title (`openAlexMapper.ts`, `openAlexWorkMetadata`), and that is
  what keeps these partial answers out of `external_works_v2`.
- A paper asked by ID that the answer misses is asked again by DOI in the same
  pass, if it has one. Only a paper missed both ways is not-found.
- Requests go through `requestJSON("openalex", …)` with `retryRefusals: false`
  and the caller's signal, so a refusal fails fast instead of postponing the
  queue the fill uses.
- A refused (429) or failed batch returns no checks for its papers. A batch
  OpenAlex rejects outright (other 4xx) is split in half and each half asked
  again, down to single papers; a single paper rejected is recorded
  not-found.

### The store

`externalWorkCacheService.ts` owns the table, its mirror, its writes and
their write queue, as it does for the other two tables:

```sql
CREATE TABLE IF NOT EXISTS openalex_reference_lists (
  identity_key       TEXT PRIMARY KEY,
  status             TEXT NOT NULL,
  openalex_id        TEXT,
  reference_ids_json TEXT,
  fetched_at         TEXT NOT NULL
);
```

- A found work is one row under `openalex:W…` with `status = 'success'`,
  `openalex_id` and `reference_ids_json`. Every other alias (its `doi:…`, and
  the identifier it was asked by, when OpenAlex answered with a different
  canonical ID) is a row with `status = 'alias'` and `openalex_id` only.
  Reference lists are stored once.
- A not-found is one row per asked alias, `status = 'not-found'`, no ID.
- A success is fresh for 180 days, a not-found for 30, matching
  `external_works_v2` (`SUCCESS_MAX_AGE_MS`, `failureRetryAt`). Stale rows are
  pruned at init; the rest load into the mirror.
- `clearExternalWorkCache` deletes this table too, and
  `closeExternalWorkCache` clears its mirror.
- Exports: `getOpenAlexReferenceCheck(alias)` (follows an alias row to its
  success row; `undefined` when absent or stale) and
  `saveOpenAlexReferenceChecks(...)`. The service takes them as an injected
  store, so its unit tests need no database.

### When it runs

A scheduler, `seedLinkCheckScheduler.ts` (new), decides what to ask and
when; `graphViewService.ts` only calls it.

- On each hop model rebuild, under the gate, the view hands it the seeds and
  hop-1 papers. It marks the scheduler dirty; it does not collect yet.
- At dispatch (one request in flight at a time across all graph tabs, so the
  scheduler is module-level), it collects the papers that have an identifier,
  no fresh store entry, are not in flight, and are not backing off. Nothing
  collected, nothing sent.
- A paper whose batch was refused or failed backs off for this session on
  `failureRetryAt`'s schedule (5 min, 30 min, 6 h, 1 day). Landings during a
  refusing OpenAlex therefore send nothing until the backoff passes.
- When a check lands with any new entry, every open graph whose seeds or
  hop-1 papers it covers rebuilds its model, the path a fill landing takes.
  The hop fragments hold the stored lists, not the check, so they stay.
- A graph's close aborts its share: the signal is per dispatch, aborted once
  no open graph still wants any of its papers.
- The first open of a graph checks; a reopen reads the store.

### Deriving the links

`graphSeedLinks.ts` gains a pure
`checkedSeedLinks(direction, seeds, hop1)`, both lists of
`{key, check?: {openAlexID, references}}`, returning
`Map<hop1Key, seedKey[]>`:

- Citers: seed s for paper P when s's OpenAlex ID is in P's references.
- References: seed s for P when P's OpenAlex ID is in s's references.
- No check or no OpenAlex ID on either side contributes nothing.

### The hop model

`GraphHopInput` gains
`checkOf?: (node: CitationGraphNode) => SeedLinkCheck | undefined`, where
`SeedLinkCheck` is `{openAlexID: string, references: readonly string[]}`. The
view's `checkOf` applies `openAlexIdentifiersOf` and reads the store; it
returns `undefined` outside the gate. Once hop 1 is built,
`buildGraphHopModel` calls `checkedSeedLinks` with the seed and hop-1 nodes it
already holds, and each hop-1 entry gains the listed seeds that are not
already its parents, plus one edge per added seed, citer → cited (P → B under
Citers, B → P under References), provenance `openalex`. An edge the library
already holds is not doubled (edges dedupe by key). Hop membership,
`availableByHop` and the cut line are unchanged.

`seedLinkCount`, the colouring, the shared rule, the seed-coloured edges,
`seedMarksWithin` and the label order read the parents, so they need no
change. Three readers of parents change behaviour, as intended:

- The fill planner's tiebreak (`graphHopFillModel.ts`, `parentCount`) can
  reorder hop-1 papers at depth 2 or more.
- `reachedFromSeed`, behind the rail's seed emphasis, now counts P and its
  subtree under seed B.
- Under `Shared by ≥ 2`, papers the check reveals become fill candidates.

### Docs

- `CONTEXT.md`, Seed links: "Counts the links the graph knows: the stored
  lists and, with an OpenAlex key, the reference lists OpenAlex holds for the
  seeds and hop-1 papers."
- `graphSeedLinks.ts`'s header comment says the same.
- ADR 0018 records the separate pass, the gate and the table.
- The roadmap ticks B78.

## Files

- `src/services/graphSeedLinks.ts`: `openAlexIdentifiersOf`,
  `checkedSeedLinks`, `SeedLinkCheck`.
- `src/services/openAlexSeedLinkService.ts` (new): the batches, the ID-then-DOI
  retry, the 4xx split.
- `src/services/seedLinkCheckScheduler.ts` (new): dirty, collect, in flight,
  backoff, abort, notify.
- `src/services/externalWorkCacheService.ts`: the table, its mirror, prune,
  clear, close.
- `src/services/graphHopModel.ts`: `checkOf` and the parent and edge pass.
- `src/services/graphViewService.ts`: the gate, `checkOf`, the scheduler
  calls and the rebuild.

## Testing

- Unit, `openAlexIdentifiersOf`: each ID source in order; a non-W ID
  rejected; a URL-form ID and a `https://doi.org/` DOI normalised.
- Unit, `checkedSeedLinks`: both directions; a seed with no OpenAlex ID; a
  paper with no check.
- Unit, the hop model: a checked seed added as a parent with its edge; a seed
  already a parent not duplicated; a non-seed ignored; `availableByHop`
  unchanged.
- Unit, the service, with `requestJSON` stubbed and an in-memory store:
  batches by kind at the policy size; a paper with no identifier never sent;
  an ID miss retried by DOI; a not-found recorded under its asked alias; a
  merged ID stored as an alias; a 429 records nothing; a 400 split down to
  the offending paper.
- Unit, the scheduler: a paper in flight not collected again by a landing;
  collection at dispatch, not at the trigger; a refused paper backs off; a
  fresh store entry never collected; nothing sent outside the gate; abort
  when the last graph wanting a paper closes.
- Zotero, the shared-citers case in `graphCitationHops.test.ts`. Its fake
  OpenAlex today answers any filter but `cites:` with no results; it gains an
  answer for `select=id,doi,referenced_works`, splitting the OR filter on
  `|` and answering both `ids.openalex:` and `doi:`. A new fourth citer sits
  only in seed A's list, and its `referenced_works` holds B. The case's tier
  counts and `n below` are recomputed for four citers, and it asserts the new
  citer reads `Cite all 2 seeds` and survives `Shared by ≥ 2`. Its OpenAlex
  IDs and DOIs are unique per run: the table persists in the test profile,
  and the test bundle is a second copy of the plugin that cannot clear the
  plugin's own mirror.
- Zotero, the D8 and floor cases seed one paper each, so the gate stays
  closed and their URL assertions are untouched; the full run confirms it.

## Manual verification

- With an OpenAlex key, seed two papers that share a citer which made only one
  seed's cut of 50 (two seeds in one field with many citers). Under Seeds
  linked the citer reads `Cite all 2 seeds` and draws an edge to each seed in
  its colour; `Shared by ≥ 2` keeps it. Repeat under References.
- Close and reopen that graph: the grading is back with no check request
  (debug output).
- Remove the key and reopen: the citer reads `Cite 1 seed` again.
