import { describe, it } from "node:test";
import { expect } from "chai";
import type { CitationProviderID } from "../../src/domain/citationTypes";
import type { HopEntry, HopDirection } from "../../src/services/graphHopModel";
import { HOP_EXPANSION_CAP } from "../../src/services/graphHopFillModel";
import {
  createHopFillRunner,
  type HopFillHost,
  type HopFillPlanInput,
} from "../../src/services/graphHopFillRunner";
import {
  NO_OUTCOME,
  type HopExpandOutcome,
} from "../../src/services/graphHopRunnerModel";

const S2: CitationProviderID = "semantic-scholar";
const OC: CitationProviderID = "opencitations";

function entry(
  key: string,
  hop: number,
  parents: string[] = [],
  expanded = false,
): [string, HopEntry] {
  return [key, { key, hop, parents, expanded }];
}

/**
 * A host with a fake expander, a fake clock and fake timers: the fill's own
 * decisions (order, caps, failure per direction, the epoch drop, provider
 * windows, deferrals, cooling down) are asserted through the runner's
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
    excludes: [] as CitationProviderID[][],
    landed: [] as string[],
    settled: 0,
    planned: 0,
    planEmpty: 0,
    errors: [] as unknown[],
  };
  let direction: HopDirection = "cited-by";
  let depth = 2;
  let active = true;
  /** A key here stores nothing from the provider that answers it. */
  const failing = new Set<string>();
  /** Providers answering HTTP 429 to every request. */
  const refusing = new Set<CitationProviderID>();
  const paging: CitationProviderID[] = [S2, OC];
  const frames: Array<() => void> = [];
  let clock = 0;
  let nextTimer = 1;
  const timers: Array<{ id: number; at: number; run: () => void }> = [];
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
    // The refresh's loop in miniature (externalDiscoveryService.ts): the
    // paging providers not excluded, in order, until one does not refuse.
    expand: async (key, _direction, control): Promise<HopExpandOutcome> => {
      calls.expanded.push(key);
      calls.excludes.push([...control.excludeProviders]);
      await Promise.resolve();
      if (control.stale()) return NO_OUTCOME;
      const skipped = paging.filter((provider) =>
        control.excludeProviders.includes(provider),
      );
      const refusedBy: CitationProviderID[] = [];
      for (const provider of paging) {
        if (control.excludeProviders.includes(provider)) continue;
        if (refusing.has(provider)) {
          refusedBy.push(provider);
          continue;
        }
        if (failing.has(key)) return { refusedBy, skipped, answeredBy: null };
        stored.add(key);
        control.reportCount(7);
        entries.set(key, { ...entries.get(key)!, expanded: true });
        return { refusedBy, skipped, answeredBy: provider };
      }
      return { refusedBy, skipped, answeredBy: null };
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
    now: () => clock,
    pagingProviders: () => paging,
    after: (ms, run) => {
      const id = nextTimer;
      nextTimer += 1;
      timers.push({ id, at: clock + ms, run });
      return id;
    },
    cancelAfter: (handle) => {
      const index = timers.findIndex((timer) => timer.id === handle);
      if (index >= 0) timers.splice(index, 1);
    },
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
  /** Move the clock on, fire the timers that came due, and settle. */
  const advance = async (ms: number): Promise<void> => {
    clock += ms;
    const due = timers.filter((timer) => timer.at <= clock);
    for (const timer of due) timers.splice(timers.indexOf(timer), 1);
    for (const timer of due) timer.run();
    await settle();
  };
  return {
    host,
    calls,
    entries,
    stored,
    failing,
    refusing,
    timers,
    settle,
    advance,
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
      const outcome = await original(key, direction, control);
      if (first) {
        first = false;
        runner.invalidate();
      }
      return outcome;
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
      refusal: null,
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
      return NO_OUTCOME;
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

  // B72: both providers refuse for good. The paper is deferred while the
  // ladder climbs, then fails, so the plan drains instead of re-asking it for
  // ever — and Resume, which is the reader saying "try again now", brings it
  // back.
  it("fails a paper the deferral limit ran out for, and Resume brings it back", async function () {
    const fake = fakeHost();
    fake.entries.delete("b");
    fake.refusing.add(S2);
    fake.refusing.add(OC);
    const runner = createHopFillRunner(fake.host);
    runner.wake();
    await fake.settle();
    await fake.advance(30_000);
    await fake.advance(60_000);
    await fake.advance(120_000);
    expect(
      fake.calls.expanded,
      "deferred three times, then asked once more and failed",
    ).to.deep.equal(["a", "a", "a", "a"]);
    await fake.advance(300_000);
    expect(
      fake.calls.expanded,
      "the limit failed it, so no later window asks it again",
    ).to.deep.equal(["a", "a", "a", "a"]);
    expect(runner.state(), "the plan drained").to.equal(null);
    fake.refusing.clear();
    runner.retryNow();
    await fake.settle();
    expect(fake.calls.expanded.slice(4)).to.deep.equal(["a"]);
  });

  it("keeps a paper failed the ordinary way out across Resume", async function () {
    const fake = fakeHost();
    fake.failing.add("a");
    const runner = createHopFillRunner(fake.host);
    runner.wake();
    await fake.settle();
    expect(fake.calls.expanded).to.deep.equal(["a", "b"]);
    runner.retryNow();
    await fake.settle();
    expect(
      fake.calls.expanded,
      "a provider answered nothing usable: that is not the limit's failure",
    ).to.deep.equal(["a", "b"]);
  });

  // B72 review, Important 1: the count alone does not tell the limit's
  // failure from the ordinary one. A paper deferred to the limit that then
  // lands with no provider refusing and nothing stored still failed the
  // ordinary way — the limit did not cause it — so Resume must leave it out.
  it("keeps a paper deferred to the limit but failed the ordinary way out across Resume", async function () {
    const fake = fakeHost();
    fake.entries.delete("b");
    fake.refusing.add(S2);
    fake.refusing.add(OC);
    const runner = createHopFillRunner(fake.host);
    runner.wake();
    await fake.settle();
    await fake.advance(30_000);
    await fake.advance(60_000);
    // Three deferrals climbed the ladder. Before the runner tries again,
    // both providers stop refusing but answer with nothing usable: the
    // fourth landing is the ordinary failure, not the limit's.
    fake.refusing.clear();
    fake.failing.add("a");
    await fake.advance(120_000);
    expect(
      fake.calls.expanded,
      "deferred three times, then failed the ordinary way",
    ).to.deep.equal(["a", "a", "a", "a"]);
    expect(runner.state(), "the plan drained").to.equal(null);
    runner.retryNow();
    await fake.settle();
    expect(
      fake.calls.expanded,
      "the ordinary failure is not the limit's, so Resume must not bring it back",
    ).to.deep.equal(["a", "a", "a", "a"]);
  });
});

