# Meristema Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the plugin from "Zotero Citation Map" to "Meristema" across identity, user-facing strings, wire formats, and internal symbols, then move it to a new repository.

**Architecture:** Three phases, ordered so the riskiest work is verified by a mechanical signal rather than by eye. Phase 1 converts hardcoded name literals into config references and build placeholders **while the name is still `citationmap`**, so the built output must come out byte-identical to a saved baseline — that diff is the proof no reference was missed. Phase 2 then flips a single config block and the new name propagates. Phase 3 renames what is genuinely literal (CSS classes, element ids, internal symbols) and moves the repo.

**Tech Stack:** TypeScript 5.9, `zotero-plugin-scaffold` 0.8.7 (build, placeholder substitution, XPI packaging), esbuild, Fluent (`.ftl`) localization, Mocha + Chai run inside Zotero, Prettier + ESLint.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-27-meristema-rename-design.md`. Read it before starting.
- Product name is exactly `Meristema`. Never `Meristem`, never `Meristema for Zotero`.
- "Zotero" may appear in descriptions and prose, never in the product name.
- **Product name for namespaces** (CSS class prefix, DOM ids, Fluent ids, pref prefix, chrome package, XPI id, `Zotero.*` global). **Domain names for internal TypeScript symbols and filenames** (`GraphViewKind`, not `MeristemaViewKind`).
- The standalone word `citation` is domain vocabulary and is **never** renamed. `citationTypes.ts`, `citationMetricsStore.ts`, "citation data provider", citation counts all stay. Only product-name uses of _Citation Map_ are in scope.
- No feature, behaviour, or UI-layout changes. This is a rename.
- No refactoring of `graphViewService.ts` (4300 lines) or `externalDiscoveryService.ts` (2192 lines) beyond the renames named here.
- `npm run check` (Prettier + ESLint + `tsc --noEmit`) must pass before every commit.
- Commit after every task. Never batch two tasks into one commit.

## Testing reality — read this before planning your verification

There is no fast headless test run. `npm run test` invokes `zotero-plugin test`, which launches a real Zotero. The unit tests in `test/architecture.test.ts` cannot run under bare Mocha because `src/` imports are extensionless and need a bundler to resolve (verified: `npx mocha test/architecture.test.ts` fails with `ERR_MODULE_NOT_FOUND`).

So the verification ladder for this work is:

1. **`npm run check`** — fast, catches TypeScript and lint. Run constantly. Catches nothing about strings.
2. **Build-output diff against a baseline** — the primary signal in Phase 1. Mechanical and complete.
3. **`grep` gates** — the primary signal in Phase 3.
4. **`npm run test`** — needs Zotero; run at phase boundaries if available.
5. **Manual install into a clean profile** — the only thing that proves CSS classes and Fluent ids actually resolve. Required at the end, non-negotiable.

The whole reason Phase 1 exists is that steps 1–3 cannot see a broken `chrome://` URL or a missing Fluent file, and step 5 is slow. Making those references config-driven while the name is unchanged converts an invisible risk into a byte comparison.

---

## File Structure

**Phase 1 — made config-driven (content unchanged after build):**

- `src/services/citationMapInstancePolicy.ts` — tab-type literal to `config.addonRef`
- `src/services/menuService.ts` — two tab-type comparisons
- `src/services/windowService.ts` — `TAB_TYPE` constant
- `src/services/citationMetricsStore.ts` — metrics DB name
- `src/services/externalWorkCacheService.ts` — external-work cache DB name
- `test/architecture.test.ts` — tab-type test fixtures follow `config.addonRef`
- `addon/content/graph.css`, `preferences.css`, `tabIcon.css` — `chrome://` URLs to `__addonRef__`
- `addon/content/citationMapWindow.xhtml` — icon URL and `windowtype`
- `addon/content/preferences.xhtml` — Fluent href, stylesheet href
- `addon/content/preferences.js` — `PREF_PREFIX`
- `addon/prefs.js` — 21 pref keys to `__prefsPrefix__`

**Phase 2 — identity:**

- `package.json` — the `config` block plus `name`, `description`, `repository`, `bugs`, `homepage`

**Phase 3 — literal renames:**

- `addon/content/*.css`, `*.xhtml` — 95 CSS classes, ~30 prefpane element ids, 12 dead rules deleted
- `addon/locale/en-US/*.ftl` — message ids and the visible strings
- `src/**/*.ts` — 7 types, 36 functions, marker constants
- Renamed files: `citationMapInstancePolicy.ts` to `graphInstancePolicy.ts`, `citationMapScopePolicy.ts` to `graphScopePolicy.ts`, `addon/content/citationMapWindow.xhtml` to `graphWindow.xhtml`
- `README.md`

---

# Phase 1 — Make it config-driven

The invariant for this entire phase: **the built output must not change.** Every task ends by proving that.

### Task 1: Capture the build baseline

**Files:** none modified.

**Interfaces:**

- Produces: a reference copy of `.scaffold/build` at `../meristema-baseline`, used by Tasks 2 and 3 to prove no behaviour changed.

- [ ] **Step 1: Confirm a clean tree and a passing check**

```bash
git status --porcelain          # expect: empty
npm run check                   # expect: prettier OK, eslint OK, tsc silent
```

- [ ] **Step 2: Build and snapshot the output**

```bash
npm run build
rm -rf ../meristema-baseline
cp -r .scaffold/build ../meristema-baseline
```

- [ ] **Step 3: Confirm the baseline captured the pre-rename names**

```bash
grep -c "citationmap" ../meristema-baseline/addon/content/preferences.xhtml
ls ../meristema-baseline/addon/locale/en-US/
```

