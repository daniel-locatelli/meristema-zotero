# Graph Views: Five Named Ways to Look at the Same Graph

**Date:** 2026-09-12
**Status:** Approved in conversation 2026-09-12; revised the same day after an
adversarial review (18 findings, folded in below); awaiting the user's read

Backlog entry D4 ("graph templates"). The design is section F of the Claude
Design project "Zotero Citation Network Plugin", handoff package
`design_handoff_feature_artboards`, boards 3a to 3c. The package is not yet in
the repo; the user downloads it when back at the machine and drops it beside
`docs/design_handoff_citation_chain_depth/`. Until then the source of truth is
the README's section F, read verbatim on 2026-09-12, and board 3a as seen on
screen. The design calls templates **views**; so does this spec and the code.

## Problem

The user's own words from the Stage 2 walk-through: "There are multiple ways to
visualize the same graph. I like the flexibility, but it may be hard for users
that are just getting started." Today a reader builds a view out of the gear
panel (two axes, two scales, size, colour, labels), the Filter popover and the
rail's folder selection, one control at a time, with no name for what they end
up with and no way to get back to it.

## What the design decided

- A **view** is a named bundle of appearance, regions, filters and the Stage 3
  and 4 controls (hops, floor, shared citers). It **never changes Scope**: seeds
  and collections are the reader's, a view only says how to look at them.
- Entry is a **View chip** in the plot toolbar with a dropdown, and a
  **gallery** in the plot inset when a graph opens with no view chosen.
- **Five ship:** Overview, Cornerstones, Reading plan, Who cites whom, Folder
  map. Each carries a one-paragraph **tutorial card** that names the settings
  it applied and what it did not touch.
- Readers **save their own** views with a name and an explanation, edit them,
  and share them as **JSON** stored in the Zotero profile.

## Decisions taken in the brainstorm (2026-09-12)

| question | decision |
| --- | --- |
| Three of the five views depend on Stage 3, Stage 4 and the unbuilt reading state | **All five ship now.** The three that cannot apply are greyed with an "Arrives with…" note |
| Board 3a puts the chip in the first toolbar slot; B21 decided File leads | **After File, before Filter.** B21 stands |
| Gallery cards carry live thumbnails on the boards | **A static drawn icon per view**, reused in the dropdown |
| A view is a patch, a mode, or graph-only storage | **A patch applied once** (approach A below) |

## Approaches considered

**A. A view is a patch applied once (chosen).** Applying writes appearance,
regions and filters through the setters that exist; the saved graph records
only which view is active. Afterwards the gear, the Filter popover and the
rail work exactly as today. The chip reads "(edited)" when the live settings no
longer equal the view's bundle, decided by comparison, not tracked. This is
board 3a and it adds no state machine.

**B. A view is a mode.** While active it owns its settings and the gear's
matching controls lock. Contradicts the "(edited)" state the design chose and
makes the gear behave two ways.

**C. Views live only inside saved graphs.** No profile store. But "My views",
import and export all need a store the graph does not provide.

## The model

### A view definition

Plain data, serialisable, in `src/services/graphViews.ts`:

```ts
interface GraphViewDefinition {
  id: string;            // "overview", or "user:<uuid>" for a saved view
  name: string;
  summary: string;       // one line, shown under the name in the dropdown
  paragraph: string;     // the tutorial card, in the reader's terms
  icon: GraphViewIcon;   // a drawn glyph name, see uiIconService
  appearance: GraphLayoutOptions;            // all seven fields, always
  regions: string[] | "ticked" | null;       // folder names, every ticked folder, or leave alone
  filters: GraphViewFilters | null;          // PaperListFilterState minus collectionIDs and relation
  explore: null;         // reserved: { hops, floor, sharedCiters } from Stage 3/4
  requires: "none" | "seed" | "two-seeds";   // display only today: the dropdown's muted note
  availability: "ready" | { needs: "citation-hops" | "shared-citers" | "reading-state" };
}
```

