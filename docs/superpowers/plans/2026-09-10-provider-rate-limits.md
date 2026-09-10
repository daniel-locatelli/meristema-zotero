# Provider Rate Limits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Throttle every provider to the rate its plan actually grants, and
recover from a 429 with exponential backoff instead of one fixed retry.

**Architecture:** Two independent edits to two files. `providerExecutionPolicy`
loses its keyed/keyless branch and becomes a pure lookup over `STATIC_POLICY`.
`http.ts` gains a pure `backoffDelayMs` and a three-entry delay sequence, feeding
the `postponeProvider` call the retry loop already makes — no new wait is
introduced anywhere.

**Tech Stack:** TypeScript, `node:test` + `chai` unit tests run through
`test/nodeResolve.mjs`.

Spec: `docs/superpowers/specs/2026-09-10-provider-rate-limits-design.md`.
Backlog entries B9 and B10 in
`docs/superpowers/handoffs/2026-09-08-review-backlog.md`.

## Global Constraints

- Branch is `provider-rate-limits`, already created off `main` at `70dfd33`.
  The spec commit `97f93ff` is already on it.
- `npm run check` must be green before every commit. It runs prettier, eslint,
  `tsc --noEmit` twice and the unit suite (341 unit tests before this plan).
- Do **not** run `npm test` (the Zotero suite) during this plan. Both changes
  are pure logic with no UI path, and `npm test` deletes
  `.scaffold/build/meristema.xpi`.
- Semantic Scholar's grant, verbatim from its key application: "Rate limit: 1
  request per second, cumulative across all endpoints… Please set your rate
  limit to below this threshold to avoid rejected requests."
- OpenAlex returns 429 above **100 requests per second** at every
  authentication level; a free key's real limit is a daily budget of roughly
  10,000 list-and-filter calls.
- `Retry-After` handling and the `MAX_RETRY_AFTER_MS` (15 s) abandon are
  deliberate behaviour. Do not change either.
- Backoff must raise `postponeProvider`'s delay. It must not add a second,
  competing wait inside `requestJSON`.
- Unit tests import `src/` modules directly. Both
  `src/services/providerExecutionPolicy.ts` and `src/providers/http.ts` are
  import-safe with no `Zotero` global present — this was verified before the
  plan was written. A test that needs a stored preference stubs
  `globalThis.Zotero.Prefs` in `beforeEach` and restores it in `afterEach`.

## File Structure

- `src/services/providerExecutionPolicy.ts` — the single statement of each
  provider's rate. After Task 1 it reads no preferences and imports only a type.
- `src/providers/http.ts` — the per-provider queue and the retry loop. Gains one
  exported pure function, `backoffDelayMs`, next to the constants it reads.
- `test/unit/providerExecutionPolicy.test.ts` — new; asserts the rates as
  constraints, and that a stored key changes nothing.
- `test/unit/providerBackoff.test.ts` — new; asserts the backoff sequence's
  shape and bounds.

---

### Task 1: The policy stops reading keys (B9)

**Files:**

- Test: `test/unit/providerExecutionPolicy.test.ts` (create)
- Modify: `src/services/providerExecutionPolicy.ts` (the two imports, the
  `semantic-scholar` and `openalex` entries of `STATIC_POLICY`, and the body of
  `providerExecutionPolicy`)

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `providerExecutionPolicy(provider: CitationProviderID):
ProviderExecutionPolicy` — unchanged signature, now a pure lookup. Task 2 does
  not depend on it.

- [ ] **Step 1: Write the failing test**

Create `test/unit/providerExecutionPolicy.test.ts`:

```ts
import { afterEach, beforeEach, describe, it } from "node:test";
import { expect } from "chai";
import { config } from "../../package.json";
import type { CitationProviderID } from "../../src/domain/citationTypes";
import { providerExecutionPolicy } from "../../src/services/providerExecutionPolicy";

const PROVIDERS: CitationProviderID[] = [
  "crossref",
  "semantic-scholar",
  "opencitations",
  "inspire",
  "openalex",
];

const prefKey = (name: string): string => `${config.prefsPrefix}.${name}`;

let store: Record<string, unknown> = {};
let previousZotero: unknown;

/** Requests per second a policy allows once its queue is saturated. */
function requestsPerSecond(provider: CitationProviderID): number {
  const policy = providerExecutionPolicy(provider);
  return policy.requestParallelism / (policy.minimumStartDelayMs / 1000);
}

beforeEach(function () {
  previousZotero = (globalThis as Record<string, unknown>).Zotero;
  store = {};
  (globalThis as Record<string, unknown>).Zotero = {
    Prefs: {
      get: (name: string) => store[name],
      set: (name: string, value: unknown) => {
        store[name] = value;
      },
    },
  };
});

afterEach(function () {
  (globalThis as Record<string, unknown>).Zotero = previousZotero;
});

describe("Provider execution policy", function () {
  it("keeps Semantic Scholar under the one request per second its plan grants", function () {
    // The plan is "1 request per second, cumulative across all endpoints",
    // and the application asks the applicant to sit below that threshold.
    const policy = providerExecutionPolicy("semantic-scholar");
    expect(policy.requestParallelism).to.equal(1);
    expect(policy.minimumStartDelayMs).to.be.at.least(1000);
  });

  it("returns the same Semantic Scholar policy with a key as without one", function () {
    // B9: a key buys batch and page size and a private quota, never speed.
    const keyless = providerExecutionPolicy("semantic-scholar");
    store[prefKey("semanticScholarAPIKey")] = "a-real-looking-key";
    expect(providerExecutionPolicy("semantic-scholar")).to.deep.equal(keyless);
  });

  it("returns the same OpenAlex policy with a key as without one", function () {
    const keyless = providerExecutionPolicy("openalex");
    store[prefKey("openAlexAPIKey")] = "a-real-looking-key";
    expect(providerExecutionPolicy("openalex")).to.deep.equal(keyless);
  });

  it("keeps OpenAlex an order of magnitude under its documented ceiling", function () {
    // OpenAlex returns 429 above 100 requests per second at every
    // authentication level; its real limit is a daily budget.
    expect(requestsPerSecond("openalex")).to.be.at.most(10);
  });

  it("gives every provider a policy", function () {
    for (const provider of PROVIDERS) {
      const policy = providerExecutionPolicy(provider);
      expect(policy.requestParallelism, provider).to.be.at.least(1);
      expect(policy.minimumStartDelayMs, provider).to.be.at.least(0);
      expect(policy.batchSize, provider).to.be.at.least(1);
      expect(policy.relationshipPageSize, provider).to.be.at.least(1);
    }
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npm run test:unit`

Expected: exactly two failures, both in "Provider execution policy":

- "returns the same Semantic Scholar policy with a key as without one" — a
  deep-equal failure, the keyed side showing `requestParallelism: 2,
minimumStartDelayMs: 150` against the keyless `1` and `1100`.
- "returns the same OpenAlex policy with a key as without one" — the same
  shape, `minimumStartDelayMs: 250` against `1100`.

Those two are B9 itself, watched red. The other three pass already: with an
empty `store` the keyless overrides apply, which is the rate the plugin runs at
today.

If either of those two passes instead, stop — the `Zotero.Prefs` stub is not
reaching `citationPreferences` and the test is asserting nothing.

- [ ] **Step 3: Make the policy a pure lookup**

Replace the two imports at the top of
`src/services/providerExecutionPolicy.ts`:

```ts
import type { CitationProviderID } from "../domain/citationTypes";
```

(delete the `import { getOpenAlexAPIKey, getSemanticScholarAPIKey } from "./citationPreferences";` block entirely).

Replace the `semantic-scholar` and `openalex` entries of `STATIC_POLICY` with
these, comments included:

```ts
  // Semantic Scholar grants 1 request per second, cumulative across all
  // endpoints, keyed or keyless, and asks applicants to stay below it. A key
  // buys the batch and page sizes and a private quota, never speed.
  "semantic-scholar": {
    batchSize: 500,
    requestParallelism: 1,
    minimumStartDelayMs: 1100,
    relationshipPageSize: 200,
  },
```

```ts
  // OpenAlex returns 429 above 100 requests per second at every
  // authentication level, so ~8/s is an order of magnitude inside the rate.
  // Its real limit is a daily budget — roughly 10,000 list-and-filter calls
  // on a free key — which no per-second number can defend.
  openalex: {
    batchSize: 100,
    requestParallelism: 2,
    minimumStartDelayMs: 250,
    relationshipPageSize: 100,
  },
```

Replace the whole `providerExecutionPolicy` function, doc comment included:

```ts
/**
 * Internal provider policy. These values are deliberately not user settings:
 * each API has different request, payload, and rate-limit characteristics.
 *
 * A stored API key does not appear here on purpose. It used to raise the rate
 * for Semantic Scholar and OpenAlex, which was backlog B9: Semantic Scholar's
 * authenticated plan is the same 1 request per second as its keyless one, and
 * OpenAlex refuses every request without a key, so it has no keyless path to
 * be slower than. Each entry of STATIC_POLICY is the rate its provider grants.
 */
export function providerExecutionPolicy(
  provider: CitationProviderID,
): ProviderExecutionPolicy {
  return STATIC_POLICY[provider];
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npm run test:unit`

Expected: PASS, with five more tests than before (346 total, up from 341).

- [ ] **Step 5: Run the full gate**

Run: `npm run check`

Expected: green. If eslint reports an unused import, the
`citationPreferences` import block was not fully deleted.

- [ ] **Step 6: Commit**