Expected: a non-zero count, and three files named `citationmap-addon.ftl`, `citationmap-mainWindow.ftl`, `citationmap-preferences.ftl`. If the locale files are not prefixed this way, **stop** — the spec's model of scaffold is wrong and the plan needs revisiting.

- [ ] **Step 4: No commit**

Nothing changed. `../meristema-baseline` is outside the repo deliberately; `.scaffold/` is already gitignored.

---

### Task 2: Route TypeScript name literals through `config`

Six hardcoded `"citationmap"` literals in `src/` bypass `config.addonRef`. Three are tab types, two are SQLite database names, and one is a stale comment.

**Files:**

- Modify: `src/services/citationMapInstancePolicy.ts:19`
- Modify: `src/services/menuService.ts:474-475`
- Modify: `src/services/windowService.ts:23`, and the comment at `:588`
- Modify: `src/services/citationMetricsStore.ts:471`
- Modify: `src/services/externalWorkCacheService.ts:337`
- Test: `test/architecture.test.ts:321-337`

**Interfaces:**

- Consumes: `config` from `package.json`, imported as `import { config } from "../../package.json";` — the established pattern, see `src/services/citationPreferences.ts:1`.
- Produces: no signature changes. Behaviour identical while `addonRef` is `citationmap`.

- [ ] **Step 1: Update the test first so it tracks config, not a literal**

In `test/architecture.test.ts`, add the config import alongside the existing imports:

```typescript
import { config } from "../package.json";
```

Then replace the tab-descriptor test at lines 321-337 with:

```typescript
it("never promotes the reserved library tab into a Citation Map instance", function () {
  expect(
    isCitationMapTabDescriptor({ id: "zotero-pane", type: "library" }),
  ).to.equal(false);
  expect(
    isCitationMapTabDescriptor({ id: "tab-reader", type: "reader" }),
  ).to.equal(false);
  expect(
    isCitationMapTabDescriptor({ id: "tab-map", type: config.addonRef }),
  ).to.equal(true);
  expect(
    isCitationMapTabDescriptor({
      id: "tab-map",
      type: `${config.addonRef}-unloaded`,
    }),
  ).to.equal(true);
});
```

This is the point of doing the test first: it now asserts the _relationship_ between tab type and `addonRef`, so it keeps passing through Phase 2 without edits, and it fails loudly if someone later reintroduces a literal.

- [ ] **Step 2: Make the tab-type check config-driven**

In `src/services/citationMapInstancePolicy.ts`, add as the first line:

```typescript
import { config } from "../../package.json";
```

Then change line 19 from:

```typescript
return String(tab.type ?? "").replace(/-unloaded$/, "") === "citationmap";
```

to:

```typescript
return String(tab.type ?? "").replace(/-unloaded$/, "") === config.addonRef;
```

- [ ] **Step 3: Make the two menu comparisons config-driven**

In `src/services/menuService.ts` (which already imports `config`), change lines 474-475 from:

```typescript
context.setVisible(tabType === "citationmap");
context.setEnabled(tabType === "citationmap");
```

to:

```typescript
context.setVisible(tabType === config.addonRef);
context.setEnabled(tabType === config.addonRef);
```

- [ ] **Step 4: Make the tab type and both database names config-driven**

In `src/services/windowService.ts` (already imports `config`), change line 23 from:

```typescript
const TAB_TYPE = "citationmap";
```

to:

```typescript
const TAB_TYPE = config.addonRef;
```

In `src/services/citationMetricsStore.ts`, ensure `config` is imported, then change line 471 from:

```typescript
const connection = new Zotero.DBConnection("citationmap");
```

to:

```typescript
const connection = new Zotero.DBConnection(config.addonRef);
```

In `src/services/externalWorkCacheService.ts`, ensure `config` is imported, then change line 337 from:

```typescript
const connection = new Zotero.DBConnection("citationmap-external");
```

to:

```typescript
const connection = new Zotero.DBConnection(`${config.addonRef}-external`);
```

`Zotero.DBConnection` is typed `new (dbNameOrPath: string)` and resolves a bare name to `<name>.sqlite` in the profile directory, so this is a pure substitution.

- [ ] **Step 5: Fix the stale comment**

`src/services/windowService.ts:588` mentions "a stale citationmap tab". Reword it to say "a stale plugin tab" so no prose asserts the old name.

- [ ] **Step 6: Verify no literals remain in src**

```bash
grep -rn '"citationmap' src test
```

Expected: **no output.**

- [ ] **Step 7: Verify the build is unchanged**

```bash
npm run check
npm run build
diff -r ../meristema-baseline .scaffold/build
```

Expected: `npm run check` clean, and `diff -r` produces **no output**. Any difference here means a substitution changed behaviour — investigate before continuing, do not proceed.

- [ ] **Step 8: Commit**

```bash
git add src test
git commit -m "Route plugin-name literals in src through config.addonRef

Six hardcoded citationmap literals bypassed the config indirection: three
tab-type comparisons and the two SQLite database names. They are now derived
from config.addonRef, so the upcoming rename reaches them.

The tab-descriptor test now asserts the relationship to config.addonRef rather
than a literal, so it survives the rename and fails if a literal returns.

Built output is byte-identical to before this change."
```

---

### Task 3: Convert `addon/` asset literals to build placeholders

This is the highest-risk task in the plan. These references fail **silently** — no TypeScript error, no build error, no console warning. A missed one produces a missing icon or an empty preferences pane discovered days later.

`zotero-plugin-scaffold` substitutes `__token__` placeholders in `addon/` assets from `build.define` in `zotero-plugin.config.ts`, which spreads all of `pkg.config`. So `__addonName__`, `__addonID__`, `__addonRef__`, `__addonInstance__` and `__prefsPrefix__` are all available. `addon/bootstrap.js` and `addon/manifest.json` already use this mechanism — follow their lead.

