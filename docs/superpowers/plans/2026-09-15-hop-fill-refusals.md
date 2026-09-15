# The Hop Fill Under Provider Refusals (B50) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A hop expansion refused with HTTP 429 is neither retried nor failed. The fill moves straight to the next paging provider, sits the refusing provider out for 30 s, 1 min, 2 min and then every 5 min, and waits only when nobody is left to ask. Meanwhile the rail counts down in place.

**Architecture:** The refusal travels as a typed value end to end:

1. `requestJSON` returns a 429 at once when `retryRefusals` is false.
2. The page fetchers throw `ProviderRefusedError`, and lookups report `rate-limited`.
3. `fetchProviderRelationshipSnapshot` marks the snapshot `refused`.
4. The relationship refresh walks the fill's candidates until one does not refuse, then reports `refusedBy`, `skipped` and `answeredBy` on its resolution.
5. The host hands those to the runner as a `HopExpandOutcome`. The runner keeps per-provider windows and per-paper deferrals, and holds one timer while cooling down.

The rail model prints the refusal line with a fixed `retryAt`. The rail DOM rewrites only the countdown span each second.

**Tech Stack:** TypeScript, Zotero 7 plugin (zotero-plugin-scaffold), `node:test` + chai unit tests (`test/unit`, `mock.module` / `mock.timers`), mocha Zotero suite (`test/zotero`).

**Spec:** `docs/superpowers/specs/2026-09-15-hop-fill-refusals-design.md` (approved 2026-09-15 after an adversarial review).

## Global Constraints

- A refused expansion is never added to the failed set, and a refused snapshot with no works collected is never stored, on any path.
- Cool-down delays are exactly `[30_000, 60_000, 120_000, 300_000]` ms; step `s` waits `COOL_DOWN_MS[min(s, 3)]`; never giving up.
- The fill's requests set `retryRefusals: false`: a 429 is not retried but still postpones the provider's queue. 5xx and network errors keep their retries. Every other caller keeps today's retries.
- The fill bypasses the 60 s register (`recordProviderFailure` / `getProviderPlan`) through `getProviderPlan(..., { ignoreHealth: true })`.
- A fill trusts an empty first page only when a lookup match or a reported count stands behind it. A provider work ID hint does not count: an OpenCitations hint is only the DOI, which is the case this rule exists for.
- A fill never asks Crossref or Inspire. With no candidate left it requests nothing and publishes nothing.
- Seed Refresh, the detail pane and the focus refresh change only in "a refused snapshot is never stored". They get no windows, no switching and no change to retries.
- Rail text, exactly:
  - `Semantic Scholar refusing`, or `{n} providers refusing` with the names joined by `, ` in the line's `title`;
  - the countdown reads `retry in {n} s` while `n = ceil(ms/1000) < 60`, else `retry in {m} min` with `m = ceil(ms/60000)`, and `retry in 0 s` at or below 0.
- The countdown updates every second, only while cooling down, and never rebuilds the Scope section.
- Facts checked 2026-09-15 with curl:
  - `opencitations.net/index/coci/api/v1/*` redirects (301) to `api.opencitations.net/index/v1/*`;
  - `citations` and `references` answer 200, with `[]` for an unindexed DOI;
  - `metadata` answers **410 Gone**, so OpenCitations lookups never match. This is recorded as B63 in Task 12 and not fixed here.
- Zotero-suite cases drive the plugin only through its own menus and rendered DOM; the test bundle is a second copy, so never import a service from a suite. Wrapping the global `Zotero.HTTP.request` is fine: `requestJSON` reads it at call time.
- Zotero-suite evidence goes into assertion messages: `Zotero.debug` never reaches the runner log. Run a timing-shaped case twice.
- `npm test` launches the dev Zotero and runs the whole `test/zotero` directory: `zotero-plugin test` has no file filter. Run it in the background and wait for the task to exit before starting another run, or the next one hits `EBUSY` on `cert9.db`. Never stop a live Zotero without asking.
- `npm test` deletes the XPI, so build it (`npm run build`) after the last `npm test` run.
- The machine locale is de-CH: derive grouped digits in tests from `Intl.NumberFormat`, never a literal.
- `npm run check` runs prettier over the repo, `docs/` included. Run `npx prettier --write` on every file touched before committing, and `npx eslint` on touched `src`/`test` files.
- Commit per task, messages prefixed `B50:`, each ending with:

  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_0139CEcpgf2K5b1eJQqQfJDo
  ```

  Do not push.

- Unit commands:
  - one file: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/<file>.test.ts`
  - all: `npm run test:unit` (562 passing before this plan)
  - types: `npm run typecheck`

## File Structure

| File                                              | Change | Responsibility                                                                                                                         |
| ------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `src/providers/types.ts`                          | modify | `ProviderRefusedError`; `ProviderRequestOptions.retryRefusals`                                                                         |
| `src/providers/http.ts`                           | modify | `JSONRequestOptions.retryRefusals`: a 429 returned at once, provider still postponed                                                   |
| `src/providers/semanticScholarProvider.ts`        | modify | `fetchRelations` throws on 429; title match's 429 makes `searchExactTitle` `rate-limited`; pass-through                                |
| `src/providers/openCitationsProvider.ts`          | modify | `fetchLinks` throws on 429; pass-through                                                                                               |
| `src/providers/openAlexProvider.ts`               | modify | `requestOpenAlex` pass-through                                                                                                         |
| `src/providers/registry.ts`                       | modify | `getProviderPlan` option `ignoreHealth`                                                                                                |
| `src/providers/relationshipPolicy.ts`             | modify | `RelationshipProviderSnapshot.refused`                                                                                                 |
| `src/services/relatedWorkSummaryService.ts`       | modify | summary pages and the page's OpenAlex batches throw on 429; pass-through                                                               |
| `src/services/cancellationScope.ts`               | modify | `withTimeoutScope`                                                                                                                     |
| `src/services/relationshipRefreshPolicy.ts`       | modify | `lookupStep`, `isPagingProvider`, `fillRelationshipCandidates`, `nextFillProvider`, `refusedSnapshotState`, `unbackedEmptyList`        |
| `src/services/externalDiscoveryService.ts`        | modify | refusal-aware lookup, cancelling timeout, refused snapshot, fill candidates and switching, resolution fields, `hopFillPagingProviders` |
| `src/services/graphHopRunnerModel.ts`             | modify | refused landing, `HopExpandOutcome`, window rules, `hopCoolDown`                                                                       |
| `src/services/graphHopFillModel.ts`               | modify | `deferredKeys` in, `deferredByHop` and `deferred` out                                                                                  |
| `src/services/graphHopFillRunner.ts`              | modify | outcome, windows, deferrals, one timer, `retryNow`, `refusal` state, host clock                                                        |
| `src/services/graphViewService.ts`                | modify | host `expand` outcome and options; `now` / `after` / `cancelAfter` / `pagingProviders`; Resume → `retryNow`                            |
| `src/services/graphScopeRailModel.ts`             | modify | refusal line, `countdown`, `title`, `formatRetryIn`                                                                                    |
| `src/services/graphKeyRail.ts`                    | modify | countdown span rewritten in place; line `title`; optional `now`                                                                        |
| `test/unit/providerRefusals.test.ts`              | create | `ProviderRefusedError`; `requestJSON` with `retryRefusals`                                                                             |
| `test/unit/providerRefusedPages.test.ts`          | create | page fetchers and lookups under a scripted `requestJSON`                                                                               |
| `test/unit/cancellationScope.test.ts`             | create | `withTimeoutScope` under fake timers                                                                                                   |
| `test/unit/relationshipRefreshPolicy.test.ts`     | modify | the refresh's pure decisions; `ignoreHealth`                                                                                           |
| `test/unit/architecture.test.ts`                  | modify | snapshot literals gain `refused: false`                                                                                                |
| `test/unit/graphHopRunnerModel.test.ts`           | modify | four landings, windows, cool-down                                                                                                      |
| `test/unit/graphHopFillModel.test.ts`             | modify | deferred papers                                                                                                                        |
| `test/unit/graphHopFillRunner.test.ts`            | modify | fake host with clock, timers and refusing providers                                                                                    |
| `test/unit/graphScopeRailModel.test.ts`           | modify | refusal line, `formatRetryIn`                                                                                                          |
| `test/zotero/graphCitationHops.test.ts`           | modify | nested block "under provider refusals (B50)"                                                                                           |
| `docs/adr/0013-a-refusal-is-not-a-failure.md`     | create | the decision                                                                                                                           |
| `docs/adr/0006-one-provider-per-hop-expansion.md` | modify | closing pointer to 0013                                                                                                                |
| `CONTEXT.md`                                      | modify | **Refused**; **Failed** narrowed                                                                                                       |
| `docs/superpowers/specs/*.md`                     | modify | citation-hops runner pointer; B50 spec status                                                                                          |
| `docs/superpowers/handoffs/2026-09-08-roadmap.md` | modify | B50 built and ticked, B63 filed, manual check, suite count, log line                                                                   |

---

### Task 1: A refusal as a typed error, returned at once to a caller that backs off itself

**Files:**

- Modify: `src/providers/types.ts:10-12` (options), after `:74` (error class)
- Modify: `src/providers/http.ts:28-35` (options), `:408-416` (the retry decision)
- Create: `test/unit/providerRefusals.test.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces:
  - `class ProviderRefusedError extends Error { readonly provider: CitationProviderID }` in `src/providers/types.ts`
  - `ProviderRequestOptions.retryRefusals?: boolean`
  - `JSONRequestOptions.retryRefusals?: boolean`: when `false`, a 429 is returned at once and the provider postponed as a retry would postpone it.

- [ ] **Step 1: Write the failing test**

Create `test/unit/providerRefusals.test.ts`:

```ts
import { afterEach, beforeEach, describe, it } from "node:test";
import { expect } from "chai";
import {
  requestJSON,
  resetCitationRequestCancellation,
} from "../../src/providers/http";
import { ProviderRefusedError } from "../../src/providers/types";

/** When each request reached `Zotero.HTTP.request`, and what it answered. */
let attempts: Array<{ url: string; at: number }> = [];
/** The statuses the fake answers with, in order; 200 once they run out. */
let statuses: number[] = [];
let previousZotero: unknown;

beforeEach(function () {
  previousZotero = (globalThis as Record<string, unknown>).Zotero;
  attempts = [];
  statuses = [];
  resetCitationRequestCancellation();
  (globalThis as Record<string, unknown>).Zotero = {
    Prefs: { get: () => undefined, set: () => undefined },
    debug: () => undefined,
    HTTP: {
      request: async (_method: string, url: string) => {
        attempts.push({ url, at: Date.now() });
        const status = statuses.shift() ?? 200;
        return {
          status,
          responseText: status === 200 ? "[]" : "",
          getResponseHeader: () => null,
        };
      },
    },
  };
});

afterEach(function () {
  resetCitationRequestCancellation();
  (globalThis as Record<string, unknown>).Zotero = previousZotero;
});

describe("ProviderRefusedError", function () {
  it("names the provider that refused", function () {
    const error = new ProviderRefusedError("openalex");
    expect(error).to.be.instanceOf(Error);
    expect(error.name).to.equal("ProviderRefusedError");
    expect(error.provider).to.equal("openalex");
    expect(error.message).to.include("429");
  });
});

describe("requestJSON with retryRefusals: false", function () {
  it("returns a refused request at once instead of retrying it", async function () {
    statuses = [429];
    const result = await requestJSON(
      "opencitations",
      "https://example.test/refused",
      { retryRefusals: false },
    );
    expect(result.status).to.equal(429);
    expect(result.ok).to.equal(false);
    expect(attempts.length, "one request, no retries").to.equal(1);
  });

  it("still postpones the provider's queue after the refusal", async function () {
    // OpenCitations spaces requests 400 ms apart; the first backoff is at
    // least 1000 ms. A second request starting sooner means nothing
    // postponed the queue.
    statuses = [429, 200];
    await requestJSON("opencitations", "https://example.test/first", {
      retryRefusals: false,
    });
    await requestJSON("opencitations", "https://example.test/second", {
      retryRefusals: false,
    });
    expect(attempts.length).to.equal(2);
    expect(attempts[1].at - attempts[0].at).to.be.at.least(950);
  });

  it("keeps retrying a 503", async function () {
    statuses = [503, 200];
    const result = await requestJSON(
      "opencitations",
      "https://example.test/unavailable",
      { retryRefusals: false, retryLimit: 1 },
    );
    expect(attempts.length).to.equal(2);
    expect(result.status).to.equal(200);
  });
});

