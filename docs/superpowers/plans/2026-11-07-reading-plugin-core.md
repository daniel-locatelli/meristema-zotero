# Meristema Reading plugin core (R1 step 2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `zotero-meristema-reading` into a Zotero plugin that keeps read
state (Mark as menu, one state note, merge of sync duplicates, the `_reading`
and `_read` tag mirror), makes reading lists from a folder, and shows a Step
column.

**Architecture:** Three layers. `src/format/` (done in step 1, unchanged here)
parses and writes the notes. `src/domain/` is new pure logic over the format:
which state note to keep, what a mark changes, which tags to add or remove,
which list note a folder uses, the Step column's cells. It runs under
`node --test`. `src/zotero/` is the only code that touches Zotero: one serial
work queue, one notifier observer, a state store, a list store, the column and
the menus. The Zotero suite drives the running plugin through its own menus and
through `Zotero.MeristemaReading.api`, never by importing `src/zotero/`.

**Tech Stack:** TypeScript, zotero-plugin-scaffold 0.8 (esbuild, mocha Zotero
suite), zotero-types, Node 24 type stripping with `node --test` and chai,
prettier, eslint with `@zotero-plugin/eslint-config`.

Spec: `meristema-zotero/docs/superpowers/specs/2026-11-06-reading-lists-design.md`
sections 1 and 2. This plan covers the store, the tag mirror, the folder menu,
the item menu and the Step column. The sidebar section and list tab are plan 2b.
The Python port and `zot.py reading-list` are plan 2c.

## Global Constraints

- Repo `C:\repos\github\daniel-locatelli\zotero-meristema-reading`. Work on
  branch `plugin-core` off `main`, and fast-forward it to `main` at the end. Do
  not push.
- Display name "Meristema Reading". `addonID` `meristema-reading@daniel-locatelli`,
  `addonRef` `meristemareading`, `addonInstance` `MeristemaReading`.
- Zotero `strict_min_version` "9.0", `strict_max_version` "10.\*"
  (`Zotero.MenuManager` needs 9).
- Tags, verbatim from the spec: list notes `meristema-reading-list`, the state
  note `meristema-reading-state`, mirror tags `_reading` and `_read`. Use the
  constants `READING_LIST_TAG`, `READ_STATE_TAG` and `MIRROR_TAGS` from
  `src/format/`, never literals, in `src/`.
- Spec, verbatim: "Unread is stored only as a tombstone after un-marking, so a
  merge cannot bring back an older Read; an absent paper is Unread."
- Spec, verbatim: "It lives in one standalone note in the user's own library,
  outside any folder".
- Spec, verbatim: "the plugin mirrors the state onto papers in the user's own
  library as `_reading` and `_read` tags, rewritten from the note after every
  change and at startup. The mirror is one way: a tag added or removed by hand
  is overwritten, never read. Group items get no mirror tags."
- Spec, verbatim: "Two state notes (a sync race) are merged per paper [...] the
  plugin keeps the merge and trashes the other." The kept note is the readable
  one with the smallest item key, so two computers that merge the same pair
  keep the same note. A state note that cannot be read is never rewritten or
  trashed. If no state note can be read, marking is refused with a message.
- Spec, verbatim: "One list note per folder. A second one is ignored". The list
  note is the oldest by `dateAdded`, then smallest key.
- A paper's id comes from its DOI field, else its library and key
  (`paperId(paperRefOf(item))`). The DOI field only, not Extra.
- `src/format/` is not edited by this plan.
- `src/domain/` imports only from `src/format/` and itself. It uses no Zotero
  global, so `node --test` can run it.
- No `enum`, `namespace` or parameter properties in `src/format/`,
  `src/domain/` or `test/unit/`: Node strips types and cannot run them.
- Zotero suite cases import only `src/format/`, `src/domain/`,
  `package.json` and `test/zotero/helpers.ts`. The test bundle is a second
  copy of the plugin, so a case that imports `src/zotero/` reads a store that
  never started.
- Lint test code before spending a Zotero run: `npm run check` first, then
  `npm test`. `npm test` starts a second Zotero with its own profile next to
  the user's open Zotero, which is allowed. Wait for one `npm test` to exit
  before starting another (a second run fails with EBUSY on `cert9.db`). Never
  stop the user's own Zotero process.
- Gate on exit codes read plainly, never through a pipe.
- Never commit `.only`. Don't work around git hooks.
- Commits: sentence-case subject, stage by path, message ends with exactly:

  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_011u94ZUBSZPgEppAcs8Tck8
  ```

- Docs are prettier-checked. Never split an inline code span across lines.

## File Structure

```
package.json                 scaffold scripts and dev dependencies (modify)
zotero-plugin.config.ts      scaffold config (create)
eslint.config.mjs            lint config (create)
tsconfig.json                Zotero sandbox types, src + typings (modify)
test/tsconfig.json           adds tests and node types (create)
.env.example                 dev Zotero paths, documented (create)
.gitignore, .prettierignore  ignore .scaffold/, .env, *.xpi (modify)
addon/bootstrap.js           Zotero bootstrap, copied from Meristema (create)
addon/manifest.json          manifest (create)
addon/content/icons/reading.svg   menu icon (create)
addon/locale/en-US/mainWindow.ftl menu labels (create)
typings/global.d.ts          globals (create)
src/index.ts                 creates the addon instance (create)
src/addon.ts                 addon instance and its test API (create)
src/hooks.ts                 startup and shutdown (create)
src/domain/marks.ts          what a mark changes (create)
src/domain/stateNotes.ts     which state note to keep, merged (create)
src/domain/mirrorPlan.ts     which mirror tags to add and remove (create)
src/domain/listNotes.ts      which list note a folder uses; a new list's order; step labels (create)
src/domain/stepColumn.ts     the Step column's cell data and text (create)
src/zotero/report.ts         logs an error to Zotero (create)
src/zotero/queue.ts          one task at a time (create)
src/zotero/items.ts          Zotero item to paper ref, library link, tagged notes (create)
src/zotero/stateStore.ts     read state: load, merge, mark, mirror (create)
src/zotero/listStore.ts      reading lists: cache per folder, Make reading list (create, Task 5)
src/zotero/stepColumn.ts     the Step column (create, Task 5)
src/zotero/notifier.ts       one observer feeding both stores (create)
src/zotero/menus.ts          item menu and folder menu (create)
test/unit/*.test.ts          one per domain file (create)
test/zotero/helpers.ts       menus, waits, fixtures (create)
test/zotero/startup.test.ts  the plugin starts (create)
test/zotero/readState.test.ts     Mark as, merge, mirror (create)
test/zotero/readingList.test.ts   Make Reading List, Step column (create)
README.md                    what the plugin does (modify, Task 5)
```

---

### Task 1: Plugin skeleton

**Files:**

- Modify: `package.json`, `tsconfig.json`, `.gitignore`, `.prettierignore`
- Create: `zotero-plugin.config.ts`, `eslint.config.mjs`, `test/tsconfig.json`,
  `.env.example`, `.env` (git-ignored), `addon/bootstrap.js`,
  `addon/manifest.json`, `addon/content/icons/reading.svg`,
  `addon/locale/en-US/mainWindow.ftl`, `typings/global.d.ts`, `src/index.ts`,
  `src/addon.ts`, `src/hooks.ts`, `test/zotero/startup.test.ts`

**Interfaces:**

- Produces: `Zotero.MeristemaReading` (an `Addon` with `data.initialized`,
  `data.alive`, `hooks`); `hooks.onStartup/onMainWindowLoad/onMainWindowUnload/onShutdown`;
  `config` from `package.json` (`addonRef` `meristemareading`). Later tasks
  rewrite `src/addon.ts` and `src/hooks.ts`.

- [ ] **Step 1: Branch**

```bash
cd /c/repos/github/daniel-locatelli/zotero-meristema-reading
git switch -c plugin-core
```

- [ ] **Step 2: Write `package.json`**

Replace the whole file with:

```json
{
  "name": "zotero-meristema-reading",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "packageManager": "npm@11.18.0",
  "description": "Ordered reading lists for Zotero, with read state kept per paper.",
  "config": {
    "addonName": "Meristema Reading",
    "addonID": "meristema-reading@daniel-locatelli",
    "addonRef": "meristemareading",
    "addonInstance": "MeristemaReading"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/daniel-locatelli/zotero-meristema-reading.git"
  },
  "author": "Daniel Nunes Locatelli",
  "homepage": "https://github.com/daniel-locatelli/zotero-meristema-reading#readme",
  "scripts": {
    "start": "zotero-plugin serve",
    "typecheck": "tsc --noEmit && tsc --noEmit -p test",
    "lint:check": "prettier --check . && eslint .",
    "lint:fix": "prettier --write . && eslint . --fix && prettier --write .",
    "test:unit": "node --import ./test/nodeResolve.mjs --test \"test/unit/**/*.test.ts\"",
    "check": "npm run lint:check && npm run typecheck && npm run test:unit",
    "build": "npm run check && zotero-plugin build",
    "test": "zotero-plugin test --no-watch"
  },
  "devDependencies": {
    "@types/chai": "^5.2.3",
    "@types/mocha": "^10.0.10",
    "@types/node": "^26.2.0",
    "@zotero-plugin/eslint-config": "^0.6.7",
    "chai": "^6.2.1",
    "eslint": "^10.8.1",
    "mocha": "^11.7.5",
    "prettier": "^3.7.4",
    "typescript": "^5.9.3",
    "zotero-plugin-scaffold": "^0.8.7",
    "zotero-types": "^4.1.0-beta.4"
  },
  "engines": {
    "node": ">=24 <27",
    "npm": ">=11.18"
  }
}
```

Run: `npm install`
Expected: exits 0 and updates `package-lock.json`.

- [ ] **Step 3: Write the configs**

`zotero-plugin.config.ts`:

```ts
import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json";

export default defineConfig({
  source: ["src", "addon"],
  dist: ".scaffold/build",

  name: pkg.config.addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,

  updateURL:
    "https://github.com/{{owner}}/{{repo}}/releases/download/release/update.json",
  xpiDownloadLink:
    "https://github.com/{{owner}}/{{repo}}/releases/download/v{{version}}/{{xpiName}}.xpi",

  build: {
    assets: ["addon/**/*.*"],
    define: {
      ...pkg.config,
      author: pkg.author,
      description: pkg.description,
      homepage: pkg.homepage,
      buildVersion: pkg.version,
      buildTime: "{{buildTime}}",
    },
    esbuildOptions: [
      {
        entryPoints: ["src/index.ts"],
        define: {
          __env__: `"${process.env.NODE_ENV}"`,
        },
        bundle: true,
        target: "firefox140",
        sourcemap: process.env.NODE_ENV !== "production",
        outfile: `.scaffold/build/addon/content/scripts/${pkg.config.addonRef}.js`,
      },
    ],
  },

  test: {
    entries: "test/zotero",
    waitForPlugin: `() => Zotero.${pkg.config.addonInstance}.data.initialized`,
  },
});
```

`eslint.config.mjs`:

```js
import zotero from "@zotero-plugin/eslint-config";

