# The Hop Rail's Story

Brainstormed 2026-10-09. Settles D7 (the hop rail's numbers do not add up to
a story) and D12 (nothing says how complete a filled plot is), and half of
B51 (a deeper hop strands the shallower one's progress). Amends the rail
section of `2026-09-12-citation-hops-design.md`.

## Problem

`Hop 3 1,557/1,557 of 2,726` over `expanding · 627 left · Stop`. The
`shown/available` pair is a tautology unless a filter hides papers; `of
{reported}` sums what the expanded parents report, can never be reached
because each list is cut at 50, and climbs with every landing; `left` counts
parents, a second unit, unlabelled. The user, on every walk: the numbers keep
growing and say nothing. Meanwhile three gaps are invisible and look like
papers with no citers: parents never expanded (a Stop or the cap), failed
expansions, and papers drawn without metadata.

## Decisions

| question         | decision                                                                                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The row's job    | **A count and where it came from.** `{shown} papers · from {N}`; no denominator, since every candidate total kept growing in the user's walks.                   |
| What `from N` is | **Expanded parents**: visible papers one hop up whose list in the direction is stored. A stored fact, so it survives a reopen, and it stays at rest.             |
| Hidden papers    | **Not on the row.** The count is what is shown; the Scope section's `n hidden` line already speaks for the rest.                                                 |
| Progress         | **A spinner on each row still growing**, not a number. The line under the rows is the Stop button alone while running.                                           |
| The gaps (D12)   | **One line at rest**, nonzero parts only, with the button that recovers them; `without details` on a second line with no button.                                 |
| Without details  | **A simple predicate**: no title, no year and no citation count. Telling "still hydrating" from "failed to hydrate" is D11's work.                               |
| Out of scope     | Marking unexpanded or detail-less papers on the plot (D10's channel question); whether a deeper hop keeps the shallower hop's queued parents (B51's other half). |

## Design

### The rows

```
Seeds    3
Hop 1    220 papers · from 3
Hop 2    1,557 papers · from 40 ⟳
Hop 3    [Fetch hop 3]
```

- A hop at or below the depth reads `{shown} papers` (`1 paper`), followed
  by a muted `· from {N}` when N > 0. N counts the hop entries at `hop - 1`
  with `expanded` set and a key in the scope's visible keys.
- The spinner follows a row while the runner's plan still holds papers at
  the hop above (`remainingByHop[hop - 1] > 0`), the fill is not paused and
  no refusal is cooling down. Every such row spins, not only the deepest. Under
  `prefers-reduced-motion` the glyph is static. Its style lives in
  `graph.css`.
- Unchanged: the Seeds row's bare count, `not fetched`, `none yet` and
  `none found`, the Fetch hop N button, checkboxes, swatches, dimming.
- Deleted: `{shown}/{available}`, `of {reported}`, the runner's
  `reportedByHop`. The runner's `reported` map stays: the planner orders by
  it.

### The line under the rows

It follows the deepest open hop, as today.

```
running     Stop
refusing    Semantic Scholar refusing · retry in 30 s · Stop
at rest     180 not expanded · 12 failed · Resume
            40 without details
```

- **Running** (plan nonempty, not paused, no refusal): the Stop button and
  no text.
- **Refusing**: unchanged (ADR 0013), countdown included.
- **At rest**: a gaps line naming only its nonzero parts, in this order:
  - `{n} not expanded`: the plan's visible parents left unexpanded, whether a
    Stop holds them or the cap does (`remaining + waiting`).
  - `{n} failed`: the runner's failed keys in the direction whose papers are
    visible, plus those that gave up at the deferral limit (`gaveUp`, which
    the runner does not filter by visibility today; it is filtered the same
    way).
  - The button: **Resume** when paused; else **Fetch more** when any wait on
    the cap; else **Resume** when any gave up; else none. Each does what it
    does today.
  - A second line, `{n} without details`: hop papers (hop ≥ 1) for which
    `lacksDetails` holds. No button.
- **Nothing missing**: no line. The cut line stays as it is and keeps saying
  what the 50-per-paper cut leaves out.
- Deleted: `expanding · {n} left`, `500 expanded · {n} waiting`,
  `{n} gave up`.

### Data

- `lacksDetails(node)`: a pure predicate beside the graph node type, true when
  the node has no title (or only the `Title unavailable` placeholder), a null
  year and a null citation count.
- The runner's `state()` gains `remainingByHop` (from its last plan) and
  `failed` (the count above). `reportedByHop` is removed.
- `ScopeHopsInput` drops `reportedByHop` and gains `expandedByHop`,
  `activeByHop` and `lacksDetails`, all built in `scopeHopsInput()` in
  `graphViewService.ts`. `fill` gains `failed`.
- `ScopeHopRow` drops `reported`, gains `from: string | null` and
  `spinning: boolean`. `ScopeHopsProgress` becomes a tagged union:
  `running`, `refusing` (today's shape), `rest` (`text`, `details: string |
null`, an optional action).
- `graphKeyRail.ts` renders the `from` span and the spinner in the row, and a
  rest line of one or two lines.

## Testing

- `test/unit/graphScopeRailModel.test.ts`: the count strings rewritten; new
  cases for `from N` at rest and running, the spinner per row and its absence
  under Stop and a refusal, each gap alone and together, the button
  precedence, and no line when nothing is missing.
- `test/unit/graphHopFillRunner.test.ts`: `remainingByHop` and `failed`
  replace the `reportedByHop` assertions.
- A unit case for `lacksDetails`.
- `test/zotero/graphCitationHops.test.ts`: reads of `expanding · n left` become
  reads of the Stop button and the spinner, each after proving the fill ran;
  one new case reopens a saved graph and finds `from N` unchanged.
- `test/zotero/hostButtonHeight.test.ts`: fixtures updated.
- Manual verification: a seeded fill shows spinners on the growing rows and
  `from N` climbing; Stop leaves the gaps line with Resume.

## Docs

The hops spec's rail section points here. On shipping, D7 and D12 are deleted
from the roadmap and B51 narrows to its other half.
