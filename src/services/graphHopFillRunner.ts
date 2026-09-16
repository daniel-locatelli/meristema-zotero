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
 * queue that never touches Refresh (0007), a rebuild on every landing (0010,
 * through `settled`), and a refusal that is not a failure (0013): a refused
 * paper stays in the plan, the refusing provider sits out a window, and the
 * fill cools down, with one timer, only when nothing can be asked.
 */
import type { CitationProviderID } from "../domain/citationTypes";
import {
  HOP_EXPANSION_CAP,
  planHopFill,
  type HopFillInput,
  type HopFillPlan,
} from "./graphHopFillModel";
import type { HopDirection } from "./graphHopModel";
import {
  DEFERRAL_LIMIT,
  NO_OUTCOME,
  answer,
  deferUntil,
  endAll,
  excluded,
  hopCoolDown,
  hopLandingEffects,
  hopRejectionEffects,
  outcomeRefused,
  refuse,
  type HopExpandOutcome,
  type ProviderWindows,
} from "./graphHopRunnerModel";
import { SerializedTaskQueue } from "./serializedTaskQueue";

/** What the plan needs from the graph, read fresh on every re-plan. */
export interface HopFillPlanInput extends Omit<
  HopFillInput,
  | "failedKeys"
  | "deferredKeys"
  | "expandedByHop"
  | "capByHop"
  | "reportedCountOf"
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
   * one answering provider. `reportCount` takes the provider's reported total
   * on the way; `stale()` says the fill moved on, for a check between two
   * awaits; `excludeProviders` are the providers sitting out a window, never
   * to be asked. Resolves who refused, who was skipped and who answered. A
   * rejection is caught and logged; the paper is then failed or not by
   * `stored`.
   */
  expand(
    key: string,
    direction: HopDirection,
    control: {
      reportCount: (count: number) => void;
      stale: () => boolean;
      excludeProviders: readonly CitationProviderID[];
    },
  ): Promise<HopExpandOutcome>;
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
  /** The clock windows and deferrals are measured on. */
  now(): number;
  /** The direction's paging providers, in the provider plan's order. */
  pagingProviders(direction: HopDirection): readonly CitationProviderID[];
  /** Run once after `ms`: the end of a cool-down. */
  after(ms: number, run: () => void): number;
  cancelAfter(handle: number): void;
  logError(error: unknown): void;
}

export interface HopFillRefusal {
  /** The providers sitting out a window, in the provider plan's order. */
  providers: CitationProviderID[];
  /** When the fill tries again, on the host's clock; fixed for a cool-down. */
  retryAt: number;
}

export interface HopFillState {
  remaining: number;
  waiting: number;
  paused: boolean;
  /** Set only while the fill is cooling down and not paused. */
  refusal: HopFillRefusal | null;
}

export interface HopFillRunner {
  /** Re-plan on the next frame and expand the plan's first paper. */
  wake(): void;
  stop(): void;
  resume(): void;
  /**
   * The rail's Resume, after `resume`: every window and deferral ends and the
   * fill asks at once. Each provider keeps its step, so a fresh refusal waits
   * longer. Fetch hop N and applying a view call `resume` alone.
   */
  retryNow(): void;
  /** Raise the cap by 500 for every hop whose papers wait on it. */
  fetchMore(): void;
  /**
   * The direction or the seeds changed: a request in flight still stores,
   * only its callbacks are dropped (spec, "Direction switch").
   */
  invalidate(): void;
  /**
   * The graph lost its seeds: counts, caps, failures and deferrals go, since
   * "session" means the seeded graph (ADR 0005). The reported totals are a
   * cache and stay, and so do the providers' windows.
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
  /** The view is torn down: the epoch moves, the frame, timer and queue close. */
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
  /**
   * Each provider's cool-down in this fill. A window belongs to the provider,
   * not to a direction or to the seeds, so it survives `invalidate` and
   * `reset` (ADR 0013).
   */
  let windows: ProviderWindows = new Map();
  /**
   * A refused paper's key, when its deferral ends, and how many times it has
   * been deferred with nothing stored, by direction.
   */
  const deferrals = perDirection(
    () => new Map<string, { until: number; count: number }>(),
  );
  /**
   * The papers the deferral limit failed, by direction. Resume brings these
   * back; a paper a provider answered nothing usable for stays out (B72).
   */
  const limitFailed = perDirection(() => new Set<string>());
  /** The one cool-down timer. */
  let timer: number | null = null;
  /** When the fill tries again, while the last plan found it cooling down. */
  let coolingUntil: number | null = null;
  let lastPlan: HopFillPlan | null = null;
  let lastDirection: HopDirection = "cited-by";