export default [
  ...zotero(),
  { ignores: [".scaffold/**", "fixtures/**", "typings/i10n.d.ts"] },
];
```

`tsconfig.json` (replace):

```json
{
  "extends": "zotero-types/entries/sandbox/",
  "compilerOptions": {
    "forceConsistentCasingInFileNames": true,
    "verbatimModuleSyntax": true,
    "noFallthroughCasesInSwitch": true,
    "useUnknownInCatchVariables": true
  },
  "include": ["src", "typings"],
  "exclude": ["node_modules", ".scaffold", "addon"]
}
```

`test/tsconfig.json`:

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "types": ["zotero-types/entries/sandbox", "node"]
  },
  "include": [".", "../src", "../typings"]
}
```

Append to `.gitignore`:

```
.scaffold/
.env
*.xpi
*.tsbuildinfo
```

Append to `.prettierignore`:

```
.scaffold/
*.xpi
```

`.env.example`:

```
# Copy to `.env` (git-ignored) for `npm start` and `npm test`.

# The Zotero binary. Escape the path delimiter as `\\` on win32.
ZOTERO_PLUGIN_ZOTERO_BIN_PATH=/path/to/zotero.exe

# A dev profile and library, apart from your own, so the dev Zotero can run
# beside your normal one. Leaving both empty does not give your real library:
# the scaffold then points your default profile at an empty one.
ZOTERO_PLUGIN_PROFILE_PATH=./.scaffold/profile
ZOTERO_PLUGIN_DATA_DIR=./.scaffold/data
```

`.env`: the same three lines, with
`ZOTERO_PLUGIN_ZOTERO_BIN_PATH=C:\Program Files\Zotero\zotero.exe`.

- [ ] **Step 4: Write the addon files**

`addon/bootstrap.js` (Meristema's, unchanged):

```js
var chromeHandle;

function install(data, reason) {}

async function startup({ id, version, resourceURI, rootURI }, reason) {
  var aomStartup = Components.classes[
    "@mozilla.org/addons/addon-manager-startup;1"
  ].getService(Components.interfaces.amIAddonManagerStartup);
  var manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = aomStartup.registerChrome(manifestURI, [
    ["content", "__addonRef__", rootURI + "content/"],
  ]);
  const ctx = { rootURI };
  ctx._globalThis = ctx;
  Services.scriptloader.loadSubScript(
    `${rootURI}/content/scripts/__addonRef__.js`,
    ctx,
  );
  await Zotero.__addonInstance__.hooks.onStartup();
}

async function onMainWindowLoad({ window }, reason) {
  await Zotero.__addonInstance__?.hooks.onMainWindowLoad(window);
}

async function onMainWindowUnload({ window }, reason) {
  await Zotero.__addonInstance__?.hooks.onMainWindowUnload(window);
}

async function shutdown({ id, version, resourceURI, rootURI }, reason) {
  const appShutdown = reason === APP_SHUTDOWN;
  await Zotero.__addonInstance__?.hooks.onShutdown(appShutdown);
  if (!appShutdown && chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
}

async function uninstall(data, reason) {}
```

`addon/manifest.json`:

```json
{
  "manifest_version": 2,
  "name": "__addonName__",
  "version": "__buildVersion__",
  "description": "__description__",
  "homepage_url": "__homepage__",
  "author": "__author__",
  "icons": {
    "48": "content/icons/reading.svg",
    "96": "content/icons/reading.svg"
  },
  "applications": {
    "zotero": {
      "id": "__addonID__",
      "update_url": "__updateURL__",
      "strict_min_version": "9.0",
      "strict_max_version": "10.*"
    }
  }
}
```

`addon/content/icons/reading.svg` (an open book):

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path fill="context-fill" d="M1 3.5C2.8 2.6 5.3 2.6 7.5 3.8v9.4C5.3 12 2.8 12 1 12.9zm14 0c-1.8-.9-4.3-.9-6.5.3v9.4c2.2-1.2 4.7-1.2 6.5-.3z"/></svg>
```

`addon/locale/en-US/mainWindow.ftl`:

```
# Menu labels. The scaffold prefixes every id with the addonRef at build.
```

`typings/global.d.ts` (Meristema's, unchanged):

```ts
declare const Zotero: any;
declare namespace Zotero {
  type Item = any;
}
declare namespace _ZoteroTypes {
  type DBConnection = any;
  type MainWindow = any;
  interface Prefs {
    PluginPrefsMap: Record<string, string | number | boolean>;
  }
}
declare const addon: import("../src/addon").default;
declare const rootURI: string;
declare const _globalThis: any;
declare const __env__: "development" | "production";

declare const Components: any;
```

- [ ] **Step 5: Write the source entry points**

`src/index.ts`:

```ts
import { config } from "../package.json";
import Addon from "./addon";

if (!(Zotero as any)[config.addonInstance]) {
  const instance = new Addon();
  _globalThis.addon = instance;
  (Zotero as any)[config.addonInstance] = instance;
}
```

`src/addon.ts`:

```ts
import { config } from "../package.json";
import hooks from "./hooks";

class Addon {
  public data: {
    alive: boolean;
    config: typeof config;
    env: "development" | "production";
    initialized: boolean;
  };

  public hooks: typeof hooks;

  constructor() {
    this.data = { alive: true, config, env: __env__, initialized: false };
    this.hooks = hooks;
  }
}

export default Addon;
```

`src/hooks.ts`:

```ts
import { config } from "../package.json";

async function onStartup(): Promise<void> {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);
  for (const win of Zotero.getMainWindows()) await onMainWindowLoad(win);
  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  win.MozXULElement.insertFTLIfNeeded(`${config.addonRef}-mainWindow.ftl`);
}

async function onMainWindowUnload(
  _win: _ZoteroTypes.MainWindow,
): Promise<void> {}

async function onShutdown(_appShutdown: boolean): Promise<void> {
  addon.data.alive = false;
  delete (Zotero as any)[config.addonInstance];
}

export default { onStartup, onMainWindowLoad, onMainWindowUnload, onShutdown };
```

`test/zotero/startup.test.ts`:

```ts
/// <reference types="mocha" />
import { expect } from "chai";
import { config } from "../../package.json";

describe("Meristema Reading startup", function () {
  it("registers the plugin instance", function () {
    const instance = (Zotero as any)[config.addonInstance];
    expect(instance, "the plugin instance").to.exist;
    expect(instance.data.initialized, "initialized").to.equal(true);
  });
});
```

- [ ] **Step 6: Gate the static checks**

Run: `npm run lint:fix` then `npm run check`
Expected: `npm run check` exits 0, with the 94 existing unit tests passing.
Eslint may flag existing files in `src/format/` or `test/unit/`. Fix only by
changes that keep behaviour (for example `_`-prefixed unused names). If a
finding can only be fixed by changing `src/format/` behaviour, stop and report
it.

- [ ] **Step 7: Build and run the Zotero suite**

Run: `npm run build`
Expected: exits 0; `.scaffold/build/` holds the XPI; `typings/i10n.d.ts` is
generated.

Run: `npm test`
Expected: a second Zotero opens, and the run reports `1 passing` and exits 0.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json zotero-plugin.config.ts eslint.config.mjs tsconfig.json test/tsconfig.json .env.example .gitignore .prettierignore addon typings src/index.ts src/addon.ts src/hooks.ts test/zotero/startup.test.ts
git status --short
git commit
```

Also stage any `src/format/` or `test/unit/` file that Step 6's lint fix
touched. Message: `Make the repo a Zotero plugin that starts`, followed by the
two attribution lines.

---

### Task 2: Read-state domain

**Files:**

- Create: `src/domain/marks.ts`, `src/domain/stateNotes.ts`,
  `src/domain/mirrorPlan.ts`
- Test: `test/unit/marks.test.ts`, `test/unit/stateNotes.test.ts`,
  `test/unit/mirrorPlan.test.ts`

**Interfaces:**

- Consumes (from `src/format/readState.ts`): `setState`, `stateOf`,
  `mergeReadStates`, `parseReadState`, `mirrorTag`, `MIRROR_TAGS`,
  `ReadState`, `ReadStateDoc`.
- Produces:
  - `applyMark(doc: ReadStateDoc, ids: readonly string[], state: ReadState, at: string): ReadStateDoc`
    returns `doc` itself when nothing changes.
  - `interface StateNote { key: string; html: string }`
  - `type StatePick = { kind: "none" } | { kind: "unreadable"; keys: string[] } | { kind: "ok"; keeper: string; doc: ReadStateDoc; trash: string[] }`
  - `pickStateNotes(notes: readonly StateNote[]): StatePick`
  - `interface MirrorItem { id: number; paperId: string; tags: readonly string[] }`
  - `interface MirrorChange { id: number; add: string[]; remove: string[] }`
  - `planMirror(doc: ReadStateDoc, items: readonly MirrorItem[]): MirrorChange[]`

- [ ] **Step 1: Write the failing tests**

`test/unit/marks.test.ts`:

```ts
import { describe, it } from "node:test";
import { expect } from "chai";
import { applyMark } from "../../src/domain/marks";
import { emptyReadState, setState } from "../../src/format/readState";

const DOI = "doi:10.1000/abc";
const KEY = "user:ABCD2345";
const T1 = "2026-11-01T10:00:00.000Z";
const T2 = "2026-11-02T10:00:00.000Z";

describe("applyMark", () => {
  it("stores a mark for a paper with no entry", () => {
    const next = applyMark(emptyReadState(), [DOI, KEY], "read", T1);
    expect(next.states).to.deep.equal({
      [DOI]: { state: "read", at: T1 },
      [KEY]: { state: "read", at: T1 },
    });
  });

  it("writes Unread only over a stored entry, as a tombstone", () => {
    const doc = setState(emptyReadState(), DOI, "read", T1);
    const next = applyMark(doc, [DOI, KEY], "unread", T2);
    expect(next.states).to.deep.equal({ [DOI]: { state: "unread", at: T2 } });
  });

  it("returns the same document when nothing changes", () => {
    const empty = emptyReadState();
    expect(applyMark(empty, [KEY], "unread", T1)).to.equal(empty);
    const doc = setState(emptyReadState(), DOI, "reading", T1);
    expect(applyMark(doc, [DOI], "reading", T2)).to.equal(doc);
  });

  it("keeps the date of a paper already in the state", () => {
    const doc = setState(emptyReadState(), DOI, "read", T1);
    const next = applyMark(doc, [DOI, KEY, KEY], "read", T2);
    expect(next.states).to.deep.equal({
      [DOI]: { state: "read", at: T1 },
      [KEY]: { state: "read", at: T2 },
    });
  });

  it("refuses an id that is not a paper id", () => {
    expect(() =>
      applyMark(emptyReadState(), ["__proto__"], "read", T1),
    ).to.throw(RangeError);
  });
});
```

