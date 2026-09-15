# The Hop Fill Under Provider Refusals

**Date:** 2026-09-15
**Status:** Design approved 2026-09-15, revised the same day after an
adversarial review of 21 findings (see "Review 2026-09-15"); not built

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
  delaying the provider by 1, 2 and 4 s with upward jitter (up to 1.25, 2.5
  and 5 s, `http.ts:64,90`), on top of Semantic Scholar's 1.1 s spacing and
  one-at-a-time queue. A four-attempt refusal is about 10–11 s.
- `withProviderTimeout` (`externalDiscoveryService.ts:1198`) starts its 15 s
  timer when called, so time queued behind other Semantic Scholar traffic
  counts; it resolves `null`, which is a failure, and cancels nothing, so the
  retries carry on behind it.
- A 429 maps to `rate-limited` (`failureStatusFromHTTP`,
  `src/providers/types.ts:67`), but `lookupProviderRecord`
  (`src/services/externalDiscoveryService.ts:1174`) ignores the status and
  falls through to `searchExactTitle`, a second request to a provider that
  just refused.
- `hopLandingEffects` (`src/services/graphHopRunnerModel.ts:52`) marks any
  expansion that stored nothing as failed for the session, so in a refusal
  storm every paper the fill reaches leaves the plan until the graph is
  reopened.
- Worse: every page fetcher returns `[]` on any non-OK response
  (`fetchRelatedWorkSummaryPage`, `src/services/relatedWorkSummaryService.ts:518`
  for Semantic Scholar, `:546` and `:562` for OpenAlex, and `:436` swallows a
  refused OpenAlex batch so `:583` filters the page short; Semantic Scholar's
  `fetchRelations`, `semanticScholarProvider.ts:116`; OpenCitations'
  `fetchLinks`, `openCitationsProvider.ts:66`). In
  `fetchProviderRelationshipSnapshot` (`externalDiscoveryService.ts:1221`) an
  empty first page sets `endpointExhausted` (`:1352`); with no reported count
  the snapshot is `complete` and `succeeded` (`:1388-1399`), passes the
  `usable` filter (`:1757`), and an empty list is stored as the paper's answer.
  Expanded is "stored, even if empty" and the walk checks existence, not age,
  so the fill never returns to that paper; only a manual per-paper refresh
  replaces it.

## Decisions taken in the brainstorm (2026-09-15)

| question                                        | decision                                                                                                                                                                                                                                                              |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One spec with D8, or apart                      | **Apart.** B50 is specified, built and measured first; D8 is brainstormed afterwards on real timings.                                                                                                                                                                 |
| Is a refused expansion a failure                | **No.** A paper whose expansion is refused (HTTP 429) stays in the plan and is never added to the failed set.                                                                                                                                                         |
| What the fill does on a refusal                 | **Switch provider, then wait.** A refused expansion retries at once on the next provider that can page the direction, still one answering provider per expansion (ADR 0006, refined by the new ADR 0013). The fill waits only when every paging provider is refusing. |
| How long it waits                               | **30 s, 1 min, 2 min, then every 5 min, never giving up.** The progress line shows the refusal and a countdown; Stop still works; nothing is in flight while waiting.                                                                                                 |
| How the refusal reaches the fill                | **A typed outcome carried end to end**, from the provider to the runner. Not a provider-health register inferred from timing, and not both.                                                                                                                           |
| When one provider refuses and another answers   | **The refusing provider sits out its window.** Its refusal starts its own cool-down for this fill; later papers go straight to the next paging provider; when the window ends it is tried first again, so the native-first order comes back.                          |
| What Resume does during a wait                  | **Retries at once.** Every window ends; each provider keeps its step, so a fresh refusal waits the next, longer delay.                                                                                                                                                |
| How several refusing providers read on the rail | **`2 providers refusing`**, with their names in the line's tooltip; one provider is named on the line.                                                                                                                                                                |
| How often the countdown updates                 | **Every second, only while waiting.**                                                                                                                                                                                                                                 |
| Seed Refresh and the other callers              | **Only "a refused snapshot is never stored".** No windows, no provider switching, today's retries.                                                                                                                                                                    |

## Decisions taken in the review (2026-09-15)

