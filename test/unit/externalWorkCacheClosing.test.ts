import { describe, it } from "node:test";
import { expect } from "chai";
import {
  closeExternalWorkCache,
  saveOpenAlexReferenceRows,
} from "../../src/services/externalWorkCacheService";
import { referenceListRows } from "../../src/services/openAlexReferenceLists";

describe("the reference-list store while closing", function () {
  it("refuses a save, so the check backs off rather than counting it landed", async function () {
    await closeExternalWorkCache();
    const rows = referenceListRows(
      [{ openAlexID: "W1", references: [], aliases: [] }],
      [],
      "2026-10-07T00:00:00.000Z",
    );
    let refused = false;
    await saveOpenAlexReferenceRows(rows).catch(() => (refused = true));
    expect(refused).to.equal(true);
  });
});