**Files:**

- Modify: `addon/content/graph.css:78,80`
- Modify: `addon/content/preferences.css:123`
- Modify: `addon/content/tabIcon.css:4`
- Modify: `addon/content/citationMapWindow.xhtml:8,14`
- Modify: `addon/content/preferences.xhtml:2,5`
- Modify: `addon/content/preferences.js:4`
- Modify: `addon/prefs.js` (all 21 lines)

**Interfaces:**

- Consumes: scaffold's `build.define` substitution, configured at `zotero-plugin.config.ts:28-36`.
- Produces: `addon/` assets with zero hardcoded plugin-name references.

- [ ] **Step 1: Replace the five chrome:// URLs**

In `addon/content/graph.css` lines 78 and 80, `addon/content/preferences.css` line 123, and `addon/content/tabIcon.css` line 4, replace every occurrence of the string `chrome://citationmap/` with `chrome://__addonRef__/`.

```bash
sed -i 's|chrome://citationmap/|chrome://__addonRef__/|g' \
  addon/content/graph.css addon/content/preferences.css addon/content/tabIcon.css
```

- [ ] **Step 2: Fix the detached-window XHTML**

In `addon/content/citationMapWindow.xhtml`, change line 8 from:

```xml
  windowtype="citationmap:window"
```

to:

```xml
  windowtype="__addonRef__:window"
```

and line 14 from:

```xml
  <html:link rel="icon" href="chrome://citationmap/content/icons/network.svg" />
```

to:

```xml
  <html:link rel="icon" href="chrome://__addonRef__/content/icons/network.svg" />
```

- [ ] **Step 3: Fix the preferences pane wiring — the sharpest failure**

In `addon/content/preferences.xhtml`, change line 2 from:

```xml
  <html:link rel="localization" href="citationmap-preferences.ftl" />
```

to:

```xml
  <html:link rel="localization" href="__addonRef__-preferences.ftl" />
```

and the stylesheet href on line 5 from `chrome://citationmap/content/preferences.css` to `chrome://__addonRef__/content/preferences.css`.

Scaffold prefixes built locale files with `addonRef` — confirmed in Task 1 Step 3, where the baseline contains `citationmap-preferences.ftl`. If this href is left literal while `addonRef` changes, **the preferences pane renders with no strings at all and reports no error.**

- [ ] **Step 4: Fix the preference prefix in the pane script**

In `addon/content/preferences.js`, change line 4 from:

```javascript
const PREF_PREFIX = "extensions.zotero.citationmap.";
```

to:

```javascript
const PREF_PREFIX = "__prefsPrefix__.";
```

- [ ] **Step 5: Convert all 21 preference keys**

Scaffold does **not** rewrite `prefs.js` prefixes automatically — verified against the baseline, where built and source `prefs.js` are identical. Convert them explicitly:

```bash
sed -i 's|extensions\.zotero\.citationmap\.|__prefsPrefix__.|g' addon/prefs.js
```

Confirm all 21 converted:

```bash
grep -c "__prefsPrefix__" addon/prefs.js   # expect: 21
grep -c "citationmap" addon/prefs.js       # expect: 0
```

- [ ] **Step 6: Verify no name literals remain in addon assets**

```bash
grep -rn "citationmap" addon/ --include="*.xhtml" --include="*.css" --include="*.js"
```

Expected: **no output.** The filename `citationMapWindow.xhtml` still contains the name — that is Phase 3's job and does not match this lowercase grep.

- [ ] **Step 7: Verify the build is still byte-identical**

```bash
npm run check
npm run build
diff -r ../meristema-baseline .scaffold/build
```

Expected: **no output from `diff -r`.**

This is the single most valuable check in the plan. It proves every placeholder resolves to exactly the string it replaced — that the substitution mechanism reached all of them, and that none was silently left untouched. If `diff` reports a changed file, a placeholder is not being substituted; inspect that file in `.scaffold/build` and confirm the token spelling matches a key in `build.define`.

- [ ] **Step 8: Commit**

```bash
git add addon
git commit -m "Drive addon asset name references from build placeholders

Static assets under addon/ hardcoded roughly 60 plugin-name references that no
compiler checks and that fail silently at runtime: five chrome:// URLs, the
detached window type, the Fluent localization href, the preference prefix in
preferences.js, and the 21 keys in prefs.js.

They now use the __addonRef__ and __prefsPrefix__ placeholders that scaffold
substitutes from build.define, as bootstrap.js and manifest.json already did.

Built output is byte-identical to before this change."
```

---

### Task 4: Delete dead CSS

Twelve classes exist in stylesheets with no reference in `src/`, the XHTML, or the built bundle. They are leftovers from removed features. Deleting them now keeps Phase 3 from renaming rules nobody uses, which would launder dead code into looking intentional.

**Files:**

- Modify: `addon/content/graph.css`, `addon/content/preferences.css`, `addon/content/zoteroPane.css` (whichever contain the rules below)

**Interfaces:**

- Consumes: nothing.
- Produces: a smaller stylesheet set; no selector referenced anywhere is removed.

- [ ] **Step 1: Re-confirm each class is genuinely unreferenced**

```bash
for c in citation-map-add-relation-button citation-map-dialog-close \
         citation-map-ignored-relation citation-map-local-result \
         citation-map-local-results citation-map-options-locked \
         citation-map-progress-bar citation-map-progress-track \
         citation-map-relation-dialog citation-map-relation-dialog-header \
         citation-map-relation-dialog-overlay citation-map-update-library-option; do
  n=$(grep -rF "$c" src addon/content/*.xhtml 2>/dev/null | wc -l)
  echo "$c -> $n"
done
```

