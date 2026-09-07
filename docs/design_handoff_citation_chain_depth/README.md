# Handoff: Merged Graph view — Scope rail, citation chain depth, citation floor, shared citers (Meristema)

## Overview
Redesign of the single merged Graph view of the Meristema Zotero plugin. Final design is **option 6a** in `Citation Chain Depth.dc.html` (turn 6, top of the canvas). Earlier turns (1–5) are the exploration trail; consult them only for rationale.

What 6a adds or changes:
1. **Left rail = Scope + Key.** The Zotero-style left sidebar (existing `graphKeyRail.ts`) gains a Scope section above Key. Scope holds Seeds, Collections, Citation hops, Citation floor and Shared-citers mode. Key holds the shared-citer tiers (emphasis only).
2. **Citation chain depth** — forward citations of the seeds (hop 1), their citers (hop 2), … up to 6 hops, fetched on demand per hop.
3. **Citation floor** — hide papers below N citations, controlled by dragging a dashed line on the plot.
4. **Shared citers** — hop-1 papers graded by how many seeds they cite (opacity), with Off / Dim / Only modes.
5. **Seeds managed in the rail** — hover to emphasise, × to remove, + Add seed, and "Make seed" on any pinned paper.
6. **Toolbar reduced** to Filter · Similar · Export · Refresh · search. Removed: "Explore" identity/title, history arrows, Explore settings button, Add Node, Seeds popover. No separate Explore view remains.
7. **Collections filter** moves from the Filter popover into Scope as a checkbox tree; the toolbar Filter keeps tags, item type and data-quality.

Target repo: `daniel-locatelli/meristema-zotero`, branch `main`. Relevant code: `src/services/graphViewService.ts` (toolbar, identity, filter wiring), `src/services/graphKeyRail.ts` + `graphKeyModel.ts` (rail), `src/services/graphFocusService.ts` (seed/focus projection), `src/services/graphTheme.ts` (all colours), `src/services/graphEdgeStyle.ts`, `src/services/citationGraphRenderer.ts` (canvas), `src/services/graphLabelBudget.ts`, `addon/content/graph.css`.

## About the Design Files
`Citation Chain Depth.dc.html` is a **design reference in HTML with synthetic data**, not production code. Recreate behaviour and look in the plugin's environment (TypeScript services + canvas renderer + `graph.css`), following repo rules: colour literals only in `graphTheme.ts`; CSS-px measures scaled by device pixel ratio; pure decision functions outside the render loop with unit tests in `test/unit`.

Open the file in a browser; section `#6a` is the deliverable and is fully interactive (drag floor, tick rows, fetch hop, hover, pin, make seed). `#5a` is the previous rail iteration, `#2a` the on-plot variant, `#2b` the worst-case density scene.

## Fidelity
High-fidelity for rail structure, control behaviour, node/edge encoding and copy. Colours/type below are the dark-theme tokens; use light equivalents from `graphTheme.ts` when the scheme is light. Plot dataset and positions are synthetic; keep the real renderer and axis system.

## Layout (6a, prototype 1384 × 641; production fluid)

**Top bar, 41px, three cells aligned with the columns below:**
- Rail cell (220px, collapsible to 28px): logo ring (14px, 2px `#96bf54`), identity text 11px muted `"{nodes} nodes - {links} links"` (`cm-command-identity`), collapse chevron 26×26 at the right edge. No title.
- Plot toolbar (12px text, 4px 9px chips, 1px `#35352f` border, radius 5): **Filter** (icon + label) · **Similar** · **Export** · **Refresh** · search field pushed right (max 220px, muted placeholder "Search all fields").
- Detail-pane cell (264px): pane toggle chevron at the inner edge, then tabs Overview (active: `#2b2b27` bg) · References · Cited by.

**Body:** rail 220px | plot flexible (900px in prototype) | detail pane 264px. Rail background `#1c1c1a`, plot `#232320`, hairlines `#35352f`.

### Rail (12px body, 11px secondary, 10px/600 uppercase section labels with .09em tracking)
Padding 6px 8px 10px, scrolls vertically; footer pinned at bottom with zoom −/+/fit and settings gear (26×26 bordered buttons).