```bash
git add src/services/providerExecutionPolicy.ts test/unit/providerExecutionPolicy.test.ts
git commit -m "Throttle to the rate a key actually grants

Semantic Scholar's authenticated plan is 1 request per second cumulative,
the same rate the keyless path already ran at, and OpenAlex refuses every
request without a key so it has no keyless path at all. The keyed/keyless
branch had no case left in which it was true, so it is gone rather than
retuned, and the policy no longer reads a preference.

Closes B9.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa"
```

---

### Task 2: Exponential backoff with upward jitter (B10)

**Files:**

- Test: `test/unit/providerBackoff.test.ts` (create)
- Modify: `src/providers/http.ts` (`RETRY_DELAYS_MS`, `MAX_RETRY_AFTER_MS`, a
  new `backoffDelayMs`, and the two retry-delay call sites inside `requestJSON`)

**Interfaces:**

- Consumes: nothing from Task 1.
- Produces: `backoffDelayMs(attempt: number, random?: () => number): number`
  and `MAX_RETRY_AFTER_MS: number`, both exported from `src/providers/http.ts`.

- [ ] **Step 1: Write the failing test**

Create `test/unit/providerBackoff.test.ts`:

```ts
import { describe, it } from "node:test";
import { expect } from "chai";
import { MAX_RETRY_AFTER_MS, backoffDelayMs } from "../../src/providers/http";

const ATTEMPTS = [0, 1, 2];

describe("Provider retry backoff", function () {
  it("grows exponentially: each attempt starts after the last one could end", function () {
    for (const attempt of ATTEMPTS.slice(1)) {
      const shortest = backoffDelayMs(attempt, () => 0);
      const previousLongest = backoffDelayMs(attempt - 1, () => 1);
      expect(shortest, `attempt ${attempt}`).to.be.greaterThan(previousLongest);
    }
  });

  it("jitters upward only, never below the base delay", function () {
    for (const attempt of ATTEMPTS) {
      const base = backoffDelayMs(attempt, () => 0);
      expect(
        backoffDelayMs(attempt, () => 1),
        `attempt ${attempt}`,
      ).to.equal(base * 1.25);
      expect(
        backoffDelayMs(attempt, () => 0.5),
        `attempt ${attempt}`,
      ).to.equal(base * 1.125);
    }
  });

  it("starts at one second and reaches four", function () {
    expect(backoffDelayMs(0, () => 0)).to.equal(1000);
    expect(backoffDelayMs(2, () => 0)).to.equal(4000);
  });

  it("never exceeds the clamp postponeProvider would apply anyway", function () {
    // A delay above MAX_RETRY_AFTER_MS would be silently truncated by
    // postponeProvider, which would make the sequence a lie.
    for (const attempt of ATTEMPTS) {
      expect(
        backoffDelayMs(attempt, () => 1),
        `attempt ${attempt}`,
      ).to.be.at.most(MAX_RETRY_AFTER_MS);
    }
  });

  it("falls back to the last delay past the end of the sequence", function () {
    expect(backoffDelayMs(99, () => 0)).to.equal(backoffDelayMs(2, () => 0));
  });

  it("uses Math.random when no source is given", function () {
    const delay = backoffDelayMs(0);
    expect(delay).to.be.at.least(1000);
    expect(delay).to.be.at.most(1250);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npm run test:unit`

Expected: the whole file fails to load, with
`SyntaxError: The requested module '../../src/providers/http' does not provide
an export named 'MAX_RETRY_AFTER_MS'` (or `backoffDelayMs`). That is the
correct red for a function that does not exist yet.

- [ ] **Step 3: Add the sequence and the pure function**

In `src/providers/http.ts`, replace the `RETRY_DELAYS_MS` declaration and its
comment, and the `MAX_RETRY_AFTER_MS` declaration:

```ts
// Exponential backoff for a 429 or 5xx that carries no Retry-After: four
// attempts in all, delaying the provider by roughly 1s, 2s then 4s. Semantic
// Scholar's key application asks applicants to commit to exactly this.
const RETRY_DELAYS_MS = [1000, 2000, 4000];
const REQUEST_TIMEOUT_MS = 15000;
export const MAX_RETRY_AFTER_MS = 15000;
```

Then add, directly below `MAX_RETRY_AFTER_MS`'s block of constants and above
`export function registerProviderJSONResponseObserver`:

```ts
/**
 * Delay before retry `attempt`, jittered upward by up to a quarter.
 *
 * The delay postpones the whole provider rather than the one request, which is
 * the right level for a shared rate limit — so jitter may only ever lengthen
 * it. Full jitter, which can shorten a wait, exists to de-correlate clients
 * that would otherwise retry in lockstep; a per-provider queue already does
 * that, and a shortened delay here would let every queued request resume
 * before the backoff intended.
 */
export function backoffDelayMs(
  attempt: number,
  random: () => number = Math.random,
): number {
  const index = Math.min(
    Math.max(0, Math.floor(attempt)),
    RETRY_DELAYS_MS.length - 1,
  );
  const base = RETRY_DELAYS_MS[index];
  return Math.min(MAX_RETRY_AFTER_MS, base * (1 + random() * 0.25));
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npm run test:unit`

