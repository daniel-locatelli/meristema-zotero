import { describe, it } from "node:test";
import { expect } from "chai";
import type { HopEntry, HopDirection } from "../../src/services/graphHopModel";
import { HOP_EXPANSION_CAP } from "../../src/services/graphHopFillModel";
import {
  createHopFillRunner,
  type HopFillHost,
  type HopFillPlanInput,
} from "../../src/services/graphHopFillRunner";

function entry(
  key: string,
  hop: number,
  parents: string[] = [],
  expanded = false,
): [string, HopEntry] {
  return [key, { key, hop, parents, expanded }];
}

/**
 * A host with a fake expander: the fill's own decisions (order, caps,
 * failure per direction, the epoch drop) are asserted through the runner's
 * interface, with nothing of the graph view, a provider or a DOM.
 */
function fakeHost(overrides: Partial<HopFillHost> = {}) {
  const entries = new Map<string, HopEntry>([
    entry("s", 0, [], true),
    entry("a", 1, ["s"]),
    entry("b", 1, ["s"]),
  ]);
  const stored = new Set<string>(["s"]);
  const calls = {
    expanded: [] as string[],
    landed: [] as string[],
    settled: 0,
    planned: 0,
    planEmpty: 0,
    errors: [] as unknown[],
  };
  let direction: HopDirection = "cited-by";
  let depth = 2;
  let active = true;
  /** A landing stores the list unless the key is in `failing`. */
  const failing = new Set<string>();
  const frames: Array<() => void> = [];
  const host: HopFillHost = {
    planInput: (): HopFillPlanInput | null => ({
      direction,
      entries,
      visibleKeys: new Set(entries.keys()),
      depth,
      selectedKey: null,
      hoveredKey: null,
      onScreenKeys: new Set(),
      reportedCountOf: () => null,
    }),
    canExpand: () => active,
    expand: async (key, _direction, control) => {
      calls.expanded.push(key);
      await Promise.resolve();
      if (control.stale()) return;
      if (!failing.has(key)) {
        stored.add(key);
        control.reportCount(7);
        entries.set(key, { ...entries.get(key)!, expanded: true });
      }
    },
    stored: (key) => stored.has(key),
    hopOf: (key) => entries.get(key)?.hop ?? null,
    landed: (key) => {
      calls.landed.push(key);
    },
    settled: () => {
      calls.settled += 1;
    },
    planned: () => {
      calls.planned += 1;
    },
    planEmpty: () => {
      calls.planEmpty += 1;
    },
    frame: (run) => {
      frames.push(run);
      return frames.length;
    },
    cancelFrame: () => undefined,
    logError: (error) => {
      calls.errors.push(error);
    },
    ...overrides,
  };
  /** Run every pending frame and let the queued expansion land. */
  const settle = async (): Promise<void> => {
    for (let round = 0; round < 12; round += 1) {
      while (frames.length) frames.shift()!();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };
  return {
    host,
    calls,
    entries,
    stored,
    failing,
    settle,
    setDirection: (next: HopDirection) => {
      direction = next;
    },
    setDepth: (next: number) => {
      depth = next;
    },
    setActive: (next: boolean) => {
      active = next;
    },
  };
}

describe("createHopFillRunner", function () {
  it("expands the plan's papers one at a time and re-plans after each landing", async function () {
    const fake = fakeHost();
    const runner = createHopFillRunner(fake.host);
    runner.wake();
    await fake.settle();
    expect(fake.calls.expanded).to.deep.equal(["a", "b"]);
    expect(fake.calls.landed).to.deep.equal(["a", "b"]);
    // Every landing rebuilds the walk (ADR 0010) and the empty plan fires
    // what the fill was holding.
    expect(fake.calls.settled).to.equal(2);
    expect(fake.calls.planEmpty).to.equal(1);
    expect(runner.state()).to.equal(null);
  });

  it("counts a landing against its hop's cap and stops at the cap", async function () {
    const fake = fakeHost();
    // Three hop-1 papers, a cap already spent by two landings: the third
    // waits, and the rail reads `500 expanded · 1 waiting`-shaped state.
    fake.entries.set(...entry("c", 1, ["s"]));
    const runner = createHopFillRunner(fake.host);
    runner.wake();
    await fake.settle();
    expect(fake.calls.expanded).to.deep.equal(["a", "b", "c"]);
    expect(runner.reportedByHop(fake.entries, 2, "cited-by")).to.deep.equal([
      null,
      null,
      21,
    ]);
  });

  it("marks a paper that stored nothing failed in that direction only", async function () {
    const fake = fakeHost();
    fake.failing.add("a");
    const runner = createHopFillRunner(fake.host);
    runner.wake();
    await fake.settle();
    // "a" was asked once, failed for the session, and the next plans dropped
    // it: "b" landed and the plan emptied without asking "a" again.
    expect(fake.calls.expanded).to.deep.equal(["a", "b"]);
    expect(fake.calls.landed).to.deep.equal(["a", "b"]);
    expect(fake.calls.planEmpty).to.equal(1);
    // Under References the paper is planned again: failure is per direction.
    // ("b" is not: the fake's entries carry one `expanded` flag for both
    // directions, and "b" landed above.)
    fake.failing.clear();
    fake.setDirection("references");
    runner.invalidate();
    runner.wake();
    await fake.settle();
    expect(fake.calls.expanded.slice(2)).to.deep.equal(["a"]);
  });

  it("drops a landing's effects when the epoch moved, and carries on", async function () {
    const fake = fakeHost();
    const runner = createHopFillRunner(fake.host);
    const original = fake.host.expand;
    let first = true;
    fake.host.expand = async (key, direction, control) => {
      await original(key, direction, control);
      if (first) {
        first = false;
        runner.invalidate();
      }
    };
    runner.wake();
    await fake.settle();
    // The first landing stored its list but was not applied and did not
    // settle: what invalidated the fill rebuilds and wakes it (a direction
    // change goes through rebuildCurrentFocus), and that plan reads the
    // store, where "a" is expanded already, so only "b" is asked.
    expect(fake.calls.landed).to.deep.equal([]);
    expect(fake.calls.settled).to.equal(0);
    runner.wake();
    await fake.settle();
    expect(fake.calls.landed).to.deep.equal(["b"]);
    expect(fake.calls.expanded).to.deep.equal(["a", "b"]);
  });

  it("holds while stopped and while the view is off screen; resumes on wake", async function () {
    const fake = fakeHost();
    const runner = createHopFillRunner(fake.host);
    runner.stop();
    runner.wake();
    await fake.settle();
    expect(fake.calls.expanded).to.deep.equal([]);
    expect(runner.state()).to.deep.equal({
      remaining: 2,
      waiting: 0,
      paused: true,
    });
    runner.resume();
    fake.setActive(false);
    runner.wake();
    await fake.settle();
    expect(fake.calls.expanded).to.deep.equal([]);
    fake.setActive(true);
    runner.wake();
    await fake.settle();
    expect(fake.calls.expanded).to.deep.equal(["a", "b"]);
  });

  it("raises the cap by 500 for the hops whose papers wait, and reset clears it", async function () {
    const fake = fakeHost();
    const runner = createHopFillRunner(fake.host);
    // Spend the cap: HOP_EXPANSION_CAP hop-1 papers landed, one more waits.
    for (let index = 0; index < HOP_EXPANSION_CAP; index += 1) {
      fake.entries.set(...entry(`p${index}`, 1, ["s"]));
    }
    fake.entries.set(...entry("last", 1, ["s"]));
    runner.wake();
    await fake.settle();
    // The queue lands one per settle round; this drives it to the cap.
    for (let round = 0; round < HOP_EXPANSION_CAP; round += 1) {
      if (runner.state()?.waiting) break;
      await fake.settle();
    }
    expect(runner.state()?.waiting).to.be.greaterThan(0);
    const askedBefore = fake.calls.expanded.length;
    runner.fetchMore();
    runner.wake();
    await fake.settle();
    expect(fake.calls.expanded.length).to.be.greaterThan(askedBefore);
    runner.reset();
    // A fresh seeded graph in the same tab starts with nothing spent.
    fake.calls.expanded.length = 0;
    fake.entries.clear();
    fake.entries.set(...entry("s", 0, [], true));
    fake.entries.set(...entry("z", 1, ["s"]));
    runner.wake();
    await fake.settle();
    expect(fake.calls.expanded).to.deep.equal(["z"]);
    expect(runner.reportedByHop(fake.entries, 2, "cited-by")).to.deep.equal([
      null,
      null,
      7,
    ]);
  });

  it("logs an escaped rejection, fails the paper, and keeps going", async function () {
    const fake = fakeHost();
    fake.host.expand = async (key) => {
      if (key === "a") throw new Error("provider down");
    };
    const runner = createHopFillRunner(fake.host);
    runner.wake();
    await fake.settle();
    expect(fake.calls.errors.length).to.equal(1);
    // "a" failed (nothing stored), "b" was still asked, neither asked twice.
    expect(fake.calls.landed).to.deep.equal(["a", "b"]);
  });

  it("does nothing after dispose", async function () {
    const fake = fakeHost();
    const runner = createHopFillRunner(fake.host);
    runner.dispose();
    runner.wake();
    await fake.settle();
    expect(fake.calls.planned).to.equal(0);
    expect(fake.calls.expanded).to.deep.equal([]);
  });
});
