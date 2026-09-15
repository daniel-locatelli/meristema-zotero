# The Hop Fill Under Provider Refusals

**Date:** 2026-09-15
**Status:** Design approved 2026-09-15; not built

B50 of `docs/superpowers/handoffs/2026-09-08-roadmap.md`. Amends one sentence
of `2026-09-12-citation-hops-design.md` ("The fill", runner: a thrown provider
error marks the paper failed). D8, whether a breadth-first fill of every
parent is the right shape at all, is a separate brainstorm taken after this is
built and measured, on timings no longer inflated by refusals.

## Problem

A hop fill on a real library slowed to one expansion every 15 seconds (B50,
2026-09-13). Measured 2026-09-14 in the test Zotero: Semantic Scholar's keyless
pool answered HTTP 429, and the plugin turned each refusal into a failure that
cost 15 seconds and more requests.

- `requestJSON` (`src/providers/http.ts:334`) retries a 429 four times in all,
  delaying the provider by about 1, 2 and 4 s with jitter, so a request is
  known refused only about 8 s after it starts.
- A 429 maps to `rate-limited` (`failureStatusFromHTTP`,
  `src/providers/types.ts:67`), but `lookupProviderRecord`
  (`src/services/externalDiscoveryService.ts:1174`) ignores the status and
  falls through to `searchExactTitle`, a second request to a provider that
  just refused.
- `withProviderTimeout` (`externalDiscoveryService.ts:1198`) resolves `null`
  after `RELATIONSHIP_PROVIDER_TIMEOUT_MS` (15 s) and cancels nothing; the
  retries carry on behind it.
- `hopLandingEffects` (`src/services/graphHopRunnerModel.ts:52`) marks any
  expansion that stored nothing as failed for the session, so in a refusal
  storm every paper the fill reaches leaves the plan until the graph is
  reopened.
- Worse, found by reading and not measured: every page fetcher returns `[]` on
  any non-OK response (`fetchRelatedWorkSummaryPage`,
  `src/services/relatedWorkSummaryService.ts:518` for Semantic Scholar and
  `:546` for OpenAlex; Semantic Scholar's `fetchRelations`,
  `semanticScholarProvider.ts:116`; OpenCitations' `fetchLinks`,
  `openCitationsProvider.ts:66`). In `fetchProviderRelationshipSnapshot`
  (`externalDiscoveryService.ts:1221`) an empty first page sets
  `endpointExhausted`; with no reported count, as when the lookup was refused
  too, the snapshot is `complete` and `succeeded`, passes the `usable` filter
  (`:1757`), and an empty list is stored as the paper's answer. Expanded is
  "stored, even if empty" and the walk checks existence, not age
  (`graphHopModel.ts:46`), so the fill never returns to that paper; only a
  manual per-paper refresh replaces it.

## Decisions taken in the brainstorm (2026-09-15)

| question                                        | decision                                                                                                                                                                                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One spec with D8, or apart                      | **Apart.** B50 is specified, built and measured first; D8 is brainstormed afterwards on real timings.                                                                                                                                                         |
| Is a refused expansion a failure                | **No.** A paper whose expansion is refused (HTTP 429) stays in the plan and is never added to the failed set.                                                                                                                                                 |
| What the fill does on a refusal                 | **Switch provider, then wait.** A refused expansion retries at once on the next provider that can page the direction, still one answering provider per expansion (ADR 0006, refined by ADR 0013). The fill waits only when every paging provider is refusing. |
| How long it waits                               | **30 s, 1 min, 2 min, then every 5 min, never giving up.** The progress line shows the refusal and a countdown; Stop still works; nothing is in flight while waiting.                                                                                         |
| How the refusal reaches the fill                | **A typed outcome carried end to end**, from the provider to the runner. Not a provider-health register inferred from timing, and not both.                                                                                                                   |
| When one provider refuses and another answers   | **The refusing provider sits out its window.** Its refusal starts its own cool-down for this fill; later papers go straight to the next paging provider; when the window ends it is tried first again, so the native-first order comes back.                  |
| What Resume does during a wait                  | **Retries at once.** Every window ends; each provider keeps its step, so a fresh refusal waits the next, longer delay.                                                                                                                                        |
| How several refusing providers read on the rail | **`2 providers refusing`**, with their names in the line's tooltip; one provider is named on the line.                                                                                                                                                        |
| How often the countdown updates                 | **Every second, only while waiting.** One rail refresh a second, at a time when nothing else is in flight.                                                                                                                                                    |
| Seed Refresh and the other automatic callers    | **Only "a refused snapshot is never stored".** No windows, no provider switching.                                                                                                                                                                             |

