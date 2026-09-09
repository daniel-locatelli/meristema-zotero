import { describe, it } from "node:test";
import { expect } from "chai";
import {
  allocateSwatches,
  emptySwatchLedger,
  swatchIndexFor,
} from "../../src/services/graphSwatchLedger";

describe("the swatch ledger", function () {
  it("gives a new key the lowest free index", function () {
    const first = allocateSwatches(emptySwatchLedger(), ["a", "b"], 8);
    expect(swatchIndexFor(first, "a")).to.equal(0);
    expect(swatchIndexFor(first, "b")).to.equal(1);
  });

  it("holds a key's index while the key lives, whatever else arrives", function () {
    // This is B12: a folder's colour must not move when another is ticked.
    const first = allocateSwatches(emptySwatchLedger(), ["phd"], 8);
    const second = allocateSwatches(first, ["dokwood", "phd"], 8);
    expect(swatchIndexFor(second, "phd")).to.equal(0);
    expect(swatchIndexFor(second, "dokwood")).to.equal(1);
  });

  it("does not depend on the order keys are presented in", function () {
    const left = allocateSwatches(emptySwatchLedger(), ["a", "b"], 8);
    const right = allocateSwatches(left, ["b", "a"], 8);
    expect(right.assigned).to.deep.equal(left.assigned);
  });

  it("frees an index when its key goes, and reuses it", function () {
    const first = allocateSwatches(emptySwatchLedger(), ["a", "b"], 8);
    const second = allocateSwatches(first, ["b"], 8);
    expect(swatchIndexFor(second, "a")).to.equal(null);
    const third = allocateSwatches(second, ["b", "c"], 8);
    expect(swatchIndexFor(third, "c")).to.equal(0);
    expect(swatchIndexFor(third, "b")).to.equal(1);
  });

  it("reuses the longest-released index first", function () {
    const full = allocateSwatches(emptySwatchLedger(), ["a", "b", "c"], 3);
    const lost = allocateSwatches(full, ["c"], 3); // a released, then b
    const refilled = allocateSwatches(lost, ["c", "d", "e"], 3);
    expect(swatchIndexFor(refilled, "d")).to.equal(0); // a's, released first
    expect(swatchIndexFor(refilled, "e")).to.equal(1); // b's
  });

  it("shares an index only once the pool is exhausted, oldest holder first", function () {
    // Six seeds hold the whole palette; the seventh must double up rather than
    // repaint anyone, and it doubles with the oldest live holder.
    const full = allocateSwatches(emptySwatchLedger(), ["s1", "s2"], 2);
    const over = allocateSwatches(full, ["s1", "s2", "s3"], 2);
    expect(swatchIndexFor(over, "s1")).to.equal(0);
    expect(swatchIndexFor(over, "s2")).to.equal(1);
    expect(swatchIndexFor(over, "s3")).to.equal(0);
  });

  it("keeps live keys stable through two separate releases before refill", function () {
    // A key released a call or more ago must not be able to disturb a live
    // key's index just because its own original slot is no longer recorded
    // anywhere in the state that reached this call.
    const full = allocateSwatches(emptySwatchLedger(), ["a", "b", "c", "d"], 4);
    const droppedC = allocateSwatches(full, ["a", "b", "d"], 4);
    const droppedA = allocateSwatches(droppedC, ["b", "d"], 4);
    const refilled = allocateSwatches(droppedA, ["b", "d", "e", "f"], 4);
    expect(swatchIndexFor(refilled, "b")).to.equal(1);
    expect(swatchIndexFor(refilled, "d")).to.equal(3);
    expect(swatchIndexFor(refilled, "e")).to.equal(0);
    expect(swatchIndexFor(refilled, "f")).to.equal(2);
  });

  it("never mutates the state it was given", function () {
    const first = allocateSwatches(emptySwatchLedger(), ["a"], 8);
    const snapshot = JSON.stringify(first);
    allocateSwatches(first, ["a", "b", "c"], 8);
    expect(JSON.stringify(first)).to.equal(snapshot);
  });
});
