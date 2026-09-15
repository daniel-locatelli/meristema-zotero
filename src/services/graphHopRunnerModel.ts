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
import type { CitationProviderID } from "../domain/citationTypes";
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
  /**
   * At least one provider refused (HTTP 429) or was sitting out a window
   * (`outcomeRefused`). Read only when nothing was stored.
   */
  refused: boolean;
}

export interface HopLandingEffects {
  /** Count one expansion at the paper's hop against this direction's cap. */
  countExpanded: boolean;
  /** Add the paper to this direction's failed set; it leaves the plan. */
  markFailed: boolean;
  /**
   * Hold the paper out of the plan's order until its providers' windows end.
   * It still counts as left (ADR 0013).
   */
  defer: boolean;
  /** Drop the paper's cached fragment and re-plan. */
  applyToModel: boolean;
}

const NOTHING: HopLandingEffects = {
  countExpanded: false,
  markFailed: false,
  defer: false,
  applyToModel: false,
};

/**
 * What a landed expansion does. A stale epoch drops every effect: the request
 * still stored its list, but the model it would have counted against is gone
 * (spec, "Direction switch").
 */
export function hopLandingEffects(input: HopLandingInput): HopLandingEffects {
  if (input.cleaned || input.epoch !== input.currentEpoch) return NOTHING;
  if (input.stored) {
    return {
      countExpanded: true,
      markFailed: false,
      defer: false,
      applyToModel: true,
    };
  }
  // A refusal is not a failure (ADR 0013): the paper stays in the plan, and
  // nothing in the store changed, so there is nothing to apply.
  if (input.refused) {
    return {
      countExpanded: false,
      markFailed: false,
      defer: true,
      applyToModel: false,
    };
  }
  // A refresh that stored nothing with no provider refusing failed for the
  // session. Nothing else leaves the plan, so a paper the provider cannot
  // answer for would otherwise be asked again on every landing.
  return {
    countExpanded: false,
    markFailed: true,
    defer: false,
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

/** What one fill expansion learned about the providers it could ask. */
export interface HopExpandOutcome {
  /** Providers whose answer was refused (HTTP 429), in the order asked. */
  refusedBy: readonly CitationProviderID[];
  /** Paging providers for the paper that a window kept the expansion from asking. */
  skipped: readonly CitationProviderID[];
  /** The one provider whose list was stored, or null. */
  answeredBy: CitationProviderID | null;
}

/** An expansion that learned nothing: the paper left the graph, or it threw. */
export const NO_OUTCOME: HopExpandOutcome = {
  refusedBy: [],
  skipped: [],
  answeredBy: null,
};

/** A provider refused or was sitting out a window (CONTEXT.md, "Refused"). */
export function outcomeRefused(outcome: HopExpandOutcome): boolean {
  return outcome.refusedBy.length > 0 || outcome.skipped.length > 0;
}

/** A provider's cool-down: 30 s, 1 min, 2 min, then every 5 min, never giving up. */
export const COOL_DOWN_MS: readonly number[] = [
  30_000, 60_000, 120_000, 300_000,
];

export interface ProviderWindow {
  /** Refusals since the provider last answered; picks the next delay. */
  step: number;
  /** When the window ends, on the host's clock. */
  endsAt: number;
}

/** One fill's windows, by provider. Not per direction and not per seed. */
export type ProviderWindows = ReadonlyMap<CitationProviderID, ProviderWindow>;

function coolDownDelay(step: number): number {
  return COOL_DOWN_MS[Math.min(Math.max(0, step), COOL_DOWN_MS.length - 1)];
}

/** A refusal: the window runs the delay for the provider's step, and the step goes up. */
export function refuse(
  windows: ProviderWindows,
  provider: CitationProviderID,
  now: number,
): ProviderWindows {
  const step = windows.get(provider)?.step ?? 0;
  const next = new Map(windows);
  next.set(provider, { step: step + 1, endsAt: now + coolDownDelay(step) });
  return next;
}

/** An answer: the window ends and the step returns to 0. */
export function answer(
  windows: ProviderWindows,
  provider: CitationProviderID,
): ProviderWindows {
  if (!windows.has(provider)) return windows;
  const next = new Map(windows);
  next.delete(provider);
  return next;
}

/** The providers a fill must not ask now. */
export function excluded(
  windows: ProviderWindows,
  now: number,
): CitationProviderID[] {
  return [...windows]
    .filter(([, window]) => window.endsAt > now)
    .map(([provider]) => provider);
}

/** Resume: every window ends now, and each keeps its step. */
export function endAll(windows: ProviderWindows, now: number): ProviderWindows {
  const next = new Map<CitationProviderID, ProviderWindow>();
  for (const [provider, window] of windows) {
    next.set(provider, {
      step: window.step,
      endsAt: Math.min(window.endsAt, now),
    });
  }
  return next;
}

/**
 * When a refused paper may be planned again: the earliest window end among
 * the providers that refused or skipped it that is still ahead of now, or
 * null when every such window has ended.
 */
export function deferUntil(
  windows: ProviderWindows,
  providers: readonly CitationProviderID[],
  now: number,
): number | null {
  let earliest: number | null = null;
  for (const provider of providers) {
    const endsAt = windows.get(provider)?.endsAt;
    if (endsAt === undefined || endsAt <= now) continue;
    if (earliest === null || endsAt < earliest) earliest = endsAt;
  }
  return earliest;
}

export interface HopCoolDownInput {
  windows: ProviderWindows;
  now: number;
  /** The direction's paging providers (`hopFillPagingProviders`). */
  pagingProviders: readonly CitationProviderID[];
  /** Papers the plan would expand now. */
  orderLength: number;
  /** When each of the plan's deferred papers may be planned again, all after now. */
  deferralEnds: readonly number[];
}

/**
 * When a fill that can do nothing tries again, or null while it can expand.
 * It cools down when every paging provider sits out a window, however many
 * papers are planned, or when every paper left is deferred.
 */
export function hopCoolDown(input: HopCoolDownInput): number | null {
  const ends = input.pagingProviders.map(
    (provider) => input.windows.get(provider)?.endsAt ?? 0,
  );
  if (ends.length > 0 && ends.every((endsAt) => endsAt > input.now)) {
    return Math.min(...ends);
  }
  if (input.orderLength === 0 && input.deferralEnds.length > 0) {
    return Math.min(...input.deferralEnds);
  }
  return null;
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
    hop <= depth ? true : value,
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
