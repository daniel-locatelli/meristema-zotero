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
