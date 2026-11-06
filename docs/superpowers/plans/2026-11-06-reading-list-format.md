# Reading-list format (R1, step 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** The two note formats of
`docs/superpowers/specs/2026-11-06-reading-lists-design.md` (the reading list
and the personal reading state) as pure TypeScript, with a fixture set that the
plugin, Meristema and the skill's Python copy must all read alike.

**Architecture:** A new local repo, `zotero-meristema-reading`, starts as a
plain TypeScript package: `src/format/` (no `Zotero.*`, no DOM, regex-only HTML
handling) and `fixtures/` (sample notes plus case files of expected results).
Step 2 turns the repo into the plugin around this code; step 3 copies
`src/format/` into Meristema and runs the same fixtures there.

**Tech Stack:** Node 24 (native type stripping), `node --test`, chai,
TypeScript 5.9 (`tsc --noEmit`), prettier 3.

## Global Constraints

- Repo: `C:\repos\github\daniel-locatelli\zotero-meristema-reading`, local only.
  Creating it on GitHub waits on the user's word.
- List note tag `meristema-reading-list`, data in
  `<pre data-meristema-reading-list="1">`; state note tag
  `meristema-reading-state`, data in `<pre data-meristema-reading-state="1">`.
- List JSON: `{ "version": 1, "topic": string, "steps": [{ "key": string, "why": string }] }`.
- State JSON: `{ "version": 1, "states": { "<paper id>": { "state": "unread" | "reading" | "read", "at": ISO date } } }`.
  `unread` is stored only as a tombstone, so a merge does not resurrect an
  older Read; an absent paper is Unread.
- Paper id: `doi:<normalized DOI>`, else `user:<key>` or `group-<id>:<key>`.
- Mirror tags: `_reading`, `_read`; Unread has none.
- `src/format/` imports nothing outside `src/format/`, and never `Zotero` or
  the DOM.
- Node type stripping: no `enum`, no `namespace`, no parameter properties.
- Gate on `npm run check`'s exit code, never through a pipe. Never commit
  `describe.only` or `it.only`.
- Commits: sentence-case subject, staged by path, ending with:
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_011u94ZUBSZPgEppAcs8Tck8
  ```
- In the new repo, work on branch `format` and fast-forward `main` at the end
  (Task 6). Task 1 makes the root commit on `main`.

## File structure (new repo)

| Path                            | Responsibility                                                   |
| ------------------------------- | ---------------------------------------------------------------- |
| `package.json`, `tsconfig.json` | Scripts and compiler settings                                    |
| `test/nodeResolve.mjs`          | Lets `node --test` load extensionless `.ts` imports              |
| `src/format/doi.ts`             | `normalizeDOI`, copied verbatim from Meristema                   |
| `src/format/html.ts`            | Escaping, and finding a `<pre data-…="1">` block                 |
| `src/format/common.ts`          | `Parsed`, `LibraryLink`, item keys, the versioned-block reader   |
| `src/format/readingList.ts`     | List note: parse, resolve against a folder, write                |
| `src/format/readState.ts`       | State note: parse, merge, set, next up, mirror tag, write        |
| `fixtures/`                     | Sample notes and expected results, shared by all three parsers   |
| `test/unit/*.test.ts`           | Unit tests, plus `fixtures.test.ts` that runs every fixture case |

---

### Task 1: Repo skeleton and the DOI normalizer

**Files:**

- Create: `package.json`, `tsconfig.json`, `.gitignore`, `.prettierignore`,
  `test/nodeResolve.mjs`, `README.md`, `src/format/doi.ts`,
  `test/unit/doi.test.ts`

**Interfaces:**

- Produces: `normalizeDOI(value: unknown): string | null` in
  `src/format/doi.ts`.

- [ ] **Step 1: Make the repo**

```bash
mkdir -p /c/repos/github/daniel-locatelli/zotero-meristema-reading
cd /c/repos/github/daniel-locatelli/zotero-meristema-reading
git init -b main
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "zotero-meristema-reading",
  "version": "0.0.0",
  "private": true,
  "description": "Ordered reading lists for Zotero, with read state kept per paper.",
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint:check": "prettier --check .",
    "test:unit": "node --import ./test/nodeResolve.mjs --test \"test/unit/**/*.test.ts\"",
    "check": "npm run lint:check && npm run typecheck && npm run test:unit"
  },
  "devDependencies": {
    "@types/chai": "^5.2.3",
    "@types/node": "^26.2.0",
    "chai": "^6.2.1",
    "prettier": "^3.7.4",
    "typescript": "^5.9.3"
  },
  "engines": {
    "node": ">=24 <27",
    "npm": ">=11.18"
  }
}
```

- [ ] **Step 3: Write `tsconfig.json`, `.gitignore`, `.prettierignore`**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["node"],
    "strict": true,
    "noEmit": true,
    "verbatimModuleSyntax": true,
    "forceConsistentCasingInFileNames": true,
    "noFallthroughCasesInSwitch": true,
    "useUnknownInCatchVariables": true
  },
  "include": ["src", "test"]
}
```

`.gitignore`:

```
node_modules/
```

`.prettierignore` (the HTML fixtures must stay byte-exact):

```
node_modules/
package-lock.json
fixtures/**/*.html
```

- [ ] **Step 4: Write `test/nodeResolve.mjs`**

```js
// Lets `node --test` load the TypeScript sources directly: `src/` writes
// relative imports without an extension, which Node's ESM resolver rejects,
// so this hook appends `.ts` when such a file exists. Node 24 strips the
// types itself.

import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.[A-Za-z0-9]+$/.test(specifier)) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) {
        return {
          url: candidate.href,
          format: "module-typescript",
          shortCircuit: true,
        };
      }
    }
    return nextResolve(specifier, context);
  },
});
```

- [ ] **Step 5: Write `README.md`**

```markdown
# Meristema Reading

Ordered reading lists for Zotero, with read state kept per paper. Design:
`meristema-zotero/docs/superpowers/specs/2026-11-06-reading-lists-design.md`.

`src/format/` holds the two note formats; `fixtures/` holds the sample notes
every implementation of them must read alike (see `fixtures/README.md`).

    npm install
    npm run check
```

- [ ] **Step 6: Install**

Run: `npm install`
Expected: exit 0, `package-lock.json` written.

- [ ] **Step 7: Write the failing test `test/unit/doi.test.ts`**

```ts
import { describe, it } from "node:test";
import { expect } from "chai";

import { normalizeDOI } from "../../src/format/doi";

describe("normalizeDOI", () => {
  it("strips the resolver, the prefix and trailing punctuation, and lowercases", () => {
    expect(normalizeDOI("https://doi.org/10.1000/ABC.")).to.equal(
      "10.1000/abc",
    );
    expect(normalizeDOI("doi: 10.1000/Xyz")).to.equal("10.1000/xyz");
  });

  it("returns null for anything that is not a DOI", () => {
    expect(normalizeDOI("")).to.equal(null);
    expect(normalizeDOI(null)).to.equal(null);
    expect(normalizeDOI("not a doi")).to.equal(null);
  });
});
```

- [ ] **Step 8: Run it to see it fail**

Run: `npm run test:unit`
Expected: FAIL, `Cannot find module` for `src/format/doi.ts`.