| question                                                                  | decision                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How a refusal is kept from arriving as the 15 s timeout                   | **The fill does not retry a 429.** Its requests return a 429 at once (5xx and network errors still retry), so a refusal is known in about half a second; the fill's windows do the backing off. Other callers keep today's retries. |
| An empty first page with no lookup match and no reported count, in a fill | **A failure, not stored.** The fill trusts an empty list only when a lookup match or a reported count stands behind it. Manual paths keep today's behaviour.                                                                        |
| The existing 60 s register (`recordProviderFailure`, `getProviderPlan`)   | **The fill bypasses it.** The fill's candidates come from its own windows alone, so the rail can always name who is refusing; the register keeps serving its callers.                                                               |

## Vocabulary

**Refused**: an expansion where nothing was stored and at least one candidate
provider refused (HTTP 429) or was sitting out a window. The paper stays in the
plan and is retried. This holds even when another candidate failed outright:
the refusing provider might still answer. Distinct from **Failed**, which
narrows to "nothing usable, and no provider refused or was skipped".

**Window**: one provider's cool-down in one fill. It starts at a refusal, lasts
the delay for the provider's step, and ends early on Resume. A provider in a
window is not asked by that fill.

**Deferred**: a refused paper, left out of the plan's order until the earliest
window among the providers that refused or skipped it ends. It still counts as
left.

**Cooling down**: the fill's state when nothing can be expanded until a window
ends. Not "waiting", which the rail already uses for papers the cap holds back.

**Paging provider** for a direction: enabled, has the direction's fetcher
(`providerPagesRelationships`, `src/providers/registry.ts:152`), and, for
OpenAlex, has a key. The last clause is new: the existing function checks only
the fetcher, and keyless OpenAlex's summary page returns `[]` before any
request (`relatedWorkSummaryService.ts:530`).

## Design

### 1. Seeing a refusal: providers and discovery service

**A typed error.** `ProviderRefusedError` (in `src/providers/types.ts`, beside
`failureStatusFromHTTP`) carries the provider's id. The page fetchers throw it
when the response `requestJSON` finally returns is a 429:

- Semantic Scholar's summary page (`relatedWorkSummaryService.ts:518`) and
  `fetchRelations` (`semanticScholarProvider.ts:116`);
- OpenAlex's cited-by page (`:546`), its references source request (`:562`),
  and its summary batches when called from the page (`applyOpenAlexBatches`,
  `:436`, gains a flag the page sets; hydration callers keep swallowing);
- OpenCitations' `fetchLinks` (`openCitationsProvider.ts:66`).

A 200 with an empty page still returns `[]`, and every other non-OK status
keeps today's behaviour. Signatures do not change. The page fetchers' other
caller, `citingWorksForReference`
(`src/services/missingPaperRecommendationService.ts:64`), already catches a
throw and moves to the next provider.

**Lookups report, they do not throw.** A provider's `lookup` and
`searchExactTitle` already return `rate-limited` for a 429; Semantic Scholar's
`searchClosestTitle` (`semanticScholarProvider.ts:285`) turns a 429 into
`null` and so into `not-found`, and now makes `searchExactTitle` return
`rate-limited` instead. In `lookupProviderRecord`, a `rate-limited` lookup
throws `ProviderRefusedError` without a title search, and a `rate-limited`
title search throws likewise; `not-found` and every other status fall through
as today. Lookups keep returning statuses because other callers
(`applyIndividualFallbacks`, `relatedWorkSummaryService.ts:464`) do not catch.

**The fill does not retry a 429.** `JSONRequestOptions` (`http.ts:28`) gains
`retryRefusals?: boolean`, default true. When false, a 429 is not retried: it
still postpones the provider by `backoffDelayMs(attempt)` as a retried one
would, so the provider's queue backs off, and the response is returned at
once. 5xx and network errors keep their retries. `ProviderRequestOptions`
(`types.ts:10`) gains the same field, and every provider request that takes
`options?.signal` passes it through. The fill's refresh sets it false.

**The timeout cancels what it abandoned.** The race moves into
`src/services/cancellationScope.ts` as
`withTimeoutScope(operation, ms, parentSignal, onTimeout)`, which loads under
node: it creates a scope, subscribes it to `parentSignal` so a caller's cancel
cancels the scope, calls `operation(scope.signal)`, cancels the scope when the
timer wins and calls `onTimeout`, and unsubscribes and clears the timer in its
`finally`. `withProviderTimeout` wraps it with its `Zotero.debug` line and
passes the scope's signal into the request options. A timeout stays a failure,
not a refusal. With no 429 retries in the fill, a refusal lands well inside
the timeout unless the provider's queue alone holds the request past 15 s.

