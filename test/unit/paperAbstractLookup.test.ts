import { describe, it } from "node:test";
import { expect } from "chai";
import type { RelatedWorkMetadata } from "../../src/domain/citationTypes";
import type { CitationGraphNode } from "../../src/domain/graphTypes";
import {
  abstractLookupTarget,
  createAbstractLookup,
  type AbstractLookupSources,
} from "../../src/services/paperAbstractLookup";

const node = (overrides: Partial<CitationGraphNode>): CitationGraphNode =>
  ({
    key: "item:AAAA",
    itemID: 1,
    itemKey: "AAAA",
    kind: "local",
    externalWork: null,
    title: "Subject paper",
    abstract: null,
    doi: "10.1000/subject",
    provider: null,
    providerWorkID: null,
    ...overrides,
  }) as CitationGraphNode;

const hop = (work: Partial<RelatedWorkMetadata>): CitationGraphNode =>
  node({
    key: "external:1",
    itemID: 0,
    itemKey: "external:1",
    kind: "external",
    doi: null,
    externalWork: {
      provider: "semantic-scholar",
      providerWorkID: null,
      doi: null,
      title: "Hop paper",
      year: 2020,
      authors: [],
      abstract: null,
      ...work,
    },
  });

/** Sources whose providers answer from `answers`, counting every ask. */
function sources(
  answers: Array<string | null | Error>,
  overrides: Partial<AbstractLookupSources> = {},
): AbstractLookupSources & { asked: string[]; saved: string[] } {
  const asked: string[] = [];
  const saved: string[] = [];
  const provider =
    (name: string, index: number) => (work: RelatedWorkMetadata) => {
      asked.push(`${name}:${work.doi ?? work.providerWorkID}`);
      const answer = answers[index];
      return answer instanceof Error
        ? Promise.reject(answer)
        : Promise.resolve(answer ?? null);
    };
  return {
    asked,
    saved,
    storedAbstract: () => null,
    providers: [provider("s2", 0), provider("openalex", 1)],
    store: async (_target, abstract) => {
      saved.push(abstract);
    },
    ...overrides,
  };
}

describe("abstractLookupTarget", () => {
  it("is null for a paper that already shows an abstract", () => {
    expect(abstractLookupTarget(node({ abstract: "Has one." }))).to.equal(null);
    expect(
      abstractLookupTarget(hop({ abstract: "Has one.", doi: "10.1/x" })),
    ).to.equal(null);
  });

  it("is null for a paper with nothing to ask providers by", () => {
    expect(abstractLookupTarget(node({ doi: null }))).to.equal(null);
    expect(abstractLookupTarget(hop({ title: "Only a title" }))).to.equal(null);
  });

  it("asks for a library paper by its DOI, keyed by it", () => {
    const target = abstractLookupTarget(node({ doi: "10.1000/Subject" }));
    expect(target?.key).to.equal("doi:10.1000/subject");
    expect(target?.libraryItem).to.deep.equal({ itemID: 1, itemKey: "AAAA" });
  });

  it("asks for a hop paper by its provider ID when it has no DOI", () => {
    const target = abstractLookupTarget(hop({ providerWorkID: "abc123" }));
    expect(target?.key).to.equal("semantic-scholar:abc123");
    expect(target?.libraryItem).to.equal(null);
    expect(target?.work.providerWorkID).to.equal("abc123");
  });
});

describe("createAbstractLookup", () => {
  it("asks Semantic Scholar first and stops at its abstract", async () => {
    const fake = sources(["Found it.", "Never asked."]);
    const lookup = createAbstractLookup(fake);
    const paper = node({});
    expect(await lookup.request(paper)).to.equal("Found it.");
    expect(fake.asked).to.deep.equal(["s2:10.1000/subject"]);
    expect(fake.saved).to.deep.equal(["Found it."]);
    expect(lookup.found(paper)).to.equal("Found it.");
  });

  it("falls back to OpenAlex when Semantic Scholar has none", async () => {
    const fake = sources([null, "From OpenAlex."]);
    const lookup = createAbstractLookup(fake);
    expect(await lookup.request(node({}))).to.equal("From OpenAlex.");
    expect(fake.asked).to.deep.equal([
      "s2:10.1000/subject",
      "openalex:10.1000/subject",
    ]);
  });

  it("does not ask again for a paper no provider has an abstract for", async () => {
    const fake = sources([null, "   "]);
    const lookup = createAbstractLookup(fake);
    expect(await lookup.request(node({}))).to.equal(null);
    expect(lookup.request(node({}))).to.equal(null);
    expect(fake.asked).to.have.length(2);
    expect(fake.saved).to.deep.equal([]);
  });

  it("asks once for a paper selected again before the answer", async () => {
    const fake = sources(["Found it."]);
    const lookup = createAbstractLookup(fake);
    const first = lookup.request(node({}));
    const second = lookup.request(node({ key: "external:same-doi" }));
    expect(second).to.equal(first);
    await first;
    expect(lookup.request(node({}))).to.equal(null);
    expect(fake.asked).to.deep.equal(["s2:10.1000/subject"]);
  });

  it("asks again later when every provider failed rather than answered", async () => {
    const fake = sources([new Error("429"), new Error("offline")]);
    const lookup = createAbstractLookup(fake);
    expect(await lookup.request(node({}))).to.equal(null);
    expect(lookup.request(node({}))).to.not.equal(null);
  });

  it("skips a provider that cannot be asked for this paper", async () => {
    const fake = sources([], {
      providers: [() => null, async () => "Second provider."],
    });
    const lookup = createAbstractLookup(fake);
    expect(await lookup.request(node({}))).to.equal("Second provider.");
  });

  it("asks nobody for a paper whose abstract is already stored", () => {
    const fake = sources(["Never asked."], {
      storedAbstract: () => "Stored before.",
    });
    const lookup = createAbstractLookup(fake);
    expect(lookup.found(node({}))).to.equal("Stored before.");
    expect(lookup.request(node({}))).to.equal(null);
    expect(fake.asked).to.deep.equal([]);
  });

  it("asks nobody for a paper that already shows an abstract", () => {
    const fake = sources(["Never asked."]);
    const lookup = createAbstractLookup(fake);
    expect(lookup.request(node({ abstract: "Zotero's own." }))).to.equal(null);
    expect(lookup.found(node({ abstract: "Zotero's own." }))).to.equal(null);
    expect(fake.asked).to.deep.equal([]);
  });
});
