# Fill Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keyed fills ask OpenAlex first and cut each paper's list most-cited first; the rail says how the shown lists were cut and draws only the hops that exist plus the next one.

**Architecture:** Pure rules go in `relationshipRefreshPolicy.ts` (provider order, cut order) and `graphScopeRailModel.ts` (rows, cut line); the I/O sites are `relatedWorkSummaryService.ts` (the OpenAlex page), `externalDiscoveryService.ts` (the refresh), `externalWorkCacheService.ts` (one new column) and `graphViewService.ts` (the wiring). Spec: `docs/superpowers/specs/2026-09-18-fill-order-design.md`. Deviation from the spec's Files list, found while planning: the fill's OpenAlex pages are served by `relatedWorkSummaryService.ts` (`fetchRelatedWorkSummaryPage`), not `openAlexProvider.ts`, so the `order` option and `meta.count` land there.

**Tech Stack:** TypeScript, `node:test` + chai for `test/unit` (`npm run test:unit`), mocha in Zotero for `test/zotero` (`npm test`, launches Zotero; run it once at the end, not per task), prettier + eslint + tsc through `npm run check`.

## Global Constraints

- Branch `d8-fill-order` (already holds the spec). One commit per task, sentence-case subject, no type prefix, staged by path, ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- `npm run check` must pass before every commit (prettier covers `docs/`; never let it split an inline code span across lines).
- The cut stays `AUTOMATIC_RELATIONSHIP_MEMBERSHIP_LIMIT` (50). No new preference.
- Copy, verbatim: `Top 50 citers per paper, most cited first`, `Top 50 references per paper, most cited first`, `First 50 citers per paper, in the provider's order`, `First 50 references per paper, in the provider's order`, `Top 50 citers per paper, most cited first for {n} of {m}`, `none yet` (Citers), `none found` (References).
- The Zotero suite runs once, after Task 8, not per task (roadmap, "Zotero suite"). The new case must never reach the network.

---

### Task 1: B67, the fill is an explicit option

**Files:**

- Modify: `src/services/externalDiscoveryService.ts:1242-1249` (signature), `:1388-1391`, `:1528-1543`, `:1869-1890`, `:1934-1947`
- Modify: `src/services/graphViewService.ts:3899-3901`

**Interfaces:**

- Produces: `ExternalRelationshipRefreshOptions.fill?: boolean`; `fetchProviderRelationshipSnapshot(providerID, node, direction, maximum, providerWorkIDs, requestOptions, fill = false)`.

- [ ] **Step 1: Add the option and read it instead of inferring it**

In `ExternalRelationshipRefreshOptions` (`:1528`), above `retryRefusals`:

```ts
  /**
   * The hop fill (ADR 0013, ADR 0014): paging providers only, one at a time,
   * never one sitting out a window, and an empty first page needs backing.
   * Explicit, so nothing infers it from `retryRefusals` (B67).
   */
  fill?: boolean;
```

Change `retryRefusals`'s comment to:

```ts
  /** False when the caller backs off from refusals itself: a 429 comes back at once, unretried. */
  retryRefusals?: boolean;
```

`fetchProviderRelationshipSnapshot` gains a last parameter `fill = false` after `requestOptions`, and `:1390` becomes `fill,` (was `fill: requestOptions?.retryRefusals === false,`).

`:1872-1873`: `const fillCandidates = options.fill ? fillRelationshipCandidates({` (was `options.retryRefusals === false ?`).

`:1938-1945`: the `askUntilNotRefused` call passes `true` as the new last argument:

```ts
            fetchProviderRelationshipSnapshot(
              provider,
              node,
              direction,
              maximum,
              options.providerWorkIDs,
              { signal: options.signal, retryRefusals: false },
              true,
            ),
```

- [ ] **Step 2: The runner says so**

`graphViewService.ts:3899-3901` becomes:

```ts
          // The fill (ADR 0013): no 429 retries, and the providers sitting
          // out a window are not asked.
          fill: true,
          retryRefusals: false,
```

- [ ] **Step 3: Gate and commit**

