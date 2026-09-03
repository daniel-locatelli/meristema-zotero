import { describe, it } from "node:test";
import { expect } from "chai";
import {
  attachPaneResizer,
  paneRelease,
  paneWidthFromPointer,
  type PaneRelease,
} from "../../src/services/graphViewControls";

type Listener = (event: unknown) => void;

class FakeHandle {
  listeners = new Map<string, Listener[]>();
  captured: number[] = [];
  released: number[] = [];
  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  removeEventListener(type: string, listener: Listener): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((l) => l !== listener),
    );
  }
  setPointerCapture(id: number): void {
    this.captured.push(id);
  }
  releasePointerCapture(id: number): void {
    this.released.push(id);
  }
  fire(type: string, event: Record<string, unknown> = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  count(): number {
    let total = 0;
    for (const list of this.listeners.values()) total += list.length;
    return total;
  }
}

describe("paneWidthFromPointer", function () {
  it("grows to the right for a start edge and to the left for an end edge", function () {
    expect(paneWidthFromPointer("start", 100, 350)).to.equal(250);
    expect(paneWidthFromPointer("end", 1000, 640)).to.equal(360);
  });
});

describe("paneRelease", function () {
  it("commits the clamped width inside the range", function () {
    expect(paneRelease(250, 200, 600, 60)).to.deep.equal({
      kind: "commit",
      width: 250,
    });
    expect(paneRelease(900, 200, 600, 60)).to.deep.equal({
      kind: "commit",
      width: 600,
    });
  });
  it("commits the minimum just under it, and collapses past the threshold", function () {
    expect(paneRelease(150, 200, 600, 60)).to.deep.equal({
      kind: "commit",
      width: 200,
    });
    expect(paneRelease(139, 200, 600, 60)).to.deep.equal({ kind: "collapse" });
  });
});

describe("attachPaneResizer", function () {
  function setup(edge: "start" | "end") {
    const handle = new FakeHandle();
    const log: string[] = [];
    const releases: PaneRelease[] = [];
    const detach = attachPaneResizer({
      handle: handle as unknown as HTMLElement,
      edge,
      minimum: 200,
      maximum: () => 600,
      collapseThreshold: 60,
      origin: () => (edge === "start" ? 100 : 1000),
      onBegin: () => log.push("begin"),
      onMove: (width) => log.push(`move ${width}`),
      onRelease: (release) => releases.push(release),
      onEnd: () => log.push("end"),
      onToggle: () => log.push("toggle"),
    });
    return { handle, log, releases, detach };
  }

  it("captures the pointer, clamps moves, and commits on release", function () {
    const { handle, log, releases } = setup("start");
    handle.fire("pointerdown", { pointerId: 7 });
    handle.fire("pointermove", { clientX: 400 });
    handle.fire("pointermove", { clientX: 900 });
    handle.fire("pointerup", { pointerId: 7, clientX: 900 });
    expect(handle.captured).to.deep.equal([7]);
    expect(handle.released).to.deep.equal([7]);
    expect(log).to.deep.equal(["begin", "move 300", "move 600", "end"]);
    expect(releases).to.deep.equal([{ kind: "commit", width: 600 }]);
  });

  it("ignores moves without a pointer down and releases without a move", function () {
    const { handle, log, releases } = setup("end");
    handle.fire("pointermove", { clientX: 700 });
    handle.fire("pointerdown", { pointerId: 1 });
    handle.fire("pointerup", { pointerId: 1, clientX: 1000 });
    expect(log).to.deep.equal(["begin", "end"]);
    expect(releases).to.have.length(0);
  });

  it("collapses when released past the threshold", function () {
    const { handle, log, releases } = setup("end");
    handle.fire("pointerdown", { pointerId: 2 });
    handle.fire("pointermove", { clientX: 870 });
    handle.fire("pointerup", { pointerId: 2, clientX: 870 });
    expect(log).to.deep.equal(["begin", "move 200", "end"]);
    expect(releases).to.deep.equal([{ kind: "collapse" }]);
  });

  it("toggles on double click and removes every listener on detach", function () {
    const { handle, log, detach } = setup("start");
    handle.fire("dblclick");
    expect(log).to.deep.equal(["toggle"]);
    detach();
    expect(handle.count()).to.equal(0);
  });
});