## Vocabulary

**Refused**: an expansion where every provider that could page the paper's
list in the direction either answered HTTP 429 after its retries or was sitting
out a window. Nothing is stored; the paper stays in the plan and is retried.
Distinct from **Failed**, which narrows to "nothing usable, and no refusal".

**Window**: one provider's cool-down in one fill. It starts at a refusal, lasts
the delay for the provider's step, and ends early on Resume. A provider in a
window is not asked.

**Deferred**: a refused paper, left out of the plan's order until the earliest
window among the providers that refused or skipped it ends. It still counts as
left.

A paging provider is one `providerPagesRelationships`
(`src/providers/registry.ts:152`) says pages the direction: Semantic Scholar,
OpenCitations, and OpenAlex only when a key is set, since without one its
summary page returns `[]` before any request
(`relatedWorkSummaryService.ts:530`).

## Design

### 1. Seeing a refusal: providers and discovery service

**A typed error.** `ProviderRefusedError` (in `src/providers/types.ts`, beside
`failureStatusFromHTTP`) carries the provider's id. A provider throws it when
the response `requestJSON` finally returns is a 429, whether after the retries
or at once for a Retry-After beyond `MAX_RETRY_AFTER_MS`. The four page
fetchers above throw instead of returning `[]`; a 200 with an empty page still
returns `[]`, and every other non-OK status keeps today's behaviour.
Signatures do not change. The one other caller, `citingWorksForReference`
(`src/services/missingPaperRecommendationService.ts:64`), already catches a
throw and moves to the next provider, which is now the right thing for a
refusal too.

**A refused lookup skips the title search.** In `lookupProviderRecord`, a
lookup whose status is `rate-limited` throws `ProviderRefusedError`;
`not-found` and every other status fall through to `searchExactTitle` as
today. A `searchExactTitle` that is itself refused throws the same way.

**The timeout cancels what it abandoned.** `withProviderTimeout` creates a
cancellation scope (`createCancellationScope`,
`src/services/cancellationScope.ts`, which has no linking of its own),
subscribes it to the caller's `requestOptions.signal` so a caller's cancel
cancels the scope, passes the scope's signal to the operation in place of the
caller's, cancels the scope when the timer wins, and unsubscribes in its
`finally`. To pass the signal, it takes the operation as a function of the
request options rather than as a started promise. `requestJSON` already honours the
signal, so the retries stop. A timeout stays a failure, not a refusal.

**A refused snapshot says so.** `RelationshipProviderSnapshot` gains
`refused: boolean`. `fetchProviderRelationshipSnapshot` catches
`ProviderRefusedError` from the lookup or any page and returns
`refused: true, succeeded: false, complete: false, works: []`. A refused
snapshot is never `usable`, so it is never stored, on every path.

**The fill switches provider.** `ExternalRelationshipRefreshOptions` gains
`excludeProviders?: readonly CitationProviderID[]`, used only by the fill. For
an automatic refresh with `providerLimit: 1`, the provider is chosen from the
native-first order (`[node.provider, countProvider, ...enabled]`,
`relationshipRefreshPolicy.ts:176`) minus excluded providers, with
`limitRelationshipProviders`' existing promotion of a paging provider. When
that snapshot is refused, the refresh tries the next provider in the same
order that can page the direction and is not excluded, and so on. It stops at
the first snapshot that is not refused: a usable one is stored as today, a
failed one is a failure as today. Still one answering provider per
expansion. ADR 0006's traffic ceiling, the cap times one lookup and one page,
becomes the cap times one lookup and one page per paging provider in the worst
case; in practice a refusing provider sits out its window (section 2) and is
not asked again until it ends.