Expected: every line ends in `-> 0`. **If any is non-zero, do not delete that one** — it is live and belongs in Task 6 instead.

- [ ] **Step 2: Delete the rule blocks**

Remove each confirmed-dead rule block from its stylesheet, including its declarations and any comment that exists solely to describe it. Do not remove neighbouring rules that share a selector list with a live class — split the list instead, keeping the live selector.

- [ ] **Step 3: Verify nothing live was removed**

```bash
npm run check
npm run build
diff -r ../meristema-baseline .scaffold/build
```

Expected: `diff` reports changes **only** in the stylesheet files you edited, and only as deletions. Inspect the diff and confirm every removed line belongs to one of the twelve classes.

- [ ] **Step 4: Update the baseline**

The build legitimately changed, so refresh the reference for later comparisons:

```bash
rm -rf ../meristema-baseline && cp -r .scaffold/build ../meristema-baseline
```

- [ ] **Step 5: Commit**

```bash
git add addon/content
git commit -m "Delete twelve dead CSS rules

These classes appear in no TypeScript, no XHTML, and not in the built bundle.
They are leftovers from removed features: a relation dialog, a progress bar,
and a local-results list.

Removing them before the rename avoids carrying dead rules across it, which
would make them look intentional."
```

---

# Phase 2 — Flip the identity

### Task 5: Rename the plugin in `package.json`

One config block. Everything made config-driven in Phase 1 follows automatically.

**Files:**

- Modify: `package.json`

**Interfaces:**

- Consumes: nothing.
- Produces: `config.addonRef === "meristema"`, `config.prefsPrefix === "extensions.zotero.meristema"`, `config.addonInstance === "Meristema"`, consumed by every `config` reference in `src/` and every `__token__` in `addon/`.

- [ ] **Step 1: Rewrite the config block**

In `package.json`, replace the `config` block with:

```json
  "config": {
    "addonName": "Meristema",
    "addonID": "meristema@daniel-locatelli",
    "addonRef": "meristema",
    "addonInstance": "Meristema",
    "prefsPrefix": "extensions.zotero.meristema"
  },
```

- [ ] **Step 2: Update the surrounding metadata**

Set `name` to `"meristema-zotero"` to match the repository named in the spec. Set `description` to:

```json
  "description": "Think with your literature, inside Zotero. Citation networks, bibliometric data, and paper discovery for Zotero 9 and 10.",
```

Point `repository.url` at `git+https://github.com/daniel-locatelli/meristema-zotero.git`, `bugs.url` at `https://github.com/daniel-locatelli/meristema-zotero/issues`, and `homepage` at `https://github.com/daniel-locatelli/meristema-zotero#readme`.

Leave `version`, `license`, `author`, `engines`, `scripts`, `devDependencies` and `prettier` untouched.

- [ ] **Step 3: Build and inspect what changed**

```bash
npm run check
npm run build
diff -r ../meristema-baseline .scaffold/build | head -60
```

Expected: **many** differences now — this is the flip, so difference is success. Confirm the shape is right rather than the absence of change.

- [ ] **Step 4: Verify the identity landed everywhere it should**

```bash
grep -E '"(name|author|homepage_url)"' .scaffold/build/addon/manifest.json
grep '"id"' .scaffold/build/addon/manifest.json
ls .scaffold/build/addon/locale/en-US/
ls .scaffold/build/addon/content/scripts/
head -3 .scaffold/build/addon/prefs.js
grep -n "localization" .scaffold/build/addon/content/preferences.xhtml
```

Expected, all of which must hold:

- manifest `name` is `Meristema`, `author` is `Daniel Nunes Locatelli`, `id` is `meristema@daniel-locatelli`
- locale files are `meristema-addon.ftl`, `meristema-mainWindow.ftl`, `meristema-preferences.ftl`
- the bundle is `meristema.js`
- `prefs.js` keys read `extensions.zotero.meristema.*`
- the localization href reads `meristema-preferences.ftl` and **matches the locale filename exactly** — this is the pairing that Task 3 Step 3 exists to guarantee

- [ ] **Step 5: Confirm no stale references survive in the build**

```bash
grep -rl "citationmap" .scaffold/build/ | grep -v "\.map$"
```

Expected: **no output.** A hit here means a reference escaped Phase 1 — find it, fix it in `addon/` or `src/` as a placeholder or `config` reference rather than a retyped literal, and rebuild.

- [ ] **Step 6: Commit**

```bash
git add package.json
git commit -m "Rename the plugin to Meristema

Flip the config block: addonName, addonID, addonRef, addonInstance and
prefsPrefix. Because Phase 1 made every name reference config-driven, this
propagates to chrome URLs, Fluent filenames, preference keys, the bundle name,
the SQLite databases, the tab type, and the Zotero global.

Point name, repository, bugs and homepage at meristema-zotero.

A meristem is the tissue where new growth originates. The Explore view grows
outward from seed papers, which is the same operation."
```

---

# Phase 3 — Rename what is genuinely literal

### Task 6: Rename CSS classes and preference-pane element ids

95 CSS classes and ~30 element ids. These are matched by string at runtime, so a half-applied rename typechecks perfectly and fails only visually. **Rename each name across its stylesheet and its emitter in the same step**, never one file at a time.

**Files:**

- Modify: `addon/content/graph.css`, `preferences.css`, `zoteroPane.css`, `tabIcon.css`
- Modify: `addon/content/preferences.xhtml`, `graph.xhtml`, `citationMapWindow.xhtml`, `preferences.js`
- Modify: every file under `src/` that emits a `citation-map-` class