`appearance` is the **full** seven-field record, scales and label mode
included, although the design lists four fields. A shipped view fills the
other three with the defaults from `citationPreferences.ts`; a saved view
captures all seven. Applying is then deterministic, and "(edited)" is a plain
field-by-field comparison.

`regions` are **folder names**, not collection IDs, or the marker `"ticked"`.
Names, not IDs, so a view survives a library the ids are not from and so the
JSON reads. They resolve at apply time against the library's collection tree,
top-level and nested alike, by exact name. A name matching nothing is skipped
and named on the tutorial card ("Not found: Gridshells"). A name matching a
folder whose tick is off is also skipped and named ("Not shown: Gridshells is
unticked"): the rail's rule is that a region is a ticked folder
(`selectRow` ticks first, and unticking drops the region), and a view reads
ticks but never writes them. Ambiguous names resolve to every match, and the
card says how many ("Gridshells: 2 folders"). The design's cap of four is not
applied: F14 uncapped regions on 2026-09-11 and a view follows the rail.

`"ticked"` is what Folder map uses and is never on the wire (the decoder
rejects it; a saved view captures names). It means the **top of each ticked
subtree**: every folder whose tick is on or mixed and that has no ticked
ancestor, in tree order. Not every ticked folder: a library graph starts with
every folder ticked, ticks cascade to descendants, and a parent and its
children as separate hulls is noise. When the tops still outnumber the twelve
categorical swatches, the ledger doubles up as it does today and the card says
so ("14 regions, 12 colours").

`filters` on a view is `PaperListFilterState` **without** `collectionIDs`
(that is Scope, and the graph already zeroes it in both directions) and
without `relation` (relative to the selected paper, meaningless in a view).
The decoder rejects both keys by name.

`requires` is display data only today: both views that need seeds are also
unavailable, so nothing acts on it. It stays because the dropdown row shows it
and Stage 3 will act on it.

`explore` is null in every view until Stage 3 lands. The field exists so the
JSON schema does not change when it does. The Explore section behind the gear
today (direction, locality) is not part of a view: it means nothing without a
seed and the design does not list it.

### The five shipped views

| id | name | summary | appearance | regions | filters | requires | availability |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `overview` | Overview | Year × citations, uniform fill. Where things are. | x year linear, y citations linear, size citations, colour uniform, labels author-year | null | null | none | ready |
| `cornerstones` | Cornerstones | Seeds, 2 citation hops, floor ≥ 5, colour citations. What the field rests on. | x year, y citations, size citations, colour citations, labels author-year | null | null | seed | needs citation-hops |
| `reading-plan` | Reading plan | Unread frontier, shape = read state. What to read next. | x year, y citations, size citations, colour citations, labels author-year | null | null | none | needs reading-state |
| `who-cites-whom` | Who cites whom | Shared citers graded, 1 hop. Bridges between your seeds. | x year, y citations, size citations, colour uniform, labels author-year | null | null | two-seeds | needs shared-citers |
| `folder-map` | Folder map | Free layout, folder regions. How your collections overlap. | x free, y free, size references, colour uniform, labels author-year | `"ticked"` | null | none | ready |

Summaries are the board 3a one-liners. Paragraphs: Reading plan's is on board
3a and is carried verbatim; the other four are drafted in the plan and marked
`// draft: reconcile with boards 3a/3b` until the handoff package is in the
repo. When Stage 3 lands, `cornerstones` gains `explore: { hops: 2, floor: 5 }`
and `availability: "ready"`; the same for the others with their stages. The
availability line is derived from `needs`: "Arrives with citation hops",
"Arrives with shared citers", "Arrives with reading state".

### User views

One profile preference, `graphViews`, holding a JSON array of wire-form
views (below), each with an `id` starting `user:`. The `meristemaView` field on
each record is the schema version; there is no separate version preference
(`updateLibraryIDs` in `citationPreferences.ts` is the parse-or-fallback
precedent). A value that fails to parse is treated as empty and rewritten on
the next save, never thrown. A second preference,
`graphViewTutorialsDismissed`, holds the ids whose card the reader closed with
"Don't show for this view again"; deleting a view removes its id.

A **saved view always owns regions and filters**: it captures `[]` when the
graph has no regions and the full filter record even at defaults, so applying
it restores the snapshot and any later change reads as "(edited)". `null` in
those two fields is reserved for shipped views that leave them alone.

### The active view, in the graph state

`GraphViewState` goes to **version 4** with one field:

```ts
view: { id: string } | "blank" | null;
```

`null` means never chosen, so the gallery shows. `"blank"` means the reader
chose Start blank. Otherwise it is the id, shipped or `user:`. Version 3
records parse with `view: null`, so every graph saved before this sees the
gallery once; that is the design's rule ("a graph with no saved view state")
and it costs one dismissal per old graph. "(edited)" is not stored: it is
recomputed whenever the chip renders.

**The migration must not touch anything else.** `parseGraphViewState` today
admits only the current version, 2 and 1, and takes the saved `regions` only
at the current version, migrating everything older from the ticks. Bumping the
constant alone would reject or strip every version 3 graph. The gate admits 3
and the regions branch becomes `version >= 3`; a unit test pins that a
version 3 record keeps its regions and all three ledgers.

**The field must be plumbed.** The view controller keeps `view` in a closure
variable; `getState` writes it (that function lists every field by hand and
autosave runs through it, so an unlisted field reverts to null on the next
tick), `applyState` reads it, and the request path that builds the initial
state from a folder or item request leaves it null.

Reopening a saved graph applies nothing. The graph already carries the
regions and filters the view wrote, appearance is the global preference as
today, and the chip only restores its label. If the reader has changed the
appearance since, the chip says "(edited)", which is true. With two graphs in
tabs, a view applied in one changes the global appearance the other will read
on its next open, so the other's chip may gain "(edited)" on reopen; within a
session each instance compares against its own live layout, never the
preference.

### JSON on the wire

```json
{
  "meristemaView": 1,
  "name": "Thesis ch. 2 figure",
  "paragraph": "Year × references, uniform, gridshells region only.",
  "appearance": { "xMetric": "year", "xScale": "linear", "yMetric": "references",
                  "yScale": "linear", "nodeSizeMetric": "citations",
                  "nodeColorMetric": "uniform", "nodeLabelMode": "author-year" },
  "regions": ["Gridshells"],
  "filters": null,
  "explore": null
}
```

`id`, `icon`, `requires` and `availability` are not on the wire: an imported
view gets a fresh `user:` id, the user-view icon, `requires: "none"` and
`availability: "ready"`. Decoding validates every field against the metric and
mode unions in `graphTypes.ts`, rejects `"ticked"`, `collectionIDs` and
`relation`, and names the first failing field. The stored preference uses the
same form plus `id`. The
schema on board 3c is reconciled with this one when the package is in the
repo; field names here follow the code's, which the board also uses.

## The surfaces

### Toolbar chip and dropdown

After File, before Filter. The chip reads `View  Overview ▾`; `View  Overview
(edited) ▾` when the live appearance, regions or filters differ from the
view's bundle on the fields the view owns (a null `regions` or `filters` owns
nothing); `View ▾` alone when the graph's view is null or blank.