Run: `npm run check`
Expected: prettier, eslint, tsc and the unit suite all pass (the behaviour is pinned end to end by Task 8's Zotero case).

```bash
git add src/services/externalDiscoveryService.ts src/services/graphViewService.ts
git commit -m "B67: the fill is an explicit refresh option, not inferred from retryRefusals

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: B64, a manual Refresh does not wait out a refusal

**Files:**

- Modify: `src/services/externalDiscoveryService.ts:1962-1969`
- Modify: `src/services/graphViewService.ts:2554-2562`

- [ ] **Step 1: Forward `retryRefusals` on the aggregate path**

`:1968` becomes `{ signal: options.signal, retryRefusals: options.retryRefusals },`. A refused snapshot with no works has `succeeded: false`, so the existing `usable` filter (`:1991`) drops it; a refused snapshot with works stands as partial, as ADR 0013 says.

- [ ] **Step 2: The toolbar's Refresh asks for it**

In `graphViewService.ts`, inside the options object at `:2554`, after `mode: "manual",`:

```ts
                // A refusing provider costs this refresh one answer, not the
                // 15 s timeout (B64); no windows, no fill semantics.
                retryRefusals: false,
```

- [ ] **Step 3: Gate and commit**

Run: `npm run check`
Expected: pass.

```bash
git add src/services/externalDiscoveryService.ts src/services/graphViewService.ts
git commit -m "B64: a seed Refresh takes a refusal at once instead of waiting out the timeout

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: The fill's provider order and the cut order, as pure rules

**Files:**

- Modify: `src/providers/types.ts:10-17`
- Modify: `src/services/relationshipRefreshPolicy.ts` (append)
- Modify: `src/services/externalDiscoveryService.ts:1872-1890`
- Test: `test/unit/relationshipRefreshPolicy.test.ts`

**Interfaces:**

- Produces: `RelationshipCutOrder = "most-cited" | "arrival"` and `ProviderRequestOptions.order?: RelationshipCutOrder` (`src/providers/types.ts`); `fillProviderOrder(ordered, isPaging): CitationProviderID[]`, `cutOrderFor(provider, requested): RelationshipCutOrder`, `fillCutIntent(pagingProviders): RelationshipCutOrder` (`relationshipRefreshPolicy.ts`).

- [ ] **Step 1: Write the failing tests**

Append to `test/unit/relationshipRefreshPolicy.test.ts` (add `fillProviderOrder`, `cutOrderFor`, `fillCutIntent` to the import from `relationshipRefreshPolicy`):

```ts
describe("fillProviderOrder", function () {
  const order: CitationProviderID[] = [
    "semantic-scholar",
    "opencitations",
    "openalex",
  ];

  it("moves OpenAlex to the front when it can page", function () {
    expect(fillProviderOrder(order, () => true)).to.deep.equal([
      "openalex",
      "semantic-scholar",
      "opencitations",
    ]);
  });

  it("leaves the order alone when OpenAlex cannot page (no key)", function () {
    expect(
      fillProviderOrder(order, (provider) => provider !== "openalex"),
    ).to.deep.equal(order);
  });

  it("leaves the order alone when OpenAlex is not in it", function () {
    expect(
      fillProviderOrder(["semantic-scholar", "opencitations"], () => true),
    ).to.deep.equal(["semantic-scholar", "opencitations"]);
  });
});

describe("cutOrderFor", function () {
  it("is most-cited only when OpenAlex was asked for it", function () {
    expect(cutOrderFor("openalex", "most-cited")).to.equal("most-cited");
    expect(cutOrderFor("openalex", "arrival")).to.equal("arrival");
    expect(cutOrderFor("openalex", undefined)).to.equal("arrival");
    expect(cutOrderFor("semantic-scholar", "most-cited")).to.equal("arrival");
    expect(cutOrderFor("opencitations", "most-cited")).to.equal("arrival");
  });
});

describe("fillCutIntent", function () {
  it("is most-cited when OpenAlex is a paging provider, else arrival", function () {
    expect(
      fillCutIntent(["semantic-scholar", "opencitations", "openalex"]),
    ).to.equal("most-cited");
    expect(fillCutIntent(["semantic-scholar", "opencitations"])).to.equal(
      "arrival",
    );
    expect(fillCutIntent([])).to.equal("arrival");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm run test:unit -- --test-name-pattern="fillProviderOrder|cutOrderFor|fillCutIntent"`
Expected: the file fails to load (`fillProviderOrder` is not exported).

- [ ] **Step 3: The type, then the rules**

`src/providers/types.ts`, above `ProviderRequestOptions`:

```ts
/** How a relationship list was cut to its limit: most cited first, or as the provider returns it. */
export type RelationshipCutOrder = "most-cited" | "arrival";
```

and inside `ProviderRequestOptions`, after `retryRefusals`:

```ts
  /**
   * The order a page fetcher is asked to cut in. Only OpenAlex honours
   * `most-cited`; every other provider returns arrival order whatever is
   * asked, so the snapshot records what it got, not what it wanted.
   */
  order?: RelationshipCutOrder;
```

Append to `relationshipRefreshPolicy.ts` (add `import type { RelationshipCutOrder } from "../providers/types";` at the top):

```ts
/**
 * Who a fill asks first: OpenAlex whenever it can page the direction (enabled
 * and holding a key), since it is the one provider that sorts a list and
 * returns metadata with it; the native-first order stands behind it. Keyless
 * profiles see today's order unchanged.
 */
export function fillProviderOrder(
  ordered: readonly CitationProviderID[],
  isPaging: (providerID: CitationProviderID) => boolean,
): CitationProviderID[] {
  if (!ordered.includes("openalex") || !isPaging("openalex"))
    return [...ordered];
  return ["openalex", ...ordered.filter((provider) => provider !== "openalex")];
}

/** The order a snapshot was actually cut in: only OpenAlex honours most-cited. */
export function cutOrderFor(
  provider: CitationProviderID,
  requested: RelationshipCutOrder | undefined,
): RelationshipCutOrder {
  return provider === "openalex" && requested === "most-cited"
    ? "most-cited"
    : "arrival";
}

/** What the fill in force would cut in, for the rail before anything is expanded. */
export function fillCutIntent(
  pagingProviders: readonly CitationProviderID[],
): RelationshipCutOrder {
  return pagingProviders.includes("openalex") ? "most-cited" : "arrival";
}
```

- [ ] **Step 4: Wire the order into the fill**

`externalDiscoveryService.ts`: import `fillProviderOrder` from `./relationshipRefreshPolicy`, then at `:1872-1890`:

```ts
const isPaging = pagingProviderTest(direction);
const fillCandidates = options.fill
  ? fillRelationshipCandidates({
      ordered: fillProviderOrder(
        orderedRelationshipProviders(node, direction, "native-first", true),
        isPaging,
      ),
      isPaging,
      supportsPaper: (provider) =>
        providerSupportsPaper(provider, node, options.providerWorkIDs ?? {}),
      excluded: options.excludeProviders ?? [],
    })
  : null;
```

- [ ] **Step 5: Run the tests, gate, commit**

Run: `npm run test:unit -- --test-name-pattern="fillProviderOrder|cutOrderFor|fillCutIntent"` then `npm run check`
Expected: 7 new cases pass; check passes.

```bash
git add src/providers/types.ts src/services/relationshipRefreshPolicy.ts src/services/externalDiscoveryService.ts test/unit/relationshipRefreshPolicy.test.ts
git commit -m "D8: a keyed fill asks OpenAlex first

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: The OpenAlex page honours `most-cited` and returns its count

**Files:**

- Modify: `src/services/relatedWorkSummaryService.ts:140-142`, `:510-610`
- Modify: `src/services/externalDiscoveryService.ts:1266-1287`, `:1300-1310`, `:1370-1426`
- Modify: `src/services/providerResponseCacheService.ts:69-73`
- Test: `test/unit/providerRefusedPages.test.ts`, `test/unit/providerResponseCache.test.ts` (new)

**Interfaces:**

- Consumes: `ProviderRequestOptions.order` (Task 3).
- Produces: `RelatedWorkSummaryPage { works: RelatedWorkMetadata[]; reportedCount: number | null }`; `fetchRelatedWorkSummaryPage` now resolves to it.

- [ ] **Step 1: Update the four existing call sites in the test, then add the failing tests**

In `test/unit/providerRefusedPages.test.ts`, the two `deep.equal([])` assertions on `fetchRelatedWorkSummaryPage` (`:139-146` and `:180-182`) become `deep.equal({ works: [], reportedCount: null })`. Then append inside the same file:

```ts
describe("an OpenAlex page cut most-cited first", function () {
  const work = (id: string, count: number) => ({
    id: `https://openalex.org/${id}`,
    doi: `https://doi.org/10.5555/${id.toLowerCase()}`,
    display_name: `Paper ${id}`,
    publication_year: 2020,
    cited_by_count: count,
    authorships: [],
  });

  it("asks for cites sorted by citations and reads meta.count", async function () {
    respond = () =>
      answered({ results: [work("W2", 9), work("W3", 4)], meta: { count: 2 } });
    const page = await fetchRelatedWorkSummaryPage(
      "openalex",
      "W1",
      "cited-by",
      50,
      0,
      { order: "most-cited" },
    );
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get("filter")).to.equal("cites:W1");
    expect(url.searchParams.get("sort")).to.equal("cited_by_count:desc");
    expect(page.reportedCount).to.equal(2);
    expect(page.works.map((entry) => entry.providerWorkID)).to.deep.equal([
      "W2",
      "W3",
    ]);
  });

  it("sends no sort in arrival order and reads the count all the same", async function () {
    respond = () => answered({ results: [work("W2", 9)], meta: { count: 1 } });
    const page = await fetchRelatedWorkSummaryPage(
      "openalex",
      "W1",
      "cited-by",
      50,
      0,
    );
    expect(new URL(calls[0]!.url).searchParams.get("sort")).to.equal(null);
    expect(page.reportedCount).to.equal(1);
  });

  it("pages references through cited_by, sorted, with metadata", async function () {
    respond = () => answered({ results: [work("W5", 30)], meta: { count: 1 } });
    const page = await fetchRelatedWorkSummaryPage(
      "openalex",
      "W1",
      "references",
      50,
      0,
      { order: "most-cited" },
    );
    const url = new URL(calls[0]!.url);
    expect(url.pathname).to.equal("/works");
    expect(url.searchParams.get("filter")).to.equal("cited_by:W1");
    expect(url.searchParams.get("sort")).to.equal("cited_by_count:desc");
    expect(page.works[0]).to.include({
      providerWorkID: "W5",
      title: "Paper W5",
    });
    expect(page.reportedCount).to.equal(1);
  });

  it("keeps the referenced_works slice for references in arrival order", async function () {
    respond = (url) =>
      url.includes("/works/W3?")
        ? answered({
            referenced_works: ["https://openalex.org/W30"],
            referenced_works_count: 1,
          })
        : answered({ results: [work("W30", 2)] });
    const page = await fetchRelatedWorkSummaryPage(
      "openalex",
      "W3",
      "references",
      50,
      0,
    );
    expect(calls[0]!.url).to.include("/works/W3?");
    expect(page.works.map((entry) => entry.providerWorkID)).to.deep.equal([
      "W30",
    ]);
    expect(page.reportedCount).to.equal(null);
  });
});
```

Create `test/unit/providerResponseCache.test.ts`:

```ts
import { describe, it } from "node:test";
import { expect } from "chai";
import { isRelationshipResponse } from "../../src/services/providerResponseCacheService";

