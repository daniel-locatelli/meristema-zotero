import { describe, it } from "node:test";
import { expect } from "chai";
import type { CancellationSignal } from "../../src/services/cancellationScope";
import type { SeedLinkCheck } from "../../src/services/graphSeedLinks";
import {
  referenceListRows,
  type CheckPaper,
  type ReferenceListRow,
} from "../../src/services/openAlexReferenceLists";
import type { CheckOutcome } from "../../src/services/openAlexSeedLinkService";
import {
  CHECK_BACKOFF_MS,
  createSeedLinkCheckScheduler,
} from "../../src/services/seedLinkCheckScheduler";

const AT = "2026-10-06T00:00:00.000Z";

function harness() {
  const known = new Map<string, SeedLinkCheck | null>();
  const deferred: Array<() => void> = [];
  const asked: CheckPaper[][] = [];
  const signals: CancellationSignal[] = [];
  const pending: Array<(outcome: CheckOutcome) => void> = [];
  let now = 0;
  const scheduler = createSeedLinkCheckScheduler({
    store: {
      lookup: (alias) => (known.has(alias) ? known.get(alias) : undefined),
      save: async (rows: readonly ReferenceListRow[]) => {
        for (const row of rows)
          known.set(
            row.identityKey,
            row.status === "not-found"
              ? null
              : { openAlexID: row.openAlexID!, references: [] },
          );
      },
    },
    check: (papers, signal) => {
      asked.push([...papers]);
      signals.push(signal);
      return new Promise((resolve) => pending.push(resolve));
    },
    defer: (run) => deferred.push(run),
    now: () => now,
  });
  const flush = async (): Promise<void> => {
    while (deferred.length) deferred.shift()!();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const land = async (outcome: CheckOutcome): Promise<void> => {
    pending.shift()!(outcome);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flush();
  };
  return {
    scheduler,
    known,
    asked,
    signals,
    flush,
    land,
    advance: (ms: number) => (now += ms),
  };
}

const P = { key: "p", openAlexID: "W1", doi: null };
const Q = { key: "q", openAlexID: null, doi: "10.1234/q" };

function client(papers: CheckPaper[]) {
  const c = { papers: () => papers, landed: () => (c.count += 1), count: 0 };
  return c;
}

describe("seedLinkCheckScheduler", function () {
  it("collects at dispatch, once, however often it is marked dirty", async function () {
    const h = harness();
    const papers: CheckPaper[] = [];
    h.scheduler.register(client(papers));
    h.scheduler.markDirty();
    h.scheduler.markDirty();
    papers.push(P);
    await h.flush();
    expect(h.asked).to.deep.equal([[P]]);
  });

  it("does not ask again for a paper in flight", async function () {
    const h = harness();
    h.scheduler.register(client([P]));
    h.scheduler.markDirty();
    await h.flush();
    h.scheduler.markDirty();
    await h.flush();
    expect(h.asked).to.have.length(1);
  });

  it("saves, notifies the graph that wants the paper, and then has nothing to ask", async function () {
    const h = harness();
    const wants = client([P]);
    const other = client([Q]);
    h.scheduler.register(wants);
    h.scheduler.register(other);
    h.scheduler.markDirty();
    await h.flush();
    h.scheduler.markDirty();
    await h.land({
      rows: referenceListRows(
        [{ openAlexID: "W1", references: [], aliases: [] }],
        ["doi:10.1234/q"],
        AT,
      ),
      failed: [],
    });
    expect(wants.count).to.equal(1);
    expect(other.count).to.equal(1);
    expect(h.asked).to.have.length(1);
  });

  it("never asks for a paper the store already knows, or one with no identifier", async function () {
    const h = harness();
    h.known.set("openalex:W1", null);
    h.scheduler.register(
      client([P, { key: "x", openAlexID: null, doi: null }]),
    );
    h.scheduler.markDirty();
    await h.flush();
    expect(h.asked).to.have.length(0);
  });

  it("backs a failed paper off on the schedule", async function () {
    const h = harness();
    h.scheduler.register(client([P]));
    h.scheduler.markDirty();
    await h.flush();
    await h.land({ rows: [], failed: [P] });
    h.scheduler.markDirty();
    await h.flush();
    expect(h.asked).to.have.length(1);
    h.advance(CHECK_BACKOFF_MS[0] + 1);
    h.scheduler.markDirty();
    await h.flush();
    expect(h.asked).to.have.length(2);
    await h.land({ rows: [], failed: [P] });
    h.advance(CHECK_BACKOFF_MS[0] + 1);
    h.scheduler.markDirty();
    await h.flush();
    expect(h.asked, "the second failure waits longer").to.have.length(2);
  });

  it("cancels the check once no open graph wants its papers", async function () {
    const h = harness();
    const unregister = h.scheduler.register(client([P]));
    const stays = client([Q]);
    h.scheduler.register(stays);
    h.scheduler.markDirty();
    await h.flush();
    expect(h.asked[0]).to.have.length(2);
    unregister();
    expect(h.signals[0].cancelled, "Q is still wanted").to.equal(false);
    h.scheduler.register(client([]));
    const unregisterLast = h.scheduler.register(client([]));
    unregisterLast();
    expect(h.signals[0].cancelled).to.equal(false);
  });

  it("cancels when the last graph wanting the papers closes, and saves nothing", async function () {
    const h = harness();
    const unregister = h.scheduler.register(client([P]));
    h.scheduler.markDirty();
    await h.flush();
    unregister();
    expect(h.signals[0].cancelled).to.equal(true);
    await h.land({
      rows: referenceListRows(
        [{ openAlexID: "W1", references: [], aliases: [] }],
        [],
        AT,
      ),
      failed: [],
    });
    expect(h.known.size).to.equal(0);
  });
});
