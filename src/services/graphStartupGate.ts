/**
 * What a graph waits for before it draws (B113). Startup puts the graph tabs
 * back as soon as Zotero's UI is ready, alongside Zotero's own, while the
 * plugin's stores still load; a graph drawn before they finish would read an
 * empty cache. Startup opens the gate with the promise of the stores and the
 * runtimes that use them; until then, and outside startup, it is open.
 */
let ready: Promise<void> = Promise.resolve();

export function setGraphStartupGate(gate: Promise<void>): void {
  ready = gate;
}

export function whenGraphsCanDraw(): Promise<void> {
  return ready;
}