`test/unit/stateNotes.test.ts`:

```ts
import { describe, it } from "node:test";
import { expect } from "chai";
import { pickStateNotes } from "../../src/domain/stateNotes";
import {
  emptyReadState,
  setState,
  writeReadState,
  type ReadState,
} from "../../src/format/readState";

const A = "user:ABCD2345";
const X = "doi:10.1000/x";

function note(key: string, ...entries: [string, ReadState, string][]) {
  const doc = entries.reduce(
    (current, [id, state, at]) => setState(current, id, state, at),
    emptyReadState(),
  );
  return { key, html: writeReadState(doc) };
}

describe("pickStateNotes", () => {
  it("finds nothing in no notes", () => {
    expect(pickStateNotes([])).to.deep.equal({ kind: "none" });
  });

  it("keeps a single readable note as it is", () => {
    const pick = pickStateNotes([
      note("BBBB2222", [A, "read", "2026-11-01T00:00:00Z"]),
    ]);
    expect(pick).to.deep.equal({
      kind: "ok",
      keeper: "BBBB2222",
      doc: {
        version: 1,
        states: { [A]: { state: "read", at: "2026-11-01T00:00:00Z" } },
      },
      trash: [],
    });
  });

  it("merges into the note with the smaller key and trashes the other", () => {
    const pick = pickStateNotes([
      note("ZZZZ9999", [A, "reading", "2026-11-02T00:00:00Z"]),
      note(
        "BBBB2222",
        [A, "read", "2026-11-01T00:00:00Z"],
        [X, "read", "2026-11-01T00:00:00Z"],
      ),
    ]);
    expect(pick).to.deep.equal({
      kind: "ok",
      keeper: "BBBB2222",
      doc: {
        version: 1,
        states: {
          [A]: { state: "reading", at: "2026-11-02T00:00:00Z" },
          [X]: { state: "read", at: "2026-11-01T00:00:00Z" },
        },
      },
      trash: ["ZZZZ9999"],
    });
  });

  it("leaves a note it cannot read alone beside a readable one", () => {
    const pick = pickStateNotes([
      { key: "AAAA2222", html: "<p>not a state note</p>" },
      note("CCCC3333"),
    ]);
    expect(pick).to.deep.equal({
      kind: "ok",
      keeper: "CCCC3333",
      doc: { version: 1, states: {} },
      trash: [],
    });
  });

  it("is unreadable when no note can be read", () => {
    const html =
      '<pre data-meristema-reading-state="1">{"version":2,"states":{}}</pre>';
    expect(pickStateNotes([{ key: "AAAA2222", html }])).to.deep.equal({
      kind: "unreadable",
      keys: ["AAAA2222"],
    });
  });
});
```

`test/unit/mirrorPlan.test.ts`:

```ts
import { describe, it } from "node:test";
import { expect } from "chai";
import { planMirror } from "../../src/domain/mirrorPlan";
import { emptyReadState, setState } from "../../src/format/readState";

const AT = "2026-11-01T00:00:00Z";
const DOI = "doi:10.1000/abc";
const READING = "user:ABCD2345";
const TOMBSTONE = "user:BCDE3456";
const doc = [
  [DOI, "read"],
  [READING, "reading"],
  [TOMBSTONE, "unread"],
].reduce(
  (current, [id, state]) =>
    setState(current, id, state as "read" | "reading" | "unread", AT),
  emptyReadState(),
);

describe("planMirror", () => {
  it("adds the tag of a marked paper", () => {
    expect(
      planMirror(doc, [{ id: 1, paperId: DOI, tags: ["topic"] }]),
    ).to.deep.equal([{ id: 1, add: ["_read"], remove: [] }]);
  });

  it("swaps a stale tag for the state's own", () => {
    expect(
      planMirror(doc, [{ id: 2, paperId: READING, tags: ["_read"] }]),
    ).to.deep.equal([{ id: 2, add: ["_reading"], remove: ["_read"] }]);
  });

  it("takes the tags off an Unread paper, stored or absent", () => {
    expect(
      planMirror(doc, [
        { id: 3, paperId: TOMBSTONE, tags: ["_read"] },
        { id: 4, paperId: "user:CDEF4567", tags: ["_reading", "_read"] },
      ]),
    ).to.deep.equal([
      { id: 3, add: [], remove: ["_read"] },
      { id: 4, add: [], remove: ["_reading", "_read"] },
    ]);
  });

  it("plans nothing for items already right", () => {
    expect(
      planMirror(doc, [
        { id: 1, paperId: DOI, tags: ["_read", "topic"] },
        { id: 5, paperId: "user:DEFG5678", tags: [] },
      ]),
    ).to.deep.equal([]);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npm run test:unit`
Expected: FAIL; the three new files cannot resolve `../../src/domain/...`.

- [ ] **Step 3: Write the implementation**

`src/domain/marks.ts`:

```ts
import {
  setState,
  stateOf,
  type ReadState,
  type ReadStateDoc,
} from "../format/readState";

/**
 * `doc` with each paper set to `state` at `at`. A paper already in that state
 * keeps its entry and its date. Unread is written only over a stored entry, as
 * the tombstone that stops a merge bringing back an older mark. Returns `doc`
 * itself when nothing changes, so the caller can skip the write.
 */
export function applyMark(
  doc: ReadStateDoc,
  ids: readonly string[],
  state: ReadState,
  at: string,
): ReadStateDoc {
  let next = doc;
  for (const id of new Set(ids)) {
    if (stateOf(next, id) === state) continue;
    next = setState(next, id, state, at);
  }
  return next;
}
```

`src/domain/stateNotes.ts`:

```ts
import {
  mergeReadStates,
  parseReadState,
  type ReadStateDoc,
} from "../format/readState";

export interface StateNote {
  key: string;
  html: string;
}

export type StatePick =
  | { kind: "none" }
  | { kind: "unreadable"; keys: string[] }
  | { kind: "ok"; keeper: string; doc: ReadStateDoc; trash: string[] };

/**
 * Which of the user's state notes holds the read state. The readable notes
 * are merged. The one with the smallest key keeps the merge and the others go
 * to the trash: the smallest key rather than the newest note, so two computers
 * that merge the same pair before they sync keep the same note. A note that
 * cannot be read is never rewritten or trashed, and when no note can be read
 * nothing may be written until the user fixes or removes it.
 */
export function pickStateNotes(notes: readonly StateNote[]): StatePick {
  const readable = notes
    .flatMap((note) => {
      const parsed = parseReadState(note.html);
      return parsed.ok ? [{ key: note.key, doc: parsed.value }] : [];
    })
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  if (!readable.length) {
    return notes.length
      ? { kind: "unreadable", keys: notes.map((note) => note.key) }
      : { kind: "none" };
  }
  const [keeper, ...others] = readable;
  return {
    kind: "ok",
    keeper: keeper.key,
    doc: others.reduce(
      (doc, other) => mergeReadStates(doc, other.doc),
      keeper.doc,
    ),
    trash: others.map((other) => other.key),
  };
}
```

`src/domain/mirrorPlan.ts`:

```ts
import {
  MIRROR_TAGS,
  mirrorTag,
  stateOf,
  type ReadStateDoc,
} from "../format/readState";

export interface MirrorItem {
  id: number;
  paperId: string;
  tags: readonly string[];
}

export interface MirrorChange {
  id: number;
  add: string[];
  remove: string[];
}

/**
 * The tag changes that make each item's mirror tag match its read state; an
 * item already right is left out. Callers pass only items in the user's own
 * library: a tag on a group item is every member's, so group items get none.
 */
export function planMirror(
  doc: ReadStateDoc,
  items: readonly MirrorItem[],
): MirrorChange[] {
  const changes: MirrorChange[] = [];
  for (const item of items) {
    const wanted = mirrorTag(stateOf(doc, item.paperId));
    const add = wanted && !item.tags.includes(wanted) ? [wanted] : [];
    const remove = Object.values(MIRROR_TAGS).filter(
      (tag) => tag !== wanted && item.tags.includes(tag),
    );
    if (add.length || remove.length) changes.push({ id: item.id, add, remove });
  }
  return changes;
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npm run lint:fix` then `npm run check`
Expected: exits 0; 108 unit tests pass (94 + 14).

- [ ] **Step 5: Commit**

```bash
git add src/domain/marks.ts src/domain/stateNotes.ts src/domain/mirrorPlan.ts test/unit/marks.test.ts test/unit/stateNotes.test.ts test/unit/mirrorPlan.test.ts
git commit
```

Message: `Decide what a mark changes, which state note keeps the merge, and which tags mirror it`,
then the two attribution lines.

---

### Task 3: Reading-list domain

**Files:**

- Create: `src/domain/listNotes.ts`, `src/domain/stepColumn.ts`
- Test: `test/unit/listNotes.test.ts`, `test/unit/stepColumn.test.ts`

**Interfaces:**

- Consumes (from `src/format/`): `parseReadingList`, `resolveReadingList`,
  `ReadingListDoc`, `FolderItem`, `ResolvedList`, `Parsed`.
- Produces:
  - `interface ListNote { id: number; key: string; dateAdded: string; html: string }`
  - `interface ListPick { id: number; parsed: Parsed<ReadingListDoc>; ignored: number[] }`
  - `pickListNote(notes: readonly ListNote[]): ListPick | null`
  - `newListOrder(folder: readonly FolderItem[], shown: readonly string[] | null): string[]`
  - `interface LabelParts { creator: string; year: string; title: string }`
  - `stepLabel(parts: LabelParts): string`
  - `stepCells(list: ResolvedList): Map<string, string>`
  - `stepText(data: string): string`

- [ ] **Step 1: Write the failing tests**

`test/unit/listNotes.test.ts`:

```ts
import { describe, it } from "node:test";
import { expect } from "chai";
import {
  newListOrder,
  pickListNote,
  stepLabel,
} from "../../src/domain/listNotes";
import { writeReadingList } from "../../src/format/readingList";

function listHtml(topic: string): string {
  return writeReadingList({ version: 1, topic, steps: [] }, (key) => key, {
    kind: "user",
  });
}

describe("pickListNote", () => {
  it("is null for a folder with no list note", () => {
    expect(pickListNote([])).to.equal(null);
  });

  it("picks the oldest note, by date added then key, and ignores the rest", () => {
    const pick = pickListNote([
      {
        id: 3,
        key: "CCCC3333",
        dateAdded: "2026-11-02 10:00:00",
        html: listHtml("third"),
      },
      {
        id: 1,
        key: "DDDD4444",
        dateAdded: "2026-11-01 10:00:00",
        html: listHtml("tied, larger key"),
      },
      {
        id: 2,
        key: "BBBB2222",
        dateAdded: "2026-11-01 10:00:00",
        html: listHtml("chosen"),
      },
    ]);
    expect(pick).to.deep.equal({
      id: 2,
      parsed: { ok: true, value: { version: 1, topic: "chosen", steps: [] } },
      ignored: [1, 3],
    });
  });

  it("returns the chosen note even when it cannot be read", () => {
    expect(
      pickListNote([
        {
          id: 1,
          key: "AAAA2222",
          dateAdded: "2026-11-01 10:00:00",
          html: "<p>x</p>",
        },
      ]),
    ).to.deep.equal({
      id: 1,
      parsed: { ok: false, reason: "no-data" },
      ignored: [],
    });
  });
});

describe("newListOrder", () => {
  const folder = [
    { key: "AAAA2222", title: "beta" },
    { key: "BBBB2222", title: "Alpha" },
    { key: "CCCC3333", title: "gamma" },
  ];

  it("follows the item list, then sorts by title the papers it did not show", () => {
    expect(
      newListOrder(folder, ["CCCC3333", "ZZZZ9999", "AAAA2222", "CCCC3333"]),
    ).to.deep.equal(["CCCC3333", "AAAA2222", "BBBB2222"]);
  });

  it("sorts by title when the item list shows another folder", () => {
    expect(newListOrder(folder, null)).to.deep.equal([
      "BBBB2222",
      "AAAA2222",
      "CCCC3333",
    ]);
  });
});

describe("stepLabel", () => {
  it("joins author, year and title", () => {
    expect(
      stepLabel({ creator: "Lovelace", year: "1843", title: "Notes" }),
    ).to.equal("Lovelace, 1843, Notes");
  });

  it("leaves out what is missing, and names an untitled paper", () => {
    expect(stepLabel({ creator: "", year: "0000", title: " " })).to.equal(
      "Untitled",
    );
    expect(
      stepLabel({
        creator: "Babbage and Lovelace",
        year: "",
        title: "Engines",
      }),
    ).to.equal("Babbage and Lovelace, Engines");
    expect(stepLabel({ creator: "Ada", year: "c.19", title: "T" })).to.equal(
      "Ada, T",
    );
  });
});
```

`test/unit/stepColumn.test.ts`:

```ts
import { describe, it } from "node:test";
import { expect } from "chai";
import { stepCells, stepText } from "../../src/domain/stepColumn";

describe("stepCells", () => {
  const cells = stepCells({
    steps: [
      { step: 1, key: "BBBB2222", why: "" },
      { step: 2, key: "AAAA2222", why: "then this" },
    ],
    unordered: ["CCCC3333", "DDDD4444"],
  });

  it("gives every paper its place, unordered ones marked", () => {
    expect([...cells]).to.deep.equal([
      ["BBBB2222", "00001"],
      ["AAAA2222", "00002"],
      ["CCCC3333", "00003u"],
      ["DDDD4444", "00004u"],
    ]);
  });

  it("sorts as a plain string into reading order", () => {
    const values = [...cells.values()];
    expect([...values].reverse().sort()).to.deep.equal(values);
  });
});

describe("stepText", () => {
  it("shows a step's number and nothing for an unordered paper", () => {
    expect(stepText("00002")).to.equal("2");
    expect(stepText("00003u")).to.equal("");
    expect(stepText("")).to.equal("");
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npm run test:unit`
Expected: FAIL; `../../src/domain/listNotes` and `../../src/domain/stepColumn`
do not resolve.

- [ ] **Step 3: Write the implementation**

`src/domain/listNotes.ts`:

```ts
import type { Parsed } from "../format/common";
import {
  parseReadingList,
  resolveReadingList,
  type FolderItem,
  type ReadingListDoc,
} from "../format/readingList";

export interface ListNote {
  id: number;
  key: string;
  dateAdded: string;
  html: string;
}

export interface ListPick {
  id: number;
  parsed: Parsed<ReadingListDoc>;
  ignored: number[];
}

/**
 * A folder's list note: the oldest of its tagged notes, by date added, then
 * key. The others are ignored, and returned so the sidebar can name them. The
 * chosen note is returned even when it cannot be read, so readers can say so
 * rather than treat the folder as having no list.
 */
export function pickListNote(notes: readonly ListNote[]): ListPick | null {
  const sorted = [...notes].sort((a, b) =>
    a.dateAdded !== b.dateAdded
      ? a.dateAdded < b.dateAdded
        ? -1
        : 1
      : a.key < b.key
        ? -1
        : a.key > b.key
          ? 1
          : 0,
  );
  if (!sorted.length) return null;
  const [chosen, ...ignored] = sorted;
  return {
    id: chosen.id,
    parsed: parseReadingList(chosen.html),
    ignored: ignored.map((note) => note.id),
  };
}

/**
 * The steps of a new list: the folder's papers in the order the item list
 * shows them, when it shows this folder (`shown`), and otherwise by title,
 * as unordered papers sort. Papers the item list did not show, because a
 * search hid them, follow by title.
 */
export function newListOrder(
  folder: readonly FolderItem[],
  shown: readonly string[] | null,
): string[] {
  const inFolder = new Set(folder.map((item) => item.key));
  const first = [...new Set((shown ?? []).filter((key) => inFolder.has(key)))];
  const placed = new Set(first);
  const rest = resolveReadingList(
    { version: 1, topic: "", steps: [] },
    folder.filter((item) => !placed.has(item.key)),
  ).unordered;
  return [...first, ...rest];
}

export interface LabelParts {
  creator: string;
  year: string;
  title: string;
}

/** A step's link text in the note's readable part: author, year, title. */
export function stepLabel(parts: LabelParts): string {
  const year =
    /^\d{4}$/.test(parts.year) && parts.year !== "0000" ? parts.year : "";
  return [parts.creator.trim(), year, parts.title.trim() || "Untitled"]
    .filter(Boolean)
    .join(", ");
}
```

`src/domain/stepColumn.ts`:

```ts
import type { ResolvedList } from "../format/readingList";

/**
 * The Step column's cell data per item key. Every paper in the folder gets its
 * place in reading order, so sorting by the column gives the list's order with
 * the unordered papers after the last step, in the resolver's order. The place
 * is zero-padded so a plain string sort agrees with it, and an unordered
 * paper's ends in "u" so it shows blank.
 */
export function stepCells(list: ResolvedList): Map<string, string> {
  const cells = new Map<string, string>();
  const keys = [...list.steps.map((step) => step.key), ...list.unordered];
  keys.forEach((key, index) => {
    const place = String(index + 1).padStart(5, "0");
    cells.set(key, index < list.steps.length ? place : `${place}u`);
  });
  return cells;
}

/** What a cell shows: the step's number, or nothing for an unordered paper. */
export function stepText(data: string): string {
  return /^\d+$/.test(data) ? String(Number(data)) : "";
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npm run lint:fix` then `npm run check`
Expected: exits 0; 118 unit tests pass (108 + 10).

- [ ] **Step 5: Commit**

```bash
git add src/domain/listNotes.ts src/domain/stepColumn.ts test/unit/listNotes.test.ts test/unit/stepColumn.test.ts
git commit
```

Message: `Choose a folder's list note, a new list's order and the Step column's cells`,
then the two attribution lines.

---

### Task 4: Read-state store, tag mirror and the Mark as menu

**Files:**

- Create: `src/zotero/report.ts`, `src/zotero/queue.ts`, `src/zotero/items.ts`,
  `src/zotero/stateStore.ts`, `src/zotero/notifier.ts`, `src/zotero/menus.ts`,
  `test/zotero/helpers.ts`, `test/zotero/readState.test.ts`
- Modify: `src/addon.ts`, `src/hooks.ts`, `addon/locale/en-US/mainWindow.ftl`

**Interfaces:**

