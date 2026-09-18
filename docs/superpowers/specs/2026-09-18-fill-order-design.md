# The Fill: Most-Cited First, and a Rail That Shows What Exists

Brainstormed 2026-09-18. Settles D8, B64 and B67. Evidence in
`docs/superpowers/handoffs/2026-09-16-d8-evidence.md`; the fill it changes is
specified in `docs/superpowers/specs/2026-09-12-citation-hops-design.md` ("The
fill") and refined by ADR 0013 and ADR 0014.

## Problem

The fill is a breadth-first walk over every visible parent, 50 works per
expansion, one provider per expansion in the order Semantic Scholar,
OpenCitations, OpenAlex. Measured on the user's profile (2026-09-16, pre-B75):
393 of 432 requests went to OpenCitations, which needs a lookup per paper and
returns bare DOIs with no counts, so hydration is a second pass; Semantic
Scholar refused 11 of 15; OpenAlex, the one provider that can sort a list and
returns metadata with it, answered 20 of 20 and was asked last. The cut of 50
is whichever 50 the provider returns first, and nothing in the rail says so.
The rail also draws six hop rows whatever the data holds, so a row that can
never hold anything reads the same as one not yet fetched.

## Decisions

| question                  | decision                                                                                                                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What a hop is for         | **The whole field.** Completeness matters (Stage 4's shared citers build on it); the design makes it affordable rather than pruning by attention.                                                                                                       |
| Where completeness yields | **The tail of each parent.** The cut of 50 per paper stays, becomes most-cited first where the provider can sort, and the rail says so. Depth and breadth are not pruned.                                                                               |
| How                       | **OpenAlex first for keyed fills, sorted.** Batching parents into one `cites:W1\|W2…` query (Option B) is the follow-up if the measured rate still falls short; it reworks per-paper bookkeeping, must chunk IDs under the URL length, and is not here. |
| Hop rows                  | **Only the hops that exist, plus the next one.** No greyed rows to 6.                                                                                                                                                                                   |
| Out of scope              | The plot's per-landing rebuild (B47, D13), reopen behaviour (B54, B55), a reader-set budget, the opacity ramp (D10), the doubled hop colours (D9).                                                                                                      |

## Design

### The fill's provider order

`relationshipRefreshPolicy.ts` gains one pure rule, `fillProviderOrder`:
for a fill, OpenAlex moves to the front of the native-first order whenever it
is a paging provider for the direction (enabled and holding a key,
`isPagingProvider`). The rest of the order is unchanged. Keyless profiles
behave exactly as today. Not a setting.

What the code already gives, once OpenAlex is first:

- a child from an OpenAlex list carries an OpenAlex work ID (a hint), so from
  hop 2 on an expansion is one request with no lookup;
- an OpenAlex list carries title, year, authors and citation count, so those
  papers are display-complete and never enter the hydration queue;
- B50's windows still apply: a refusal moves the expansion to the next
  candidate as today.

### The cut

`ProviderRequestOptions` gains `order?: "most-cited" | "arrival"`. It
reaches `fetchCitingWorks` and `fetchReferencedWorks` through the options
each already takes.

- OpenAlex honours `most-cited` with `sort=cited_by_count:desc`. Citers stay
  `filter=cites:{W}`. References become `filter=cited_by:{W}`, a sorted list
  with metadata, instead of slicing `referenced_works` off the work record;
  `arrival` keeps today's slice, so the manual paths do not change.
- Semantic Scholar and OpenCitations ignore `order`.
- The fill asks for `most-cited`. Every other caller asks for nothing, which
  means `arrival`.
- The cut stays `AUTOMATIC_RELATIONSHIP_MEMBERSHIP_LIMIT` (50).
- `RelationshipProviderSnapshot` and the stored entry record `order`, the
  order the list was actually cut in: `most-cited` only when the answering
  provider honoured it, else `arrival`. Lists stored before this design read
  `arrival`.

**The rail says so.** The hop block gains one line under the direction
switch, the cut line, stating how the shown expanded papers' stored lists
were actually cut, never what the fill intended, since a fallback provider
cuts in arrival order whatever was asked:

- every stored list `most-cited`: `Top 50 citers per paper, most cited
first` (References: `Top 50 references per paper, most cited first`);
- every stored list `arrival`: `First 50 citers per paper, in the
provider's order`;
- mixed: `Top 50 citers per paper, most cited first for {n} of {m}`;
- nothing expanded yet: the fill's intent, from `fillProviderOrder`'s head,
  in the first or second wording.

Muted text, same size as the progress line, always present while the graph
has a seed. It is the plain statement D7 and D12 asked for.

**Metadata merging.** No new path: every provider JSON response already
feeds the external-work cache by alias (`providerResponseCacheService.ts`),
and `mergeRelatedWorkLists` enriches each work from it, so a bare DOI stored
from OpenCitations picks up OpenAlex's metadata the next time its list is
read. `isRelationshipResponse` there recognises `filter=cites:` only; it
must also recognise `cited_by:`, or References responses are cached as full
records rather than summaries.

**Reported count for free.** An OpenAlex list response carries `meta.count`,
the exact total in the direction. `listByFilter` returns it, and the
snapshot's `reportedCount` takes it when the lookup was skipped (a hinted
parent has no match to read a count from). A hinted parent then reads
`of {reported}` in the rail instead of nothing, and B73's null-count arm
does not arise for OpenAlex.

### The rail shows what exists

`buildScopeHopsBlock` draws:

- row 0, Seeds, as today;
- rows 1 to `depth`, as today;
- row `depth + 1`, carrying the Fetch button, only while hop `depth` holds at
  least one paper (`availableByHop[depth] > 0`) and `depth < MAX_HOP_DEPTH`;
- nothing past that.

A row at or below the depth whose hop holds no paper, while the hop above it
is drained, reads `none yet` under Citers and `none found` under References
instead of `0/0`, and no Fetch row follows it. Drained: `remaining`,
`waiting` and `deferred` are zero for that hop and no paper at it failed
this session. `remaining` counts a paper until its expansion lands, so an
in-flight, paused or deferred paper keeps the row at `0/0`; a failed paper
would not, which is why failures are in the condition, and D12 owns saying
what failed. Before the hop above is drained the row reads `0/0` as today.

Opening a deeper hop early stays allowed: the Fetch row is offered as soon as
the hop above has a paper, not once it is drained (B51's skip is kept).

The hop colour scale is unchanged: hop 3 keeps its colour whether or not rows
4 to 6 are drawn. The Key's Color section under the Citation hop colouring
lists the hops the rail draws, minus the Fetch row.

### B67 and B64

- **B67.** `RelationshipRefreshOptions` gains `fill: true`. The fill runner
  sets it; `unbackedEmptyList`, the provider order and the cut read it.
  Nothing infers a fill from `retryRefusals` any more.
- **B64.** The toolbar's Refresh passes `retryRefusals: false` and no `fill`:
  a 429 ends that provider's part in the refresh at once instead of after
  the 15 s timeout, no windows are kept, and the strategy stays aggregate.
  ADR 0013's "a refused snapshot is never stored" already holds on this path.

## Files

- `src/providers/types.ts`: `order` on `ProviderRequestOptions`; the list
  fetchers may return `{ works, reportedCount }` (OpenAlex) or an array.
- `src/providers/openAlexProvider.ts`: `sort`, `cited_by`, `meta.count`.
- `src/services/relationshipRefreshPolicy.ts`: `fillProviderOrder`.
- `src/services/externalDiscoveryService.ts`: `fill` option, `order` passed
  through, `reportedCount` from the list, `order` on the snapshot.
- `src/services/relationshipStoreService.ts`: `order` on the stored entry,
  defaulting to `arrival`.
- `src/services/providerResponseCacheService.ts`: `isRelationshipResponse`
  takes `cited_by:`.
- `src/services/graphScopeRailModel.ts`: the row rule and the cut line, fed
  the stored orders of the shown expanded papers and the failed count by hop.
- `src/services/graphKeyModel.ts`: hops listed follow the rail's rows.
- `src/services/graphViewService.ts`: the runner passes `fill: true` and
  `order: "most-cited"`; Refresh passes `retryRefusals: false`.
- `docs/adr/0015-*.md`: the fill asks OpenAlex first and cuts most-cited
  first. `CONTEXT.md`: "Cut" joins the vocabulary.

## Testing

Unit (`test/unit`):

- `fillProviderOrder`: OpenAlex first when paging, unchanged when keyless or
  disabled, native-first order kept behind it.
- OpenAlex fetchers: `most-cited` adds `sort`, References switch to
  `cited_by`, `arrival` keeps `referenced_works`; `meta.count` comes back.
- The snapshot's `order` is `most-cited` only when the answering provider
  honoured it.
- `buildScopeHopsBlock`: rows stop at `depth + 1`; no Fetch row when hop
  `depth` is empty; `none yet` / `none found` only once the hop above is
  drained, and not while a paper there failed; the cut line's four texts in
  both directions, including the mixed count.
- `isRelationshipResponse` recognises a `cited_by:` filter.
- `hopLandingEffects` and the runner's options: `fill` is explicit.

Zotero (`test/zotero/graphCitationHops.test.ts`), stubbed in B72's style,
never live: a seeded graph filled through a fake OpenAlex to hop 2 shows
rows Seeds, 1, 2 and a Fetch-hop-3 row and no more; the cut line reads
`Top 50 citers per paper, most cited first`; every request carried `sort`;
no hydration request was made; `of {reported}` reads the fake's
`meta.count`. A second case with the key absent shows the `First 50` line
and today's order.

## Manual verification

- Re-run the 2026-09-16 probe on the user's profile after the XPI ships:
  requests per expansion, requests by provider, time to hop 3, against 393
  requests and 29.6 min (measured before B75, so an upper bound).
- The rail on a fresh seeded graph: Seeds, Hop 1, a Fetch hop 2 row, the cut
  line, nothing else; on a graph filled under Citers until the chain runs
  into the present, the last row reads `none yet` and offers no Fetch.
- Refresh on a seed while Semantic Scholar refuses: the progress window
  closes in seconds, not after 15 s.