**A refused snapshot says so.** `RelationshipProviderSnapshot` gains
`refused: boolean`. `fetchProviderRelationshipSnapshot` catches
`ProviderRefusedError` from the lookup or any page:

- before any page was collected: `refused: true, succeeded: false,
complete: false, works: []`, never usable, never stored;
- after pages were collected (a manual path paging a long list; the fill
  fetches one page): `refused: true, succeeded: true, complete: false` with
  the works collected, usable as a partial list exactly as today.

**The fill trusts an empty list only with something behind it.** For a
refresh with `retryRefusals: false` (the fill), a snapshot whose first page was
empty, with no lookup match and no reported count, is `succeeded: false`: a
failure, not stored. This closes the OpenCitations path, where a DOI it does
not index fails the lookup (`openCitationsProvider.ts:110-117`), the page ID
falls back to the DOI (`externalDiscoveryService.ts:1310`), and an empty page
would otherwise be stored as complete. Manual paths keep today's rule.

**The fill switches provider.** `ExternalRelationshipRefreshOptions` gains
`excludeProviders?: readonly CitationProviderID[]` and
`retryRefusals?: boolean`, both used only by the fill. When
`retryRefusals` is false:

- Candidates are the native-first order (`preferredRelationshipProviders`,
  `relationshipRefreshPolicy.ts:176`) over `getProviderPlan` with a new
  `ignoreHealth` option, so the register is bypassed, filtered to paging
  providers for the direction (vocabulary) that support the paper's
  identifiers, minus `excludeProviders`.
- If no candidate remains, the refresh asks nobody and publishes nothing: it
  returns before `beginCitationUpdatePublicationBatch` (`:1693`) and reports
  refused with every excluded paging provider in `skipped`. No Crossref or
  Inspire request is ever made for a fill.
- Otherwise it asks the first candidate. When that snapshot is refused it asks
  the next, and so on, stopping at the first snapshot that is not refused: a
  usable one is stored as today; a failed one ends the refresh with nothing
  stored.

For the other callers `relationshipProviders` changes only in its `canPage`,
which gains the OpenAlex key clause, so keyless OpenAlex is no longer promoted
into a one-provider head.

ADR 0006's traffic ceiling, the cap times one lookup and one page, becomes the
cap times one refused request per paging provider plus one lookup and one page;
a refusing provider then sits out its window and is not asked again until it
ends.

**The resolution carries the outcome.** `RelationshipRefreshResolution` gains:

- `refusedBy: CitationProviderID[]`, providers whose snapshot in this refresh
  was refused, in the order asked;
- `skipped: CitationProviderID[]`, paging providers for the direction that
  `excludeProviders` left out;
- `answeredBy: CitationProviderID | null`, the provider whose snapshot was
  stored when exactly one was; null when none was or when an aggregate refresh
  merged several.

Every `onMembershipResolved` call site fills them. A fill expansion that joins
a refresh already in flight for the same paper and direction
(`externalDiscoveryService.ts:1995-2012`) receives that refresh's resolution;
its own `excludeProviders` did not apply, which is accepted.

**Seed Refresh and the other callers.** The manual aggregate path, the detail
pane's per-paper refresh and the focus refresh gain only what falls out of the
snapshot: a refused provider's snapshot with no works is dropped from `usable`,
so it is never stored; in an aggregate refresh the other providers' usable
snapshots still replace the stored merged list as today.

### 2. The fill

**The expansion reports an outcome.** `HopFillHost.expand` resolves a
`HopExpandOutcome`, `{ refusedBy, skipped, answeredBy }`, instead of `void`.
The host in `graphViewService.ts` (`:3861`) passes `retryRefusals: false` and
the runner's excluded providers into `refreshExternalRelationships` and copies
the lists from `onMembershipResolved`. When the callback never fires (the
paper left the graph) or `expand` throws (the seed preparation, a bug), the
outcome is empty and `stored` decides as today.

**A third landing.** `HopLandingInput` gains `refused: boolean`, true when
nothing was stored and `refusedBy` or `skipped` is non-empty.
`hopLandingEffects` answers:

| landing                     | countExpanded | markFailed | defer | applyToModel |
| --------------------------- | ------------- | ---------- | ----- | ------------ |
| stale epoch or cleaned      | no            | no         | no    | no           |
| stored                      | yes           | no         | no    | yes          |
| refused                     | no            | no         | yes   | no           |
| nothing stored, not refused | no            | yes        | no    | yes          |

A refused landing changes nothing in the store, so the runner calls neither
`host.landed()` nor `host.settled()` for it, only `wake()`: no fragment drop,
no walk rebuild. A refused seed therefore does not trigger the seed fit until
it lands. `hopRejectionEffects` is unchanged.

**Provider windows, pure.** `graphHopRunnerModel.ts` gains the window rules,
free of timers:

- `COOL_DOWN_MS = [30_000, 60_000, 120_000, 300_000]`; a provider at step `s`
  waits `COOL_DOWN_MS[min(s, 3)]`.
- `refuse(windows, provider, now)`: the window ends at `now + delay(step)`, and
  the step goes up by one.
- `answer(windows, provider)`: the step returns to 0 and the window ends.
- `excluded(windows, now)`: providers whose window ends after `now`.
- `endAll(windows, now)`: every window ends at `now`; steps are kept.
- `deferUntil(windows, providers, now)`: the earliest window end among
  `providers` that is after `now`, or null.

The runner applies an outcome in order: `refuse` for each of `refusedBy`, then
`answer` for `answeredBy`. Windows belong to the provider, not the direction
or the seeds: they survive `invalidate()` and `reset()` and go with the runner
on `dispose()`. They are per graph view, not shared across tabs.

**Deferred papers.** The runner keeps, per direction, a map from key to the
time its deferral ends, set on a refused landing to
`deferUntil(windows, refusedBy ∪ skipped, now)`; when that is null (every such
window has already ended) the paper is not deferred and the next plan names it
again. `HopFillInput` (`graphHopFillModel.ts:11`) gains `deferredKeys`, the
keys whose deferral ends after now. In `planHopFill` the deferral check sits
after the depth, visibility, expanded and failed checks and before the cap: a
deferred paper counts in `remainingByHop`, is absent from `order`, and is
counted in a new `deferredByHop`, not in `waitingByHop`. `reset()` clears
deferrals with the failed set; `invalidate()` keeps them, as it keeps the
failed set.

**Cooling down.** The host gains `now(): number`,
`pagingProviders(direction): CitationProviderID[]`, `after(ms, run): number`
and `cancelAfter(handle)`, so a test drives a fake clock. The runner holds one
timer handle. Every wake frame cancels it, then:

- if `pagingProviders(direction)` is non-empty and every one of them is in
  `excluded(windows, now)`, the fill is cooling down and expands nothing, however many papers are in
  `order`; the retry time is the earliest window end among them;
- else, if `order` is empty and `deferredByHop` sums above 0, the fill is
  cooling down; the retry time is the earliest deferral end among the plan's
  deferred papers;
- otherwise the fill expands `order[0]` as today.

While cooling down, not paused and `canExpand()`, the runner arms the timer for
the retry time; it calls `wake()`. `stop()`, `invalidate()`, `reset()` and
`dispose()` cancel it; a tab going inactive leaves it unarmed until `setActive`
wakes the fill. No request is in flight while cooling down. `planEmpty()` fires
as today when `order` is empty, which flushes the coalesced presentation
refresh while the fill idles.

**Stop, Resume and retry.** `stop()` pauses and cancels the timer; windows and
deferrals stay. The runner gains `retryNow()`: `endAll`, clear every deferral,
wake. The rail's Resume calls `resume()` then `retryNow()`. Fetch hop N
(`graphViewService.ts:3945`) and `applyGraphView` (`:2071`) keep calling
`resume()` alone, so opening a hop or applying a view does not end windows.
`fetchMore()` does not touch windows.

**The state the rail reads.** `HopFillState` gains
`refusal: { providers: CitationProviderID[]; retryAt: number } | null`,
non-null only while cooling down and not paused. `providers` is
`excluded(windows, now)` in the order `getProviderPlan` gives for the direction
with `ignoreHealth`; `retryAt` is the retry time above, on the host's clock.
`retryAt` is fixed for the length of a cool-down, so the rail's model does not
change from second to second.

