import { describe, it } from "node:test";
import { expect } from "chai";

import {
  routeStatus,
  toolbarStatusAfter,
} from "../../src/services/graphStatusRoute";

const STICKY = "This graph is read-only";

describe("graph status route", function () {
  it("puts a sticky notice in the toolbar", function () {
    expect(routeStatus(STICKY, { sticky: true })).to.deep.equal({
      to: "toolbar",
      message: STICKY,
    });
  });

  it("sends a passing confirmation to the toast", function () {
    expect(routeStatus("Copied")).to.deep.equal({
      to: "toast",
      message: "Copied",
    });
    expect(routeStatus("Saved", { sticky: false })).to.deep.equal({
      to: "toast",
      message: "Saved",
    });
  });

  it("clears the toolbar on a null or an empty message", function () {
    expect(routeStatus(null)).to.deep.equal({ to: "toolbar", message: null });
    expect(routeStatus("", { sticky: true })).to.deep.equal({
      to: "toolbar",
      message: null,
    });
  });

  it("keeps a sticky notice in the toolbar through the toasts after it", function () {
    let toolbar: string | null = null;
    toolbar = toolbarStatusAfter(
      toolbar,
      routeStatus(STICKY, { sticky: true }),
    );
    for (const passing of ["Copied", "Saved", "Copied"]) {
      toolbar = toolbarStatusAfter(toolbar, routeStatus(passing));
      expect(toolbar, `after ${passing}`).to.equal(STICKY);
    }
    expect(toolbarStatusAfter(toolbar, routeStatus(null))).to.equal(null);
  });

  it("lets the next sticky notice replace the last", function () {
    const migrated = "Migrated from both directions";
    expect(
      toolbarStatusAfter(STICKY, routeStatus(migrated, { sticky: true })),
    ).to.equal(migrated);
  });
});
