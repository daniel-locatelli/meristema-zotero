import { describe, it } from "node:test";
import { expect } from "chai";
import { folderGraphRetitle } from "../../src/services/graphInstancePolicy";

describe("retitling a folder graph after its folder changes (B58)", function () {
  it("takes the folder's new name", function () {
    expect(folderGraphRetitle("PhD Graph", "Thesis Graph", [])).to.equal(
      "Thesis Graph",
    );
  });

  it("keeps a title already on the base", function () {
    expect(folderGraphRetitle("PhD Graph", "PhD Graph", [])).to.equal(null);
  });

  it("keeps a numbered title on the base rather than renumbering it", function () {
    expect(
      folderGraphRetitle("PhD Graph 2", "PhD Graph", ["PhD Graph"]),
    ).to.equal(null);
  });

  it("numbers past another tab already holding the new name", function () {
    expect(
      folderGraphRetitle("PhD Graph", "Thesis Graph", ["Thesis Graph"]),
    ).to.equal("Thesis Graph 2");
  });

  it("keeps the title when the folders name nothing", function () {
    expect(folderGraphRetitle("PhD Graph", null, [])).to.equal(null);
  });
});
