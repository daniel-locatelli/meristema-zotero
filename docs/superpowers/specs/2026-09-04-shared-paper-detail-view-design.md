# One paper detail view for the item pane and the graph

Date: 2026-09-04
Status: implemented

## Context

Meristema shows a paper's citation data in two places. The graph's right pane
(`src/services/graphViewService.ts`) draws a toolbar with a three-tab row, a
header with the title, creator line, badges and DOI, and a body with a
three-figure metric strip, an Advanced disclosure, and flat hairline-divided
rows for related works. It was redesigned to sit beside Zotero's own panes
(`docs/superpowers/specs/2026-08-28-graph-view-redesign-design.md`) and is
styled by `addon/content/graph.css`.

The item pane section (`src/services/itemPaneService.ts`), reached from the
network icon in Zotero's item pane sidenav, still carries the earlier look: a
tab row of full-height buttons, a nine-row metric table with rules under every
row, a "Data details" disclosure, bordered rounded cards for related works, a
red retraction banner, and an action bar of five buttons. It is styled by
`addon/content/zoteroPane.css`.

The two are separate implementations. They already share three helpers — the
list toolbar (`paperListViewService.ts`), the manual relationship picker
(`manualRelationshipPickerService.ts`) and the overview action bar
(`paperOverviewActionsService.ts`) — but the tabs, badges, metric rows, related
work rows, relationship list orchestration, similar-paper section, import flow
and ignored-relation descriptor logic each exist twice, under two sets of class
names. Every change to the graph's pane has to be repeated by hand in the item
pane, and has not been.

Differences in behaviour today, beyond the look:

- The item pane lists manual relations and offers "Remove manual relation";
  the graph does not.
- The graph offers Explore, Add as seed, and a click-to-preview on each row;
  the item pane cannot.
- The graph's import flow offers a collection chooser; the item pane imports
  to no collection.
- The item pane's overview action bar has Show in Zotero, Open DOI, Open in ›,
  Similar and Refresh. The graph reduced a local paper's actions to one
  "Find similar papers" button.

## Decision

One module builds the paper detail view and both panes call it. The graph
keeps its pane shell — toolbar, header, collapse, resizer — and the item pane
keeps its section registration. Everything inside the body, plus the tab row,
comes from the shared module, styled by one shared stylesheet.

### What the user sees

In the item pane section:

- A three-column tab row at the top of the section body: Overview, Cited by,
  References, with the reported count as a secondary figure beside the name,
  and "…" while a lookup is in flight. The same markup as the graph's tab row.
- Overview: the match-confirmation block when the record needs it, then the
  paper's badges (Open Access, Retracted, Top 1% or Top 10%, Match needs
  confirmation), then the three-figure strip — FWCI, citations per year,
  percentile — or its empty-state sentence, then Advanced with the rest of the
  registry. No title and no DOI: Zotero's header and Info section already carry
  them. No retraction banner: the Retracted badge says it, as it does in the
  graph.
- Under the metrics, one actions row: Open in › on the left; Similar and the
  refresh icon button on the right. Show in Zotero and Open DOI are gone.
  Similar fills a similar-papers section below the row.
- Cited by and References: the search toolbar, the refresh icon button and the
  manual-relationship picker on one row; the status line; the flat rows with
  chip buttons; "Show N more" in batches. Rows offer Show in Zotero or Add to
  Zotero, Mark incorrect or Restore relationship, and Remove manual relation
  on a manual row.

In the graph's detail pane: no visible change, with one exception. The
relationship list now shows manual relations, marked with a Manual badge and a
Remove manual relation button, the way the item pane does.

### Components

The view arrived as two modules, split along the line the tests wanted. The
pure half has no DOM and no `Zotero`, so it runs under plain Node; the DOM
half builds elements and is exercised by the graph's visual test.

**`src/services/paperDetailModel.ts`** (new, pure). `DetailTab` and
`DetailTabLabel`; `relationshipTabLabel(direction, state, reportedCount)`, the
name, the count and the tooltip phrasing, with an ellipsis while a refresh is
between started and published; `RelationEntry` and `mergeRelationEntries`,
manual relations first in their own order, then the provider's works in the
provider's order, deduplicated by `relationshipCandidateIdentity`, each
provider work carrying whatever the caller's `resolveIgnored` returns; and
`ignoredRelationDescriptorFor(node, libraryID, direction, work, recordFor,
referenceIndex?)`, the one descriptor function that replaced the copy in each
host. The store is reached through the `CitationRecordLookup` the caller
passes, not imported, which is what keeps the module runnable outside Zotero.

**`src/services/paperDetailView.ts`** (new, DOM). The builders return plain
elements, and one adapter type describes the host:

