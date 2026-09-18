# The Citation Floor

Brainstormed 2026-09-18. The first half of Stage 4; shared citers follow in
their own spec. The design is option 6a in
`docs/design_handoff_citation_chain_depth/README.md` (Citation floor); the
scope order it joins is `src/services/graphScopeModel.ts` (Stage 3, ADR 0004)
and the fill it steers is the one D8 settled (ADR 0015).

## Problem

A seeded graph filled to hop 3 holds thousands of papers, most cited a
handful of times, and the fill pays a request for every one of them. Nothing
lets the reader say "follow only what the field has noticed". The design's
answer is a citation floor: a line on the plot, dragged, under which papers
are not shown; it also decides what the fill follows, which makes hop 3
affordable, and it composes with D8's cut (top 50 per paper, most cited
first) into one plain statement of what the plot holds.

## Decisions

| question                       | decision                                                                                                                                                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stage 4's cut                  | **Two specs, floor first.** Shared citers grade hop-1 papers by their parents and are independent of this. The presets Full, Balanced and Core are decided separately, not here.                                             |
| A paper below the floor        | **Hidden and counted**, never drawn as an outline. No third node state; the dashed ghost outline keeps its one meaning.                                                                                                      |
| The floor and the fill         | **The fill stops at the floor.** It follows from the fill expanding shown papers; no new rule. The floor is the reader's cost lever.                                                                                         |
| A paper with no citation count | **Passes.** The floor hides only what is known to be below it. The Filter popover's data-quality switch hides Unknowns when wanted.                                                                                          |
| What the floor is on           | **Citations, always.** The line draws on whichever axis shows citations, Y or X, and on neither when neither does; the rail row is then the only control.                                                                    |
| Where the row sits             | **Scope, after the hops block.** The floor decides what the fill follows, so it is a scope rule; CONTEXT.md's Scope entry widens to say so.                                                                                  |
| Where the value lives          | **Inside `computeGraphScope`**, as the last step of the order, with `belowFloorCount` in its result. Not a facet (a facet cannot be counted by the rail) and not a renderer overlay (the renderer never decides visibility). |
| Out of scope                   | Shared citers and the Key's tiers; the presets; the opacity ramp (D10); the plot's per-landing rebuild (B47) and its axis rescale (B18); D13's edge density; a floor on any other metric.                                    |

## Design

### The rule

`ScopePaper` gains `citationCount: number | null`; `GraphScopeInput` gains
`floor: number`, an integer at or above 0, where 0 is off. The order per
paper, unchanged up to the last step:

1. a seed is shown, always;
2. otherwise the paper is admitted by the folder rule or the hop rule, or it
   is not shown;
3. the external switch, the hidden keys and the facets can each remove it;
4. **the floor** removes it when its `citationCount` is a number below
   `floor`. A null count passes.

`GraphScopeResult` gains `belowFloorCount`: papers step 4 removed. Since the
hop rule reads a parent's visibility and papers are walked in hop order, a
parent under the floor takes its hop-children with it unless another parent
or a ticked folder admits them; since the fill expands shown papers, none of
them is expanded. A folder-admitted library paper under the floor is hidden
like any other, as a facet hides one today (ADR 0004 protects it from the
hop rule, not from the reader's filters).

`CONTEXT.md`: Scope becomes "the folder rule, the hop rule and the floor
taken together, followed by the reader's filters", and a **Floor** entry
joins the vocabulary: "The citation count a paper needs to be shown. A paper
under it is not shown and is not followed by the fill; one with no count
passes. Seeds are never under it." Avoid: threshold, cutoff, min citations.

### The line and the drag

When `layout.yMetric` or `layout.xMetric` is `citations`, the renderer draws
the floor on that axis: a dashed hairline across the plot at the floor's
position (horizontal on Y, vertical on X), a faint band over the hidden side,
and a handle tag at the line's left end on Y or bottom end on X reading
`⇕ floor: ≥ 20 citations · 143 below`, or `⇕ floor: off` at 0. Line, band
and tag take two new `states.floor` tokens per scheme in `graphTheme.ts`
(line and band); the rail's CSS accent stays CSS. Measures in CSS px scaled by
the ratio, as the No-data lane's separator is.

`floorLinePlacement(xScale, yScale, floor)` is a pure function: which axis,
and the world coordinate of the line, clamped to the plot edge when the floor
is under the domain (a log axis whose domain starts at 1 still shows the
`off` line on the bottom edge) or over it; null when neither axis is
citations. It is the one place that knows the plot box.

Drag: on pointerdown, after the node hit-test finds nothing, a pointer within
5 CSS px of the line grabs it: the pointer is captured, the cursor reads
`ns-resize` or `ew-resize`, and no pan starts. Each move converts the
pointer's plot coordinate through `inverseScaleValue` and `roundFloor`, and
reports the value through `onFloorChange(value)` when it changed; pointerup
or pointercancel ends the drag and reports `onFloorDragEnd()`. Hovering the
line shows the resize cursor.

`roundFloor(value)` is pure: the nearest integer under 20, the nearest
multiple of 5 to 100, of 10 to 1,000, of 100 above; never below 0.

The view service applies every `onFloorChange` at once — scope, rail counts,
the plot — since the scope function is cheap, and re-plans the fill on
`onFloorDragEnd` only, so a sweep does not queue a plan per pixel. The rail
field's commit re-plans at once.

The tag's rectangle is inserted into the label budget's obstacle index before
any label is placed, so no label sits under it. That is the whole of the
label routing.

A selected paper under the floor stays rendered ghosted, as any filtered-out
selection does today (`graphVisibility.ts`).

### The rail row

In Scope, after the hops block's cut line (or after the Not in Zotero row on
a seedless graph, which has no hops block): one row, label `Citation floor`,
a number field reading the floor, and muted text `143 below` — `off` when the
floor is 0. The field commits on Enter or blur, clamps to an integer at or
above 0, and is the only control when no axis shows citations. Model side:
`ScopeRailModel` gains `floor: ScopeFloorRow` with `value` and `belowCount`;
`ScopeRailHandlers` gains `setFloor(value)`. The Key does not change.