- [ ] **Step 9: Write `src/format/doi.ts`**

Copied verbatim from Meristema's `src/domain/workIdentity.ts`, so both plugins
key a paper alike.

```ts
// Copied verbatim from meristema-zotero `src/domain/workIdentity.ts`; keep the
// two in step, since a paper id is built from it.
export function normalizeDOI(value: unknown): string | null {
  const text = String(value ?? "")
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .trim()
    .toLocaleLowerCase();
  const match = text.match(/10\.\d{4,9}\/[-._;()/:a-z0-9]+/i);
  return match ? match[0].replace(/[.,;]+$/, "").toLocaleLowerCase() : null;
}
```

- [ ] **Step 10: Run the gate**

Run: `npx prettier --write . && npm run check`
Expected: exit 0, `pass 2`, `fail 0`.

- [ ] **Step 11: Commit (the root commit, on `main`), then branch**

```bash
git add package.json package-lock.json tsconfig.json .gitignore .prettierignore README.md test/nodeResolve.mjs src/format/doi.ts test/unit/doi.test.ts
git commit -F - <<'EOF'
Start Meristema Reading as a TypeScript package with the DOI normalizer

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011u94ZUBSZPgEppAcs8Tck8
EOF
git switch -c format
```

---

### Task 2: HTML helpers and the shared parse types

**Files:**

- Create: `src/format/html.ts`, `src/format/common.ts`,
  `test/unit/html.test.ts`

**Interfaces:**

- Produces (`html.ts`): `escapeHtml(text: string): string`,
  `unescapeHtml(text: string): string`,
  `extractDataBlock(html: string, attribute: string): string | null`,
  `dataBlock(attribute: string, json: string): string`.
- Produces (`common.ts`):
  `type ParseFailure = "no-data" | "bad-json" | "unknown-version" | "bad-shape"`,
  `type Parsed<T> = { ok: true; value: T } | { ok: false; reason: ParseFailure }`,
  `type LibraryLink = { kind: "user" } | { kind: "group"; id: number }`,
  `ITEM_KEY_CHARS: string`, `isItemKey(value: unknown): value is string`,
  `readVersionedBlock(html: string, attribute: string): Parsed<Record<string, unknown>>`.

- [ ] **Step 1: Write the failing test `test/unit/html.test.ts`**

```ts
import { describe, it } from "node:test";
import { expect } from "chai";

import {
  dataBlock,
  escapeHtml,
  extractDataBlock,
  unescapeHtml,
} from "../../src/format/html";
import { isItemKey, readVersionedBlock } from "../../src/format/common";

describe("HTML escaping", () => {
  it("round-trips text with markup characters", () => {
    const text = `a & <b> "c" 'd'`;
    expect(unescapeHtml(escapeHtml(text))).to.equal(text);
    expect(escapeHtml(text)).to.not.match(/[<>"]/);
  });

  it("decodes numeric entities and leaves unknown ones", () => {
    expect(unescapeHtml("&#39;&#x27;&nbsp;&foo;")).to.equal("'' &foo;");
  });
});

describe("extractDataBlock", () => {
  it("finds the block by its attribute among other blocks", () => {
    const html =
      '<pre>other</pre><pre class="x" data-thing="1">{&quot;a&quot;:1}</pre>';
    expect(extractDataBlock(html, "thing")).to.equal('{"a":1}');
  });

  it("strips tags the note editor may add inside the block", () => {
    const html = '<pre data-thing="1"><code>{"a":<br>1}</code></pre>';
    expect(extractDataBlock(html, "thing")).to.equal('{"a":\n1}');
  });

  it("returns null when no block carries the attribute", () => {
    expect(extractDataBlock('<pre data-other="1">{}</pre>', "thing")).to.equal(
      null,
    );
  });

  it("reads back what dataBlock wrote", () => {
    const json = '{"why":"a <b> & \\"c\\""}';
    expect(extractDataBlock(dataBlock("thing", json), "thing")).to.equal(json);
  });
});

describe("readVersionedBlock", () => {
  const block = (json: string) => dataBlock("thing", json);

  it("accepts version 1", () => {
    expect(
      readVersionedBlock(block('{"version":1,"x":2}'), "thing"),
    ).to.deep.equal({ ok: true, value: { version: 1, x: 2 } });
  });

  it("names each failure", () => {
    const reason = (html: string) => {
      const parsed = readVersionedBlock(html, "thing");
      return parsed.ok ? "ok" : parsed.reason;
    };
    expect(reason("<p>plain note</p>")).to.equal("no-data");
    expect(reason(block('{"version":1,'))).to.equal("bad-json");
    expect(reason(block('{"version":2}'))).to.equal("unknown-version");
    expect(reason(block("{}"))).to.equal("bad-shape");
    expect(reason(block("[1]"))).to.equal("bad-shape");
  });
});

describe("isItemKey", () => {
  it("accepts Zotero's eight-character keys only", () => {
    expect(isItemKey("ABCD2345")).to.equal(true);
    expect(isItemKey("ABCD2340")).to.equal(false); // 0 is not in the alphabet
    expect(isItemKey("abcd2345")).to.equal(false);
    expect(isItemKey("ABCD234")).to.equal(false);
    expect(isItemKey(12345678)).to.equal(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run test:unit`
Expected: FAIL, `Cannot find module` for `src/format/html.ts`.

- [ ] **Step 3: Write `src/format/html.ts`**

```ts
// Regex-only HTML handling: the format code runs under node, in Zotero and in
// Python, so it may not lean on a DOM.

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function unescapeHtml(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (whole, body: string) => {
      if (body.startsWith("#")) {
        const code =
          body[1] === "x" || body[1] === "X"
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10);
        return code >= 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : whole;
      }
      return NAMED[body.toLowerCase()] ?? whole;
    },
  );
}

/**
 * The text of the first `<pre>` carrying `data-<attribute>="1"`, with any tags
 * the note editor put inside it removed (`<br>` read as a newline) and
 * entities decoded; null when no such block exists. `attribute` must be
 * letters and hyphens.
 */
export function extractDataBlock(
  html: string,
  attribute: string,
): string | null {
  const pattern = new RegExp(
    `<pre\\b[^>]*\\bdata-${attribute}\\s*=\\s*["']?1["']?[^>]*>([\\s\\S]*?)</pre>`,
    "i",
  );
  const match = pattern.exec(html);
  if (!match) return null;
  return unescapeHtml(
    match[1].replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, ""),
  );
}

export function dataBlock(attribute: string, json: string): string {
  return `<pre data-${attribute}="1">${escapeHtml(json)}</pre>`;
}
```

- [ ] **Step 4: Write `src/format/common.ts`**

```ts
import { extractDataBlock } from "./html";

export type ParseFailure =
  "no-data" | "bad-json" | "unknown-version" | "bad-shape";

export type Parsed<T> =
  { ok: true; value: T } | { ok: false; reason: ParseFailure };

/** Which library an item key belongs to. */
export type LibraryLink = { kind: "user" } | { kind: "group"; id: number };

/** Zotero's item-key alphabet: digits 2 to 9 and capitals without O. */
export const ITEM_KEY_CHARS = "23456789ABCDEFGHIJKLMNPQRSTUVWXYZ";
const ITEM_KEY = new RegExp(`^[${ITEM_KEY_CHARS}]{8}$`);