**SCOPE**
- Count line: `{shown} of {total} papers`.
- Presets segmented (Full | Balanced | Core), 11px, radius 5; active cell `#35352f` bg + primary ink; none active in custom state.
- **Seeds · {n}** header with `+ Add seed` link (accent, right-aligned). One row per seed: bullseye swatch (6px dot, 1.5px gap, 3px ring in seed colour), label `Author (year)` ellipsised, `×` at right (muted). Hover row: `rgba(232,233,227,.08)` bg and the seed lights up on the plot.
- **Collections**: rows from the Zotero collection tree, indented 14px per level (`indentedCollectionLabel`), folder glyph, label, count (11px tabular), 12px checkbox (radius 3, 1px muted border, `#96bf54` fill when on). Last row **Not in Zotero** (dashed circle glyph) with count of external papers.
- **Citation hops**: rows Seeds, Hop 1 … Hop 6. 13px swatch in hop colour; label; `{shown}/{available}` or `not fetched`; checkbox. Row opacity .45 when off/unfetched/beyond depth. First unfetched hop shows a **Fetch hop N** button row (bordered, `≈ {estimate} papers` right); while loading it becomes `Querying providers · {pct}%` + 3px progress bar.
- **Citation floor** row: dashed accent glyph, label, `≥ {N} · {hidden} below` (read-only; the control is the plot line).
- **Shared citers** row: label + small segmented Off | Dim | Only.

**KEY** (emphasis only, never filters)
- `Shared citers · {n} at hop 1`, then one row per tier present, highest first: swatch = hop-1 green at that tier's opacity; label `Cite all {S} seeds` / `Cite {k} of {S} seeds` / `Cite 1 seed`; count. Hovering a tier row emphasises that tier on the plot (others dim to .12).
- Note line (11px muted): "Full opacity goes to papers citing every seed. Grading is computed after the floor." or, when no paper cites all seeds, "No visible paper cites all {S} seeds; full opacity goes to the {k}-of-{S} tier."; with mode Off: "Hop opacity follows depth only."

### Plot
- Axes as today (X publication year, Y citations log in the prototype); ticks 10px muted, axis titles 11px/600.
- **Floor line**: dashed `#96bf54` 1.2px, dash 4 4, full plot width at `y = Y(floor)`. Below it a `#141412` band at .45 alpha. Handle 8px below the line at the left: tag `⇕ floor: ≥ {N} citations` (`#1c1c1a` bg, 1px accent border, radius 4, 3px 8px, 10.5px) + muted `{hidden} papers below, drawn as outlines`. Cursor ns-resize; drag anywhere vertically with pointer capture.
- Papers below the floor (parent visible) are outlines: no fill, `#9a9c93` stroke at .22, 0.8px. Their downstream chains are not drawn.
- **Tooltip** on hover/pin at node + (14, −10) clamped: `#1c1c1a`, 1px `#35352f`, radius 6, 8px 10px, shadow `0 8px 24px rgba(0,0,0,.45)`. Lines: `Author (year)` 600; `{cites} citations · hop {d}` (+ ` · cites {k} of {S} seeds` on hop 1) muted; `{n} papers in this chain` accent. When pinned, a **Make seed** button (bordered, full width, hover border accent).

