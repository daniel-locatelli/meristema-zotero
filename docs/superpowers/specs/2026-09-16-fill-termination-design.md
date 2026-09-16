# A Fill That Can Finish

**Date:** 2026-09-16
**Status:** Design approved 2026-09-16

B72 of `docs/superpowers/handoffs/2026-09-08-roadmap.md`, brainstormed as the
first half of D8 on the hop-3 fill measured the same day
(`docs/superpowers/handoffs/2026-09-16-d8-evidence.md`, probe JSON
`meristema-fill-probe-2026-09-16T12-23-24-909Z.json`). Refines ADR 0013, which
stands: a refusal is still not a failure, and a skipped provider still makes a
landing refused.

D8's other half — whether a breadth-first walk of every parent is the right
shape at all, budgets, and a depth derived from the data — is deliberately not
here. Stage 4 is built on the fill, and a fill that cannot finish cannot be
specified against; termination comes first.

## Problem

A hop-3 fill on the user's own profile ran 29.6 minutes and never finished.
`n left` fell 168 → 31 over the first ten minutes, then held at 31 for the last
eighteen across four separate `expanding` phases. The bursts at minutes 17-18,
22-23 and 27-28 hit 21, 20 and 18 distinct OpenCitations DOIs, 20 of 21 the
same between the first two, with individual DOIs fetched 10 and 16 times.
Every one answered HTTP 200. The fill re-fetched the same ~20 papers every
cycle, stored none of them, and burned about 40 requests a cycle indefinitely.

The chain, verified against the probe's request log:

- The fill passes a provider work-ID hint for every external paper
  (`src/services/graphViewService.ts:3898-3904`), so
  `fetchProviderRelationshipSnapshot` skips the provider lookup
  (`src/services/externalDiscoveryService.ts:1288-1293`) and `match` is null.
  In the probe, all 157 DOIs that got an OpenCitations citations page got **no**
  Meta lookup; the 84 lookups it did make are all other DOIs.
- With `match` null, `matched` is false, so a genuinely empty first page trips
  `unbackedEmptyList` (`src/services/relationshipRefreshPolicy.ts:300-311`) and
  the snapshot returns `failed()` (`externalDiscoveryService.ts:1387-1397`):
  `succeeded: false`, so the `usable` filter (`:1977-1983`) is empty, nothing is
  stored and `answeredBy` is null.
- Meanwhile `fillRelationshipCandidates`
  (`relationshipRefreshPolicy.ts:246-257`) put Semantic Scholar, sitting out a
  window, into `skipped`, and `outcomeRefused`
  (`src/services/graphHopRunnerModel.ts:123-125`) is
  `refusedBy.length > 0 || skipped.length > 0`. So a merely _skipped_ provider
  makes the landing count as refused, and `hopLandingEffects` (`:64-93`) takes
  the **defer** branch.
- `markFailed` — the branch that exists precisely so "a paper the provider
  cannot answer for would otherwise be asked again on every landing"
  (`graphHopRunnerModel.ts:84-86`) — is only reached when `refused` is false.
  A provider whose ladder tops out at "every 5 min, never giving up"
  (`COOL_DOWN_MS:127-130`) therefore pins every paper it was eligible for,
  forever.
- `fillStopsAt` (`relationshipRefreshPolicy.ts:285-289`) ends the expansion at
  that unusable snapshot, so OpenAlex — which answered 20 of 20 in this run,
  the user's key being live — was never asked for any of these papers.

The papers that loop are the frontier: the 30 DOIs re-fetched five or more
times are `arxiv.2602.*`, `engstruct.2026.*`, `buildings16010047` and their
like, 2025 and 2026 papers with genuinely zero citers. The fill cannot
terminate exactly where D8 observed the chain running out against the present,
and the papers it re-asks forever are the ones whose true answer is "none".

B63 is implicated, though not as a regression: its guard is right to distrust
an unbacked empty list, but on the fill's hinted path the backing it wants can
never appear, because the lookup that would supply it is skipped on purpose.
Nor is this the keyless pool: Semantic Scholar was asked only 15 times in
29.6 minutes (11 × 429), because B50's sit-out works. It is the _consequence_
of the sit-out that pins the fill.