export function isItemKey(value: unknown): value is string {
  return typeof value === "string" && ITEM_KEY.test(value);
}

/** The JSON object in a note's data block, once its version is 1. */
export function readVersionedBlock(
  html: string,
  attribute: string,
): Parsed<Record<string, unknown>> {
  const text = extractDataBlock(html, attribute);
  if (text === null) return { ok: false, reason: "no-data" };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: "bad-json" };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, reason: "bad-shape" };
  }
  const record = data as Record<string, unknown>;
  if (record.version === 1) return { ok: true, value: record };
  return {
    ok: false,
    reason:
      typeof record.version === "number" ? "unknown-version" : "bad-shape",
  };
}
```

- [ ] **Step 5: Run the gate**

Run: `npx prettier --write . && npm run check`
Expected: exit 0, `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/format/html.ts src/format/common.ts test/unit/html.test.ts
git commit -F - <<'EOF'
Find a note's data block, and name why a block does not parse

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011u94ZUBSZPgEppAcs8Tck8
EOF
```

---

### Task 3: The reading-list note

**Files:**

- Create: `src/format/readingList.ts`, `test/unit/readingList.test.ts`

**Interfaces:**

- Consumes: `Parsed`, `LibraryLink`, `isItemKey`, `readVersionedBlock` from
  `common.ts`; `escapeHtml`, `dataBlock` from `html.ts`.
- Produces:
  - `READING_LIST_TAG = "meristema-reading-list"`,
    `READING_LIST_ATTRIBUTE = "meristema-reading-list"`
  - `interface ReadingListStep { key: string; why: string }`
  - `interface ReadingListDoc { version: 1; topic: string; steps: ReadingListStep[] }`
  - `interface FolderItem { key: string; title: string }`
  - `interface ResolvedStep { step: number; key: string; why: string }`
  - `interface ResolvedList { steps: ResolvedStep[]; unordered: string[] }`
  - `parseReadingList(html: string): Parsed<ReadingListDoc>`
  - `resolveReadingList(doc: ReadingListDoc, folder: readonly FolderItem[]): ResolvedList`
  - `itemHref(link: LibraryLink, key: string): string`
  - `writeReadingList(doc: ReadingListDoc, label: (key: string) => string, link: LibraryLink): string`

Rules (the contract the fixtures pin):

- A step whose key is not an item key, or whose `why` is present and not a
  string, makes the note `bad-shape`. A missing `why` reads as `""`.
- A key repeated in `steps` keeps its first place.
- Resolving drops steps whose key is not in the folder and numbers the rest
  1…n. Folder papers not in `steps` are `unordered`, sorted by lowercased title
  (plain code-unit comparison), then by key.

- [ ] **Step 1: Write the failing test `test/unit/readingList.test.ts`**

```ts
import { describe, it } from "node:test";
import { expect } from "chai";

import {
  itemHref,
  parseReadingList,
  resolveReadingList,
  writeReadingList,
  type ReadingListDoc,
} from "../../src/format/readingList";
import { dataBlock } from "../../src/format/html";

const doc: ReadingListDoc = {
  version: 1,
  topic: "Joints & <glue>",
  steps: [
    { key: "ABCD2345", why: 'Start "here" & <now>' },
    { key: "BCDE3456", why: "" },
  ],
};

const note = (json: string) => dataBlock("meristema-reading-list", json);

describe("writeReadingList", () => {
  it("reads back as the same document", () => {
    const html = writeReadingList(doc, (key) => `Paper ${key}`, {
      kind: "user",
    });
    expect(parseReadingList(html)).to.deep.equal({ ok: true, value: doc });
  });

  it("links each step to its paper and gives its reason", () => {
    const html = writeReadingList(doc, (key) => `Paper ${key}`, {
      kind: "group",
      id: 123,
    });
    expect(html).to.contain(
      "<h1>Reading list - Joints &amp; &lt;glue&gt;</h1>",
    );
    expect(html).to.contain(
      '<li><a href="zotero://select/groups/123/items/ABCD2345">Paper ABCD2345</a>: Start &quot;here&quot; &amp; &lt;now&gt;</li>',
    );
    expect(html).to.contain(
      '<li><a href="zotero://select/groups/123/items/BCDE3456">Paper BCDE3456</a></li>',
    );
  });
});

describe("itemHref", () => {
  it("addresses the user's library and a group's", () => {
    expect(itemHref({ kind: "user" }, "ABCD2345")).to.equal(
      "zotero://select/library/items/ABCD2345",
    );
    expect(itemHref({ kind: "group", id: 7 }, "ABCD2345")).to.equal(
      "zotero://select/groups/7/items/ABCD2345",
    );
  });
});

describe("parseReadingList", () => {
  it("reads a missing reason as empty", () => {
    const parsed = parseReadingList(
      note('{"version":1,"topic":"T","steps":[{"key":"ABCD2345"}]}'),
    );
    expect(parsed).to.deep.equal({
      ok: true,
      value: { version: 1, topic: "T", steps: [{ key: "ABCD2345", why: "" }] },
    });
  });

  it("refuses a reason that is not text, or a key that is not a key", () => {
    for (const json of [
      '{"version":1,"topic":"T","steps":[{"key":"ABCD2345","why":3}]}',
      '{"version":1,"topic":"T","steps":[{"key":"abc","why":"x"}]}',
      '{"version":1,"topic":"T","steps":{}}',
      '{"version":1,"steps":[]}',
    ]) {
      expect(parseReadingList(note(json)), json).to.deep.equal({
        ok: false,
        reason: "bad-shape",
      });
    }
  });
});