```ts
interface PaperDetailHost {
  origin: "graph" | "item-pane";
  snapshot: LibrarySnapshot;
  /** Select the library item with this key in Zotero. */
  showInZotero(itemKey: string): void;
  /** Whether Add to Zotero opens the collection chooser first. */
  collectionChooser: boolean;
  /** Extra chip buttons on a row (Explore from this paper, Add as seed). */
  rowActions?(work: ExternalWork): readonly RowAction[];
  /** A click handler for a row when clicking it previews on the plot. */
  previewRow?(
    work: ExternalWork,
    context: RelationshipContext | null,
  ): (() => void) | null;
  clearPreview?(): void;
  /** Called after an ignore or a restore; the host publishes or applies it. */
  onRelationshipMutation(event: RelationshipMutationEvent): void;
}
```

The host carries the whole `LibrarySnapshot` rather than the three fields the
spec first listed, since the rows need the papers, the collections and the
library id together; and `origin` is on it because a mutation has to say which
pane it came from so that pane does not redraw itself twice.

Builders:

- `createDetailTabs(document, { node, libraryID, active, onSelect })` — the tab
  row, plus `updateCounts(node)` so a host can refresh the figures without
  rebuilding.
- `createBadges(document, subject)` — for a node or a work; returns `null`
  when there is nothing to say.
- `createOverviewMetrics(document, node)` — the strip or the empty state,
  followed by the Advanced disclosure. The Advanced rows come from
  `METRIC_DEFINITIONS` and `SUPPLEMENTARY_PROPERTY_DEFINITIONS` marked
  `itemPane: "advanced"`, as the graph's `advancedMetrics` does now.
- `appendRelatedWorkRows(document, list, entries, host, context?)` — one row
  per entry: title, creator line, metadata line, identity row with the DOI or
  provider link and the chip buttons, badges above the controls, abstract
  disclosure. `context` names the subject node and direction when the rows are
  a relationship list; without it the rows are similar papers and carry no
  ignore toggle.
- `createRelationshipList(document, { host, node, direction, readSnapshot,
refreshRelationships, onManualChange?, updateCounts? })` — the controls row,
  status line, batched rows and the update flow with `createUpdateProgress`.
  Returns `{ root, refresh(), destroy() }`; `refresh()` re-reads the snapshot
  and redraws, for hosts that receive external mutations, and `destroy()`
  cancels an update still in flight and tears down the toolbar and picker.
  The options object is what the two hosts differ by: each brings its own
  reader and its own refresh, so the list itself touches no provider code.
- `createSimilarSection(document, host, load)` — the heading, the loading and
  failure placeholders, and the rows once `load()` resolves.
- `createImportArea(document, work, host, onImported)` — the Add to Zotero
  flow, with the collection chooser when `host.collectionChooser` is true.

**`addon/content/paperDetail.css`** (new). The `cm-detail-*` (body, section,
meta, actions, tabs, tab-label, tab-count), `cm-badges`, `cm-badge-*`,
`cm-metric-list`, `cm-metric-strip`, `cm-advanced-details`, `cm-external-*`,
`cm-abstract-disclosure`, `cm-import-area`, `cm-collection-*`, `cm-success`,
`cm-placeholder`, `cm-primary-button` and `cm-secondary-button` rules leave
`graph.css` for this file. Rules that today hang off `.meristema-root` hang
off `.meristema-paper-detail` instead. The tokens those rules read —
`--cm-border`, `--cm-border-soft`, `--cm-surface`, `--cm-surface-raised`,
`--cm-muted`, `--cm-fill-secondary`, `--cm-fill-quinary`, `--cm-accent` and
`--cm-icon-color` — are declared on `.meristema-paper-detail`, and every one
of them off the system colours, which follow the scheme on their own.
`box-sizing`, `font: menu` and `color-scheme` are set there too, so the
section inherits nothing it needs from `.meristema-root`.

The graph puts `meristema-paper-detail` on `.cm-detail-panel`; the container
query for the tab counts stays in `graph.css`, since only the graph's pane is a
container. The item pane puts it on the section's shell `div`. Declaring a
token on both roots is accepted only where the value cannot vary by scheme:
in the graph the panel is inside `.meristema-root`, so a declaration here is
on the closer element and would shadow the root's dark override. The ones the
root varies — `--cm-sidepane`, `--cm-panedivider`, `--cm-toolbar` — stay in
`graph.css` alone, and the graph's canvas and chrome keep reading from
`.meristema-root` as before.

**`addon/content/graph.css`** keeps the shell: `.meristema-root` and its
tokens, the three toolbars, the plot pane, the Key rail, `.cm-detail-shell`,
`.cm-detail-resizer`, `.cm-detail-panel`, `.cm-detail-header`,
`.cm-detail-doi`, `.cm-detail-title`, `.cm-detail-toggle`, `.cm-detail-nav`,
the container query, and everything the plot's overlays use.