- Consumes: Task 2's `applyMark`, `pickStateNotes`, `planMirror`.
- Produces:
  - `report(error: unknown): void`
  - `enqueue(task: () => Promise<void>): Promise<void>`, `isBusy(): boolean`
  - `libraryLinkOf(libraryID: number): LibraryLink`,
    `paperRefOf(item: Zotero.Item): PaperRef`,
    `isTaggedNote(item: Zotero.Item, tag: string): boolean`,
    `taggedNotes(libraryID: number, tag: string): Promise<Zotero.Item[]>`
  - `startStateStore(): Promise<void>`, `resetStateStore(): void`,
    `markItems(items: Zotero.Item[], state: ReadState): Promise<void>`,
    `stateChanged(): Promise<void>`, `itemsChanged(ids: number[]): Promise<void>`,
    `class UnreadableStateError extends Error`
  - `registerNotifier()`, `unregisterNotifier()`, `whenIdle(): Promise<void>`
  - `registerMenus()`, `unregisterMenus()`
  - `Zotero.MeristemaReading.api.whenIdle(): Promise<void>`
  - Menu l10n ids (after the scaffold's prefix): `meristemareading-mark-submenu`,
    `meristemareading-mark-unread`, `meristemareading-mark-reading`,
    `meristemareading-mark-read`.

- [ ] **Step 1: Write the Zotero helpers and the failing cases**

`test/zotero/helpers.ts`:

```ts
import { expect } from "chai";
import { config } from "../../package.json";
import { READ_STATE_TAG } from "../../src/format/readState";

/** The running plugin: the test bundle's own copy of `src/` never started. */
export function plugin(): any {
  return (Zotero as any)[config.addonInstance];
}

/** Settles once the plugin has read every event and finished its work. */
export function idle(): Promise<void> {
  return plugin().api.whenIdle();
}

export function delay(ms: number): Promise<void> {
  return Zotero.Promise.delay(ms) as unknown as Promise<void>;
}

export async function waitFor<T>(
  probe: () => T | null | undefined | false,
  timeoutMs: number,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await delay(50);
  }
}

export function shown(popup: Element): Promise<void> {
  return new Promise((resolve) => {
    if ((popup as any).state === "open") return resolve();
    popup.addEventListener("popupshown", () => resolve(), { once: true });
  });
}

export function command(element: Element): void {
  const win = element.ownerDocument.defaultView as any;
  element.dispatchEvent(new win.Event("command", { bubbles: true }));
}

/** An element under `root` by l10n id; the failure lists what was there. */
export function byL10n(root: Element, l10nID: string): any {
  const found = root.querySelector(`[data-l10n-id="${l10nID}"]`);
  expect(
    found,
    `${l10nID}; found ${Array.from(root.querySelectorAll("[data-l10n-id]"))
      .map((node) => node.getAttribute("data-l10n-id"))
      .join(", ")}`,
  ).to.exist;
  return found;
}

export async function makePaper(
  title: string,
  doi?: string,
  collectionID?: number,
): Promise<Zotero.Item> {
  const item = new Zotero.Item("journalArticle");
  item.libraryID = Zotero.Libraries.userLibraryID;
  item.setField("title", title);
  if (doi) item.setField("DOI", doi);
  if (collectionID) item.setCollections([collectionID]);
  await item.saveTx();
  return item;
}

/** Every note carrying the state tag in My Library, trashed ones included. */
async function allStateNoteIDs(): Promise<number[]> {
  const tagID = Zotero.Tags.getID(READ_STATE_TAG);
  if (!tagID) return [];
  return Zotero.Tags.getTagItems(Zotero.Libraries.userLibraryID, tagID);
}

/** The state notes the plugin reads: standalone and not in the trash. */
export async function stateNotes(): Promise<Zotero.Item[]> {
  const items = await Zotero.Items.getAsync(await allStateNoteIDs());
  return items.filter(
    (item: Zotero.Item) =>
      item && item.isNote() && item.isTopLevelItem() && !item.deleted,
  );
}

export async function eraseStateNotes(): Promise<void> {
  const ids = await allStateNoteIDs();
  if (ids.length) await Zotero.Items.erase(ids);
}

/** Marks items through the item menu's Mark as submenu, as a reader would. */
export async function markThroughMenu(
  win: any,
  itemIDs: number[],
  state: "unread" | "reading" | "read",
): Promise<void> {
  await win.ZoteroPane.collectionsView.selectLibrary(
    Zotero.Libraries.userLibraryID,
  );
  await win.ZoteroPane.itemsView.selectItems(itemIDs, true);
  const menu = win.document.getElementById("zotero-itemmenu");
  // Plugin entries are built into the menu only by Zotero's own builder.
  await win.ZoteroPane.buildItemContextMenu();
  let showing = shown(menu);
  menu.openPopup(null, "after_start", 0, 0, true, false);
  await showing;
  const submenu = byL10n(menu, `${config.addonRef}-mark-submenu`);
  const popup = submenu.querySelector("menupopup");
  showing = shown(popup);
  submenu.openMenu(true);
  await showing;
  command(byL10n(popup, `${config.addonRef}-mark-${state}`));
  menu.hidePopup();
  await idle();
}

/** Opens the folder menu on a folder and returns the entry, if offered. */
export async function collectionMenuEntry(
  win: any,
  collectionID: number,
  l10nID: string,
): Promise<{ popup: any; entry: any }> {
  await win.ZoteroPane.collectionsView.selectCollection(collectionID);
  const popup = win.document.getElementById("zotero-collectionmenu");
  // A right-click runs this first, and it is what adds plugin entries.
  await win.ZoteroPane.buildCollectionContextMenu();
  const showing = shown(popup);
  popup.openPopup(null, "after_start", 0, 0, false, false);
  await showing;
  return { popup, entry: popup.querySelector(`[data-l10n-id="${l10nID}"]`) };
}
```

`test/zotero/readState.test.ts`:

```ts
/// <reference types="mocha" />
import { expect } from "chai";
import {
  emptyReadState,
  parseReadState,
  READ_STATE_TAG,
  setState,
  writeReadState,
  type ReadStateDoc,
} from "../../src/format/readState";
import {
  eraseStateNotes,
  idle,
  makePaper,
  markThroughMenu,
  stateNotes,
} from "./helpers";

function stateIn(note: Zotero.Item): ReadStateDoc {
  const parsed = parseReadState(note.getNote());
  expect(parsed.ok, `the state note parses: ${note.getNote()}`).to.equal(true);
  return (parsed as { ok: true; value: ReadStateDoc }).value;
}

async function stateNote(html: string): Promise<Zotero.Item> {
  const note = new Zotero.Item("note");
  note.libraryID = Zotero.Libraries.userLibraryID;
  note.setNote(html);
  note.addTag(READ_STATE_TAG);
  await note.saveTx();
  return note;
}

describe("Read state", function () {
  this.timeout(60_000);
  const DOI_ID = "doi:10.5555/meristema-reading.1";
  let win: any;
  let withDOI: Zotero.Item;
  let withoutDOI: Zotero.Item;

  before(async function () {
    win = Zotero.getMainWindows()[0];
    await eraseStateNotes();
    await idle();
    withDOI = await makePaper(
      "Read state fixture with a DOI",
      "10.5555/Meristema-Reading.1",
    );
    withoutDOI = await makePaper("Read state fixture without a DOI");
    await idle();
  });

  after(async function () {
    await win.ZoteroPane.collectionsView.selectLibrary(
      Zotero.Libraries.userLibraryID,
    );
    await Zotero.Items.erase([withDOI.id, withoutDOI.id]);
    await eraseStateNotes();
    await idle();
  });

  it("marks a selection Read in one state note and mirrors it onto tags", async function () {
    await markThroughMenu(win, [withDOI.id, withoutDOI.id], "read");
    const notes = await stateNotes();
    expect(notes, "state notes in My Library").to.have.length(1);
    expect(notes[0].getCollections(), "the state note's folders").to.deep.equal(
      [],
    );
    const { states } = stateIn(notes[0]);
    expect(Object.keys(states).sort()).to.deep.equal(
      [DOI_ID, `user:${withoutDOI.key}`].sort(),
    );
    expect(Object.values(states).map((entry) => entry.state)).to.deep.equal([
      "read",
      "read",
    ]);
    expect(withDOI.hasTag("_read"), "the DOI paper's mirror tag").to.equal(
      true,
    );
    expect(withoutDOI.hasTag("_read"), "the keyed paper's mirror tag").to.equal(
      true,
    );
  });

  it("un-marks to Unread tombstones and takes the tags off", async function () {
    await markThroughMenu(win, [withDOI.id, withoutDOI.id], "unread");
    const notes = await stateNotes();
    expect(notes, "state notes in My Library").to.have.length(1);
    const { states } = stateIn(notes[0]);
    expect(Object.values(states).map((entry) => entry.state)).to.deep.equal([
      "unread",
      "unread",
    ]);
    expect(
      withDOI.hasTag("_read") || withoutDOI.hasTag("_read"),
      "a _read tag left behind",
    ).to.equal(false);
  });

  it("merges two state notes into the one with the smaller key and trashes the other", async function () {
    await eraseStateNotes();
    await idle();
    const keyed = `user:${withoutDOI.key}`;
    const first = await stateNote(
      writeReadState(
        setState(emptyReadState(), keyed, "read", "2026-01-01T00:00:00Z"),
      ),
    );
    const second = await stateNote(
      writeReadState(
        setState(
          setState(emptyReadState(), keyed, "reading", "2026-02-01T00:00:00Z"),
          DOI_ID,
          "read",
          "2026-01-15T00:00:00Z",
        ),
      ),
    );
    await idle();
    const [keeper, other] =
      first.key < second.key ? [first, second] : [second, first];
    const notes = await stateNotes();
    expect(
      notes.map((note) => note.key),
      "untrashed state notes",
    ).to.deep.equal([keeper.key]);
    expect(other.deleted, "the other note is in the trash").to.equal(true);
    expect(stateIn(keeper).states).to.deep.equal({
      [keyed]: { state: "reading", at: "2026-02-01T00:00:00Z" },
      [DOI_ID]: { state: "read", at: "2026-01-15T00:00:00Z" },
    });
    expect(
      withoutDOI.hasTag("_reading"),
      "the merged Reading mirrored",
    ).to.equal(true);
    expect(withDOI.hasTag("_read"), "the merged Read mirrored").to.equal(true);
  });

  it("overwrites a mirror tag added or removed by hand", async function () {
    withoutDOI.removeTag("_reading");
    withoutDOI.addTag("_read");
    await withoutDOI.saveTx();
    await idle();
    expect(withoutDOI.hasTag("_reading"), "_reading put back").to.equal(true);
    expect(withoutDOI.hasTag("_read"), "_read taken off").to.equal(false);
  });
});
```

- [ ] **Step 2: Gate the cases statically, then see them fail**

Run: `npm run lint:fix` then `npm run check`
Expected: exits 0. The cases compile, since they use only `src/format/` and
the helpers.

Run: `npm test`
Expected: FAIL. `startup` passes, and the first Read state case fails in
`idle()` (`plugin().api` is undefined) or at `byL10n` for
`meristemareading-mark-submenu`.

- [ ] **Step 3: Write the Zotero layer**

`src/zotero/report.ts`:

```ts
export function report(error: unknown): void {
  Zotero.logError(error instanceof Error ? error : new Error(String(error)));
}
```

`src/zotero/queue.ts`:

```ts
let tail: Promise<void> = Promise.resolve();
let running = 0;

/**
 * Runs store work one task at a time, in the order asked, so a sync's change
 * and a menu's mark never interleave their reads and writes. The returned
 * promise rejects with the task's error. The next task runs either way.
 */
export function enqueue(task: () => Promise<void>): Promise<void> {
  running++;
  const run = tail.then(task).finally(() => {
    running--;
  });
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function isBusy(): boolean {
  return running > 0;
}
```

`src/zotero/items.ts`:

```ts
import type { LibraryLink } from "../format/common";
import type { PaperRef } from "../format/readState";

export function libraryLinkOf(libraryID: number): LibraryLink {
  const library = Zotero.Libraries.get(libraryID) as any;
  return library?.libraryType === "group"
    ? { kind: "group", id: Zotero.Groups.getGroupIDFromLibraryID(libraryID) }
    : { kind: "user" };
}

/** The paper behind an item, for its read-state id: its DOI field, else its library and key. */
export function paperRefOf(item: Zotero.Item): PaperRef {
  return {
    doi: String(item.getField("DOI") ?? "") || null,
    library: libraryLinkOf(item.libraryID),
    key: item.key,
  };
}

/** A standalone note, not in the trash, carrying `tag`. */
export function isTaggedNote(item: Zotero.Item, tag: string): boolean {
  return (
    item.isNote() && item.isTopLevelItem() && !item.deleted && item.hasTag(tag)
  );
}

/** The standalone, untrashed notes in a library that carry `tag`. */
export async function taggedNotes(
  libraryID: number,
  tag: string,
): Promise<Zotero.Item[]> {
  const tagID = Zotero.Tags.getID(tag);
  if (!tagID) return [];
  const ids = await Zotero.Tags.getTagItems(libraryID, tagID);
  const items = await Zotero.Items.getAsync(ids);
  return items.filter((item: Zotero.Item) => item && isTaggedNote(item, tag));
}
```

`src/zotero/stateStore.ts`:

```ts
import { applyMark } from "../domain/marks";
import { planMirror } from "../domain/mirrorPlan";
import { pickStateNotes } from "../domain/stateNotes";
import {
  emptyReadState,
  paperId,
  READ_STATE_TAG,
  writeReadState,
  type ReadState,
  type ReadStateDoc,
} from "../format/readState";
import { paperRefOf, taggedNotes } from "./items";
import { enqueue } from "./queue";

export class UnreadableStateError extends Error {}

let doc: ReadStateDoc = emptyReadState();
let keeperID: number | null = null;
let unreadable = false;

function userLibraryID(): number {
  return Zotero.Libraries.userLibraryID;
}

/** Reads the state notes, and writes the merge when a sync left two. */
async function load(): Promise<void> {
  const notes = await taggedNotes(userLibraryID(), READ_STATE_TAG);
  const pick = pickStateNotes(
    notes.map((note) => ({ key: note.key, html: note.getNote() })),
  );
  unreadable = pick.kind === "unreadable";
  if (pick.kind !== "ok") {
    doc = emptyReadState();
    keeperID = null;
    return;
  }
  const byKey = new Map(notes.map((note) => [note.key, note]));
  const keeper = byKey.get(pick.keeper)!;
  doc = pick.doc;
  keeperID = keeper.id;
  if (!pick.trash.length) return;
  keeper.setNote(writeReadState(doc));
  await keeper.saveTx();
  for (const key of pick.trash) {
    const other = byKey.get(key)!;
    other.deleted = true;
    await other.saveTx();
  }
}

async function save(next: ReadStateDoc): Promise<void> {
  const html = writeReadState(next);
  const keeper =
    keeperID === null
      ? null
      : (Zotero.Items.get(keeperID) as Zotero.Item | false);
  if (keeper) {
    keeper.setNote(html);
    await keeper.saveTx();
  } else {
    const note = new Zotero.Item("note");
    note.libraryID = userLibraryID();
    note.setNote(html);
    note.addTag(READ_STATE_TAG);
    keeperID = (await note.saveTx()) as number;
  }
  doc = next;
}

/** Rewrites the mirror tags on `items`, keeping only regular items of My Library. */
async function mirror(items: Zotero.Item[]): Promise<void> {
  if (unreadable) return;
  const own = items.filter(
    (item) =>
      item.libraryID === userLibraryID() &&
      item.isRegularItem() &&
      !item.deleted,
  );
  const changes = planMirror(
    doc,
    own.map((item) => ({
      id: item.id,
      paperId: paperId(paperRefOf(item)),
      tags: item.getTags().map((tag: { tag: string }) => tag.tag),
    })),
  );
  for (const change of changes) {
    const item = Zotero.Items.get(change.id) as Zotero.Item;
    for (const tag of change.add) item.addTag(tag);
    for (const tag of change.remove) item.removeTag(tag);
    await item.saveTx({ skipDateModifiedUpdate: true });
  }
}

async function mirrorAll(): Promise<void> {
  const items = await Zotero.Items.getAll(userLibraryID(), false, false);
  await Zotero.Items.loadDataTypes(items, ["itemData", "tags"]);
  await mirror(items);
}

export function startStateStore(): Promise<void> {
  return enqueue(async () => {
    await load();
    await mirrorAll();
  });
}

export function resetStateStore(): void {
  doc = emptyReadState();
  keeperID = null;
  unreadable = false;
}

/**
 * Marks papers Unread, Reading or Read. The notes are read again first, so a
 * change a sync brought in since the last event is merged, not overwritten.
 */
export function markItems(
  items: Zotero.Item[],
  state: ReadState,
): Promise<void> {
  return enqueue(async () => {
    await load();
    if (unreadable) {
      throw new UnreadableStateError(
        "Your reading-state note cannot be read, so nothing was marked. Fix it or move it to the trash, then mark again.",
      );
    }
    const ids = items.map((item) => paperId(paperRefOf(item)));
    const next = applyMark(doc, ids, state, new Date().toISOString());
    if (next === doc) return;
    await save(next);
    await mirrorAll();
  });
}

/** A note changed: it may be, or have been, a state note. */
export function stateChanged(): Promise<void> {
  return enqueue(async () => {
    const before = unreadable ? null : writeReadState(doc);
    await load();
    const after = unreadable ? null : writeReadState(doc);
    if (after !== null && after !== before) await mirrorAll();
  });
}

/** Regular items changed (added, retagged, their DOI edited): mirror them again. */
export function itemsChanged(ids: number[]): Promise<void> {
  return enqueue(async () => {
    const items = (await Zotero.Items.getAsync(ids)).filter(Boolean);
    await mirror(items);
  });
}
```

`src/zotero/notifier.ts`:

```ts
import { isBusy } from "./queue";
import { report } from "./report";
import { itemsChanged, stateChanged } from "./stateStore";

const FLUSH_DELAY_MS = 50;
let observerID: string | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let stateDirty = false;
const touched = new Set<number>();

/** The item an event names; `item-tag` ids read "itemID-tagID". */
function itemIDOf(type: string, id: number | string): number {
  return type === "item-tag" ? Number(String(id).split("-")[0]) : Number(id);
}

function notify(
  _event: string,
  type: string,
  ids: Array<number | string>,
): void {
  for (const raw of ids) {
    const item = Zotero.Items.get(itemIDOf(type, raw)) as Zotero.Item | false;
    // A deleted item can no longer say what it was: it may have been a state note.
    if (!item || item.isNote()) stateDirty = true;
    else if (item.isRegularItem()) touched.add(item.id);
  }
  if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_DELAY_MS);
}

function flush(): void {
  flushTimer = null;
  if (stateDirty) {
    stateDirty = false;
    void stateChanged().catch(report);
  }
  if (touched.size) {
    const ids = [...touched];
    touched.clear();
    void itemsChanged(ids).catch(report);
  }
}

export function registerNotifier(): void {
  if (observerID) return;
  observerID = Zotero.Notifier.registerObserver(
    { notify } as any,
    ["item", "item-tag"],
    "meristema-reading",
  );
}

export function unregisterNotifier(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  stateDirty = false;
  touched.clear();
  if (observerID) Zotero.Notifier.unregisterObserver(observerID);
  observerID = null;
}

/** Settles once no event waits to be read and no store work runs. */
export async function whenIdle(): Promise<void> {
  while (flushTimer !== null || isBusy()) await Zotero.Promise.delay(20);
}
```

`src/zotero/menus.ts`:

```ts
import { config } from "../../package.json";
import type { ReadState } from "../format/readState";
import { report } from "./report";
import { markItems, UnreadableStateError } from "./stateStore";

const ICON = `chrome://${config.addonRef}/content/icons/reading.svg`;
const registered: string[] = [];
type MenuData = Record<string, unknown>;

function register(definition: MenuData): void {
  const id = Zotero.MenuManager.registerMenu(definition);
  if (id) registered.push(id);
}

function contextValue(context: any, key: string): any {
  try {
    return context?.[key];
  } catch {
    return null;
  }
}

/** The regular, untrashed items the user right-clicked. */
function contextRegularItems(context: any): Zotero.Item[] {
  const items = contextValue(context, "items");
  if (!Array.isArray(items)) return [];
  return items.filter(
    (item: Zotero.Item) => item?.isRegularItem?.() && !item.deleted,
  );
}

function failed(error: unknown): void {
  if (error instanceof UnreadableStateError) {
    Zotero.alert(Zotero.getMainWindow(), "Meristema Reading", error.message);
    return;
  }
  report(error);
}

/** The items the Mark as submenu was opened on, read when its parent showed. */
let markTargets: Zotero.Item[] = [];

function markEntry(state: ReadState): MenuData {
  return {
    menuType: "menuitem",
    l10nID: `${config.addonRef}-mark-${state}`,
    onCommand: () => {
      void markItems(markTargets, state).catch(failed);
    },
  };
}

function itemMenus(): MenuData[] {
  return [
    {
      menuType: "submenu",
      l10nID: `${config.addonRef}-mark-submenu`,
      icon: ICON,
      onShowing: (_event: Event, context: any) => {
        markTargets = contextRegularItems(context);
        const available = markTargets.length > 0;
        context.setVisible(available);
        context.setEnabled(available);
      },
      menus: (["unread", "reading", "read"] as const).map(markEntry),
    },
  ];
}

export function registerMenus(): void {
  if (registered.length) return;
  register({
    menuID: "meristema-reading-item-menu",
    pluginID: config.addonID,
    target: "main/library/item",
    menus: itemMenus(),
  });
}

export function unregisterMenus(): void {
  for (const id of registered.splice(0)) {
    try {
      Zotero.MenuManager.unregisterMenu(id);
    } catch (error) {
      report(error);
    }
  }
}
```

`src/addon.ts` (replace):

```ts
import { config } from "../package.json";
import hooks from "./hooks";
import { whenIdle } from "./zotero/notifier";

/** What the Zotero suite reads: its bundle is a second copy of the plugin. */
export interface ReadingAPI {
  whenIdle(): Promise<void>;
}

class Addon {
  public data: {
    alive: boolean;
    config: typeof config;
    env: "development" | "production";
    initialized: boolean;
  };

  public hooks: typeof hooks;
  public api: ReadingAPI;

  constructor() {
    this.data = { alive: true, config, env: __env__, initialized: false };
    this.hooks = hooks;
    this.api = Object.freeze({ whenIdle });
  }
}

export default Addon;
```

`src/hooks.ts` (replace):

```ts
import { config } from "../package.json";
import { registerMenus, unregisterMenus } from "./zotero/menus";
import { registerNotifier, unregisterNotifier } from "./zotero/notifier";
import { resetStateStore, startStateStore } from "./zotero/stateStore";

async function onStartup(): Promise<void> {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);
  for (const win of Zotero.getMainWindows()) await onMainWindowLoad(win);
  registerNotifier();
  await startStateStore();
  registerMenus();
  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  win.MozXULElement.insertFTLIfNeeded(`${config.addonRef}-mainWindow.ftl`);
}

