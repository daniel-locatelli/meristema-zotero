/// <reference types="mocha" />
/* eslint-disable mocha/no-top-level-hooks -- root hooks on purpose: they cover every suite */
import { expect } from "chai";
import { delay, outputDirectory } from "./visualHarness";

/**
 * The suite never reaches a citation provider: repeated runs saturate them, and
 * a refusal then shows up as an intermittent failure somewhere else. The root
 * hooks answer every provider request not-found, the answer the hops suite
 * gives a host it does not serve, which the plugin takes at once with no retry
 * and no backoff. A case that needs real data wraps this with its own stub, as
 * before. Zotero.debug never reaches the runner's log, so what was stopped, and
 * which other hosts were reached, is written beside the visual frames.
 */
const PROVIDER_HOST =
  /^https:\/\/([a-z-]+\.)?(semanticscholar\.org|opencitations\.net|openalex\.org|crossref\.org|inspirehep\.net|doi\.org)\//;
const LOCAL_HOST = /^https?:\/\/(localhost|127\.0\.0\.1)[:/]/;
const REPORT_NAME = "network-guard.txt";

type Request = (
  method: string,
  url: string,
  options?: unknown,
) => Promise<unknown>;

function guardProviders(
  below: Request,
  note: (kind: "stopped" | "passed", method: string, url: string) => void,
): Request {
  return async (method, url, options) => {
    if (PROVIDER_HOST.test(url)) {
      note("stopped", method, url);
      return { status: 404, responseText: "", getResponseHeader: () => null };
    }
    if (!LOCAL_HOST.test(url)) note("passed", method, url);
    return below.call(Zotero.HTTP, method, url, options);
  };
}

const notes: string[] = [];
let currentCase = "(before the first case)";
let live: Request | null = null;

before(function () {
  live = Zotero.HTTP.request as unknown as Request;
  (Zotero.HTTP as any).request = guardProviders(live, (kind, method, url) =>
    notes.push(`${kind}\t${currentCase}\t${method} ${url.slice(0, 160)}`),
  );
});

beforeEach(function () {
  currentCase = this.currentTest?.fullTitle() ?? currentCase;
});

after(async function () {
  if (live) (Zotero.HTTP as any).request = live;
  const directory = outputDirectory();
  await IOUtils.makeDirectory(directory, {
    createAncestors: true,
    ignoreExisting: true,
  });
  await IOUtils.writeUTF8(
    PathUtils.join(directory, REPORT_NAME),
    `${notes.join("\n")}\n`,
  );
});

describe("Suite network guard", function () {
  it("answers a provider not-found and records it", async function () {
    const url = "https://api.openalex.org/works/network-guard";
    const answer = (await Zotero.HTTP.request("GET", url, {
      successCodes: false,
    })) as unknown as { status: number };
    await delay(0);
    expect(answer.status).to.equal(404);
    expect(notes.at(-1), "the report names the case").to.equal(
      `stopped\t${currentCase}\tGET ${url}`,
    );
  });

  it("covers every provider host and leaves other hosts alone", async function () {
    const passedDown: string[] = [];
    const noted: string[] = [];
    const guarded = guardProviders(
      async (_method, url) => passedDown.push(url),
      (kind, _method, url) => noted.push(`${kind} ${url}`),
    );
    const providers = [
      "https://api.semanticscholar.org/graph/v1/paper/batch",
      "https://www.semanticscholar.org/paper/x",
      "https://api.opencitations.net/index/v2/citations/x",
      "https://opencitations.net/x",
      "https://api.openalex.org/works/x",
      "https://openalex.org/W1",
      "https://api.crossref.org/works/x",
      "https://inspirehep.net/api/literature/x",
      "https://doi.org/10.1000/x",
    ];
    for (const url of providers) await guarded("GET", url);
    expect(passedDown, "no provider goes down").to.be.empty;
    expect(noted).to.have.length(providers.length);

    noted.length = 0;
    await guarded("GET", "http://localhost:23119/connector/ping");
    await guarded("GET", "https://www.zotero.org/x");
    expect(passedDown, "both go down").to.have.length(2);
    expect(noted, "only the outside host is noted").to.deep.equal([
      "passed https://www.zotero.org/x",
    ]);
  });
});
