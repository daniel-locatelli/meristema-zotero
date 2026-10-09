import { describe, it } from "node:test";
import { expect } from "chai";

import {
  EMPTY_STATUS_SLOT,
  expireTransient,
  postStatus,
  shownStatus,
} from "../../src/services/graphStatusSlot";

const STICKY = "This graph is read-only";

describe("graph status slot", function () {
  it("shows a sticky message until it is cleared", function () {
    const slot = postStatus(EMPTY_STATUS_SLOT, STICKY, { sticky: true });
    expect(shownStatus(slot)).to.equal(STICKY);
    expect(shownStatus(expireTransient(slot))).to.equal(STICKY);
    expect(shownStatus(postStatus(slot, null))).to.equal(null);
  });

  it("shows a transient message over the sticky one, then restores it", function () {
    let slot = postStatus(EMPTY_STATUS_SLOT, STICKY, { sticky: true });
    slot = postStatus(slot, "Copied");
    expect(shownStatus(slot)).to.equal("Copied");
    slot = expireTransient(slot);
    expect(shownStatus(slot)).to.equal(STICKY);
  });

  it("leaves nothing when a transient expires with no sticky behind it", function () {
    const slot = postStatus(EMPTY_STATUS_SLOT, "Saved");
    expect(shownStatus(slot)).to.equal("Saved");
    expect(shownStatus(expireTransient(slot))).to.equal(null);
  });

  it("keeps a transient up over a new sticky, which wins after it expires", function () {
    let slot = postStatus(EMPTY_STATUS_SLOT, "Old notice", { sticky: true });
    slot = postStatus(slot, "Copied");
    slot = postStatus(slot, STICKY, { sticky: true });
    expect(shownStatus(slot)).to.equal("Copied");
    expect(shownStatus(expireTransient(slot))).to.equal(STICKY);
  });

  it("leaves nothing when the sticky is cleared during a transient", function () {
    let slot = postStatus(EMPTY_STATUS_SLOT, STICKY, { sticky: true });
    slot = postStatus(slot, "Saved");
    slot = postStatus(slot, null);
    expect(shownStatus(slot)).to.equal(null);
    expect(shownStatus(expireTransient(slot))).to.equal(null);
  });

  it("treats an empty message as a clear", function () {
    const slot = postStatus(EMPTY_STATUS_SLOT, STICKY, { sticky: true });
    expect(shownStatus(postStatus(slot, ""))).to.equal(null);
  });

  it("lets a later transient replace an earlier one", function () {
    let slot = postStatus(EMPTY_STATUS_SLOT, STICKY, { sticky: true });
    slot = postStatus(slot, "Copied");
    slot = postStatus(slot, "Saved");
    expect(shownStatus(slot)).to.equal("Saved");
    expect(shownStatus(expireTransient(slot))).to.equal(STICKY);
  });
});
