import { describe, it } from "node:test";
import { expect } from "chai";
import { isRelationshipResponse } from "../../src/services/providerResponseCacheService";

describe("isRelationshipResponse", function () {
  it("recognises both OpenAlex relation filters and the Semantic Scholar paths", function () {
    expect(
      isRelationshipResponse(
        "https://api.openalex.org/works?filter=cites%3AW1",
      ),
    ).to.equal(true);
    expect(
      isRelationshipResponse(
        "https://api.openalex.org/works?filter=cited_by%3AW1&sort=cited_by_count%3Adesc",
      ),
    ).to.equal(true);
    expect(
      isRelationshipResponse(
        "https://api.semanticscholar.org/graph/v1/paper/P1/citations?offset=0",
      ),
    ).to.equal(true);
    expect(
      isRelationshipResponse(
        "https://api.openalex.org/works?filter=doi%3A10.1%2Fx",
      ),
    ).to.equal(false);
  });
});
