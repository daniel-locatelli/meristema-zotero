import { describe, it } from "node:test";
import { expect } from "chai";

import {
  HYDRATION_ATTEMPTS_PER_SESSION,
  mayQueueHydration,
} from "../../src/services/hydrationAttempts";

describe("hydration attempts per session (D11)", function () {
  it("queues a paper never asked, and once more after a first attempt", function () {
    expect(mayQueueHydration(0)).to.equal(true);
    expect(mayQueueHydration(1)).to.equal(true);
  });

  it("waits for a Refresh after the second", function () {
    expect(HYDRATION_ATTEMPTS_PER_SESSION).to.equal(2);
    expect(mayQueueHydration(2)).to.equal(false);
    expect(mayQueueHydration(5)).to.equal(false);
  });
});