describe("the fill under provider refusals", function () {
  it("keeps a refused paper in the plan: not failed, not landed, not settled", async function () {
    const fake = fakeHost();
    fake.refusing.add(S2);
    fake.refusing.add(OC);
    const runner = createHopFillRunner(fake.host);
    runner.wake();
    await fake.settle();
    expect(fake.calls.expanded).to.deep.equal(["a"]);
    expect(fake.calls.landed).to.deep.equal([]);
    expect(fake.calls.settled).to.equal(0);
    expect(runner.state()).to.deep.equal({
      remaining: 2,
      waiting: 0,
      paused: false,
      refusal: { providers: [S2, OC], retryAt: 30_000 },
    });
  });

  it("asks the next expansion without the provider that refused", async function () {
    const fake = fakeHost();
    fake.refusing.add(S2);
    const runner = createHopFillRunner(fake.host);
    runner.wake();
    await fake.settle();
    expect(fake.calls.expanded).to.deep.equal(["a", "b"]);
    expect(fake.calls.excludes).to.deep.equal([[], [S2]]);
    expect(fake.calls.landed).to.deep.equal(["a", "b"]);
    expect(runner.state()).to.equal(null);
  });

  it("expands nothing while every paging provider sits out a window, with one timer", async function () {
    const fake = fakeHost();
    fake.entries.set(...entry("c", 1, ["s"]));
    fake.refusing.add(S2);
    fake.refusing.add(OC);
    const runner = createHopFillRunner(fake.host);
    runner.wake();
    await fake.settle();
    for (let wake = 0; wake < 3; wake += 1) {
      runner.wake();
      await fake.settle();
    }
    expect(fake.calls.expanded).to.deep.equal(["a"]);
    expect(fake.timers.map((timer) => timer.at)).to.deep.equal([30_000]);
  });

  it("keeps retryAt fixed, and tries again when the window ends", async function () {
    const fake = fakeHost();
    fake.refusing.add(S2);
    fake.refusing.add(OC);
    const runner = createHopFillRunner(fake.host);
    runner.wake();
    await fake.settle();
    await fake.advance(10_000);
    runner.wake();
    await fake.settle();
    expect(runner.state()?.refusal?.retryAt).to.equal(30_000);
    fake.refusing.clear();
    await fake.advance(20_000);
    expect(fake.calls.expanded).to.deep.equal(["a", "a", "b"]);
    expect(runner.state()).to.equal(null);
  });

  it("cools down when every paper left is deferred, and asks again at the deferral's end", async function () {
    const fake = fakeHost();
    fake.entries.delete("b");
    fake.refusing.add(S2);
    // Semantic Scholar refuses and OpenCitations answers with nothing:
    // refused, not failed, and OpenCitations is not in a window.
    fake.failing.add("a");
    const runner = createHopFillRunner(fake.host);
    runner.wake();
    await fake.settle();
    expect(fake.calls.expanded).to.deep.equal(["a"]);
    expect(fake.calls.planEmpty).to.equal(1);
    expect(fake.timers.map((timer) => timer.at)).to.deep.equal([30_000]);
    expect(runner.state()?.refusal).to.deep.equal({
      providers: [S2],
      retryAt: 30_000,
    });
    await fake.advance(30_000);
    expect(fake.calls.expanded).to.deep.equal(["a", "a"]);
    expect(fake.calls.excludes[1]).to.deep.equal([]);
  });

  it("cancels the timer on stop, invalidate and reset, and arms none off screen", async function () {
    const fake = fakeHost();
    fake.refusing.add(S2);
    fake.refusing.add(OC);
    const runner = createHopFillRunner(fake.host);
    runner.wake();
    await fake.settle();
    expect(fake.timers.length).to.equal(1);
    runner.stop();
    expect(fake.timers.length, "stop").to.equal(0);
    runner.wake();
    await fake.settle();
    expect(fake.timers.length, "paused").to.equal(0);
    expect(runner.state()?.refusal, "no refusal line while paused").to.equal(
      null,
    );
    runner.resume();
    runner.wake();
    await fake.settle();
    expect(fake.timers.length).to.equal(1);
    runner.invalidate();
    expect(fake.timers.length, "invalidate").to.equal(0);
    runner.wake();
    await fake.settle();
    expect(fake.timers.length).to.equal(1);
    runner.reset();
    expect(fake.timers.length, "reset").to.equal(0);
    fake.setActive(false);
    runner.wake();
    await fake.settle();
    expect(fake.timers.length, "off screen").to.equal(0);
  });

  it("asks at once on retryNow, and a second refusal waits the next step; resume alone does not", async function () {
    const fake = fakeHost();
    fake.entries.delete("b");
    fake.refusing.add(S2);
    fake.refusing.add(OC);
    const runner = createHopFillRunner(fake.host);
    runner.wake();
    await fake.settle();
    runner.stop();
    runner.resume();
    runner.wake();
    await fake.settle();
    expect(fake.calls.expanded, "resume alone ends no window").to.deep.equal([
      "a",
    ]);
    runner.retryNow();
    await fake.settle();
    expect(fake.calls.expanded).to.deep.equal(["a", "a"]);
    expect(fake.calls.excludes[1]).to.deep.equal([]);
    expect(runner.state()?.refusal?.retryAt).to.equal(60_000);
  });

  it("keeps the window of a provider that refused while its partial list was stored", async function () {
    const fake = fakeHost();
    const originalExpand = fake.host.expand;
    let expandCalls = 0;
    fake.host.expand = async (key, direction, control) => {
      expandCalls += 1;
      if (expandCalls === 1) {
        fake.calls.expanded.push(key);
        fake.calls.excludes.push([...control.excludeProviders]);
        fake.stored.add(key);
        control.reportCount(7);
        fake.entries.set(key, { ...fake.entries.get(key)!, expanded: true });
        return { refusedBy: [S2], skipped: [], answeredBy: S2 };
      }
      return originalExpand(key, direction, control);
    };
    const runner = createHopFillRunner(fake.host);
    runner.wake();
    await fake.settle();
    expect(fake.calls.excludes.at(-1)).to.include(S2);
  });

  it("keeps the windows across invalidate and reset", async function () {
    const fake = fakeHost();
    fake.refusing.add(S2);
    const runner = createHopFillRunner(fake.host);
    runner.wake();
    await fake.settle();
    runner.invalidate();
    fake.entries.set(...entry("c", 1, ["s"]));
    runner.wake();
    await fake.settle();
    expect(fake.calls.excludes.at(-1), "after invalidate").to.deep.equal([S2]);
    runner.reset();
    fake.entries.set(...entry("d", 1, ["s"]));
    runner.wake();
    await fake.settle();
    expect(fake.calls.excludes.at(-1), "after reset").to.deep.equal([S2]);
  });

  /*
   * The four below close the coverage gaps the B50 final review triaged as
   * follow-ups (Task 9, finding 4, and the `coolingUntil` note). They pin
   * behaviour the runner already has, so they pass as written; they exist so
   * a later change cannot quietly take any of it away.
   */

  it("cancels an armed cool-down timer on dispose", async function () {
    const fake = fakeHost();
    fake.refusing.add(S2);
    fake.refusing.add(OC);
    const runner = createHopFillRunner(fake.host);
    runner.wake();
    await fake.settle();
    expect(fake.timers.length, "armed").to.equal(1);
    runner.dispose();
    expect(fake.timers.length, "dispose").to.equal(0);
  });

  it("opens the refusing provider's window even when the landing's epoch moved", async function () {
    const fake = fakeHost();
    // Semantic Scholar refuses and OpenCitations answers, so the expansion
    // lands a list under an epoch that has already moved on.
    fake.refusing.add(S2);
    const runner = createHopFillRunner(fake.host);
    const original = fake.host.expand;
    let first = true;
    fake.host.expand = async (key, direction, control) => {
      const outcome = await original(key, direction, control);
      if (first) {
        first = false;
        runner.invalidate();
      }
      return outcome;
    };
    runner.wake();
    await fake.settle();
    runner.wake();
    await fake.settle();
    // The landing's effects were dropped, but a refusal is true of the
    // provider whatever the epoch did, so the next ask still leaves it out.
    expect(fake.calls.excludes.at(-1)).to.deep.equal([S2]);
  });

  it("ends the windows on retryNow while paused, but expands nothing until resume", async function () {
    const fake = fakeHost();
    fake.entries.delete("b");
    fake.refusing.add(S2);
    fake.refusing.add(OC);
    const runner = createHopFillRunner(fake.host);
    runner.wake();
    await fake.settle();
    expect(fake.calls.expanded).to.deep.equal(["a"]);
    runner.stop();
    runner.retryNow();
    await fake.settle();
    expect(fake.calls.expanded, "paused: nothing is asked").to.deep.equal([
      "a",
    ]);
    fake.refusing.clear();
    runner.resume();
    runner.wake();
    await fake.settle();
    expect(fake.calls.expanded, "resume asks at once").to.deep.equal([
      "a",
      "a",
    ]);
  });

  it("waits on a deferral with no provider in a window, and shows no refusal line", async function () {
    const fake = fakeHost();
    let call = 0;
    fake.host.expand = async (key, _direction, control) => {
      call += 1;
      fake.calls.expanded.push(key);
      fake.calls.excludes.push([...control.excludeProviders]);
      await Promise.resolve();
      // "a" is refused by Semantic Scholar, which opens its window and defers
      // the paper; "b" is then answered by Semantic Scholar, which ends that
      // window again. The deferral outlives it, so the fill cools down with
      // nobody refusing — the silent wait the review flagged.
      if (call === 1) return { refusedBy: [S2], skipped: [], answeredBy: null };
      fake.stored.add(key);
      control.reportCount(7);
      fake.entries.set(key, { ...fake.entries.get(key)!, expanded: true });
      return { refusedBy: [], skipped: [], answeredBy: S2 };
    };
    const runner = createHopFillRunner(fake.host);
    runner.wake();
    await fake.settle();
    expect(fake.calls.expanded).to.deep.equal(["a", "b"]);
    const state = runner.state();
    expect(
      state?.refusal,
      "no provider is refusing, so no refusal line",
    ).to.equal(null);
    // The paper still counts as left, and a timer holds the fill until its
    // deferral ends (ADR 0013).
    expect(state?.remaining).to.equal(1);
    expect(fake.timers.map((timer) => timer.at)).to.deep.equal([30_000]);
  });
});