describe("requestJSON for every other caller", function () {
  it("retries a 429 as before", async function () {
    statuses = [429, 200];
    const result = await requestJSON(
      "opencitations",
      "https://example.test/retried",
      { retryLimit: 1 },
    );
    expect(attempts.length).to.equal(2);
    expect(result.status).to.equal(200);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/providerRefusals.test.ts`
Expected: FAIL. `ProviderRefusedError` is not exported (SyntaxError at import), so no case runs.

- [ ] **Step 3: Implement**

In `src/providers/types.ts`, replace the options interface:

```ts
export interface ProviderRequestOptions {
  signal?: CancellationSignal;
  /**
   * Passed to `requestJSON`: false when the caller backs off from refusals
   * itself (the hop fill, ADR 0013), so a 429 comes back at once.
   */
  retryRefusals?: boolean;
}
```

After `failureStatusFromHTTP`, add:

```ts
/**
 * A provider answered HTTP 429. A refusal is neither "no results" nor a
 * failure (ADR 0013): page fetchers throw this so a relationship refresh can
 * tell a refused page from an empty one.
 */
export class ProviderRefusedError extends Error {
  readonly provider: CitationProviderID;

  constructor(provider: CitationProviderID) {
    super(`${provider} refused the request (HTTP 429)`);
    this.name = "ProviderRefusedError";
    this.provider = provider;
  }
}
```

In `src/providers/http.ts`, add to `JSONRequestOptions` after `retryLimit`:

```ts
  /**
   * False when the caller backs off from refusals itself (the hop fill, ADR
   * 0013): a 429 is returned at once instead of retried. The provider's queue
   * is still postponed as a retry would postpone it, and 5xx and network
   * errors keep their retries.
   */
  retryRefusals?: boolean;
```

In `requestJSON`, directly after the `if (!response || requestWasCancelled(options.signal)) { ... }` block and before `const retryable =`, insert:

```ts
if (response.status === 429 && options.retryRefusals === false) {
  postponeProvider(
    provider,
    parseRetryAfter(response) ?? backoffDelayMs(attempt),
  );
  return parseJSON<T>(provider, response);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/providerRefusals.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Typecheck, format, commit**

```bash
npm run typecheck
npx prettier --write src/providers/types.ts src/providers/http.ts test/unit/providerRefusals.test.ts
npx eslint src/providers/types.ts src/providers/http.ts test/unit/providerRefusals.test.ts
git add src/providers/types.ts src/providers/http.ts test/unit/providerRefusals.test.ts
git commit -m "B50: a refusal is a typed error, and requestJSON can return a 429 at once"
```

---

### Task 2: Page fetchers throw on a refusal; a refused title match is not "not found"

**Files:**

- Modify: `src/providers/semanticScholarProvider.ts`: import `:17`, `fetchRelations` `:104-126`, `searchClosestTitle` `:274-301`, `searchExactTitle` `:303-367`, and every `requestJSON` options object
- Modify: `src/providers/openCitationsProvider.ts`: import `:10`, `fetchLinks` `:54-71`, `lookup` `:105-109`
- Modify: `src/providers/openAlexProvider.ts:60-62`
- Modify: `src/services/relatedWorkSummaryService.ts`: import `:13`, `applyOpenAlexBatches` `:398-462`, `fetchRelatedWorkSummaryPage` `:499-584`
- Create: `test/unit/providerRefusedPages.test.ts`

**Interfaces:**

- Consumes: `ProviderRefusedError`, `ProviderRequestOptions.retryRefusals` (Task 1).
- Produces:
  - `semanticScholarProvider.fetchCitingWorks` / `fetchReferencedWorks`, `openCitationsProvider.fetchCitingWorks` / `fetchReferencedWorks`, and `fetchRelatedWorkSummaryPage` reject with `ProviderRefusedError` on a 429;
  - `semanticScholarProvider.searchExactTitle` resolves `status: "rate-limited"` when the title match is refused;
  - every provider request that takes `options?.signal` also passes `retryRefusals: options?.retryRefusals`.

- [ ] **Step 1: Write the failing test**

Create `test/unit/providerRefusedPages.test.ts`:

```ts
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { expect } from "chai";
import { config } from "../../package.json";
import type {
  RelatedWorkMetadata,
  WorkIdentifiers,
} from "../../src/domain/citationTypes";
import type { HTTPResult, JSONRequestOptions } from "../../src/providers/http";

/**
 * `requestJSON` replaced by a script: each case says what the provider
 * answers for a URL, and every request is kept, so a case can assert what was
 * asked and with which options. The HTTP layer itself is
 * providerRefusals.test.ts.
 */
const calls: Array<{
  provider: string;
  url: string;
  options: JSONRequestOptions;
}> = [];
let respond: (url: string) => HTTPResult<unknown> = () => answered(null);

function answered(data: unknown): HTTPResult<unknown> {
  return { ok: true, status: 200, data, message: "" };
}

function refused(): HTTPResult<unknown> {
  return { ok: false, status: 429, data: null, message: "HTTP 429" };
}

const realHTTP = await import("../../src/providers/http");
mock.module("../../src/providers/http.ts", {
  exports: {
    ...realHTTP,
    requestJSON: async (
      provider: string,
      url: string,
      options: JSONRequestOptions,
    ) => {
      calls.push({ provider, url, options });
      return respond(url);
    },
  },
});
const { ProviderRefusedError } = await import("../../src/providers/types");
const { semanticScholarProvider } =
  await import("../../src/providers/semanticScholarProvider");
const { openCitationsProvider } =
  await import("../../src/providers/openCitationsProvider");
const { openAlexProvider } =
  await import("../../src/providers/openAlexProvider");
const {
  clearRelatedWorkSummaryCaches,
  fetchRelatedWorkSummaryPage,
  resolveRelatedWorkSummaries,
} = await import("../../src/services/relatedWorkSummaryService");

function identifiers(
  overrides: Partial<WorkIdentifiers> = {},
): WorkIdentifiers {
  return {
    doi: null,
    pmid: null,
    arxiv: null,
    isbn: null,
    title: "",
    normalizedTitle: "",
    year: null,
    authors: [],
    sourceTitle: null,
    ...overrides,
  };
}

/** The rejection a refused request must produce. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return expect.fail("the request was expected to be refused");
}

let previousZotero: unknown;

beforeEach(function () {
  previousZotero = (globalThis as Record<string, unknown>).Zotero;
  calls.length = 0;
  respond = () => answered(null);
  clearRelatedWorkSummaryCaches();
  (globalThis as Record<string, unknown>).Zotero = {
    Prefs: {
      // OpenAlex pages only with a key; every other preference is unset.
      get: (name: string) =>
        name === `${config.prefsPrefix}.openAlexAPIKey`
          ? "test-key"
          : undefined,
      set: () => undefined,
    },
    debug: () => undefined,
  };
});

afterEach(function () {
  (globalThis as Record<string, unknown>).Zotero = previousZotero;
});

describe("a refused relationship page", function () {
  it("throws from Semantic Scholar's relations and summary pages, passing retryRefusals on", async function () {
    respond = () => refused();
    const relations = await rejection(
      semanticScholarProvider.fetchCitingWorks!("P1", 50, 0, {
        retryRefusals: false,
      }),
    );
    expect(relations).to.be.instanceOf(ProviderRefusedError);
    expect(
      (relations as InstanceType<typeof ProviderRefusedError>).provider,
    ).to.equal("semantic-scholar");
    const page = await rejection(
      fetchRelatedWorkSummaryPage("semantic-scholar", "P1", "cited-by", 50, 0, {
        retryRefusals: false,
      }),
    );
    expect(page).to.be.instanceOf(ProviderRefusedError);
    expect(calls.map((call) => call.options.retryRefusals)).to.deep.equal([
      false,
      false,
    ]);
  });

  it("still reads an empty Semantic Scholar page as an empty list", async function () {
    respond = () => answered({ data: [] });
    expect(
      await semanticScholarProvider.fetchReferencedWorks!("P1", 50, 0),
    ).to.deep.equal([]);
    expect(
      await fetchRelatedWorkSummaryPage(
        "semantic-scholar",
        "P1",
        "references",
        50,
        0,
      ),
    ).to.deep.equal([]);
  });

  it("throws from OpenAlex's cited-by page, its references source and the page's batches", async function () {
    respond = () => refused();
    expect(
      await rejection(
        fetchRelatedWorkSummaryPage("openalex", "W1", "cited-by", 50, 0),
      ),
      "cited-by page",
    ).to.be.instanceOf(ProviderRefusedError);
    expect(
      await rejection(
        fetchRelatedWorkSummaryPage("openalex", "W2", "references", 50, 0),
      ),
      "references source",
    ).to.be.instanceOf(ProviderRefusedError);
    respond = (url) =>
      url.includes("/works/W3?")
        ? answered({
            referenced_works: ["https://openalex.org/W30"],
            referenced_works_count: 1,
          })
        : refused();
    expect(
      await rejection(
        fetchRelatedWorkSummaryPage("openalex", "W3", "references", 50, 0),
      ),
      "the page's summary batch",
    ).to.be.instanceOf(ProviderRefusedError);
  });

  it("still reads an empty OpenAlex cited-by page as an empty list", async function () {
    respond = () => answered({ results: [] });
    expect(
      await fetchRelatedWorkSummaryPage("openalex", "W4", "cited-by", 50, 0),
    ).to.deep.equal([]);
  });

  it("does not throw when a metadata hydration batch is refused", async function () {
    respond = () => refused();
    const work: RelatedWorkMetadata = {
      provider: "openalex",
      providerWorkID: "W40",
      doi: null,
      title: null,
      year: null,
      authors: [],
    };
    const works = await resolveRelatedWorkSummaries([work], "openalex");
    expect(works).to.have.length(1);
    expect(calls.length, "the batch was asked").to.be.greaterThan(0);
  });

  it("throws from OpenCitations' links and keeps an empty list empty", async function () {
    respond = () => refused();
    const links = await rejection(
      openCitationsProvider.fetchCitingWorks!("10.1000/oc", 50, 0, {
        retryRefusals: false,
      }),
    );
    expect(links).to.be.instanceOf(ProviderRefusedError);
    expect(calls[0].options.retryRefusals).to.equal(false);
    respond = () => answered([]);
    expect(
      await openCitationsProvider.fetchReferencedWorks!("10.1000/oc", 50, 0),
    ).to.deep.equal([]);
  });
});

describe("a refused lookup", function () {
  it("reads a refused Semantic Scholar title match as rate-limited, not not-found", async function () {
    respond = (url) =>
      url.includes("/paper/search/match?") ? refused() : answered({ data: [] });
    const result = await semanticScholarProvider.searchExactTitle!(
      identifiers({
        title: "A refused title",
        normalizedTitle: "a refused title",
      }),
    );
    expect(result.status).to.equal("rate-limited");
  });

  it("passes retryRefusals on from every provider's lookup", async function () {
    respond = () => ({
      ok: false,
      status: 404,
      data: null,
      message: "HTTP 404",
    });
    const ids = identifiers({ doi: "10.1000/pass-through" });
    await semanticScholarProvider.lookup(ids, { retryRefusals: false });
    await openCitationsProvider.lookup(ids, { retryRefusals: false });
    await openAlexProvider.lookup(ids, { retryRefusals: false });
    expect(new Set(calls.map((call) => call.provider))).to.deep.equal(
      new Set(["semantic-scholar", "opencitations", "openalex"]),
    );
    expect(
      calls.every((call) => call.options.retryRefusals === false),
      JSON.stringify(calls.map((call) => [call.provider, call.options])),
    ).to.equal(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/providerRefusedPages.test.ts`
Expected: FAIL.

- The refusal cases fail with "the request was expected to be refused".
- The title match reads `not-found`.
- The pass-through case prints options without `retryRefusals`.
- The two empty-list cases and the hydration case pass.

- [ ] **Step 3: Implement**

`src/providers/semanticScholarProvider.ts`:

1. Import: `import { ProviderRefusedError, failureStatusFromHTTP, numberOrNull, stringOrNull } from "./types";`
2. In every `requestJSON` options object in the file:
   - where it reads `{ signal: options?.signal }`, change it to `{ signal: options?.signal, retryRefusals: options?.retryRefusals }`;
   - in the two POST objects (`fetchSemanticScholarPapersBatch`, `fetchSemanticScholarRecommendations`), add `retryRefusals: options?.retryRefusals,` after `signal: options?.signal,`.
3. In `fetchRelations`, before `if (!response.ok || !response.data) return [];`:

```ts
if (response.status === 429) throw new ProviderRefusedError("semantic-scholar");
```

4. Replace `searchClosestTitle` with a result that says whether the match was refused, and keep a paper-only wrapper for `resolveSemanticScholarPaperID`:

```ts
interface ClosestTitle {
  paper: S2Paper | null;
  /** The match endpoint answered HTTP 429: no answer, which is not "no match". */
  refused: boolean;
}

async function searchClosestTitleResult(
  identifiers: WorkIdentifiers,
  options?: ProviderRequestOptions,
): Promise<ClosestTitle> {
  const title = String(identifiers.title ?? "").trim();
  if (!title) return { paper: null, refused: false };
  const response = await requestJSON<S2Paper>(
    "semantic-scholar",
    `https://api.semanticscholar.org/graph/v1/paper/search/match?query=${encodeURIComponent(title)}&fields=${encodeURIComponent(BASIC_FIELDS)}`,
    { signal: options?.signal, retryRefusals: options?.retryRefusals },
  );
  if (response.status === 429) return { paper: null, refused: true };
  if (!response.ok || !response.data?.paperId) {
    return { paper: null, refused: false };
  }
  const candidate = response.data;
  const similarity = titleSimilarity(title, candidate.title);
  const exact = similarity === 1;
  const matchScore = Number(candidate.matchScore);
  const scoreIsUseful = Number.isFinite(matchScore) && matchScore >= 0.7;
  if (!exact && similarity < 0.72 && !scoreIsUseful) {
    return { paper: null, refused: false };
  }
  const candidateWork = toRelated(candidate);
  if (
    (identifiers.year !== null || identifiers.authors.length > 0) &&
    (!candidateWork ||
      matchWorkIdentifiers(identifiers, candidateWork).decision !== "same-work")
  ) {
    return { paper: null, refused: false };
  }
  return { paper: candidate, refused: false };
}

async function searchClosestTitle(
  identifiers: WorkIdentifiers,
  options?: ProviderRequestOptions,
): Promise<S2Paper | null> {
  return (await searchClosestTitleResult(identifiers, options)).paper;
}
```

5. In `searchExactTitle`, replace `const closest = await searchClosestTitle(identifiers, options);` and the `if (closest) { ... }` block that follows with:

```ts
const closest = await searchClosestTitleResult(identifiers, options);
if (closest.refused) {
  return {
    status: "rate-limited",
    provider: "semantic-scholar",
    message: "Semantic Scholar refused the title match (HTTP 429).",
  };
}
if (closest.paper) {
  const paper = closest.paper;
  const confidence = Math.max(
    0.75,
    Math.min(
      0.95,
      Number(paper.matchScore) ||
        titleSimilarity(identifiers.title, paper.title),
    ),
  );
  return successFromPaper(paper, "title", confidence, false, options);
}
```

`src/providers/openCitationsProvider.ts`:

1. Import: `import { ProviderRefusedError, failureStatusFromHTTP, numberOrNull, stringOrNull } from "./types";`
2. In `fetchLinks` and `lookup`, the options object becomes `{ signal: options?.signal, retryRefusals: options?.retryRefusals }`.
3. In `fetchLinks`, before `if (!response.ok || !Array.isArray(response.data)) return [];`:

```ts
if (response.status === 429) throw new ProviderRefusedError("opencitations");
```

`src/providers/openAlexProvider.ts`: in `requestOpenAlex`, replace the options object with:

```ts
return requestJSON<T>("openalex", openAlexURL(path, parameters), {
  signal: options?.signal,
  retryRefusals: options?.retryRefusals,
});
```

`src/services/relatedWorkSummaryService.ts`:

1. Replace `import type { ProviderRequestOptions } from "../providers/types";` with `import { ProviderRefusedError, type ProviderRequestOptions } from "../providers/types";`
2. `applyOpenAlexBatches` gains a fourth parameter, `refusalsThrow = false`, with this doc line above the function: `/** \`refusalsThrow\` is set by a relationship page only; metadata hydration keeps swallowing a refused batch. */`. Its request options become `{ signal: requestOptions?.signal, retryRefusals: requestOptions?.retryRefusals }`, and before `if (!response.ok || !response.data) return;` insert:

```ts
if (refusalsThrow && response.status === 429) {
  throw new ProviderRefusedError("openalex");
}
```

3. In `fetchRelatedWorkSummaryPage`, the three `{ signal: requestOptions?.signal }` objects (Semantic Scholar page, OpenAlex cited-by, OpenAlex references source) become `{ signal: requestOptions?.signal, retryRefusals: requestOptions?.retryRefusals }`, and each gets a throw before its `!response.ok` / `!source.ok` return:

```ts
if (response.status === 429) {
  throw new ProviderRefusedError("semantic-scholar");
}
```

```ts
if (response.status === 429) throw new ProviderRefusedError("openalex");
```

```ts
if (source.status === 429) throw new ProviderRefusedError("openalex");
```

4. The page's batch call becomes:

```ts
await applyOpenAlexBatches(
  summaries,
  summaries.map((_, index) => index),
  requestOptions,
  true,
);
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/providerRefusedPages.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Whole unit suite, typecheck, format, commit**

```bash
npm run typecheck
npm run test:unit
npx prettier --write src/providers/semanticScholarProvider.ts src/providers/openCitationsProvider.ts src/providers/openAlexProvider.ts src/services/relatedWorkSummaryService.ts test/unit/providerRefusedPages.test.ts
npx eslint src/providers src/services/relatedWorkSummaryService.ts test/unit/providerRefusedPages.test.ts
git add src/providers/semanticScholarProvider.ts src/providers/openCitationsProvider.ts src/providers/openAlexProvider.ts src/services/relatedWorkSummaryService.ts test/unit/providerRefusedPages.test.ts
git commit -m "B50: page fetchers throw on a refusal, and a refused title match is rate-limited"
```

Expected: typecheck clean; unit 562 + 5 + 8 = 575 passing.

---

### Task 3: A timeout that cancels what it abandoned

**Files:**

- Modify: `src/services/cancellationScope.ts` (append)
- Create: `test/unit/cancellationScope.test.ts`

**Interfaces:**

- Consumes: `createCancellationScope`, `CancellationSignal` (same file).
- Produces: `withTimeoutScope<T>(operation: (signal: CancellationSignal) => Promise<T>, ms: number, parentSignal: CancellationSignal | undefined, onTimeout: () => void): Promise<T | null>`

- [ ] **Step 1: Write the failing test**

Create `test/unit/cancellationScope.test.ts`:

```ts
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { expect } from "chai";
import {
  createCancellationScope,
  withTimeoutScope,
  type CancellationSignal,
} from "../../src/services/cancellationScope";

beforeEach(function () {
  mock.timers.enable({ apis: ["setTimeout"] });
});

afterEach(function () {
  mock.timers.reset();
});

/** A holder, so the signal handed to the operation can be read afterwards. */
function seen(): { signal: CancellationSignal | null } {
  return { signal: null };
}

describe("withTimeoutScope", function () {
  it("cancels the operation it abandoned when the timer wins", async function () {
    const operation = seen();
    let timedOut = 0;
    const pending = withTimeoutScope(
      (signal) => {
        operation.signal = signal;
        return new Promise<string>(() => undefined);
      },
      15_000,
      undefined,
      () => {
        timedOut += 1;
      },
    );
    mock.timers.tick(14_999);
    expect(operation.signal!.cancelled, "not before the timeout").to.equal(
      false,
    );
    mock.timers.tick(1);
    expect(await pending).to.equal(null);
    expect(operation.signal!.cancelled).to.equal(true);
    expect(timedOut).to.equal(1);
  });

  it("cancels the operation when the parent is cancelled", async function () {
    const parent = createCancellationScope("parent");
    const operation = seen();
    const pending = withTimeoutScope(
      (signal) => {
        operation.signal = signal;
        return new Promise<string>((resolve) => {
          signal.subscribe(() => resolve("cancelled"));
        });
      },
      15_000,
      parent.signal,
      () => undefined,
    );
    parent.cancel();
    expect(operation.signal!.cancelled).to.equal(true);
    expect(await pending).to.equal("cancelled");
  });

  it("releases the parent and clears the timer once the operation settles", async function () {
    const parent = createCancellationScope("parent");
    const operation = seen();
    let timedOut = 0;
    const value = await withTimeoutScope(
      async (signal) => {
        operation.signal = signal;
        return "done";
      },
      15_000,
      parent.signal,
      () => {
        timedOut += 1;
      },
    );
    expect(value).to.equal("done");
    parent.cancel();
    expect(
      operation.signal!.cancelled,
      "the parent no longer reaches a settled operation",
    ).to.equal(false);
    mock.timers.tick(15_000);
    expect(timedOut, "the timer was cleared").to.equal(0);
  });

  it("passes a rejection through", async function () {
    let caught: unknown = null;
    try {
      await withTimeoutScope(
        async () => {
          throw new Error("refused");
        },
        15_000,
        undefined,
        () => undefined,
      );
    } catch (error) {
      caught = error;
    }
    expect(String(caught)).to.include("refused");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/cancellationScope.test.ts`
Expected: FAIL. `withTimeoutScope` is not exported.

- [ ] **Step 3: Implement**

Append to `src/services/cancellationScope.ts`:

```ts
/**
 * Run `operation` under a scope that the timer, or the parent's cancel,
 * cancels. Resolves the operation's value, or null once `ms` has passed; the
 * timer cancels what it abandoned instead of leaving it retrying behind the
 * caller (B50). A rejection passes through.
 */
export async function withTimeoutScope<T>(
  operation: (signal: CancellationSignal) => Promise<T>,
  ms: number,
  parentSignal: CancellationSignal | undefined,
  onTimeout: () => void,
): Promise<T | null> {
  const scope = createCancellationScope("timeout");
  const unsubscribe = parentSignal?.subscribe(() => scope.cancel());
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      operation(scope.signal),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          timer = null;
          scope.cancel();
          onTimeout();
          resolve(null);
        }, ms);
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
    unsubscribe?.();
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/cancellationScope.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Typecheck, format, commit**

```bash
npm run typecheck
npx prettier --write src/services/cancellationScope.ts test/unit/cancellationScope.test.ts
npx eslint src/services/cancellationScope.ts test/unit/cancellationScope.test.ts
git add src/services/cancellationScope.ts test/unit/cancellationScope.test.ts
git commit -m "B50: a timeout scope that cancels the operation it abandons"
```

---

### Task 4: The refresh's pure decisions, and a provider plan that ignores the register

**Files:**

- Modify: `src/services/relationshipRefreshPolicy.ts` (append)
- Modify: `src/providers/registry.ts:39-42` (options), `:190-194` (filter)
- Modify: `test/unit/relationshipRefreshPolicy.test.ts` (imports, append)

**Interfaces:**

- Consumes: `CitationProviderID`.
- Produces (all in `relationshipRefreshPolicy.ts`):
  - `type LookupStep = "accept" | "refuse" | "search"`; `lookupStep(status: string | null): LookupStep`
  - `interface PagingProviderFacts { enabled: boolean; pagesDirection: boolean; hasOpenAlexKey: boolean }`; `isPagingProvider(providerID: CitationProviderID, facts: PagingProviderFacts): boolean`
  - `interface FillCandidateInput { ordered: readonly CitationProviderID[]; isPaging: (providerID: CitationProviderID) => boolean; supportsPaper: (providerID: CitationProviderID) => boolean; excluded: readonly CitationProviderID[] }`
  - `interface FillCandidates { candidates: CitationProviderID[]; skipped: CitationProviderID[] }`; `fillRelationshipCandidates(input: FillCandidateInput): FillCandidates`
  - `nextFillProvider(candidates: readonly CitationProviderID[], refused: readonly CitationProviderID[]): CitationProviderID | null`
  - `refusedSnapshotState(collectedCount: number): { succeeded: boolean; complete: false }`
  - `unbackedEmptyList(input: { fill: boolean; firstPageEmpty: boolean; matched: boolean; reportedCount: number | null }): boolean`
- And in `registry.ts`: `getProviderPlan(operation, preference, { offset?, ignoreHealth? })`.

- [ ] **Step 1: Write the failing test**

In `test/unit/relationshipRefreshPolicy.test.ts`, replace the import from `relationshipRefreshPolicy` with:

```ts
import {
  fillRelationshipCandidates,
  isPagingProvider,
  limitRelationshipProviders,
  lookupStep,
  nextFillProvider,
  refusedSnapshotState,
  relationshipProviderPolicyForSize,
  unbackedEmptyList,
} from "../../src/services/relationshipRefreshPolicy";
```

Append:

```ts
const S2: CitationProviderID = "semantic-scholar";
const OC: CitationProviderID = "opencitations";

describe("lookupStep", function () {
  it("refuses on a 429, accepts a match, and searches by title otherwise", function () {
    expect(lookupStep("rate-limited")).to.equal("refuse");
    expect(lookupStep("success")).to.equal("accept");
    expect(lookupStep("not-found")).to.equal("search");
    expect(lookupStep("provider-error")).to.equal("search");
    expect(lookupStep(null)).to.equal("search");
  });
});

describe("isPagingProvider", function () {
  const pages = { enabled: true, pagesDirection: true, hasOpenAlexKey: false };

  it("is not keyless OpenAlex, whose page returns nothing before asking", function () {
    expect(isPagingProvider("openalex", pages)).to.equal(false);
    expect(
      isPagingProvider("openalex", { ...pages, hasOpenAlexKey: true }),
    ).to.equal(true);
  });

  it("needs the provider enabled and able to page the direction", function () {
    expect(isPagingProvider(S2, pages)).to.equal(true);
    expect(isPagingProvider(S2, { ...pages, enabled: false })).to.equal(false);
    expect(
      isPagingProvider("crossref", { ...pages, pagesDirection: false }),
    ).to.equal(false);
  });
});

describe("fillRelationshipCandidates", function () {
  const onlyTheTwo = (provider: CitationProviderID): boolean =>
    provider === S2 || provider === OC;

  it("keeps the given order, paging providers only, minus the excluded", function () {
    expect(
      fillRelationshipCandidates({
        ordered: [OC, S2, "crossref", "openalex"],
        isPaging: onlyTheTwo,
        supportsPaper: () => true,
        excluded: [S2],
      }),
    ).to.deep.equal({ candidates: [OC], skipped: [S2] });
  });

  it("leaves a provider that cannot take the paper out of both lists", function () {
    expect(
      fillRelationshipCandidates({
        ordered: [S2, OC],
        isPaging: onlyTheTwo,
        supportsPaper: (provider) => provider !== OC,
        excluded: [OC],
      }),
    ).to.deep.equal({ candidates: [S2], skipped: [] });
  });

  it("names every excluded paging provider as skipped when none remains", function () {
    expect(
      fillRelationshipCandidates({
        ordered: [S2, "crossref", OC],
        isPaging: onlyTheTwo,
        supportsPaper: () => true,
        excluded: [OC, S2],
      }),
    ).to.deep.equal({ candidates: [], skipped: [S2, OC] });
  });
});

describe("nextFillProvider", function () {
  it("asks the first candidate this refresh has not seen refuse", function () {
    expect(nextFillProvider([S2, OC], [])).to.equal(S2);
    expect(nextFillProvider([S2, OC], [S2])).to.equal(OC);
    expect(nextFillProvider([S2, OC], [S2, OC])).to.equal(null);
  });
});

describe("refusedSnapshotState", function () {
  it("is no answer before any work was collected, a partial list after", function () {
    expect(refusedSnapshotState(0)).to.deep.equal({
      succeeded: false,
      complete: false,
    });
    expect(refusedSnapshotState(12)).to.deep.equal({
      succeeded: true,
      complete: false,
    });
  });
});

describe("unbackedEmptyList", function () {
  const empty = {
    fill: true,
    firstPageEmpty: true,
    matched: false,
    reportedCount: null,
  };

  it("fails a fill's empty first page with no match and no count behind it", function () {
    expect(unbackedEmptyList(empty)).to.equal(true);
  });

  it("trusts it with a lookup match or a reported count, and on manual paths", function () {
    expect(unbackedEmptyList({ ...empty, matched: true })).to.equal(false);
    expect(unbackedEmptyList({ ...empty, reportedCount: 12 })).to.equal(false);
    expect(unbackedEmptyList({ ...empty, fill: false })).to.equal(false);
    expect(unbackedEmptyList({ ...empty, firstPageEmpty: false })).to.equal(
      false,
    );
  });
});

describe("getProviderPlan with ignoreHealth", function () {
  it("keeps a provider the 60 s register holds back", function () {
    resetCitationProviderSessionState();
    try {
      recordProviderFailure("auto", {
        provider: S2,
        status: "rate-limited",
        message: "one request per second",
      });
      expect(getProviderPlan("citations", "auto").providers).to.not.include(S2);
      expect(
        getProviderPlan("citations", "auto", { ignoreHealth: true })
          .providers[0],
      ).to.equal(S2);
    } finally {
      resetCitationProviderSessionState();
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/relationshipRefreshPolicy.test.ts`
Expected: FAIL. The new names are not exported.

- [ ] **Step 3: Implement**

At the top of `src/services/relationshipRefreshPolicy.ts` the `CitationProviderID` type import already exists. Append:

```ts
/** What a provider lookup's status means for a relationship refresh. */
export type LookupStep = "accept" | "refuse" | "search";

/**
 * A match is used; a refusal (HTTP 429) ends the provider's part in the
 * refresh, because a title search straight after it is a second request to a
 * provider that just refused (B50); anything else may still be found by title.
 */
export function lookupStep(status: string | null): LookupStep {
  if (status === "success") return "accept";
  if (status === "rate-limited") return "refuse";
  return "search";
}

export interface PagingProviderFacts {
  enabled: boolean;
  /** The provider has the direction's fetcher (`providerPagesRelationships`). */
  pagesDirection: boolean;
  hasOpenAlexKey: boolean;
}

/**
 * A paging provider for a direction (CONTEXT.md): enabled, able to page the
 * direction, and for OpenAlex holding a key, since keyless OpenAlex returns an
 * empty page before making any request.
 */
export function isPagingProvider(
  providerID: CitationProviderID,
  facts: PagingProviderFacts,
): boolean {
  return (
    facts.enabled &&
    facts.pagesDirection &&
    (providerID !== "openalex" || facts.hasOpenAlexKey)
  );
}

export interface FillCandidateInput {
  /** The native-first order over the provider plan, register bypassed. */
  ordered: readonly CitationProviderID[];
  isPaging: (providerID: CitationProviderID) => boolean;
  supportsPaper: (providerID: CitationProviderID) => boolean;
  /** Providers sitting out a window in this fill. */
  excluded: readonly CitationProviderID[];
}

export interface FillCandidates {
  /** Who a fill expansion may ask, first first. */
  candidates: CitationProviderID[];
  /** Paging providers for the paper that a window left out. */
  skipped: CitationProviderID[];
}

/**
 * Who a fill expansion asks (ADR 0013): paging providers that can take the
 * paper, in the given order, never one sitting out a window. Only the refresh
 * knows which paging providers apply to a paper, so it reports `skipped`.
 */
export function fillRelationshipCandidates(
  input: FillCandidateInput,
): FillCandidates {
  const candidates: CitationProviderID[] = [];
  const skipped: CitationProviderID[] = [];
  for (const provider of input.ordered) {
    if (!input.isPaging(provider) || !input.supportsPaper(provider)) continue;
    if (input.excluded.includes(provider)) skipped.push(provider);
    else candidates.push(provider);
  }
  return { candidates, skipped };
}

/** The next provider a fill expansion asks: the first not yet seen refusing. */
export function nextFillProvider(
  candidates: readonly CitationProviderID[],
  refused: readonly CitationProviderID[],
): CitationProviderID | null {
  return candidates.find((provider) => !refused.includes(provider)) ?? null;
}

/**
 * A snapshot a refusal cut short. Before any work was collected it is no
 * answer at all and is never stored; after, the works already collected stand
 * as a partial list.
 */
export function refusedSnapshotState(collectedCount: number): {
  succeeded: boolean;
  complete: false;
} {
  return { succeeded: collectedCount > 0, complete: false };
}

/**
 * Whether an empty first page is a failure rather than an empty list. A fill
 * trusts an empty list only when a lookup match or a reported count stands
 * behind it: OpenCitations answers 200 with `[]` for a DOI it does not index,
 * and its lookup no longer matches at all (410 Gone, B63), so its DOI fallback
 * would otherwise store "no citers" for every paper it has never seen.
 * Manual paths keep today's rule.
 */
export function unbackedEmptyList(input: {
  fill: boolean;
  firstPageEmpty: boolean;
  matched: boolean;
  reportedCount: number | null;
}): boolean {
  return (
    input.fill &&
    input.firstPageEmpty &&
    !input.matched &&
    input.reportedCount === null
  );
}
```

In `src/providers/registry.ts`, `ProviderPlanOptions` becomes:

```ts
interface ProviderPlanOptions {
  /** Relationship pages after the first require a true paginated endpoint. */
  offset?: number;
  /**
   * Bypass the 60 s health register. The hop fill keeps its own per-provider
   * windows (ADR 0013), so the rail can always name who is refusing.
   */
  ignoreHealth?: boolean;
}
```

and the automatic filter becomes:

```ts
const providers = AUTOMATIC_PROVIDER_ORDERS[operation].filter(
  (providerID) =>
    (options.ignoreHealth === true ||
      automaticProviderIsAvailable(providerID)) &&
    providerSupportsOperation(PROVIDERS[providerID], operation, offset),
);
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/relationshipRefreshPolicy.test.ts`
Expected: PASS (the file's 9 existing tests plus 11 new).

- [ ] **Step 5: Typecheck, format, commit**

```bash
npm run typecheck
npx prettier --write src/services/relationshipRefreshPolicy.ts src/providers/registry.ts test/unit/relationshipRefreshPolicy.test.ts
npx eslint src/services/relationshipRefreshPolicy.ts src/providers/registry.ts test/unit/relationshipRefreshPolicy.test.ts
git add src/services/relationshipRefreshPolicy.ts src/providers/registry.ts test/unit/relationshipRefreshPolicy.test.ts
git commit -m "B50: the refresh's pure decisions for refusals and fill candidates"
```

---

### Task 5: The Zotero case, red

**Files:**

- Modify: `test/zotero/graphCitationHops.test.ts`: constants after `:29`; a nested `describe` before the outer block's closing `});` at `:1149`

**Interfaces:**

- Consumes, all from the outer block's closure: `openNewGraphTab`, `dismissGallery`, `graphRoot`, `tabContent`, `nodeMenuEntry`, `progressText`, `hopRowText`, `hopCounts`, `traceUntil`, `normalize`, `waitFor`, `delay`, and the `win` and `currentTabID` variables.
- Produces: the case "keeps the seed in the plan while every provider refuses, and fills once they answer". It reads these DOM hooks that later tasks add:
  - `.cm-scope-hop-progress` (exists);
  - `.cm-scope-hop-countdown` (Task 11);
  - `.cm-scope-hop-action` (exists).

- [ ] **Step 1: Write the case**

After `const BOTH_NOTICE = ...;` add:

```ts
/**
 * B50's paper: one the fill has never expanded, whose DOI OpenCitations
 * indexes with citers (32 on 2026-09-15), so once the providers answer again
 * hop 1 fills from whichever answers first.
 */
const REFUSAL_TITLE = "Stage 3 refusal fixture";
const REFUSAL_DOI = "10.1371/journal.pone.0043136";
/** Every provider a fill may ask. The wrapper answers these with HTTP 429. */
const REFUSED_URL =
  /^https:\/\/(api\.semanticscholar\.org|opencitations\.net|api\.opencitations\.net|api\.openalex\.org)\//;
```

Before the outer `describe`'s final `});`, add:

```ts
/**
 * B50: a refusal is not a failure. Every provider the fill can ask answers
 * HTTP 429 at once, through a wrapper on `Zotero.HTTP.request`, which
 * `requestJSON` reads at call time. The seed must stay in the plan, the
 * line must count down in place, Stop must pause it, and once the providers
 * answer again Resume must fill hop 1 straight away.
 *
 * Its own tab and its own paper: the paper above is expanded already, and a
 * fill never asks for a stored list again.
 */
describe("under provider refusals (B50)", function () {
  let refusalTabID: string | null = null;
  let refusalItemID: number | null = null;
  let realRequest: any = null;

  function refuseProviders(): void {
    if (realRequest) return;
    realRequest = Zotero.HTTP.request;
    (Zotero.HTTP as any).request = async (
      method: string,
      url: string,
      options?: unknown,
    ) =>
      REFUSED_URL.test(url)
        ? { status: 429, responseText: "", getResponseHeader: () => null }
        : realRequest.call(Zotero.HTTP, method, url, options);
  }

  function answerAgain(): void {
    if (!realRequest) return;
    (Zotero.HTTP as any).request = realRequest;
    realRequest = null;
  }

  function countdownText(): string {
    return normalize(
      graphRoot().querySelector(".cm-scope-hop-countdown")?.textContent,
    );
  }

  before(async function () {
    this.timeout(90_000);
    const item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField("title", REFUSAL_TITLE);
    item.setField("date", "2012");
    item.setField("DOI", REFUSAL_DOI);
    refusalItemID = await item.saveTx();

    refusalTabID = await openNewGraphTab();
    currentTabID = refusalTabID;
    win.Zotero_Tabs.select(refusalTabID);
    const rail = await waitFor(
      () =>
        tabContent(refusalTabID)?.querySelector(
          ".cm-scope-section .cm-scope-count",
        ),
      30_000,
    );
    expect(rail, "the refusal tab's Scope section").to.exist;
    await dismissGallery(refusalTabID);
    const fit = await waitFor(
      () =>
        graphRoot().querySelector(
          '.cm-zoom-controls button[data-action="fit"]',
        ) as HTMLButtonElement | null,
      10_000,
    );
    expect(fit, "the refusal tab's fit button").to.exist;
    fit!.click();
    await waitFor(() => {
      const canvas = graphRoot().querySelector("canvas");
      return canvas ? canvas.getBoundingClientRect().width > 10 : false;
    }, 10_000);
  });

  after(async function () {
    this.timeout(30_000);
    let failure: unknown = null;
    const record = (error: unknown): void => {
      if (failure === null) failure = error;
    };
    try {
      answerAgain();
    } catch (error) {
      record(error);
    }
    try {
      if (refusalTabID) win.Zotero_Tabs.close(refusalTabID);
      await delay(500);
    } catch (error) {
      record(error);
    }
    refusalTabID = null;
    currentTabID = null;
    try {
      if (refusalItemID !== null) await Zotero.Items.erase(refusalItemID);
      refusalItemID = null;
    } catch (error) {
      record(error);
    }
    if (failure !== null) throw failure;
  });

  it("keeps the seed in the plan while every provider refuses, and fills once they answer", async function () {
    this.timeout(180_000);
    refuseProviders();
    try {
      (await nodeMenuEntry("Add as seed", REFUSAL_TITLE)).click();

      // 1. The refusal line, counting down in place.
      const line = await waitFor(
        () =>
          /refusing · retry in \d+ (s|min)/.test(progressText())
            ? graphRoot().querySelector(".cm-scope-hop-progress")
            : null,
        60_000,
      );
      expect(
        line,
        `the line never read "refusing"; it read "${progressText()}"; ` +
          `hop 1 "${hopRowText(1)}"; recent Zotero errors: ${
            (Zotero.getErrors(true) as string[]).slice(-3).join(" || ") ||
            "none"
          }`,
      ).to.exist;
      const first = countdownText();
      const ticked = await waitFor(
        () => (countdownText() !== first ? countdownText() : null),
        5_000,
      );
      expect(ticked, `the countdown stayed at "${first}"`).to.exist;
      expect(
        graphRoot().querySelector(".cm-scope-hop-progress") === line,
        `the line was rebuilt while counting down; it reads "${progressText()}"`,
      ).to.equal(true);

      // 2. Stop pauses it: the refused seed is still one paper left.
      const stop = line!.querySelector(
        ".cm-scope-hop-action",
      ) as HTMLButtonElement | null;
      expect(normalize(stop?.textContent), "the line's action").to.equal(
        "Stop",
      );
      stop!.click();
      const paused = await waitFor(
        () => (/1 left · Resume$/.test(progressText()) ? progressText() : null),
        10_000,
      );
      expect(paused, `after Stop the line read "${progressText()}"`).to.exist;

      // 3. The providers answer again; Resume fills hop 1 at once.
      answerAgain();
      const resume = graphRoot().querySelector(
        ".cm-scope-hop-progress .cm-scope-hop-action",
      ) as HTMLButtonElement | null;
      expect(normalize(resume?.textContent), "the paused action").to.equal(
        "Resume",
      );
      resume!.click();
      const trace = await traceUntil(
        () => (hopCounts(1)?.available ?? 0) > 0,
        60_000,
      );
      expect(
        hopCounts(1)?.available ?? 0,
        `hop 1 never filled after Resume; trace: ${trace}`,
      ).to.be.greaterThan(0);
    } finally {
      answerAgain();
    }
  });
});
```

- [ ] **Step 2: Typecheck the suite**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Run the Zotero suite and record the red**

Run in the background: `npm test`, then wait for the task to exit.
Expected: the new case FAILS with `the line never read "refusing"`. Today the refusal is retried until the 15 s timeout, the seed is failed, and the line disappears.

- Note in the commit message the message the case printed, and the run's pass/fail counts.
- The three live hop-fill cases may also fail on Semantic Scholar's keyless 429s. That is the provider (roadmap B50), not this change.

- [ ] **Step 4: Format, commit**

```bash
npx prettier --write test/zotero/graphCitationHops.test.ts
npx eslint test/zotero/graphCitationHops.test.ts
git add test/zotero/graphCitationHops.test.ts
git commit -m "B50: Zotero case for a fill under provider refusals (red)"
```

---

### Task 6: The relationship refresh tells a refusal from a failure

**Files:**

- Modify: `src/providers/relationshipPolicy.ts:53-59`
- Modify: `src/services/externalDiscoveryService.ts`:
  - imports `:11`, `:29`, `:78-89`, `:105-109`;
  - snapshot literal `:534-540`;
  - `lookupProviderRecord` `:1174-1196`, `withProviderTimeout` `:1198-1219`, `fetchProviderRelationshipSnapshot` `:1221-1407`;
  - interfaces `:1457-1485`, `relationshipProviders` `:1513-1546`;
  - `runExternalRelationshipRefresh` `:1655-1822`.
- Modify: `test/unit/architecture.test.ts`: the three snapshot literals carrying `succeeded: true,` (`:860`, `:867`, `:1058`)

**Interfaces:**

- Consumes: Tasks 1–4.
- Produces:
  - `RelationshipProviderSnapshot.refused: boolean`
  - `ExternalRelationshipRefreshOptions.retryRefusals?: boolean`, `.excludeProviders?: readonly CitationProviderID[]`
  - `RelationshipRefreshResolution.refusedBy: CitationProviderID[]`, `.skipped: CitationProviderID[]`, `.answeredBy: CitationProviderID | null`
  - `export function hopFillPagingProviders(direction: "references" | "cited-by"): CitationProviderID[]`

This wiring touches Zotero-coupled code that the unit suite cannot load in a useful state. Its tests are the pure decisions of Task 4 and the Zotero case of Task 5, which goes green in Task 11.

- [ ] **Step 1: The snapshot says it was refused**

In `src/providers/relationshipPolicy.ts`:

```ts
export interface RelationshipProviderSnapshot {
  provider: CitationProviderID;
  works: RelatedWorkMetadata[];
  reportedCount: number | null;
  complete: boolean;
  succeeded: boolean;
  /**
   * The provider answered HTTP 429 during this snapshot. With no works
   * collected it is never usable, so never stored (ADR 0013).
   */
  refused: boolean;
}
```

In `test/unit/architecture.test.ts`, add `refused: false,` after each of the three `succeeded: true,` lines. In `externalDiscoveryService.ts`, do the same after `succeeded: true,` in the literal passed to `prepareRelationshipSnapshots` near `:539`.

- [ ] **Step 2: Imports**

In `src/services/externalDiscoveryService.ts`:

- `import type { ProviderRequestOptions } from "../providers/types";` becomes `import { ProviderRefusedError, type ProviderRequestOptions } from "../providers/types";`
- `import { getEnabledProviders, isProviderEnabled } from "./citationPreferences";` becomes `import { getEnabledProviders, getOpenAlexAPIKey, isProviderEnabled } from "./citationPreferences";`
- The `./relationshipRefreshPolicy` import gains `fillRelationshipCandidates`, `isPagingProvider`, `lookupStep`, `nextFillProvider`, `refusedSnapshotState`, `unbackedEmptyList`.
- The `./cancellationScope` import gains `withTimeoutScope`.

- [ ] **Step 3: The lookup and the timeout**

Replace `lookupProviderRecord` and `withProviderTimeout` with:

```ts
async function lookupProviderRecord(
  providerID: CitationProviderID,
  identifiers: WorkIdentifiers,
  requestOptions?: ProviderRequestOptions,
) {
  const provider = getCitationProvider(providerID);
  const lookup = provider.lookupForRelations ?? provider.lookup;
  let match = provider.supports(identifiers)
    ? await lookup(identifiers, requestOptions)
    : null;
  // A refusal is not "no match": a title search straight after it is a
  // second request to a provider that just refused (B50).
  const step = lookupStep(match?.status ?? null);
  if (step === "refuse") throw new ProviderRefusedError(providerID);
  if (
    step === "search" &&
    provider.searchExactTitle &&
    identifiers.normalizedTitle
  ) {
    match = await provider.searchExactTitle(identifiers, requestOptions);
    if (lookupStep(match.status) === "refuse") {
      throw new ProviderRefusedError(providerID);
    }
  }
  return match?.status === "success" &&
    matchWorkIdentifiers(identifiers, relatedWorkFromProviderLookup(match))
      .decision === "same-work"
    ? match
    : null;
}

/**
 * Race one provider request against the relationship timeout. The request
 * runs under a scope the timeout cancels, so a request the refresh gave up on
 * stops instead of retrying behind it. A timeout stays a failure, not a
 * refusal.
 */
async function withProviderTimeout<T>(
  providerID: CitationProviderID,
  direction: "references" | "cited-by",
  requestOptions: ProviderRequestOptions | undefined,
  operation: (options: ProviderRequestOptions) => Promise<T>,
): Promise<T | null> {
  return withTimeoutScope(
    (signal) => operation({ ...requestOptions, signal }),
    RELATIONSHIP_PROVIDER_TIMEOUT_MS,
    requestOptions?.signal,
    () =>
      Zotero.debug(`Meristema: ${providerID} ${direction} lookup timed out`),
  );
}
```

- [ ] **Step 4: The snapshot**

Replace `fetchProviderRelationshipSnapshot` with:

```ts
async function fetchProviderRelationshipSnapshot(
  providerID: CitationProviderID,
  node: CitationGraphNode,
  direction: "references" | "cited-by",
  maximum: number,
  providerWorkIDs: ProviderIdentityHints = {},
  requestOptions?: ProviderRequestOptions,
): Promise<RelationshipProviderSnapshot> {
  const failed = (): RelationshipProviderSnapshot => ({
    provider: providerID,
    works: [],
    reportedCount: null,
    complete: false,
    succeeded: false,
    refused: false,
  });
  // Outside the `try`, so a refusal part-way can still hand back what was
  // collected before it (B50).
  let knownReportedCount: number | null = null;
  const collectedWorks: RelatedWorkMetadata[] = [];
  try {
    const checkpoint = createCooperativeCheckpoint();
    const identifiers = workIdentifiersForGraphNode(node);
    const provider = getCitationProvider(providerID);
    const nativeFetcher =
      direction === "references"
        ? provider.fetchReferencedWorks
        : provider.fetchCitingWorks;
    const hasSummaryFetcher =
      providerID === "semantic-scholar" || providerID === "openalex";
    const fetcher = hasSummaryFetcher
      ? (
          id: string,
          requested: number,
          offset: number,
          options?: ProviderRequestOptions,
        ) =>
          fetchRelatedWorkSummaryPage(
            providerID,
            id,
            direction,
            requested,
            offset,
            options,
          )
      : nativeFetcher;
    const hintedProviderWorkID =
      providerWorkIDs[providerID] ??
      (providerID === node.provider ? node.providerWorkID : null) ??
      null;
    const match = hintedProviderWorkID
      ? null
      : await withProviderTimeout(
          providerID,
          direction,
          requestOptions,
          (options) => lookupProviderRecord(providerID, identifiers, options),
        );
    const reportedCount =
      direction === "references"
        ? (match?.referenceCount ??
          (providerID === node.referenceCountProvider
            ? node.referenceCount
            : null))
        : (match?.citationCount ??
          (providerID === node.citationCountProvider
            ? node.citationCount
            : null));
    knownReportedCount = reportedCount;
    let works =
      direction === "references" && match?.references?.length
        ? mergeRelatedWorkLists(
            stampProviderWorks(match.references, providerID),
          )
        : [];

    if (reportedCount === 0) {
      return {
        provider: providerID,
        works: [],
        reportedCount: 0,
        complete: true,
        succeeded: Boolean(match) || Boolean(fetcher),
        refused: false,
      };
    }

    if (!fetcher) {
      return {
        provider: providerID,
        works,
        reportedCount,
        complete:
          Boolean(match) &&
          (reportedCount === null || works.length >= reportedCount),
        succeeded: Boolean(match),
        refused: false,
      };
    }

    const providerWorkID =
      hintedProviderWorkID ??
      match?.providerWorkID ??
      (providerID === "opencitations" ? normalizeDOI(node.doi) : null);
    if (!providerWorkID) return failed();

    const boundedMaximum = Number.isFinite(maximum)
      ? Math.max(0, maximum)
      : Number.POSITIVE_INFINITY;
    const target =
      reportedCount === null
        ? boundedMaximum
        : Math.min(boundedMaximum, Math.max(0, reportedCount));
    const pageSize = providerExecutionPolicy(providerID).relationshipPageSize;
    const maximumPages = Number.isFinite(target)
      ? Math.min(
          RELATIONSHIP_ABSOLUTE_MAX_PAGES,
          Math.max(RELATIONSHIP_MAX_PAGES, Math.ceil(target / pageSize) + 1),
        )
      : RELATIONSHIP_ABSOLUTE_MAX_PAGES;
    collectedWorks.push(...works);
    const collectedIdentities = new Set(
      collectedWorks.map((work) => externalWorkLookupIdentity(work)),
    );
    let offset = works.length;
    let pages = 0;
    let endpointExhausted = false;
    let previousSignature: string | null = null;
    while (
      (offset < target || !Number.isFinite(target)) &&
      pages < maximumPages
    ) {
      const requested = Number.isFinite(target)
        ? Math.min(pageSize, Math.max(1, target - offset))
        : pageSize;
      const pageOffset = offset;
      const pageResult = await withProviderTimeout(
        providerID,
        direction,
        requestOptions,
        (options) => fetcher(providerWorkID, requested, pageOffset, options),
      );
      if (!Array.isArray(pageResult)) return failed();
      const page = pageResult;
      pages += 1;
      if (!page.length) {
        if (
          unbackedEmptyList({
            fill: requestOptions?.retryRefusals === false,
            firstPageEmpty: pages === 1 && collectedWorks.length === 0,
            matched: Boolean(match),
            reportedCount,
          })
        ) {
          return failed();
        }
        endpointExhausted = true;
        break;
      }
      const stamped = stampProviderWorks(page, providerID);
      const pageIdentities = stamped.map((work) =>
        externalWorkLookupIdentity(work),
      );
      const signature = pageIdentities.join("|");
      if (signature === previousSignature) {
        break;
      }
      previousSignature = signature;
      collectedWorks.push(...stamped);
      for (const identity of pageIdentities) collectedIdentities.add(identity);
      offset += page.length;
      // Keep page retrieval append-only. Re-merging the complete accumulated
      // list after every page makes large bibliographies increasingly
      // expensive and can monopolize Zotero's main thread. Canonicalize once
      // after the endpoint has finished instead.
      await checkpoint(true);
      if (page.length < requested) {
        endpointExhausted = true;
        break;
      }
      if (reportedCount !== null && collectedIdentities.size >= reportedCount) {
        break;
      }
    }

    await checkpoint(true);
    works = mergeRelatedWorkLists(collectedWorks);
    await checkpoint(true);

    const reachedReportedCount =
      reportedCount !== null && works.length >= reportedCount;
    const complete =
      reportedCount !== null ? reachedReportedCount : endpointExhausted;
    return {
      provider: providerID,
      works,
      reportedCount,
      complete:
        complete &&
        (reportedCount === null ||
          !Number.isFinite(boundedMaximum) ||
          reportedCount <= boundedMaximum),
      succeeded: true,
      refused: false,
    };
  } catch (error) {
    if (error instanceof ProviderRefusedError) {
      const state = refusedSnapshotState(collectedWorks.length);
      return {
        provider: providerID,
        works: state.succeeded ? mergeRelatedWorkLists(collectedWorks) : [],
        reportedCount: knownReportedCount,
        complete: state.complete,
        succeeded: state.succeeded,
        refused: true,
      };
    }
    Zotero.debug(
      `Meristema: ${providerID} ${direction} lookup failed: ${String(error)}`,
    );
    return failed();
  }
}
```

- [ ] **Step 5: Options, resolution, providers**

Add to `RelationshipRefreshResolution`:

```ts
  /** Providers whose snapshot in this refresh was refused (HTTP 429), in the order asked. */
  refusedBy: CitationProviderID[];
  /** Paging providers for the paper that `excludeProviders` left out. */
  skipped: CitationProviderID[];
  /** The one provider whose snapshot was stored; null when none was, or several were merged. */
  answeredBy: CitationProviderID | null;
```

Add to `ExternalRelationshipRefreshOptions`, after `providerLimit`:

```ts
  /**
   * False for the hop fill (ADR 0013): a 429 is not retried, a refused
   * provider moves the expansion to the next paging provider, and an empty
   * first page needs a lookup match or a reported count behind it.
   */
  retryRefusals?: boolean;
  /** Providers sitting out a window in the fill; never asked (ADR 0013). */
  excludeProviders?: readonly CitationProviderID[];
```

Replace `relationshipProviders` with:

```ts
function orderedRelationshipProviders(
  node: CitationGraphNode,
  direction: "references" | "cited-by",
  strategy: RelationshipProviderStrategy,
  ignoreHealth: boolean,
): CitationProviderID[] {
  const plan = getProviderPlan(
    direction === "references" ? "references" : "citations",
    "auto",
    { ignoreHealth },
  );
  const enabledProviderSet = new Set(getEnabledProviders());
  const enabledProviders = plan.providers.filter((provider) =>
    enabledProviderSet.has(provider),
  );
  const countProvider =
    direction === "references"
      ? node.referenceCountProvider
      : node.citationCountProvider;
  return orderRelationshipProviders(
    enabledProviders,
    preferredRelationshipProviders(
      direction,
      enabledProviders,
      node.provider,
      countProvider,
      Boolean(normalizeDOI(node.doi)),
    ),
    strategy,
    Number.POSITIVE_INFINITY,
  );
}

/** A paging provider for the direction (CONTEXT.md), read from settings now. */
function pagingProviderTest(
  direction: "references" | "cited-by",
): (providerID: CitationProviderID) => boolean {
  const enabled = new Set(getEnabledProviders());
  const hasOpenAlexKey = Boolean(getOpenAlexAPIKey());
  return (providerID) =>
    isPagingProvider(providerID, {
      enabled: enabled.has(providerID),
      pagesDirection: providerPagesRelationships(providerID, direction),
      hasOpenAlexKey,
    });
}

function relationshipProviders(
  node: CitationGraphNode,
  direction: "references" | "cited-by",
  strategy: RelationshipProviderStrategy,
  maximum: number,
): CitationProviderID[] {
  return limitRelationshipProviders(
    orderedRelationshipProviders(node, direction, strategy, false),
    maximum,
    pagingProviderTest(direction),
  );
}

/**
 * The providers a hop fill can page the direction with, in the provider
 * plan's order, register bypassed. The runner cools down when every one of
 * them is sitting out a window, and the rail names them in this order.
 */
export function hopFillPagingProviders(
  direction: "references" | "cited-by",
): CitationProviderID[] {
  const isPaging = pagingProviderTest(direction);
  return getProviderPlan(
    direction === "references" ? "references" : "citations",
    "auto",
    { ignoreHealth: true },
  ).providers.filter(isPaging);
}

/**
 * Whether a provider can be asked for this paper's list at all: it takes one
 * of the paper's identifiers, holds a work ID for it, or can search its title.
 */
function providerSupportsPaper(
  providerID: CitationProviderID,
  node: CitationGraphNode,
  providerWorkIDs: ProviderIdentityHints,
): boolean {
  const provider = getCitationProvider(providerID);
  const identifiers = workIdentifiersForGraphNode(node);
  return (
    provider.supports(identifiers) ||
    Boolean(providerWorkIDs[providerID]) ||
    (providerID === node.provider && Boolean(node.providerWorkID?.trim())) ||
    Boolean(provider.searchExactTitle && identifiers.normalizedTitle)
  );
}

/**
 * A fill expansion's candidates, asked one at a time until one does not
 * refuse (ADR 0013). A refused snapshot moves the expansion straight on; the
 * first answer or failure ends it.
 */
async function askUntilNotRefused(
  candidates: readonly CitationProviderID[],
  ask: (provider: CitationProviderID) => Promise<RelationshipProviderSnapshot>,
  cancelled: () => boolean,
): Promise<RelationshipProviderSnapshot[]> {
  const results: RelationshipProviderSnapshot[] = [];
  const refused: CitationProviderID[] = [];
  for (
    let provider = nextFillProvider(candidates, refused);
    provider !== null;
    provider = nextFillProvider(candidates, refused)
  ) {
    if (cancelled()) break;
    const snapshot = await ask(provider);
    results.push(snapshot);
    if (!snapshot.refused) break;
    refused.push(provider);
  }
  return results;
}
```

- [ ] **Step 6: The refresh**

In `runExternalRelationshipRefresh`:

(a) Both early `onMembershipResolved` calls (the cached-membership return and the no-stable-identifier return) gain three fields after `identifiedCount`:

```ts
        refusedBy: [],
        skipped: [],
        answeredBy: null,
```

(b) Immediately before `refreshStarted = true;`, insert:

```ts
// A fill expansion asks paging providers only, one at a time, and never
// one sitting out a window (ADR 0013). When the windows leave nobody to
// ask, nothing is requested and nothing is published.
const fillCandidates =
  options.retryRefusals === false
    ? fillRelationshipCandidates({
        ordered: orderedRelationshipProviders(
          node,
          direction,
          "native-first",
          true,
        ),
        isPaging: pagingProviderTest(direction),
        supportsPaper: (provider) =>
          providerSupportsPaper(provider, node, options.providerWorkIDs ?? {}),
        excluded: options.excludeProviders ?? [],
      })
    : null;
if (fillCandidates && !fillCandidates.candidates.length) {
  const output = existingResult();
  options.onMembershipResolved?.({
    complete: false,
    provider: null,
    reportedCount: null,
    identifiedCount: output.length,
    refusedBy: [],
    skipped: fillCandidates.skipped,
    answeredBy: null,
  });
  return output;
}
```

(c) Replace `const providers = relationshipProviders(...)` with:

```ts
const providers =
  fillCandidates?.candidates ??
  relationshipProviders(
    node,
    direction,
    policy.providerStrategy,
    policy.providerLimit,
  );
```

(d) Keep `const providerParallelism = ...` as it is. Replace from `const results = await mapBounded(` through the `if (cancelled()) return existingResult();` that follows it with:

```ts
const results = fillCandidates
  ? await askUntilNotRefused(
      fillCandidates.candidates,
      (provider) =>
        fetchProviderRelationshipSnapshot(
          provider,
          node,
          direction,
          maximum,
          options.providerWorkIDs,
          { signal: options.signal, retryRefusals: false },
        ),
      cancelled,
    )
  : await mapBounded(
      providers,
      providerParallelism,
      async (provider): Promise<RelationshipProviderSnapshot> => {
        if (cancelled()) {
          return {
            provider,
            works: [],
            reportedCount: null,
            complete: false,
            succeeded: false,
            refused: false,
          };
        }
        return fetchProviderRelationshipSnapshot(
          provider,
          node,
          direction,
          maximum,
          options.providerWorkIDs,
          { signal: options.signal },
        );
      },
      {
        yieldAfterEach: true,
        yieldDelayMs: mode === "automatic" ? 12 : 4,
      },
    );
if (cancelled()) return existingResult();
const refusedBy = results
  .filter((snapshot) => snapshot.refused)
  .map((snapshot) => snapshot.provider);
const skipped = fillCandidates?.skipped ?? [];
```

(e) In the `if (!usable.length)` block's `onMembershipResolved`, add after `identifiedCount: output.length,`:

```ts
        refusedBy,
        skipped,
        answeredBy: null,
```

(f) In the `onMembershipResolved` after `membership-published`, add after `identifiedCount: committed.length,`:

```ts
      refusedBy,
      skipped,
      answeredBy: usable.length === 1 ? usable[0].provider : null,
```

The `usable` filter needs no change: a refused snapshot with nothing collected has `succeeded: false`, so it is never usable and never stored.

- [ ] **Step 7: Typecheck and the whole unit suite**

Run: `npm run typecheck && npm run test:unit`
Expected: clean; 590 passing (575, plus 4 from Task 3 and 11 from Task 4).

- [ ] **Step 8: Format, commit**

```bash
npx prettier --write src/providers/relationshipPolicy.ts src/services/externalDiscoveryService.ts test/unit/architecture.test.ts
npx eslint src/providers/relationshipPolicy.ts src/services/externalDiscoveryService.ts test/unit/architecture.test.ts
git add src/providers/relationshipPolicy.ts src/services/externalDiscoveryService.ts test/unit/architecture.test.ts
git commit -m "B50: the relationship refresh tells a refusal from a failure and switches provider in a fill"
```

---

### Task 7: Landings and provider windows, pure

**Files:**

- Modify: `src/services/graphHopRunnerModel.ts`: imports `:15`, `:17-72` (landing), new exports after `hopRejectionEffects`
- Modify: `src/services/graphHopFillRunner.ts:176-181` (pass `refused: false` until Task 9)
- Modify: `test/unit/graphHopRunnerModel.test.ts`

**Interfaces:**

- Consumes: `CitationProviderID`.
- Produces (all in `graphHopRunnerModel.ts`):
  - `HopLandingInput.refused: boolean`; `HopLandingEffects.defer: boolean`
  - `interface HopExpandOutcome { refusedBy: readonly CitationProviderID[]; skipped: readonly CitationProviderID[]; answeredBy: CitationProviderID | null }`; `const NO_OUTCOME: HopExpandOutcome`; `outcomeRefused(outcome: HopExpandOutcome): boolean`
  - `const COOL_DOWN_MS: readonly number[]`; `interface ProviderWindow { step: number; endsAt: number }`; `type ProviderWindows = ReadonlyMap<CitationProviderID, ProviderWindow>`
  - `refuse(windows, provider, now): ProviderWindows`; `answer(windows, provider): ProviderWindows`; `excluded(windows, now): CitationProviderID[]`; `endAll(windows, now): ProviderWindows`; `deferUntil(windows, providers, now): number | null`
  - `interface HopCoolDownInput { windows: ProviderWindows; now: number; pagingProviders: readonly CitationProviderID[]; orderLength: number; deferralEnds: readonly number[] }`; `hopCoolDown(input: HopCoolDownInput): number | null`

- [ ] **Step 1: Write the failing test**

In `test/unit/graphHopRunnerModel.test.ts`:

1. Replace the `graphHopRunnerModel` import with:

```ts
import type { CitationProviderID } from "../../src/domain/citationTypes";
import {
  COOL_DOWN_MS,
  answer,
  deferUntil,
  endAll,
  excluded,
  hopCoolDown,
  hopLandingEffects,
  hopRejectionEffects,
  outcomeRefused,
  planHopExploreChange,
  refuse,
  type ProviderWindows,
} from "../../src/services/graphHopRunnerModel";
```

2. Every existing `hopLandingEffects({ ... })` input gains `refused: false,`. Every expected effects object gains `defer: false,`. The key list in "has no output that touches the Refresh button" becomes `["applyToModel", "countExpanded", "defer", "markFailed"]`.

3. Append:

```ts
const S2: CitationProviderID = "semantic-scholar";
const OC: CitationProviderID = "opencitations";

describe("a refused landing", function () {
  it("defers the paper: not counted, not failed, nothing applied", function () {
    expect(
      hopLandingEffects({
        epoch: 1,
        currentEpoch: 1,
        cleaned: false,
        stored: false,
        refused: true,
      }),
    ).to.deep.equal({
      countExpanded: false,
      markFailed: false,
      defer: true,
      applyToModel: false,
    });
  });

  it("lets a stored list win over a refusal on the way", function () {
    expect(
      hopLandingEffects({
        epoch: 1,
        currentEpoch: 1,
        cleaned: false,
        stored: true,
        refused: true,
      }),
    ).to.include({ countExpanded: true, defer: false });
  });

  it("reads one refused and the next failed as refused, not failed", function () {
    const outcome = { refusedBy: [S2], skipped: [], answeredBy: null };
    expect(outcomeRefused(outcome)).to.equal(true);
    expect(
      outcomeRefused({ refusedBy: [], skipped: [OC], answeredBy: null }),
      "a provider sitting out a window",
    ).to.equal(true);
    expect(
      outcomeRefused({ refusedBy: [], skipped: [], answeredBy: null }),
    ).to.equal(false);
  });
});

describe("provider windows", function () {
  it("wait 30 s, 1 min, 2 min, then every 5 min", function () {
    let windows: ProviderWindows = new Map();
    let now = 0;
    const delays: number[] = [];
    for (let refusal = 0; refusal < 5; refusal += 1) {
      windows = refuse(windows, S2, now);
      const endsAt = windows.get(S2)!.endsAt;
      delays.push(endsAt - now);
      now = endsAt;
    }
    expect(delays).to.deep.equal([30_000, 60_000, 120_000, 300_000, 300_000]);
    expect(COOL_DOWN_MS).to.deep.equal([30_000, 60_000, 120_000, 300_000]);
  });

  it("start over after an answer", function () {
    let windows = refuse(refuse(new Map(), S2, 0), S2, 30_000);
    windows = answer(windows, S2);
    expect(excluded(windows, 30_000)).to.deep.equal([]);
    windows = refuse(windows, S2, 100_000);
    expect(windows.get(S2)!.endsAt).to.equal(130_000);
  });

  it("end together on Resume, each keeping its step", function () {
    let windows = refuse(refuse(new Map(), S2, 0), OC, 0);
    windows = endAll(windows, 5_000);
    expect(excluded(windows, 5_000)).to.deep.equal([]);
    windows = refuse(windows, S2, 5_000);
    expect(windows.get(S2)!.endsAt, "the second refusal waits 1 min").to.equal(
      65_000,
    );
  });

  it("exclude only the providers whose window is still running", function () {
    const windows = refuse(refuse(refuse(new Map(), S2, 0), OC, 0), OC, 30_000);
    expect(excluded(windows, 0)).to.deep.equal([S2, OC]);
    expect(excluded(windows, 30_000)).to.deep.equal([OC]);
    expect(excluded(windows, 90_000)).to.deep.equal([]);
  });

  it("defer a paper until the earliest of its providers' windows ends", function () {
    const windows = refuse(refuse(refuse(new Map(), S2, 0), OC, 0), OC, 0);
    // S2 ends at 30 s; OC, refused twice at 0, ends at 1 min.
    expect(deferUntil(windows, [S2, OC], 0)).to.equal(30_000);
    expect(deferUntil(windows, [S2, OC], 45_000)).to.equal(60_000);
    expect(deferUntil(windows, [S2, OC], 60_000)).to.equal(null);
    expect(deferUntil(windows, ["openalex"], 0)).to.equal(null);
  });
});

describe("hopCoolDown", function () {
  const windows = refuse(refuse(new Map(), S2, 0), OC, 1_000);

  it("waits for the earliest window when every paging provider is in one, however many papers wait", function () {
    expect(
      hopCoolDown({
        windows,
        now: 2_000,
        pagingProviders: [S2, OC],
        orderLength: 5,
        deferralEnds: [],
      }),
    ).to.equal(30_000);
  });

  it("expands while one paging provider is free and a paper is planned", function () {
    expect(
      hopCoolDown({
        windows,
        now: 2_000,
        pagingProviders: [S2, OC, "openalex"],
        orderLength: 1,
        deferralEnds: [30_000],
      }),
    ).to.equal(null);
  });

  it("waits for the earliest deferral when every paper left is deferred", function () {
    expect(
      hopCoolDown({
        windows: new Map(),
        now: 0,
        pagingProviders: [S2, OC],
        orderLength: 0,
        deferralEnds: [45_000, 31_000],
      }),
    ).to.equal(31_000);
  });

  it("does not wait on nothing", function () {
    expect(
      hopCoolDown({
        windows: new Map(),
        now: 0,
        pagingProviders: [],
        orderLength: 0,
        deferralEnds: [],
      }),
    ).to.equal(null);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/graphHopRunnerModel.test.ts`
Expected: FAIL. The new names are not exported.

- [ ] **Step 3: Implement**

In `src/services/graphHopRunnerModel.ts`, add `import type { CitationProviderID } from "../domain/citationTypes";` above the `graphHopModel` import. Replace everything from `export interface HopLandingInput` through the end of `hopLandingEffects` with:

```ts
export interface HopLandingInput {
  /** The epoch `expandHopPaper` was started under. */
  epoch: number;
  /** The runner's epoch now: a direction change or a seed change bumps it. */
  currentEpoch: number;
  /** The view has been torn down. */
  cleaned: boolean;
  /**
   * A stored summary exists for this paper in this direction now
   * (`getStoredRelationshipSummary`). A stored empty list counts; the works
   * count does not decide it (spec, "Vocabulary").
   */
  stored: boolean;
  /**
   * At least one provider refused (HTTP 429) or was sitting out a window
   * (`outcomeRefused`). Read only when nothing was stored.
   */
  refused: boolean;
}

export interface HopLandingEffects {
  /** Count one expansion at the paper's hop against this direction's cap. */
  countExpanded: boolean;
  /** Add the paper to this direction's failed set; it leaves the plan. */
  markFailed: boolean;
  /**
   * Hold the paper out of the plan's order until its providers' windows end.
   * It still counts as left (ADR 0013).
   */
  defer: boolean;
  /** Drop the paper's cached fragment and re-plan. */
  applyToModel: boolean;
}

const NOTHING: HopLandingEffects = {
  countExpanded: false,
  markFailed: false,
  defer: false,
  applyToModel: false,
};

/**
 * What a landed expansion does. A stale epoch drops every effect: the request
 * still stored its list, but the model it would have counted against is gone
 * (spec, "Direction switch").
 */
export function hopLandingEffects(input: HopLandingInput): HopLandingEffects {
  if (input.cleaned || input.epoch !== input.currentEpoch) return NOTHING;
  if (input.stored) {
    return {
      countExpanded: true,
      markFailed: false,
      defer: false,
      applyToModel: true,
    };
  }
  // A refusal is not a failure (ADR 0013): the paper stays in the plan, and
  // nothing in the store changed, so there is nothing to apply.
  if (input.refused) {
    return {
      countExpanded: false,
      markFailed: false,
      defer: true,
      applyToModel: false,
    };
  }
  // A refresh that stored nothing with no provider refusing failed for the
  // session. Nothing else leaves the plan, so a paper the provider cannot
  // answer for would otherwise be asked again on every landing.
  return {
    countExpanded: false,
    markFailed: true,
    defer: false,
    applyToModel: true,
  };
}
```

After `hopRejectionEffects`, add:

```ts
/** What one fill expansion learned about the providers it could ask. */
export interface HopExpandOutcome {
  /** Providers whose answer was refused (HTTP 429), in the order asked. */
  refusedBy: readonly CitationProviderID[];
  /** Paging providers for the paper that a window kept the expansion from asking. */
  skipped: readonly CitationProviderID[];
  /** The one provider whose list was stored, or null. */
  answeredBy: CitationProviderID | null;
}

/** An expansion that learned nothing: the paper left the graph, or it threw. */
export const NO_OUTCOME: HopExpandOutcome = {
  refusedBy: [],
  skipped: [],
  answeredBy: null,
};

/** A provider refused or was sitting out a window (CONTEXT.md, "Refused"). */
export function outcomeRefused(outcome: HopExpandOutcome): boolean {
  return outcome.refusedBy.length > 0 || outcome.skipped.length > 0;
}

/** A provider's cool-down: 30 s, 1 min, 2 min, then every 5 min, never giving up. */
export const COOL_DOWN_MS: readonly number[] = [
  30_000, 60_000, 120_000, 300_000,
];

export interface ProviderWindow {
  /** Refusals since the provider last answered; picks the next delay. */
  step: number;
  /** When the window ends, on the host's clock. */
  endsAt: number;
}

/** One fill's windows, by provider. Not per direction and not per seed. */
export type ProviderWindows = ReadonlyMap<CitationProviderID, ProviderWindow>;

function coolDownDelay(step: number): number {
  return COOL_DOWN_MS[Math.min(Math.max(0, step), COOL_DOWN_MS.length - 1)];
}

/** A refusal: the window runs the delay for the provider's step, and the step goes up. */
export function refuse(
  windows: ProviderWindows,
  provider: CitationProviderID,
  now: number,
): ProviderWindows {
  const step = windows.get(provider)?.step ?? 0;
  const next = new Map(windows);
  next.set(provider, { step: step + 1, endsAt: now + coolDownDelay(step) });
  return next;
}

/** An answer: the window ends and the step returns to 0. */
export function answer(
  windows: ProviderWindows,
  provider: CitationProviderID,
): ProviderWindows {
  if (!windows.has(provider)) return windows;
  const next = new Map(windows);
  next.delete(provider);
  return next;
}

/** The providers a fill must not ask now. */
export function excluded(
  windows: ProviderWindows,
  now: number,
): CitationProviderID[] {
  return [...windows]
    .filter(([, window]) => window.endsAt > now)
    .map(([provider]) => provider);
}

/** Resume: every window ends now, and each keeps its step. */
export function endAll(windows: ProviderWindows, now: number): ProviderWindows {
  const next = new Map<CitationProviderID, ProviderWindow>();
  for (const [provider, window] of windows) {
    next.set(provider, {
      step: window.step,
      endsAt: Math.min(window.endsAt, now),
    });
  }
  return next;
}

/**
 * When a refused paper may be planned again: the earliest window end among
 * the providers that refused or skipped it that is still ahead of now, or
 * null when every such window has ended.
 */
export function deferUntil(
  windows: ProviderWindows,
  providers: readonly CitationProviderID[],
  now: number,
): number | null {
  let earliest: number | null = null;
  for (const provider of providers) {
    const endsAt = windows.get(provider)?.endsAt;
    if (endsAt === undefined || endsAt <= now) continue;
    if (earliest === null || endsAt < earliest) earliest = endsAt;
  }
  return earliest;
}

export interface HopCoolDownInput {
  windows: ProviderWindows;
  now: number;
  /** The direction's paging providers (`hopFillPagingProviders`). */
  pagingProviders: readonly CitationProviderID[];
  /** Papers the plan would expand now. */
  orderLength: number;
  /** When each of the plan's deferred papers may be planned again, all after now. */
  deferralEnds: readonly number[];
}

/**
 * When a fill that can do nothing tries again, or null while it can expand.
 * It cools down when every paging provider sits out a window, however many
 * papers are planned, or when every paper left is deferred.
 */
export function hopCoolDown(input: HopCoolDownInput): number | null {
  const ends = input.pagingProviders.map(
    (provider) => input.windows.get(provider)?.endsAt ?? 0,
  );
  if (ends.length > 0 && ends.every((endsAt) => endsAt > input.now)) {
    return Math.min(...ends);
  }
  if (input.orderLength === 0 && input.deferralEnds.length > 0) {
    return Math.min(...input.deferralEnds);
  }
  return null;
}
```

In `src/services/graphHopFillRunner.ts`, the `hopLandingEffects({ ... })` call gains `refused: false,` after `stored: host.stored(key, direction),`. Task 9 replaces it.

- [ ] **Step 4: Run it to verify it passes**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/graphHopRunnerModel.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, whole unit suite, format, commit**

```bash
npm run typecheck
npm run test:unit
npx prettier --write src/services/graphHopRunnerModel.ts src/services/graphHopFillRunner.ts test/unit/graphHopRunnerModel.test.ts
npx eslint src/services/graphHopRunnerModel.ts src/services/graphHopFillRunner.ts test/unit/graphHopRunnerModel.test.ts
git add src/services/graphHopRunnerModel.ts src/services/graphHopFillRunner.ts test/unit/graphHopRunnerModel.test.ts
git commit -m "B50: a refused landing defers the paper, and provider windows as pure rules"
```

---

### Task 8: Deferred papers in the plan

**Files:**

- Modify: `src/services/graphHopFillModel.ts:11-34` (types), `:53-84` (`planHopFill`)
- Modify: `src/services/graphHopFillRunner.ts:28-31` (Omit), `:146-155` (pass an empty set until Task 9)
- Modify: `test/unit/graphHopFillModel.test.ts`
- Modify: `test/unit/graphHopRunnerModel.test.ts:25-38` (`fillInput`)

**Interfaces:**

- Consumes: nothing new.
- Produces:
  - `HopFillInput.deferredKeys: ReadonlySet<string>`
  - `HopFillPlan.deferredByHop: readonly number[]`
  - `HopFillPlan.deferred: readonly string[]`

- [ ] **Step 1: Write the failing test**

In `test/unit/graphHopFillModel.test.ts`, add `deferredKeys: new Set(),` to `input()` after `failedKeys: new Set(),`, and append inside `describe("planHopFill", ...)`:

```ts
it("holds a deferred paper out of the order but counts it as left, not waiting", function () {
  const plan = planHopFill(
    input({
      deferredKeys: new Set(["a"]),
      expandedByHop: [0, 2, 0],
      capByHop: [500, 2, 500],
    }),
  );
  expect(plan.order).to.deep.equal([]);
  expect(plan.remainingByHop).to.deep.equal([0, 4, 0]);
  expect(plan.deferredByHop).to.deep.equal([0, 1, 0]);
  expect(plan.waitingByHop, "even at a full cap").to.deep.equal([0, 3, 0]);
  expect(plan.deferred).to.deep.equal(["a"]);
});

it("plans the rest while one paper is deferred", function () {
  const plan = planHopFill(input({ deferredKeys: new Set(["b"]) }));
  expect(plan.order).to.deep.equal(["a", "c", "d"]);
  expect(plan.deferredByHop).to.deep.equal([0, 1, 0]);
});
```

In `test/unit/graphHopRunnerModel.test.ts`, add `deferredKeys: new Set(),` to `fillInput` after `failedKeys,`.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/graphHopFillModel.test.ts`
Expected: FAIL. `plan.deferredByHop` is undefined and `order` still names the deferred paper.

- [ ] **Step 3: Implement**

In `src/services/graphHopFillModel.ts`, add to `HopFillInput` after `failedKeys`:

```ts
/**
 * Refused papers whose deferral has not ended (ADR 0013): counted as left,
 * never planned.
 */
deferredKeys: ReadonlySet<string>;
```

Add to `HopFillPlan`:

```ts
  /** Qualifying papers a refusal holds back, by hop; never waiting on the cap. */
  readonly deferredByHop: readonly number[];
  /** Those papers' keys, so the runner can tell when the first may be asked again. */
  readonly deferred: readonly string[];
```

In `planHopFill`:

```ts
export function planHopFill(input: HopFillInput): HopFillPlan {
  const remainingByHop = Array.from({ length: input.depth + 1 }, () => 0);
  const waitingByHop = Array.from({ length: input.depth + 1 }, () => 0);
  const deferredByHop = Array.from({ length: input.depth + 1 }, () => 0);
  const deferred: string[] = [];
  const candidates: Array<{ key: string; entry: HopEntry }> = [];
  for (const [key, entry] of input.entries) {
    if (entry.hop >= input.depth) continue;
    if (!input.visibleKeys.has(key)) continue;
    if (entry.expanded || input.failedKeys.has(key)) continue;
    remainingByHop[entry.hop] += 1;
    // Before the cap: raising the cap would not bring a refused paper back
    // any sooner, so it never reads as waiting for Fetch more.
    if (input.deferredKeys.has(key)) {
      deferredByHop[entry.hop] += 1;
      deferred.push(key);
      continue;
    }
    const expanded = input.expandedByHop[entry.hop] ?? 0;
    const cap = input.capByHop[entry.hop] ?? HOP_EXPANSION_CAP;
    if (expanded >= cap) {
      waitingByHop[entry.hop] += 1;
      continue;
    }
    candidates.push({ key, entry });
  }
  candidates.sort((left, right) => {
    const byRank =
      rank(left.key, left.entry, input) - rank(right.key, right.entry, input);
    if (byRank) return byRank;
    const byParent =
      parentCount(right.entry, input) - parentCount(left.entry, input);
    if (byParent) return byParent;
    return left.key.localeCompare(right.key);
  });
  return {
    order: candidates.map((candidate) => candidate.key),
    remainingByHop,
    waitingByHop,
    deferredByHop,
    deferred,
  };
}
```

In `src/services/graphHopFillRunner.ts`, the `HopFillPlanInput` Omit list gains `"deferredKeys"`, and `plan()` passes `deferredKeys: new Set<string>(),` after `failedKeys: failed[direction],`. Task 9 replaces it with the runner's deferrals.

- [ ] **Step 4: Run it to verify it passes**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/graphHopFillModel.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, whole unit suite, format, commit**

```bash
npm run typecheck
npm run test:unit
npx prettier --write src/services/graphHopFillModel.ts src/services/graphHopFillRunner.ts test/unit/graphHopFillModel.test.ts test/unit/graphHopRunnerModel.test.ts
npx eslint src/services/graphHopFillModel.ts src/services/graphHopFillRunner.ts test/unit/graphHopFillModel.test.ts test/unit/graphHopRunnerModel.test.ts
git add src/services/graphHopFillModel.ts src/services/graphHopFillRunner.ts test/unit/graphHopFillModel.test.ts test/unit/graphHopRunnerModel.test.ts
git commit -m "B50: the fill plan holds deferred papers out of its order"
```

---

### Task 9: The runner switches, defers and cools down; the host wires it

**Files:**

- Modify: `src/services/graphHopFillRunner.ts` (whole file, below)
- Modify: `src/services/graphViewService.ts`:
  - imports `:33-37`, `:229`;
  - host `expand` `:3861-3901`, after `cancelFrame` `:3929-3932`;
  - `fillControl` `:3952-3957`.
- Modify: `test/unit/graphHopFillRunner.test.ts`

**Interfaces:**

- Consumes:
  - from Task 7: `NO_OUTCOME`, `HopExpandOutcome`, `outcomeRefused`, `refuse`, `answer`, `excluded`, `endAll`, `deferUntil`, `hopCoolDown`, `ProviderWindows`;
  - from Task 8: `HopFillPlan.deferred`;
  - from Task 6: `hopFillPagingProviders`, the resolution's `refusedBy` / `skipped` / `answeredBy`, and the options `retryRefusals` / `excludeProviders`.
- Produces:
  - `HopFillHost.expand(key, direction, control: { reportCount; stale; excludeProviders: readonly CitationProviderID[] }): Promise<HopExpandOutcome>`
  - `HopFillHost.now(): number`, `.pagingProviders(direction): readonly CitationProviderID[]`, `.after(ms: number, run: () => void): number`, `.cancelAfter(handle: number): void`
  - `interface HopFillRefusal { providers: CitationProviderID[]; retryAt: number }`; `HopFillState.refusal: HopFillRefusal | null`
  - `HopFillRunner.retryNow(): void`

- [ ] **Step 1: Write the failing test**

In `test/unit/graphHopFillRunner.test.ts`:

1. Imports become:

```ts
import { describe, it } from "node:test";
import { expect } from "chai";
import type { CitationProviderID } from "../../src/domain/citationTypes";
import type { HopEntry, HopDirection } from "../../src/services/graphHopModel";
import { HOP_EXPANSION_CAP } from "../../src/services/graphHopFillModel";
import {
  createHopFillRunner,
  type HopFillHost,
  type HopFillPlanInput,
} from "../../src/services/graphHopFillRunner";
import {
  NO_OUTCOME,
  type HopExpandOutcome,
} from "../../src/services/graphHopRunnerModel";

const S2: CitationProviderID = "semantic-scholar";
const OC: CitationProviderID = "opencitations";
```

2. Replace `fakeHost` with:

```ts
/**
 * A host with a fake expander, a fake clock and fake timers: the fill's own
 * decisions (order, caps, failure per direction, the epoch drop, provider
 * windows, deferrals, cooling down) are asserted through the runner's
 * interface, with nothing of the graph view, a provider or a DOM.
 */
function fakeHost(overrides: Partial<HopFillHost> = {}) {
  const entries = new Map<string, HopEntry>([
    entry("s", 0, [], true),
    entry("a", 1, ["s"]),
    entry("b", 1, ["s"]),
  ]);
  const stored = new Set<string>(["s"]);
  const calls = {
    expanded: [] as string[],
    excludes: [] as CitationProviderID[][],
    landed: [] as string[],
    settled: 0,
    planned: 0,
    planEmpty: 0,
    errors: [] as unknown[],
  };
  let direction: HopDirection = "cited-by";
  let depth = 2;
  let active = true;
  /** A key here stores nothing from the provider that answers it. */
  const failing = new Set<string>();
  /** Providers answering HTTP 429 to every request. */
  const refusing = new Set<CitationProviderID>();
  const paging: CitationProviderID[] = [S2, OC];
  const frames: Array<() => void> = [];
  let clock = 0;
  let nextTimer = 1;
  const timers: Array<{ id: number; at: number; run: () => void }> = [];
  const host: HopFillHost = {
    planInput: (): HopFillPlanInput | null => ({
      direction,
      entries,
      visibleKeys: new Set(entries.keys()),
      depth,
      selectedKey: null,
      hoveredKey: null,
      onScreenKeys: new Set(),
      reportedCountOf: () => null,
    }),
    canExpand: () => active,
    // The refresh's loop in miniature (externalDiscoveryService.ts): the
    // paging providers not excluded, in order, until one does not refuse.
    expand: async (key, _direction, control): Promise<HopExpandOutcome> => {
      calls.expanded.push(key);
      calls.excludes.push([...control.excludeProviders]);
      await Promise.resolve();
      if (control.stale()) return NO_OUTCOME;
      const skipped = paging.filter((provider) =>
        control.excludeProviders.includes(provider),
      );
      const refusedBy: CitationProviderID[] = [];
      for (const provider of paging) {
        if (control.excludeProviders.includes(provider)) continue;
        if (refusing.has(provider)) {
          refusedBy.push(provider);
          continue;
        }
        if (failing.has(key)) return { refusedBy, skipped, answeredBy: null };
        stored.add(key);
        control.reportCount(7);
        entries.set(key, { ...entries.get(key)!, expanded: true });
        return { refusedBy, skipped, answeredBy: provider };
      }
      return { refusedBy, skipped, answeredBy: null };
    },
    stored: (key) => stored.has(key),
    hopOf: (key) => entries.get(key)?.hop ?? null,
    landed: (key) => {
      calls.landed.push(key);
    },
    settled: () => {
      calls.settled += 1;
    },
    planned: () => {
      calls.planned += 1;
    },
    planEmpty: () => {
      calls.planEmpty += 1;
    },
    frame: (run) => {
      frames.push(run);
      return frames.length;
    },
    cancelFrame: () => undefined,
    now: () => clock,
    pagingProviders: () => paging,
    after: (ms, run) => {
      const id = nextTimer;
      nextTimer += 1;
      timers.push({ id, at: clock + ms, run });
      return id;
    },
    cancelAfter: (handle) => {
      const index = timers.findIndex((timer) => timer.id === handle);
      if (index >= 0) timers.splice(index, 1);
    },
    logError: (error) => {
      calls.errors.push(error);
    },
    ...overrides,
  };
  /** Run every pending frame and let the queued expansion land. */
  const settle = async (): Promise<void> => {
    for (let round = 0; round < 12; round += 1) {
      while (frames.length) frames.shift()!();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };
  /** Move the clock on, fire the timers that came due, and settle. */
  const advance = async (ms: number): Promise<void> => {
    clock += ms;
    const due = timers.filter((timer) => timer.at <= clock);
    for (const timer of due) timers.splice(timers.indexOf(timer), 1);
    for (const timer of due) timer.run();
    await settle();
  };
  return {
    host,
    calls,
    entries,
    stored,
    failing,
    refusing,
    timers,
    settle,
    advance,
    setDirection: (next: HopDirection) => {
      direction = next;
    },
    setDepth: (next: number) => {
      depth = next;
    },
    setActive: (next: boolean) => {
      active = next;
    },
  };
}
```

3. Existing cases:
   - In "drops a landing's effects when the epoch moved", the override becomes:

     ```ts
     fake.host.expand = async (key, direction, control) => {
       const outcome = await original(key, direction, control);
       if (first) {
         first = false;
         runner.invalidate();
       }
       return outcome;
     };
     ```

   - In "holds while stopped", the expected state gains `refusal: null`.
   - In "logs an escaped rejection", the override becomes `async (key) => { if (key === "a") throw new Error("provider down"); return NO_OUTCOME; }`.

4. Append:

```ts
describe("the fill under provider refusals", function () {
  it("keeps a refused paper in the plan: not failed, not landed, not settled", async function () {
    const fake = fakeHost();
    fake.refusing.add(S2);
    fake.refusing.add(OC);
    const runner = createHopFillRunner(fake.host);
    runner.wake();
    await fake.settle();
    expect(fake.calls.expanded).to.deep.equal(["a"]);
    expect(fake.calls.landed).to.deep.equal([]);
    expect(fake.calls.settled).to.equal(0);
    expect(runner.state()).to.deep.equal({
      remaining: 2,
      waiting: 0,
      paused: false,
      refusal: { providers: [S2, OC], retryAt: 30_000 },
    });
  });

  it("asks the next expansion without the provider that refused", async function () {
    const fake = fakeHost();
    fake.refusing.add(S2);
    const runner = createHopFillRunner(fake.host);
    runner.wake();
    await fake.settle();
    expect(fake.calls.expanded).to.deep.equal(["a", "b"]);
    expect(fake.calls.excludes).to.deep.equal([[], [S2]]);
    expect(fake.calls.landed).to.deep.equal(["a", "b"]);
    expect(runner.state()).to.equal(null);
  });

  it("expands nothing while every paging provider sits out a window, with one timer", async function () {
    const fake = fakeHost();
    fake.entries.set(...entry("c", 1, ["s"]));
    fake.refusing.add(S2);
    fake.refusing.add(OC);
    const runner = createHopFillRunner(fake.host);
    runner.wake();
    await fake.settle();
    for (let wake = 0; wake < 3; wake += 1) {
      runner.wake();
      await fake.settle();
    }
    expect(fake.calls.expanded).to.deep.equal(["a"]);
    expect(fake.timers.map((timer) => timer.at)).to.deep.equal([30_000]);
  });

  it("keeps retryAt fixed, and tries again when the window ends", async function () {
    const fake = fakeHost();
    fake.refusing.add(S2);
    fake.refusing.add(OC);
    const runner = createHopFillRunner(fake.host);
    runner.wake();
    await fake.settle();
    await fake.advance(10_000);
    runner.wake();
    await fake.settle();
    expect(runner.state()?.refusal?.retryAt).to.equal(30_000);
    fake.refusing.clear();
    await fake.advance(20_000);
    expect(fake.calls.expanded).to.deep.equal(["a", "a", "b"]);
    expect(runner.state()).to.equal(null);
  });

  it("cools down when every paper left is deferred, and asks again at the deferral's end", async function () {
    const fake = fakeHost();
    fake.entries.delete("b");
    fake.refusing.add(S2);
    // Semantic Scholar refuses and OpenCitations answers with nothing:
    // refused, not failed, and OpenCitations is not in a window.
    fake.failing.add("a");
    const runner = createHopFillRunner(fake.host);
    runner.wake();
    await fake.settle();
    expect(fake.calls.expanded).to.deep.equal(["a"]);
    expect(fake.calls.planEmpty).to.equal(1);
    expect(fake.timers.map((timer) => timer.at)).to.deep.equal([30_000]);
    expect(runner.state()?.refusal).to.deep.equal({
      providers: [S2],
      retryAt: 30_000,
    });
    await fake.advance(30_000);
    expect(fake.calls.expanded).to.deep.equal(["a", "a"]);
    expect(fake.calls.excludes[1]).to.deep.equal([]);
  });

  it("cancels the timer on stop, invalidate and reset, and arms none off screen", async function () {
    const fake = fakeHost();
    fake.refusing.add(S2);
    fake.refusing.add(OC);
    const runner = createHopFillRunner(fake.host);
    runner.wake();
    await fake.settle();
    expect(fake.timers.length).to.equal(1);
    runner.stop();
    expect(fake.timers.length, "stop").to.equal(0);
    runner.wake();
    await fake.settle();
    expect(fake.timers.length, "paused").to.equal(0);
    expect(runner.state()?.refusal, "no refusal line while paused").to.equal(
      null,
    );
    runner.resume();
    runner.wake();
    await fake.settle();
    expect(fake.timers.length).to.equal(1);
    runner.invalidate();
    expect(fake.timers.length, "invalidate").to.equal(0);
    runner.wake();
    await fake.settle();
    expect(fake.timers.length).to.equal(1);
    runner.reset();
    expect(fake.timers.length, "reset").to.equal(0);
    fake.setActive(false);
    runner.wake();
    await fake.settle();
    expect(fake.timers.length, "off screen").to.equal(0);
  });

  it("asks at once on retryNow, and a second refusal waits the next step; resume alone does not", async function () {
    const fake = fakeHost();
    fake.entries.delete("b");
    fake.refusing.add(S2);
    fake.refusing.add(OC);
    const runner = createHopFillRunner(fake.host);
    runner.wake();
    await fake.settle();
    runner.stop();
    runner.resume();
    runner.wake();
    await fake.settle();
    expect(fake.calls.expanded, "resume alone ends no window").to.deep.equal([
      "a",
    ]);
    runner.retryNow();
    await fake.settle();
    expect(fake.calls.expanded).to.deep.equal(["a", "a"]);
    expect(fake.calls.excludes[1]).to.deep.equal([]);
    expect(runner.state()?.refusal?.retryAt).to.equal(60_000);
  });

  it("keeps the windows across invalidate and reset", async function () {
    const fake = fakeHost();
    fake.refusing.add(S2);
    const runner = createHopFillRunner(fake.host);
    runner.wake();
    await fake.settle();
    runner.invalidate();
    fake.entries.set(...entry("c", 1, ["s"]));
    runner.wake();
    await fake.settle();
    expect(fake.calls.excludes.at(-1), "after invalidate").to.deep.equal([S2]);
    runner.reset();
    fake.entries.set(...entry("d", 1, ["s"]));
    runner.wake();
    await fake.settle();
    expect(fake.calls.excludes.at(-1), "after reset").to.deep.equal([S2]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/graphHopFillRunner.test.ts`
Expected: FAIL. `retryNow` is missing, `excludeProviders` is undefined, and state has no `refusal`.

- [ ] **Step 3: Implement the runner**

Replace `src/services/graphHopFillRunner.ts` with:

```ts
/**
 * The fill: the background work that expands shown papers one at a time, in
 * the plan's order, until every shown paper at an opened hop is expanded or
 * failed, or the cap is hit (CONTEXT.md, "Fill"). This module owns the fill's
 * state, which used to be thirteen locals of the graph view's closure: the
 * queue, the epoch, the in-flight slot, the pause flag, the frame, the failed
 * set, the counts and caps per hop, the reported totals and the last plan.
 * What it does not own is the model, the DOM or the provider call: those come
 * in through the host, so a test can drive the fill with a fake expander and
 * assert its order, its caps, its failures per direction and its epoch drop.
 *
 * The rules it encodes are the ADRs: scope gates and the camera orders (0003,
 * through `planHopFill`), a cap of 500 per hop per direction (0005), its own
 * queue that never touches Refresh (0007), a rebuild on every landing (0010,
 * through `settled`), and a refusal that is not a failure (0013): a refused
 * paper stays in the plan, the refusing provider sits out a window, and the
 * fill cools down, with one timer, only when nothing can be asked.
 */
import type { CitationProviderID } from "../domain/citationTypes";
import {
  HOP_EXPANSION_CAP,
  planHopFill,
  type HopFillInput,
  type HopFillPlan,
} from "./graphHopFillModel";
import type { HopDirection } from "./graphHopModel";
import {
  NO_OUTCOME,
  answer,
  deferUntil,
  endAll,
  excluded,
  hopCoolDown,
  hopLandingEffects,
  hopRejectionEffects,
  outcomeRefused,
  refuse,
  type HopExpandOutcome,
  type ProviderWindows,
} from "./graphHopRunnerModel";
import { SerializedTaskQueue } from "./serializedTaskQueue";

/** What the plan needs from the graph, read fresh on every re-plan. */
export interface HopFillPlanInput extends Omit<
  HopFillInput,
  | "failedKeys"
  | "deferredKeys"
  | "expandedByHop"
  | "capByHop"
  | "reportedCountOf"
> {
  direction: HopDirection;
  /**
   * The paper's reported count in the direction from its own fields, or
   * null; the fill overlays the totals its own landings reported.
   */
  reportedCountOf: (key: string) => number | null;
}

export interface HopFillHost {
  /** Null while there is no walk or no scope: nothing to plan. */
  planInput(): HopFillPlanInput | null;
  /** The view is on screen, so a plan may start an expansion. */
  canExpand(): boolean;
  /**
   * One shown paper's own list, in the direction: automatic mode, one page,
   * one answering provider. `reportCount` takes the provider's reported total
   * on the way; `stale()` says the fill moved on, for a check between two
   * awaits; `excludeProviders` are the providers sitting out a window, never
   * to be asked. Resolves who refused, who was skipped and who answered. A
   * rejection is caught and logged; the paper is then failed or not by
   * `stored`.
   */
  expand(
    key: string,
    direction: HopDirection,
    control: {
      reportCount: (count: number) => void;
      stale: () => boolean;
      excludeProviders: readonly CitationProviderID[];
    },
  ): Promise<HopExpandOutcome>;
  /** A stored summary exists for the paper in the direction now. */
  stored(key: string, direction: HopDirection): boolean;
  /** The paper's hop in the current walk, or null when it left it. */
  hopOf(key: string): number | null;
  /** A landing was applied: drop the paper's fragment, fit a seed. */
  landed(key: string): void;
  /** An expansion finished under the current epoch: rebuild the walk. */
  settled(): void;
  /** A plan was made; the rail reads `state()` after this. */
  planned(): void;
  /** The plan is empty: fire what the fill was holding. */
  planEmpty(): void;
  /** Schedule a re-plan on the next frame. */
  frame(run: () => void): number;
  cancelFrame(handle: number): void;
  /** The clock windows and deferrals are measured on. */
  now(): number;
  /** The direction's paging providers, in the provider plan's order. */
  pagingProviders(direction: HopDirection): readonly CitationProviderID[];
  /** Run once after `ms`: the end of a cool-down. */
  after(ms: number, run: () => void): number;
  cancelAfter(handle: number): void;
  logError(error: unknown): void;
}

export interface HopFillRefusal {
  /** The providers sitting out a window, in the provider plan's order. */
  providers: CitationProviderID[];
  /** When the fill tries again, on the host's clock; fixed for a cool-down. */
  retryAt: number;
}

export interface HopFillState {
  remaining: number;
  waiting: number;
  paused: boolean;
  /** Set only while the fill is cooling down and not paused. */
  refusal: HopFillRefusal | null;
}

export interface HopFillRunner {
  /** Re-plan on the next frame and expand the plan's first paper. */
  wake(): void;
  stop(): void;
  resume(): void;
  /**
   * The rail's Resume, after `resume`: every window and deferral ends and the
   * fill asks at once. Each provider keeps its step, so a fresh refusal waits
   * longer. Fetch hop N and applying a view call `resume` alone.
   */
  retryNow(): void;
  /** Raise the cap by 500 for every hop whose papers wait on it. */
  fetchMore(): void;
  /**
   * The direction or the seeds changed: a request in flight still stores,
   * only its callbacks are dropped (spec, "Direction switch").
   */
  invalidate(): void;
  /**
   * The graph lost its seeds: counts, caps, failures and deferrals go, since
   * "session" means the seeded graph (ADR 0005). The reported totals are a
   * cache and stay, and so do the providers' windows.
   */
  reset(): void;
  /** The rail's progress line, or null when the plan is empty. */
  state(): HopFillState | null;
  /** What the rail's hop rows print as "of {reported}", by hop. */
  reportedByHop(
    entries: ReadonlyMap<string, { hop: number }>,
    depth: number,
    direction: HopDirection,
  ): (number | null)[];
  /** The view is torn down: the epoch moves, the frame, timer and queue close. */
  dispose(): void;
}

const DIRECTIONS: readonly HopDirection[] = ["cited-by", "references"];

function perDirection<T>(make: () => T): Record<HopDirection, T> {
  return { "cited-by": make(), references: make() };
}

export function createHopFillRunner(host: HopFillHost): HopFillRunner {
  const queue = new SerializedTaskQueue();
  let epoch = 0;
  let inFlight: string | null = null;
  let paused = false;
  let frame = 0;
  let disposed = false;
  /**
   * Failure is a property of a paper's list in one direction: Crossref pages
   * a paper's references but not its citations. A hiccup under Citers must
   * not remove the paper from the References plan (spec, "Vocabulary").
   */
  const failed = perDirection(() => new Set<string>());
  /** Landed expansions this session, by direction then hop. */
  const expanded = perDirection<number[]>(() => []);
  const caps = perDirection<number[]>(() => []);
  /** The reported total each expanded paper returned, by direction. */
  const reported = perDirection(() => new Map<string, number>());
  /**
   * Each provider's cool-down in this fill. A window belongs to the provider,
   * not to a direction or to the seeds, so it survives `invalidate` and
   * `reset` (ADR 0013).
   */
  let windows: ProviderWindows = new Map();
  /** A refused paper's key and when its deferral ends, by direction. */
  const deferrals = perDirection(() => new Map<string, number>());
  /** The one cool-down timer. */
  let timer: number | null = null;
  /** When the fill tries again, while the last plan found it cooling down. */
  let coolingUntil: number | null = null;
  let lastPlan: HopFillPlan | null = null;
  let lastDirection: HopDirection = "cited-by";

  const capFor = (direction: HopDirection, hop: number): number =>
    caps[direction][hop] ?? HOP_EXPANSION_CAP;

  const cancelTimer = (): void => {
    if (timer === null) return;
    host.cancelAfter(timer);
    timer = null;
  };

  const plan = (): HopFillPlan | null => {
    const input = host.planInput();
    if (!input) return null;
    const { direction } = input;
    lastDirection = direction;
    const now = host.now();
    const deferredKeys = new Set<string>();
    for (const [key, until] of deferrals[direction]) {
      if (until > now) deferredKeys.add(key);
    }
    return planHopFill({
      ...input,
      failedKeys: failed[direction],
      deferredKeys,
      expandedByHop: expanded[direction],
      capByHop: Array.from({ length: input.depth + 1 }, (_, hop) =>
        capFor(direction, hop),
      ),
      reportedCountOf: (key) =>
        reported[direction].get(key) ?? input.reportedCountOf(key),
    });
  };

  /** When the plan can do nothing until a window or a deferral ends, or null. */
  const coolDown = (current: HopFillPlan): number | null => {
    const now = host.now();
    const deferralEnds: number[] = [];
    for (const key of current.deferred) {
      const until = deferrals[lastDirection].get(key);
      if (until !== undefined && until > now) deferralEnds.push(until);
    }
    return hopCoolDown({
      windows,
      now,
      pagingProviders: host.pagingProviders(lastDirection),
      orderLength: current.order.length,
      deferralEnds,
    });
  };

  const expand = (key: string, startEpoch: number): Promise<void> => {
    const direction = lastDirection;
    inFlight = key;
    const stale = (): boolean => disposed || startEpoch !== epoch;
    /** A refused landing changed nothing in the store, so nothing rebuilds. */
    let refusedLanding = false;
    return queue
      .enqueue(async () => {
        if (stale()) return;
        let outcome: HopExpandOutcome = NO_OUTCOME;
        try {
          outcome = await host.expand(key, direction, {
            reportCount: (count) => reported[direction].set(key, count),
            stale,
            excludeProviders: excluded(windows, host.now()),
          });
        } catch (error) {
          host.logError(error);
        }
        // A refusal is true of the provider whatever the epoch did, so the
        // windows learn it even from a landing whose effects are dropped.
        if (!disposed) {
          const now = host.now();
          for (const provider of outcome.refusedBy) {
            windows = refuse(windows, provider, now);
          }
          if (outcome.answeredBy) windows = answer(windows, outcome.answeredBy);
        }
        // What the landing means is decided by `hopLandingEffects`
        // (graphHopRunnerModel.ts): expanded is a stored summary, refused is
        // deferred, anything else failed for the session, and a stale epoch
        // drops all three.
        const effects = hopLandingEffects({
          epoch: startEpoch,
          currentEpoch: epoch,
          cleaned: disposed,
          stored: host.stored(key, direction),
          refused: outcomeRefused(outcome),
        });
        if (effects.defer) {
          refusedLanding = true;
          const until = deferUntil(
            windows,
            [...outcome.refusedBy, ...outcome.skipped],
            host.now(),
          );
          if (until !== null) deferrals[direction].set(key, until);
          return;
        }
        if (!effects.applyToModel) return;
        deferrals[direction].delete(key);
        if (effects.countExpanded) {
          const hop = host.hopOf(key) ?? 0;
          const counts = expanded[direction];
          counts[hop] = (counts[hop] ?? 0) + 1;
        }
        if (effects.markFailed) failed[direction].add(key);
        host.landed(key);
      })
      .catch((error: unknown) => {
        // Nothing else may escape the enqueued body, but if it does the paper
        // still leaves the plan: an unhandled rejection here would otherwise
        // re-open the hot-retry loop the guard above closes.
        if (
          hopRejectionEffects({ epoch: startEpoch, currentEpoch: epoch })
            .markFailed
        )
          failed[direction].add(key);
        host.logError(error);
      })
      .finally(() => {
        if (startEpoch !== epoch) return;
        inFlight = null;
        if (disposed) return;
        // The rebuild re-reads one fragment and recomputes the scope, which
        // re-plans through the host — but it may return early, so the next
        // fill is scheduled here whatever it did. A refused landing stored
        // nothing, so there is nothing to rebuild.
        if (!refusedLanding) host.settled();
        wake();
      });
  };

  const wake = (): void => {
    if (disposed || frame) return;
    frame = host.frame(() => {
      frame = 0;
      if (disposed) return;
      // Every frame decides afresh whether to wait, so a wake never leaves a
      // second timer behind.
      cancelTimer();
      lastPlan = plan();
      coolingUntil = lastPlan ? coolDown(lastPlan) : null;
      host.planned();
      if (!lastPlan || paused || !host.canExpand()) return;
      if (inFlight) return;
      const next = lastPlan.order[0];
      if (!next) host.planEmpty();
      if (coolingUntil !== null) {
        timer = host.after(Math.max(0, coolingUntil - host.now()), () => {
          timer = null;
          wake();
        });
        return;
      }
      if (next) void expand(next, epoch);
    });
  };

  /** The providers sitting out a window, in the provider plan's order. */
  const refusingProviders = (): CitationProviderID[] => {
    const sitting = new Set(excluded(windows, host.now()));
    return host
      .pagingProviders(lastDirection)
      .filter((provider) => sitting.has(provider));
  };

  return {
    wake,
    stop: () => {
      paused = true;
      cancelTimer();
    },
    resume: () => {
      paused = false;
    },
    retryNow: () => {
      windows = endAll(windows, host.now());
      for (const direction of DIRECTIONS) deferrals[direction].clear();
      coolingUntil = null;
      wake();
    },
    fetchMore: () => {
      paused = false;
      const waiting = lastPlan?.waitingByHop ?? [];
      const direction = lastDirection;
      waiting.forEach((count, hop) => {
        if (count > 0)
          caps[direction][hop] = capFor(direction, hop) + HOP_EXPANSION_CAP;
      });
    },
    invalidate: () => {
      epoch += 1;
      inFlight = null;
      cancelTimer();
    },
    reset: () => {
      epoch += 1;
      inFlight = null;
      cancelTimer();
      for (const direction of DIRECTIONS) {
        failed[direction].clear();
        deferrals[direction].clear();
        expanded[direction] = [];
        caps[direction] = [];
      }
      lastPlan = null;
      coolingUntil = null;
    },
    state: () => {
      if (!lastPlan) return null;
      const remaining = lastPlan.remainingByHop.reduce((sum, n) => sum + n, 0);
      const waiting = lastPlan.waitingByHop.reduce((sum, n) => sum + n, 0);
      if (!remaining && !waiting) return null;
      const providers =
        coolingUntil !== null && !paused ? refusingProviders() : [];
      return {
        remaining: remaining - waiting,
        waiting,
        paused,
        refusal:
          coolingUntil !== null && providers.length
            ? { providers, retryAt: coolingUntil }
            : null,
      };
    },
    // A heuristic on purpose: a hop-k paper reached from two parents is
    // counted under both, so "of {reported}" can over-report (review M11).
    // The exact figure would need the union of the parents' lists, which is
    // the fetch.
    reportedByHop: (entries, depth, direction) => {
      const totals: (number | null)[] = Array.from(
        { length: depth + 1 },
        () => null,
      );
      for (const [key, entry] of entries) {
        const count = reported[direction].get(key);
        if (count === undefined || entry.hop >= depth) continue;
        const hop = entry.hop + 1;
        totals[hop] = (totals[hop] ?? 0) + count;
      }
      return totals;
    },
    dispose: () => {
      disposed = true;
      epoch += 1;
      inFlight = null;
      cancelTimer();
      if (frame) {
        host.cancelFrame(frame);
        frame = 0;
      }
      queue.close();
    },
  };
}
```

- [ ] **Step 4: Wire the host**

In `src/services/graphViewService.ts`:

1. The `./externalDiscoveryService` import gains `hopFillPagingProviders`. `import { planHopExploreChange } from "./graphHopRunnerModel";` becomes:

```ts
import {
  NO_OUTCOME,
  planHopExploreChange,
  type HopExpandOutcome,
} from "./graphHopRunnerModel";
```

2. Replace the host's `expand` with:

```ts
    expand: async (key, direction, control) => {
      const subject = hopSubject(key);
      // A paper the graph no longer names is failed by `stored`, so it
      // leaves the plan instead of stalling it.
      if (!subject) return NO_OUTCOME;
      // The seed preparation hydrates metadata over the network and can
      // reject too; the fill's guard catches it, so a paper is never left
      // neither expanded nor failed for the next plan to name again.
      if (subject.itemID <= 0)
        await prepareExternalFocusSeedForRefresh(subject);
      if (control.stale()) return NO_OUTCOME;
      let outcome: HopExpandOutcome = NO_OUTCOME;
      await refreshExternalRelationships(
        subject,
        libraryModel.nodes,
        direction,
        {
          maximum: AUTOMATIC_RELATIONSHIP_MEMBERSHIP_LIMIT,
          refreshMembership: true,
          silent: true,
          mode: "automatic",
          providerStrategy: "native-first",
          providerLimit: 1,
          // A refusal is not a failure (ADR 0013): no 429 retries, and the
          // providers sitting out a window are not asked.
          retryRefusals: false,
          excludeProviders: control.excludeProviders,
          queueBackgroundHydration: true,
          showBackgroundProgress: false,
          metadataHydrationLimit: 0,
          summaryLookupLimit: 0,
          publicationSource: "hop-fill",
          ...(subject.itemID <= 0 && subject.provider && subject.providerWorkID
            ? {
                providerWorkIDs: {
                  [subject.provider]: subject.providerWorkID,
                },
              }
            : {}),
          onMembershipResolved: (resolution) => {
            if (resolution.reportedCount !== null)
              control.reportCount(resolution.reportedCount);
            outcome = {
              refusedBy: resolution.refusedBy,
              skipped: resolution.skipped,
              answeredBy: resolution.answeredBy,
            };
          },
        },
      );
      return outcome;
    },
```

3. After the host's `cancelFrame` entry, add:

```ts
    now: () => Date.now(),
    pagingProviders: (direction) => hopFillPagingProviders(direction),
    after: (ms, run) => setTimeout(run, ms) as unknown as number,
    cancelAfter: (handle) => clearTimeout(handle),
```

4. `fillControl` becomes:

```ts
fillControl = (action) => {
  if (action === "stop") hopFill.stop();
  else if (action === "resume") {
    // Only the rail's Resume ends the windows; Fetch hop N and applying a
    // view resume without retrying a refusing provider (ADR 0013).
    hopFill.resume();
    hopFill.retryNow();
  } else hopFill.fetchMore();
  scheduleHopFill();
};
```

- [ ] **Step 5: Run the runner test, typecheck, whole unit suite**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/graphHopFillRunner.test.ts`
Expected: PASS, 16 tests.

Run: `npm run typecheck && npm run test:unit`
Expected: clean; every unit test passing.

- [ ] **Step 6: Format, commit**

```bash
npx prettier --write src/services/graphHopFillRunner.ts src/services/graphViewService.ts test/unit/graphHopFillRunner.test.ts
npx eslint src/services/graphHopFillRunner.ts src/services/graphViewService.ts test/unit/graphHopFillRunner.test.ts
git add src/services/graphHopFillRunner.ts src/services/graphViewService.ts test/unit/graphHopFillRunner.test.ts
git commit -m "B50: the fill switches provider, defers refused papers and cools down with one timer"
```

---

### Task 10: The refusal line

**Files:**

- Modify: `src/services/graphScopeRailModel.ts`: imports `:10-18`, `ScopeHopsInput.fill` `:67-68`, `ScopeHopsProgress` `:90-96`, progress `:240-257`, new export
- Modify: `test/unit/graphScopeRailModel.test.ts:356-493`

**Interfaces:**

- Consumes: `citationDataSourceLabel` (`providerPresentation.ts`); `HopFillState.refusal` shape (Task 9).
- Produces:
  - `ScopeHopsInput.fill.refusal?: { providers: readonly CitationProviderID[]; retryAt: number } | null`
  - `ScopeHopsProgress.countdown: { retryAt: number } | null`, `.title: string | null`
  - `formatRetryIn(ms: number): string`

- [ ] **Step 1: Write the failing test**

In `test/unit/graphScopeRailModel.test.ts`:

1. The import after `// Mirrors COUNT_FORMAT` becomes:

```ts
import {
  formatRetryIn,
  type ScopeHopsInput,
} from "../../src/services/graphScopeRailModel";
import { citationDataSourceLabel } from "../../src/services/providerPresentation";
```

2. In "prints the progress line in its three states", the two `deep.equal` expectations gain `countdown: null, title: null`.
3. Append inside `describe("the Citation hops block", ...)`, before its closing `});`:

```ts
it("names the one provider refusing, with a countdown and Stop", function () {
  const block = railWithHops(
    hopsInput({
      fill: {
        remaining: 3,
        waiting: 0,
        paused: false,
        refusal: { providers: ["semantic-scholar"], retryAt: 1_234 },
      },
    }),
  )!.hops!;
  expect(block.progress).to.deep.equal({
    afterHop: 2,
    text: `${citationDataSourceLabel("semantic-scholar")} refusing`,
    action: "stop",
    actionLabel: "Stop",
    countdown: { retryAt: 1_234 },
    title: null,
  });
});

it("counts several refusing providers and names them in the title", function () {
  const block = railWithHops(
    hopsInput({
      fill: {
        remaining: 3,
        waiting: 0,
        paused: false,
        refusal: {
          providers: ["semantic-scholar", "opencitations"],
          retryAt: 9_000,
        },
      },
    }),
  )!.hops!;
  expect(block.progress).to.include({
    text: `${count(2)} providers refusing`,
    title: `${citationDataSourceLabel("semantic-scholar")}, ${citationDataSourceLabel("opencitations")}`,
  });
});

it("lets a refusal win over Fetch more", function () {
  const block = railWithHops(
    hopsInput({
      fill: {
        remaining: 0,
        waiting: 1800,
        paused: false,
        refusal: { providers: ["opencitations"], retryAt: 5_000 },
      },
    }),
  )!.hops!;
  expect(block.progress).to.include({ action: "stop" });
  expect(block.progress!.text).to.match(/refusing$/);
});
```

4. At the end of the file, after the Citation hops block's closing `});`, append:

```ts
describe("formatRetryIn", function () {
  it("counts seconds below a minute, then whole minutes rounded up", function () {
    expect(formatRetryIn(40_000)).to.equal("retry in 40 s");
    expect(formatRetryIn(59_000)).to.equal("retry in 59 s");
    expect(formatRetryIn(59_001)).to.equal("retry in 1 min");
    expect(formatRetryIn(60_000)).to.equal("retry in 1 min");
    expect(formatRetryIn(241_000)).to.equal("retry in 5 min");
    expect(formatRetryIn(0)).to.equal("retry in 0 s");
    expect(formatRetryIn(-500)).to.equal("retry in 0 s");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/graphScopeRailModel.test.ts`
Expected: FAIL. `formatRetryIn` is not exported.

- [ ] **Step 3: Implement**

In `src/services/graphScopeRailModel.ts`:

1. Imports gain:

```ts
import type { CitationProviderID } from "../domain/citationTypes";
import { citationDataSourceLabel } from "./providerPresentation";
```

2. `ScopeHopsInput.fill` becomes:

```ts
  /** The runner's state, or null while it has nothing to do and nothing waits. */
  fill: {
    remaining: number;
    waiting: number;
    paused: boolean;
    /** Set while the fill cools down: who is refusing, and when it tries again. */
    refusal?: {
      providers: readonly CitationProviderID[];
      retryAt: number;
    } | null;
  } | null;
```

3. `ScopeHopsProgress` gains:

```ts
  /**
   * Set while the fill cools down. `retryAt` is fixed for the cool-down, so
   * the model does not change from second to second; the rail counts down to
   * it in place.
   */
  countdown: { retryAt: number } | null;
  /** The refusing providers' names, when the line counts them. */
  title: string | null;
```

4. Before `buildScopeHopsBlock`, add:

```ts
/** The countdown's words: seconds below a minute, then minutes rounded up. */
export function formatRetryIn(ms: number): string {
  const seconds = Math.ceil(Math.max(0, ms) / 1000);
  if (seconds < 60) return `retry in ${seconds} s`;
  return `retry in ${Math.ceil(ms / 60_000)} min`;
}
```

5. Replace the progress computation in `buildScopeHopsBlock` (from `const fill = input.fill;` to the end of its `if`) with:

```ts
const fill = input.fill;
const refusal = fill?.refusal ?? null;
let progress: ScopeHopsProgress | null = null;
if (refusal && refusal.providers.length > 0) {
  // While every candidate refuses, raising the cap would only defer more
  // papers, so the refusal wins over Fetch more (ADR 0013).
  const names = refusal.providers.map((provider) =>
    citationDataSourceLabel(provider),
  );
  progress = {
    afterHop: input.depth,
    text:
      names.length === 1
        ? `${names[0]} refusing`
        : `${COUNT_FORMAT.format(names.length)} providers refusing`,
    action: "stop",
    actionLabel: "Stop",
    countdown: { retryAt: refusal.retryAt },
    title: names.length === 1 ? null : names.join(", "),
  };
} else if (fill && (fill.remaining > 0 || fill.waiting > 0)) {
  progress =
    fill.remaining === 0
      ? {
          afterHop: input.depth,
          text: `${COUNT_FORMAT.format(HOP_EXPANSION_CAP)} expanded · ${COUNT_FORMAT.format(fill.waiting)} waiting`,
          action: "more",
          actionLabel: "Fetch more",
          countdown: null,
          title: null,
        }
      : {
          afterHop: input.depth,
          text: `expanding · ${COUNT_FORMAT.format(fill.remaining)} left`,
          action: fill.paused ? "resume" : "stop",
          actionLabel: fill.paused ? "Resume" : "Stop",
          countdown: null,
          title: null,
        };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --import ./test/nodeResolve.mjs --experimental-test-module-mocks --test test/unit/graphScopeRailModel.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, whole unit suite, format, commit**

```bash
npm run typecheck
npm run test:unit
npx prettier --write src/services/graphScopeRailModel.ts test/unit/graphScopeRailModel.test.ts
npx eslint src/services/graphScopeRailModel.ts test/unit/graphScopeRailModel.test.ts
git add src/services/graphScopeRailModel.ts test/unit/graphScopeRailModel.test.ts
git commit -m "B50: the rail's refusal line and its countdown words"
```

---

### Task 11: The rail counts down in place, and the Zotero case goes green

**Files:**

- Modify: `src/services/graphKeyRail.ts`: imports `:23-31`, `KeyRailOptions` `:161-174`, closure state `:229-231`, `progressLine` `:612-626`, `renderScope` `:673-682`, `destroy` `:718-724`

**Interfaces:**

- Consumes: `formatRetryIn`, `ScopeHopsProgress.countdown` / `.title` (Task 10); the whole chain (Tasks 1–9).
- Produces:
  - `KeyRailOptions.now?: () => number`
  - the DOM hook `.cm-scope-hop-countdown`
  - the progress line's `title` attribute

- [ ] **Step 1: Implement**

In `src/services/graphKeyRail.ts`:

1. The `./graphScopeRailModel` import gains `formatRetryIn`.
2. `KeyRailOptions` gains:

```ts
  /**
   * The clock the refusal countdown reads (B50). Date.now unless a harness
   * drives its own.
   */
  now?: () => number;
```

3. After `let lastScopeSignature: string | null = null;`, add:

```ts
/** The refusal countdown's one interval, while a countdown is drawn. */
let countdownTimer: number | null = null;
const now = options.now ?? (() => Date.now());
const clearCountdown = (): void => {
  if (countdownTimer === null) return;
  document.defaultView?.clearInterval(countdownTimer);
  countdownTimer = null;
};
```

4. `progressLine` becomes:

```ts
function progressLine(progress: ScopeHopsProgress): HTMLElement {
  const line = element(document, "p", "cm-scope-hop-progress");
  if (progress.title) line.title = progress.title;
  line.append(text(document, "span", progress.text));
  const countdown = progress.countdown;
  if (countdown) {
    // Only this span changes each second. The model's `retryAt` is fixed,
    // so its signature holds, the Scope section is not rebuilt, and focus
    // stays on Stop while the countdown runs (B50).
    const span = text(
      document,
      "span",
      formatRetryIn(countdown.retryAt - now()),
      "cm-scope-hop-countdown",
    );
    line.append(text(document, "span", " · "), span);
    const view = document.defaultView;
    if (view) {
      countdownTimer = view.setInterval(() => {
        span.textContent = formatRetryIn(countdown.retryAt - now());
      }, 1000);
    }
  }
  // Its own class, not the hidden line's `cm-scope-show-all`: the two sit in
  // the same Scope section, and a `querySelector` for one must never answer
  // with the other (the progress line is rendered above it).
  const control = element(document, "button", "cm-scope-hop-action");
  control.type = "button";
  control.textContent = progress.actionLabel;
  control.addEventListener("click", () =>
    options.onScope.fillControl(progress.action),
  );
  line.append(text(document, "span", " · "), control);
  return line;
}
```

5. In `renderScope`, directly after `lastScopeSignature = signature;`, add `clearCountdown();`.
6. In `destroy`, add `clearCountdown();` as its first line.

- [ ] **Step 2: Typecheck, unit, lint**

Run: `npm run typecheck && npm run test:unit && npx eslint src/services/graphKeyRail.ts`
Expected: clean, all passing. The colour-literal rule applies to `graphKeyRail.ts`, and this adds no colour.

- [ ] **Step 3: Run the Zotero suite, green**

Run in the background: `npm test`, then wait for the task to exit.

Expected:

- "keeps the seed in the plan while every provider refuses, and fills once they answer" PASSES.
- Record the three live hop-fill cases' results: this is the before-and-after measure (before: 7/3 with the Citation hops suite alone).
- Record the whole run's counts (86 before this plan, now 87 cases).
- If the new case fails, read its assertion message before touching code. Use `superpowers:systematic-debugging`, and probe HTTP statuses before blaming code (memory `semantic-scholar-429s-fail-hop-suites`).
  - A case that reads "the line never read refusing" with the seed failed means a refusal still reached the 15 s timeout: check the Semantic Scholar queue's wait in the trace.

- [ ] **Step 4: Run it a second time**

Run `npm test` again once the first task has exited. Expected: the new case passes again. Record both runs' counts.

- [ ] **Step 5: Format, commit**

```bash
npx prettier --write src/services/graphKeyRail.ts
git add src/services/graphKeyRail.ts
git commit -m "B50: the rail counts the refusal down in place (Zotero case green)"
```

Put both suite runs' pass/fail counts in the commit body.

---

### Task 12: Records, and the XPI

**Files:**

- Create: `docs/adr/0013-a-refusal-is-not-a-failure.md`
- Modify: `docs/adr/0006-one-provider-per-hop-expansion.md` (append a line)
- Modify: `CONTEXT.md:119-122`
- Modify: `docs/superpowers/specs/2026-09-12-citation-hops-design.md:249-250`
- Modify: `docs/superpowers/specs/2026-09-15-hop-fill-refusals-design.md:4-6` (status)
- Modify: `docs/superpowers/handoffs/2026-09-08-roadmap.md`: B50 `:610-653`, new B63 after `:1046`, Manual verification after `:1686`, Zotero suite `:1692-1694`, Log (append)

**Interfaces:** documentation only.

- [ ] **Step 1: ADR 0013**

Create `docs/adr/0013-a-refusal-is-not-a-failure.md`:

```markdown
# A refusal is not a failure

A hop expansion whose provider answers HTTP 429 is refused, not failed: the
paper stays in the plan and nothing is stored for it. The fill does not retry
a 429. It moves the expansion at once to the next paging provider, still one
answering provider per expansion. The refusing provider sits out a window of
its own in that fill: 30 s, 1 min, 2 min, then every 5 min, reset by its next
answer and ended early by Resume. The fill waits only when every paging
provider is in a window, or every paper left is deferred behind one, with one
timer and nothing in flight. A refused snapshot with nothing collected is
never stored, on any path.

Refusals travel from the provider to the runner as a typed outcome
(`ProviderRefusedError`, then `refusedBy`, `skipped` and `answeredBy` on the
refresh's resolution), never inferred from timing, and the fill bypasses the
60 s provider register so the rail can always name who is refusing. A fill
also trusts an empty first page only with a lookup match or a reported count
behind it, since OpenCitations answers an unindexed DOI with an empty list.
This refines ADR 0006: the traffic ceiling per expansion becomes one refused
request per paging provider plus one lookup and one page. Rejected: a
provider-health register fed by timeouts, which cannot tell a refusal from a
slow answer, and failing a refused paper as before, which in a refusal storm
emptied the plan until the graph was reopened.
```

- [ ] **Step 2: ADR 0006, CONTEXT.md, the citation-hops spec, the B50 spec**

Append to `docs/adr/0006-one-provider-per-hop-expansion.md`:

```markdown
Refined by ADR 0013: a refused request per paging provider is the only
traffic added, and a refusing provider sits out a window instead of failing
the paper.
```

In `CONTEXT.md`, replace the **Failed** entry with:

```markdown
**Failed**:
A paper whose expansion in the current direction returned nothing usable this
session, and no provider refused or was skipped. It leaves the fill until the
graph is reopened.
_Avoid_: broken, stale, missing

**Refused**:
A paper whose expansion stored nothing because a provider answered "too many
requests" or was sitting out its cool-down. Not failed: it stays in the fill
and is asked again once that provider's cool-down ends.
_Avoid_: rate-limited paper, throttled, blocked
```

In `docs/superpowers/specs/2026-09-12-citation-hops-design.md`, after "A thrown provider error is logged, marks the paper failed for the session, and the runner moves on.", add: "A refusal (HTTP 429) is not a failure: see `2026-09-15-hop-fill-refusals-design.md`."

In `docs/superpowers/specs/2026-09-15-hop-fill-refusals-design.md`, change the status line to end "...; built {date} (plan `docs/superpowers/plans/2026-09-15-hop-fill-refusals.md`)", with the build's date.

- [ ] **Step 3: The roadmap**

1. B50: change `- [ ] B50` to `- [x] B50`, and append to its entry:

   > Built {date} from `docs/superpowers/plans/2026-09-15-hop-fill-refusals.md`. The fill no longer retries a 429, switches provider at once, sits a refusing provider out (30 s, 1 min, 2 min, then 5 min) and cools down only when nobody is left to ask, with the countdown on the rail; a refused snapshot is never stored (ADR 0013). The new Citation hops case wraps every provider in a 429 and passed in two runs ({counts}). The live hop cases went from 7/3 in the suite alone to {result}. D8 is next, on a measured fill.

   Fill in the date and the counts Task 11 recorded.

2. After the B62 entry (ends at "it is the suite's first case to open a detached window"), add:

```markdown
- [ ] B63 OpenCitations' metadata endpoint is gone. Found 2026-09-15 while
      planning B50: `opencitations.net/index/coci/api/v1/metadata/{doi}`
      redirects to `api.opencitations.net/index/v1/metadata/…`, which answers
      410 Gone ("deprecated and no longer available"). So
      `openCitationsProvider.lookup` never matches: every OpenCitations lookup
      reads `provider-error`, its counts never arrive, and a relationship
      refresh pages OpenCitations on the DOI with no count behind it. Since
      B50 a fill treats that unbacked empty page as a failure, so a paper
      OpenCitations lists no citers for is failed rather than stored empty.
      The citations and references endpoints still answer through the same
      redirect (200, and `[]` for a DOI they do not index). Not fixed: it
      wants the current API's metadata route.
```

3. At the end of the Manual verification section (after the B62 check), add:

```markdown
- [ ] B50: on your own profile (no Semantic Scholar key), seed a graph and
      fill it to hop 3 under Citers; note the landings per minute for D8.
      While Semantic Scholar refuses, the hop counts keep climbing and the
      line reads `expanding · {n} left`. If the line reads
      `… refusing · retry in …`, the countdown ticks without the rail
      flickering, Stop keeps focus under the keyboard, and Resume starts
      expanding at once.
```

4. In the Zotero suite section, replace the sentence ending "so a clean run is now 86, not yet seen whole." with the counts of Task 11's two runs, and note that B50 added the refusal case.

5. Append a Log line:

```markdown
- {date}: B50 built test first from its plan: 12 tasks, unit {n} passing,
  the Citation hops refusal case red then green in two runs ({counts}); the
  live hop cases {result}. ADR 0013 written, CONTEXT.md gained Refused. B63
  filed (OpenCitations metadata 410). One manual check added. XPI rebuilt
  last. Next: measure a hop-3 fill, then D8's brainstorm.
```

- [ ] **Step 4: Format, check, build, commit**

```bash
npx prettier --write docs/adr/0013-a-refusal-is-not-a-failure.md docs/adr/0006-one-provider-per-hop-expansion.md CONTEXT.md docs/superpowers/specs/2026-09-12-citation-hops-design.md docs/superpowers/specs/2026-09-15-hop-fill-refusals-design.md docs/superpowers/handoffs/2026-09-08-roadmap.md docs/superpowers/plans/2026-09-15-hop-fill-refusals.md
npm run build
git add docs/adr/0013-a-refusal-is-not-a-failure.md docs/adr/0006-one-provider-per-hop-expansion.md CONTEXT.md docs/superpowers/specs/2026-09-12-citation-hops-design.md docs/superpowers/specs/2026-09-15-hop-fill-refusals-design.md docs/superpowers/handoffs/2026-09-08-roadmap.md
git commit -m "B50: ADR 0013, CONTEXT.md Refused, B63 filed, roadmap bookkeeping"
```

Expected: `npm run build` runs lint, typecheck and unit, then builds the XPI; it is the last command that touches `build/`. No `npm test` may run after it.