**`addon/content/zoteroPane.css`** keeps `.meristema-column-warning` and the
`.meristema-match-warning` and `.meristema-candidate` rules, restyled to the
graph's palette (the warning box takes the amber of `.cm-badge-warning` on
`--cm-surface`). Every other `.meristema-pane-*` and `.meristema-relation-*`
rule is deleted.

**Stylesheet loading.** `ensureStyles` in `graphViewControls.ts` links
`paperDetail.css` beside `graph.css`. `installStyles` in `hooks.ts` links it
beside `zoteroPane.css`. Both use the same element id, so a graph tab in a main
window that already has the link does not add a second one. Because either can
be the one to link first, `ensureStyles` also puts the `graph.css` link
directly after the `paperDetail.css` one: the shell sheet overrides a few of
the shared base rules at equal specificity, and only document order decides
those.

### The graph after the change

`graphViewService.ts` drops `advancedMetrics`, `relationshipTabLabel`,
`applyTabLabel`, `updateRelationshipTabLabels`, `appendExternalWorkCards`,
`showRelationList`'s body, the two ignored-relation helpers, and the inline
similar-results code. `appendPaperHeader` calls `createDetailTabs` and
`createBadges`. `renderOverview` calls `createOverviewMetrics` and keeps its
own external-node action row and local-node "Find similar papers" button,
feeding `createSimilarSection`. `showRelationList` becomes: set the active
view, clear the body, append the header, append
`createRelationshipList(...)` with the graph host, and store its `refresh` in
`refreshActiveRelationshipView`. The graph host's `rowActions` returns
Explore and, when a focus projection is active and the work is not a seed,
Add as seed; `previewRow` returns the ghost-preview click handler;
`onRelationshipMutation` applies the mutation to the graph and notifies.

### The item pane after the change

`itemPaneService.ts` keeps registration, refresh scheduling, subject
resolution, per-body tab state, `summaryForItem`, `renderMatchConfirmation`
and `renderPane`. `renderPane` builds the shell with `meristema-paper-detail`,
appends `createDetailTabs`, and for the active tab appends either the overview
(match confirmation, badges, metrics, the action row, the similar section) or
`createRelationshipList` with the item-pane host. The item-pane host has no
`rowActions` and no `previewRow`, `collectionChooser: false`, `showInZotero`
through the active pane's `selectItem`, and `onRelationshipMutation` calls
`notifyRelationshipMutation` with origin `item-pane`.

`createPaperOverviewActionBar` loses `onShowInZotero`, `doi` and the two
buttons they drove; the remaining options are `getOpenInActions`,
`onSimilar` and `onRefresh`. The action bar takes the shared classes
`cm-detail-actions`, `cm-primary-button` and `cm-secondary-button`.

### Error handling

Unchanged in kind. Every button action goes through `runAction`. List renders
carry a generation counter, so a batch scheduled before a rerender never lands
after it. The relationship update flow keeps the cancellation scope, the
progress dialog, and the three outcomes: added N, no new papers, failed or
cancelled.

### Testing

- New unit tests in `test/unit/paperDetailModel.test.ts` for the pure parts:
  tab labels under the updating and published publication states;
  `mergeRelationEntries` ordering and dedupe when a manual relation and a
  provider work name the same paper, and when two manual relations do;
  `ignoredRelationDescriptorFor` for a reference, for a cited-by work that is
  in the library, for one in the library whose record holds no matching
  reference, and for one that is not in the library at all.
- `test/zotero/graphViewVisual.test.ts` runs unchanged as the regression check
  for the graph pane.
- Manual check in the running Zotero: select a paper in the library, open the
  Meristema section, walk the three tabs, mark a relation incorrect and
  restore it, add a manual relation; then open the same paper from a graph and
  compare pane against pane. Check both in light and dark themes.

### Out of scope

- Moving the item pane's tab row into Zotero's sidenav.
- Changing the graph pane's header, toolbar, collapse or resize behaviour.
- Collection choosing in the item pane's import flow.

### Deviations during implementation

The base button, input and icon rules live once in `paperDetail.css`, with
selectors covering both `.meristema-root` and `.meristema-paper-detail`,
rather than duplicated. The import area builds its collection chooser on the
first click, not at row construction. Rows treat a work as in the library on
`inLibraryItemKey` alone.

In the graph's Overview, Advanced sits directly under the metric strip,
before the action row. The item pane's Overview renders without waiting for
the library snapshot; only the similar-paper search and the relationship tabs
load it. Removing a manual relation from a row notifies the host through
`onManualRelationRemoved`, so open graphs rebuild.

A manual relation added or removed in the graph's detail pane has to reach an
open item pane as well, and `itemPaneService` cannot be called from
`graphViewService` — it imports `windowService`, which imports
`graphViewService` back. So `relationshipEvents.ts` carries a bare
`notifyManualRelationChange` / `subscribeManualRelationChanges` pair: the graph
host's `onManualChange` pings it after rebuilding, and the registered item pane
schedules a refresh of every open pane.
