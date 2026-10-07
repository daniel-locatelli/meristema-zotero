import { describe, it } from "node:test";
import { expect } from "chai";
import {
  checkPaperAliases,
  ReferenceListMirror,
  REFERENCE_LIST_NOT_FOUND_MAX_AGE_MS,
  REFERENCE_LIST_SUCCESS_MAX_AGE_MS,
  referenceListRowFromDB,
  referenceListRowToDB,
  referenceListRows,
  storedCheckOf,
} from "../../src/services/openAlexReferenceLists";

const T0 = Date.parse("2026-10-06T00:00:00Z");
const AT = new Date(T0).toISOString();

describe("checkPaperAliases", function () {
  it("lists the OpenAlex alias first, then the DOI", function () {
    expect(
      checkPaperAliases({ key: "k", openAlexID: "W1", doi: "10.1234/x" }),
    ).to.deep.equal(["openalex:W1", "doi:10.1234/x"]);
    expect(
      checkPaperAliases({ key: "k", openAlexID: null, doi: null }),
    ).to.deep.equal([]);
  });
});

describe("referenceListRows", function () {
  it("stores a reference list once, and every other alias as a pointer", function () {
    const rows = referenceListRows(
      [
        {
          openAlexID: "W2",
          references: ["W9"],
          aliases: ["openalex:W1", "doi:10.1234/x", "openalex:W2"],
        },
      ],
      ["doi:10.9876/gone"],
      AT,
    );
    expect(rows).to.deep.equal([
      {
        identityKey: "openalex:W2",
        status: "success",
        openAlexID: "W2",
        referenceIDs: ["W9"],
        fetchedAt: AT,
      },
      {
        identityKey: "openalex:W1",
        status: "alias",
        openAlexID: "W2",
        referenceIDs: null,
        fetchedAt: AT,
      },
      {
        identityKey: "doi:10.1234/x",
        status: "alias",
        openAlexID: "W2",
        referenceIDs: null,
        fetchedAt: AT,
      },
      {
        identityKey: "doi:10.9876/gone",
        status: "not-found",
        openAlexID: null,
        referenceIDs: null,
        fetchedAt: AT,
      },
    ]);
  });
});

describe("ReferenceListMirror", function () {
  const mirror = (): ReferenceListMirror => {
    const m = new ReferenceListMirror();
    m.put(
      referenceListRows(
        [
          {
            openAlexID: "W2",
            references: ["W9"],
            aliases: ["doi:10.1234/x"],
          },
        ],
        ["doi:10.9876/gone"],
        AT,
      ),
    );
    return m;
  };

  it("answers a success, an alias and a not-found", function () {
    const m = mirror();
    expect(m.lookup("openalex:W2", T0)).to.deep.equal({
      openAlexID: "W2",
      references: ["W9"],
    });
    expect(m.lookup("doi:10.1234/x", T0)).to.deep.equal({
      openAlexID: "W2",
      references: ["W9"],
    });
    expect(m.lookup("doi:10.9876/gone", T0)).to.equal(null);
    expect(m.lookup("doi:10.0001/never", T0)).to.equal(undefined);
  });

  it("forgets a not-found after 30 days and a success after 180", function () {
    const m = mirror();
    const past = (ms: number): number => T0 + ms + 1;
    expect(
      m.lookup("doi:10.9876/gone", past(REFERENCE_LIST_NOT_FOUND_MAX_AGE_MS)),
    ).to.equal(undefined);
    expect(
      m.lookup("openalex:W2", past(REFERENCE_LIST_NOT_FOUND_MAX_AGE_MS)),
    ).to.not.equal(undefined);
    expect(
      m.lookup("doi:10.1234/x", past(REFERENCE_LIST_SUCCESS_MAX_AGE_MS)),
    ).to.equal(undefined);
  });

  it("lets a later answer replace a not-found", function () {
    const m = mirror();
    m.put(
      referenceListRows(
        [{ openAlexID: "W3", references: [], aliases: ["doi:10.9876/gone"] }],
        [],
        AT,
      ),
    );
    expect(m.lookup("doi:10.9876/gone", T0)).to.deep.equal({
      openAlexID: "W3",
      references: [],
    });
  });
});

describe("the reference list DB codec", function () {
  it("round-trips a row and rejects a bad one", function () {
    const [row] = referenceListRows(
      [{ openAlexID: "W2", references: ["W9"], aliases: [] }],
      [],
      AT,
    );
    const [identity_key, status, openalex_id, reference_ids_json, fetched_at] =
      referenceListRowToDB(row);
    expect(
      referenceListRowFromDB({
        identity_key,
        status,
        openalex_id,
        reference_ids_json,
        fetched_at,
      }),
    ).to.deep.equal(row);
    expect(
      referenceListRowFromDB({
        identity_key: "x",
        status: "bogus",
        openalex_id: null,
        reference_ids_json: null,
        fetched_at: AT,
      }),
    ).to.equal(null);
    expect(
      referenceListRowFromDB({
        identity_key: "openalex:W2",
        status: "success",
        openalex_id: "W2",
        reference_ids_json: "{not json",
        fetched_at: AT,
      }),
    ).to.equal(null);
  });
});

describe("storedCheckOf", function () {
  const check = { openAlexID: "W2", references: ["W9"] };
  const stored =
    (entries: Record<string, typeof check | null>) => (alias: string) =>
      alias in entries ? entries[alias] : undefined;

  it("does not let a not-found on one alias hide a check on another", function () {
    expect(
      storedCheckOf(
        ["openalex:W1", "doi:10.1234/x"],
        stored({ "openalex:W1": null, "doi:10.1234/x": check }),
      ),
    ).to.deep.equal(check);
  });

  it("reads not-found only when every alias says so", function () {
    expect(
      storedCheckOf(
        ["openalex:W1", "doi:10.1234/x"],
        stored({ "openalex:W1": null, "doi:10.1234/x": null }),
      ),
    ).to.equal(null);
    expect(
      storedCheckOf(
        ["openalex:W1", "doi:10.1234/x"],
        stored({ "openalex:W1": null }),
      ),
    ).to.equal(undefined);
  });

  it("knows nothing of a paper with no alias", function () {
    expect(storedCheckOf([], stored({}))).to.equal(undefined);
  });
});
