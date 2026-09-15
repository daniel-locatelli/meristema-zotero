/**
 * The fill: the background work that expands shown papers one at a time, in
 * the plan's order, until every shown paper at an opened hop is expanded or
 * failed, or the cap is hit (CONTEXT.md, "Fill"). This module owns the fill's
 * state, which used to be thirteen locals of the graph view's closure: the
 * queue, the epoch, the in-flight slot, the pause flag, the frame, the failed
 * set, the counts and caps per hop, the reported totals and the last plan.
 * What it does not own is the model, the DOM or the provider call: those come
 * in through the host, so a test can drive the fill with a fake expander and
 * assert its order, its caps, its failures per direction and its epoch drop.
 *
 * The rules it encodes are the ADRs: scope gates and the camera orders (0003,
 * through `planHopFill`), a cap of 500 per hop per direction (0005), its own
 * queue that never touches Refresh (0007), and a rebuild on every landing
 * (0010, through `settled`).
 */
import {
  HOP_EXPANSION_CAP,
  planHopFill,
  type HopFillInput,
  type HopFillPlan,
} from "./graphHopFillModel";
import type { HopDirection } from "./graphHopModel";
import { hopLandingEffects, hopRejectionEffects } from "./graphHopRunnerModel";
import { SerializedTaskQueue } from "./serializedTaskQueue";

/** What the plan needs from the graph, read fresh on every re-plan. */
export interface HopFillPlanInput extends Omit<
  HopFillInput,
  "failedKeys" | "expandedByHop" | "capByHop" | "reportedCountOf"
> {
  direction: HopDirection;
  /**
   * The paper's reported count in the direction from its own fields, or
   * null; the fill overlays the totals its own landings reported.
   */
  reportedCountOf: (key: string) => number | null;
}

export interface HopFillHost {
  /** Null while there is no walk or no scope: nothing to plan. */
  planInput(): HopFillPlanInput | null;
  /** The view is on screen, so a plan may start an expansion. */
  canExpand(): boolean;
  /**
   * One shown paper's own list, in the direction: automatic mode, one page,
   * one provider. `reportCount` takes the provider's reported total on the
   * way; `stale()` says the fill moved on, for a check between two awaits.
   * A rejection is caught and logged; the paper is then failed or not by
   * `stored`.
   */
  expand(
    key: string,
    direction: HopDirection,
    control: { reportCount: (count: number) => void; stale: () => boolean },
  ): Promise<void>;
  /** A stored summary exists for the paper in the direction now. */
  stored(key: string, direction: HopDirection): boolean;
  /** The paper's hop in the current walk, or null when it left it. */
  hopOf(key: string): number | null;
  /** A landing was applied: drop the paper's fragment, fit a seed. */
  landed(key: string): void;
  /** An expansion finished under the current epoch: rebuild the walk. */
  settled(): void;
  /** A plan was made; the rail reads `state()` after this. */
  planned(): void;
  /** The plan is empty: fire what the fill was holding. */
  planEmpty(): void;
  /** Schedule a re-plan on the next frame. */
  frame(run: () => void): number;
  cancelFrame(handle: number): void;
  logError(error: unknown): void;
}

export interface HopFillState {
  remaining: number;
  waiting: number;
  paused: boolean;
}

export interface HopFillRunner {
  /** Re-plan on the next frame and expand the plan's first paper. */
  wake(): void;
  stop(): void;
  resume(): void;
  /** Raise the cap by 500 for every hop whose papers wait on it. */
  fetchMore(): void;
  /**
   * The direction or the seeds changed: a request in flight still stores,
   * only its callbacks are dropped (spec, "Direction switch").
   */
  invalidate(): void;
  /**
   * The graph lost its seeds: counts, caps and failures go, since "session"
   * means the seeded graph (ADR 0005). The reported totals are a cache and
   * stay.
   */
  reset(): void;
  /** The rail's progress line, or null when the plan is empty. */
  state(): HopFillState | null;
  /** What the rail's hop rows print as "of {reported}", by hop. */
  reportedByHop(
    entries: ReadonlyMap<string, { hop: number }>,
    depth: number,
    direction: HopDirection,
  ): (number | null)[];
  /** The view is torn down: the epoch moves, the frame and queue close. */
  dispose(): void;
}

const DIRECTIONS: readonly HopDirection[] = ["cited-by", "references"];

function perDirection<T>(make: () => T): Record<HopDirection, T> {
  return { "cited-by": make(), references: make() };
}

