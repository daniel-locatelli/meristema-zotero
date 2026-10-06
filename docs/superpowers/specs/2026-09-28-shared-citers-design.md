# Shared Citers

Brainstormed 2026-09-28. The second half of Stage 4; the floor
(`2026-09-18-citation-floor-design.md`, ADR 0016) is the first. The design
reference is option 6a in `docs/design_handoff_citation_chain_depth/README.md`
(Shared citers, Key tiers); this spec departs from it on the channel, as the
decisions say.

## Problem

A graph seeded from several papers holds, at hop 1, the papers that cite (or,
under References, are cited by) each seed. The ones linked to two or more
seeds are the bridges between the reader's starting points, and nothing on
the plot tells them from the rest. The Who cites whom view has waited on this
since D4.

## Decisions

| question            | decision                                                                                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The channel         | **A colouring, Seeds linked**, in the gear's colour list, not the design's opacity grade. Opacity already carries the hop ramp and emphasis dimming (ADR 0009, D10); a third meaning on it would make all three unreadable. D10 stays its own decision. |
| Hop 2 and deeper    | **Not graded.** They take the colouring's no-value colour, as No data does; the Key says so with a `Not graded` entry. The bridges are hop 1.                                                                                                           |
| Only                | **A scope rule, `Shared by ≥ N seeds`**, N from 1 (off) to S, after the floor. Not a three-way Off/Dim/Only switch: Dim is choosing the colouring.                                                                                                      |
| Tier colours        | **Fixed by k of S** on the theme's sequential ramp, strongest at S. No kmax normalisation: a tier's colour does not move while the fill runs or the floor is dragged. Replaces the design's formula.                                                    |
| Edges               | Under the colouring only, an edge from a paper with k ≥ 2 to a seed takes that seed's colour. Otherwise edges are as today (D13 is separate).                                                                                                           |
| Labels              | Under the colouring, ordered selected, hovered, seeds, k descending, citations; the existing budget decides where to stop. No cap of 18.                                                                                                                |
| One seed            | The colouring and the rail row are unavailable; the rule is inert while S < 2, and N is read as `min(N, S)`.                                                                                                                                            |
| The cut undercounts | Stated, not fixed. k counts the links the graph holds, and a seed's hop-1 list is cut at 50 (D8), so a paper citing A and B that made only A's cut reads k = 1. The Key's note says so under the colouring.                                             |
| Out of scope        | Presets; D10's opacity ramp; D13's edge density; grading hop ≥ 2; checking a hop-1 paper's own reference list against the seeds (filed as an entry).                                                                                                    |

## Design

### Seed links

A hop-1 paper's **seed links**, k, is the number of seeds among its parents.
Under Citers that is the seeds it cites; under References, the seeds that
cite it. `SeedMarks` (`graphHopModel.ts`) gains
`seedLinks: ReadonlyMap<string, number>`, one entry per hop-1 paper, computed
in `seedMarks` from the hop entries' parents. A map, not a node field (ADR
0008). A paper at hop ≥ 2 or no hop has no entry.

`CONTEXT.md` gains, under Citation hops: **Seed links**: "The number of seeds
among a hop-1 paper's parents: under Citers, the seeds it cites; under
References, the seeds that cite it. Counts only the links the graph holds.
Deeper papers have none." _Avoid_: shared count, bridge score, k. And
**Shared paper**: "A hop-1 paper with two or more seed links." _Avoid_:
bridge, shared citer (the Citers case only).

### The rule

`ScopePaper` is unchanged; `GraphScopeInput` gains `shared: number`, an integer at
or above 1, where 1 is off; k is read from the entries' parents, so the map
is not passed. The order per
paper gains a fifth step after the floor:

5. **the shared rule** removes a hop-1 paper whose seed links are below
   `min(shared, S)`, where S is the seed count. Inert while S < 2. Seeds,
   hop ≥ 2 papers and folder-admitted library papers the hop rule did not
   bring are untouched by it: the rule reads a fact about a paper's place in
   the hops, not about the paper.

`GraphScopeResult` gains `belowSharedCount`: papers step 5 removed, so a
paper already under the floor is not counted twice. The hop rule reads
parent visibility, so a removed hop-1 paper takes its hop-2 children unless
another parent or a folder admits them, and the fill, which expands shown
papers, does not follow them. No new fill code, as with the floor.

