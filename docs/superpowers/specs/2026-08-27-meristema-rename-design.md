# Renaming the plugin to Meristema

Date: 2026-08-27
Status: approved, not yet implemented

## Context

This repository is a fork of
[AlessMor/zotero-citation-map](https://github.com/AlessMor/zotero-citation-map)
by Alessandro Morandi, licensed AGPL-3.0-or-later. The fork is diverging from
upstream and needs its own identity.

Licensing and authorship groundwork is already complete and is **not** part of
this spec: the full AGPL text now sits in `LICENSE`, `NOTICE` carries dual
copyright plus the AGPL section 5(a) modification statement, and `package.json`
attributes the work to Daniel Nunes Locatelli. Only the rename remains.

The plugin has never been run. There is no installed profile, no populated
cache, and no configured API key. That single fact removes every migration
concern this rename would otherwise carry.

## The name

**Meristema.** The plugin is named `Meristema` on its own; "Zotero" appears only
in the description ("Think with your literature, inside Zotero"), never in the
product name.

A meristem is the plant tissue at a shoot or root tip where undifferentiated
cells divide and new growth originates. The metaphor is earned rather than
decorative: the Explore view grows outward from what the code already calls
**seed** papers, expanding references and citing works at the frontier of what
the library already holds. Meristems also produce branching structure, which is
the shape of a citation graph.

Two consequences accepted deliberately:

- English has the word as _meristem_; the Portuguese and Spanish form
  _meristema_ is kept for the personal signature, accepting that some users will
  type the English spelling.
- "Zotero" is a trademark of the Corporation for Digital Scholarship. Keeping it
  out of the product name and confining it to descriptive text is nominative use
  and the safest position. This is a trademark matter, entirely separate from
  the AGPL.

## Naming rule

The rename is not a find-and-replace. Two vocabularies apply, and which one a
given identifier takes depends on what that identifier _is_:

**Product name (`Meristema` / `meristema`)** for namespaces and identity, that
is, anywhere the string exists to distinguish this plugin from everything else
sharing the same space:

- CSS class prefix, DOM element ids, preference-pane element ids
- Fluent (`.ftl`) message ids
- Preference prefix, chrome package name, XPI id, global `Zotero.*` instance
- The public API type that describes that global

**Domain names (`Graph`, `View`, `Focus`, `Scope`)** for internal TypeScript
symbols and module filenames. A symbol like `CitationMapViewKind` does not
describe the product; it describes which of the two view kinds is in play, so it
becomes `GraphViewKind`. Renaming it to `MeristemaViewKind` would embed the
product name in internal code and leave the same debt to pay at the next rename.

**Out of scope entirely:** the word _citation_ on its own is domain vocabulary,
not product name. `citationTypes.ts`, `citationMetricsStore.ts`, "citation data
provider", citation counts and every similar use stay exactly as they are. Only
the product-name uses of _Citation Map_ are in scope.

## Scope

Roughly 746 occurrences across 56 files under `src/` and `addon/`, in three
tiers.

### Tier 1, identity

`package.json` `config` block:

| Key             | From                            | To                            |
| --------------- | ------------------------------- | ----------------------------- |
| `addonName`     | `Zotero Citation Map`           | `Meristema`                   |
| `addonID`       | `citation-map@alessmor`         | `meristema@daniel-locatelli`  |
| `addonRef`      | `citationmap`                   | `meristema`                   |
| `addonInstance` | `CitationMap`                   | `Meristema`                   |
| `prefsPrefix`   | `extensions.zotero.citationmap` | `extensions.zotero.meristema` |

Also the `name` and `description` fields, and the README title.

Changing `addonID` makes Zotero treat this as a plugin distinct from upstream,
which is the intent for a fork. Users could install both side by side.

### Tier 2, user-visible and wire-format

Much of this falls out of Tier 1 for free. The codebase is already largely
config-driven: chrome URLs, `.ftl` filenames, preference keys, stylesheet ids
and the global instance all derive from `config.addonRef`, `config.prefsPrefix`
and `config.addonInstance` (`src/hooks.ts:63`,
`src/services/citationPreferences.ts:11`, `src/services/menuService.ts:20`).
Those need no edit at all.

What does need editing:

- 95 distinct CSS classes, `citation-map-*` to `meristema-*`, across
  `addon/content/*.css`, `*.xhtml`, and the TypeScript that emits markup
- Fluent message ids in `addon/locale/en-US/*.ftl` and their call sites
- The user-facing strings themselves: `citation-map-item-pane-header`,
  `citation-map-item-pane-sidenav` and the `mainWindow.ftl` menu label all read
  "Citation Map" and become "Meristema"
- 21 preference keys in `addon/prefs.js`
- ~20 `zotero-prefpane-citationmap-*` element ids in
  `addon/content/preferences.xhtml`, `preferences.js`, `preferences.css`

### Tier 3, internal symbols and filenames

Seven exported types and 36 functions carry `CitationMap`. They take domain
names per the rule above. The table below fixes the contested cases; the
remaining symbols follow the same rule mechanically (`openCitationMapX` becomes
`openGraphX`, and so on) and the implementation plan enumerates all 43.

| From                                | To                       |
| ----------------------------------- | ------------------------ |
| `CitationMapViewKind`               | `GraphViewKind`          |
| `CitationMapViewController`         | `GraphViewController`    |
| `CitationMapCacheStatus`            | `GraphCacheStatus`       |
| `CitationMapFocusResult`            | `GraphFocusResult`       |
| `CitationMapInstanceDescriptor`     | `ViewInstanceDescriptor` |
| `CitationMapIconName`               | `IconName`               |
| `CitationMapAPI`                    | `MeristemaAPI`           |
| `openCitationMapWindow`             | `openGraphWindow`        |
| `openCitationMapFocusItems`         | `openFocusItems`         |
| `renderCitationMapView`             | `renderGraphView`        |
| `getOpenCitationMapViews`           | `getOpenGraphViews`      |
| `isCitationMapTabDescriptor`        | `isGraphTabDescriptor`   |
| `registerCitationMapPreferencePane` | `registerPreferencePane` |
| `normalizedCitationMapItemIDs`      | `normalizedScopeItemIDs` |

`CitationMapAPI` is the one type that keeps the product name, because it types
the `Zotero.Meristema` global and therefore genuinely _is_ the product surface.

Files renamed:

- `src/services/citationMapInstancePolicy.ts` to `graphInstancePolicy.ts`
- `src/services/citationMapScopePolicy.ts` to `graphScopePolicy.ts`
- `addon/content/citationMapWindow.xhtml` to `graphWindow.xhtml`

The existing `Focus` vocabulary is kept in internal symbols even though the view
is presented to users as "Explore". Focus graphs and seeds are established
domain terms in this codebase, and churning them is a separate concern.

## Hardcoded literals to fix

Six `"citationmap"` string literals across five sites bypass the config
indirection, plus one stale mention in a comment at
`src/services/windowService.ts:588`. They are a pre-existing smell; the rename
is the forcing function to fix them.

Three tab-type literals must be **derived from `config.addonRef`** rather than
retyped with the new name:

- `src/services/windowService.ts:23`, `const TAB_TYPE = "citationmap"`
- `src/services/menuService.ts:474-475`, tab-type comparisons
- `src/services/citationMapInstancePolicy.ts:19`, tab-type comparison

Two are SQLite database names:

- `src/services/citationMetricsStore.ts:471`,
  `new Zotero.DBConnection("citationmap")`
- `src/services/externalWorkCacheService.ts:337`,
  `DBConnection("citationmap-external")`

These become `meristema` and `meristema-external`. **Cache loss is accepted**:
the plugin has never been run, so the databases do not exist yet. No migration
shim is written. Had there been a populated cache, rebuilding it would have
meant a long re-fetch against rate-limited providers.

Likewise **no preference migration** is written. The old
`extensions.zotero.citationmap.*` keys hold nothing, and `addonID` changes
anyway, so Zotero treats this as a fresh install.

## Non-goals

- No feature, behaviour, or UI-layout changes. This is a rename only.
- No renaming of `citation` domain vocabulary.
- No `Focus` to `Explore` symbol churn.
- No unrelated refactoring of the large files surfaced along the way
  (`graphViewService.ts` at 4300 lines, `externalDiscoveryService.ts` at 2192).
  Noted for later, deliberately untouched here.

## Verification

The rename is correct when all of the following hold:

1. `npm run check` passes (prettier, eslint, `tsc --noEmit`).
2. `grep -rniE "citation.?map" src addon` returns nothing. The only permitted
   survivors are `citation` as standalone domain vocabulary.
3. `npm run build` produces an XPI whose `manifest.json` shows name `Meristema`,
   id `meristema@daniel-locatelli`, author `Daniel Nunes Locatelli`.
4. The plugin installs into a clean Zotero 9 or 10 profile and:
   - appears as "Meristema" in Tools then Plugins
   - opens both Collection Graph and Explore views without console errors
   - shows its preference pane, and settings persist across restart under
     `extensions.zotero.meristema.*`
   - creates `meristema.sqlite` and `meristema-external.sqlite` in the profile
   - renders correctly, confirming no CSS class was renamed in the stylesheet
     but missed in the emitting TypeScript, or vice versa

That last point is the real risk of this rename. CSS classes and Fluent ids are
matched by string at runtime, so a half-applied rename typechecks cleanly and
fails only visually. Renaming each class across stylesheet and emitter together,
then confirming the grep in point 2 reaches zero, is what catches it.