export function createHopFillRunner(host: HopFillHost): HopFillRunner {
  const queue = new SerializedTaskQueue();
  let epoch = 0;
  let inFlight: string | null = null;
  let paused = false;
  let frame = 0;
  let disposed = false;
  /**
   * Failure is a property of a paper's list in one direction: Crossref pages
   * a paper's references but not its citations. A hiccup under Citers must
   * not remove the paper from the References plan (spec, "Vocabulary").
   */
  const failed = perDirection(() => new Set<string>());
  /** Landed expansions this session, by direction then hop. */
  const expanded = perDirection<number[]>(() => []);
  const caps = perDirection<number[]>(() => []);
  /** The reported total each expanded paper returned, by direction. */
  const reported = perDirection(() => new Map<string, number>());
  let lastPlan: HopFillPlan | null = null;
  let lastDirection: HopDirection = "cited-by";

  const capFor = (direction: HopDirection, hop: number): number =>
    caps[direction][hop] ?? HOP_EXPANSION_CAP;

  const plan = (): HopFillPlan | null => {
    const input = host.planInput();
    if (!input) return null;
    const { direction } = input;
    lastDirection = direction;
    return planHopFill({
      ...input,
      failedKeys: failed[direction],
      expandedByHop: expanded[direction],
      capByHop: Array.from({ length: input.depth + 1 }, (_, hop) =>
        capFor(direction, hop),
      ),
      reportedCountOf: (key) =>
        reported[direction].get(key) ?? input.reportedCountOf(key),
    });
  };

  const expand = (key: string, startEpoch: number): Promise<void> => {
    const direction = lastDirection;
    inFlight = key;
    const stale = (): boolean => disposed || startEpoch !== epoch;
    return queue
      .enqueue(async () => {
        if (stale()) return;
        try {
          await host.expand(key, direction, {
            reportCount: (count) => reported[direction].set(key, count),
            stale,
          });
        } catch (error) {
          host.logError(error);
        }
        // What the landing means is decided by `hopLandingEffects`
        // (graphHopRunnerModel.ts): expanded is a stored summary, anything
        // else failed for the session, and a stale epoch drops both.
        const effects = hopLandingEffects({
          epoch: startEpoch,
          currentEpoch: epoch,
          cleaned: disposed,
          stored: host.stored(key, direction),
          refused: false,
        });
        if (!effects.applyToModel) return;
        if (effects.countExpanded) {
          const hop = host.hopOf(key) ?? 0;
          const counts = expanded[direction];
          counts[hop] = (counts[hop] ?? 0) + 1;
        }
        if (effects.markFailed) failed[direction].add(key);
        host.landed(key);
      })
      .catch((error: unknown) => {
        // Nothing else may escape the enqueued body, but if it does the paper
        // still leaves the plan: an unhandled rejection here would otherwise
        // re-open the hot-retry loop the guard above closes.
        if (
          hopRejectionEffects({ epoch: startEpoch, currentEpoch: epoch })
            .markFailed
        )
          failed[direction].add(key);
        host.logError(error);
      })
      .finally(() => {
        if (startEpoch !== epoch) return;
        inFlight = null;
        if (disposed) return;
        // The rebuild re-reads one fragment and recomputes the scope, which
        // re-plans through the host — but it may return early, so the next
        // fill is scheduled here whatever it did.
        host.settled();
        wake();
      });
  };

  const wake = (): void => {
    if (disposed || frame) return;
    frame = host.frame(() => {
      frame = 0;
      if (disposed) return;
      lastPlan = plan();
      host.planned();
      if (!lastPlan || paused || !host.canExpand()) return;
      if (inFlight) return;
      const next = lastPlan.order[0];
      if (!next) {
        host.planEmpty();
        return;
      }
      void expand(next, epoch);
    });
  };

  return {
    wake,
    stop: () => {
      paused = true;
    },
    resume: () => {
      paused = false;
    },
    fetchMore: () => {
      paused = false;
      const waiting = lastPlan?.waitingByHop ?? [];
      const direction = lastDirection;
      waiting.forEach((count, hop) => {
        if (count > 0)
          caps[direction][hop] = capFor(direction, hop) + HOP_EXPANSION_CAP;
      });
    },
    invalidate: () => {
      epoch += 1;
      inFlight = null;
    },
    reset: () => {
      epoch += 1;
      inFlight = null;
      for (const direction of DIRECTIONS) {
        failed[direction].clear();
        expanded[direction] = [];
        caps[direction] = [];
      }
      lastPlan = null;
    },
    state: () => {
      if (!lastPlan) return null;
      const remaining = lastPlan.remainingByHop.reduce((sum, n) => sum + n, 0);
      const waiting = lastPlan.waitingByHop.reduce((sum, n) => sum + n, 0);
      if (!remaining && !waiting) return null;
      return { remaining: remaining - waiting, waiting, paused };
    },
    // A heuristic on purpose: a hop-k paper reached from two parents is
    // counted under both, so "of {reported}" can over-report (review M11).
    // The exact figure would need the union of the parents' lists, which is
    // the fetch.
    reportedByHop: (entries, depth, direction) => {
      const totals: (number | null)[] = Array.from(
        { length: depth + 1 },
        () => null,
      );
      for (const [key, entry] of entries) {
        const count = reported[direction].get(key);
        if (count === undefined || entry.hop >= depth) continue;
        const hop = entry.hop + 1;
        totals[hop] = (totals[hop] ?? 0) + count;
      }
      return totals;
    },
    dispose: () => {
      disposed = true;
      epoch += 1;
      inFlight = null;
      if (frame) {
        host.cancelFrame(frame);
        frame = 0;
      }
      queue.close();
    },
  };
}
