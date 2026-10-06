# Checked Seed Links

Brainstormed 2026-10-06. Fixes B78, the undercount the shared-citers spec
(`2026-09-28-shared-citers-design.md`, "The cut undercounts") stated and left.

## Problem

A seed's hop-1 list is cut at 50 (ADR 0015). Under Citers, a paper citing
seeds A and B that made only A's cut has one seed parent, so it reads k = 1:
the Seeds linked colouring misgrades it and `Shared by ≥ 2` drops it. Under
References the same happens to a paper cited by A and B that missed B's cut.

## Decisions

| question     | decision                                                                                                                                                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What a link  | **A real parent.** A link the check finds makes the seed a parent of the hop-1 paper and draws its edge, so k, the colouring, the shared rule and the seed-coloured edges agree. The paper does not join the seed's stored list.  |
| Directions   | **Both.** Citers reads each hop-1 paper's reference list; References reads each seed's.                                                                                                                                           |
| The source   | **A separate check pass**, one OpenAlex batch over the seeds and hop-1 papers, not `referenced_works` added to the citer pages: it covers saved graphs and hop-1 lists other providers filled, and leaves the storage path alone. |
| The gate     | **An OpenAlex key**, and OpenAlex enabled: the condition under which OpenAlex pages (`pagingProviderTest`). Keyless graphs keep today's count.                                                                                    |
| The Key note | **Unchanged**: `Only hop 1 is graded, by the links fetched.` is still true.                                                                                                                                                       |
| Out of scope | Links among hop-1 papers or deeper; adding the paper to the seed's list or its hop count; keyless providers.                                                                                                                      |

## Design

### The check

`openAlexSeedLinkService.ts` (new) takes papers as
`{key, doi?, openAlexID?}` and returns, per key,
`{openAlexID: string, references: string[]}` (short `W…` IDs).

- Papers are grouped by identifier, OpenAlex ID first, then DOI, and sent
  100 per request: `filter=ids.openalex:…` or `doi:…`,
  `select=id,doi,referenced_works`, `per_page` the batch size, through
  `requestJSON("openalex", …)` so the rate policy and refusal handling apply.
- A paper with neither identifier is skipped. One OpenAlex does not return is
  recorded as checked with no OpenAlex ID and no references, and not asked
  again.
- A refusal or failed request records nothing for its batch; the next trigger
  asks again. Other batches keep their answers.

### The cache

A table in the plugin database, created in `externalWorkCacheService.ts`'s
`SCHEMA` init:

```sql
CREATE TABLE IF NOT EXISTS openalex_reference_lists (
  identity_key       TEXT PRIMARY KEY,
  openalex_id        TEXT,
  reference_ids_json TEXT NOT NULL,
  fetched_at         TEXT NOT NULL
);
```

Mirrored in memory on init. Keyed by every stable alias the answer has
(`openalex:W…`, `doi:…`), so a paper found by DOI is a hit under either. An
entry older than 180 days (as `external_works_v2`) is stale and asked again.
Its own table, so a partial record never overwrites a work's full metadata.

### When it runs

In `graphViewService.ts`, under the gate:

- Each time the hop model is rebuilt, collect the seeds and the hop-1 papers
  that have an identifier and no fresh cache entry (a paper with neither is
  never collected, so it cannot re-trigger the check). If any, queue one check: coalesced (at most one
  in flight, one queued), aborted when the graph closes.
- When it lands with any new entry, rebuild the model, the path a fill
  landing takes. The fragments hold the stored lists, not the check, so they
  stay.
- A saved graph reopens, checks once, and reads the cache after.

A seed's identifiers are its DOI and, where known, its OpenAlex ID
(`node.providerWorkID` when `node.provider === "openalex"`, else
`sourceMetrics.libraryUpdateState.providerWorkIDs.openalex`). A seed known by
DOI alone gets its OpenAlex ID from the answer.

### Deriving the links

`graphSeedLinks.ts` gains a pure
`checkedSeedLinks(direction, seeds, hop1)`, both lists of
`{key, check?: {openAlexID, references}}`, returning
`Map<hop1Key, seedKey[]>`:

- Citers: seed s for paper P when s's OpenAlex ID is in P's references.
- References: seed s for P when P's OpenAlex ID is in s's references.
- No check or no OpenAlex ID on either side contributes nothing.

### The hop model

`GraphHopInput` gains `checkedSeedLinks?: (key: string) => readonly string[]`.
After hop 1 is built, each hop-1 entry gains the listed seeds that are not
already its parents, and one edge per added seed, citer → cited (P → B under
Citers, B → P under References), provenance `openalex`. A key that is not a
seed is ignored. Hop membership, `availableByHop`, the cut line and the walk
past hop 1 are unchanged.

`seedLinkCount`, the colouring, the shared rule, the seed-coloured edges and
the label order read the parents, so they need no change.

### Docs

- `CONTEXT.md`, Seed links: "Counts the links the graph knows: the stored
  lists and, with an OpenAlex key, the reference lists OpenAlex holds for the
  seeds and hop-1 papers."
- `graphSeedLinks.ts`'s header comment says the same.
- ADR 0018 records the separate pass, the gate and the table.
- The roadmap ticks B78.

## Files

- `src/services/openAlexSeedLinkService.ts` (new): the batch and the cache
  reads and writes.
- `src/services/externalWorkCacheService.ts`: the table, its mirror and init.
- `src/services/graphSeedLinks.ts`: `checkedSeedLinks`.
- `src/services/graphHopModel.ts`: the input and the parent and edge pass.
- `src/services/graphViewService.ts`: the trigger and the lookup.

## Testing

- Unit, `checkedSeedLinks`: both directions; a seed with no OpenAlex ID; a
  paper with no check.
- Unit, the hop model: a checked seed added as a parent with its edge; a seed
  already a parent not duplicated; a non-seed key ignored; `availableByHop`
  unchanged.
- Unit, the service with `requestJSON` stubbed: batches of 100 by identifier
  kind; a paper with no identifier never sent; a not-found recorded; a cache
  hit sends no request; a refused batch records nothing.
- Zotero, the shared-citers case in `graphCitationHops.test.ts`: the fake
  OpenAlex answers the check batch. P is only in A's list, its
  `referenced_works` holds B, so the Key reads `Cite all 2 seeds` and
  `Shared by ≥ 2` keeps it.

## Manual verification

- With an OpenAlex key, seed two papers that share a citer which made only one
  seed's cut of 50 (two seeds in one field with many citers). Under Seeds
  linked the citer reads `Cite all 2 seeds` and draws an edge to each seed in
  its colour; `Shared by ≥ 2` keeps it. Repeat under References.
- Reopen that graph: the grading is back without a check request (Network
  tab or debug output).
- Without a key, the same graph grades as before.
