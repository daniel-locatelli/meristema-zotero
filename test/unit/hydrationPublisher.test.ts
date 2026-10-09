import { describe, it } from "node:test";
import { expect } from "chai";
import {
  HYDRATION_PUBLISH_INTERVAL_MS,
  createHydrationPublisher,
} from "../../src/services/hydrationPublisher";

/**
 * D11: the background summary queue published only once it drained, and a
 * running fill keeps feeding it, so nothing it hydrated reached the graph
 * until the fill stopped. These pin the queue's publication policy: a batch
 * publishes while work is still queued, at most once per window, and drain
 * publishes whatever is left.
 */
function harness() {
  let clock = 0;
  const published: string[][] = [];
  const publisher = createHydrationPublisher<string>({
    now: () => clock,
    publish: (batches) => {
      published.push(batches);
      return Promise.resolve();
    },
  });
  return {
    publisher,
    published,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("hydration publisher", function () {
  it("publishes a completed batch while more work is queued", async function () {
    const { publisher, published } = harness();
    await publisher.batchCompleted("a", true);
    expect(
      published,
      "a batch completing mid-queue must publish before the queue drains",
    ).to.deep.equal([["a"]]);
  });

  it("gives one publish for a burst of batches inside the window", async function () {
    const { publisher, published, advance } = harness();
    for (const batch of ["a", "b", "c", "d"]) {
      await publisher.batchCompleted(batch, true);
      advance(HYDRATION_PUBLISH_INTERVAL_MS / 5);
    }
    expect(
      published,
      "four batches inside one window must publish once",
    ).to.deep.equal([["a"]]);
  });

  it("publishes what the window held once it has passed", async function () {
    const { publisher, published, advance } = harness();
    await publisher.batchCompleted("a", true);
    advance(100);
    await publisher.batchCompleted("b", true);
    advance(HYDRATION_PUBLISH_INTERVAL_MS);
    await publisher.batchCompleted("c", true);
    expect(published).to.deep.equal([["a"], ["b", "c"]]);
  });

  it("publishes a held batch while the queue waits, once the window has passed", async function () {
    const { publisher, published, advance } = harness();
    await publisher.batchCompleted("a", true);
    await publisher.batchCompleted("b", true);
    await publisher.waiting();
    expect(published, "inside the window the wait holds").to.have.length(1);
    advance(HYDRATION_PUBLISH_INTERVAL_MS);
    await publisher.waiting();
    expect(published).to.deep.equal([["a"], ["b"]]);
    await publisher.waiting();
    expect(published, "nothing held, nothing published").to.have.length(2);
  });

  it("leaves the last batch to the drain, which publishes it", async function () {
    const { publisher, published } = harness();
    await publisher.batchCompleted("a", false);
    expect(
      published,
      "a batch that empties the queue is the drain's to publish",
    ).to.deep.equal([]);
    await publisher.drain();
    expect(published).to.deep.equal([["a"]]);
  });

  it("gives a final publish on drain after mid-queue ones", async function () {
    const { publisher, published, advance } = harness();
    await publisher.batchCompleted("a", true);
    advance(10);
    await publisher.batchCompleted("b", true);
    advance(10);
    await publisher.batchCompleted("c", false);
    await publisher.drain();
    expect(published).to.deep.equal([["a"], ["b", "c"]]);
    await publisher.drain();
    expect(published, "a second drain has nothing left").to.have.length(2);
  });
});
