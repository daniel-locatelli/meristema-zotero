/**
 * D11: how many times one session asks for a related paper's missing summary.
 * The queue marked a paper attempted before its batch was fetched, so one
 * failed batch left every paper in it "Title unavailable" until a Refresh.
 * A second attempt lets a later queue run retry it; past that it waits for a
 * Refresh, as before, so a paper no provider knows is not asked for ever.
 */
export const HYDRATION_ATTEMPTS_PER_SESSION = 2;

/** Whether a paper asked `attempts` times this session may be queued again. */
export function mayQueueHydration(attempts: number): boolean {
  return attempts < HYDRATION_ATTEMPTS_PER_SESSION;
}