  const capFor = (direction: HopDirection, hop: number): number =>
    caps[direction][hop] ?? HOP_EXPANSION_CAP;

  const cancelTimer = (): void => {
    if (timer === null) return;
    host.cancelAfter(timer);
    timer = null;
  };

  const plan = (): HopFillPlan | null => {
    const input = host.planInput();
    if (!input) return null;
    const { direction } = input;
    lastDirection = direction;
    const now = host.now();
    const deferredKeys = new Set<string>();
    for (const [key, { until }] of deferrals[direction]) {
      if (until > now) deferredKeys.add(key);
    }
    return planHopFill({
      ...input,
      failedKeys: failed[direction],
      deferredKeys,
      expandedByHop: expanded[direction],
      capByHop: Array.from({ length: input.depth + 1 }, (_, hop) =>
        capFor(direction, hop),
      ),
      reportedCountOf: (key) =>
        reported[direction].get(key) ?? input.reportedCountOf(key),
    });
  };

  /** When the plan can do nothing until a window or a deferral ends, or null. */
  const coolDown = (current: HopFillPlan): number | null => {
    const now = host.now();
    const deferralEnds: number[] = [];
    for (const key of current.deferred) {
      const until = deferrals[lastDirection].get(key)?.until;
      if (until !== undefined && until > now) deferralEnds.push(until);
    }
    return hopCoolDown({
      windows,
      now,
      pagingProviders: host.pagingProviders(lastDirection),
      orderLength: current.order.length,
      deferralEnds,
    });
  };

  const expand = (key: string, startEpoch: number): Promise<void> => {
    const direction = lastDirection;
    inFlight = key;
    const stale = (): boolean => disposed || startEpoch !== epoch;
    /** A refused landing changed nothing in the store, so nothing rebuilds. */
    let refusedLanding = false;
    return queue
      .enqueue(async () => {
        if (stale()) return;
        let outcome: HopExpandOutcome = NO_OUTCOME;
        try {
          outcome = await host.expand(key, direction, {
            reportCount: (count) => reported[direction].set(key, count),
            stale,
            excludeProviders: excluded(windows, host.now()),
          });
        } catch (error) {
          host.logError(error);
        }
        // A refusal is true of the provider whatever the epoch did, so the
        // windows learn it even from a landing whose effects are dropped.
        if (!disposed) {
          const now = host.now();
          for (const provider of outcome.refusedBy) {
            windows = refuse(windows, provider, now);
          }
          // A provider that refused in this expansion never answers it too
          // (final review, Important 1): its window survives even when its
          // partial list was the one stored.
          if (
            outcome.answeredBy &&
            !outcome.refusedBy.includes(outcome.answeredBy)
          ) {
            windows = answer(windows, outcome.answeredBy);
          }
        }
        // What the landing means is decided by `hopLandingEffects`
        // (graphHopRunnerModel.ts): expanded is a stored summary, refused is
        // deferred until the limit runs out, anything else failed for the
        // session, and a stale epoch drops all three.
        const deferred = deferrals[direction].get(key)?.count ?? 0;
        const effects = hopLandingEffects({
          epoch: startEpoch,
          currentEpoch: epoch,
          cleaned: disposed,
          stored: host.stored(key, direction),
          refused: outcomeRefused(outcome),
          deferrals: deferred,
        });
        if (effects.defer) {
          refusedLanding = true;
          const until = deferUntil(
            windows,
            [...outcome.refusedBy, ...outcome.skipped],
            host.now(),
          );
          // The count is kept even when no window is ahead, so a deferral the
          // plan does not hold back still counts against the limit.
          deferrals[direction].set(key, {
            until: until ?? 0,
            count: deferred + 1,
          });
          return;
        }
        if (!effects.applyToModel) return;
        deferrals[direction].delete(key);
        if (effects.countExpanded) {
          const hop = host.hopOf(key) ?? 0;
          const counts = expanded[direction];
          counts[hop] = (counts[hop] ?? 0) + 1;
        }
        if (effects.markFailed) {
          failed[direction].add(key);
          // Only the limit's failures come back on Resume.
          if (deferred >= DEFERRAL_LIMIT) limitFailed[direction].add(key);
        }
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
        // fill is scheduled here whatever it did. A refused landing stored
        // nothing, so there is nothing to rebuild.
        if (!refusedLanding) host.settled();
        wake();
      });
  };