async function onMainWindowUnload(
  _win: _ZoteroTypes.MainWindow,
): Promise<void> {}

async function onShutdown(_appShutdown: boolean): Promise<void> {
  unregisterMenus();
  unregisterNotifier();
  resetStateStore();
  addon.data.alive = false;
  delete (Zotero as any)[config.addonInstance];
}

export default { onStartup, onMainWindowLoad, onMainWindowUnload, onShutdown };
```

Append to `addon/locale/en-US/mainWindow.ftl`:

```
mark-submenu =
    .label = Mark as
mark-unread =
    .label = Unread
mark-reading =
    .label = Reading
mark-read =
    .label = Read
```

- [ ] **Step 4: Gate, then run the Zotero suite**

Run: `npm run lint:fix` then `npm run check`
Expected: exits 0.

Run: `npm test`
Expected: `5 passing` (startup and four Read state cases), exit 0. If a case
fails, its assertion message carries the evidence, because `Zotero.debug`
never reaches the runner's log. Find the cause before changing code. Re-run a
case that looks timing-dependent twice before calling it fixed.

- [ ] **Step 5: Commit**

```bash
git add src/zotero/report.ts src/zotero/queue.ts src/zotero/items.ts src/zotero/stateStore.ts src/zotero/notifier.ts src/zotero/menus.ts src/addon.ts src/hooks.ts addon/locale/en-US/mainWindow.ftl test/zotero/helpers.ts test/zotero/readState.test.ts
git commit
```

Message: `Keep read state in one note, merge sync duplicates and mirror it onto tags`,
then the two attribution lines.

---

### Task 5: Reading lists, the Step column and Make Reading List

**Files:**

- Create: `src/zotero/listStore.ts`, `src/zotero/stepColumn.ts`,
  `test/zotero/readingList.test.ts`
- Modify: `src/zotero/notifier.ts`, `src/zotero/menus.ts`, `src/addon.ts`,
  `src/hooks.ts`, `addon/locale/en-US/mainWindow.ftl`, `README.md`

**Interfaces:**

- Consumes: Task 3's `pickListNote`, `newListOrder`, `stepLabel`,
  `stepCells`, `stepText`; Task 4's `enqueue`, `isTaggedNote`,
  `libraryLinkOf`, `report`, the notifier and the menus.
- Produces:
  - `interface FolderList { noteID: number; doc: ReadingListDoc | null; failure: ParseFailure | null; resolved: ResolvedList | null; cells: Map<string, string>; ignoredNoteIDs: number[] }`
  - `listFor(collectionID: number): FolderList | null`, `clearLists(): void`,
    `makeReadingList(collectionID: number, shownKeys: string[] | null): Promise<void>`
  - `registerStepColumn(): Promise<void>`, `unregisterStepColumn(): void`,
    `refreshStepColumn(): void`, `stepCell(itemKey: string, collectionID: number): string`,
    `stepColumnKey(): string | null`
  - `Zotero.MeristemaReading.api.stepCell(itemID: number, collectionID: number): string`
    and `api.stepColumnKey(): string | null`
  - Menu l10n id `meristemareading-make-reading-list`.
  - Plan 2b builds the sidebar on `listFor` (`doc`, `failure`,
    `ignoredNoteIDs`).

- [ ] **Step 1: Write the failing cases**

`test/zotero/readingList.test.ts`:

```ts
/// <reference types="mocha" />
import { expect } from "chai";
import { config } from "../../package.json";
import {
  parseReadingList,
  READING_LIST_TAG,
  writeReadingList,
  type ReadingListDoc,
} from "../../src/format/readingList";
import {
  collectionMenuEntry,
  command,
  idle,
  makePaper,
  plugin,
  waitFor,
} from "./helpers";