**The resolution carries the outcome.** `RelationshipRefreshResolution` gains:

- `refusedBy: CitationProviderID[]`, the providers asked in this refresh that
  refused, in the order asked;
- `skipped: CitationProviderID[]`, the paging providers for this direction that
  `excludeProviders` left out;
- `answeredBy: CitationProviderID | null`, the provider whose snapshot was
  stored.

Every existing `onMembershipResolved` call site fills them (empty lists and
`null` where nothing was asked). When every candidate refused or was skipped,
nothing is stored and the resolution reports `complete: false` with the lists.

**Seed Refresh and the other callers.** The manual aggregate path
(`refreshFocusSeedConnections`), the detail pane's per-paper refresh and the
focus refresh gain only what falls out of the snapshot: a refused provider's
snapshot is dropped from `usable`, so it is never stored and never replaces a
list. They pass no `excludeProviders` and keep their messages.

### 2. The fill

**The expansion reports an outcome.** `HopFillHost.expand` resolves a
`HopExpandOutcome`, `{ refusedBy, skipped, answeredBy }`, instead of `void`.
The host in `graphViewService.ts` (`:3861`) passes the runner's current
`excludeProviders` into `refreshExternalRelationships` and copies the lists
from `onMembershipResolved`. When the callback never fires (the paper left the
graph, the seed preparation threw) the outcome is empty, and `stored` decides
as today.

**A third landing.** `HopLandingInput` gains `refused: boolean`, true when
nothing was stored and `refusedBy` or `skipped` is non-empty.
`hopLandingEffects` then answers:

| landing                    | countExpanded | markFailed | defer | applyToModel |
| -------------------------- | ------------- | ---------- | ----- | ------------ |
| stale epoch or cleaned     | no            | no         | no    | no           |
| stored                     | yes           | no         | no    | yes          |
| refused (nothing stored)   | no            | no         | yes   | no           |
| nothing stored, no refusal | no            | yes        | no    | yes          |

`hopRejectionEffects` is unchanged: an escaped rejection is still a failure.

**Provider windows, pure.** `graphHopRunnerModel.ts` gains the window rules,
kept free of timers:

- `COOL_DOWN_MS = [30_000, 60_000, 120_000, 300_000]`; a provider at step `s`
  waits `COOL_DOWN_MS[min(s, 3)]`.
- `refuse(windows, provider, now)`: the provider's window ends at
  `now + delay(step)` and its step goes up by one.
- `answer(windows, provider)`: the provider's step returns to 0 and its window
  ends.
- `excluded(windows, now)`: the providers whose window ends after `now`.
- `endAll(windows, now)`: every window ends at `now`; steps are kept (Resume).
- `deferUntil(windows, providers)`: the earliest window end among `providers`.

The runner applies an outcome in order: `refuse` for each of `refusedBy`,
`answer` for `answeredBy`. Windows belong to the provider, not the direction or
the seeds, so they survive `invalidate()` and `reset()`; they go with the
runner on `dispose()`. They are per graph view, not shared across tabs.

**Deferred papers.** The runner keeps, per direction, a map from key to the
time its deferral ends, set on a refused landing to
`deferUntil(windows, refusedBy ∪ skipped)`. `planHopFill`
(`graphHopFillModel.ts`) gains `deferredKeys`: a deferred paper is left out of
`order` and still counted in `remainingByHop`. A deferral whose time has passed
is dropped before planning. `reset()` clears deferrals with the failed set;
`invalidate()` keeps them, as it keeps the failed set.

**Waiting.** When a plan's `order` is empty, nothing is in flight, and at least
one deferral remains, the fill is waiting. The host gains `now(): number`,
`after(ms, run): number` and `cancelAfter(handle)`, so a test drives a fake
clock. While waiting and `canExpand()` holds, the runner arms one tick a second;
each tick calls `host.planned()` so the rail's countdown moves, and the tick at
or past the earliest deferral calls `wake()`, which re-plans and expands. No
request is in flight while waiting. `planEmpty()` fires as today when `order`
is empty, which flushes the coalesced presentation refresh while the fill
idles.

