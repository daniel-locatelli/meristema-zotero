import { describe, it } from "node:test";
import { expect } from "chai";

import { routeStatus } from "../../src/services/graphStatusRoute";

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
});