The dropdown, top to bottom:

1. The five shipped views, each a row with the icon, name, summary, and in
   muted text at the right either the requirement ("needs a seed", "needs 2
   seeds") or the availability line ("Arrives with citation hops"). A tick on
   the active one. Rows whose availability is not ready are greyed and ignore
   clicks, including the keyboard.
2. A divider, then `MY VIEWS` with each saved view (icon, name, summary, an
   `edit` action at the right). Absent when there are none.
3. A divider, then `Save current as view…`, `Import view JSON…`,
   `Choose a view…` (reopens the gallery).

The dropdown is a sibling of File's menu and uses its family
(`cm-menu-wrapper` and `cm-export-menu`, with the same open and close
handling), not the gear's rail-footer panel: `role="menu"`, closes on Escape,
on a click outside and on choosing.

### Applying a view

In order: hand `appearance` to the gear's own controller
(`appearance.setLayout`, which persists as the gear does and keeps the selects
and the instance's live layout in step; writing the preference directly would
leave both stale); resolve `regions` and replace the state's region list,
allocating swatches through the existing ledger and following `selectRow`'s
sequence (ensure swatches, notify, refresh the rail); merge `filters` into the
state's filter record; set `state.view`; re-render; show the tutorial card.
Scope is untouched: seeds, ticks, unfiled, external and hidden keys are never
written; ticks are read for the region rules above.

**Metrics the graph cannot show.** The gear omits any metric with no data in
the loaded nodes and substitutes the first available one, and forces a scale
to linear where the metric is not logarithmic. A view is normalised by the
same rules before it is applied and before it is compared, through one pure
function extracted from the controls (`normaliseLayoutFor(nodes, layout)`),
so "(edited)" is false right after apply; the tutorial chips name what landed
("y citations" or, substituted, "y year (no citation data)").

**The seeded appearance preference is write-only today.** The gear writes the
focus variant when the graph is seeded, but nothing reads it back: every open
reads the global preference. That is a pre-existing bug, filed as B41; this
feature does not fix it, and its reload test for the chip runs on an unseeded
graph until B41 is done.

A view whose `requires` is unmet is only ever a greyed row today, because both
such views are also unavailable. The design's behaviour, opening Add seed with
the view queued, arrives with them and is written into that stage's spec.

### Tutorial card

Bottom-right of the plot, 300px wide, in the plot's inset layer above the
canvas and below popovers. Title is the view's name; body is its paragraph;
then a row of chips, one per setting applied in the reader's words (`x year`,
`y citations`, `size citations`, `colour uniform`, `labels author-year`,
`regions 3 folders`, `filter open access`); then one last muted line: "Seeds
and collections are untouched", followed by "Not found: Gridshells" when a
region name matched nothing. Buttons: `Got it` closes it for this session;
`Don't show for this view again` also writes the id to the dismissed
preference. Shown on every apply unless dismissed for that id; also shown
after Save, with the reader's own paragraph.

