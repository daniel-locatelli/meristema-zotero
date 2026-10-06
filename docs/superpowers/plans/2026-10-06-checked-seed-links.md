# Checked Seed Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A hop-1 paper linked to two seeds reads k = 2 even when it made only one seed's cut of 50 (B78), by checking OpenAlex reference lists.

**Architecture:** A separate OpenAlex batch (`select=id,doi,referenced_works`) over the seeds and hop-1 papers, cached per paper in a new SQLite table. A pure `checkedSeedLinks` derives extra seed parents; `buildGraphHopModel` adds them as parents and edges after hop 1, so every existing reader of parents picks them up. A module-level scheduler decides what to ask and when.

**Tech Stack:** TypeScript, Zotero 7 plugin, `node --test` + chai unit tests (`test/unit`), mocha Zotero suite (`test/zotero`).

**Spec:** `docs/superpowers/specs/2026-10-06-checked-seed-links-design.md`.

## Global Constraints

- Gate, on fetch and read: an OpenAlex key, OpenAlex enabled, and two or more seeds. Outside it, today's count.
- `select=id,doi,referenced_works` and nothing else: no title field (it keeps answers out of `external_works_v2`).
- Batches of `Math.min(100, providerExecutionPolicy("openalex").batchSize)`, `per_page=200`, results matched by normalised ID or DOI, never by position.
- `requestJSON("openalex", url, { signal, retryRefusals: false })`.
- OpenAlex IDs: `shortOpenAlexID`, accepted only if `/^W\d+$/i`, upper-cased. DOIs: `normalizeDOI`. Aliases: `openalex:W…`, `doi:…`.
- Freshness: success 180 days, not-found 30 days. Backoff per alias, per session: 5 min, 30 min, 6 h, 1 day.
- Commits: sentence-case subject, no type prefix, staged by path, ending with
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_011u94ZUBSZPgEppAcs8Tck8`.
- Gate per task: `npm run check` (prettier on src, test and docs, eslint, typecheck, unit). Run a single unit file with
  `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/<file>.test.ts`.
- Unit tests must not touch `Zotero.*` or the DOM (see `test/nodeResolve.mjs`).
- Do not run the Zotero suite (`npm test`) except where a task says so.

## Files

- `src/services/graphSeedLinks.ts` (modify): `SeedLinkCheck`, `canonicalOpenAlexID`, `openAlexIdentifiersOf`, `checkedSeedLinks`.
- `src/services/graphHopModel.ts` (modify): `GraphHopInput.checkOf` and the parent and edge pass.
- `src/services/openAlexReferenceLists.ts` (new, pure): `CheckPaper`, aliases, rows, freshness, the in-memory mirror, the DB row codec.
- `src/services/openAlexSeedLinkService.ts` (new): the batches, ID-then-DOI retry, 4xx split.
- `src/services/seedLinkCheckScheduler.ts` (new, pure): dirty, collect, in flight, backoff, abort, notify.
- `src/services/externalWorkCacheService.ts` (modify): the table, prune, mirror, lookup, save, clear, close.
- `src/services/graphViewService.ts` (modify): the gate, `checkOf`, the scheduler client.
- Tests: `test/unit/graphSeedLinks.test.ts`, `test/unit/graphHopModel.test.ts`, `test/unit/openAlexReferenceLists.test.ts` (new), `test/unit/openAlexSeedLinkService.test.ts` (new), `test/unit/seedLinkCheckScheduler.test.ts` (new), `test/zotero/graphCitationHops.test.ts`.
- Docs: `CONTEXT.md`, `docs/adr/0018-seed-links-are-checked-against-openalex-reference-lists.md` (new), `docs/superpowers/handoffs/roadmap.md`.

---

### Task 1: Identifiers and checked seed links (pure)

**Files:**

- Modify: `src/services/graphSeedLinks.ts`
- Test: `test/unit/graphSeedLinks.test.ts`

**Interfaces:**

- Produces:
  - `interface SeedLinkCheck { openAlexID: string; references: readonly string[] }`
  - `function canonicalOpenAlexID(value: unknown): string | null`
  - `interface OpenAlexIdentifiers { openAlexID: string | null; doi: string | null }`
  - `function openAlexIdentifiersOf(node: Pick<CitationGraphNode, "provider" | "providerWorkID" | "sourceMetrics" | "externalWork" | "doi">): OpenAlexIdentifiers`
  - `interface CheckedPaper { key: string; check?: SeedLinkCheck }`
  - `function checkedSeedLinks(direction: HopDirection, seeds: readonly CheckedPaper[], hop1: readonly CheckedPaper[]): Map<string, string[]>`

- [ ] **Step 1: Write the failing tests**

Append to `test/unit/graphSeedLinks.test.ts`, and add `canonicalOpenAlexID`, `checkedSeedLinks`, `openAlexIdentifiersOf` to its import from `../../src/services/graphSeedLinks`:

```ts
describe("openAlexIdentifiersOf", function () {
  const bare = {
    provider: null,
    providerWorkID: null,
    sourceMetrics: null,
    externalWork: null,
    doi: null,
  };

  it("takes the node's own ID when OpenAlex is its provider", function () {
    expect(
      openAlexIdentifiersOf({
        ...bare,
        provider: "openalex",
        providerWorkID: "https://openalex.org/w123",
        sourceMetrics: {
          libraryUpdateState: { providerWorkIDs: { openalex: "W9" } },
        } as never,
      }),
    ).to.deep.equal({ openAlexID: "W123", doi: null });
  });

  it("falls back to the library update's IDs, then the external work's", function () {
    expect(
      openAlexIdentifiersOf({
        ...bare,
        provider: "semantic-scholar",
        providerWorkID: "abc",
        sourceMetrics: {
          libraryUpdateState: { providerWorkIDs: { openalex: "W77" } },
        } as never,
      }).openAlexID,
    ).to.equal("W77");
    expect(
      openAlexIdentifiersOf({
        ...bare,
        externalWork: { provider: "openalex", providerWorkID: "W5" } as never,
      }).openAlexID,
    ).to.equal("W5");
  });

  it("rejects an ID that is not a work ID", function () {
    expect(canonicalOpenAlexID("A123")).to.equal(null);
    expect(canonicalOpenAlexID("")).to.equal(null);
    expect(
      openAlexIdentifiersOf({
        ...bare,
        provider: "openalex",
        providerWorkID: "S42",
      }).openAlexID,
    ).to.equal(null);
  });

  it("normalises the DOI, from the node or its external work", function () {
    expect(
      openAlexIdentifiersOf({ ...bare, doi: "https://doi.org/10.1234/ABC" })
        .doi,
    ).to.equal("10.1234/abc");
    expect(
      openAlexIdentifiersOf({
        ...bare,
        externalWork: { provider: "crossref", doi: "10.2345/X" } as never,
      }).doi,
    ).to.equal("10.2345/x");
  });
});

