# Provider Rate Limits: Throttle to the Plan, Back Off When It Bites

**Date:** 2026-09-10
**Status:** Approved 2026-09-10

Closes backlog entries B9 and B10
(`docs/superpowers/handoffs/2026-09-08-review-backlog.md`). One spec covers
both because they are two halves of one behaviour: throttling keeps requests
under a provider's limit, and backoff is what recovers when the limit is hit
anyway.

Neither is a user report. B9 breaks nothing today because no key is entered;
it breaks on the day one is pasted, which is why it lands **before** the user
enters a Semantic Scholar key. B10 makes the code match a commitment already
ticked on Semantic Scholar's key application.

## Problem

### B9: a key is treated as permission to speed up

`providerExecutionPolicy.ts` reads the stored API keys and returns a slower
policy when a key is absent:

```ts
if (provider === "semantic-scholar" && !getSemanticScholarAPIKey()) {
  return { ...base, requestParallelism: 1, minimumStartDelayMs: 1100 };
}
```

So the keyless Semantic Scholar path is one request in flight with at least
1100 ms between starts — inside the limit. With a key,
`STATIC_POLICY["semantic-scholar"]` applies: `requestParallelism: 2`,
`minimumStartDelayMs: 150`, which starts roughly six or seven requests a
second.

Semantic Scholar's authenticated grant, quoted from the key application:

> Rate limit: 1 request per second, cumulative across all endpoints. This
> means that in a given second you may send only 1 request to our system and
> expect a successful response. Please set your rate limit to below this
> threshold to avoid rejected requests.

Entering a key would therefore take the plugin from comfortably inside the
limit to several times over it, and the key's owner would see 429s where they
saw none.

The same override exists for OpenAlex, where it is dead code:
`openAlexProvider.ts` returns a 401 result without ever calling `requestJSON`
when no key is configured, so the keyless branch has never run.

### B10: one fixed retry is all a 429 gets

`http.ts` has `RETRY_DELAYS_MS = [1500]` — a single retry at a fixed 1.5
seconds, whatever the failure. `Retry-After` is honoured, clamped at
`MAX_RETRY_AFTER_MS` (15 s), and a request whose header asks for longer is
abandoned rather than left to freeze every request queued behind one
unavailable provider. That behaviour is deliberate and stays.

What is missing is exponential backoff with jitter across several attempts
for a 429 or a 5xx that carries no `Retry-After` — which is exactly what
Semantic Scholar's key application asks an applicant to commit to.

## The rates each provider actually grants

Settled with the user on 2026-09-10, from the providers' own documentation.

**Semantic Scholar**, authenticated: 1 request per second, cumulative across
all endpoints, and the application asks the applicant to sit _below_ that
threshold. Unauthenticated traffic goes to a shared pool with no per-user
guarantee, which the existing 1100 ms already respects.

**OpenAlex**, free API key (`help.openalex.org/api/authentication/` and
`/access/example-costs/`): 429 is returned for exceeding **100 requests per
second** — the same ceiling at every authentication level — or for exhausting
the **daily budget**, which a free key sets at roughly 10,000 list-and-filter
calls or 1,000 search calls a day. The binding constraint is the daily
budget, not the per-second rate, and no per-second number defends a daily
budget.

## Design

### B9: delete the concept, do not re-tune it

Semantic Scholar's keyed rate turns out to be _identical_ to its keyless one.
A key buys `batchSize: 500`, `relationshipPageSize: 200` and a private quota;
it does not buy speed. OpenAlex has no keyless path at all. So there is no
case left in which "a key means go faster" is true.

`providerExecutionPolicy` becomes a pure lookup:

```ts
export function providerExecutionPolicy(
  provider: CitationProviderID,
): ProviderExecutionPolicy {
  return STATIC_POLICY[provider];
}
```

Both keyless overrides are deleted, and with them the module's imports from
`citationPreferences` — the policy no longer reads a preference at all.
`STATIC_POLICY` becomes the single statement of the rates, with the plan each
number matches recorded beside it so the next reader does not tune it back up:

| provider         | parallelism | gap     | why                                                                      |
| ---------------- | ----------- | ------- | ------------------------------------------------------------------------ |
| semantic-scholar | 1           | 1100 ms | 1 req/s cumulative, keyed or not, with the headroom the plan asks for    |
| openalex         | 2           | 250 ms  | ~8 req/s against a 100 req/s ceiling; the real limit is the daily budget |

The other three providers (`crossref`, `opencitations`, `inspire`) never had
an override and are unchanged.

Re-tuning the keyed Semantic Scholar numbers to 1/1100 while keeping the
branch was considered and rejected: it leaves a live code path asserting a
distinction that does not exist, which is how B9 comes back.

### B10: raise the provider's postponement, do not add a second wait

The shape in `requestJSON` is already right and does not change.
`postponeProvider` delays the whole provider rather than the one request,
which is the correct level for a shared rate limit; the retry loop postpones,
`continue`s, and the next `runInProviderQueue` blocks on the queue's
`nextStartAt`. Backoff raises that delay. It must not introduce a competing
wait inside `requestJSON`, and it does not.

Three changes:

1. **The sequence.** `RETRY_DELAYS_MS` becomes `[1000, 2000, 4000]` — four
   attempts in total, three retries. The array still drives `retryLimit`, so
   `options.retryLimit` keeps its meaning; the one caller that passes it
   (`relatedWorkSummaryService.ts`, `retryLimit: 0`) is unaffected.