### Gallery

A non-modal overlay in the plot inset, shown when `state.view` is null and
the graph has at least one visible paper (a seedless New Graph already shows
the empty-state overlay, and two overlays is one too many; the gallery comes
up once papers do), reopened by `Choose a view…`. A graph opened from a folder
or from selected items also starts with `view: null` and shows it; Folder map
on a folder graph resolves `"ticked"` to that folder, which is the region the
request already set. Heading "How do you want to look at these N
papers?" with N the visible count; sub-line "Scope stays as it is." Three
columns of cards: icon, name, paragraph, and a last line that is the
requirement, the availability line, or nothing. Cards for unavailable views
are dimmed and inert. A last card holds `Start blank` and `Import view JSON…`.
Picking a card applies the view; Start blank writes `"blank"`. Either records
the choice, so the gallery never returns on its own. The graph behind it stays
live: the overlay does not block the rail or the toolbar, only the plot's
pointer events beneath it.

### Save dialog

An in-page panel like the gear's, not a native prompt (B1 moved simple
prompts to `Services.prompt`; this one has four controls and a checklist).
Fields: `Name` (required, refused with an inline line when it equals a shipped
view's name or an existing saved one's, case-insensitive); `Explain it`, a
textarea pre-filled from the settings in the reader's terms, which becomes the
paragraph; a **Captures** checklist, read-only: Axes, Colour, Size, Labels
ticked, Regions and Filters ticked when the graph has any, Explore listed
unavailable until Stage 3, and `Scope (seeds, collections) — never saved`
permanently unticked and dashed. Footer: "Views are stored in your Zotero
profile." with `Copy JSON`, `Cancel`, `Save`. Save writes the preference, sets
`state.view` to the new id, and shows the tutorial card. `edit` on a saved view
opens the same panel pre-filled with a `Delete` action; deleting a view that is
active sets `state.view` to blank. Copy JSON puts the wire form on the
clipboard through Zotero's clipboard helper.

Regions are captured by **name** from the graph's current region list at save
time; the folder names are looked up then, not at apply.

### Import