  const wake = (): void => {
    if (disposed || frame) return;
    frame = host.frame(() => {
      frame = 0;
      if (disposed) return;
      // Every frame decides afresh whether to wait, so a wake never leaves a
      // second timer behind.
      cancelTimer();
      lastPlan = plan();
      coolingUntil = lastPlan ? coolDown(lastPlan) : null;
      host.planned();
      if (!lastPlan || paused || !host.canExpand()) return;
      if (inFlight) return;
      const next = lastPlan.order[0];
      if (!next) host.planEmpty();
      if (coolingUntil !== null) {
        timer = host.after(Math.max(0, coolingUntil - host.now()), () => {
          timer = null;
          wake();
        });
        return;
      }
      if (next) void expand(next, epoch);
    });
  };

  /** The providers sitting out a window, in the provider plan's order. */
  const refusingProviders = (): CitationProviderID[] => {
    const sitting = new Set(excluded(windows, host.now()));
    return host
      .pagingProviders(lastDirection)
      .filter((provider) => sitting.has(provider));
  };

  return {
    wake,
    stop: () => {
      paused = true;
      cancelTimer();
    },
    resume: () => {
      paused = false;
    },
    retryNow: () => {
      windows = endAll(windows, host.now());
      for (const direction of DIRECTIONS) {
        deferrals[direction].clear();
        // The reader is asking to try again now, which is exactly the case the
        // deferral limit should yield to (B72). A paper a provider answered
        // nothing usable for is not the limit's, and stays out.
        for (const key of limitFailed[direction]) failed[direction].delete(key);
        limitFailed[direction].clear();
      }
      coolingUntil = null;
      wake();
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
      cancelTimer();
    },
    reset: () => {
      epoch += 1;
      inFlight = null;
      cancelTimer();
      for (const direction of DIRECTIONS) {
        failed[direction].clear();
        limitFailed[direction].clear();
        deferrals[direction].clear();
        expanded[direction] = [];
        caps[direction] = [];
      }
      lastPlan = null;
      coolingUntil = null;
    },
    state: () => {
      if (!lastPlan) return null;
      const remaining = lastPlan.remainingByHop.reduce((sum, n) => sum + n, 0);
      const waiting = lastPlan.waitingByHop.reduce((sum, n) => sum + n, 0);
      if (!remaining && !waiting) return null;
      const providers =
        coolingUntil !== null && !paused ? refusingProviders() : [];
      return {
        remaining: remaining - waiting,
        waiting,
        paused,
        refusal:
          coolingUntil !== null && providers.length
            ? { providers, retryAt: coolingUntil }
            : null,
      };
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
      cancelTimer();
      if (frame) {
        host.cancelFrame(frame);
        frame = 0;
      }
      queue.close();
    },
  };
}