2. **Jitter, upward only.** A new pure function in `http.ts`:

   ```ts
   export function backoffDelayMs(
     attempt: number,
     random = Math.random,
   ): number;
   ```

   It returns `base * (1 + random() * 0.25)` for `base = RETRY_DELAYS_MS[attempt]`,
   clamped to `MAX_RETRY_AFTER_MS`, and falls back to the last base delay for
   an attempt past the end of the array. Jitter only ever lengthens the wait.
   The usual full-jitter argument — de-correlating clients that would
   otherwise retry in lockstep — is about _per-client_ spread, and a
   provider-wide queue already provides that; jitter that could shrink the
   delay would instead let the whole provider resume earlier than the backoff
   intended.

3. **Both retry paths use it.** The `retryable` branch (status 0, 429, or
   5xx with no usable `Retry-After`) and the `catch` branch (a thrown network
   error) both call `backoffDelayMs(attempt)` where they read
   `RETRY_DELAYS_MS[attempt]` today.

`Retry-After` still takes precedence when the response carries one, and a
`Retry-After` longer than `MAX_RETRY_AFTER_MS` still abandons the request.
Worst-case backoff is 5 s (4000 × 1.25), comfortably inside the 15 s clamp, so
the two rules never fight: no backoff delay can be truncated by the clamp, and
none can trip the abandon threshold.

### Decided, not overlooked

**Backoff state is per request, not per provider.** Two concurrent requests
that both take a 429 each call `postponeProvider`, and its
`Math.max(state.nextStartAt, …)` means the longer postponement wins and no
call ever shortens an existing one. A shared per-provider escalation counter
would be more precise about the third concurrent failure, and is not worth a
new piece of mutable module state for a queue whose parallelism is 1 or 2.

**The daily budget is not enforced.** OpenAlex's real limit is a budget per
day; the plugin has no counter for it and this spec does not add one. If a
user exhausts it, OpenAlex returns 429 and the new backoff is what responds.
Recording it here so the next reader knows the gap is known rather than
missed.

**Three retries overturns an earlier decision, deliberately.** `http.ts` used
to carry a comment, now deleted, that read: "One bounded retry is enough for
interactive updates. Multiple 30-second retries used to block every request
queued behind one unavailable provider." That was a real decision, not an
oversight: the alternative on the table at the time was several retries at a
fixed 30 seconds apiece, long enough that one unreachable provider could
freeze every request queued behind it, so the limit was cut to one retry to
keep that from happening. `[1000, 2000, 4000]` is a different shape of
problem — it tops out at 4 seconds before jitter, nowhere near the
30-second retries the old comment was guarding against, which is why three
retries does not resurrect the failure mode that justified the earlier limit.
It still costs more than one retry did. `REQUEST_TIMEOUT_MS` is 15 s per
attempt and status 0 is retryable, so an unreachable provider now costs up
to 4 × 15 s = 60 s per request instead of 2 × 15 s = 30 s, and each failing
request pushes the provider's `nextStartAt` forward by roughly 8.75 s of
backoff instead of 1.5 s. That increase is accepted, not waved away, because
it buys the provider genuine room to recover from a transient 429 instead of
giving up after one try.

## Testing

Both changes are pure logic, so unit tests cover them end to end and nothing
here needs checking by hand in Zotero.

`test/unit/providerExecutionPolicy.test.ts`:

- Semantic Scholar's policy is one request in flight with at least 1000 ms
  between starts — asserted as a rate (`parallelism === 1` and
  `minimumStartDelayMs >= 1000`), so the test states the plan's constraint
  rather than restating a literal.
- The same policy is returned whether or not a Semantic Scholar key is stored:
  the regression test for B9 proper.
- The same for OpenAlex, whose policy must not depend on a stored key either.
- OpenAlex stays under its documented ceiling: `parallelism /
(minimumStartDelayMs / 1000)` is well below 100 req/s.
- No provider is missing from `STATIC_POLICY`.

`test/unit/providerBackoff.test.ts`:

- `backoffDelayMs` grows across attempts: each attempt's minimum exceeds the
  previous attempt's maximum, which pins the sequence as genuinely
  exponential rather than merely increasing on average.
- With `random` stubbed to 0 it returns the base delay exactly; with `random`
  stubbed to 1 it returns `base * 1.25`. Jitter never shortens the wait.
- Every attempt's maximum is at or under `MAX_RETRY_AFTER_MS`, so no backoff
  is silently truncated by `postponeProvider`'s clamp.
- An attempt index past the end of the array returns the last base delay
  rather than `NaN`.

`MAX_RETRY_AFTER_MS` is exported for the tests to assert against; it is
otherwise module-private today.

## Files

- `src/services/providerExecutionPolicy.ts` — `STATIC_POLICY` values and
  comments; both keyless overrides and the `citationPreferences` imports
  deleted.
- `src/providers/http.ts` — `RETRY_DELAYS_MS`, the new `backoffDelayMs`, the
  two retry-delay call sites, and the `MAX_RETRY_AFTER_MS` export.
- `test/unit/providerExecutionPolicy.test.ts` — new.
- `test/unit/providerBackoff.test.ts` — new.