**Stop and Resume.** `stop()` pauses and cancels the tick; windows and
deferrals stay, and the line reads today's paused line with Resume.
`resume()` clears the pause, calls `endAll`, clears every deferral, and wakes;
Fetch hop N calls `resume()` already and so also retries at once. `fetchMore()`
does not touch windows. `dispose()` cancels the tick.

**The state the rail reads.** `HopFillState` gains
`refusal: { providers: CitationProviderID[]; retryInMs: number } | null`,
non-null only while waiting and not paused. `providers` is `excluded(windows,
now)` in native-first order; `retryInMs` is the earliest deferral minus
`host.now()`, at least 0.

**The progress line.** `buildScopeHopsBlock` (`graphScopeRailModel.ts:241`),
when `fill.refusal` is set:

- one provider: `Semantic Scholar refusing · retry in 40 s`, action Stop;
- several: `2 providers refusing · retry in 40 s`, action Stop;
- `retry in {n} s` with `n = ceil(ms / 1000)` below a minute, else
  `retry in {n} min` with `n = ceil(ms / 60000)`.

`ScopeHopsProgress` gains `title: string | null`: the providers' display names
joined by ", " when there are several, else null; the rail renders it as the
line's tooltip. Names come from `src/services/providerPresentation.ts`. While
the fill moves on through another provider, the line stays
`expanding · {n} left`.

### 3. Testing

**Unit (node, `npm run test:unit`).**

- Providers: the Semantic Scholar and OpenAlex summary pages, Semantic
  Scholar's `fetchRelations` and OpenCitations' `fetchLinks` each throw
  `ProviderRefusedError` when `requestJSON`, replaced by `mock.module`, returns
  a 429, and return `[]` on a 200 with an empty page. The plan's first task
  confirms each module imports under node; one that does not has its throw
  covered by the Zotero case below instead.
- The refusal decisions, moved out of `externalDiscoveryService.ts` into pure
  functions in `relationshipRefreshPolicy.ts` and tested in
  `relationshipRefreshPolicy.test.ts`:
  - after a lookup status: `rate-limited` refuses without a title search;
    `not-found` searches;
  - a snapshot's verdict: a refused lookup, or a refused first page with no
    reported count, is refused, not `complete`, not usable (the
    empty-first-page path);
  - the fill's next provider: native-first order, minus excluded, minus
    providers already refused in this refresh, paging providers only, keyless
    OpenAlex not paging;
  - the resolution when every candidate refused or was skipped: nothing
    stored, `refusedBy` and `skipped` filled.
- `withProviderTimeout`: when the timer wins, the operation's signal is
  cancelled; when the caller's signal is cancelled first, so is the
  operation's. If the module does not import under node, the function moves
  with the pure decisions into a module that does.
- `graphHopRunnerModel.test.ts`: the four landings in the table; the windows at
  30 s, 60 s, 120 s, 300 s, 300 s; `answer` resets the step; `endAll` keeps it;
  `deferUntil` picks the earliest end.
- `graphHopFillModel.test.ts`: a deferred paper is absent from `order` and
  present in `remainingByHop`.
- `graphHopFillRunner.test.ts`, with a fake host and clock: a refused paper is
  not failed and stays in `remaining`; the next expansion receives the refusing
  provider in `excludeProviders`; with every paper deferred there is one tick,
  no expansion in flight, and the expansion restarts at the deferral's end;
  `stop()` cancels the tick; `resume()` expands at once and a second refusal
  waits the next step; windows survive `invalidate()` and `reset()`; the tick
  does not run while `canExpand()` is false.
- `graphScopeRailModel.test.ts`: the line for one provider, for several with
  the tooltip, `40 s`, `59 s`, `1 min` at 60 s, `5 min` at 4 min 1 s.