## Decisions taken in the brainstorm (2026-09-16)

| question                                                  | decision                                                                                                                                                                                                       |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What D8's first spec covers                               | **Termination.** The breadth-first shape is kept; the fill is made able to finish. Shape, budgets and derived depth stay filed for D8's second session.                                                        |
| Whether a work-ID hint backs an empty list                | **Yes.** A hint the asking provider itself supplied is evidence that it indexes the DOI: it emitted it in one of its own citation links.                                                                       |
| Whether an empty answer ends the expansion                | **No, while a candidate remains.** An empty list is asked past; the last candidate's empty list stands and is stored as "no citers".                                                                           |
| Whether a paper can be deferred without end               | **No.** A paper deferred N times in a direction with nothing ever stored is failed for the session, so `markFailed` is reachable again. **N = 3.**                                                             |
| Whether a skipped provider is still a refusal             | **Yes, unchanged.** Narrowing `outcomeRefused` would reverse ADR 0013 deliberately and, in a refusal storm, empty the plan — the failure mode 0013 rejected.                                                   |
| What a stored empty list costs                            | **A paper may read "no citers" on a provider's word while another sat out.** Accepted: it is what "one answering provider per expansion" already means, and a manual Refresh replaces it.                      |
| Whether Resume recovers a paper the limit failed (review) | **Yes.** A paper failed for running out of patience is not a paper a provider answered nothing for; `retryNow` clears the limit's failures along with the deferrals, while genuine failures stay out as today. |

## Vocabulary

**Backed**: an empty first page counts as an answer when something stands
behind it — a lookup match, a reported count, or a work-ID hint the asking
provider itself supplied. Unbacked, it is a failure and is never stored.

**Empty answer**: a snapshot that succeeded with no works. It ends the
expansion only when no candidate is left to ask.

**Deferral limit**: the number of times a paper may be deferred in one
direction with nothing ever stored before it is failed for the session. Three.
Cleared by Resume (`retryNow`), by `reset`, and by any landing that applies to
the model. Resume also undoes the failure the limit caused: the reader asking
to try again now is exactly the case the limit should yield to, and nothing the
reader can fix — a key, a network, a provider that came back — should leave a
paper permanently out of the plan. A paper failed because a provider answered
nothing usable stays out, as today.

CONTEXT.md's **Failed** widens accordingly: "returned nothing usable this
session, and no provider refused or was skipped" gains "or reached the deferral
limit".

## Design

### 1. A hint is backing

`unbackedEmptyList` gains a `hinted` input and returns false when it is set:

```ts
unbackedEmptyList({ fill, firstPageEmpty, matched, reportedCount, hinted });
```

`externalDiscoveryService.ts:1389` passes `hinted: Boolean(hintedProviderWorkID)`.
The guard keeps its teeth for the case B63 built it for — the
`normalizeDOI(node.doi)` fallback (`:1345`) for a DOI OpenCitations has never
seen, which carries no hint and no match.

### 2. An empty answer does not end the expansion

`fillStopsAt` takes whether the snapshot is empty and whether another candidate
remains:

| snapshot                     | stops                         |
| ---------------------------- | ----------------------------- |
| refused, usable partial list | yes (today)                   |
| refused, nothing collected   | no (today)                    |
| failed, no refusal           | yes (today)                   |
| answered with works          | yes (today)                   |
| answered with no works       | **only if no candidate left** |

`askUntilNotRefused` (`externalDiscoveryService.ts:1684-1703`) tracks providers
already asked, not only those that refused, so an empty answer moves to the
next candidate and each provider is asked at most once. Snapshots accumulate as
they do today, so `prepareRelationshipSnapshots` and
`selectRelationshipMembership` merge an empty first answer with a later
non-empty one without further change.

