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
/**
 * Response headers for each response in turn, keyed by lower-cased header
 * name; a response with nothing queued (or an unqueried header) answers
 * `null`, matching the existing fake's behaviour.
 */
let headers: Array<Record<string, string>> = [];
let previousZotero: unknown;

beforeEach(function () {
  previousZotero = (globalThis as Record<string, unknown>).Zotero;
  attempts = [];
  statuses = [];
  headers = [];
  resetCitationRequestCancellation();
  (globalThis as Record<string, unknown>).Zotero = {
    Prefs: { get: () => undefined, set: () => undefined },
    debug: () => undefined,
    HTTP: {
      request: async (_method: string, url: string) => {
        attempts.push({ url, at: Date.now() });
        const status = statuses.shift() ?? 200;
        const responseHeaders = headers.shift() ?? {};
        return {
          status,
          responseText: status === 200 ? "[]" : "",
          getResponseHeader: (name: string) =>
            responseHeaders[name.toLowerCase()] ?? null,
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

  it("postpones by the backoff, not by a Retry-After, on a refusal", async function () {
    // A 20 s Retry-After is far past the 15 s the queue clamps to. If it were
    // honoured, the second request would start ~15000 ms after the first
    // (clamped) or ~20000 ms (unclamped); the backoff alone starts it well
    // under 5000 ms after allowing for jitter.
    statuses = [429, 200];
    headers = [{ "retry-after": "20" }];
    await requestJSON("opencitations", "https://example.test/first", {
      retryRefusals: false,
    });
    await requestJSON("opencitations", "https://example.test/second", {
      retryRefusals: false,
    });
    expect(attempts.length).to.equal(2);
    const gap = attempts[1].at - attempts[0].at;
    expect(gap, "queue still postponed by the backoff").to.be.at.least(950);
    expect(gap, "Retry-After not honoured").to.be.below(5000);
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
