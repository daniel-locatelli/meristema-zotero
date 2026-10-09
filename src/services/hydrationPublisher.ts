/**
 * When the background summary queue tells views what it hydrated. It used to
 * publish only once it drained, and a running fill keeps feeding it, so every
 * reference a fill landed stayed "Unknown" until the fill stopped (D11). Now
 * a completed batch publishes while work is still queued, at most once per
 * window, so a fast run of batches does not rebuild the graph many times a
 * second; drain publishes whatever is left.
 */

/** At most one mid-queue publication per this many ms. */
export const HYDRATION_PUBLISH_INTERVAL_MS = 1_000;

export interface HydrationPublisher<B> {
  /**
   * A batch has hydrated. Publishes the held batches when the window has
   * passed and the queue still has work; the batch that empties the queue is
   * left to `drain`.
   */
  batchCompleted(batch: B, queueHasWork: boolean): Promise<void>;
  /** The queue is waiting: publish the held batches if the window has passed. */
  waiting(): Promise<void>;
  /** The queue drained: publish whatever is held. */
  drain(): Promise<void>;
}

export function createHydrationPublisher<B>(options: {
  publish: (batches: B[]) => Promise<void>;
  now?: () => number;
  intervalMs?: number;
}): HydrationPublisher<B> {
  const now = options.now ?? Date.now;
  const intervalMs = options.intervalMs ?? HYDRATION_PUBLISH_INTERVAL_MS;
  let held: B[] = [];
  let lastPublishedAt = Number.NEGATIVE_INFINITY;

  const flush = async (): Promise<void> => {
    if (!held.length) return;
    const batches = held;
    held = [];
    lastPublishedAt = now();
    await options.publish(batches);
  };
  const flushIfDue = (): Promise<void> =>
    now() - lastPublishedAt >= intervalMs ? flush() : Promise.resolve();

  return {
    batchCompleted(batch, queueHasWork) {
      held.push(batch);
      return queueHasWork ? flushIfDue() : Promise.resolve();
    },
    waiting: flushIfDue,
    drain: flush,
  };
}