**Interfaces:**

- Consumes: nothing.
- Produces: the `meristema-` class and id namespace. No TypeScript signatures change.

- [ ] **Step 1: Rename every class and id in one pass across all consumers**

Because both prefixes are unique strings appearing only in this role, a single global substitution across stylesheets, markup and TypeScript is safer than file-by-file edits — it cannot leave the two halves disagreeing.

```bash
files=$(grep -rl "citation-map-\|zotero-prefpane-citationmap-" src addon)
sed -i 's|zotero-prefpane-citationmap-|zotero-prefpane-meristema-|g; s|citation-map-|meristema-|g' $files
```

Order matters in that `sed`: the prefpane pattern is substituted first because it does not overlap the class pattern, and doing it second would be a no-op anyway. Both are applied to the same file list in one pass.

- [ ] **Step 2: Check the one runtime-composed class survived**

`src/services/updateProgressService.ts:286` builds a class name in two literal halves. Confirm both were rewritten:

```bash
sed -n '284,290p' src/services/updateProgressService.ts
```

Expected: `meristema-progress-action` and `meristema-progress-action-danger`, both present as literals.

- [ ] **Step 3: Verify counts balance**

```bash
grep -rc "citation-map-" src addon | grep -v ":0" || echo "clean"
grep -rc "zotero-prefpane-citationmap-" src addon | grep -v ":0" || echo "clean"
```

Expected: `clean` printed twice.

- [ ] **Step 4: Verify every emitted class still has a rule**

For each class emitted from TypeScript, confirm a matching selector exists in some stylesheet — this catches a rename that hit the emitter but not the stylesheet:

```bash
for c in $(grep -rhoE "meristema-[a-z0-9-]+" src | sort -u); do
  grep -rqF "$c" addon/content/*.css || echo "  NO RULE: $c"
done
echo "(done)"
```

Expected: only `(done)`. Any `NO RULE` line is either a genuine miss or a class that never had a rule; check it against the baseline stylesheet before dismissing it.

- [ ] **Step 5: Verify and commit**

```bash
npm run check
npm run build
git add src addon
git commit -m "Rename CSS classes and prefpane element ids to the meristema namespace

95 classes from citation-map-* to meristema-*, and ~30 element ids from
zotero-prefpane-citationmap-* to zotero-prefpane-meristema-*.

Applied across stylesheets, markup and the TypeScript emitters in a single
pass, because these are matched by string at runtime: renaming one side alone
typechecks cleanly and fails only visually."
```

---

### Task 7: Rename Fluent message ids and the visible strings

**Files:**

- Modify: `addon/locale/en-US/addon.ftl`, `mainWindow.ftl`, `preferences.ftl`
- Modify: every `src/` call site referencing those ids

**Interfaces:**

- Consumes: nothing.
- Produces: `meristema-` prefixed Fluent ids, and "Meristema" as the visible product name in the UI.

- [ ] **Step 1: Rename the message ids across locale files and call sites**

```bash
files=$(grep -rl "citation-map-" src addon/locale)
sed -i 's|citation-map-|meristema-|g' $files
```

If Task 6 already cleared `src/`, this only touches `addon/locale/`. Run it regardless — it is idempotent.

- [ ] **Step 2: Change the three visible product-name strings**

In `addon/locale/en-US/addon.ftl`, the two header entries currently read `Citation Map`:

```
meristema-item-pane-header = Meristema
meristema-item-pane-sidenav = Meristema
```

In `addon/locale/en-US/mainWindow.ftl` line 2, the menu `.label` currently reads `Citation Map`; change it to `Meristema`.

- [ ] **Step 3: Update remaining prose that names the product**

`addon/locale/en-US/preferences.ftl:4` reads "... for Citation Map metrics and values." Change "Citation Map" to "Meristema". Leave every other use of the word _citation_ alone — "citation data provider", "Citation Data Providers", "citation data" are all domain vocabulary.

- [ ] **Step 4: Verify no Fluent id is referenced without a definition**

```bash
for id in $(grep -rhoE "^meristema-[a-z0-9-]+" addon/locale/en-US/*.ftl | sort -u); do
  grep -rqF "$id" src addon/content || echo "  UNUSED: $id"
done
for id in $(grep -rhoE "meristema-[a-z0-9-]+" src addon/content/*.xhtml | sort -u); do
  grep -rqF "$id" addon/locale/en-US/ || echo "  UNDEFINED: $id"
done
echo "(done)"
```

`UNUSED` lines are tolerable — some ids are attribute-scoped and referenced indirectly. **`UNDEFINED` lines are bugs**: a call site asking for a string that no longer exists, which renders as a raw id in the UI. Fix every one before committing.

- [ ] **Step 5: Verify and commit**

```bash
npm run check
npm run build
grep -rn "Citation Map" addon/locale/    # expect: no output
git add addon/locale src
git commit -m "Rename Fluent message ids and show Meristema in the UI

Message ids move to the meristema- prefix. The item-pane header, the item-pane
sidenav, and the tools menu label now read Meristema instead of Citation Map.

The standalone word citation is left alone throughout: citation data, citation
counts and Citation Data Providers are domain vocabulary, not the product name."
```

---

### Task 8: Rename internal TypeScript symbols to domain names

Per the spec's naming rule, internal symbols take **domain** names, not the product name. `CitationMapAPI` is the sole exception: it types the `Zotero.Meristema` global and therefore genuinely is the product surface.

**Files:**

- Modify: all of `src/` and `test/architecture.test.ts`
- Rename: `src/services/citationMapInstancePolicy.ts` to `src/services/graphInstancePolicy.ts`
- Rename: `src/services/citationMapScopePolicy.ts` to `src/services/graphScopePolicy.ts`
- Rename: `addon/content/citationMapWindow.xhtml` to `addon/content/graphWindow.xhtml`