### Persistence and views

- `GraphViewState` gains `floor: number`, default 0, and goes to version 6; a
  version-5 record parses with floor 0 (the existing empty-default pattern).
- `GraphViewExplore` gains `floor?: number`. A view whose `explore` carries a
  floor applies it; one without leaves the floor as it is, as `enabled[]`
  does not travel. `captureGraphView` records the live floor, and the Save
  current as view panel lists it with the direction and depth.
- Cornerstones: `explore: { direction: "references", hops: 2, floor: 10 }`,
  summary "Seeds, 2 hops of references, floor 10, colour citations. What the
  field rests on." The view's card footnote already says a view with an
  `explore` causes traffic; the floor lowers it.

## Files

- `src/services/graphScopeModel.ts`: `citationCount` on `ScopePaper`,
  `floor` on the input, step 4, `belowFloorCount`.
- `src/services/graphFloor.ts` (new, pure): `roundFloor`,
  `floorLinePlacement`, the tag's text.
- `src/services/graphTheme.ts`: `states.floor` (line, band), both schemes.
- `src/services/citationGraphRenderer.ts`: `setFloor`, the line, band and
  tag after the backdrop and before the regions, the drag in the pointer
  handlers, `onFloorChange` and `onFloorDragEnd` on its options.
- `src/services/graphRendererScene.ts`: the tag's rectangle as a label
  obstacle.
- `src/services/graphScopeRailModel.ts` and `graphKeyRail.ts`: the row, its
  field and handler; `addon/content/graph.css`: the row's styles.
- `src/services/graphViewService.ts`: `floor` in the state, fed to the scope
  input, the renderer and the rail; the drag-end re-plan.
- `src/services/graphViewState.ts`: version 6. `src/services/graphViews.ts`:
  `explore.floor`, Cornerstones, the summary and the save panel's line.
- `CONTEXT.md`: Scope widened, Floor added. An ADR: the floor is a scope rule
  and the fill stops at it.

## Testing

Unit (`test/unit`):

- `computeGraphScope`: a below-floor parent hides its hop-child; a second
  visible parent keeps the child; a folder-admitted library paper under the
  floor is hidden; a seed under the floor is shown; a null count passes;
  `belowFloorCount` counts exactly step 4's removals; floor 0 removes nothing.
- `roundFloor` at each band's edges and below 0.
- `floorLinePlacement`: Y linear, Y log with a domain starting above the
  floor, X citations, neither axis, the clamps at both edges.
- `buildScopeRailModel`: the row's value and text, `off` at 0, present on a
  seedless graph.
- `graphViewState`: a version-6 record round-trips `floor`; a version-5
  record parses with 0.
- `graphViews`: `explore.floor` decodes and encodes; Cornerstones carries 10;
  a view without it leaves the live floor alone.
- The renderer doubles: `setFloor` draws the line only when an axis shows
  citations; a drag sequence reports rounded values and one drag end; a
  pointerdown on a node near the line drags the node, not the floor.
- The label scene: no label rectangle overlaps the tag's.

Zotero (`test/zotero/graphScopeRail.test.ts`), one case on a seeded graph
with stubbed providers in B72's style: drag the handle with synthetic pointer
events in whole CSS pixels (B43); the rail field and `below` text move, hop
1's shown count drops, and the fill's `n left` is lower after release than
it read while the fill was running before the drag (the case proves the fill
ran first). Type a value in the field: the line moves. Switch Y to year: the
line goes, the row and the counts stay.

## Manual verification

- On both themes, drag the floor on a filled seeded graph: the line, band and
  tag follow the pointer in steps, hop counts and `n below` move, the fill's
  `n left` drops after release, and no label sits under the tag.
- Put citations on X: the line is vertical, the tag at its bottom, the cursor
  `ew-resize`. Put citations on neither axis: no line; the rail field still
  sets the floor.
- On a log Y: the `off` line sits on the axis and the first drag step reads a
  round number.
- Apply Cornerstones on a seeded graph: the floor reads 10 in the rail and
  the summary; apply Overview afterwards: the floor stays 10.
- Reopen a saved graph that had a floor: the floor is back; a graph saved
  before this change opens at `off`.
