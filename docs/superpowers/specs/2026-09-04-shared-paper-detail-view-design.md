# One paper detail view for the item pane and the graph

Date: 2026-09-04
Status: approved

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

**`src/services/paperDetailView.ts`** (new). Exports builders that return plain
elements, and one adapter type that describes the host:

```ts
interface PaperDetailHost {
  libraryID: number;
  localPapersByKey: ReadonlyMap<string, ZoteroPaper>;
  collections: readonly ZoteroCollection[];
  /** Select the paper in Zotero's library. */
  showInZotero(itemID: number): void;
  /** Import a work; the chooser's selection when the host shows one. */
  importWork(work: ExternalWork, collectionIDs: number[]): Promise<Zotero.Item>;
  /** Whether Add to Zotero opens the collection chooser first. */
  collectionChooser: boolean;
  /** Extra chip buttons on a row: Explore from this paper, Add as seed. */
  rowActions?(work: ExternalWork): readonly RowAction[];
  /** A click handler for a row, when clicking it previews on the plot. */
  previewRow?(
    work: ExternalWork,
    context: RelationshipContext | null,
  ): (() => void) | null;
  /** Called after an ignore or restore, with the event the host publishes. */
  onRelationshipMutation(event: RelationshipMutationEvent): void;
}
```

Builders:

- `createDetailTabs(document, node, active, onSelect)` — the tab row, plus
  `updateCounts(node)` so a host can refresh the figures without rebuilding.
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
- `createRelationshipList(document, node, direction, host, options)` — the
  controls row, status line, batched rows and the update flow with
  `createUpdateProgress`. Returns `{ root, refresh() }`; `refresh()` re-reads
  the snapshot and redraws, for hosts that receive external mutations.
- `createSimilarSection(document, host, load)` — the heading, the loading and
  failure placeholders, and the rows once `load()` resolves.
- `createImportArea(document, work, host, onImported)` — the Add to Zotero
  flow, with the collection chooser when `host.collectionChooser` is true.
- `relationEntries(node, direction, manualRelations, providerWorks, libraryID)`
  — pure: manual relations first, then provider works, deduplicated by
  `relationshipCandidateIdentity`, each with its ignored relation resolved.
- `ignoredRelationDescriptorFor(node, direction, work, referenceIndex?)` —
  pure: the one descriptor function, replacing the copy in each host.
- `runAction(button, action)` — disables the button, awaits, logs through
  `Zotero.logError`, re-enables when the button is still connected.

**`addon/content/paperDetail.css`** (new). The `cm-detail-*` (body, section,
meta, actions, tabs, tab-label, tab-count), `cm-badges`, `cm-badge-*`,
`cm-metric-list`, `cm-metric-strip`, `cm-advanced-details`, `cm-external-*`,
`cm-abstract-disclosure`, `cm-import-area`, `cm-collection-*`, `cm-success`,
`cm-placeholder`, `cm-primary-button` and `cm-secondary-button` rules leave
`graph.css` for this file. Rules that today hang off `.meristema-root` hang
off `.meristema-paper-detail` instead. The tokens those rules read —
`--cm-sidepane`, `--cm-border`, `--cm-border-soft`, `--cm-surface`,
`--cm-surface-raised`, `--cm-muted`, `--cm-fill-secondary`,
`--cm-fill-quinary`, `--cm-accent` — are declared on `.meristema-paper-detail`
with the same Zotero fallbacks `graph.css` gives them. `box-sizing`, `font:
menu` and `color-scheme` are set there too, so the section inherits nothing
it needs from `.meristema-root`.

The graph puts `meristema-paper-detail` on `.cm-detail-panel`; the container
query for the tab counts stays in `graph.css`, since only the graph's pane is a
container. The item pane puts it on the section's shell `div`. Declaring the
tokens twice, once on `.meristema-root` and once on `.meristema-paper-detail`,
is accepted: the values are the same, and the graph's canvas and chrome keep
reading from `.meristema-root` as before.

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
window that already has the link does not add a second one.

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

- New unit tests in `test/unit/paperDetailView.test.ts` for the pure parts:
  tab labels under the updating and published publication states;
  `relationEntries` ordering and dedupe when a manual relation and a provider
  work name the same paper; `ignoredRelationDescriptorFor` for a reference,
  for a cited-by work that is in the library, and for a cited-by work that is
  not.
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