**Interfaces:**

- Consumes: everything from Tasks 2 through 7.
- Produces: the final internal vocabulary. `GraphViewKind`, `GraphViewController`, `GraphCacheStatus`, `GraphFocusResult`, `ViewInstanceDescriptor`, `IconName`, `MeristemaAPI`, and `openGraphWindow` / `renderGraphView` / `getOpenGraphViews` and their siblings.

- [ ] **Step 1: Rename the seven exported types**

Apply across `src/` and `test/`, longest names first so no substitution corrupts a longer one:

```bash
files=$(grep -rl "CitationMap" src test)
sed -i \
  -e 's|CitationMapInstanceDescriptor|ViewInstanceDescriptor|g' \
  -e 's|CitationMapViewController|GraphViewController|g' \
  -e 's|CitationMapCacheStatus|GraphCacheStatus|g' \
  -e 's|CitationMapFocusResult|GraphFocusResult|g' \
  -e 's|CitationMapViewKind|GraphViewKind|g' \
  -e 's|CitationMapIconName|IconName|g' \
  -e 's|CitationMapAPI|MeristemaAPI|g' \
  $files
npm run check
```

`npm run check` must pass before moving on. TypeScript catches every missed reference here, which is why the type rename is safe to do wholesale.

- [ ] **Step 2: Rename the functions**

The remaining `CitationMap` occurrences are function names and marker constants, all following one of two shapes. Apply the general rules, then handle the exceptions:

```bash
files=$(grep -rl "CitationMap\|citationMap" src test)
sed -i \
  -e 's|openCitationMapAndSelectItems|openGraphAndSelectItems|g' \
  -e 's|openCitationMapFocusItems|openFocusItems|g' \
  -e 's|openCitationMapFocusItem|openFocusItem|g' \
  -e 's|openNewCitationMapFocusWindow|openNewFocusWindow|g' \
  -e 's|openDetachedCitationMapWindow|openDetachedGraphWindow|g' \
  -e 's|openNewCitationMapWindow|openNewGraphWindow|g' \
  -e 's|closeCitationMapForWindow|closeGraphForWindow|g' \
  -e 's|selectReusableCitationMapInstance|selectReusableGraphInstance|g' \
  -e 's|citationMapInstanceShouldRender|graphInstanceShouldRender|g' \
  -e 's|citationMapViewBaseTitle|graphViewBaseTitle|g' \
  -e 's|nextCitationMapViewTitle|nextGraphViewTitle|g' \
  -e 's|isCitationMapTabDescriptor|isGraphTabDescriptor|g' \
  -e 's|installCitationMapTabHooks|installGraphTabHooks|g' \
  -e 's|registerCitationMapPreferencePane|registerPreferencePane|g' \
  -e 's|unregisterCitationMapPreferenceObservers|unregisterPreferenceObservers|g' \
  -e 's|cancelPendingCitationMapRefreshes|cancelPendingGraphRefreshes|g' \
  -e 's|normalizedCitationMapItemIDs|normalizedScopeItemIDs|g' \
  -e 's|appendUniqueCitationMapKeys|appendUniqueScopeKeys|g' \
  -e 's|extendCitationMapItemScope|extendItemScope|g' \
  -e 's|replaceCitationMapItemScope|replaceItemScope|g' \
  -e 's|activateCitationMapCollection|activateGraphCollection|g' \
  -e 's|activateCitationMapItems|activateGraphItems|g' \
  -e 's|openCitationMapCollection|openGraphForCollection|g' \
  -e 's|openCitationMapSettings|openSettings|g' \
  -e 's|createCitationMapIcon|createIcon|g' \
  -e 's|refreshOpenCitationMapViews|refreshOpenGraphViews|g' \
  -e 's|getOpenCitationMapViews|getOpenGraphViews|g' \
  -e 's|getCitationMapViewController|getGraphViewController|g' \
  -e 's|destroyCitationMapView|destroyGraphView|g' \
  -e 's|renderCitationMapView|renderGraphView|g' \
  -e 's|renameCitationMapView|renameGraphView|g' \
  -e 's|openCitationMapInView|openGraphInView|g' \
  -e 's|openCitationMapWindow|openGraphWindow|g' \
  -e 's|closeCitationMapWindow|closeGraphWindow|g' \
  $files
npm run check
```

Four functions are not named individually because a prefix substitution
rewrites them: `openCitationMapAndSelectItemsInNewTab` and
`...InView` ride along with `openCitationMapAndSelectItems`, and
`openCitationMapFocusItemsInNewTab` and `...InView` ride along with
`openCitationMapFocusItems`. Their suffixes are preserved, so they land as
`openGraphAndSelectItemsInView` and `openFocusItemsInView`. Do not add separate
rules for them.

Each `-e` is ordered so that a longer name is substituted before any shorter name that is its prefix — `openCitationMapFocusItems` before `openCitationMapFocusItem`, `openNewCitationMapFocusWindow` before `openNewCitationMapWindow`, `openCitationMapAndSelectItems` before `openCitationMapInView`. Do not reorder them.

- [ ] **Step 3: Rename the remaining marker constants**

`src/services/windowService.ts:24-27` holds internal marker strings still carrying the old name:

```typescript
const TAB_STATE_FILTER_MARKER = "__citationMapStateFilterInstalled";
const TAB_HOOK_MARKER = "__citationMapTabHooksInstalled";
const NETWORK_ICON_TYPE = "citation-map-network";
const CONTEXT_HANDLER_MARKER = "__citationMapContextHandlerInstalled";
const LIBRARY_FILTER_MARKER = "citationMapLibraryFilterInstalled";
```