## Encoding rules
- Hop colour = ramp, seed brightest: hop0 `#e0c64a`, 1 `#96bf54`, 2 `#4f9a5e`, 3 `#1e6b52`, 4 `#0f3b33`, 5 `#0b2e28`, 6 `#082420` (0–4 exist in `graphTheme.ts`; add 5–6 or clamp to ramp[4]).
- Hop opacity (fill + label) when Shared citers = Off: `[1, .9, .8, .7, .6, .5, .4]`.
- **Seeds**: per-seed colour from a categorical set `#e0c64a #ab8efe #07bcbd #fe6d8a #0066af #a44c00 #039f6c #ae8f06`; drawn as a bullseye: fill, 2.5px gap stroke in plot background, outer ring 2.5px at R+6. Seeds are painted **dimmed by colour, not alpha**: `color-mix(in oklab, seedColor 60%, paperBg)` for fill and ring (opaque, so edges never show through). Label opacity .7. Hover (plot or rail row) restores full seed colour and lights all edges into that seed in its colour at .9 / 1.4px.
- **Shared-citer grading** (mode Dim/Only), hop 1 only: k = number of seeds cited (parents that are seeds); kmax = highest k among *visible* hop-1 papers (after floor, collections, hop toggles). Opacity `= kmax<=1 ? 1 : 0.15 + 0.85·((k−1)/(kmax−1))^1.4`. Hop ≥ 2 papers sit at `hopOpacity × .35`. Seeds always 1 (before colour dimming). Shared citers get no ring or halo; only opacity and their edge colours distinguish them.
- Edges run citer → cited. Default colour = ramp of the cited hop, alpha `.45 × citer opacity`, 0.8px. Edge from a hop-1 paper with k ≥ 2 to a seed: that seed's colour, alpha `.85 × opacity`, 1.2px. Draw order: plain → shared → seed-hover → chain-highlight.
- Radius `2.2 + 0.55·√citations` in the prototype; production keeps its size metric.
- Labels: seeds always (offset R+12, flip left if it would cross another seed's ring); hop-1 papers in the top two tiers, capped at 18 total; suppress within ±18px of the floor line on the left 460px and under any overlay. Route through `graphLabelBudget.ts`.

## Interactions
- **Hover paper**: its chain (ancestors to seeds + visible descendants, multi-parent aware) keeps opacity (min .6); others → fill .12, labels .15; chain edges `#96bf54` .95 / 1.5px; other edges .05; hovered node 2.5px white stroke. Tooltip shows. Leaving the plot clears hover.
- **Click paper**: pins the chain (persistent); click again releases. Pin overrides hover. Pinned tooltip shows **Make seed**.
- **Make seed**: promotes the paper to depth 0 with the next seed colour, adds a Seeds row, recomputes hops/k for everything, clears selection.
- **Seed row ×**: removes the seed (a promoted seed reverts to its original hop).
- **Hop row click**: toggles `enabled[d]`; disabling hides that hop and everything downstream; raises `depth` to ≥ d; preset → custom. Seeds row not toggleable.
- **Fetch hop N**: queries providers for citers of visible hop N−1 papers, progress row, then `loaded = depth = N`, enabled. Cancelable in production.
- **Collections**: unchecking hides papers in that collection (a paper in several collections stays while any is checked). "Not in Zotero" unchecked hides all external papers. Applies before the floor, so counts and grading follow.
- **Floor drag**: `minCitations = invert(Y)` clamped to axis; preset → custom.
- **Presets**: Full → floor 0, depth = loaded, all hops on. Balanced → floor 10, depth = loaded. Core → floor 50, depth = min(2, loaded). All presets re-enable hops; never touch collections or shared-citer mode.
- **Shared citers**: Off = depth opacity only; Dim = grading; Only = also hides hop-1 papers with k < 2 (and their chains).
- Order of evaluation, per node (pure function, unit-test): `depth ≤ chainDepth` → `enabled[depth]` → parent visible → collection filter → floor (→ outline if below) → Only-mode filter → visible. Seeds always visible.

## State
```ts
// persist with the view
seeds: ItemKey[]; chainDepth: 1..6; loadedDepth: number; hopEnabled: boolean[];
minCitations: number; preset: "full"|"balanced"|"core"|"custom";
sharedMode: "off"|"dim"|"only"; collectionsOff: CollectionID[]; includeExternal: boolean;
railCollapsed: boolean;
// view-local
hoverKey, pinnedKey, hoverSeed, hoverTier, draggingFloor, loading: {hop, progress} | null
```
Data: hop k+1 = union of `citedBy` over visible hop-k papers via the existing provider pipeline, cached, fetched per hop on demand (200–2k nodes at hops 2–3). Keep full parent lists per node (multi-parent) for k, chains and downstream hiding.

## Tokens (dark theme, graphTheme.ts)
Surfaces: panel `#1c1c1a`, paper `#232320`, hairline `#35352f`, grid `#2b2b27`, page `#141412`. Inks: primary `#e8e9e3`, muted `#9a9c93`, emphasis `#ffffff`. Accent `#96bf54`, tint `rgba(150,191,84,.12)`, row hover `rgba(232,233,227,.08)`. Type: system UI; 12 rail body, 11 secondary, 10 uppercase section labels, 10.5 plot labels, 10 ticks; tabular numerals on counts. Radii 3 (checkbox) 4 (rows, tag) 5 (chips, buttons, segmented) 6 (tooltip). Shadow `0 8px 24px rgba(0,0,0,.45)`.

## Files
- `Citation Chain Depth.dc.html` + `support.js` — prototype; open `#6a`.
- `reference/FocusView.png`, `reference/OrderedGraph.png` — current plugin screenshots.
- `reference/graph.css` — current rail/toolbar stylesheet to extend.