const MAKE = `${config.addonRef}-make-reading-list`;
const TOPIC = "Reading list fixture";

describe("Reading lists", function () {
  this.timeout(60_000);
  let win: any;
  let collection: Zotero.Collection;
  let alpha: Zotero.Item;
  let bravo: Zotero.Item;
  let charlie: Zotero.Item;

  function listNotes(): Zotero.Item[] {
    return collection
      .getChildItems(false, false)
      .filter(
        (item: Zotero.Item) => item.isNote() && item.hasTag(READING_LIST_TAG),
      );
  }

  function cells(): string[] {
    return [bravo, alpha, charlie].map(
      (item) => plugin().api.stepCell(item.id, collection.id) as string,
    );
  }

  before(async function () {
    win = Zotero.getMainWindows()[0];
    collection = new Zotero.Collection();
    collection.libraryID = Zotero.Libraries.userLibraryID;
    collection.name = TOPIC;
    await collection.saveTx();
    charlie = await makePaper("Charlie paper", undefined, collection.id);
    alpha = await makePaper("alpha paper", undefined, collection.id);
    bravo = await makePaper("Bravo paper", undefined, collection.id);
    await idle();
  });

  after(async function () {
    // Reset the tree to the library before erasing what it shows.
    await win.ZoteroPane.collectionsView.selectLibrary(
      Zotero.Libraries.userLibraryID,
    );
    await Zotero.Items.erase([
      ...listNotes().map((note) => note.id),
      alpha.id,
      bravo.id,
      charlie.id,
    ]);
    await collection.eraseTx();
    await idle();
  });

  it("makes a list from the folder menu, in the item list's order", async function () {
    await win.ZoteroPane.collectionsView.selectCollection(collection.id);
    const shownKeys = await waitFor(() => {
      const items = win.ZoteroPane.getSortedItems() as Zotero.Item[];
      return items.length === 3 ? items.map((item) => item.key) : null;
    }, 10_000);
    expect(shownKeys, "the folder's three papers in the item list").to.exist;
    const { popup, entry } = await collectionMenuEntry(
      win,
      collection.id,
      MAKE,
    );
    expect(
      Boolean(entry) && !entry.hidden,
      "Make Reading List offered",
    ).to.equal(true);
    command(entry);
    popup.hidePopup();
    await idle();
    const notes = listNotes();
    expect(notes, "list notes in the folder").to.have.length(1);
    expect(parseReadingList(notes[0].getNote())).to.deep.equal({
      ok: true,
      value: {
        version: 1,
        topic: TOPIC,
        steps: shownKeys!.map((key) => ({ key, why: "" })),
      },
    });
    expect(notes[0].getNote()).to.contain(
      `zotero://select/library/items/${alpha.key}`,
    );
  });

  it("no longer offers Make Reading List once the folder holds a list", async function () {
    const { popup, entry } = await collectionMenuEntry(
      win,
      collection.id,
      MAKE,
    );
    popup.hidePopup();
    expect(
      Boolean(entry) && !entry.hidden,
      "Make Reading List offered again",
    ).to.equal(false);
  });

  it("numbers the Step column in reading order, unordered papers after the last step", async function () {
    const [note] = listNotes();
    const doc: ReadingListDoc = {
      version: 1,
      topic: TOPIC,
      steps: [
        { key: bravo.key, why: "start here" },
        { key: alpha.key, why: "" },
      ],
    };
    note.setNote(writeReadingList(doc, (key) => key, { kind: "user" }));
    await note.saveTx();
    await idle();
    expect(cells(), "Bravo, alpha, Charlie").to.deep.equal([
      "00001",
      "00002",
      "00003u",
    ]);
    const key = plugin().api.stepColumnKey() as string | null;
    expect(
      Boolean(key) && Zotero.ItemTreeManager.isCustomColumn(key),
      `the Step column is registered (${key})`,
    ).to.equal(true);
  });

  it("drops a paper from the steps once it leaves the folder", async function () {
    alpha.removeFromCollection(collection.id);
    await alpha.saveTx();
    await idle();
    expect(cells(), "Bravo, alpha, Charlie").to.deep.equal([
      "00001",
      "",
      "00002u",
    ]);
  });
});
```

- [ ] **Step 2: Gate, then see the cases fail**

Run: `npm run lint:fix` then `npm run check`
Expected: exits 0.

Run: `npm test`
Expected: FAIL. The 5 earlier cases pass. The first Reading lists case fails
on "Make Reading List offered", and the later ones fail on
`plugin().api.stepCell` not being a function.

- [ ] **Step 3: Write the list store and the column**

`src/zotero/listStore.ts`:

```ts
import { newListOrder, pickListNote, stepLabel } from "../domain/listNotes";
import { stepCells } from "../domain/stepColumn";
import type { ParseFailure } from "../format/common";
import {
  READING_LIST_TAG,
  resolveReadingList,
  writeReadingList,
  type ReadingListDoc,
  type ResolvedList,
} from "../format/readingList";
import { isTaggedNote, libraryLinkOf } from "./items";
import { enqueue } from "./queue";

export interface FolderList {
  noteID: number;
  /** Null when the list note cannot be read; `failure` says why. */
  doc: ReadingListDoc | null;
  failure: ParseFailure | null;
  resolved: ResolvedList | null;
  cells: Map<string, string>;
  /** Further list notes in the folder, which readers ignore. */
  ignoredNoteIDs: number[];
}

const cache = new Map<number, FolderList | null>();

export function clearLists(): void {
  cache.clear();
}

function readList(collectionID: number): FolderList | null {
  const collection = Zotero.Collections.get(collectionID) as
    Zotero.Collection | false;
  if (!collection) return null;
  const children: Zotero.Item[] = collection.getChildItems(false, false);
  const pick = pickListNote(
    children
      .filter((item) => isTaggedNote(item, READING_LIST_TAG))
      .map((note) => ({
        id: note.id,
        key: note.key,
        dateAdded: note.dateAdded,
        html: note.getNote(),
      })),
  );
  if (!pick) return null;
  if (!pick.parsed.ok) {
    return {
      noteID: pick.id,
      doc: null,
      failure: pick.parsed.reason,
      resolved: null,
      cells: new Map(),
      ignoredNoteIDs: pick.ignored,
    };
  }
  const folder = children
    .filter((item) => item.isRegularItem())
    .map((item) => ({ key: item.key, title: String(item.getField("title")) }));
  const resolved = resolveReadingList(pick.parsed.value, folder);
  return {
    noteID: pick.id,
    doc: pick.parsed.value,
    failure: null,
    resolved,
    cells: stepCells(resolved),
    ignoredNoteIDs: pick.ignored,
  };
}

/** The reading list a folder holds, or null when it holds none. Cached until the next library event. */
export function listFor(collectionID: number): FolderList | null {
  if (!cache.has(collectionID)) cache.set(collectionID, readList(collectionID));
  return cache.get(collectionID) ?? null;
}

function labelOf(item: Zotero.Item): string {
  return stepLabel({
    creator: String(item.getField("firstCreator")),
    year: String(item.getField("date", true, true)).slice(0, 4),
    title: String(item.getField("title")),
  });
}