`NETWORK_ICON_TYPE` should already read `meristema-network` after Task 6. Rewrite the four markers to:

```typescript
const TAB_STATE_FILTER_MARKER = "__meristemaStateFilterInstalled";
const TAB_HOOK_MARKER = "__meristemaTabHooksInstalled";
const CONTEXT_HANDLER_MARKER = "__meristemaContextHandlerInstalled";
const LIBRARY_FILTER_MARKER = "meristemaLibraryFilterInstalled";
```

These are properties stamped onto Zotero window objects to avoid double-installing hooks. They are namespace markers, not domain concepts, so they take the product name per the naming rule.

Also at `src/services/windowService.ts:74`, the instance id prefix should now read `meristema-` after Task 6; confirm it does.

- [ ] **Step 4: Rename the three files and their imports**

```bash
git mv src/services/citationMapInstancePolicy.ts src/services/graphInstancePolicy.ts
git mv src/services/citationMapScopePolicy.ts src/services/graphScopePolicy.ts
git mv addon/content/citationMapWindow.xhtml addon/content/graphWindow.xhtml
files=$(grep -rl "citationMapInstancePolicy\|citationMapScopePolicy\|citationMapWindow" src test addon)
sed -i \
  -e 's|citationMapInstancePolicy|graphInstancePolicy|g' \
  -e 's|citationMapScopePolicy|graphScopePolicy|g' \
  -e 's|citationMapWindow|graphWindow|g' \
  $files
npm run check
```

The third substitution also fixes `DETACHED_WINDOW_URL` at `src/services/windowService.ts:29`, which points at the renamed XHTML through a `chrome://` URL — a runtime string TypeScript cannot check. Confirm it explicitly:

```bash
grep -n "DETACHED_WINDOW_URL" src/services/windowService.ts
```

Expected: the URL ends in `/content/graphWindow.xhtml`.

- [ ] **Step 5: Fix stale prose in comments**

Doc comments still describing "Citation Map tabs" or "the selected Citation Map" now name a product that no longer matches the symbols around them. Update them to say "graph view" or "Meristema" as fits the sentence. `src/services/graphInstancePolicy.ts` lines 14 and 44 are two such comments.

- [ ] **Step 6: Verify and commit**

```bash
npm run check
grep -rn "CitationMap\|citationMap" src test addon   # expect: no output
npm run build
git add -A
git commit -m "Rename internal symbols to domain names

Seven exported types and 36 functions carried the product name. They now carry
domain names: GraphViewKind rather than MeristemaViewKind, openGraphWindow
rather than openMeristemaWindow. Embedding the product name in internal
identifiers would leave the same debt to pay at the next rename.

MeristemaAPI is the one exception: it types the Zotero.Meristema global and so
genuinely is the product surface.

Also renames citationMapInstancePolicy and citationMapScopePolicy to
graphInstancePolicy and graphScopePolicy, and citationMapWindow.xhtml to
graphWindow.xhtml, including the chrome:// URL that points at it."
```

---

### Task 9: Update the README and documentation

**Files:**

- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-27-meristema-rename-design.md` (status line only)

**Interfaces:**

- Consumes: the final name and repository decisions.
- Produces: user-facing documentation naming Meristema.

- [ ] **Step 1: Rewrite the title and opening**

Change the README title from `# Zotero Citation Map:` to `# Meristema`. Rewrite the opening paragraph to:

```markdown
Meristema is a plugin for Zotero 9 and 10 that brings citation networks,
bibliometric data, and paper discovery directly into your Zotero library.

A meristem is the tissue at a shoot or root tip where new growth originates.
That is what this plugin does with a library: the Explore view grows outward
from seed papers, following references and citing works to the frontier of what
you already have.
```

Keep the existing fork banner unchanged — it still names the upstream project correctly, and the rename does not alter the attribution.

- [ ] **Step 2: Update the release link and image alt text**

Point the installation release link at `https://github.com/daniel-locatelli/meristema-zotero/releases/latest`. Change the overview image alt text from `zotero-citation-map overview` to `Meristema overview`.

- [ ] **Step 3: Add a naming note to the Acknowledgements**

After the existing upstream credit, add:

```markdown
The plugin was renamed from Zotero Citation Map to Meristema when this fork
diverged. See [NOTICE](NOTICE) for the full origin and modification statement.
```

- [ ] **Step 4: Mark the spec implemented**

In the spec, change `Status: approved, not yet implemented` to `Status: implemented`.

- [ ] **Step 5: Verify and commit**

```bash
npm run lint:check
grep -rn "Citation Map" README.md    # expect: only the fork banner and the naming note
git add README.md docs
git commit -m "Rename to Meristema in the README

Retitle, explain the name in the opening, point the release link at
meristema-zotero, and note the rename in the Acknowledgements.

The fork banner is unchanged: it names the upstream project, which the rename
does not affect."
```

---

# Phase 4 — Verify and move

### Task 10: Full verification against the spec's acceptance criteria

Nothing before this proves the plugin actually works. `npm run check` cannot see a broken `chrome://` URL, a missing Fluent string, or a CSS class whose rule went missing.

**Files:** none modified, unless a defect is found.

**Interfaces:**

- Consumes: all prior tasks.
- Produces: evidence the rename is complete and correct.

- [ ] **Step 1: The grep gate**

```bash
grep -rniE "citation.?map" src addon test
```

Expected: **no output.** Per the spec, the only permitted survivors are `citation` as standalone domain vocabulary, which this pattern does not match.

- [ ] **Step 2: The build gate**