**The progress line.** In `buildScopeHopsBlock` (`graphScopeRailModel.ts:211`,
progress at `:240`), a set `fill.refusal` wins over both other lines, including
Fetch more: while every candidate is refused, raising the cap would only defer
more papers. `ScopeHopsProgress` gains `countdown: { retryAt: number } | null`
and `title: string | null`:

- one provider: text `Semantic Scholar refusing`, countdown set, action Stop;
- several: text `2 providers refusing`, countdown set, action Stop, and `title`
  the providers' names joined by ", ";
- names come from `citationDataSourceLabel`
  (`src/services/providerPresentation.ts`).

A pure `formatRetryIn(ms)` in `graphScopeRailModel.ts` reads `retry in {n} s`
with `n = ceil(ms / 1000)` while `n < 60`, else `retry in {m} min` with
`m = ceil(ms / 60000)`, and `retry in 0 s` at or below 0.

**The countdown updates in place.** `progressLine` (`graphKeyRail.ts:612`)
renders the countdown as its own span, `cm-scope-hop-countdown`, sets `title`
on the line, and when `countdown` is set starts one interval of 1 s on the
rail's window that rewrites only that span's text from
`formatRetryIn(retryAt - now())`. `KeyRailOptions` gains `now()`. The interval
is cleared when the Scope section is rebuilt or the rail disposed. The model's
signature (`graphKeyRail.ts:678`) does not change while the countdown runs, so
the Scope section is not rebuilt, the canvas is not redrawn, and focus stays on
Stop. While the fill moves on through another provider, the line stays
`expanding · {n} left`.

### 3. Testing

**Unit (node, `npm run test:unit`).**

- Providers, through `provider.fetchCitingWorks` / `fetchReferencedWorks` and
  `fetchRelatedWorkSummaryPage` with `requestJSON` replaced by `mock.module`:
  Semantic Scholar's page and relations, OpenAlex's cited-by page, references
  source and page batch (with a `Zotero.Prefs` stub supplying a key), and
  OpenCitations' links each throw `ProviderRefusedError` on a 429 and return
  `[]` on a 200 with an empty page; a hydration call to `applyOpenAlexBatches`
  does not throw. `searchExactTitle` returns `rate-limited` when
  `searchClosestTitle` is refused.
- `requestJSON` with `retryRefusals: false`: a 429 is requested once, the
  provider is postponed, the 429 is returned; a 503 still retries.
- `withTimeoutScope` (`cancellationScope.ts`, node fake timers): the timer
  winning cancels the operation's signal and calls `onTimeout`; the parent's
  cancel cancels it; the subscription is released either way.
- Pure decisions in `relationshipRefreshPolicy.ts`, tested in
  `relationshipRefreshPolicy.test.ts`, each taking its inputs as parameters
  (`canPage`, `hasOpenAlexKey`, statuses, snapshots):
  - after a lookup or title-search status: `rate-limited` refuses,
    `not-found` searches;
  - a snapshot's verdict: refused before any page, refused after pages (partial,
    usable), and, for a fill, an empty first page with no match and no count is
    a failure;
  - paging providers: keyless OpenAlex is not one;
  - the fill's candidates and next provider: native-first, paging only,
    minus excluded, minus refused in this refresh; none left means refused with
    `skipped` filled.
- `graphHopRunnerModel.test.ts`: the four landings in the table, including
  "one refused, the next failed" as refused; windows at 30 s, 60 s, 120 s,
  300 s, 300 s; `answer` resets; `endAll` keeps the step; `deferUntil` picks
  the earliest end after now and is null when all have ended.
- `graphHopFillModel.test.ts`: a deferred paper is absent from `order`, counted
  in `remainingByHop` and `deferredByHop`, and not in `waitingByHop` even at a
  full cap.
- `graphHopFillRunner.test.ts`, fake host and clock:
  - a refused paper is not failed, stays in `remaining`, and triggers neither
    `landed` nor `settled`;
  - the next expansion carries the refusing provider in its exclusions;
  - with every paging provider in a window, no `expand` is called however many
    papers are in the plan, and one timer is armed for the earliest end;
  - with every remaining paper deferred, one timer, nothing in flight, and the
    expansion restarts at the deferral's end;
  - a wake during cooling down re-arms rather than duplicating the timer;
    `stop()`, `invalidate()` and `reset()` cancel it; no timer while
    `canExpand()` is false;
  - `retryNow()` expands at once and a second refusal waits the next step;
    `resume()` alone does not end windows;
  - windows survive `invalidate()` and `reset()`;
  - `state().refusal` names the excluded providers and a fixed `retryAt`.
