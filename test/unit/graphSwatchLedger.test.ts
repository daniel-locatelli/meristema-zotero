import { describe, it } from "node:test";
import { expect } from "chai";
import {
  allocateSwatches,
  createSwatchLedgerStore,
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

  it("reuses the lowest free index, not the longest-released one", function () {
    // b releases first (the longest-released key by the time of refill), a
    // releases second, each in its own call. If reuse followed release
    // order, the first newcomer would take b's old slot (1). It doesn't:
    // it takes the lowest free index, which is a's old slot (0).
    const full = allocateSwatches(emptySwatchLedger(), ["a", "b", "c"], 3);
    const droppedB = allocateSwatches(full, ["a", "c"], 3);
    const droppedA = allocateSwatches(droppedB, ["c"], 3);
    const refilled = allocateSwatches(droppedA, ["c", "d", "e"], 3);
    expect(swatchIndexFor(refilled, "d")).to.equal(0); // a's slot, freed second
    expect(swatchIndexFor(refilled, "e")).to.equal(1); // b's slot, freed first
  });

  it("shares an index only once the pool is exhausted, lowest-indexed holder first", function () {
    // Six seeds hold the whole palette; the seventh must double up rather than
    // repaint anyone, and it doubles with the lowest-indexed live holder —
    // the two coincide in this sequence only because s1 both arrived first
    // and holds the lowest index.
    const full = allocateSwatches(emptySwatchLedger(), ["s1", "s2"], 2);
    const over = allocateSwatches(full, ["s1", "s2", "s3"], 2);
    expect(swatchIndexFor(over, "s1")).to.equal(0);
    expect(swatchIndexFor(over, "s2")).to.equal(1);
    expect(swatchIndexFor(over, "s3")).to.equal(0);
  });

  it("assigns no index when the pool is empty", function () {
    // poolSize 0 must not silently hand out index 0 (there is no holder to
    // double up with either): a newcomer simply gets none.
    const empty = allocateSwatches(emptySwatchLedger(), ["a"], 0);
    expect(swatchIndexFor(empty, "a")).to.equal(null);
  });

  it("never mutates the state it was given", function () {
    const first = allocateSwatches(emptySwatchLedger(), ["a"], 8);
    const snapshot = JSON.stringify(first);
    allocateSwatches(first, ["a", "b", "c"], 8);
    expect(JSON.stringify(first)).to.equal(snapshot);
  });
});

describe("the swatch ledger store", function () {
  // B24: the graph's readers (`regionsForRenderer`, `seedColorsFor`) used to
  // allocate as a side effect of reading, on paths that never persist. The
  // store splits the two: `peek` is a pure read, `ensure` is the allocating
  // half, called only from paths that reach `notifyStateChange`.
  it("does not change the ledger when a colour is only read", function () {
    const store = createSwatchLedgerStore();
    const peeked = store.peek(["a", "b"], 8);
    expect(swatchIndexFor(peeked, "a")).to.equal(0);
    expect(swatchIndexFor(peeked, "b")).to.equal(1);
    expect(store.state().assigned).to.deep.equal({});
  });

  it("changes the ledger when a colour is ensured", function () {
    const store = createSwatchLedgerStore();
    store.ensure(["a", "b"], 8);
    expect(store.state().assigned).to.deep.equal({ a: 0, b: 1 });
  });

  it("reads the same index a read-only path would have been given", function () {
    // Reallocation is deterministic, so a read before the ensure and a read
    // after it agree; nothing the reader painted moves once persisted.
    const store = createSwatchLedgerStore();
    const before = store.peek(["b", "a"], 8);
    store.ensure(["b", "a"], 8);
    expect(store.peek(["b", "a"], 8).assigned).to.deep.equal(before.assigned);
  });

  it("releases a key's index when it is ensured without that key", function () {
    const store = createSwatchLedgerStore();
    store.ensure(["a", "b"], 8);
    store.ensure(["b"], 8);
    expect(store.state().assigned).to.deep.equal({ b: 1 });
  });

  it("restores a saved ledger and reads through it", function () {
    const store = createSwatchLedgerStore();
    store.restore({ assigned: { phd: 3 }, releasedOrder: [] });
    expect(swatchIndexFor(store.peek(["phd", "new"], 8), "phd")).to.equal(3);
    expect(swatchIndexFor(store.peek(["phd", "new"], 8), "new")).to.equal(0);
    expect(store.state().assigned).to.deep.equal({ phd: 3 });
  });
});
