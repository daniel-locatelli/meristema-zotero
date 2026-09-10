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

  it("starts at one second, doubles, and reaches four", function () {
    expect(backoffDelayMs(0, () => 0)).to.equal(1000);
    expect(backoffDelayMs(1, () => 0)).to.equal(2000);
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