- `graphScopeRailModel.test.ts`: the refusal line for one provider and for
  several with `title`; the refusal line winning over Fetch more;
  `formatRetryIn` at 40 000, 59 000, 59 001, 60 000 and 241 000 ms, and at 0.

**Zotero suite (`npm test`).** One new case, in its own `describe` block in
`test/zotero/graphCitationHops.test.ts`, with its own tab and a second fixture
paper whose DOI OpenCitations indexes with at least one citer (the plan's first
task confirms one with a request). A `Zotero.HTTP.request` wrapper, installed
in the case and restored in a `finally`, answers 429 at once for every Semantic
Scholar, OpenCitations and OpenAlex URL and passes everything else through;
`requestJSON` reads `Zotero.HTTP.request` at call time (`http.ts:392`). Adding
the fixture as a seed, the case:

1. waits for the progress line to read `refusing` with a `retry in` countdown,
   and for the countdown's text to change while the line element stays the
   same node;
2. presses Stop and sees the line read `1 left` with Resume;
3. lifts the wrapper, presses Resume, and waits up to 60 s for hop 1 to report
   a count above 0.

Evidence goes through assertion messages, not `Zotero.debug`; the case is run
twice, as a timing-shaped case. The three existing hop cases keep real
round-trips; with this built, a Semantic Scholar refusal moves them to
OpenCitations within a second, so their pass rate against the keyless pool is
the before-and-after measure.

### 4. Records

- ADR `docs/adr/0013-a-refusal-is-not-a-failure.md`: a refused expansion stays
  in the plan; the fill does not retry a 429, switches provider and cools down
  only when every paging provider refuses; a refused answer is never stored;
  refusals travel as a typed outcome, not as timing; the fill bypasses the
  60 s register. It refines ADR 0006: one answering provider per expansion,
  with a refused request per paging provider as the only added traffic. ADR
  0006 gains a closing line pointing to 0013.
- `CONTEXT.md`, Citation hops: add **Refused** beside Expanded and Failed;
  narrow **Failed** to "returned nothing usable, and no provider refused or
  was skipped"; the **Fill** definition still holds, since a refused paper is
  neither expanded nor failed and the fill keeps working on it.
- `2026-09-12-citation-hops-design.md`, "The fill", runner paragraph: after "A
  thrown provider error is logged, marks the paper failed for the session, and
  the runner moves on", a pointer that a refusal is not a failure, to this
  spec.
- Roadmap: B50's entry points to this spec. Once built, a manual check under
  Manual verification, on the user's own profile (no Semantic Scholar key):
  fill a seeded graph to hop 3 under Citers and note the landings per minute
  for D8. While Semantic Scholar refuses, the counts keep climbing and the line
  reads `expanding · {n} left`. If the line reads `… refusing · retry in …`,
  the countdown ticks without the rail flickering, Stop keeps focus under the
  keyboard, and Resume starts expanding at once.

## Files

| file                                        | change                                                                                                    |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `src/providers/types.ts`                    | `ProviderRefusedError`; `ProviderRequestOptions.retryRefusals`                                            |
| `src/providers/http.ts`                     | `retryRefusals`: a 429 returned at once, provider still postponed                                         |
| `src/providers/semanticScholarProvider.ts`  | `fetchRelations` throws; `searchClosestTitle`'s 429 makes `searchExactTitle` `rate-limited`; pass-through |
| `src/providers/openCitationsProvider.ts`    | `fetchLinks` throws; pass-through                                                                         |
| `src/providers/openAlexProvider.ts`         | pass-through                                                                                              |
| `src/providers/registry.ts`                 | `getProviderPlan` `ignoreHealth`                                                                          |
| `src/services/relatedWorkSummaryService.ts` | summary pages and the page's batches throw on a 429                                                       |
| `src/services/cancellationScope.ts`         | `withTimeoutScope`                                                                                        |
| `src/services/relationshipRefreshPolicy.ts` | lookup, snapshot-verdict, paging-provider and next-provider decisions                                     |
| `src/services/externalDiscoveryService.ts`  | lookup, timeout, snapshot `refused`, fill candidates and switching, no-candidate return, resolution       |
| `src/services/graphHopRunnerModel.ts`       | refused landing, window rules                                                                             |
| `src/services/graphHopFillModel.ts`         | `deferredKeys`, `deferredByHop`                                                                           |
| `src/services/graphHopFillRunner.ts`        | outcome, windows, deferrals, cooling down, one timer, `retryNow`, `refusal` state, host clock             |
| `src/services/graphViewService.ts`          | host `expand` outcome and options, `now`/`after`/`cancelAfter`/`pagingProviders`, Resume → `retryNow`     |
| `src/services/graphScopeRailModel.ts`       | refusal line, `countdown`, `title`, `formatRetryIn`                                                       |
| `src/services/graphKeyRail.ts`              | countdown span updated in place, line `title`, `now()`                                                    |

