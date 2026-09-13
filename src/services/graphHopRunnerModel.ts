/**
 * The decisions the hop runner and the hop settings make, kept pure so they
 * can be exercised without a DOM, a provider or a Zotero session. The runner
 * itself (graphViewService.ts, `expandHopPaper` / `scheduleHopFill`) is the
 * I/O around these: it awaits the refresh, reads the relationship store, then
 * asks here what the landing means and applies the answer.
 *
 * What is deliberately *not* here: anything about the toolbar's Refresh
 * button. The runner has its own queue, epoch and in-flight slot, and it
 * never writes the seed refresh's state — so "a landing does not touch
 * Refresh" is expressible as the absence of an output, and the DOM side of it
 * is covered by the Zotero case "keeps Refresh pressable while the fill runs"
 * (test/zotero/graphCitationHops.test.ts).
 */
import { clampHopDepth, type HopDirection } from "./graphHopModel";

export interface HopLandingInput {
  /** The epoch `expandHopPaper` was started under. */
  epoch: number;
  /** The runner's epoch now: a direction change or a seed change bumps it. */
  currentEpoch: number;
  /** The view has been torn down. */
  cleaned: boolean;
  /**
   * A stored summary exists for this paper in this direction now
   * (`getStoredRelationshipSummary`). A stored empty list counts; the works
   * count does not decide it (spec, "Vocabulary").
   */
  stored: boolean;
}

export interface HopLandingEffects {
  /** Count one expansion at the paper's hop against this direction's cap. */
  countExpanded: boolean;
  /** Add the paper to this direction's failed set; it leaves the plan. */
  markFailed: boolean;
  /** Drop the paper's cached fragment and re-plan. */
  applyToModel: boolean;
}

const NOTHING: HopLandingEffects = {
  countExpanded: false,
  markFailed: false,
  applyToModel: false,
};

/**
 * What a landed expansion does. A stale epoch drops every effect: the request
 * still stored its list, but the model it would have counted against is gone
 * (spec, "Direction switch").
 */
export function hopLandingEffects(input: HopLandingInput): HopLandingEffects {
  if (input.cleaned || input.epoch !== input.currentEpoch) return NOTHING;
  return {
    countExpanded: input.stored,
    // A refresh that returned without storing failed for the session.
    // Nothing else leaves the plan, so a paper the provider cannot answer
    // for would otherwise be asked again on every landing.
    markFailed: !input.stored,
    applyToModel: true,
  };
}

/**
 * What an escaped rejection does. The body catches its own errors, but if one
 * escapes the paper still leaves the plan, or the hot-retry loop reopens.
 */
export function hopRejectionEffects(
  input: Pick<HopLandingInput, "epoch" | "currentEpoch">,
): Pick<HopLandingEffects, "markFailed"> {
  return { markFailed: input.epoch === input.currentEpoch };
}

export interface HopExploreSettings {
  direction: HopDirection;
  depth: number;
  /** Index 0 is the seeds; index h is hop h. */
  enabled: readonly boolean[];
}

export interface HopExploreRequest {
  direction: HopDirection;
  hops: number;
}

export interface HopExploreChange extends HopExploreSettings {
  /** Any field differs, so the caller rebuilds and notifies. */
  changed: boolean;
  /**
   * The direction changed, so the runner's epoch is bumped and its in-flight
   * slot cleared: a request in flight still stores, only its callbacks are
   * dropped (spec, "Direction switch").
   */
  bumpEpoch: boolean;
}

/**
 * Applying a view with an `explore` block writes the direction and the depth,
 * and turns on every hop the view asks for. A view that changes nothing at
 * all is not a rebuild.
 */
export function planHopExploreChange(
  current: HopExploreSettings,
  request: HopExploreRequest,
): HopExploreChange {
  const depth = clampHopDepth(request.hops);
  const enabled = current.enabled.map((value, hop) =>
    hop <= request.hops ? true : value,
  );
  const directionChanged = request.direction !== current.direction;
  const depthChanged = depth !== current.depth;
  const enabledChanged = enabled.some(
    (value, hop) => value !== current.enabled[hop],
  );
  return {
    direction: request.direction,
    depth,
    enabled,
    changed: directionChanged || depthChanged || enabledChanged,
    bumpEpoch: directionChanged,
  };
}