describe("resolveReadingList", () => {
  it("drops steps outside the folder, renumbers, and sorts the leftovers", () => {
    const resolved = resolveReadingList(
      {
        version: 1,
        topic: "T",
        steps: [
          { key: "ABCD2345", why: "a" },
          { key: "BCDE3456", why: "b" },
          { key: "CDEF4567", why: "c" },
        ],
      },
      [
        { key: "CDEF4567", title: "Third" },
        { key: "DEFG5678", title: "beta" },
        { key: "ABCD2345", title: "First" },
        { key: "EFGH6789", title: "Alpha" },
      ],
    );
    expect(resolved).to.deep.equal({
      steps: [
        { step: 1, key: "ABCD2345", why: "a" },
        { step: 2, key: "CDEF4567", why: "c" },
      ],
      unordered: ["EFGH6789", "DEFG5678"],
    });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run test:unit`
Expected: FAIL, `Cannot find module` for `src/format/readingList.ts`.

- [ ] **Step 3: Write `src/format/readingList.ts`**

```ts
import {
  isItemKey,
  readVersionedBlock,
  type LibraryLink,
  type Parsed,
} from "./common";
import { dataBlock, escapeHtml } from "./html";

export const READING_LIST_TAG = "meristema-reading-list";
export const READING_LIST_ATTRIBUTE = "meristema-reading-list";

export interface ReadingListStep {
  key: string;
  why: string;
}

export interface ReadingListDoc {
  version: 1;
  topic: string;
  steps: ReadingListStep[];
}

export interface FolderItem {
  key: string;
  title: string;
}

export interface ResolvedStep {
  step: number;
  key: string;
  why: string;
}

export interface ResolvedList {
  steps: ResolvedStep[];
  unordered: string[];
}

const BAD_SHAPE = { ok: false, reason: "bad-shape" } as const;

export function parseReadingList(html: string): Parsed<ReadingListDoc> {
  const block = readVersionedBlock(html, READING_LIST_ATTRIBUTE);
  if (!block.ok) return block;
  const { topic, steps } = block.value;
  if (typeof topic !== "string" || !Array.isArray(steps)) return BAD_SHAPE;
  const seen = new Set<string>();
  const kept: ReadingListStep[] = [];
  for (const step of steps as unknown[]) {
    if (!step || typeof step !== "object") return BAD_SHAPE;
    const { key, why } = step as Record<string, unknown>;
    const reason =
      typeof why === "string" ? why : why === undefined ? "" : null;
    if (!isItemKey(key) || reason === null) return BAD_SHAPE;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push({ key, why: reason });
  }
  return { ok: true, value: { version: 1, topic, steps: kept } };
}

function byTitleThenKey(a: FolderItem, b: FolderItem): number {
  const ta = a.title.toLowerCase();
  const tb = b.title.toLowerCase();
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

export function resolveReadingList(
  doc: ReadingListDoc,
  folder: readonly FolderItem[],
): ResolvedList {
  const present = new Set(folder.map((item) => item.key));
  const steps = doc.steps
    .filter((step) => present.has(step.key))
    .map((step, index) => ({ step: index + 1, key: step.key, why: step.why }));
  const ordered = new Set(steps.map((step) => step.key));
  const unordered = folder
    .filter((item) => !ordered.has(item.key))
    .sort(byTitleThenKey)
    .map((item) => item.key);
  return { steps, unordered };
}

export function itemHref(link: LibraryLink, key: string): string {
  return link.kind === "user"
    ? `zotero://select/library/items/${key}`
    : `zotero://select/groups/${link.id}/items/${key}`;
}

/** The whole note: a readable part rebuilt from `doc`, then the data block. */
export function writeReadingList(
  doc: ReadingListDoc,
  label: (key: string) => string,
  link: LibraryLink,
): string {
  const items = doc.steps
    .map((step) => {
      const why = step.why ? `: ${escapeHtml(step.why)}` : "";
      return `<li><a href="${itemHref(link, step.key)}">${escapeHtml(label(step.key))}</a>${why}</li>`;
    })
    .join("");
  const json = JSON.stringify({
    version: 1,
    topic: doc.topic,
    steps: doc.steps.map((step) => ({ key: step.key, why: step.why })),
  });
  return (
    `<h1>Reading list - ${escapeHtml(doc.topic)}</h1>` +
    `<ol>${items}</ol>` +
    `<p>Plugin data (do not edit)</p>` +
    dataBlock(READING_LIST_ATTRIBUTE, json)
  );
}
```

- [ ] **Step 4: Run the gate**

Run: `npx prettier --write . && npm run check`
Expected: exit 0, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/format/readingList.ts test/unit/readingList.test.ts
git commit -F - <<'EOF'
Read and write the reading-list note, and resolve it against its folder

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011u94ZUBSZPgEppAcs8Tck8
EOF
```

---

### Task 4: The personal reading-state note

**Files:**

- Create: `src/format/readState.ts`, `test/unit/readState.test.ts`

**Interfaces:**

- Consumes: `Parsed`, `LibraryLink`, `ITEM_KEY_CHARS`, `readVersionedBlock`
  from `common.ts`; `dataBlock` from `html.ts`; `normalizeDOI` from `doi.ts`.
- Produces:
  - `READ_STATE_TAG = "meristema-reading-state"`,
    `READ_STATE_ATTRIBUTE = "meristema-reading-state"`
  - `type ReadState = "unread" | "reading" | "read"`
  - `interface ReadStateEntry { state: ReadState; at: string }`
  - `interface ReadStateDoc { version: 1; states: Record<string, ReadStateEntry> }`
  - `interface PaperRef { doi: string | null; library: LibraryLink; key: string }`
  - `MIRROR_TAGS = { reading: "_reading", read: "_read" }`
  - `paperId(ref: PaperRef): string`, `isPaperId(value: string): boolean`
  - `emptyReadState(): ReadStateDoc`
  - `parseReadState(html: string): Parsed<ReadStateDoc>`
  - `stateOf(doc: ReadStateDoc, id: string): ReadState`
  - `setState(doc: ReadStateDoc, id: string, state: ReadState, at: string): ReadStateDoc`
  - `mergeReadStates(a: ReadStateDoc, b: ReadStateDoc): ReadStateDoc`
  - `nextUp(steps: readonly { key: string }[], stateOfKey: (key: string) => ReadState): string | null`
  - `mirrorTag(state: ReadState): string | null`
  - `writeReadState(doc: ReadStateDoc): string`

Rules (the contract the fixtures pin):

- An entry with an id that is not a paper id, a state outside the three, or an
  `at` that `Date.parse` cannot read is dropped; the rest of the note stands.
- Merge, per paper: the later `at` wins; on equal `at`, Read beats Reading
  beats Unread.
- Writing sorts ids, so the same state always writes the same note.

- [ ] **Step 1: Write the failing test `test/unit/readState.test.ts`**

```ts
import { describe, it } from "node:test";
import { expect } from "chai";

import {
  emptyReadState,
  isPaperId,
  mergeReadStates,
  mirrorTag,
  nextUp,
  paperId,
  parseReadState,
  setState,
  stateOf,
  writeReadState,
  type ReadState,
} from "../../src/format/readState";
import { dataBlock } from "../../src/format/html";

describe("paperId", () => {
  it("prefers the DOI, else the library and key", () => {
    expect(
      paperId({
        doi: "https://doi.org/10.1000/ABC",
        library: { kind: "user" },
        key: "ABCD2345",
      }),
    ).to.equal("doi:10.1000/abc");
    expect(
      paperId({ doi: null, library: { kind: "user" }, key: "ABCD2345" }),
    ).to.equal("user:ABCD2345");
    expect(
      paperId({
        doi: "",
        library: { kind: "group", id: 123 },
        key: "BCDE3456",
      }),
    ).to.equal("group-123:BCDE3456");
  });

  it("recognises only the three id forms", () => {
    expect(isPaperId("doi:10.1000/abc")).to.equal(true);
    expect(isPaperId("user:ABCD2345")).to.equal(true);
    expect(isPaperId("group-1:ABCD2345")).to.equal(true);
    expect(isPaperId("__proto__")).to.equal(false);
    expect(isPaperId("user:abcd2345")).to.equal(false);
  });
});

describe("setState and stateOf", () => {
  it("leaves the old document alone and keeps Unread as a tombstone", () => {
    const empty = emptyReadState();
    const read = setState(
      empty,
      "user:ABCD2345",
      "read",
      "2026-11-01T00:00:00Z",
    );
    const unread = setState(
      read,
      "user:ABCD2345",
      "unread",
      "2026-11-02T00:00:00Z",
    );
    expect(stateOf(empty, "user:ABCD2345")).to.equal("unread");
    expect(stateOf(read, "user:ABCD2345")).to.equal("read");
    expect(unread.states["user:ABCD2345"]).to.deep.equal({
      state: "unread",
      at: "2026-11-02T00:00:00Z",
    });
  });
});

describe("mergeReadStates", () => {
  it("keeps the later change, and Read on a tie", () => {
    const a = setState(
      setState(
        emptyReadState(),
        "user:ABCD2345",
        "read",
        "2026-11-01T00:00:00Z",
      ),
      "user:BCDE3456",
      "reading",
      "2026-11-04T00:00:00Z",
    );
    const b = setState(
      setState(
        emptyReadState(),
        "user:ABCD2345",
        "unread",
        "2026-11-03T00:00:00Z",
      ),
      "user:BCDE3456",
      "read",
      "2026-11-04T00:00:00Z",
    );
    const merged = mergeReadStates(a, b);
    expect(stateOf(merged, "user:ABCD2345")).to.equal("unread");
    expect(stateOf(merged, "user:BCDE3456")).to.equal("read");
    expect(mergeReadStates(b, a)).to.deep.equal(merged);
  });
});

describe("nextUp", () => {
  const steps = [{ key: "A" }, { key: "B" }, { key: "C" }];
  const states = (map: Record<string, ReadState>) => (key: string) =>
    map[key] ?? "unread";

  it("is the first Reading step, else the first Unread one", () => {
    expect(nextUp(steps, states({ A: "read", C: "reading" }))).to.equal("C");
    expect(nextUp(steps, states({ A: "read" }))).to.equal("B");
    expect(nextUp(steps, states({ A: "read", B: "read", C: "read" }))).to.equal(
      null,
    );
  });
});

describe("mirrorTag", () => {
  it("tags Reading and Read, and leaves Unread bare", () => {
    expect(mirrorTag("reading")).to.equal("_reading");
    expect(mirrorTag("read")).to.equal("_read");
    expect(mirrorTag("unread")).to.equal(null);
  });
});

describe("the state note", () => {
  it("reads back what it wrote, whatever order the states were set in", () => {
    const one = setState(
      setState(
        emptyReadState(),
        "user:BCDE3456",
        "read",
        "2026-11-02T00:00:00Z",
      ),
      "doi:10.1000/abc",
      "reading",
      "2026-11-01T00:00:00Z",
    );
    const two = setState(
      setState(
        emptyReadState(),
        "doi:10.1000/abc",
        "reading",
        "2026-11-01T00:00:00Z",
      ),
      "user:BCDE3456",
      "read",
      "2026-11-02T00:00:00Z",
    );
    expect(writeReadState(one)).to.equal(writeReadState(two));
    expect(parseReadState(writeReadState(one))).to.deep.equal({
      ok: true,
      value: one,
    });
    expect(writeReadState(one)).to.contain("<p>1 reading, 1 read.");
  });

  it("drops damaged entries and keeps the rest", () => {
    const html = dataBlock(
      "meristema-reading-state",
      JSON.stringify({
        version: 1,
        states: {
          "user:ABCD2345": { state: "read", at: "2026-11-01T00:00:00Z" },
          "user:BCDE3456": { state: "done", at: "2026-11-01T00:00:00Z" },
          "user:CDEF4567": { state: "read", at: "yesterday" },
          nonsense: { state: "read", at: "2026-11-01T00:00:00Z" },
        },
      }),
    );
    expect(parseReadState(html)).to.deep.equal({
      ok: true,
      value: {
        version: 1,
        states: {
          "user:ABCD2345": { state: "read", at: "2026-11-01T00:00:00Z" },
        },
      },
    });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run test:unit`
Expected: FAIL, `Cannot find module` for `src/format/readState.ts`.

- [ ] **Step 3: Write `src/format/readState.ts`**

```ts
import {
  ITEM_KEY_CHARS,
  readVersionedBlock,
  type LibraryLink,
  type Parsed,
} from "./common";
import { normalizeDOI } from "./doi";
import { dataBlock } from "./html";

export const READ_STATE_TAG = "meristema-reading-state";
export const READ_STATE_ATTRIBUTE = "meristema-reading-state";

export type ReadState = "unread" | "reading" | "read";

export interface ReadStateEntry {
  state: ReadState;
  at: string;
}

export interface ReadStateDoc {
  version: 1;
  states: Record<string, ReadStateEntry>;
}

export interface PaperRef {
  doi: string | null;
  library: LibraryLink;
  key: string;
}

/** Tags mirrored onto papers for Zotero apps without plugins; Unread has none. */
export const MIRROR_TAGS = { reading: "_reading", read: "_read" } as const;

const RANK: Record<ReadState, number> = { unread: 0, reading: 1, read: 2 };
const PAPER_ID = new RegExp(
  `^(?:doi:10\\.\\d{4,9}/\\S+|user:[${ITEM_KEY_CHARS}]{8}|group-\\d+:[${ITEM_KEY_CHARS}]{8})$`,
);

export function paperId(ref: PaperRef): string {
  const doi = normalizeDOI(ref.doi);
  if (doi) return `doi:${doi}`;
  return ref.library.kind === "user"
    ? `user:${ref.key}`
    : `group-${ref.library.id}:${ref.key}`;
}

export function isPaperId(value: string): boolean {
  return PAPER_ID.test(value);
}

export function emptyReadState(): ReadStateDoc {
  return { version: 1, states: {} };
}

function isReadState(value: unknown): value is ReadState {
  return value === "unread" || value === "reading" || value === "read";
}

export function parseReadState(html: string): Parsed<ReadStateDoc> {
  const block = readVersionedBlock(html, READ_STATE_ATTRIBUTE);
  if (!block.ok) return block;
  const raw = block.value.states;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "bad-shape" };
  }
  const states: Record<string, ReadStateEntry> = {};
  for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!isPaperId(id) || !entry || typeof entry !== "object") continue;
    const { state, at } = entry as Record<string, unknown>;
    if (!isReadState(state)) continue;
    if (typeof at !== "string" || !Number.isFinite(Date.parse(at))) continue;
    states[id] = { state, at };
  }
  return { ok: true, value: { version: 1, states } };
}

export function stateOf(doc: ReadStateDoc, id: string): ReadState {
  return Object.hasOwn(doc.states, id) ? doc.states[id].state : "unread";
}

export function setState(
  doc: ReadStateDoc,
  id: string,
  state: ReadState,
  at: string,
): ReadStateDoc {
  return { version: 1, states: { ...doc.states, [id]: { state, at } } };
}

function later(a: ReadStateEntry, b: ReadStateEntry): ReadStateEntry {
  const ta = Date.parse(a.at);
  const tb = Date.parse(b.at);
  if (ta !== tb) return ta > tb ? a : b;
  return RANK[a.state] >= RANK[b.state] ? a : b;
}

export function mergeReadStates(
  a: ReadStateDoc,
  b: ReadStateDoc,
): ReadStateDoc {
  const states: Record<string, ReadStateEntry> = { ...a.states };
  for (const [id, entry] of Object.entries(b.states)) {
    states[id] = Object.hasOwn(states, id) ? later(states[id], entry) : entry;
  }
  return { version: 1, states };
}

export function nextUp(
  steps: readonly { key: string }[],
  stateOfKey: (key: string) => ReadState,
): string | null {
  return (
    steps.find((step) => stateOfKey(step.key) === "reading")?.key ??
    steps.find((step) => stateOfKey(step.key) === "unread")?.key ??
    null
  );
}

export function mirrorTag(state: ReadState): string | null {
  return state === "unread" ? null : MIRROR_TAGS[state];
}

/** The whole note, with ids sorted so equal states write equal notes. */
export function writeReadState(doc: ReadStateDoc): string {
  const ids = Object.keys(doc.states).sort();
  const states = Object.fromEntries(
    ids.map((id) => [
      id,
      { state: doc.states[id].state, at: doc.states[id].at },
    ]),
  );
  const count = (state: ReadState) =>
    ids.filter((id) => doc.states[id].state === state).length;
  return (
    `<h1>Reading state</h1>` +
    `<p>${count("reading")} reading, ${count("read")} read. Kept by Meristema Reading.</p>` +
    `<p>Plugin data (do not edit)</p>` +
    dataBlock(READ_STATE_ATTRIBUTE, JSON.stringify({ version: 1, states }))
  );
}
```

- [ ] **Step 4: Run the gate**

Run: `npx prettier --write . && npm run check`
Expected: exit 0, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/format/readState.ts test/unit/readState.test.ts
git commit -F - <<'EOF'
Read, merge and write the personal reading-state note

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011u94ZUBSZPgEppAcs8Tck8
EOF
```

---

### Task 5: The shared fixtures and their runner

**Files:**

- Create: `fixtures/README.md`, `fixtures/paper-ids.json`,
  `fixtures/next-up.json`, `fixtures/lists/*.html` and `*.json`,
  `fixtures/states/*.html` and `*.json`, `test/unit/fixtures.test.ts`

**Interfaces:**

- Consumes: everything Task 3 and Task 4 produce.
- Produces: the fixture layout below, which step 2's Python parser and step 3's
  Meristema copy run unchanged.

Keys used: `ABCD2345`, `BCDE3456`, `CDEF4567`, `DEFG5678`, `EFGH6789`.

- [ ] **Step 1: Write `fixtures/README.md`**

```markdown
# Format fixtures

Every implementation of the two note formats (this plugin, Meristema, the
using-zotero skill) must pass every case here. Change a case only together with
the spec.

- `lists/<case>.json`: `{ "note": "<file>.html", "folder": [{ "key", "title" }], "expect": … }`.
  `expect` is `{ "ok": false, "reason" }`, or
  `{ "ok": true, "topic", "steps": [{ "step", "key", "why" }], "unordered": [key] }`,
  the result of parsing the note and resolving it against `folder`.
- `states/<case>.json`: `{ "notes": ["<file>.html", …], "expect": … }`. Parse
  each note and merge them in order, starting from an empty state. `expect` is
  `{ "ok": false, "reason" }` (the first note fails with it), or
  `{ "ok": true, "states": { id: state }, "mirror": { id: tag | null } }`.
- `paper-ids.json`: `[{ "ref": { "doi", "library", "key" }, "id" }]`, where
  `library` is `{ "kind": "user" }` or `{ "kind": "group", "id" }`.
- `next-up.json`: `[{ "steps": [key], "states": { key: state }, "expect": key | null }]`;
  a key missing from `states` is Unread.

The `.html` files are byte-exact (prettier skips them), some written as the
Zotero note editor may leave them.
```

- [ ] **Step 2: Write the list notes**

`fixtures/lists/ordered.html`:

```text
<div data-schema-version="9"><h1>Reading list - Timber joints</h1><ol><li><a href="zotero://select/library/items/ABCD2345">Smith 2001, Joints</a>: Start here: the vocabulary.</li><li><a href="zotero://select/library/items/BCDE3456">Lee 2010, Tests</a>: The experiments.</li><li><a href="zotero://select/library/items/CDEF4567">Ruiz 2020, Robots</a>: Where it is going.</li></ol><p>Plugin data (do not edit)</p><pre data-meristema-reading-list="1">{"version":1,"topic":"Timber joints","steps":[{"key":"ABCD2345","why":"Start here: the vocabulary."},{"key":"BCDE3456","why":"The experiments."},{"key":"CDEF4567","why":"Where it is going."}]}</pre></div>
```

`fixtures/lists/unordered-leftovers.html`:

```text
<h1>Reading list - Leftovers</h1><pre data-meristema-reading-list="1">{"version":1,"topic":"Leftovers","steps":[{"key":"ABCD2345","why":"a"},{"key":"BCDE3456","why":"b"}]}</pre>
```

`fixtures/lists/missing-keys.html`:

```text
<h1>Reading list - Gaps</h1><pre data-meristema-reading-list="1">{"version":1,"topic":"Gaps","steps":[{"key":"ABCD2345","why":"a"},{"key":"BCDE3456","why":"b"},{"key":"CDEF4567","why":"c"}]}</pre>
```

`fixtures/lists/duplicate-step.html`:

```text
<h1>Reading list - Twice</h1><pre data-meristema-reading-list="1">{"version":1,"topic":"Twice","steps":[{"key":"ABCD2345","why":"first"},{"key":"BCDE3456","why":"b"},{"key":"ABCD2345","why":"again"}]}</pre>
```

`fixtures/lists/editor-mangled.html`:

```text
<div data-schema-version="9"><h1>Reading list - Joints &amp; glue</h1><p>Plugin data (do not edit)</p><pre class="language-json" data-meristema-reading-list="1"><code>{&quot;version&quot;:1,&quot;topic&quot;:&quot;Joints &amp; glue&quot;,<br>&quot;steps&quot;:[{&quot;key&quot;:&quot;ABCD2345&quot;,&quot;why&quot;:&quot;Read &lt;this&gt; first&quot;}]}</code></pre></div>
```

`fixtures/lists/wrong-version.html`:

```text
<pre data-meristema-reading-list="1">{"version":2,"topic":"Future","steps":[]}</pre>
```

`fixtures/lists/bad-json.html`:

```text
<pre data-meristema-reading-list="1">{"version":1,"topic":</pre>
```

`fixtures/lists/bad-key.html`:

```text
<pre data-meristema-reading-list="1">{"version":1,"topic":"T","steps":[{"key":"abc","why":"x"}]}</pre>
```

`fixtures/lists/no-data.html`:

```text
<div data-schema-version="9"><p>Just a note about joints.</p></div>
```

- [ ] **Step 3: Write the list cases**

`fixtures/lists/ordered.json`:

```json
{
  "note": "ordered.html",
  "folder": [
    { "key": "CDEF4567", "title": "Robots" },
    { "key": "ABCD2345", "title": "Joints" },
    { "key": "BCDE3456", "title": "Tests" }
  ],
  "expect": {
    "ok": true,
    "topic": "Timber joints",
    "steps": [
      { "step": 1, "key": "ABCD2345", "why": "Start here: the vocabulary." },
      { "step": 2, "key": "BCDE3456", "why": "The experiments." },
      { "step": 3, "key": "CDEF4567", "why": "Where it is going." }
    ],
    "unordered": []
  }
}
```

`fixtures/lists/unordered-leftovers.json`:

```json
{
  "note": "unordered-leftovers.html",
  "folder": [
    { "key": "DEFG5678", "title": "beta" },
    { "key": "ABCD2345", "title": "A" },
    { "key": "EFGH6789", "title": "Alpha" },
    { "key": "BCDE3456", "title": "B" }
  ],
  "expect": {
    "ok": true,
    "topic": "Leftovers",
    "steps": [
      { "step": 1, "key": "ABCD2345", "why": "a" },
      { "step": 2, "key": "BCDE3456", "why": "b" }
    ],
    "unordered": ["EFGH6789", "DEFG5678"]
  }
}
```

`fixtures/lists/missing-keys.json`:

```json
{
  "note": "missing-keys.html",
  "folder": [
    { "key": "ABCD2345", "title": "A" },
    { "key": "CDEF4567", "title": "C" }
  ],
  "expect": {
    "ok": true,
    "topic": "Gaps",
    "steps": [
      { "step": 1, "key": "ABCD2345", "why": "a" },
      { "step": 2, "key": "CDEF4567", "why": "c" }
    ],
    "unordered": []
  }
}
```

`fixtures/lists/duplicate-step.json`:

```json
{
  "note": "duplicate-step.html",
  "folder": [
    { "key": "ABCD2345", "title": "A" },
    { "key": "BCDE3456", "title": "B" }
  ],
  "expect": {
    "ok": true,
    "topic": "Twice",
    "steps": [
      { "step": 1, "key": "ABCD2345", "why": "first" },
      { "step": 2, "key": "BCDE3456", "why": "b" }
    ],
    "unordered": []
  }
}
```

`fixtures/lists/editor-mangled.json`:

```json
{
  "note": "editor-mangled.html",
  "folder": [{ "key": "ABCD2345", "title": "A" }],
  "expect": {
    "ok": true,
    "topic": "Joints & glue",
    "steps": [{ "step": 1, "key": "ABCD2345", "why": "Read <this> first" }],
    "unordered": []
  }
}
```

`fixtures/lists/wrong-version.json`:

```json
{
  "note": "wrong-version.html",
  "folder": [],
  "expect": { "ok": false, "reason": "unknown-version" }
}
```

`fixtures/lists/bad-json.json`:

```json
{
  "note": "bad-json.html",
  "folder": [],
  "expect": { "ok": false, "reason": "bad-json" }
}
```

`fixtures/lists/bad-key.json`:

```json
{
  "note": "bad-key.html",
  "folder": [],
  "expect": { "ok": false, "reason": "bad-shape" }
}
```

`fixtures/lists/no-data.json`:

```json
{
  "note": "no-data.html",
  "folder": [],
  "expect": { "ok": false, "reason": "no-data" }
}
```

- [ ] **Step 4: Write the state notes**

`fixtures/states/doi-and-keys.html`:

```text
<h1>Reading state</h1><p>1 reading, 1 read. Kept by Meristema Reading.</p><p>Plugin data (do not edit)</p><pre data-meristema-reading-state="1">{"version":1,"states":{"doi:10.1000/xyz":{"state":"read","at":"2026-11-01T10:00:00Z"},"group-123:BCDE3456":{"state":"unread","at":"2026-11-03T10:00:00Z"},"user:ABCD2345":{"state":"reading","at":"2026-11-02T10:00:00Z"}}}</pre>
```

`fixtures/states/merge-a.html`:

```text
<pre data-meristema-reading-state="1">{"version":1,"states":{"user:ABCD2345":{"state":"read","at":"2026-11-01T00:00:00Z"},"user:BCDE3456":{"state":"reading","at":"2026-11-05T00:00:00Z"},"user:CDEF4567":{"state":"reading","at":"2026-11-04T00:00:00Z"}}}</pre>
```

`fixtures/states/merge-b.html`:

```text
<pre data-meristema-reading-state="1">{"version":1,"states":{"user:ABCD2345":{"state":"unread","at":"2026-11-03T00:00:00Z"},"user:BCDE3456":{"state":"read","at":"2026-11-02T00:00:00Z"},"user:CDEF4567":{"state":"read","at":"2026-11-04T00:00:00Z"},"user:DEFG5678":{"state":"reading","at":"2026-11-01T00:00:00Z"}}}</pre>
```

`fixtures/states/damaged-entries.html`:

```text
<pre data-meristema-reading-state="1">{"version":1,"states":{"user:ABCD2345":{"state":"read","at":"2026-11-01T00:00:00Z"},"user:BCDE3456":{"state":"done","at":"2026-11-01T00:00:00Z"},"user:CDEF4567":{"state":"read","at":"yesterday"},"__proto__":{"state":"read","at":"2026-11-01T00:00:00Z"},"user:DEFG5678":"read"}}</pre>
```

`fixtures/states/wrong-version.html`:

```text
<pre data-meristema-reading-state="1">{"version":2,"states":{}}</pre>
```

- [ ] **Step 5: Write the state cases**

`fixtures/states/doi-and-keys.json`:

```json
{
  "notes": ["doi-and-keys.html"],
  "expect": {
    "ok": true,
    "states": {
      "doi:10.1000/xyz": "read",
      "user:ABCD2345": "reading",
      "group-123:BCDE3456": "unread",
      "user:CDEF4567": "unread"
    },
    "mirror": {
      "doi:10.1000/xyz": "_read",
      "user:ABCD2345": "_reading",
      "group-123:BCDE3456": null
    }
  }
}
```

`fixtures/states/merge.json`:

```json
{
  "notes": ["merge-a.html", "merge-b.html"],
  "expect": {
    "ok": true,
    "states": {
      "user:ABCD2345": "unread",
      "user:BCDE3456": "reading",
      "user:CDEF4567": "read",
      "user:DEFG5678": "reading"
    },
    "mirror": {
      "user:ABCD2345": null,
      "user:BCDE3456": "_reading",
      "user:CDEF4567": "_read",
      "user:DEFG5678": "_reading"
    }
  }
}
```

`fixtures/states/damaged-entries.json`:

```json
{
  "notes": ["damaged-entries.html"],
  "expect": {
    "ok": true,
    "states": {
      "user:ABCD2345": "read",
      "user:BCDE3456": "unread",
      "user:CDEF4567": "unread",
      "user:DEFG5678": "unread",
      "__proto__": "unread"
    },
    "mirror": { "user:ABCD2345": "_read" }
  }
}
```

`fixtures/states/wrong-version.json`:

```json
{
  "notes": ["wrong-version.html"],
  "expect": { "ok": false, "reason": "unknown-version" }
}
```

- [ ] **Step 6: Write `fixtures/paper-ids.json` and `fixtures/next-up.json`**

`fixtures/paper-ids.json`:

```json
[
  {
    "ref": {
      "doi": "https://doi.org/10.1000/ABC.",
      "library": { "kind": "user" },
      "key": "ABCD2345"
    },
    "id": "doi:10.1000/abc"
  },
  {
    "ref": { "doi": null, "library": { "kind": "user" }, "key": "ABCD2345" },
    "id": "user:ABCD2345"
  },
  {
    "ref": {
      "doi": "",
      "library": { "kind": "group", "id": 123 },
      "key": "BCDE3456"
    },
    "id": "group-123:BCDE3456"
  },
  {
    "ref": {
      "doi": "not a doi",
      "library": { "kind": "user" },
      "key": "CDEF4567"
    },
    "id": "user:CDEF4567"
  }
]
```

`fixtures/next-up.json`:

```json
[
  {
    "steps": ["ABCD2345", "BCDE3456", "CDEF4567"],
    "states": { "ABCD2345": "read", "CDEF4567": "reading" },
    "expect": "CDEF4567"
  },
  {
    "steps": ["ABCD2345", "BCDE3456", "CDEF4567"],
    "states": { "ABCD2345": "read" },
    "expect": "BCDE3456"
  },
  {
    "steps": ["ABCD2345", "BCDE3456"],
    "states": { "ABCD2345": "read", "BCDE3456": "read" },
    "expect": null
  },
  { "steps": [], "states": {}, "expect": null }
]
```

- [ ] **Step 7: Write the runner `test/unit/fixtures.test.ts`**

```ts
import { describe, it } from "node:test";
import { expect } from "chai";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  parseReadingList,
  resolveReadingList,
  type FolderItem,
  type ResolvedStep,
} from "../../src/format/readingList";
import {
  emptyReadState,
  mergeReadStates,
  mirrorTag,
  nextUp,
  paperId,
  parseReadState,
  stateOf,
  type PaperRef,
  type ReadState,
  type ReadStateDoc,
} from "../../src/format/readState";

const root = fileURLToPath(new URL("../../fixtures/", import.meta.url));
const text = (path: string): string => readFileSync(root + path, "utf8");
const json = <T>(path: string): T => JSON.parse(text(path)) as T;
const cases = (dir: string): string[] =>
  readdirSync(root + dir)
    .filter((name) => name.endsWith(".json"))
    .sort();

type Failure = { ok: false; reason: string };

interface ListCase {
  note: string;
  folder: FolderItem[];
  expect:
    | Failure
    | {
        ok: true;
        topic: string;
        steps: ResolvedStep[];
        unordered: string[];
      };
}

interface StateCase {
  notes: string[];
  expect:
    | Failure
    | {
        ok: true;
        states: Record<string, ReadState>;
        mirror: Record<string, string | null>;
      };
}

describe("list fixtures", () => {
  for (const name of cases("lists")) {
    it(name, () => {
      const c = json<ListCase>(`lists/${name}`);
      const want = c.expect;
      const parsed = parseReadingList(text(`lists/${c.note}`));
      if (!want.ok) {
        expect(parsed).to.deep.equal({ ok: false, reason: want.reason });
        return;
      }
      if (!parsed.ok) throw new Error(`${name} failed: ${parsed.reason}`);
      expect(parsed.value.topic).to.equal(want.topic);
      expect(resolveReadingList(parsed.value, c.folder)).to.deep.equal({
        steps: want.steps,
        unordered: want.unordered,
      });
    });
  }
});

describe("state fixtures", () => {
  for (const name of cases("states")) {
    it(name, () => {
      const c = json<StateCase>(`states/${name}`);
      const want = c.expect;
      let doc: ReadStateDoc = emptyReadState();
      for (const note of c.notes) {
        const parsed = parseReadState(text(`states/${note}`));
        if (!parsed.ok) {
          expect(want.ok, `${note} failed: ${parsed.reason}`).to.equal(false);
          if (!want.ok) expect(parsed.reason).to.equal(want.reason);
          return;
        }
        doc = mergeReadStates(doc, parsed.value);
      }
      if (!want.ok) throw new Error(`${name} parsed; wanted ${want.reason}`);
      for (const [id, state] of Object.entries(want.states)) {
        expect(stateOf(doc, id), id).to.equal(state);
      }
      for (const [id, tag] of Object.entries(want.mirror)) {
        expect(mirrorTag(stateOf(doc, id)), id).to.equal(tag);
      }
    });
  }
});

describe("paper-id fixtures", () => {
  for (const c of json<{ ref: PaperRef; id: string }[]>("paper-ids.json")) {
    it(c.id, () => expect(paperId(c.ref)).to.equal(c.id));
  }
});

describe("next-up fixtures", () => {
  const all = json<
    {
      steps: string[];
      states: Record<string, ReadState>;
      expect: string | null;
    }[]
  >("next-up.json");
  all.forEach((c, index) => {
    it(`case ${index + 1}`, () => {
      const steps = c.steps.map((key) => ({ key }));
      expect(nextUp(steps, (key) => c.states[key] ?? "unread")).to.equal(
        c.expect,
      );
    });
  });
});
```

- [ ] **Step 8: Run the gate**

Run: `npx prettier --write . && npm run check`
Expected: exit 0, `fail 0`. Every fixture case passes against Tasks 3 and 4
as written; if one fails, the fixture and the rules above disagree. Fix the code
when the case matches the rules, and never edit a case to fit the code.

- [ ] **Step 9: Prove the runner can fail**

Temporarily change `"why": "a"` to `"why": "z"` in
`fixtures/lists/missing-keys.json`, run `npm run test:unit`, and expect one
failure naming `missing-keys.json`. Revert the change, and run
`npm run check` again: exit 0.

- [ ] **Step 10: Commit**

```bash
git add fixtures test/unit/fixtures.test.ts
git commit -F - <<'EOF'
Add the shared format fixtures and the runner every parser must pass

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011u94ZUBSZPgEppAcs8Tck8
EOF
```

---

### Task 6: Land it, and bring the spec and roadmap in line

**Files:**

- Modify (meristema-zotero):
  `docs/superpowers/specs/2026-11-06-reading-lists-design.md`,
  `docs/superpowers/handoffs/roadmap.md`

- [ ] **Step 1: Fast-forward the new repo's `main`**

```bash
cd /c/repos/github/daniel-locatelli/zotero-meristema-reading
npm run check
git switch main && git merge --ff-only format && git branch -d format
```

Expected: `npm run check` exit 0 before the merge.

- [ ] **Step 2: Update the spec in meristema-zotero**

On a branch `r1-format-landed`, change in
`docs/superpowers/specs/2026-11-06-reading-lists-design.md`:

- The state JSON line: `"state": "reading" | "read"` becomes
  `"state": "unread" | "reading" | "read"`, and add the bullet: "Unread is
  stored only as a tombstone after un-marking, so a merge cannot bring back an
  older Read; an absent paper is Unread."
- The unordered rule: "in Zotero's title order" becomes "by lowercased title,
  then key".
- Under Testing, first bullet, add: "They live in
  `zotero-meristema-reading/fixtures/`, described by its `README.md`."

- [ ] **Step 3: Update the roadmap's R1 entry**

Replace "Next: the plan for step 1 (the format and its sample notes)." with
"Step 1 (format and fixtures) is done in the local repo
`zotero-meristema-reading`, not yet on GitHub. Next: the plan for step 2 (the
plugin and the skill verb)."

- [ ] **Step 4: Gate and commit in meristema-zotero**

Run: `npx prettier --write docs/superpowers && npm run check`
Expected: exit 0.

```bash
git add docs/superpowers/specs/2026-11-06-reading-lists-design.md docs/superpowers/handoffs/roadmap.md
git commit -F - <<'EOF'
Record R1 step 1: the format and its fixtures

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011u94ZUBSZPgEppAcs8Tck8
EOF
git switch main && git merge --ff-only r1-format-landed && git branch -d r1-format-landed
```