A hop-1 paper that a ticked folder admits is removed by the rule like any
other hop-1 paper: its hop decides, not how it was admitted. (ADR 0004
protects it from the hop rule's parent check, which this is not.)

CONTEXT.md's Scope entry becomes "the folder rule, the hop rule, the floor
and the shared rule taken together, followed by the reader's filters", and
a **Shared rule** entry joins What is shown: "The seed links a hop-1 paper
needs to be shown, set in the rail; 1 is off. Inert with fewer than two
seeds." _Avoid_: Only, shared filter.

### The colouring

`GraphNodeColorMetric` gains `"seed-links"`, labelled **Seeds linked**. It is
categorical (`nodeCategory` in `graphCategoryAssignment.ts`), reading the
marks' map: key `links:k`, label by direction and S, as below; a paper with
no entry has no category and takes the no-value colour. Seeds keep their
bullseye in their own colour, as under every colouring.

Tier colours come from the theme's existing sequential ramp, `theme.ramp`,
of five stops. Tier k of S takes stop `round((k − 1) / (S − 1) × 4)`, so
k = S is always the strongest and k = 1 the faintest; colours are held by key
in the existing ledger, never dealt by rank. No new ramp is added to
`graphTheme.ts`, which stays the only home of colour literals.

The option is available while the graph has two or more seeds, toggled where
Citation hop's availability is toggled today (`graphViewService.ts`),
including its guard for a saved graph that restores with the colouring chosen
before its seeds land. Removing a seed below two disables the option, which
knocks a graph using it back to Uniform, as it does for Citation hop.

### The Key

Under Seeds linked, the Key's colour section lists one entry per tier present
among shown papers, highest first:

- Citers: `Cite all {S} seeds`, `Cite {k} of {S} seeds`, `Cite 1 seed`.
- References: `Cited by all {S} seeds`, `Cited by {k} of {S} seeds`,
  `Cited by 1 seed`.

each with its count and a predicate, so hovering or pinning an entry
emphasises that tier through the Key's existing emphasis path. Then the
colouring's no-value entry, `Not graded`, with its count, when any shown paper
has no seed links. The note line always reads, under the colouring:
`Only hop 1 is graded, by the links fetched.`

### Edges

While the colouring is Seeds linked, an edge whose endpoints are a paper with
k ≥ 2 and a seed is drawn in that seed's colour, at a higher alpha and width
than an ordinary edge, drawn after ordinary edges and before hover and
selection lighting. Values follow the design (alpha .85, 1.2 CSS px, scaled by
the ratio); the decision is a pure function in `graphEdgeStyle.ts`.

### Labels

`drawRendererLabels` (`graphRendererScene.ts`) orders candidates selected,
hovered, then, under Seeds linked only, seeds before everything and hop-1
papers by k descending, then citations as today. The budget is unchanged.

### The rail row

In Scope, after the floor row, shown while S ≥ 2: `Shared by ≥ [N] seeds`,
a number field 1 to S, reading `off` at 1 and `{n} below` otherwise from
`belowSharedCount`. Built in `buildScopeRailModel`, as the floor's row is.

### Persistence and views

`GRAPH_VIEW_STATE_VERSION` becomes 7 and the state gains `shared: number`;
a version 6 record parses with 1. A stored value that is not a finite number
at or above 1 reads 1.

`GraphView.explore` gains optional `shared`, carried like `floor`: a view
with it applies it, a view without leaves the live value alone, and
"(edited)" compares it when the view carries it. The tutorial chips gain
`shared ≥ N`.

**Who cites whom** becomes ready: appearance with `nodeColorMetric:
"seed-links"`, `explore: { direction: "cited-by", hops: 1, shared: 2 }`,
`requires: "two-seeds"`. Its paragraph is rewritten to say bridges are
coloured, not "drawn darker". The `"shared-citers"` need and its line have
no user left and are deleted, as `"citation-hops"`'s were.

ADR 0017 records: the shared-citer grade is a colouring, and Only is a scope
rule after the floor.

## Files

- `src/services/graphHopModel.ts`: `SeedMarks.seedLinks`, computed in
  `seedMarks`.
- `src/services/graphScopeModel.ts`: `shared`, step 5,
  `belowSharedCount`.
- `src/domain/graphTypes.ts`, `graphCategoryAssignment.ts`,
  `graphKeyModel.ts`, `graphViewControls.ts`, `graphLayoutAvailability.ts`,
  `dataSourceTooltipService.ts`: the `seed-links` metric wherever
  `citation-hop` is handled.
- `src/services/graphEdgeStyle.ts`, `graphRendererScene.ts`: seed-coloured
  edges and the label order.
- `src/services/graphScopeRailModel.ts`, `graphKeyRail.ts`: the row.
- `src/services/graphViewState.ts`, `graphViews.ts`, `graphViewService.ts`:
  version 7, `explore.shared`, Who cites whom, availability.
- `CONTEXT.md`, `docs/adr/0017-*.md`.

## Testing

Unit (`test/unit`):

- `seedMarks`: k from parents, under both directions; a hop-2 paper and a
  seed have no entry.
- `computeGraphScope`: N = 2 removes a k = 1 hop-1 paper and its only-parent
  hop-2 child; a second shown parent keeps the child; a folder-admitted hop-1
  paper is removed; seeds and hop-2 papers are untouched; S = 1 makes it
  inert; N > S reads as S; `belowSharedCount` excludes papers under the
  floor; N = 1 removes nothing.
- `nodeCategory` and the ramp stop for k of S at S = 2, 3 and 8.
- `buildKeyModel`: tier labels in both directions, highest first, the
  `Not graded` entry, the note.
- The edge style function and the label order.
- `graphViewState`: version 7 round-trips `shared`; version 6 parses with 1.
- `graphViews`: `explore.shared` decodes and encodes; Who cites whom is ready
  and carries 2.

Zotero (`test/zotero/graphCitationHops.test.ts`, a block on the fake-provider
harness, not live providers, per B74): two seeds, three citers, one citing
both. Choose Seeds linked: the Key lists `Cite all 2 seeds · 1` and
`Cite 1 seed · 2`. Set the row to 2: hop 1 reads `1/3`, the row `2 below`.

## Manual verification

- Two seeds with a shared citer, both themes: Seeds linked colours the top
  tier strongest, the tiers read apart, the shared citer's edges to its seeds
  take the seeds' colours, and its label is drawn.
- Hover a Key tier: that tier is emphasised; the `Not graded` entry does
  nothing.
- Set `Shared by ≥ 2`: hop counts drop, `n below` reads, and the fill's
  `n left` drops.
- Remove a seed down to one: the row and the colouring go, the colouring falls
  back to Uniform.
- Apply Who cites whom on a two-seed graph: colouring, hop 1 and `≥ 2` set.
- Reopen a saved graph with the rule set: it is back; one saved before opens
  at `off`.