describe("checkedSeedLinks", function () {
  const A = { key: "a", check: { openAlexID: "W1", references: [] } };
  const B = { key: "b", check: { openAlexID: "W2", references: ["W10"] } };

  it("under Citers, links a paper to every seed in its references", function () {
    const links = checkedSeedLinks(
      "cited-by",
      [A, B],
      [{ key: "p", check: { openAlexID: "W10", references: ["W1", "W2"] } }],
    );
    expect(links.get("p")).to.deep.equal(["a", "b"]);
  });

  it("under References, links a paper to every seed whose references hold it", function () {
    const links = checkedSeedLinks(
      "references",
      [A, B],
      [{ key: "p", check: { openAlexID: "W10", references: [] } }],
    );
    expect(links.get("p")).to.deep.equal(["b"]);
  });

  it("learns nothing from a seed or a paper with no check", function () {
    const links = checkedSeedLinks(
      "cited-by",
      [{ key: "a" }, B],
      [
        { key: "p", check: { openAlexID: "W10", references: ["W1"] } },
        { key: "q" },
      ],
    );
    expect(links.size).to.equal(0);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/graphSeedLinks.test.ts`
Expected: FAIL, `openAlexIdentifiersOf` is not exported.

- [ ] **Step 3: Implement**

In `src/services/graphSeedLinks.ts`, replace the last two lines of the header comment:

```ts
 * The count is of the links the graph holds: a seed's hop-1 list is cut at 50
 * (ADR 0015), so a paper citing two seeds that made one cut reads 1.
```

with:

```ts
 * The count is of the links the graph knows: the stored lists, cut at 50
 * (ADR 0015), and, with an OpenAlex key, the reference lists OpenAlex holds
 * for the seeds and hop-1 papers (ADR 0018), which find the links the cut
 * dropped.
```

Replace the import line with:

```ts
import type { CitationGraphNode } from "../domain/graphTypes";
import { normalizeDOI } from "../domain/workIdentity";
import { shortOpenAlexID } from "../providers/providerIdentifiers";
import type { HopDirection, SeedMarks } from "./graphHopModel";
```

Append to the file:

```ts
/** What the check learned about one paper (ADR 0018). */
export interface SeedLinkCheck {
  openAlexID: string;
  references: readonly string[];
}

export interface OpenAlexIdentifiers {
  openAlexID: string | null;
  doi: string | null;
}

/** An OpenAlex work ID in the one form the check stores, or null. */
export function canonicalOpenAlexID(value: unknown): string | null {
  const id = shortOpenAlexID(value);
  return id && /^W\d+$/i.test(id) ? id.toLocaleUpperCase() : null;
}

/** The identifiers the check asks OpenAlex by, for a seed or a hop-1 paper. */
export function openAlexIdentifiersOf(
  node: Pick<
    CitationGraphNode,
    "provider" | "providerWorkID" | "sourceMetrics" | "externalWork" | "doi"
  >,
): OpenAlexIdentifiers {
  const candidates = [
    node.provider === "openalex" ? node.providerWorkID : null,
    node.sourceMetrics?.libraryUpdateState?.providerWorkIDs?.openalex,
    node.externalWork?.provider === "openalex"
      ? node.externalWork.providerWorkID
      : null,
  ];
  let openAlexID: string | null = null;
  for (const candidate of candidates) {
    openAlexID = canonicalOpenAlexID(candidate);
    if (openAlexID) break;
  }
  return {
    openAlexID,
    doi: normalizeDOI(node.doi ?? node.externalWork?.doi),
  };
}

export interface CheckedPaper {
  key: string;
  check?: SeedLinkCheck;
}

/**
 * The seeds each hop-1 paper links to by the check: under Citers the seeds in
 * its references, under References the seeds whose references hold it.
 */
export function checkedSeedLinks(
  direction: HopDirection,
  seeds: readonly CheckedPaper[],
  hop1: readonly CheckedPaper[],
): Map<string, string[]> {
  const links = new Map<string, string[]>();
  for (const paper of hop1) {
    if (!paper.check) continue;
    const found: string[] = [];
    for (const seed of seeds) {
      if (!seed.check || seed.key === paper.key) continue;
      const linked =
        direction === "references"
          ? seed.check.references.includes(paper.check.openAlexID)
          : paper.check.references.includes(seed.check.openAlexID);
      if (linked) found.push(seed.key);
    }
    if (found.length) links.set(paper.key, found);
  }
  return links;
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/graphSeedLinks.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate and commit**

Run: `npm run check` — expected: green.

```bash
git add src/services/graphSeedLinks.ts test/unit/graphSeedLinks.test.ts
git commit -m "Seed links learn a paper's OpenAlex identifiers and the links a check finds"
```

---

### Task 2: The hop model adds checked seeds as parents

**Files:**

- Modify: `src/services/graphHopModel.ts` (the `GraphHopInput` interface; `buildGraphHopModel` after the frontier loop)
- Test: `test/unit/graphHopModel.test.ts`

**Interfaces:**

- Consumes: `checkedSeedLinks`, `SeedLinkCheck` (Task 1).
- Produces: `GraphHopInput.checkOf?: (node: CitationGraphNode) => SeedLinkCheck | undefined`.

- [ ] **Step 1: Write the failing tests**

Append to `test/unit/graphHopModel.test.ts` (it already has `node` and `lookup` helpers):

```ts
describe("buildGraphHopModel with checked seed links", function () {
  const checks: Record<string, { openAlexID: string; references: string[] }> = {
    a: { openAlexID: "W1", references: [] },
    b: { openAlexID: "W2", references: [] },
    p: { openAlexID: "W10", references: ["W1", "W2"] },
  };
  const checkOf = (n: CitationGraphNode) => checks[n.key];

  it("gives a paper in one seed's list the other seed it cites, with an edge", function () {
    const model = buildGraphHopModel({
      seeds: [node("a"), node("b")],
      direction: "cited-by",
      depth: 1,
      neighbours: lookup({ a: ["p"], b: [] }),
      checkOf,
    })!;
    expect([...model.entries.get("p")!.parents].sort()).to.deep.equal([
      "a",
      "b",
    ]);
    expect(model.edges.map((edge) => edge.key).sort()).to.deep.equal([
      "p>a:hop",
      "p>b:hop",
    ]);
    expect(model.edges.find((edge) => edge.key === "p>b:hop")).to.deep.include({
      source: "p",
      target: "b",
      provenance: "openalex",
    });
    expect(model.availableByHop).to.deep.equal([2, 1]);
  });

  it("does not duplicate a seed that is already a parent", function () {
    const model = buildGraphHopModel({
      seeds: [node("a"), node("b")],
      direction: "cited-by",
      depth: 1,
      neighbours: lookup({ a: ["p"], b: ["p"] }),
      checkOf,
    })!;
    expect([...model.entries.get("p")!.parents].sort()).to.deep.equal([
      "a",
      "b",
    ]);
    expect(model.edges).to.have.length(2);
  });

  it("under References, draws the added edge from the seed", function () {
    const model = buildGraphHopModel({
      seeds: [node("a"), node("b")],
      direction: "references",
      depth: 1,
      neighbours: lookup({ a: ["p"], b: [] }),
      checkOf: (n) =>
        n.key === "b"
          ? { openAlexID: "W2", references: ["W10"] }
          : checks[n.key],
    })!;
    expect(model.entries.get("p")!.parents).to.deep.equal(["a", "b"]);
    expect(model.edges.find((edge) => edge.key === "b>p:hop")).to.deep.include({
      source: "b",
      target: "p",
    });
  });

  it("leaves hop 2 and deeper alone", function () {
    const model = buildGraphHopModel({
      seeds: [node("a"), node("b")],
      direction: "cited-by",
      depth: 2,
      neighbours: lookup({ a: ["x"], b: [], x: ["p"] }),
      checkOf,
    })!;
    expect(model.entries.get("p")).to.deep.include({
      hop: 2,
      parents: ["x"],
    });
    expect(model.availableByHop).to.deep.equal([2, 1, 1]);
  });

  it("changes nothing without checkOf", function () {
    const model = buildGraphHopModel({
      seeds: [node("a"), node("b")],
      direction: "cited-by",
      depth: 1,
      neighbours: lookup({ a: ["p"], b: [] }),
    })!;
    expect(model.entries.get("p")!.parents).to.deep.equal(["a"]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/graphHopModel.test.ts`
Expected: FAIL (typecheck is not run here; the parents read `["a"]`).

- [ ] **Step 3: Implement**

In `src/services/graphHopModel.ts`, change the import from `./graphSeedLinks` to:

```ts
import {
  checkedSeedLinks,
  seedLinkCount,
  type SeedLinkCheck,
} from "./graphSeedLinks";
```

Add to `GraphHopInput`, after `seedEdges`:

```ts
  /**
   * What the OpenAlex check learned about a seed or hop-1 paper (ADR 0018);
   * undefined outside the check's gate. A hop-1 paper gains as parents the
   * seeds the check links it to, and an edge to each.
   */
  checkOf?: (node: CitationGraphNode) => SeedLinkCheck | undefined;
```

In `buildGraphHopModel`, between the end of the `for (let hop = 1; …)` loop (`frontier = next; }`) and `const availableByHop`, insert:

```ts
// The cut at 50 drops links (ADR 0015); the check finds them (ADR 0018).
// Only parents and edges grow: hop membership and the counts stay.
const checkOf = input.checkOf;
if (checkOf) {
  const hop1 = [...entries.values()].filter((entry) => entry.hop === 1);
  const links = checkedSeedLinks(
    input.direction,
    seeds.map((seed) => ({ key: seed.key, check: checkOf(seed) })),
    hop1.map((entry) => ({
      key: entry.key,
      check: checkOf(nodes.get(entry.key)!),
    })),
  );
  for (const [key, linkedSeeds] of links) {
    const entry = entries.get(key)!;
    for (const seedKey of linkedSeeds) {
      if (entry.parents.includes(seedKey)) continue;
      entry.parents.push(seedKey);
      const edge =
        input.direction === "references"
          ? hopEdge(seedKey, key, "openalex")
          : hopEdge(key, seedKey, "openalex");
      if (!edges.has(edge.key)) edges.set(edge.key, edge);
    }
  }
}
```

- [ ] **Step 4: Run them to see them pass**

Run the same command. Expected: PASS, and the file's existing cases still pass.

- [ ] **Step 5: Gate and commit**

Run: `npm run check` — expected: green.

```bash
git add src/services/graphHopModel.ts test/unit/graphHopModel.test.ts
git commit -m "The hop model gives a hop-1 paper the seeds a check links it to"
```

---

### Task 3: Reference-list rows and their mirror (pure)

**Files:**

- Create: `src/services/openAlexReferenceLists.ts`
- Test: `test/unit/openAlexReferenceLists.test.ts`

**Interfaces:**

- Consumes: `SeedLinkCheck` (Task 1).
- Produces (all exported from `openAlexReferenceLists.ts`):
  - `interface CheckPaper { key: string; openAlexID: string | null; doi: string | null }`
  - `function openAlexAlias(id: string): string` → `openalex:${id}`
  - `function doiAlias(doi: string): string` → `doi:${doi}`
  - `function checkPaperAliases(paper: CheckPaper): string[]` (OpenAlex alias first)
  - `type ReferenceListStatus = "success" | "alias" | "not-found"`
  - `interface ReferenceListRow { identityKey: string; status: ReferenceListStatus; openAlexID: string | null; referenceIDs: string[] | null; fetchedAt: string }`
  - `interface ReferenceListAnswer { openAlexID: string; references: string[]; aliases: string[] }`
  - `const REFERENCE_LIST_SUCCESS_MAX_AGE_MS`, `const REFERENCE_LIST_NOT_FOUND_MAX_AGE_MS`
  - `function referenceListRowIsFresh(row: ReferenceListRow, now: number): boolean`
  - `function referenceListRows(found: readonly ReferenceListAnswer[], notFoundAliases: readonly string[], fetchedAt: string): ReferenceListRow[]`
  - `class ReferenceListMirror { put(rows: readonly ReferenceListRow[]): void; clear(): void; readonly size: number; lookup(alias: string, now: number): SeedLinkCheck | null | undefined }`
  - `interface ReferenceListDBRow { identity_key: string; status: string; openalex_id: string | null; reference_ids_json: string | null; fetched_at: string }`
  - `function referenceListRowFromDB(row: ReferenceListDBRow): ReferenceListRow | null`
  - `function referenceListRowToDB(row: ReferenceListRow): [string, string, string | null, string | null, string]`

- [ ] **Step 1: Write the failing tests**

Create `test/unit/openAlexReferenceLists.test.ts`:

```ts
import { describe, it } from "node:test";
import { expect } from "chai";
import {
  checkPaperAliases,
  ReferenceListMirror,
  REFERENCE_LIST_NOT_FOUND_MAX_AGE_MS,
  REFERENCE_LIST_SUCCESS_MAX_AGE_MS,
  referenceListRowFromDB,
  referenceListRowToDB,
  referenceListRows,
} from "../../src/services/openAlexReferenceLists";

const T0 = Date.parse("2026-10-06T00:00:00Z");
const AT = new Date(T0).toISOString();

describe("checkPaperAliases", function () {
  it("lists the OpenAlex alias first, then the DOI", function () {
    expect(
      checkPaperAliases({ key: "k", openAlexID: "W1", doi: "10.1234/x" }),
    ).to.deep.equal(["openalex:W1", "doi:10.1234/x"]);
    expect(
      checkPaperAliases({ key: "k", openAlexID: null, doi: null }),
    ).to.deep.equal([]);
  });
});

describe("referenceListRows", function () {
  it("stores a reference list once, and every other alias as a pointer", function () {
    const rows = referenceListRows(
      [
        {
          openAlexID: "W2",
          references: ["W9"],
          aliases: ["openalex:W1", "doi:10.1234/x", "openalex:W2"],
        },
      ],
      ["doi:10.9876/gone"],
      AT,
    );
    expect(rows).to.deep.equal([
      {
        identityKey: "openalex:W2",
        status: "success",
        openAlexID: "W2",
        referenceIDs: ["W9"],
        fetchedAt: AT,
      },
      {
        identityKey: "openalex:W1",
        status: "alias",
        openAlexID: "W2",
        referenceIDs: null,
        fetchedAt: AT,
      },
      {
        identityKey: "doi:10.1234/x",
        status: "alias",
        openAlexID: "W2",
        referenceIDs: null,
        fetchedAt: AT,
      },
      {
        identityKey: "doi:10.9876/gone",
        status: "not-found",
        openAlexID: null,
        referenceIDs: null,
        fetchedAt: AT,
      },
    ]);
  });
});

describe("ReferenceListMirror", function () {
  const mirror = (): ReferenceListMirror => {
    const m = new ReferenceListMirror();
    m.put(
      referenceListRows(
        [
          {
            openAlexID: "W2",
            references: ["W9"],
            aliases: ["doi:10.1234/x"],
          },
        ],
        ["doi:10.9876/gone"],
        AT,
      ),
    );
    return m;
  };

  it("answers a success, an alias and a not-found", function () {
    const m = mirror();
    expect(m.lookup("openalex:W2", T0)).to.deep.equal({
      openAlexID: "W2",
      references: ["W9"],
    });
    expect(m.lookup("doi:10.1234/x", T0)).to.deep.equal({
      openAlexID: "W2",
      references: ["W9"],
    });
    expect(m.lookup("doi:10.9876/gone", T0)).to.equal(null);
    expect(m.lookup("doi:10.0001/never", T0)).to.equal(undefined);
  });

  it("forgets a not-found after 30 days and a success after 180", function () {
    const m = mirror();
    const past = (ms: number): number => T0 + ms + 1;
    expect(
      m.lookup("doi:10.9876/gone", past(REFERENCE_LIST_NOT_FOUND_MAX_AGE_MS)),
    ).to.equal(undefined);
    expect(
      m.lookup("openalex:W2", past(REFERENCE_LIST_NOT_FOUND_MAX_AGE_MS)),
    ).to.not.equal(undefined);
    expect(
      m.lookup("doi:10.1234/x", past(REFERENCE_LIST_SUCCESS_MAX_AGE_MS)),
    ).to.equal(undefined);
  });

  it("lets a later answer replace a not-found", function () {
    const m = mirror();
    m.put(
      referenceListRows(
        [{ openAlexID: "W3", references: [], aliases: ["doi:10.9876/gone"] }],
        [],
        AT,
      ),
    );
    expect(m.lookup("doi:10.9876/gone", T0)).to.deep.equal({
      openAlexID: "W3",
      references: [],
    });
  });
});

describe("the reference list DB codec", function () {
  it("round-trips a row and rejects a bad one", function () {
    const [row] = referenceListRows(
      [{ openAlexID: "W2", references: ["W9"], aliases: [] }],
      [],
      AT,
    );
    const [identity_key, status, openalex_id, reference_ids_json, fetched_at] =
      referenceListRowToDB(row);
    expect(
      referenceListRowFromDB({
        identity_key,
        status,
        openalex_id,
        reference_ids_json,
        fetched_at,
      }),
    ).to.deep.equal(row);
    expect(
      referenceListRowFromDB({
        identity_key: "x",
        status: "bogus",
        openalex_id: null,
        reference_ids_json: null,
        fetched_at: AT,
      }),
    ).to.equal(null);
    expect(
      referenceListRowFromDB({
        identity_key: "openalex:W2",
        status: "success",
        openalex_id: "W2",
        reference_ids_json: "{not json",
        fetched_at: AT,
      }),
    ).to.equal(null);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/openAlexReferenceLists.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Create `src/services/openAlexReferenceLists.ts`:

```ts
/**
 * The OpenAlex reference lists the seed-link check stores (ADR 0018): one row
 * per alias, the list itself once, under `openalex:W…`. Pure, so the store in
 * externalWorkCacheService.ts and the scheduler share one definition.
 */
import type { SeedLinkCheck } from "./graphSeedLinks";

/** A paper as the check asks for it; at least one identifier to be asked. */
export interface CheckPaper {
  key: string;
  openAlexID: string | null;
  doi: string | null;
}

export function openAlexAlias(id: string): string {
  return `openalex:${id}`;
}

export function doiAlias(doi: string): string {
  return `doi:${doi}`;
}

export function checkPaperAliases(paper: CheckPaper): string[] {
  const aliases: string[] = [];
  if (paper.openAlexID) aliases.push(openAlexAlias(paper.openAlexID));
  if (paper.doi) aliases.push(doiAlias(paper.doi));
  return aliases;
}

export type ReferenceListStatus = "success" | "alias" | "not-found";

export interface ReferenceListRow {
  identityKey: string;
  status: ReferenceListStatus;
  openAlexID: string | null;
  referenceIDs: string[] | null;
  fetchedAt: string;
}

/** One answer: the work's canonical ID, its list, every alias it was reached by. */
export interface ReferenceListAnswer {
  openAlexID: string;
  references: string[];
  aliases: string[];
}

/** As `external_works_v2`: a success for 180 days, a not-found for 30. */
export const REFERENCE_LIST_SUCCESS_MAX_AGE_MS = 180 * 86400000;
export const REFERENCE_LIST_NOT_FOUND_MAX_AGE_MS = 30 * 86400000;

export function referenceListRowIsFresh(
  row: ReferenceListRow,
  now: number,
): boolean {
  const age = now - Date.parse(row.fetchedAt);
  if (!Number.isFinite(age)) return false;
  return (
    age <
    (row.status === "not-found"
      ? REFERENCE_LIST_NOT_FOUND_MAX_AGE_MS
      : REFERENCE_LIST_SUCCESS_MAX_AGE_MS)
  );
}

export function referenceListRows(
  found: readonly ReferenceListAnswer[],
  notFoundAliases: readonly string[],
  fetchedAt: string,
): ReferenceListRow[] {
  const rows: ReferenceListRow[] = [];
  for (const answer of found) {
    const primary = openAlexAlias(answer.openAlexID);
    rows.push({
      identityKey: primary,
      status: "success",
      openAlexID: answer.openAlexID,
      referenceIDs: [...answer.references],
      fetchedAt,
    });
    for (const alias of new Set(answer.aliases)) {
      if (alias === primary) continue;
      rows.push({
        identityKey: alias,
        status: "alias",
        openAlexID: answer.openAlexID,
        referenceIDs: null,
        fetchedAt,
      });
    }
  }
  for (const alias of new Set(notFoundAliases)) {
    rows.push({
      identityKey: alias,
      status: "not-found",
      openAlexID: null,
      referenceIDs: null,
      fetchedAt,
    });
  }
  return rows;
}

export class ReferenceListMirror {
  private readonly rows = new Map<string, ReferenceListRow>();

  put(rows: readonly ReferenceListRow[]): void {
    for (const row of rows) this.rows.set(row.identityKey, row);
  }

  clear(): void {
    this.rows.clear();
  }

  get size(): number {
    return this.rows.size;
  }

  /** A fresh check; `null` for a fresh not-found; `undefined` when unknown or stale. */
  lookup(alias: string, now: number): SeedLinkCheck | null | undefined {
    const row = this.rows.get(alias);
    if (!row || !referenceListRowIsFresh(row, now)) return undefined;
    if (row.status === "not-found") return null;
    const target =
      row.status === "success"
        ? row
        : row.openAlexID
          ? this.rows.get(openAlexAlias(row.openAlexID))
          : undefined;
    if (
      !target ||
      target.status !== "success" ||
      !target.openAlexID ||
      !referenceListRowIsFresh(target, now)
    )
      return undefined;
    return {
      openAlexID: target.openAlexID,
      references: target.referenceIDs ?? [],
    };
  }
}

export interface ReferenceListDBRow {
  identity_key: string;
  status: string;
  openalex_id: string | null;
  reference_ids_json: string | null;
  fetched_at: string;
}

const STATUSES = new Set<string>(["success", "alias", "not-found"]);

export function referenceListRowFromDB(
  row: ReferenceListDBRow,
): ReferenceListRow | null {
  const status = String(row.status);
  if (!STATUSES.has(status)) return null;
  let referenceIDs: string[] | null = null;
  if (status === "success") {
    try {
      const parsed: unknown = JSON.parse(String(row.reference_ids_json));
      if (!Array.isArray(parsed)) return null;
      referenceIDs = parsed.filter(
        (id): id is string => typeof id === "string",
      );
    } catch {
      return null;
    }
  }
  return {
    identityKey: String(row.identity_key),
    status: status as ReferenceListStatus,
    openAlexID: row.openalex_id ? String(row.openalex_id) : null,
    referenceIDs,
    fetchedAt: String(row.fetched_at),
  };
}

export function referenceListRowToDB(
  row: ReferenceListRow,
): [string, string, string | null, string | null, string] {
  return [
    row.identityKey,
    row.status,
    row.openAlexID,
    row.referenceIDs ? JSON.stringify(row.referenceIDs) : null,
    row.fetchedAt,
  ];
}
```

- [ ] **Step 4: Run them to see them pass**

Run the same command. Expected: PASS.

- [ ] **Step 5: Gate and commit**

Run: `npm run check` — expected: green.

```bash
git add src/services/openAlexReferenceLists.ts test/unit/openAlexReferenceLists.test.ts
git commit -m "Reference-list rows store a list once and point every other alias at it"
```

---

### Task 4: The OpenAlex check

**Files:**

- Create: `src/services/openAlexSeedLinkService.ts`
- Test: `test/unit/openAlexSeedLinkService.test.ts`

**Interfaces:**

- Consumes: `canonicalOpenAlexID` (Task 1); `CheckPaper`, `checkPaperAliases`, `doiAlias`, `referenceListRows`, `ReferenceListAnswer`, `ReferenceListRow` (Task 3); `requestJSON` (`src/providers/http.ts`); `providerExecutionPolicy`; `normalizeDOI`; `CancellationSignal`.
- Produces:
  - `interface CheckOutcome { rows: ReferenceListRow[]; failed: CheckPaper[] }`
  - `const CHECK_SELECT = "id,doi,referenced_works"`
  - `function checkOpenAlexReferences(papers: readonly CheckPaper[], options: { apiKey: string; signal?: CancellationSignal; now?: () => Date }): Promise<CheckOutcome>`

Behaviour: papers with an OpenAlex ID go by `ids.openalex`, the rest by `doi`; ID misses with a DOI are retried by DOI. A 200 matches results by canonical ID or normalised DOI. A 400, 413, 414 or 422 splits the batch in half, down to one paper; a single rejected paper counts as missed. Any other failure (429, 403 for a disabled provider, 5xx, status 0 for a network error or a cancel) puts the batch's papers in `failed`. Papers missed both ways become not-found rows under their aliases. A DOI with a comma breaks the filter; it is rejected, isolated by the split, and recorded not-found, which is accepted.

- [ ] **Step 1: Write the failing tests**

Create `test/unit/openAlexSeedLinkService.test.ts`:

```ts
import { beforeEach, describe, it, mock } from "node:test";
import { expect } from "chai";
import type { HTTPResult, JSONRequestOptions } from "../../src/providers/http";

/** `requestJSON` replaced by a script, as openCitationsProvider.test.ts does. */
const calls: Array<{ url: string; options: JSONRequestOptions }> = [];
let respond: (url: URL) => HTTPResult<unknown> = () => ok([]);

function ok(results: unknown[]): HTTPResult<unknown> {
  return { ok: true, status: 200, data: { results }, message: "" };
}

function failed(status: number): HTTPResult<unknown> {
  return { ok: false, status, data: null, message: "" };
}

const realHTTP = await import("../../src/providers/http");
mock.module("../../src/providers/http.ts", {
  exports: {
    ...realHTTP,
    requestJSON: async (
      _provider: string,
      url: string,
      options: JSONRequestOptions,
    ) => {
      calls.push({ url, options });
      return respond(new URL(url));
    },
  },
});
const { checkOpenAlexReferences, CHECK_SELECT } =
  await import("../../src/services/openAlexSeedLinkService");

const AT = new Date("2026-10-06T00:00:00Z");
const options = { apiKey: "k", now: () => AT };

function filterValues(url: URL): { field: string; values: string[] } {
  const [field, rest] = (url.searchParams.get("filter") ?? "").split(":", 2);
  return { field, values: rest ? rest.split("|") : [] };
}

/** OpenAlex as a table: answers whatever the filter names that it knows. */
function answering(
  works: Array<{ id: string; doi?: string; refs: string[] }>,
): (url: URL) => HTTPResult<unknown> {
  return (url) => {
    const { field, values } = filterValues(url);
    return ok(
      works
        .filter((w) =>
          field === "ids.openalex"
            ? values.includes(w.id)
            : w.doi !== undefined && values.includes(w.doi),
        )
        .map((w) => ({
          id: `https://openalex.org/${w.id}`,
          doi: w.doi ? `https://doi.org/${w.doi}` : null,
          referenced_works: w.refs.map((r) => `https://openalex.org/${r}`),
        })),
    );
  };
}

describe("checkOpenAlexReferences", function () {
  beforeEach(function () {
    calls.length = 0;
  });

  it("asks by ID, then by DOI, with the check's select and no retries on refusal", async function () {
    respond = answering([
      { id: "W1", refs: ["W9"] },
      { id: "W2", doi: "10.1234/b", refs: [] },
    ]);
    const outcome = await checkOpenAlexReferences(
      [
        { key: "a", openAlexID: "W1", doi: null },
        { key: "b", openAlexID: null, doi: "10.1234/b" },
      ],
      options,
    );
    expect(calls.map((c) => filterValues(new URL(c.url)))).to.deep.equal([
      { field: "ids.openalex", values: ["W1"] },
      { field: "doi", values: ["10.1234/b"] },
    ]);
    const url = new URL(calls[0].url);
    expect(url.searchParams.get("select")).to.equal(CHECK_SELECT);
    expect(url.searchParams.get("per_page")).to.equal("200");
    expect(url.searchParams.get("api_key")).to.equal("k");
    expect(calls[0].options.retryRefusals).to.equal(false);
    expect(outcome.failed).to.deep.equal([]);
    expect(
      outcome.rows.map((r) => [r.identityKey, r.status, r.referenceIDs]),
    ).to.deep.equal([
      ["openalex:W1", "success", ["W9"]],
      ["openalex:W2", "success", []],
      ["doi:10.1234/b", "alias", null],
    ]);
  });

  it("batches at the policy size", async function () {
    respond = answering([]);
    const papers = Array.from({ length: 150 }, (_, i) => ({
      key: `k${i}`,
      openAlexID: `W${i + 1}`,
      doi: null,
    }));
    await checkOpenAlexReferences(papers, options);
    expect(
      calls.map((c) => filterValues(new URL(c.url)).values.length),
    ).to.deep.equal([100, 50]);
  });

  it("retries an ID miss by DOI, and keeps the asked ID as an alias", async function () {
    respond = answering([{ id: "W7", doi: "10.1234/m", refs: ["W1"] }]);
    const outcome = await checkOpenAlexReferences(
      [{ key: "m", openAlexID: "W3", doi: "10.1234/m" }],
      options,
    );
    expect(calls).to.have.length(2);
    expect(outcome.rows.map((r) => [r.identityKey, r.status])).to.deep.equal([
      ["openalex:W7", "success"],
      ["openalex:W3", "alias"],
      ["doi:10.1234/m", "alias"],
    ]);
  });

  it("records a paper missed both ways as not-found under its aliases", async function () {
    respond = answering([]);
    const outcome = await checkOpenAlexReferences(
      [{ key: "g", openAlexID: "W3", doi: "10.1234/g" }],
      options,
    );
    expect(outcome.rows.map((r) => [r.identityKey, r.status])).to.deep.equal([
      ["openalex:W3", "not-found"],
      ["doi:10.1234/g", "not-found"],
    ]);
  });

  it("never sends a paper with no identifier", async function () {
    respond = answering([]);
    const outcome = await checkOpenAlexReferences(
      [{ key: "x", openAlexID: null, doi: null }],
      options,
    );
    expect(calls).to.have.length(0);
    expect(outcome).to.deep.equal({ rows: [], failed: [] });
  });

  it("learns nothing from a refused batch", async function () {
    respond = () => failed(429);
    const papers = [{ key: "a", openAlexID: "W1", doi: "10.1234/a" }];
    const outcome = await checkOpenAlexReferences(papers, options);
    expect(calls).to.have.length(1);
    expect(outcome).to.deep.equal({ rows: [], failed: papers });
  });

  it("does not split a batch refused because OpenAlex is disabled", async function () {
    respond = () => failed(403);
    const outcome = await checkOpenAlexReferences(
      [
        { key: "a", openAlexID: "W1", doi: null },
        { key: "b", openAlexID: "W2", doi: null },
      ],
      options,
    );
    expect(calls).to.have.length(1);
    expect(outcome.failed).to.have.length(2);
  });

  it("splits a rejected batch down to the paper OpenAlex rejects", async function () {
    respond = (url) => {
      const { values } = filterValues(url);
      return values.includes("W2")
        ? failed(400)
        : answering([
            { id: "W1", refs: [] },
            { id: "W3", refs: [] },
          ])(url);
    };
    const outcome = await checkOpenAlexReferences(
      [
        { key: "a", openAlexID: "W1", doi: null },
        { key: "b", openAlexID: "W2", doi: null },
        { key: "c", openAlexID: "W3", doi: null },
      ],
      options,
    );
    expect(outcome.failed).to.deep.equal([]);
    expect(outcome.rows.map((r) => [r.identityKey, r.status])).to.deep.equal([
      ["openalex:W1", "success"],
      ["openalex:W3", "success"],
      ["openalex:W2", "not-found"],
    ]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/openAlexSeedLinkService.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Create `src/services/openAlexSeedLinkService.ts`:

```ts
/**
 * The seed-link check (ADR 0018): one OpenAlex batch per 100 papers asking
 * only for each work's ID, DOI and reference list. No title is selected, so
 * the response observer drops these partial records and they never reach
 * `external_works_v2` (`openAlexWorkMetadata` needs a title).
 */
import { normalizeDOI } from "../domain/workIdentity";
import { requestJSON } from "../providers/http";
import type { CancellationSignal } from "./cancellationScope";
import { canonicalOpenAlexID } from "./graphSeedLinks";
import {
  checkPaperAliases,
  doiAlias,
  referenceListRows,
  type CheckPaper,
  type ReferenceListAnswer,
  type ReferenceListRow,
} from "./openAlexReferenceLists";
import { providerExecutionPolicy } from "./providerExecutionPolicy";

export const CHECK_SELECT = "id,doi,referenced_works";

/** Statuses that mean "this request is malformed", not "OpenAlex is away". */
const SPLIT_STATUSES = new Set([400, 413, 414, 422]);

export interface CheckOutcome {
  /** Every answer, and every paper missed by ID and by DOI as not-found. */
  rows: ReferenceListRow[];
  /** Papers whose batch was refused, failed or cancelled: nothing learned. */
  failed: CheckPaper[];
}

interface OpenAlexReferenceWork {
  id?: string;
  doi?: string | null;
  referenced_works?: string[];
}

interface OpenAlexReferenceList {
  results?: OpenAlexReferenceWork[];
}

type Field = "ids.openalex" | "doi";

function valueOf(paper: CheckPaper, field: Field): string | null {
  return field === "doi" ? paper.doi : paper.openAlexID;
}

function chunked<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export async function checkOpenAlexReferences(
  papers: readonly CheckPaper[],
  options: { apiKey: string; signal?: CancellationSignal; now?: () => Date },
): Promise<CheckOutcome> {
  const batchSize = Math.min(
    100,
    providerExecutionPolicy("openalex").batchSize,
  );
  const found = new Map<string, ReferenceListAnswer>();
  const failed = new Map<string, CheckPaper>();

  const ask = async (field: Field, batch: CheckPaper[]): Promise<void> => {
    if (!batch.length) return;
    const url = new URL("https://api.openalex.org/works");
    url.searchParams.set(
      "filter",
      `${field}:${batch.map((paper) => valueOf(paper, field)).join("|")}`,
    );
    url.searchParams.set("per_page", "200");
    url.searchParams.set("select", CHECK_SELECT);
    if (options.apiKey) url.searchParams.set("api_key", options.apiKey);
    const response = await requestJSON<OpenAlexReferenceList>(
      "openalex",
      url.toString(),
      { signal: options.signal, retryRefusals: false },
    );
    if (response.ok && response.data) {
      const byValue = new Map<string, OpenAlexReferenceWork>();
      for (const work of response.data.results ?? []) {
        const value =
          field === "doi"
            ? normalizeDOI(work.doi)
            : canonicalOpenAlexID(work.id);
        if (value && !byValue.has(value)) byValue.set(value, work);
      }
      for (const paper of batch) {
        const work = byValue.get(valueOf(paper, field) ?? "");
        const id = canonicalOpenAlexID(work?.id);
        if (!work || !id) continue;
        const doi = normalizeDOI(work.doi);
        found.set(paper.key, {
          openAlexID: id,
          references: (work.referenced_works ?? [])
            .map(canonicalOpenAlexID)
            .filter((ref): ref is string => Boolean(ref)),
          aliases: [
            ...checkPaperAliases(paper),
            ...(doi ? [doiAlias(doi)] : []),
          ],
        });
      }
      return;
    }
    if (SPLIT_STATUSES.has(response.status)) {
      // One paper the filter cannot carry (a DOI with a comma) rejects its
      // whole batch: halve until it stands alone, and let it be missed.
      if (batch.length === 1) return;
      const half = Math.ceil(batch.length / 2);
      await ask(field, batch.slice(0, half));
      await ask(field, batch.slice(half));
      return;
    }
    for (const paper of batch) failed.set(paper.key, paper);
  };

  const askAll = async (field: Field, list: CheckPaper[]): Promise<void> => {
    for (const batch of chunked(list, batchSize)) await ask(field, batch);
  };

  await askAll(
    "ids.openalex",
    papers.filter((paper) => paper.openAlexID),
  );
  await askAll(
    "doi",
    papers.filter(
      (paper) => paper.doi && !found.has(paper.key) && !failed.has(paper.key),
    ),
  );

  const missed = papers.filter(
    (paper) =>
      (paper.openAlexID || paper.doi) &&
      !found.has(paper.key) &&
      !failed.has(paper.key),
  );
  return {
    rows: referenceListRows(
      [...found.values()],
      missed.flatMap(checkPaperAliases),
      (options.now?.() ?? new Date()).toISOString(),
    ),
    failed: [...failed.values()],
  };
}
```

Note the DOI pass's filter: a paper with an OpenAlex ID that missed by ID is asked by DOI; a paper with no OpenAlex ID is asked by DOI first. Both are "has a DOI, not found, not failed", so one filter covers both.

- [ ] **Step 4: Run them to see them pass**

Run the same command. Expected: PASS. If the "asks by ID, then by DOI" case's row order differs, the order is: found answers in insertion order (ID pass, then DOI pass), then not-found aliases.

- [ ] **Step 5: Gate and commit**

Run: `npm run check` — expected: green.

```bash
git add src/services/openAlexSeedLinkService.ts test/unit/openAlexSeedLinkService.test.ts
git commit -m "The seed-link check asks OpenAlex for reference lists by ID, then DOI"
```

---

### Task 5: The check scheduler (pure)

**Files:**

- Create: `src/services/seedLinkCheckScheduler.ts`
- Test: `test/unit/seedLinkCheckScheduler.test.ts`

**Interfaces:**

- Consumes: `CheckPaper`, `checkPaperAliases`, `ReferenceListRow` (Task 3); `CheckOutcome` type (Task 4, type-only import); `SeedLinkCheck` (Task 1); `createCancellationScope`, `CancellationScope`, `CancellationSignal` (`src/services/cancellationScope.ts`).
- Produces:
  - `interface SeedLinkCheckStore { lookup(alias: string): SeedLinkCheck | null | undefined; save(rows: readonly ReferenceListRow[]): Promise<void> }`
  - `interface SeedLinkCheckClient { papers(): readonly CheckPaper[]; landed(): void }`
  - `interface SeedLinkCheckDeps { store: SeedLinkCheckStore; check(papers: readonly CheckPaper[], signal: CancellationSignal): Promise<CheckOutcome>; defer(run: () => void): void; now(): number }`
  - `interface SeedLinkCheckScheduler { register(client: SeedLinkCheckClient): () => void; markDirty(): void }`
  - `const CHECK_BACKOFF_MS: readonly number[]`
  - `function createSeedLinkCheckScheduler(deps: SeedLinkCheckDeps): SeedLinkCheckScheduler`

Rules: `markDirty` defers one dispatch (coalesced). A dispatch while one is in flight leaves the dirty flag for after. At dispatch, collect across clients the papers with an alias, none of whose aliases is known to the store (`lookup !== undefined`), in flight, or backing off; dedupe by alias. Nothing collected, nothing sent. After the check: if not cancelled, save the rows, then back off every failed paper's aliases; a thrown check or save backs off every paper. Notify each client whose papers share an alias with a saved row. Unregistering cancels the in-flight check once no remaining client wants any in-flight alias; a cancelled check saves nothing and backs nothing off.

- [ ] **Step 1: Write the failing tests**

Create `test/unit/seedLinkCheckScheduler.test.ts`:

```ts
import { describe, it } from "node:test";
import { expect } from "chai";
import type { CancellationSignal } from "../../src/services/cancellationScope";
import type { SeedLinkCheck } from "../../src/services/graphSeedLinks";
import {
  referenceListRows,
  type CheckPaper,
  type ReferenceListRow,
} from "../../src/services/openAlexReferenceLists";
import type { CheckOutcome } from "../../src/services/openAlexSeedLinkService";
import {
  CHECK_BACKOFF_MS,
  createSeedLinkCheckScheduler,
} from "../../src/services/seedLinkCheckScheduler";

const AT = "2026-10-06T00:00:00.000Z";

function harness() {
  const known = new Map<string, SeedLinkCheck | null>();
  const deferred: Array<() => void> = [];
  const asked: CheckPaper[][] = [];
  const signals: CancellationSignal[] = [];
  const pending: Array<(outcome: CheckOutcome) => void> = [];
  let now = 0;
  const scheduler = createSeedLinkCheckScheduler({
    store: {
      lookup: (alias) => (known.has(alias) ? known.get(alias) : undefined),
      save: async (rows: readonly ReferenceListRow[]) => {
        for (const row of rows)
          known.set(
            row.identityKey,
            row.status === "not-found"
              ? null
              : { openAlexID: row.openAlexID!, references: [] },
          );
      },
    },
    check: (papers, signal) => {
      asked.push([...papers]);
      signals.push(signal);
      return new Promise((resolve) => pending.push(resolve));
    },
    defer: (run) => deferred.push(run),
    now: () => now,
  });
  const flush = async (): Promise<void> => {
    while (deferred.length) deferred.shift()!();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const land = async (outcome: CheckOutcome): Promise<void> => {
    pending.shift()!(outcome);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flush();
  };
  return {
    scheduler,
    known,
    asked,
    signals,
    flush,
    land,
    advance: (ms: number) => (now += ms),
  };
}

const P = { key: "p", openAlexID: "W1", doi: null };
const Q = { key: "q", openAlexID: null, doi: "10.1234/q" };

function client(papers: CheckPaper[]) {
  const c = { papers: () => papers, landed: () => (c.count += 1), count: 0 };
  return c;
}

describe("seedLinkCheckScheduler", function () {
  it("collects at dispatch, once, however often it is marked dirty", async function () {
    const h = harness();
    const papers: CheckPaper[] = [];
    h.scheduler.register(client(papers));
    h.scheduler.markDirty();
    h.scheduler.markDirty();
    papers.push(P);
    await h.flush();
    expect(h.asked).to.deep.equal([[P]]);
  });

  it("does not ask again for a paper in flight", async function () {
    const h = harness();
    h.scheduler.register(client([P]));
    h.scheduler.markDirty();
    await h.flush();
    h.scheduler.markDirty();
    await h.flush();
    expect(h.asked).to.have.length(1);
  });

  it("saves, notifies the graph that wants the paper, and then has nothing to ask", async function () {
    const h = harness();
    const wants = client([P]);
    const other = client([Q]);
    h.scheduler.register(wants);
    h.scheduler.register(other);
    h.scheduler.markDirty();
    await h.flush();
    h.scheduler.markDirty();
    await h.land({
      rows: referenceListRows(
        [{ openAlexID: "W1", references: [], aliases: [] }],
        ["doi:10.1234/q"],
        AT,
      ),
      failed: [],
    });
    expect(wants.count).to.equal(1);
    expect(other.count).to.equal(1);
    expect(h.asked).to.have.length(1);
  });

  it("never asks for a paper the store already knows, or one with no identifier", async function () {
    const h = harness();
    h.known.set("openalex:W1", null);
    h.scheduler.register(
      client([P, { key: "x", openAlexID: null, doi: null }]),
    );
    h.scheduler.markDirty();
    await h.flush();
    expect(h.asked).to.have.length(0);
  });

  it("backs a failed paper off on the schedule", async function () {
    const h = harness();
    h.scheduler.register(client([P]));
    h.scheduler.markDirty();
    await h.flush();
    await h.land({ rows: [], failed: [P] });
    h.scheduler.markDirty();
    await h.flush();
    expect(h.asked).to.have.length(1);
    h.advance(CHECK_BACKOFF_MS[0] + 1);
    h.scheduler.markDirty();
    await h.flush();
    expect(h.asked).to.have.length(2);
    await h.land({ rows: [], failed: [P] });
    h.advance(CHECK_BACKOFF_MS[0] + 1);
    h.scheduler.markDirty();
    await h.flush();
    expect(h.asked, "the second failure waits longer").to.have.length(2);
  });

  it("cancels the check once no open graph wants its papers", async function () {
    const h = harness();
    const unregister = h.scheduler.register(client([P]));
    const stays = client([Q]);
    h.scheduler.register(stays);
    h.scheduler.markDirty();
    await h.flush();
    expect(h.asked[0]).to.have.length(2);
    unregister();
    expect(h.signals[0].cancelled, "Q is still wanted").to.equal(false);
    h.scheduler.register(client([]));
    const unregisterLast = h.scheduler.register(client([]));
    unregisterLast();
    expect(h.signals[0].cancelled).to.equal(false);
  });

  it("cancels when the last graph wanting the papers closes, and saves nothing", async function () {
    const h = harness();
    const unregister = h.scheduler.register(client([P]));
    h.scheduler.markDirty();
    await h.flush();
    unregister();
    expect(h.signals[0].cancelled).to.equal(true);
    await h.land({
      rows: referenceListRows(
        [{ openAlexID: "W1", references: [], aliases: [] }],
        [],
        AT,
      ),
      failed: [],
    });
    expect(h.known.size).to.equal(0);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/seedLinkCheckScheduler.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Create `src/services/seedLinkCheckScheduler.ts`:

```ts
/**
 * When the seed-link check asks OpenAlex, and for what (ADR 0018). One per
 * Zotero window set: graphs register as clients, and the scheduler sends at
 * most one check at a time, for papers no graph has an answer for, none in
 * flight and none backing off. A rebuild per fill landing only marks it
 * dirty; collection happens at dispatch.
 */
import {
  createCancellationScope,
  type CancellationScope,
  type CancellationSignal,
} from "./cancellationScope";
import type { SeedLinkCheck } from "./graphSeedLinks";
import {
  checkPaperAliases,
  type CheckPaper,
  type ReferenceListRow,
} from "./openAlexReferenceLists";
import type { CheckOutcome } from "./openAlexSeedLinkService";

export interface SeedLinkCheckStore {
  lookup(alias: string): SeedLinkCheck | null | undefined;
  save(rows: readonly ReferenceListRow[]): Promise<void>;
}

export interface SeedLinkCheckClient {
  /** The papers this graph wants checked; empty outside the check's gate. */
  papers(): readonly CheckPaper[];
  /** A check stored an answer for one of this graph's papers. */
  landed(): void;
}

export interface SeedLinkCheckDeps {
  store: SeedLinkCheckStore;
  check(
    papers: readonly CheckPaper[],
    signal: CancellationSignal,
  ): Promise<CheckOutcome>;
  defer(run: () => void): void;
  now(): number;
}

export interface SeedLinkCheckScheduler {
  register(client: SeedLinkCheckClient): () => void;
  markDirty(): void;
}

/** As `failureRetryAt` in externalWorkCacheService.ts. */
export const CHECK_BACKOFF_MS: readonly number[] = [
  5 * 60000,
  30 * 60000,
  6 * 3600000,
  86400000,
];

export function createSeedLinkCheckScheduler(
  deps: SeedLinkCheckDeps,
): SeedLinkCheckScheduler {
  const clients = new Set<SeedLinkCheckClient>();
  const inFlight = new Set<string>();
  const backoff = new Map<string, { failures: number; until: number }>();
  let scope: CancellationScope | null = null;
  let dirty = false;
  let deferred = false;

  const blocked = (alias: string): boolean =>
    deps.store.lookup(alias) !== undefined ||
    inFlight.has(alias) ||
    (backoff.get(alias)?.until ?? 0) > deps.now();

  const collect = (): CheckPaper[] => {
    const chosen = new Map<string, CheckPaper>();
    for (const client of clients) {
      for (const paper of client.papers()) {
        const aliases = checkPaperAliases(paper);
        if (!aliases.length || aliases.some(blocked)) continue;
        if (aliases.some((alias) => chosen.has(alias))) continue;
        for (const alias of aliases) chosen.set(alias, paper);
      }
    }
    return [...new Set(chosen.values())];
  };

  const backOff = (paper: CheckPaper): void => {
    for (const alias of checkPaperAliases(paper)) {
      const failures = (backoff.get(alias)?.failures ?? 0) + 1;
      const delay =
        CHECK_BACKOFF_MS[Math.min(failures - 1, CHECK_BACKOFF_MS.length - 1)];
      backoff.set(alias, { failures, until: deps.now() + delay });
    }
  };

  const wants = (client: SeedLinkCheckClient, aliases: Set<string>): boolean =>
    client
      .papers()
      .some((paper) =>
        checkPaperAliases(paper).some((alias) => aliases.has(alias)),
      );

  const schedule = (): void => {
    if (deferred) return;
    deferred = true;
    deps.defer(() => {
      deferred = false;
      void dispatch();
    });
  };

  const dispatch = async (): Promise<void> => {
    if (scope) return;
    dirty = false;
    const papers = collect();
    if (!papers.length) return;
    const aliases = papers.flatMap(checkPaperAliases);
    for (const alias of aliases) inFlight.add(alias);
    const current = createCancellationScope("seed-link-check");
    scope = current;
    let saved: readonly ReferenceListRow[] = [];
    try {
      const outcome = await deps.check(papers, current.signal);
      if (!current.signal.cancelled) {
        if (outcome.rows.length) {
          await deps.store.save(outcome.rows);
          saved = outcome.rows;
        }
        for (const paper of outcome.failed) backOff(paper);
      }
    } catch {
      if (!current.signal.cancelled) for (const paper of papers) backOff(paper);
    } finally {
      for (const alias of aliases) inFlight.delete(alias);
      scope = null;
    }
    if (saved.length) {
      const savedAliases = new Set(saved.map((row) => row.identityKey));
      for (const client of [...clients]) {
        if (wants(client, savedAliases)) client.landed();
      }
    }
    if (dirty) schedule();
  };

  return {
    register(client) {
      clients.add(client);
      return () => {
        clients.delete(client);
        if (scope && ![...clients].some((other) => wants(other, inFlight))) {
          scope.cancel();
        }
      };
    },
    markDirty() {
      dirty = true;
      schedule();
    },
  };
}
```

- [ ] **Step 4: Run them to see them pass**

Run the same command. Expected: PASS.

- [ ] **Step 5: Gate and commit**

Run: `npm run check` — expected: green.

```bash
git add src/services/seedLinkCheckScheduler.ts test/unit/seedLinkCheckScheduler.test.ts
git commit -m "A scheduler sends one seed-link check at a time, for papers no one has asked"
```

---

### Task 6: The reference-list table

**Files:**

- Modify: `src/services/externalWorkCacheService.ts` (`SCHEMA`, `initExternalWorkCache`, `closeExternalWorkCache`, `clearExternalWorkCache`; two new exports)

**Interfaces:**

- Consumes: `ReferenceListMirror`, `ReferenceListDBRow`, `ReferenceListRow`, `referenceListRowFromDB`, `referenceListRowToDB`, `REFERENCE_LIST_SUCCESS_MAX_AGE_MS`, `REFERENCE_LIST_NOT_FOUND_MAX_AGE_MS` (Task 3); `SeedLinkCheck` (Task 1).
- Produces:
  - `function lookupOpenAlexReferenceCheck(alias: string): SeedLinkCheck | null | undefined`
  - `function saveOpenAlexReferenceRows(rows: readonly ReferenceListRow[]): Promise<void>`

No unit test: this module needs `Zotero.DBConnection`. Its logic is in Task 3's pure module; Task 7's Zotero case exercises the table end to end.

- [ ] **Step 1: Add the table to `SCHEMA`**

Append inside the `SCHEMA` template, after the `external_relationships_v2` statement:

```sql

CREATE TABLE IF NOT EXISTS openalex_reference_lists (
  identity_key       TEXT PRIMARY KEY,
  status             TEXT NOT NULL,
  openalex_id        TEXT,
  reference_ids_json TEXT,
  fetched_at         TEXT NOT NULL
);
```

- [ ] **Step 2: Add the mirror, prune and load at init**

Add imports:

```ts
import type { SeedLinkCheck } from "./graphSeedLinks";
import {
  ReferenceListMirror,
  REFERENCE_LIST_NOT_FOUND_MAX_AGE_MS,
  REFERENCE_LIST_SUCCESS_MAX_AGE_MS,
  referenceListRowFromDB,
  referenceListRowToDB,
  type ReferenceListDBRow,
  type ReferenceListRow,
} from "./openAlexReferenceLists";
```

Next to the other module-level mirrors (`mirror`, `relationshipMirror`), add:

```ts
/** The seed-link check's answers (ADR 0018), loaded whole at init. */
const referenceLists = new ReferenceListMirror();
```

In `initExternalWorkCache`, after the `cut_order` block and before `SELECT * FROM external_works_v2`, add:

```ts
// The check's answers age out as works do; prune before loading.
const now = Date.now();
await connection.queryAsync(
  `DELETE FROM openalex_reference_lists
       WHERE fetched_at < ? OR (status = 'not-found' AND fetched_at < ?)`,
  [
    new Date(now - REFERENCE_LIST_SUCCESS_MAX_AGE_MS).toISOString(),
    new Date(now - REFERENCE_LIST_NOT_FOUND_MAX_AGE_MS).toISOString(),
  ],
);
const referenceListDBRows = (await connection.queryAsync(
  "SELECT * FROM openalex_reference_lists",
)) as ReferenceListDBRow[];
```

Where the other mirrors are assigned (`mirror = nextMirror;`), add:

```ts
referenceLists.clear();
referenceLists.put(
  (referenceListDBRows ?? [])
    .map(referenceListRowFromDB)
    .filter((row): row is ReferenceListRow => row !== null),
);
```

and extend the debug line's message to end
`… and ${relationshipMirror.size} relationship lists, ${referenceLists.size} reference-list rows`.

- [ ] **Step 3: Clear on close and on clear**

In `closeExternalWorkCache`, after `relationshipMirror.clear();` add `referenceLists.clear();`.

In `clearExternalWorkCache`, inside the transaction add
`await connection.queryAsync("DELETE FROM openalex_reference_lists");`
and after `relationshipMirror.clear();` add `referenceLists.clear();`.

- [ ] **Step 4: Add lookup and save**

After `clearExternalWorkCache`, add:

```ts
/** A fresh check; `null` for a fresh not-found; `undefined` when unknown. */
export function lookupOpenAlexReferenceCheck(
  alias: string,
): SeedLinkCheck | null | undefined {
  if (!initialized) return undefined;
  return referenceLists.lookup(alias, Date.now());
}

export async function saveOpenAlexReferenceRows(
  rows: readonly ReferenceListRow[],
): Promise<void> {
  if (!rows.length || !(await ensureExternalWorkCache())) return;
  await queueWrite(async () => {
    const connection = requireDB();
    await connection.executeTransaction(async () => {
      for (const row of rows) {
        await connection.queryAsync(
          `INSERT OR REPLACE INTO openalex_reference_lists
           (identity_key, status, openalex_id, reference_ids_json, fetched_at)
           VALUES (?, ?, ?, ?, ?)`,
          referenceListRowToDB(row),
        );
      }
    });
    referenceLists.put(rows);
  });
}
```

- [ ] **Step 5: Gate and commit**

Run: `npm run check` — expected: green (typecheck covers this module).

```bash
git add src/services/externalWorkCacheService.ts
git commit -m "The plugin database keeps the seed-link check's reference lists"
```

---

### Task 7: Wire the check into the graph, and the Zotero case

**Files:**

- Modify: `src/services/graphViewService.ts`
- Modify: `test/zotero/graphCitationHops.test.ts` (the "with shared citers (Stage 4)" block, `:2800-3120`)

**Interfaces:**

- Consumes: `openAlexIdentifiersOf`, `SeedLinkCheck` (Task 1); `GraphHopInput.checkOf` (Task 2); `checkPaperAliases`, `CheckPaper` (Task 3); `checkOpenAlexReferences` (Task 4); `createSeedLinkCheckScheduler`, `SeedLinkCheckScheduler` (Task 5); `lookupOpenAlexReferenceCheck`, `saveOpenAlexReferenceRows` (Task 6); `getOpenAlexAPIKey`, `getEnabledProviders` (`./citationPreferences`).

- [ ] **Step 1: Write the Zotero case first (it fails today)**

In the shared-citers block, make every OpenAlex ID and DOI unique per run, so no answer the plugin stored in an earlier run (the table persists in the test profile, and the test bundle is a second copy of the plugin that cannot reach its mirror) can answer for this run's fake. Replace the `SEED_A`, `SEED_B` and `CITERS_OF` constants with:

```ts
/** Unique per run: the check's answers persist in the test profile. */
const RUN = String(Date.now() % 1_000_000).padStart(6, "0");
const W = (n: number): string => `W9${RUN}${n}`;
const SEED_A = {
  doi: `10.5555/shared.${RUN}.a`,
  id: W(50),
  title: `${FIXTURE_TITLE} (shared A)`,
};
const SEED_B = {
  doi: `10.5555/shared.${RUN}.b`,
  id: W(60),
  title: `${FIXTURE_TITLE} (shared B)`,
};
/**
 * W51 cites both seeds; W52 cites A only; W53 cites B only. W54 cites
 * both but made only A's list: the cut dropped it from B's (B78), and
 * only its reference list says it cites B.
 */
const CITERS_OF: Record<string, string[]> = {
  [SEED_A.id]: [W(51), W(52), W(54)],
  [SEED_B.id]: [W(51), W(53)],
};
const REFERENCES_OF: Record<string, string[]> = {
  [W(51)]: [SEED_A.id, SEED_B.id],
  [W(52)]: [SEED_A.id],
  [W(53)]: [SEED_B.id],
  [W(54)]: [SEED_A.id, SEED_B.id],
};
const citerDOI = (id: string): string => `10.5555/shared.${id.toLowerCase()}`;
```

In `serve()`, replace the three lines from `const filter = …` through `const citers = …` and the `return providerAnswer(…)` that follows with:

```ts
const filter = parsed.searchParams.get("filter") ?? "";
if (parsed.searchParams.get("select") === "id,doi,referenced_works") {
  // The seed-link check (B78): answer by ID or DOI, every value of
  // the OR filter.
  const [field, rest = ""] = filter.split(":", 2);
  const known = [
    { id: SEED_A.id, doi: SEED_A.doi },
    { id: SEED_B.id, doi: SEED_B.doi },
    ...[W(51), W(52), W(53), W(54)].map((id) => ({
      id,
      doi: citerDOI(id),
    })),
  ];
  const values = rest.split("|");
  return providerAnswer(
    JSON.stringify({
      results: known
        .filter((w) => values.includes(field === "doi" ? w.doi : w.id))
        .map((w) => ({
          id: `https://openalex.org/${w.id}`,
          doi: `https://doi.org/${w.doi}`,
          referenced_works: (REFERENCES_OF[w.id] ?? []).map(
            (r) => `https://openalex.org/${r}`,
          ),
        })),
    }),
  );
}
const cited = /^cites:(W\d+)$/.exec(filter)?.[1];
const citers = cited ? (CITERS_OF[cited] ?? []) : [];
return providerAnswer(
  JSON.stringify({
    results: citers.map((id) =>
      work(id, citerDOI(id), `Shared paper ${id}`, 2021),
    ),
    meta: { count: citers.length },
  }),
);
```

In the `it(…)` body, the graph now has four hop-1 papers, two of them linked to both seeds once the check lands. Change:

- the wait after adding seed B to `hopCounts(1)?.available === 4`, and its expectation to `{ shown: 4, available: 4 }`;
- the tier wait to wait until `tierCount("Cite all 2 seeds") === COUNT_FORMAT.format(2)` (the check lands after hop 1, so the first rendering can read 1), with a 30 s timeout:

```ts
const tiers = await waitFor(
  () =>
    tierCount("Cite all 2 seeds") === COUNT_FORMAT.format(2)
      ? keyEntries()
      : null,
  30_000,
);
expect(tiers, `the Key read: ${keyEntries().join(" | ")}`).to.exist;
expect(tierCount("Cite 1 seed"), `Key: ${tiers!.join(" | ")}`).to.equal(
  COUNT_FORMAT.format(2),
);
```

- the narrowed wait to `hopCounts(1)?.shown === 2` and its expectation to `{ shown: 2, available: 4 }`, and `"2 below"` stays (W52 and W53 are below).

Update the `it` title to
`"colours both papers citing both seeds into the top tier, one found only by the check, and the rule keeps them"`.

- [ ] **Step 2: Run the case alone to see it fail**

Put a temporary `describe.only` on the shared-citers block, then run `npm test 2>&1 | tee "$TEMP/b78-red.log"` and wait for the task to finish (memory: wait for the npm test task before the next run).
Expected: FAIL, `Cite all 2 seeds` stays at 1 (the check is not wired).

- [ ] **Step 3: Wire the check in `graphViewService.ts`**

Add imports:

```ts
import { openAlexIdentifiersOf, type SeedLinkCheck } from "./graphSeedLinks";
import { checkPaperAliases, type CheckPaper } from "./openAlexReferenceLists";
import { checkOpenAlexReferences } from "./openAlexSeedLinkService";
import {
  createSeedLinkCheckScheduler,
  type SeedLinkCheckScheduler,
} from "./seedLinkCheckScheduler";
import {
  lookupOpenAlexReferenceCheck,
  saveOpenAlexReferenceRows,
} from "./externalWorkCacheService";
```

(If `graphSeedLinks` or `externalWorkCacheService` is already imported, merge into that import.) Add `getEnabledProviders` and `getOpenAlexAPIKey` to the existing `./citationPreferences` import.

At module level (outside the view factory), add:

```ts
/** One for every open graph, so two tabs never ask for the same paper. */
let seedLinkChecks: SeedLinkCheckScheduler | null = null;
function seedLinkCheckScheduler(): SeedLinkCheckScheduler {
  seedLinkChecks ??= createSeedLinkCheckScheduler({
    store: {
      lookup: lookupOpenAlexReferenceCheck,
      save: saveOpenAlexReferenceRows,
    },
    check: (papers, signal) =>
      checkOpenAlexReferences(papers, {
        apiKey: getOpenAlexAPIKey(),
        signal,
      }),
    defer: (run) => void setTimeout(run, 0),
    now: () => Date.now(),
  });
  return seedLinkChecks;
}

/** ADR 0018's gate: an OpenAlex key, OpenAlex on, two or more seeds. */
function seedLinkCheckOpen(seedCount: number): boolean {
  return (
    seedCount >= 2 &&
    Boolean(getOpenAlexAPIKey()) &&
    getEnabledProviders().includes("openalex")
  );
}

function storedSeedLinkCheck(
  node: CitationGraphNode,
): SeedLinkCheck | undefined {
  for (const alias of checkPaperAliases({
    key: node.key,
    ...openAlexIdentifiersOf(node),
  })) {
    const check = lookupOpenAlexReferenceCheck(alias);
    if (check !== undefined) return check ?? undefined;
  }
  return undefined;
}
```

In `hopModelForSeeds`, pass the check to the walk:

```ts
return buildGraphHopModel({
  seeds,
  direction: hopDirection,
  depth: hopDepth,
  neighbours: hopNeighbourhood,
  seedEdges,
  checkOf: seedLinkCheckOpen(seeds.length) ? storedSeedLinkCheck : undefined,
});
```

Inside the view factory, after `let hopModel: GraphHopModel | null = null;` (`:553`) and the declarations it needs exist (place it just before `const hopFill = createHopFillRunner({`, `:3949`, where `rebuildCurrentFocus` is in scope), register the graph as a client:

```ts
// The seed-link check (ADR 0018): this graph's seeds and hop-1 papers,
// while the gate is open; a landing rebuilds, as a fill landing does.
const unregisterSeedLinkChecks = seedLinkCheckScheduler().register({
  papers: (): CheckPaper[] => {
    if (!hopModel || !seedLinkCheckOpen(hopModel.seeds.length)) return [];
    const papers: CheckPaper[] = [];
    for (const node of hopModel.nodes) {
      const hop = hopModel.entries.get(node.key)?.hop;
      if (hop !== 0 && hop !== 1) continue;
      const paper = { key: node.key, ...openAlexIdentifiersOf(node) };
      if (paper.openAlexID || paper.doi) papers.push(paper);
    }
    return papers;
  },
  landed: () => {
    if (!cleaned) rebuildCurrentFocus();
  },
});
```

At the end of `applyHopModel`, after `notifyStateChange();`, add:

```ts
seedLinkCheckScheduler().markDirty();
```

In the cleanup, right after `hopFill.dispose();`, add:

```ts
unregisterSeedLinkChecks();
```

`hopModel.nodes` are the walk's clones, which carry `provider`, `providerWorkID`, `sourceMetrics`, `externalWork` and `doi` (`cloneNode` spreads the node), so `openAlexIdentifiersOf` reads them as the hop model's `checkOf` does.

- [ ] **Step 4: Run the case alone to see it pass**

Run: `npm run check`, then `npm test 2>&1 | tee "$TEMP/b78-green.log"` (still under `describe.only`), and wait for the task to finish.
Expected: the shared-citers case passes. If it fails on the tier count, the failure message prints the Key; check first that the check's URL reached the fake (the select string must be exactly `id,doi,referenced_works`).

- [ ] **Step 5: Remove `describe.only`, gate and commit**

Run: `npm run check` — expected: green.

```bash
git add src/services/graphViewService.ts test/zotero/graphCitationHops.test.ts
git commit -m "A seeded graph checks its seed links against OpenAlex reference lists"
```

---

### Task 8: Docs, the full suite, the roadmap

**Files:**

- Modify: `CONTEXT.md` (Seed links, `:127-131`)
- Create: `docs/adr/0018-seed-links-are-checked-against-openalex-reference-lists.md`
- Modify: `docs/adr/0017-the-shared-citer-grade-is-a-colouring.md` (one sentence)
- Modify: `docs/superpowers/handoffs/roadmap.md`

- [ ] **Step 1: CONTEXT.md**

Replace the Seed links definition's sentence `Counts only the links the graph holds.` with:

```md
Counts the links the graph knows: the stored lists and, with an OpenAlex key,
the reference lists OpenAlex holds for the seeds and hop-1 papers.
```

- [ ] **Step 2: ADR 0018**

Create `docs/adr/0018-seed-links-are-checked-against-openalex-reference-lists.md`:

```md
# Seed links are checked against OpenAlex reference lists

A seed's hop-1 list is cut at 50 (ADR 0015), so a paper linked to two seeds
that made one cut read k = 1 (B78). With an OpenAlex key, OpenAlex enabled
and two or more seeds, a separate check asks OpenAlex for the reference lists
of the seeds and hop-1 papers (`select=id,doi,referenced_works`, 100 a
request) and the hop model adds every seed a list links a hop-1 paper to as a
parent, with its edge. Parents grow; hop membership, the counts and the cut
line do not. A separate pass, not `referenced_works` on the citer pages, so
saved graphs and lists other providers filled are checked too, and the
relationship storage is untouched. The answers live in their own table,
`openalex_reference_lists`, one list per work and a pointer per alias, so a
partial record never overwrites a work's metadata. Outside the gate the
count is the stored lists' alone, even with answers cached.
```

- [ ] **Step 3: ADR 0017's pointer**

In ADR 0017, replace `which undercounts, and the Key says so (shared-citers spec, 2026-09-28).` with
`which undercounts; ADR 0018 checks the links the cut dropped.`

- [ ] **Step 4: The full Zotero suite**

Run: `npm test 2>&1 | tee "$TEMP/b78-suite.log"` and wait for the task to finish.
Expected: 93 passed, 0 failed (the count is unchanged: the shared-citers case was edited, not added). The D8 and floor blocks each seed one paper, so the check's gate stays closed there and their URL assertions are untouched. A Citation hops case at `0/0` after 15 s is Semantic Scholar refusing, not this change (roadmap, Zotero suite). If anything else fails, stop and debug before Step 5.

- [ ] **Step 5: The roadmap**

In `docs/superpowers/handoffs/roadmap.md`:

- Delete the B78 entry from "The hop fill".
- In "Manual verification", after the last shared-citers line, add:

```md
- [ ] B78: with an OpenAlex key, seed two papers that share a citer which made
      only one seed's cut of 50 (two seeds in one field with many citers).
      Under Seeds linked the citer reads `Cite all 2 seeds` and draws an edge
      to each seed in its colour; `Shared by ≥ 2` keeps it. Repeat under
      References. Close and reopen the graph: the grading is back with no
      check request. Remove the key and reopen: the citer reads
      `Cite 1 seed` again.
```

- In "Zotero suite", update the last full run line to today's date and the commit Step 4 ran at, with its result.
- In "Log", add: `- 2026-10-06, later: B78 shipped (ADR 0018): seed links checked against OpenAlex reference lists; commits <first>..<last> plus this log line.`

- [ ] **Step 6: Gate and commit**

Run: `npx prettier --write CONTEXT.md docs/adr/0017-the-shared-citer-grade-is-a-colouring.md docs/adr/0018-seed-links-are-checked-against-openalex-reference-lists.md docs/superpowers/handoffs/roadmap.md`, then `npm run check` — expected: green.

```bash
git add CONTEXT.md docs/adr/0017-the-shared-citer-grade-is-a-colouring.md docs/adr/0018-seed-links-are-checked-against-openalex-reference-lists.md docs/superpowers/handoffs/roadmap.md
git commit -m "B78 shipped: ADR 0018, CONTEXT's seed links, the roadmap ticked"
```

The merge, `npm run build` and the push follow `superpowers:finishing-a-development-branch` and the roadmap's working rules; the plan is deleted then, and the spec after the user's manual walk.
