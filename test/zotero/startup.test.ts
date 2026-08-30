/// <reference types="mocha" />
import { expect } from "chai";
import { config } from "../../package.json";

describe("Meristema startup", function () {
  it("registers the plugin instance", function () {
    expect((Zotero as any)[config.addonInstance]).to.exist;
  });
});
