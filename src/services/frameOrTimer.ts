/**
 * A frame, or failing that a timer. Work that only needs "soon" is scheduled
 * on `requestAnimationFrame` so a burst coalesces into one run per paint, but
 * a window that is covered or minimised is delivered frames late or not at
 * all, and work that is not painting must not wait on a paint. The hop fill
 * re-plans this way: on a frame alone it stalled at `expanding · 1 left`
 * whenever Zotero sat behind another window (B75).
 */

export interface FrameSource {
  requestAnimationFrame(run: (time: number) => void): number;
  cancelAnimationFrame(handle: number): void;
}

export interface TimerSource {
  setTimeout(run: () => void, ms: number): number;
  clearTimeout(handle: number): void;
}

export interface FrameOrTimer {
  /** Run once, on the next frame or after the fallback. Never returns 0. */
  request(run: () => void): number;
  cancel(handle: number): void;
}

/** Long enough that a visible window's frame always wins, short enough to read as "soon". */
export const FRAME_FALLBACK_MS = 250;

export function createFrameOrTimer(
  view: () => FrameSource | null,
  timers: TimerSource,
): FrameOrTimer {
  const pending = new Map<number, () => void>();
  let next = 1;
  return {
    request: (run) => {
      const handle = next++;
      const source = view();
      let frame: number | null = null;
      const clear = (): void => {
        pending.delete(handle);
        if (frame !== null) source?.cancelAnimationFrame(frame);
        timers.clearTimeout(timer);
      };
      const fire = (): void => {
        if (!pending.has(handle)) return;
        clear();
        run();
      };
      const timer = timers.setTimeout(fire, source ? FRAME_FALLBACK_MS : 0);
      if (source) frame = source.requestAnimationFrame(fire);
      pending.set(handle, clear);
      return handle;
    },
    cancel: (handle) => pending.get(handle)?.(),
  };
}