`Import view JSON…` opens Zotero's file picker in open mode filtered to
`.json`, through a helper beside `exportService.ts`'s `chooseSavePath`, and
reads the file with `Zotero.File.getContentsAsync`. The picker is injected
(`importGraphView(pickFile)`), since an XPCOM picker built inside the function
cannot be stubbed by the suite. The file is decoded as above; on failure a
native error dialog (`Services.prompt`) names the field. On success the view
is added to MY VIEWS, with " (2)" appended to a name that collides, and
applied at once, tutorial card included. Copy JSON uses
`Zotero.Utilities.Internal.copyTextToClipboard`, which `zotero-types` does not
declare, so it is called through a typed cast in one place.

## What does not change

Appearance stays one global preference (two, with the seeded variant), so two
graphs open in tabs still share it, as today. The gear, the Filter popover and
the rail keep every control. The design's other shell changes (removing
Similar, the abstract label, and so on) belong to their own features and are
not in this spec.

## Errors

- Unparseable `graphViews` preference: empty list, rewritten on next save.
- A region name that matches no folder, at apply or import: skipped, named on
  the tutorial card.
- A saved graph whose `view` id names a deleted user view: the chip reads
  `View ▾` and the dropdown has no tick; nothing is reapplied.
- Import file that is not JSON, or has `meristemaView` other than 1, or a
  field outside its union: refused with the field named; nothing changes.

## Testing

Unit, in `test/unit/`, all pure:

- `applyGraphView(state, layout, view, collections, nodes)` returns the new
  state and layout: appearance normalised and replaced whole, regions resolved
  by name with unmatched, unticked and ambiguous names returned, `"ticked"`
  resolving to subtree tops in tree order, filters merged with
  `collectionIDs` still `[]`, seeds and ticks byte-identical to the input.
- `graphViewIsEdited(state, layout, view, nodes)` is false right after apply,
  including for a view naming a metric the nodes lack, and true after one
  owned field changes; a null `regions` ignores region changes, `[]` does not.
- `encodeGraphView` / `decodeGraphView` round-trip, and every invalid shape
  (wrong version, unknown metric, missing name, regions not strings,
  `"ticked"`, `collectionIDs`, `relation`) fails with the field named.
- `normaliseLayoutFor` reproduces the gear's substitutions.
- `graphViewAvailabilityLine` for each `needs`; the shipped list has five
  entries with unique ids and full appearance records.
- Version 3 state parses with `view: null` **and keeps its regions and its
  three ledgers**; version 4 round-trips each of the three values.

Zotero suite, in `test/zotero/`, through the plugin's own menus:

- Open a graph, pick Overview from the dropdown: the chip reads
  `View  Overview`, `state.view.id` is `overview`, the tutorial card is in the
  document; change the y axis through the gear: the chip gains `(edited)`.
- Open a graph saved at version 3 (inserted as raw JSON through the store's
  connection, since the store always writes the current version): the gallery
  is in the plot inset; Start blank removes it and a reopen shows no gallery.
- Reopen an unseeded graph on Overview: the chip reads `View  Overview` with
  no "(edited)".
- Save current as view with a name: the dropdown lists it under MY VIEWS and
  the preference holds one entry.
- Click the greyed Cornerstones row: `state.view` is unchanged.

Manual batch (appended to the roadmap's list): the toolbar reads File, View,
Filter, Similar, Export, Refresh, which supersedes B21's check of the order; the greyed rows' contrast; the tutorial card's position over a
narrow plot; the gallery over a 300+ paper folder; the dialog's checklist
reading; the icon set.

## Follow-ups this spec creates

- B41: the seeded appearance preference is written by the gear and read by
  nothing, so any gear change on a seeded graph is lost on reopen.
- Stage 3 spec: fill `explore` for Cornerstones and Who cites whom, flip their
  availability, and specify the Add-seed queue for an unmet requirement.
- A reading-state entry (boards 2a, 1f to 1i) does not exist on the roadmap;
  Reading plan stays greyed until one does.
- Reconcile the four drafted paragraphs and the JSON example with boards 3a
  to 3c once `design_handoff_feature_artboards` is in the repo.