Expected: PASS, six more tests than after Task 1 (352 total).

- [ ] **Step 5: Feed the retry loop from it**

Two call sites inside `requestJSON`, both currently reading
`RETRY_DELAYS_MS[attempt]` directly. In the `retryable` branch:

```ts
postponeProvider(provider, retryAfter ?? backoffDelayMs(attempt));
continue;
```

and in the `catch` branch:

```ts
if (attempt < retryLimit) {
  postponeProvider(provider, backoffDelayMs(attempt));
  continue;
}
```

Change nothing else in the loop. `retryLimit` is still derived from
`RETRY_DELAYS_MS.length`, so it becomes 3 and the loop makes four attempts;
`options.retryLimit` keeps its meaning, and `relatedWorkSummaryService.ts`'s
`retryLimit: 0` still means "do not retry". `parseRetryAfter`, the
`retryAfter > MAX_RETRY_AFTER_MS` abandon, and `postponeProvider`'s clamp are
untouched.

- [ ] **Step 6: Run the full gate**

Run: `npm run check`

Expected: green, 352 unit tests.

- [ ] **Step 7: Commit**

```bash
git add src/providers/http.ts test/unit/providerBackoff.test.ts
git commit -m "Back off exponentially instead of retrying once

A 429 used to get one retry at a fixed 1.5 seconds. It now gets three,
delaying the provider by roughly 1s, 2s and 4s with jitter that only ever
lengthens the wait — the delay holds the whole provider, so a shrinking
jitter would let it resume early.

The delay still goes through postponeProvider, so no second wait is added
inside requestJSON, and Retry-After still wins when a response carries one.

Closes B10.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa"
```

---

### Task 3: Tick the roadmap and land the branch

**Files:**

- Modify: `docs/superpowers/handoffs/2026-09-08-roadmap.md` (the two Filler
  entries and the Log)

**Interfaces:**

- Consumes: Tasks 1 and 2 committed on `provider-rate-limits`.
- Produces: nothing code depends on.

- [ ] **Step 1: Tick both entries**

In the "Filler, any time after Stage 1" list, change the B9 line's `- [ ]` to
`- [x]` and the B10 line's `- [ ]` to `- [x]`. Leave both entries' wording
alone — they say why the items existed.

- [ ] **Step 2: Append the log line**

At the end of the `## Log` section, add:

```markdown
- 2026-09-10: B9 and B10 ticked, one branch (`provider-rate-limits`,
  97f93ff..): the providers' own numbers came back and settled it. Semantic
  Scholar's authenticated grant is 1 request per second cumulative — the rate
  the keyless path already ran at — and OpenAlex returns 401 without a key, so
  it has no keyless path at all. "A key means go faster" had no case left in
  which it was true, so the branch is deleted rather than retuned and
  `providerExecutionPolicy` reads no preference. A 429 now gets three retries
  at roughly 1s, 2s and 4s with jitter that only lengthens the wait, through
  the `postponeProvider` delay the loop already applied, so no second wait
  competes inside `requestJSON`; `Retry-After` and the 15 s abandon are
  unchanged. Spec:
  `docs/superpowers/specs/2026-09-10-provider-rate-limits-design.md`. Pure
  logic, unit-tested end to end; nothing was added to the manual batch.
```

- [ ] **Step 3: Run the full gate**

Run: `npm run check`

Expected: green (prettier checks markdown too, so a long line in the log may
need rewrapping).

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/handoffs/2026-09-08-roadmap.md
git commit -m "Tick B9 and B10

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012QcQDybq8ac6xQ1bmCjzQa"
```

- [ ] **Step 5: Fast-forward to main and push**

```bash
git checkout main
git merge --ff-only provider-rate-limits
git push
```

Expected: `Fast-forward` and a clean push. If the merge is not a
fast-forward, `main` moved; rebase `provider-rate-limits` onto it and rerun
`npm run check` before merging.

- [ ] **Step 6: Rebuild the XPI**

Run: `npm run build`

Expected: `.scaffold/build/meristema.xpi` written. `npm test` was never run in
this plan, so nothing deleted it; build last regardless.

---

## Manual verification

Nothing is appended to the roadmap's Manual verification section by this plan.
Both changes are pure logic covered end to end by unit tests, and neither has a
surface in Zotero. The one thing that would need a human — that a real
Semantic Scholar key produces no 429s — cannot be checked until a key exists,
and the entire point of landing B9 first is that the key can then be pasted
without breaking anything.
