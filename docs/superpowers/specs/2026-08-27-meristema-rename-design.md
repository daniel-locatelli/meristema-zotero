# Renaming the plugin to Meristema

Date: 2026-08-27
Status: implemented

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

## Repository

The work moves to a new repository, `daniel-locatelli/meristema-zotero`, rather
than renaming the existing GitHub fork.

The repo is named for the _component_, not the brand. If Meristema ever spans a
Zotero plugin and a web app talking to the Zotero Web API, then "Meristema" is a
brand, and a brand should not be a repository: a repository is one buildable
artifact. The bare name stays free for an umbrella or stays unused. The suffix
form also sorts a future `meristema-web` alongside this one, which the
`zotero-meristema` prefix form would not.

A repository slug is descriptive use and does not reopen the trademark question
settled above, which concerns only the display name Zotero shows in its plugin
list.

Detaching from the fork network is the point of moving. GitHub excludes forks
from repository and code search by default, disables issues on them by default,
and pre-fills upstream as the base for any new pull request, which is a standing
footgun. None of this affects AGPL compliance: attribution lives in `NOTICE`,
the README banner, and the commit history, not in GitHub's fork metadata.

Procedure:

1. Create an empty `daniel-locatelli/meristema-zotero`, with no README, license,
   or `.gitignore`.
2. Repoint `origin` at it. Keep `upstream` pointing at
   `AlessMor/zotero-citation-map` so improvements can still be pulled and fixes
   sent back.
3. Push all branches and tags. **Pushing the full history is the point**:
   Alessandro Morandi's commits keep their original author metadata, which is
   stronger evidence of provenance than a GitHub banner and is what backs the
   dated-record claim in `NOTICE`.
4. Archive the old fork rather than deleting it, leaving a README that points at
   the new home. Deleting breaks existing links; archiving preserves them.
5. Move the local checkout to `C:\repos\github\daniel-locatelli\meristema-zotero`
   to match the `<provider>\<account>\<repo>` convention.

`zotero-plugin.config.ts` needs no edit. Its `updateURL` and `xpiDownloadLink`
use `{{owner}}/{{repo}}` templates resolved from the git remote, so they follow
the move automatically.

The move must happen **after** the rename commit, so the new repository's first
push already says Meristema throughout and there is never a window where
`meristema-zotero` contains a plugin called Citation Map.

There are no published releases, so the move is free. Moving after a release
would break auto-update for installed copies, because `update.json` lives at a
release URL under the old owner and repo. This is the cheapest moment it will
ever be.

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

Also in `package.json`, outside the `config` block:

| Key              | From                                              | To                                                             |
| ---------------- | ------------------------------------------------- | -------------------------------------------------------------- |
| `name`           | `zotero-citation-map`                             | `meristema-zotero`                                             |
| `description`    | "Citation and reference metrics ..."              | "Think with your literature, inside Zotero." plus feature text |
| `repository.url` | `.../daniel-locatelli/zotero-citation-map.git`    | `.../daniel-locatelli/meristema-zotero.git`                    |
| `bugs.url`       | `.../daniel-locatelli/zotero-citation-map/issues` | `.../daniel-locatelli/meristema-zotero/issues`                 |
| `homepage`       | `.../daniel-locatelli/zotero-citation-map#readme` | `.../daniel-locatelli/meristema-zotero#readme`                 |

And the README title, plus the release link in the installation section.

Changing `addonID` makes Zotero treat this as a plugin distinct from upstream,
which is the intent for a fork. Users could install both side by side.

### Tier 2, user-visible and wire-format

Only the TypeScript half falls out of Tier 1 for free. Under `src/`, chrome
URLs, `.ftl` filenames, preference keys, stylesheet ids and the global instance
all derive from `config.addonRef`, `config.prefsPrefix` and
`config.addonInstance` (`src/hooks.ts:63`,
`src/services/citationPreferences.ts:11`, `src/services/menuService.ts:20`).
Those need no edit.

**Static assets under `addon/` are the opposite**, and this is the highest-risk
part of the rename. They hardcode roughly 60 references that no compiler
checks and that fail silently at runtime:

| Kind                                             | Where                                                                                   | Silent failure if missed                  |
| ------------------------------------------------ | --------------------------------------------------------------------------------------- | ----------------------------------------- |
| 5 x `chrome://citationmap/...`                   | `graph.css:78,80`, `preferences.css:123`, `tabIcon.css:4`, `citationMapWindow.xhtml:14` | icons and prefs stylesheet vanish         |
| `windowtype="citationmap:window"`                | `citationMapWindow.xhtml:8`                                                             | detached-window identity breaks           |
| `href="citationmap-preferences.ftl"`             | `preferences.xhtml:2`                                                                   | prefs pane loses every localized string   |
| `PREF_PREFIX = "extensions.zotero.citationmap."` | `preferences.js:4`                                                                      | prefs pane reads and writes orphaned keys |
| ~30 x `zotero-prefpane-citationmap-*` ids        | `preferences.xhtml`, `preferences.js`                                                   | `byID()` returns null, prefs pane dies    |
| 21 pref keys                                     | `prefs.js`                                                                              | defaults never apply                      |

The Fluent one is the sharpest. Scaffold prefixes built locale files with
`addonRef`, verified in the build output as
`.scaffold/build/addon/locale/en-US/citationmap-preferences.ftl`. Change
`addonRef` without touching `preferences.xhtml:2` and the preferences pane
silently renders nothing.

**These become build placeholders rather than retyped literals.**
`addon/bootstrap.js` and `addon/manifest.json` already use `__addonRef__` and
`__addonInstance__`, which `zotero-plugin.config.ts` substitutes at build time
from `build.define`, and that spreads all of `pkg.config`, so `__prefsPrefix__`
is available too. So:

- `chrome://citationmap/` becomes `chrome://__addonRef__/`
- `citationmap-preferences.ftl` becomes `__addonRef__-preferences.ftl`
- `extensions.zotero.citationmap.` becomes `__prefsPrefix__.`
- `windowtype="citationmap:window"` becomes `windowtype="__addonRef__:window"`

Element ids and CSS classes stay literal, renamed to the `meristema-` prefix,
since they are internal and gain nothing from indirection.

Making these config-driven is the durable win: this class of silent breakage
stops recurring at any future rename.

What else needs editing:

- 95 distinct CSS classes, `citation-map-*` to `meristema-*`, across
  `addon/content/*.css`, `*.xhtml`, and the TypeScript that emits markup
- Fluent message ids in `addon/locale/en-US/*.ftl` and their call sites
- The user-facing strings themselves: `citation-map-item-pane-header`,
  `citation-map-item-pane-sidenav` and the `mainWindow.ftl` menu label all read
  "Citation Map" and become "Meristema"

### Dead CSS

Cross-checking every class in `addon/content/*.css` against `src/` and the
XHTML found 12 candidates with no reference anywhere, also absent from the
built bundle. Two of those, `citation-map-options-locked` and
`citation-map-update-library-option`, turned out to be live: they are used
from `addon/content/preferences.js` (via `classList.toggle` and
`label.className`) and styled by six and four rules respectively in
`addon/content/preferences.css`. The initial analysis grepped `src/` and the
XHTML but not `addon/content/*.js`, which ships as a static asset and is
never compiled from `src/` — a blind spot worth remembering for any future
sweep of this codebase. Those two classes were kept and renamed along with
the rest; only the remaining 10 are dead rules left by removed features:

`citation-map-add-relation-button`, `citation-map-dialog-close`,
`citation-map-ignored-relation`, `citation-map-local-result`,
`citation-map-local-results`, `citation-map-progress-bar`,
`citation-map-progress-track`, `citation-map-relation-dialog`,
`citation-map-relation-dialog-header`, `citation-map-relation-dialog-overlay`.

These are deleted rather than renamed. Carrying dead rules across a rename
launders them into looking intentional.

Only one CSS class is composed at runtime, at
`src/services/updateProgressService.ts:286`, and it builds both halves as
literals, so a grep does find them. No hidden interpolation exists.

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

`Zotero.DBConnection` is typed `new (dbNameOrPath: string)`, so the same code
path handles both names and `"meristema"` yields `meristema.sqlite` exactly as
`"citationmap"` yielded `citationmap.sqlite`. The profile-directory check stays
in verification anyway, since it is free.

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