/**
 * Make reading list: a new list note in the folder holding its papers, in the
 * order the item list shows them when it shows this folder (`shownKeys`). A
 * folder that already holds a list is left as it is.
 */
export function makeReadingList(
  collectionID: number,
  shownKeys: string[] | null,
): Promise<void> {
  return enqueue(async () => {
    cache.delete(collectionID);
    if (listFor(collectionID)) return;
    const collection = Zotero.Collections.get(
      collectionID,
    ) as Zotero.Collection;
    const papers = (
      collection.getChildItems(false, false) as Zotero.Item[]
    ).filter((item) => item.isRegularItem());
    const byKey = new Map(papers.map((paper) => [paper.key, paper]));
    const order = newListOrder(
      papers.map((paper) => ({
        key: paper.key,
        title: String(paper.getField("title")),
      })),
      shownKeys,
    );
    const doc: ReadingListDoc = {
      version: 1,
      topic: collection.name,
      steps: order.map((key) => ({ key, why: "" })),
    };
    const note = new Zotero.Item("note");
    note.libraryID = collection.libraryID;
    note.setNote(
      writeReadingList(
        doc,
        (key) => labelOf(byKey.get(key)!),
        libraryLinkOf(collection.libraryID),
      ),
    );
    note.addTag(READING_LIST_TAG);
    note.setCollections([collectionID]);
    await note.saveTx();
    cache.delete(collectionID);
  });
}
```

`src/zotero/stepColumn.ts`:

```ts
import { config } from "../../package.json";
import { stepText } from "../domain/stepColumn";
import { listFor } from "./listStore";
import { report } from "./report";

let dataKey: string | null = null;

/** A paper's cell data in a folder's list; empty when the folder has none. */
export function stepCell(itemKey: string, collectionID: number): string {
  return listFor(collectionID)?.cells.get(itemKey) ?? "";
}

export function stepColumnKey(): string | null {
  return dataKey;
}

/** The Step column: a paper's step in the selected folder's reading list. */
export async function registerStepColumn(): Promise<void> {
  if (dataKey) return;
  const key = await Zotero.ItemTreeManager.registerColumn({
    dataKey: "step",
    label: "Step",
    pluginID: config.addonID,
    enabledTreeIDs: ["main"],
    width: "48",
    flex: 0,
    showInColumnPicker: true,
    zoteroPersist: ["width", "ordinal", "hidden", "sortDirection"],
    dataProvider: (item: Zotero.Item) => {
      const collectionID =
        Zotero.getActiveZoteroPane()?.getSelectedCollection(true);
      return collectionID ? stepCell(item.key, collectionID) : "";
    },
    renderCell: (
      _index: number,
      data: string,
      column: { className: string },
      _isFirstColumn: boolean,
      document: Document,
    ) => {
      const cell = document.createElement("span");
      cell.className = `cell ${column.className}`;
      cell.textContent = stepText(data);
      return cell;
    },
  } as any);
  dataKey = typeof key === "string" ? key : null;
}

export function refreshStepColumn(): void {
  try {
    Zotero.ItemTreeManager.refreshColumns();
  } catch (error) {
    report(error);
  }
}

export function unregisterStepColumn(): void {
  if (!dataKey) return;
  try {
    Zotero.ItemTreeManager.unregisterColumn(dataKey);
  } catch (error) {
    report(error);
  }
  dataKey = null;
}
```

- [ ] **Step 4: Wire lists into the notifier, the menus, the API and startup**

`src/zotero/notifier.ts` (replace). Any library event drops the cached lists:
a paper renamed, filed, trashed or merged, or a note edited.

```ts
import { clearLists } from "./listStore";
import { isBusy } from "./queue";
import { report } from "./report";
import { itemsChanged, stateChanged } from "./stateStore";
import { refreshStepColumn } from "./stepColumn";

const FLUSH_DELAY_MS = 50;
let observerID: string | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let stateDirty = false;
let listsDirty = false;
const touched = new Set<number>();

/** The item an event names; `item-tag` ids read "itemID-tagID". */
function itemIDOf(type: string, id: number | string): number {
  return type === "item-tag" ? Number(String(id).split("-")[0]) : Number(id);
}

function notify(
  _event: string,
  type: string,
  ids: Array<number | string>,
): void {
  listsDirty = true;
  if (type === "item" || type === "item-tag") {
    for (const raw of ids) {
      const item = Zotero.Items.get(itemIDOf(type, raw)) as Zotero.Item | false;
      // A deleted item can no longer say what it was: it may have been a state note.
      if (!item || item.isNote()) stateDirty = true;
      else if (item.isRegularItem()) touched.add(item.id);
    }
  }
  if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_DELAY_MS);
}

function flush(): void {
  flushTimer = null;
  if (listsDirty) {
    listsDirty = false;
    clearLists();
    refreshStepColumn();
  }
  if (stateDirty) {
    stateDirty = false;
    void stateChanged().catch(report);
  }
  if (touched.size) {
    const ids = [...touched];
    touched.clear();
    void itemsChanged(ids).catch(report);
  }
}

export function registerNotifier(): void {
  if (observerID) return;
  observerID = Zotero.Notifier.registerObserver(
    { notify } as any,
    ["item", "item-tag", "collection", "collection-item"],
    "meristema-reading",
  );
}

export function unregisterNotifier(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  stateDirty = false;
  listsDirty = false;
  touched.clear();
  if (observerID) Zotero.Notifier.unregisterObserver(observerID);
  observerID = null;
}

/** Settles once no event waits to be read and no store work runs. */
export async function whenIdle(): Promise<void> {
  while (flushTimer !== null || isBusy()) await Zotero.Promise.delay(20);
}
```

`src/zotero/menus.ts`. Add the import:

```ts
import { listFor, makeReadingList } from "./listStore";
```

Add these functions after `itemMenus`:

```ts
/** The one folder the user right-clicked, or null for anything else. */
function contextCollectionID(context: any): number | null {
  const rows = contextValue(context, "collectionTreeRows");
  const selected = Array.isArray(rows)
    ? rows
    : [contextValue(context, "collectionTreeRow")];
  if (selected.length !== 1 || selected[0]?.isCollection?.() !== true) {
    return null;
  }
  const id = Number(contextValue(selected[0], "ref")?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function canMakeList(collectionID: number): boolean {
  const collection = Zotero.Collections.get(collectionID) as
    Zotero.Collection | false;
  if (!collection) return false;
  const library = Zotero.Libraries.get(collection.libraryID) as any;
  return Boolean(library?.editable) && !listFor(collectionID);
}

/** The item list's order, when it shows this folder. */
function shownKeys(collectionID: number): string[] | null {
  const pane = Zotero.getActiveZoteroPane();
  if (pane?.getSelectedCollection(true) !== collectionID) return null;
  return (pane.getSortedItems() as Zotero.Item[]).map((item) => item.key);
}

function collectionMenus(): MenuData[] {
  return [
    {
      menuType: "menuitem",
      l10nID: `${config.addonRef}-make-reading-list`,
      icon: ICON,
      onShowing: (_event: Event, context: any) => {
        const id = contextCollectionID(context);
        const available = id !== null && canMakeList(id);
        context.setVisible(available);
        context.setEnabled(available);
      },
      onCommand: (_event: Event, context: any) => {
        const id = contextCollectionID(context);
        if (id === null) return;
        void makeReadingList(id, shownKeys(id)).catch(report);
      },
    },
  ];
}
```

In `registerMenus`, after the item-menu `register` call, add:

```ts
register({
  menuID: "meristema-reading-collection-menu",
  pluginID: config.addonID,
  target: "main/library/collection",
  menus: collectionMenus(),
});
```

`src/addon.ts`: replace the `ReadingAPI` interface and the `api` line.

```ts
/** What the Zotero suite reads: its bundle is a second copy of the plugin. */
export interface ReadingAPI {
  whenIdle(): Promise<void>;
  stepCell(itemID: number, collectionID: number): string;
  stepColumnKey(): string | null;
}
```

```ts
this.api = Object.freeze({
  whenIdle,
  stepCell: (itemID: number, collectionID: number) => {
    const item = Zotero.Items.get(itemID) as Zotero.Item | false;
    return item ? stepCell(item.key, collectionID) : "";
  },
  stepColumnKey,
});
```

with the import `import { stepCell, stepColumnKey } from "./zotero/stepColumn";`.

`src/hooks.ts`: add the imports

```ts
import { clearLists } from "./zotero/listStore";
import { registerStepColumn, unregisterStepColumn } from "./zotero/stepColumn";
```

In `onStartup`, after `await startStateStore();`, add `await registerStepColumn();`.
In `onShutdown`, after `unregisterMenus();`, add `unregisterStepColumn();` and
`clearLists();`.

Append to `addon/locale/en-US/mainWindow.ftl`:

```
make-reading-list =
    .label = Make Reading List
```

- [ ] **Step 5: Gate, then run the Zotero suite**

Run: `npm run lint:fix` then `npm run check`
Expected: exits 0.

Run: `npm test`
Expected: `9 passing`, exit 0.

- [ ] **Step 6: Say what the plugin does in the README**

Insert after the README's first paragraph:

```md
## The plugin

Meristema Reading is a Zotero 9 and 10 plugin built from this repo.

- **Mark as** (item menu): Unread, Reading or Read, for one paper or a
  selection. The state lives in one note in My Library, tagged
  `meristema-reading-state`. It is mirrored onto `_reading` and `_read` tags in
  My Library for Zotero apps without plugins. The mirror is one way: a tag
  changed by hand is put back.
- **Make Reading List** (folder menu): a note tagged `meristema-reading-list`
  holding the folder's papers in the order the item list shows them.
- **Step** (column picker): a paper's step in the selected folder's list.
  Sorting by it gives the reading order.

`npm start` runs it in a dev Zotero (copy `.env.example` to `.env` first),
`npm test` runs the Zotero suite, and `npm run check` runs prettier, eslint,
the type checks and the unit tests.
```

Run: `npm run lint:fix` then `npm run check`
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/zotero/listStore.ts src/zotero/stepColumn.ts src/zotero/notifier.ts src/zotero/menus.ts src/addon.ts src/hooks.ts addon/locale/en-US/mainWindow.ftl test/zotero/readingList.test.ts README.md
git commit
```

Message: `Make reading lists from a folder and number them in a Step column`,
then the two attribution lines.

- [ ] **Step 8: Build the XPI and fast-forward main**

Run: `npm run build`
Expected: exits 0. Run it after the last `npm test`, because a test run
deletes the XPI.

```bash
git switch main
git merge --ff-only plugin-core
git log --oneline -6
```