**Zotero suite (`npm test`).** One new case, in its own `describe` block in
`test/zotero/graphCitationHops.test.ts`, with its own fixture paper and tab. A
`Zotero.HTTP.request` wrapper installed in the case answers 429 at once for
every Semantic Scholar, OpenCitations and OpenAlex URL and is restored in a
`finally`. Adding the fixture as a seed, the case waits for the progress line
to read `refusing · retry in`, checks the hop 1 row still counts the paper as
left and not failed, and presses Stop and sees Resume. It then lifts the
wrapper, presses Resume, and waits up to 60 s for hop 1 to report a count
above 0. Evidence goes through assertion messages, not `Zotero.debug`.

The three existing hop cases keep real round-trips and are not stubbed. With
this built, a Semantic Scholar refusal falls through to OpenCitations for their
DOI fixture, so their pass rate against the keyless pool is the before-and-after
measure.

### 4. Records

- ADR `docs/adr/0013-a-refusal-is-not-a-failure.md`: a refused expansion stays
  in the plan; the fill switches provider and waits only when every paging
  provider refuses; a refused answer is never stored; refusals travel as a
  typed outcome, not as timing. It refines ADR 0006: one answering provider
  per expansion, where a refused provider's requests are the only added
  traffic. ADR 0006 gains a closing line pointing to 0013.
- `CONTEXT.md`, Citation hops: add **Refused** beside Expanded and Failed;
  narrow **Failed** to "returned nothing usable, and no provider refused"; the
  **Fill** definition ends "until every shown paper at an opened hop is
  expanded or failed, or the cap is hit", which still holds, since a refused
  paper is neither and the fill keeps working on it.
- `2026-09-12-citation-hops-design.md`, "The fill", runner paragraph: after "A
  thrown provider error is logged, marks the paper failed for the session, and
  the runner moves on", a pointer that a refusal is not a failure, to this
  spec.
- Roadmap: B50's entry points to this spec. Once built, a manual check under
  Manual verification: on the user's own profile (no Semantic Scholar key),
  fill a seeded graph to hop 3 under Citers. When the line reads
  `Semantic Scholar refusing`, the counts keep climbing through OpenCitations;
  Stop and Resume behave as specified; note the landings per minute for D8.

## Files

| file                                        | change                                                                                  |
| ------------------------------------------- | --------------------------------------------------------------------------------------- |
| `src/providers/types.ts`                    | `ProviderRefusedError`                                                                  |
| `src/providers/semanticScholarProvider.ts`  | `fetchRelations` throws on a final 429                                                  |
| `src/providers/openCitationsProvider.ts`    | `fetchLinks` throws on a final 429                                                      |
| `src/services/relatedWorkSummaryService.ts` | both summary pages throw on a final 429                                                 |
| `src/services/relationshipRefreshPolicy.ts` | pure lookup, snapshot-verdict and next-provider decisions                               |
| `src/services/externalDiscoveryService.ts`  | lookup, timeout, snapshot `refused`, provider switching, `excludeProviders`, resolution |
| `src/services/graphHopRunnerModel.ts`       | refused landing, window rules                                                           |
| `src/services/graphHopFillModel.ts`         | `deferredKeys`                                                                          |
| `src/services/graphHopFillRunner.ts`        | outcome, windows, deferrals, tick, `refusal` state, host clock                          |
| `src/services/graphViewService.ts`          | host `expand` outcome and `excludeProviders`, `now`/`after`/`cancelAfter`               |
| `src/services/graphScopeRailModel.ts`       | refusal line and `title`                                                                |
| `src/services/graphKeyRail.ts` (`:614`)     | `title` as the tooltip                                                                  |

## Out of scope

- D8: expanding less (reader-driven, most-cited first, budgets, hops past 3).
- B54's leak, that failed papers retry on every reopen. A refused paper no
  longer adds to it; a genuinely failed one still does.
- Sharing windows across tabs or with Seed Refresh.
- Honouring a Retry-After longer than the window; the schedule decides.
- Refusals during metadata hydration or `prepareExternalFocusSeedForRefresh`;
  those keep today's handling.
- Papers already stored as empty by the bug above; they are replaced only by a
  manual per-paper refresh, as today.
