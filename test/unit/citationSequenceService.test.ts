import { describe, it } from "node:test";
import { expect } from "chai";
import type { CitationGraphEdge } from "../../src/domain/graphTypes";
import { seedRelativeCitationSequence } from "../../src/services/citationSequenceService";
import { node } from "./graphRendererDoubles";

function edge(source: string, target: string): CitationGraphEdge {
  return {
    key: `${source}>${target}`,
    source,
    target,
    provenance: "test",
    manual: false,
  };
}

/**
 * The seed-relative sequence is a map over the merged graph, never a field on
 * the walk's clones (ADR 0008): the merge keeps the library's own node
 * objects, so a stamped clone never reached the plot for a library paper.
 */
describe("seedRelativeCitationSequence", function () {
  const seed = node("s", { year: 2015 });
  const citer = node("c", { year: 2018 });
  const reference = node("r", { year: 2010 });
  const olderStranger = node("old", { year: 2001 });
  const newerStranger = node("new", { year: 2020 });
  const undated = node("u", { year: null });

  it("anchors the seed at 0, references negative, citers positive", function () {
    const sequence = seedRelativeCitationSequence(
      [seed, citer, reference],
      [edge("c", "s"), edge("s", "r")],
      "s",
      () => null,
    );
    expect(sequence.get("s")).to.equal(0);
    expect(sequence.get("c")).to.equal(1);
    expect(sequence.get("r")).to.equal(-1);
  });

  it("places a library paper with no link to the seed by its date", function () {
    // A folder paper the walk never reached still gets a position: before
    // the seed when older, after it when newer. It used to keep the graph-wide
    // ordinal, a different scale on the same axis.
    const sequence = seedRelativeCitationSequence(
      [seed, olderStranger, newerStranger],
      [],
      "s",
      () => null,
    );
    expect(sequence.get("old")).to.equal(-1);
    expect(sequence.get("new")).to.equal(1);
  });

  it("takes the side the walk reports over the date", function () {
    // A hop-2 citer with no edge to the seed and a date older than it (a
    // preprint cited by a later citer) still sits on the citers' side.
    const sideOf = (key: string): "cited-by" | "reference" | null =>
      key === "old" ? "cited-by" : null;
    const sequence = seedRelativeCitationSequence(
      [seed, olderStranger],
      [],
      "s",
      sideOf,
    );
    expect(sequence.get("old")).to.equal(1);
  });

  it("orders each side chronologically, newest reference nearest the seed", function () {
    const r2 = node("r2", { year: 2005 });
    const c2 = node("c2", { year: 2022 });
    const sequence = seedRelativeCitationSequence(
      [seed, reference, r2, citer, c2],
      [edge("s", "r"), edge("s", "r2"), edge("c", "s"), edge("c2", "s")],
      "s",
      () => null,
    );
    expect(sequence.get("r")).to.equal(-1);
    expect(sequence.get("r2")).to.equal(-2);
    expect(sequence.get("c")).to.equal(1);
    expect(sequence.get("c2")).to.equal(2);
  });

  it("gives an undated stranger a positive step, never a missing one", function () {
    const sequence = seedRelativeCitationSequence(
      [seed, undated],
      [],
      "s",
      () => null,
    );
    expect(sequence.get("u")).to.equal(1);
    expect(sequence.size).to.equal(2);
  });

  it("falls back to the graph-wide ordinal when the anchor is absent", function () {
    const sequence = seedRelativeCitationSequence(
      [newerStranger, olderStranger],
      [],
      "missing",
      () => null,
    );
    expect(sequence.get("old")).to.equal(0);
    expect(sequence.get("new")).to.equal(1);
  });
});