```bash
npm run build
grep -rl "citationmap" .scaffold/build/ | grep -v "\.map$"    # expect: no output
grep -E '"(name|author)"' .scaffold/build/addon/manifest.json
grep '"id"' .scaffold/build/addon/manifest.json
```

Expected: manifest `name` is `Meristema`, `author` is `Daniel Nunes Locatelli`, `id` is `meristema@daniel-locatelli`.

- [ ] **Step 3: The unit-test gate**

```bash
npm run test
```

This launches Zotero. Expected: all tests pass, including the tab-descriptor test rewritten in Task 2 — which now passes only if `config.addonRef` and the tab type genuinely agree.

If Zotero is unavailable in this environment, record that the gate was skipped. **Do not report the rename verified without it**, and carry it into Step 4.

- [ ] **Step 4: Manual install into a clean profile**

Build the XPI, install it into a **fresh** Zotero 9 or 10 profile, and confirm every item:

- [ ] Appears as **Meristema** under Tools then Plugins, attributed to Daniel Nunes Locatelli
- [ ] The Tools menu entry reads **Meristema** and opens a view
- [ ] A **Collection Graph** view opens and renders nodes, with no console errors
- [ ] An **Explore** view opens from a seed paper and expands
- [ ] The graph tab icon renders — this is the check for `chrome://__addonRef__/content/icons/network.svg` in `tabIcon.css`
- [ ] The item pane section header reads **Meristema** and shows metrics
- [ ] The preferences pane opens **with all its text** — this is the check for the Fluent href in Task 3 Step 3; raw ids or blank labels mean that pairing broke
- [ ] The preferences pane's trash icon renders — the check for the `chrome://` URL in `preferences.css`
- [ ] Toggling a provider persists across a Zotero restart
- [ ] `extensions.zotero.meristema.*` keys exist in the profile's `prefs.js`, and no `extensions.zotero.citationmap.*` key does
- [ ] `meristema.sqlite` and `meristema-external.sqlite` are created in the profile directory
- [ ] Detaching a graph into its own window works — the check for the renamed `graphWindow.xhtml` and its `windowtype`
- [ ] Export to PNG, CSV and JSON each produce a file

- [ ] **Step 5: Record the result**

If every item passes, the rename is verified. If any fails, fix it, return to Step 1, and run the whole gate again — a fix in one string can break another.

- [ ] **Step 6: Commit any fixes**

Only if Step 5 found defects. Otherwise nothing to commit.

---

### Task 11: Move to the new repository

Do this **only after Task 10 passes**, so the new repository's first push already says Meristema throughout.

**Files:** none in the working tree; this is repository plumbing.

**Interfaces:**

- Consumes: a verified, fully renamed tree.
- Produces: `daniel-locatelli/meristema-zotero` carrying the complete history.

- [ ] **Step 1: Merge the branch to `main` first**

This work is on `zotero-10-compat`. Merge it so the new repository's default branch is the renamed code, not a stale `main`.

```bash
git checkout main
git merge zotero-10-compat
npm run check
```

- [ ] **Step 2: Create the empty repository**

Create `daniel-locatelli/meristema-zotero` on GitHub with **no** README, license, or `.gitignore` — any initial commit creates an unrelated history that the push would then conflict with.

```bash
gh repo create daniel-locatelli/meristema-zotero --public \
  --description "Think with your literature, inside Zotero."
```

- [ ] **Step 3: Repoint origin, keep upstream**

Per the repository convention, address the remote by SSH alias rather than the bare `git@github.com:` form.

```bash
git remote set-url origin gh-daniel-locatelli:daniel-locatelli/meristema-zotero.git
git remote -v
```

Expected: `origin` points at `meristema-zotero`; `upstream` still points at `AlessMor/zotero-citation-map` so improvements can be pulled and fixes sent back.

- [ ] **Step 4: Push the complete history**

```bash
git push -u origin --all
git push origin --tags
```

Pushing the full history is the point: Alessandro Morandi's 36 commits keep their original author metadata, which is stronger evidence of provenance than a GitHub fork banner and is what backs the dated-record claim in `NOTICE`.

- [ ] **Step 5: Confirm the history transferred intact**

```bash
git log --oneline | wc -l
git shortlog -sne | head
```

Expected: the full commit count, and Alessandro Morandi still listed as an author with his original commits.

- [ ] **Step 6: Archive the old fork**

On `daniel-locatelli/zotero-citation-map`, replace the README with a pointer to the new home, commit it, then archive the repository through GitHub's settings. **Archive rather than delete** — deleting breaks any existing link, archiving preserves them and is honest about what happened.

- [ ] **Step 7: Move the local checkout**

```bash
cd ..
mv zotero-citation-map meristema-zotero
cd meristema-zotero
npm run check
```

This matches the `C:\repos\<provider>\<account>\<repo>` convention.

- [ ] **Step 8: Clean up the baseline**

```bash
rm -rf ../meristema-baseline
```

---

## Notes for whoever executes this

**The one thing not to shortcut.** Phase 1 looks like busywork — you edit dozens of lines and prove nothing changed. That proof _is_ the deliverable. Those references fail silently, and Phase 1 converts "did I find them all?" into a `diff` that answers definitively. If you skip ahead to Phase 2, you inherit the invisible-breakage problem the whole plan is shaped to avoid.

**If a `diff -r` in Task 2 or 3 is not empty**, do not adjust the baseline to make it pass. Read the difference. It is telling you a substitution changed behaviour, which is exactly what those tasks must not do.

**If you find a name reference this plan did not anticipate**, prefer making it config-driven (`config.addonRef` in `src/`, `__addonRef__` in `addon/`) over retyping it with the new name. That is the difference between fixing this rename and fixing every future one.
