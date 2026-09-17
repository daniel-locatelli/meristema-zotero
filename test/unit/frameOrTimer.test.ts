import { describe, it } from "node:test";
import { expect } from "chai";
import {
  FRAME_FALLBACK_MS,
  createFrameOrTimer,
  type FrameSource,
  type TimerSource,
} from "../../src/services/frameOrTimer";

/** A window whose frames and timers fire only when the test says so. */
function fakes() {
  const frames = new Map<number, () => void>();
  const timers = new Map<number, { run: () => void; ms: number }>();
  let next = 1;
  const view: FrameSource = {
    requestAnimationFrame: (run) => {
      const handle = next++;
      frames.set(handle, () => run(0));
      return handle;
    },
    cancelAnimationFrame: (handle) => void frames.delete(handle),
  };
  const clock: TimerSource = {
    setTimeout: (run, ms) => {
      const handle = next++;
      timers.set(handle, { run, ms });
      return handle;
    },
    clearTimeout: (handle) => void timers.delete(handle),
  };
  const fire = (pending: Map<number, unknown>, run: () => void): void => {
    expect(pending.size, "exactly one pending").to.equal(1);
    run();
  };
  return {
    view,
    clock,
    frames,
    timers,
    fireFrame: () =>
      fire(frames, () => {
        const [[handle, run]] = [...frames];
        frames.delete(handle);
        run();
      }),
    fireTimer: () =>
      fire(timers, () => {
        const [[handle, { run }]] = [...timers];
        timers.delete(handle);
        run();
      }),
  };
}

describe("frameOrTimer (B75)", () => {
  it("runs on the frame and drops the timer", () => {
    const f = fakes();
    const scheduler = createFrameOrTimer(() => f.view, f.clock);
    let ran = 0;
    scheduler.request(() => (ran += 1));
    f.fireFrame();
    expect(ran).to.equal(1);
    expect(f.timers.size, "the fallback timer is cleared").to.equal(0);
  });

  it("runs on the timer when the window delivers no frame", () => {
    // A covered or minimised window: the frame is requested and never comes.
    const f = fakes();
    const scheduler = createFrameOrTimer(() => f.view, f.clock);
    let ran = 0;
    scheduler.request(() => (ran += 1));
    expect([...f.timers.values()][0]!.ms).to.equal(FRAME_FALLBACK_MS);
    f.fireTimer();
    expect(ran).to.equal(1);
    expect(f.frames.size, "the frame is cancelled").to.equal(0);
  });

  it("never runs twice, whichever comes second", () => {
    const f = fakes();
    let ran = 0;
    // Hold on to both callbacks, as a host that ignores cancellation would.
    let frame: () => void = () => {};
    let timer: () => void = () => {};
    const view: FrameSource = {
      ...f.view,
      requestAnimationFrame: (run) => {
        frame = () => run(0);
        return 1;
      },
    };
    const clock: TimerSource = {
      ...f.clock,
      setTimeout: (run) => {
        timer = run;
        return 2;
      },
    };
    createFrameOrTimer(() => view, clock).request(() => (ran += 1));
    timer();
    frame();
    expect(ran).to.equal(1);
  });

  it("cancels both halves", () => {
    const f = fakes();
    const scheduler = createFrameOrTimer(() => f.view, f.clock);
    let ran = 0;
    const handle = scheduler.request(() => (ran += 1));
    scheduler.cancel(handle);
    expect(f.frames.size).to.equal(0);
    expect(f.timers.size).to.equal(0);
    expect(ran).to.equal(0);
  });

  it("hands out a truthy handle, since the fill reads 0 as no frame", () => {
    const f = fakes();
    const scheduler = createFrameOrTimer(() => f.view, f.clock);
    expect(scheduler.request(() => {})).to.be.greaterThan(0);
  });

  it("falls back to the timer alone when there is no window", () => {
    const f = fakes();
    const scheduler = createFrameOrTimer(() => null, f.clock);
    let ran = 0;
    scheduler.request(() => (ran += 1));
    f.fireTimer();
    expect(ran).to.equal(1);
  });
});