describe("isRelationshipResponse", function () {
  it("recognises both OpenAlex relation filters and the Semantic Scholar paths", function () {
    expect(
      isRelationshipResponse(
        "https://api.openalex.org/works?filter=cites%3AW1",
      ),
    ).to.equal(true);
    expect(
      isRelationshipResponse(
        "https://api.openalex.org/works?filter=cited_by%3AW1&sort=cited_by_count%3Adesc",
      ),
    ).to.equal(true);
    expect(
      isRelationshipResponse(
        "https://api.semanticscholar.org/graph/v1/paper/P1/citations?offset=0",
      ),
    ).to.equal(true);
    expect(
      isRelationshipResponse(
        "https://api.openalex.org/works?filter=doi%3A10.1%2Fx",
      ),
    ).to.equal(false);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm run test:unit -- --test-name-pattern="OpenAlex page cut|isRelationshipResponse"`
Expected: type errors (`page.works` on an array; `isRelationshipResponse` not exported), so the files fail to load.

- [ ] **Step 3: The page fetcher**

In `relatedWorkSummaryService.ts`, `OpenAlexList` (`:140`) becomes:

```ts
interface OpenAlexList {
  results?: OpenAlexWork[];
  /** OpenAlex's exact total for the filter, whatever the page holds. */
  meta?: { count?: number };
}
```

Above `fetchRelatedWorkSummaryPage` add the export, and change its signature and body. Replace `:510-610` with:

```ts
export interface RelatedWorkSummaryPage {
  works: RelatedWorkMetadata[];
  /** The provider's exact total for the direction when its list answer carries one. */
  reportedCount: number | null;
}

async function openAlexRelationPage(
  filter: string,
  requested: number,
  start: number,
  sorted: boolean,
  requestOptions?: ProviderRequestOptions,
): Promise<RelatedWorkSummaryPage> {
  const page = Math.floor(start / OPENALEX_BATCH_LIMIT) + 1;
  const withinPage = start % OPENALEX_BATCH_LIMIT;
  const response = await requestJSON<OpenAlexList>(
    "openalex",
    openAlexURL({
      filter,
      per_page: OPENALEX_BATCH_LIMIT,
      page,
      select: OPENALEX_SUMMARY_FIELDS,
      ...(sorted ? { sort: "cited_by_count:desc" } : {}),
    }),
    {
      signal: requestOptions?.signal,
      retryRefusals: requestOptions?.retryRefusals,
    },
  );
  if (response.status === 429) throw new ProviderRefusedError("openalex");
  if (!response.ok || !response.data) return { works: [], reportedCount: null };
  const count = response.data.meta?.count;
  return {
    works: (response.data.results ?? [])
      .slice(withinPage, withinPage + requested)
      .map(summaryFromOpenAlex)
      .filter((work): work is RelatedWorkMetadata => Boolean(work)),
    reportedCount:
      typeof count === "number" && Number.isFinite(count) && count >= 0
        ? count
        : null,
  };
}

export async function fetchRelatedWorkSummaryPage(
  providerID: "semantic-scholar" | "openalex",
  providerWorkID: string,
  direction: "references" | "cited-by",
  maximum: number,
  offset = 0,
  requestOptions?: ProviderRequestOptions,
): Promise<RelatedWorkSummaryPage> {
  const requested = Math.max(0, Math.floor(maximum));
  const start = Math.max(0, Math.floor(offset));
  const none: RelatedWorkSummaryPage = { works: [], reportedCount: null };
  if (!requested) return none;

  if (providerID === "semantic-scholar") {
    const kind = direction === "references" ? "references" : "citations";
    const response = await requestJSON<S2RelationResponse>(
      "semantic-scholar",
      `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(providerWorkID)}/${kind}?offset=${start}&limit=${Math.min(200, requested)}&fields=${encodeURIComponent(SEMANTIC_SCHOLAR_SUMMARY_FIELDS)}`,
      {
        signal: requestOptions?.signal,
        retryRefusals: requestOptions?.retryRefusals,
      },
    );
    if (response.status === 429) {
      throw new ProviderRefusedError("semantic-scholar");
    }
    if (!response.ok || !response.data) return none;
    return {
      works: (response.data.data ?? [])
        .map((entry) =>
          summaryFromSemanticScholar(
            direction === "references"
              ? (entry.citedPaper ?? {})
              : (entry.citingPaper ?? {}),
          ),
        )
        .filter((work): work is RelatedWorkMetadata => Boolean(work)),
      reportedCount: null,
    };
  }

  if (!getOpenAlexAPIKey()) return none;
  const normalizedID = shortOpenAlexID(providerWorkID);
  if (!normalizedID) return none;
  const sorted = requestOptions?.order === "most-cited";
  if (direction === "cited-by") {
    return openAlexRelationPage(
      `cites:${normalizedID}`,
      requested,
      start,
      sorted,
      requestOptions,
    );
  }
  // Sorted references are a filter query like citers: a list with metadata,
  // most cited first. Arrival order keeps the work record's own list, whose
  // order is the paper's bibliography.
  if (sorted) {
    return openAlexRelationPage(
      `cited_by:${normalizedID}`,
      requested,
      start,
      true,
      requestOptions,
    );
  }

  let referenceIDs = cachedOpenAlexReferenceIDs(normalizedID);
  if (!referenceIDs) {
    const source = await requestJSON<OpenAlexReferenceSource>(
      "openalex",
      openAlexPathURL(`/works/${encodeURIComponent(normalizedID)}`, {
        select: "referenced_works,referenced_works_count",
      }),
      {
        signal: requestOptions?.signal,
        retryRefusals: requestOptions?.retryRefusals,
      },
    );
    if (source.status === 429) throw new ProviderRefusedError("openalex");
    if (!source.ok || !source.data) return none;
    referenceIDs = (source.data.referenced_works ?? [])
      .map(shortOpenAlexID)
      .filter((id): id is string => Boolean(id));
    cacheOpenAlexReferenceIDs(normalizedID, referenceIDs);
  }
  const identifiers = referenceIDs.slice(start, start + requested);
  if (!identifiers.length) return none;
  const summaries: RelatedWorkMetadata[] = identifiers.map((id) => ({
    provider: "openalex",
    providerWorkID: id,
    doi: null,
    title: null,
    year: null,
    authors: [],
  }));
  await applyOpenAlexBatches(
    summaries,
    summaries.map((_, index) => index),
    requestOptions,
    true,
  );
  return {
    works: summaries.filter((work) => Boolean(work.title)),
    reportedCount: null,
  };
}
```

- [ ] **Step 4: The refresh passes `order` through and takes the count**

`externalDiscoveryService.ts:1266-1287`: the summary fetcher wrapper now unwraps the page and reports its count through a local. Replace with:

```ts
const nativeFetcher =
  direction === "references"
    ? provider.fetchReferencedWorks
    : provider.fetchCitingWorks;
const hasSummaryFetcher =
  providerID === "semantic-scholar" || providerID === "openalex";
/** The list answer's own total (OpenAlex `meta.count`), read off the first page. */
let listReportedCount: number | null = null;
const fetcher = hasSummaryFetcher
  ? async (
      id: string,
      requested: number,
      offset: number,
      options?: ProviderRequestOptions,
    ) => {
      const page = await fetchRelatedWorkSummaryPage(
        providerID,
        id,
        direction,
        requested,
        offset,
        options,
      );
      if (listReportedCount === null) listReportedCount = page.reportedCount;
      return page.works;
    }
  : nativeFetcher;
```

`:1300-1310`: `const reportedCount =` becomes `let reportedCount =`. Then inside the page loop, straight after `pages += 1;` (`:1386`):

```ts
// A hinted parent skipped the lookup, so the list answer is the only
// place a total can come from (spec, "Reported count for free").
if (reportedCount === null && listReportedCount !== null) {
  reportedCount = listReportedCount;
  knownReportedCount = reportedCount;
}
```

`fetchProviderRelationshipSnapshot`'s `requestOptions` already reach the fetcher through `withProviderTimeout` (`:1234` spreads them), so `order` arrives once the caller sets it: at `:1944` the fill's request options become `{ signal: options.signal, retryRefusals: false, order: "most-cited" }`.

- [ ] **Step 5: The response cache recognises `cited_by`**

`providerResponseCacheService.ts:69-73`: export the function and take both filters:

```ts
export function isRelationshipResponse(url: string): boolean {
  if (/\/(?:references|citations)(?:\?|$)/i.test(url)) return true;
  const parsed = new URL(url);
  return /^(?:cites|cited_by):/i.test(parsed.searchParams.get("filter") ?? "");
}
```

- [ ] **Step 6: Run the tests, gate, commit**

Run: `npm run test:unit -- --test-name-pattern="OpenAlex page cut|isRelationshipResponse|refused relationship page"` then `npm run check`
Expected: all pass, including the four updated assertions.

```bash
git add src/services/relatedWorkSummaryService.ts src/services/externalDiscoveryService.ts src/services/providerResponseCacheService.ts test/unit/providerRefusedPages.test.ts test/unit/providerResponseCache.test.ts
git commit -m "D8: the fill's OpenAlex page is cut most cited first and carries its total

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: The stored list remembers its cut

**Files:**

- Modify: `src/providers/relationshipPolicy.ts:53-64`
- Modify: `src/services/externalWorkCacheService.ts:34-44`, `:56-60`, `:295-308`, `:337-343`, `:418-429`, `:481-557`
- Modify: `src/services/relationshipStoreService.ts:216-230`
- Modify: `src/services/externalDiscoveryService.ts:1250-1257`, `:1318-1327`, `:1329-1340`, `:1436-1447`, `:1449-1459`, `:2024-2071`
- Test: whichever files under `test/unit` build a `RelationshipProviderSnapshot` literal; `npm run typecheck` names them, and each literal gains `order: "arrival"`. No new case: `cutOrderFor` (Task 3) pins the rule and Task 7 pins the wiring.

**Interfaces:**

- Produces: `RelationshipProviderSnapshot.order: RelationshipCutOrder`; `ExternalRelationshipCacheEntry.order` and `ExternalRelationshipCacheSummary.order`; `saveExternalRelationshipCache(key, works, { order })` and `replaceStoredRelationshipSelection(node, direction, works, { order })`.

- [ ] **Step 1: The snapshot**

`relationshipPolicy.ts`: add `import type { RelationshipCutOrder } from "./types";` and, in `RelationshipProviderSnapshot` after `refused`:

```ts
/** How the list was cut: most-cited only when the provider honoured it (spec, "The cut"). */
order: RelationshipCutOrder;
```

In `externalDiscoveryService.ts`, every snapshot literal in `fetchProviderRelationshipSnapshot` gains `order`: `failed()` (`:1250`) and the reported-zero and no-fetcher returns (`:1318`, `:1329`) use `order: "arrival"`; the two returns that carry works (`:1436` and the refused branch at `:1449`) use `order: cutOrderFor(providerID, requestOptions?.order)` (import `cutOrderFor` from `./relationshipRefreshPolicy`). The cancelled literal in the `mapBounded` branch (`:1953`) gets `order: "arrival"`. `tsc` names any other literal.

- [ ] **Step 2: The cache column**

`externalWorkCacheService.ts`: add `import type { RelationshipCutOrder } from "../providers/types";`. `ExternalRelationshipCacheEntry` and `ExternalRelationshipCacheSummary` each gain `order: RelationshipCutOrder;`. `ExternalRelationshipCacheRow` gains `cut_order: string | null;`.

After the `SCHEMA` loop in `initExternalWorkCache` (`:339-343`) add the guarded column:

```ts
// Lists stored before the cut was recorded read as arrival order.
const columns = (await connection.queryAsync(
  "PRAGMA table_info(external_relationships_v2)",
)) as Array<{ name: string }>;
if (!columns.some((column) => column.name === "cut_order")) {
  await connection.queryAsync(
    "ALTER TABLE external_relationships_v2 ADD COLUMN cut_order TEXT",
  );
}
```

`rowToRelationshipEntry` returns `order: row.cut_order === "most-cited" ? "most-cited" : "arrival",`. `getExternalRelationshipCacheSummary` returns `order: entry.order,`. `saveExternalRelationshipCache`'s options gain `order?: RelationshipCutOrder`; the insert becomes:

```ts
await connection.queryAsync(
  `INSERT OR REPLACE INTO external_relationships_v2
         (relationship_key, works_json, fetched_at, cut_order)
         VALUES (?, ?, ?, ?)`,
  [relationshipKey, JSON.stringify(storedWorks), fetchedAt, order],
);
```

with `const order: RelationshipCutOrder = options.order ?? "arrival";` declared beside `fetchedAt`, and the mirror entry (`:548`) gains `order,`.

`relationshipStoreService.ts:216-230`: the options type gains `order?: RelationshipCutOrder` and passes it on: `{ writeMetadata: options.writeMetadata, alreadyCanonical: ..., order: options.order }` (keep whatever the call already passes; add `order`).

- [ ] **Step 3: The refresh stores the answering snapshot's order**

`externalDiscoveryService.ts`: move the `answered` computation (`:2057-2062`) up to just before `replaceStoredRelationshipSelection` (`:2029`), and pass `order: answered.order` in its options. The `onMembershipResolved` call below keeps using `answered.provider`.

- [ ] **Step 4: Gate and commit**

Run: `npm run check`
Expected: pass; `tsc` reports no snapshot literal missing `order`.

```bash
git add src/providers/relationshipPolicy.ts src/services/externalWorkCacheService.ts src/services/relationshipStoreService.ts src/services/externalDiscoveryService.ts test/unit
git commit -m "D8: a stored list records the order it was cut in

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: The rail draws what exists and says how it was cut

**Files:**

- Modify: `src/services/graphScopeRailModel.ts:59-123`, `:239-320`
- Modify: `src/services/graphHopFillRunner.ts:157-162`, `:483-495`
- Modify: `src/services/graphViewService.ts:3788-3810`
- Modify: `src/services/graphKeyRail.ts:528-562`
- Modify: `addon/content/graph.css:1777-1782`
- Test: `test/unit/graphScopeRailModel.test.ts:369-454`, `test/unit/graphHopFillRunner.test.ts`

**Interfaces:**

- Consumes: `fillCutIntent`, `AUTOMATIC_RELATIONSHIP_MEMBERSHIP_LIMIT` (`relationshipRefreshPolicy.ts`); `getStoredRelationshipSummary(...).order` (Task 5).
- Produces: `ScopeHopsInput.drainedByHop: readonly boolean[]`, `ScopeHopsInput.cut: { mostCited: number; arrival: number; intent: RelationshipCutOrder }`, `ScopeHopsBlock.cutLine: string`, `HopFillRunner.drainedByHop(entries, depth, direction): boolean[]`, `cutLineText(cut, direction): string`.

- [ ] **Step 1: Write the failing rail tests**

In `test/unit/graphScopeRailModel.test.ts`, `hopsInput` (`:369`) gains two defaults after `fill: null,`:

```ts
    drainedByHop: [true, false, false],
    cut: { mostCited: 0, arrival: 0, intent: "most-cited" },
```

Replace the case at `:402-437` with:

```ts
  it("lists Seeds, the open hops and one Fetch row, nothing past it", function () {
    const block = railWithHops(hopsInput())!.hops!;
    expect(block.direction).to.equal("cited-by");
    expect(block.rows.map((row) => row.label)).to.deep.equal([
      "Seeds",
      "Hop 1",
      "Hop 2",
      "Hop 3",
    ]);
    expect(block.rows[0]).to.include({ count: "1", checkbox: false, dimmed: false, fetchButton: false });
    expect(block.rows[1]).to.include({ count: "4/5", reported: `of ${count(1200)}`, checkbox: true });
    expect(block.rows[2]).to.include({ count: "9/12", reported: null });
    expect(block.rows[3]).to.include({ count: "not fetched", fetchButton: true, dimmed: true, enabled: true });
  });

  it("offers no Fetch row while the deepest open hop is empty", function () {
    const block = railWithHops(
      hopsInput({ shownByHop: [1, 0, 0], availableByHop: [1, 0, 0], drainedByHop: [false, false, false] }),
    )!.hops!;
    expect(block.rows.map((row) => row.label)).to.deep.equal(["Seeds", "Hop 1", "Hop 2"]);
    expect(block.rows[2]).to.include({ count: "0/0", fetchButton: false });
  });

  it("reads none yet once the hop above is drained, and none found under References", function () {
    const citers = railWithHops(
      hopsInput({ shownByHop: [1, 3, 0], availableByHop: [1, 3, 0], drainedByHop: [true, true, false] }),
    )!.hops!;
    expect(citers.rows[2]).to.include({ count: "none yet", fetchButton: false });
    expect(citers.rows).to.have.length(3);
    const references = railWithHops(
      hopsInput({
        direction: "references",
        shownByHop: [1, 3, 0],
        availableByHop: [1, 3, 0],
        drainedByHop: [true, true, false],
      }),
    )!.hops!;
    expect(references.rows[2]).to.include({ count: "none found" });
  });

  it("keeps 0/0 while the hop above has a paper in flight or one that failed", function () {
    const block = railWithHops(
      hopsInput({ shownByHop: [1, 3, 0], availableByHop: [1, 3, 0], drainedByHop: [true, false, false] }),
    )!.hops!;
    expect(block.rows[2]).to.include({ count: "0/0" });
  });

  it("carries no Fetch row at depth 6", function () {
    const block = railWithHops(
      hopsInput({
        depth: 6,
        shownByHop: [1, 1, 1, 1, 1, 1, 1],
        availableByHop: [1, 1, 1, 1, 1, 1, 1],
        reportedByHop: [null, null, null, null, null, null, null],
        drainedByHop: [true, true, true, true, true, true, false],
      }),
    )!.hops!;
    expect(block.rows).to.have.length(7);
    expect(block.rows.some((row) => row.fetchButton)).to.equal(false);
  });
});

describe("the cut line", function () {
  it("states the fill's intent before anything is expanded", function () {
    expect(cutLineText({ mostCited: 0, arrival: 0, intent: "most-cited" }, "cited-by")).to.equal(
      "Top 50 citers per paper, most cited first",
    );
    expect(cutLineText({ mostCited: 0, arrival: 0, intent: "arrival" }, "references")).to.equal(
      "First 50 references per paper, in the provider's order",
    );
  });

  it("states how the shown lists were cut, never the intent, once some are stored", function () {
    expect(cutLineText({ mostCited: 4, arrival: 0, intent: "arrival" }, "cited-by")).to.equal(
      "Top 50 citers per paper, most cited first",
    );
    expect(cutLineText({ mostCited: 0, arrival: 4, intent: "most-cited" }, "cited-by")).to.equal(
      "First 50 citers per paper, in the provider's order",
    );
    expect(cutLineText({ mostCited: 3, arrival: 1, intent: "most-cited" }, "cited-by")).to.equal(
      "Top 50 citers per paper, most cited first for 3 of 4",
    );
  });

  it("is on the block", function () {
    expect(railWithHops(hopsInput())!.hops!.cutLine).to.equal(
      "Top 50 citers per paper, most cited first",
    );
  });
});
```

Add `cutLineText` to the file's import from `graphScopeRailModel`. Update the `depth: 6` case at `:439-454`: add `drainedByHop: [true, true, false, false, false, false, false],` to its overrides (its assertions stand).

Note on grouped digits: `{n} of {m}` are small integers here; if a case ever needs 1,000+, derive the text through `count()` as the file already does.

In `test/unit/graphHopFillRunner.test.ts`, inside `describe("createHopFillRunner")`, after the case "marks a paper that stored nothing failed in that direction only" (`:203`), add two cases built on the file's own `fakeHost` (seed `s` expanded at hop 0; `a` and `b` at hop 1; `fake.failing` makes a key store nothing):

```ts
it("reports every hop drained once the plan lands with nothing failed", async function () {
  const fake = fakeHost();
  const runner = createHopFillRunner(fake.host);
  expect(
    runner.drainedByHop(fake.entries, 2, "cited-by"),
    "no plan yet",
  ).to.deep.equal([false, false, false]);
  runner.wake();
  await fake.settle();
  // Hop 2 holds no paper, so nothing at it is left either.
  expect(runner.drainedByHop(fake.entries, 2, "cited-by")).to.deep.equal([
    true,
    true,
    true,
  ]);
});

it("does not report a hop drained while a paper at it failed", async function () {
  const fake = fakeHost();
  fake.failing.add("a");
  const runner = createHopFillRunner(fake.host);
  runner.wake();
  await fake.settle();
  // "a" failed for the session: it left the plan, so `remaining` is 0 at
  // hop 1, and that is exactly the case the failed set has to catch.
  expect(runner.drainedByHop(fake.entries, 2, "cited-by")).to.deep.equal([
    true,
    false,
    true,
  ]);
  // Failure is per direction: under References nothing has failed, and no
  // plan has been made there yet, so nothing is drained either.
  expect(runner.drainedByHop(fake.entries, 2, "references")).to.deep.equal([
    false,
    false,
    false,
  ]);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm run test:unit -- --test-name-pattern="Citation hops block|cut line|drained"`
Expected: the files fail to load (`cutLineText`, `drainedByHop` missing; `hopsInput` literal rejects unknown fields).

- [ ] **Step 3: The model**

`graphScopeRailModel.ts`: add two imports, `import { AUTOMATIC_RELATIONSHIP_MEMBERSHIP_LIMIT } from "./relationshipRefreshPolicy";` and `import type { RelationshipCutOrder } from "../providers/types";`.

The Key needs no change: `assignCategories` (`graphCategoryAssignment.ts:161`) counts categories over the nodes present, so a hop with no node already has no Key row.

`ScopeHopsInput` gains, after `fill`:

```ts
  /**
   * Per hop: nothing at it is left to expand, waiting on the cap, deferred
   * or failed this session (the runner's `drainedByHop`). Decides whether an
   * empty hop below reads `none yet` or `0/0`.
   */
  drainedByHop: readonly boolean[];
  /** How the shown expanded papers' stored lists were cut, and what the fill would cut in. */
  cut: ScopeCutInput;
```

with, above it:

```ts
export interface ScopeCutInput {
  mostCited: number;
  arrival: number;
  intent: RelationshipCutOrder;
}
```

`ScopeHopsBlock` gains `cutLine: string;`. Add the text function above `buildScopeHopsBlock`:

```ts
/**
 * The cut line: how the shown lists were actually cut, never the fill's
 * intent once anything is stored, since a fallback provider cuts in arrival
 * order whatever was asked (spec, "The rail says so").
 */
export function cutLineText(
  cut: ScopeCutInput,
  direction: HopDirection,
): string {
  const limit = COUNT_FORMAT.format(AUTOMATIC_RELATIONSHIP_MEMBERSHIP_LIMIT);
  const word = direction === "cited-by" ? "citers" : "references";
  const total = cut.mostCited + cut.arrival;
  const mostCited = `Top ${limit} ${word} per paper, most cited first`;
  const arrival = `First ${limit} ${word} per paper, in the provider's order`;
  if (total === 0) return cut.intent === "most-cited" ? mostCited : arrival;
  if (cut.arrival === 0) return mostCited;
  if (cut.mostCited === 0) return arrival;
  return `${mostCited} for ${COUNT_FORMAT.format(cut.mostCited)} of ${COUNT_FORMAT.format(total)}`;
}
```

Replace the row loop in `buildScopeHopsBlock` (`:240-267`):

```ts
const rows: ScopeHopRow[] = [];
// The open hops, and one Fetch row while the deepest holds a paper: hops
// that cannot exist yet are not drawn (spec, "The rail shows what exists").
const deepestHasPapers = (input.availableByHop[input.depth] ?? 0) > 0;
const lastRow = Math.min(
  MAX_HOP_DEPTH,
  deepestHasPapers ? input.depth + 1 : input.depth,
);
const emptyWord = input.direction === "cited-by" ? "none yet" : "none found";
for (let hop = 0; hop <= lastRow; hop += 1) {
  const opened = hop <= input.depth;
  const enabled = hop === 0 ? true : input.enabled[hop] !== false;
  const shown = input.shownByHop[hop] ?? 0;
  const available = input.availableByHop[hop] ?? 0;
  const reported = input.reportedByHop[hop] ?? null;
  const drainedAbove = hop > 0 && input.drainedByHop[hop - 1] === true;
  rows.push({
    hop,
    label: hop === 0 ? "Seeds" : `Hop ${hop}`,
    count:
      hop === 0
        ? COUNT_FORMAT.format(shown)
        : !opened
          ? "not fetched"
          : available === 0 && drainedAbove
            ? emptyWord
            : `${COUNT_FORMAT.format(shown)}/${COUNT_FORMAT.format(available)}`,
    reported:
      opened && hop > 0 && reported !== null && reported > available
        ? `of ${COUNT_FORMAT.format(reported)}`
        : null,
    fetchButton: hop === input.depth + 1,
    checkbox: hop > 0,
    enabled,
    dimmed: !opened || !enabled,
    opened,
    swatch: input.colours ? (input.colours[hop] ?? null) : null,
  });
}
```

and the return (`:319`) becomes `return { direction: input.direction, rows, progress, cutLine: cutLineText(input.cut, input.direction) };`.

- [ ] **Step 4: The runner reports drained hops**

`graphHopFillRunner.ts`: in `HopFillRunner` after `reportedByHop`:

```ts
  /**
   * Per hop, whether nothing at it is left, waiting, deferred or failed this
   * session, so the rail can call the hop below empty rather than pending.
   * False for every hop until a plan exists.
   */
  drainedByHop(
    entries: ReadonlyMap<string, { hop: number }>,
    depth: number,
    direction: HopDirection,
  ): boolean[];
```

and the implementation after `reportedByHop`'s:

```ts
    drainedByHop: (entries, depth, direction) => {
      const drained = Array.from({ length: depth + 1 }, () => false);
      if (!lastPlan || direction !== lastDirection) return drained;
      const failedAt = new Set<number>();
      for (const key of failed[direction]) {
        const hop = entries.get(key)?.hop;
        if (hop !== undefined) failedAt.add(hop);
      }
      for (let hop = 0; hop <= depth; hop += 1) {
        // `remainingByHop` counts every qualifying paper not yet expanded, so
        // in-flight, paused, waiting and deferred papers all keep it above 0.
        drained[hop] =
          (lastPlan.remainingByHop[hop] ?? 0) === 0 && !failedAt.has(hop);
      }
      return drained;
    },
```

- [ ] **Step 5: The view wires both**

`graphViewService.ts`: import `fillCutIntent` from `./relationshipRefreshPolicy` (`getStoredRelationshipSummary` and `hopFillPagingProviders` are already imported). In `scopeHopsInput` (`:3791`) add, after `fill: hopFill.state(),`:

```ts
      drainedByHop: hopModel
        ? hopFill.drainedByHop(hopModel.entries, hopDepth, hopDirection)
        : [],
      cut: cutInput(),
```

and define, just above `scopeHopsInput`:

```ts
/**
 * How the shown expanded papers' stored lists were cut. Read off the
 * relationship mirror's summaries, never the works, since this runs on
 * every rail rebuild.
 */
const cutInput = (): ScopeCutInput => {
  let mostCited = 0;
  let arrival = 0;
  if (hopModel && lastScope) {
    for (const [key, entry] of hopModel.entries) {
      if (!entry.expanded || !lastScope.visibleKeys.has(key)) continue;
      const subject = hopSubject(key);
      const summary = subject
        ? getStoredRelationshipSummary(subject, hopDirection)
        : null;
      if (!summary) continue;
      if (summary.order === "most-cited") mostCited += 1;
      else arrival += 1;
    }
  }
  return {
    mostCited,
    arrival,
    intent: fillCutIntent(hopFillPagingProviders(hopDirection)),
  };
};
```

Import `ScopeCutInput` beside `ScopeHopsInput` (`:102`). Confirm `HopEntry` exposes `expanded` (it does: `graphHopFillModel.ts:71` reads `entry.expanded`).

- [ ] **Step 6: The DOM and CSS**

`graphKeyRail.ts` `hopsBlockElement`, after `host.appendChild(segmented);` (`:552`):

```ts
host.appendChild(text(document, "p", block.cutLine, "cm-scope-hop-cut"));
```

`addon/content/graph.css`, after the `.cm-scope-hop-progress` rule (`:1782`):

```css
.cm-scope-hop-cut {
  margin: 2px 0 4px 0;
  color: var(--cm-muted);
  font-size: 11px;
}
```

- [ ] **Step 7: Run the tests, gate, commit**

Run: `npm run test:unit -- --test-name-pattern="Citation hops block|cut line|drained"` then `npm run check`
Expected: pass.

```bash
git add src/services/graphScopeRailModel.ts src/services/graphHopFillRunner.ts src/services/graphViewService.ts src/services/graphKeyRail.ts addon/content/graph.css test/unit/graphScopeRailModel.test.ts test/unit/graphHopFillRunner.test.ts
git commit -m "D8: the rail draws the hops that exist and says how their lists were cut

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: The Zotero case, offline through a fake OpenAlex

**Files:**

- Modify: `test/zotero/graphCitationHops.test.ts` (append a `describe` block inside `Citation hops (Stage 3)`, after the B72 block, before the suite's closing)

**Interfaces:**

- Consumes: the file's helpers `openNewGraphTab`, `dismissGallery`, `tabContent`, `graphRoot`, `nodeMenuEntry`, `hopRowText`, `hopCountText`, `hopCounts`, `fetchButton`, `progressText`, `waitFor`, `providerAnswer`, `providerRefusal`, `PROVIDER_HOST`, and `currentTabID`, `win`.

- [ ] **Step 1: Write the case**

Append inside the outer `describe`, after the B72 block:

```ts
/**
 * D8: with a key, the fill asks OpenAlex first, sorted, and every list
 * comes back with metadata. Served offline: the key is a fake set for the
 * case alone, and the wrapper answers every provider host itself, so a
 * keyless profile runs it too and nothing reaches the network.
 */
describe("with an OpenAlex key (D8)", function () {
  const KEY_PREF = `${config.prefsPrefix}.openAlexAPIKey`;
  const SEED_DOI = "10.5555/d8.order.seed";
  const SEED_TITLE = `${FIXTURE_TITLE} (D8 order)`;
  const CITERS = [
    { id: "W802", doi: "10.5555/d8.order.a", count: 9 },
    { id: "W803", doi: "10.5555/d8.order.b", count: 4 },
  ];
  let previousKey: unknown = undefined;
  let seedItemID: number | null = null;
  let tabID: string | null = null;
  let realRequest: any = null;
  let asked: string[] = [];

  function openAlexWork(id: string, doi: string, count: number): unknown {
    return {
      id: `https://openalex.org/${id}`,
      doi: `https://doi.org/${doi}`,
      display_name: `D8 paper ${id}`,
      publication_year: 2021,
      publication_date: "2021-01-01",
      cited_by_count: count,
      referenced_works_count: 0,
      authorships: [
        {
          author: { id: "https://openalex.org/A1", display_name: "A. Author" },
        },
      ],
      primary_location: null,
    };
  }

  function serveOpenAlex(): void {
    if (realRequest) return;
    realRequest = Zotero.HTTP.request;
    (Zotero.HTTP as any).request = async (
      method: string,
      url: string,
      options?: unknown,
    ) => {
      if (!PROVIDER_HOST.test(url))
        return realRequest.call(Zotero.HTTP, method, url, options);
      asked.push(url);
      if (!/^https:\/\/api\.openalex\.org\//.test(url))
        return providerRefusal();
      const parsed = new URL(url);
      // The seed is a library paper: its own expansion looks the DOI up.
      if (/\/works\/doi/i.test(decodeURIComponent(parsed.pathname))) {
        return providerAnswer(
          JSON.stringify(openAlexWork("W801", SEED_DOI, CITERS.length)),
        );
      }
      const filter = parsed.searchParams.get("filter") ?? "";
      if (filter === "cites:W801") {
        return providerAnswer(
          JSON.stringify({
            results: CITERS.map((citer) =>
              openAlexWork(citer.id, citer.doi, citer.count),
            ),
            meta: { count: CITERS.length },
          }),
        );
      }
      if (/^cites:W80[23]$/.test(filter)) {
        return providerAnswer(
          JSON.stringify({ results: [], meta: { count: 0 } }),
        );
      }
      return providerAnswer(
        JSON.stringify({ results: [], meta: { count: 0 } }),
      );
    };
  }

  function answerAgain(): void {
    if (!realRequest) return;
    (Zotero.HTTP as any).request = realRequest;
    realRequest = null;
  }

  function cutLine(): string {
    const line = graphRoot().querySelector(".cm-scope-hop-cut");
    return line ? normalize(line.textContent) : "no cut line";
  }

  before(async function () {
    this.timeout(90_000);
    previousKey = Zotero.Prefs.get(KEY_PREF, true);
    Zotero.Prefs.set(KEY_PREF, "d8-test-key", true);
    serveOpenAlex();
    const item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField("title", SEED_TITLE);
    item.setField("date", "2019");
    item.setField("DOI", SEED_DOI);
    seedItemID = await item.saveTx();
    tabID = await openNewGraphTab();
    currentTabID = tabID;
    win.Zotero_Tabs.select(tabID);
    const rail = await waitFor(
      () =>
        tabContent(tabID)?.querySelector(".cm-scope-section .cm-scope-count"),
      30_000,
    );
    expect(rail, "the D8 tab's Scope section").to.exist;
    await dismissGallery(tabID);
    const fit = await waitFor(
      () =>
        graphRoot().querySelector(
          '.cm-zoom-controls button[data-action="fit"]',
        ) as HTMLButtonElement | null,
      10_000,
    );
    expect(fit, "the D8 tab's fit button").to.exist;
    fit!.click();
  });

  after(async function () {
    this.timeout(30_000);
    answerAgain();
    if (previousKey === undefined || previousKey === null)
      Zotero.Prefs.clear(KEY_PREF, true);
    else Zotero.Prefs.set(KEY_PREF, previousKey as string, true);
    if (tabID) win.Zotero_Tabs.close(tabID);
    await delay(500);
    tabID = null;
    currentTabID = null;
    if (seedItemID !== null) await Zotero.Items.erase(seedItemID);
    seedItemID = null;
  });

  it("fills through OpenAlex alone, sorted, with the rows and the cut line the data allows", async function () {
    this.timeout(180_000);
    asked = [];
    (await nodeMenuEntry("Add as seed", SEED_TITLE)).click();
    const filled = await waitFor(() => hopCounts(1)?.available ?? null, 60_000);
    expect(
      filled,
      `hop 1 never filled; it read "${hopRowText(1)}"; ${asked.length} request(s): ${asked.join(" | ")}`,
    ).to.equal(CITERS.length);
    // OpenAlex first: nobody else was asked at all.
    expect(
      asked.filter((url) => !/^https:\/\/api\.openalex\.org\//.test(url)),
      `a provider other than OpenAlex was asked: ${asked.join(" | ")}`,
    ).to.be.empty;
    // Sorted: the seed's citer page carried the sort.
    const citerPages = asked.filter(
      (url) => new URL(url).searchParams.get("filter") === "cites:W801",
    );
    expect(citerPages, "the seed's citer page").to.not.be.empty;
    expect(new URL(citerPages[0]!).searchParams.get("sort")).to.equal(
      "cited_by_count:desc",
    );
    // The rows: Seeds, Hop 1, a Fetch row for hop 2, nothing else.
    expect(
      Array.from(graphRoot().querySelectorAll(".cm-scope-hop-row")).map(
        (row) => (row as HTMLElement).dataset.hop,
      ),
      `rows: ${Array.from(graphRoot().querySelectorAll(".cm-scope-hop-row"))
        .map((row) => normalize(row.textContent))
        .join(" | ")}`,
    ).to.deep.equal(["0", "1", "2"]);
    expect(fetchButton(2), "hop 2's Fetch button").to.exist;
    expect(cutLine()).to.equal("Top 50 citers per paper, most cited first");
    // Hop 2: both citers expand to nothing, so hop 2 reads none yet and no
    // Fetch row follows it.
    fetchButton(2)!.click();
    const empty = await waitFor(
      () => (hopCountText(2) === "none yet" ? hopCountText(2) : null),
      60_000,
    );
    expect(
      empty,
      `hop 2 never read none yet; it read "${hopRowText(2)}", line "${progressText()}"; ${asked.length} request(s): ${asked.join(" | ")}`,
    ).to.exist;
    expect(fetchButton(3), "no Fetch row past an empty hop").to.equal(null);
    expect(
      Array.from(graphRoot().querySelectorAll(".cm-scope-hop-row")).map(
        (row) => (row as HTMLElement).dataset.hop,
      ),
    ).to.deep.equal(["0", "1", "2"]);
    // No hydration: the lists carried metadata, so no batch lookup went out.
    expect(
      asked.filter((url) => /filter=(ids\.openalex|doi)%3A/i.test(url)),
      `a hydration batch was asked: ${asked.join(" | ")}`,
    ).to.be.empty;
    // Every request was OpenAlex and each expansion was one request:
    // the seed's lookup, its page, and one page per citer.
    expect(asked.length, `requests: ${asked.join(" | ")}`).to.equal(
      2 + CITERS.length,
    );
  });
});
```

If `config` is not already imported at the top of the file it is (`:3`); `normalize` and `delay` are too.

- [ ] **Step 2: Lint the case before spending a suite run**

Run: `npm run check`
Expected: prettier, eslint and the test tsconfig pass on the new block (roadmap memory: brief-supplied test code has never been checked; this is the gate).

- [ ] **Step 3: Run the case alone**

Wrap the new block in `describe.only(` temporarily, run `npm test 2>&1 | tee "$env:TEMP\d8-zotero.log"` (PowerShell) and read the tail. Expected: 1 passing. If the request count assertion fails, the message lists every URL: adjust the served set or the expected count only for a reason you can name in a comment (an extra `select`ed lookup, for example), never to make the number fit. Remove `.only` before committing.

- [ ] **Step 4: Commit**

```bash
git add test/zotero/graphCitationHops.test.ts
git commit -m "D8: a Zotero case fills through a fake OpenAlex and reads the rail

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: ADR, vocabulary, roadmap

**Files:**

- Create: `docs/adr/0015-a-keyed-fill-asks-openalex-first-and-cuts-most-cited-first.md`
- Modify: `CONTEXT.md:156-159` (after Cap)
- Modify: `docs/superpowers/specs/2026-09-18-fill-order-design.md` (Files section)
- Modify: `docs/superpowers/handoffs/roadmap.md`

- [ ] **Step 1: The ADR**

```markdown
# A keyed fill asks OpenAlex first and cuts most cited first

A fill orders its candidates native-first, then moves OpenAlex to the front
whenever it is a paging provider for the direction: enabled and holding a key.
It asks for the list most cited first, and OpenAlex is the one provider that
honours that; the others return arrival order whatever is asked, and the
stored list records which it got. The cut stays fifty works per paper.

Why OpenAlex: measured on 2026-09-16, 393 of 432 fill requests went to
OpenCitations, which needs a lookup per paper and returns bare DOIs, so
hydration is a second pass; Semantic Scholar refused eleven of fifteen;
OpenAlex answered twenty of twenty, sorts, and returns metadata in the list,
and was asked last. With it first an expansion from hop 2 on is one request,
no lookup and no hydration, and the list response's `meta.count` supplies
the total a hinted parent could not otherwise report.

Why most cited first: the reader wants the whole field, and the place
completeness yields is each parent's tail. A cut of fifty in arrival order is
whichever fifty the provider returns; most cited first makes it the fifty
that matter, and the rail says which cut the shown lists carry rather than
what the fill intended, since a fallback provider cuts in arrival order.

Rejected: pruning by attention (expanding only what was looked at), which
answers a different reader; a reader-set budget, which adds a number the
rail already has too many of; batching parents into one OR-filter query,
which reworks per-paper bookkeeping and waits on this order being measured.

ADR 0006 and ADR 0013 stand: one answering provider per expansion, and a
refusal moves the expansion to the next candidate.
```

- [ ] **Step 2: The vocabulary**

`CONTEXT.md`, after the **Cap** entry:

```markdown
**Cut**:
How a stored list was trimmed to its limit: most cited first, when the
answering provider sorts, or in arrival order, as the provider returns it.
The rail's cut line says which the shown lists carry.
_Avoid_: truncation, top-N, sample
```

- [ ] **Step 3: The spec's Files section and the roadmap**

In the spec's Files list, replace the `openAlexProvider.ts` bullet with `src/services/relatedWorkSummaryService.ts: sort, cited_by, meta.count (the fill's OpenAlex pages are served here, not by the provider file)`; add `src/services/externalWorkCacheService.ts: the cut_order column`.

Roadmap: delete the D8, B64 and B67 entries under "The hop fill"; under D7 and D12 add one clause each, "the cut line (D8) is the plain statement; what remains is …" keeping each entry terse; add to Manual verification:

```markdown
- [ ] D8: on your own profile (OpenAlex key set), open a fresh seeded graph.
      The hop block reads Seeds, Hop 1, a Fetch hop 2 row and the cut line
      `Top 50 citers per paper, most cited first`; no rows past that. Fill to
      hop 3 and re-run the 2026-09-16 probe: requests per expansion, requests
      by provider, time to hop 3, against 393 requests and 29.6 min. Under
      Citers, fill until the chain runs into the present: the last row reads
      `none yet` and offers no Fetch.
- [ ] B64: with Semantic Scholar refusing, press Refresh on a seed. The
      progress window closes in seconds, not after 15 s.
```

Add the session's line to the Log, and note under "Zotero suite" that the D8 case sets a fake OpenAlex key for its own block and restores it.

- [ ] **Step 4: Gate, full suite, commit**

Run: `npm run check`, then the full Zotero suite once: `npm test 2>&1 | tee "$env:TEMP\d8-full.log"`. Expected: 90 passed (89 + the D8 case), allowing the known live-provider flakes the roadmap's Zotero suite section names; name any other failure before committing.

```bash
git add docs/adr/0015-a-keyed-fill-asks-openalex-first-and-cuts-most-cited-first.md CONTEXT.md docs/superpowers/specs/2026-09-18-fill-order-design.md docs/superpowers/handoffs/roadmap.md
git commit -m "D8: ADR 0015, the Cut in the vocabulary, and the roadmap ticked

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Then: fast-forward `main` to the branch, `npm run build` last, push via `gh-daniel-locatelli`.