## Out of scope

- D8: expanding less (reader-driven, most-cited first, budgets, hops past 3).
- B54's leak, that failed papers retry on every reopen. A refused paper no
  longer adds to it; a genuinely failed one still does.
- Sharing windows across tabs, with Seed Refresh, or with the 60 s register.
- A request held past 15 s by the provider's queue alone still times out as a
  failure.
- Honouring a Retry-After longer than the window; the schedule decides.
- Refusals during metadata hydration or `prepareExternalFocusSeedForRefresh`;
  those keep today's handling.
- Papers already stored as empty by the bug above; they are replaced only by a
  manual per-paper refresh, as today.

## Review 2026-09-15

An adversarial review read the first version against the source and returned
21 findings. The three that needed a call are in "Decisions taken in the
review". Every finding and what became of it:

1. Blocker, a refusal arriving as the 15 s timeout: the fill does not retry a
   429 (§1).
2. Blocker, the fill expanding paper by paper, and asking Crossref for
   References, while every paging provider is in a window: the runner cools
   down without calling `expand`, and a refresh with no candidate asks nobody
   and publishes nothing (§1, §2).
3. Blocker, an OpenCitations empty page stored as complete: the fill trusts an
   empty list only with a lookup match or a reported count (§1).
4. §1 and §2 disagreeing on "one refused, the next failed": refused (Vocabulary,
   §2, a runner-model case).
5. `providerPagesRelationships` blind to the OpenAlex key: a paging-provider
   rule with the key clause, also used by `relationshipProviders` (Vocabulary,
   §1).
6. The existing 60 s register: the fill bypasses it (§1).
7. The countdown rebuilding the Scope section and redrawing the canvas each
   second: a fixed `retryAt` in the model and a span updated in place (§2).
8. A manual check that could not be observed: rewritten (Records).
9. Deferrals against the cap and papers that left the plan: the deferral check
   before the cap, `deferredByHop`, cooling down only while a deferred paper is
   still a candidate, the refusal line winning over Fetch more (§2).
10. OpenAlex's unnamed refusal paths: `:562` and the page's batches (§1).
11. Pages dropped on a later refusal, and "never replaces a list" overstated:
    pages already collected are kept as a partial list; the wording is
    narrowed (§1).
12. The tick's lifecycle: there is no tick in the runner; one timer, cancelled
    on every wake frame and by `stop`, `invalidate`, `reset`, `dispose` (§2).
13. A refused seed and the rebuild: no `landed`, no `settled`, no seed fit until
    it lands (§2).
14. Zotero case assertions and determinism: asserts the paused line's `1 left`,
    a fixture OpenCitations indexes, run twice (§3).
15. Joining an in-flight refresh, and `answeredBy` for merged stores: defined
    (§1).
16. `applyGraphView` calling `resume()`: Resume's retry is split into
    `retryNow()`, called only by the rail's Resume (§2).
17. The rail's provider order: `getProviderPlan`'s order for the direction (§2).
18. Seams under node: `withTimeoutScope` in `cancellationScope.ts`; private
    fetchers tested through the provider object; a `Zotero.Prefs` stub (§3).
19. `expand` throwing: the outcome is empty and `stored` decides (§2).
20. `searchClosestTitle` hiding a 429 as `not-found`: it now yields
    `rate-limited` (§1).
21. Nits: line references corrected; "cooling down" instead of a second
    "waiting"; `formatRetryIn` switches to minutes at 59 001 ms; ADR 0013 is
    marked new. Not taken: computing `skipped` in the runner, since only the
    refresh knows which paging providers applied to the paper.