`answeredBy` (`:2046`) can no longer mean "exactly one usable snapshot". It
becomes the provider of the last usable snapshot that contributed works, or,
when every usable snapshot was empty, the last usable snapshot's provider — it
did answer, so its window should clear. Null only when nothing was usable.

Its documented contract moves with it: the field's comment
(`externalDiscoveryService.ts:1523`), "the one provider whose snapshot was
stored; null when none was, or several were merged", becomes "the provider
whose window this landing clears". The field's only production consumer is the
runner's window clearing (`graphHopFillRunner.ts:276-281`), and `identifiedCount`
on the same resolution stays the record of how many works were stored — so an
empty answer and a list of works remain distinguishable without a new field.

### 3. No paper is deferred without end

`HopLandingInput` gains `deferrals: number`, the count for this paper in this
direction so far. `hopLandingEffects` returns `markFailed` instead of `defer`
when `refused` is true, nothing was stored, and `deferrals >= 3`. Everything
else is unchanged, and the decision stays pure.

`graphHopFillRunner.ts` carries the count beside the deadline: `deferrals`
becomes `Map<string, { until: number; count: number }>`, incremented where the
deferral is recorded (`:294-303`), cleared where deferrals are cleared today
(`retryNow` `:381-386`, `reset` `:401-413`) and on any landing that applies to
the model (`:305`). The plan reads `until` exactly as now.

The count needs no direction in its key. `deferrals` is already
`perDirection(() => new Map())` (`:190`), as `failed` is (`:177`), so a paper's
budget under Citers is structurally separate from its budget under References.
A composite `key:direction` would duplicate that split and let the two
disagree.

Resume must be able to undo a failure the limit caused, which `retryNow` cannot
do today: it ends every window and clears both directions' deferrals, but never
touches `failed`. So the runner keeps `limitFailed`, a per-direction set of the
papers the limit failed, added to beside `failed[direction]` when
`hopLandingEffects` fails a paper for the count. `retryNow` removes those keys
from `failed[direction]` and empties the set, alongside the deferrals it
already clears; `reset` clears it with everything else. Papers failed the
ordinary way — a provider answered nothing usable, nobody refused — are not in
the set and stay out, which is what `markFailed` is for.

### What does not change

`outcomeRefused`, the cool-down ladder, the rail's refusal line and countdown,
the seed Refresh path, and the manual per-paper refresh. No provider is dropped
from the reader's configured set.

## Testing

Red first, in this order.

- `test/unit/relationshipRefreshPolicy.test.ts`: a hinted empty first page is
  not unbacked; an unhinted, unmatched one still is (B63's guard intact);
  `fillStopsAt` passes an empty answer on while a candidate remains and stops at
  the last one; a refusal with a usable partial still stops.
- `test/unit/graphHopRunnerModel.test.ts`: the third deferral marks the paper
  failed; the second still defers; a stored landing takes the expanded branch
  whatever the count.
- `test/unit/graphHopFillRunner.test.ts`: a paper refused on every landing
  leaves the plan after three deferrals and the plan drains; the count survives
  a re-plan; `retryNow` clears the count _and_ the failure the limit caused, so
  the paper is planned again; a paper failed the ordinary way stays out across
  `retryNow`.
- `test/zotero/graphCitationHops.test.ts`: the case B72 says nobody built — one
  provider sitting out a window while another returns an empty first page
  against a hinted work ID. The fill drains to `0 left` instead of cycling.
  Run twice, as the suite's timing-shaped cases are.

## Records

ADR 0014, "an empty list is an answer when something backs it", refining
ADR 0013's "one answering provider per expansion" with the empty-answer case
and recording the deferral limit as the guarantee that a fill terminates.
CONTEXT.md gains **Backed** and **Empty answer** under Citation hops and widens
**Failed**.

Manual verification, appended to the roadmap's batch: fill hop 3 on the user's
own profile with Semantic Scholar refusing, and confirm `n left` reaches zero
and the progress line ends, rather than alternating expanding and refusing;
spot-check that a 2026 frontier paper reads as expanded with no citers rather
than being re-asked.
