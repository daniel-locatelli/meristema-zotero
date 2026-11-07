import { describe, it } from "node:test";
import { expect } from "chai";
import {
  EMPTY_READING_SOURCE,
  buildReadingPlan,
  readStateFromNotes,
  readingStepOf,
  type ReadingSource,
} from "../../src/domain/readingPlan";

const A = "AAAAAAA2";
const B = "BBBBBBB3";
const C = "CCCCCCC4";
const D = "DDDDDDD5";

const list = (topic: string, keys: string[]): string =>
  `<h1>Reading list - ${topic}</h1><pre data-meristema-reading-list="1">${JSON.stringify(
    { version: 1, topic, steps: keys.map((key) => ({ key, why: "" })) },
  )}</pre>`;
const state = (states: Record<string, [string, string]>): string =>
  `<pre data-meristema-reading-state="1">${JSON.stringify({
    version: 1,
    states: Object.fromEntries(
      Object.entries(states).map(([id, [s, at]]) => [id, { state: s, at }]),
    ),
  })}</pre>`;
const papers = (...keys: string[]) =>
  keys.map((key) => ({ key, title: `Title ${key}` }));

function source(over: Partial<ReadingSource> = {}): ReadingSource {
  return {
    folders: [
      {
        collectionID: 1,
        notes: [
          {
            key: "NNNNNNN6",
            dateAdded: "2026-01-01 00:00:00",
            html: list("One", [B, A]),
          },
        ],
        papers: papers(A, B, C),
      },
    ],
    stateNotes: [],
    paperIds: new Map([
      [A, `user:${A}`],
      [B, "doi:10.1000/b"],
      [C, `user:${C}`],
      [D, `user:${D}`],
    ]),
    ...over,
  };
}

describe("buildReadingPlan", () => {
  it("numbers a ticked list's steps from 1 and puts its unordered papers at n+1", () => {
    const plan = buildReadingPlan(source(), [1]);
    expect(plan.paths).to.deep.equal([
      { collectionID: 1, topic: "One", keys: [B, A] },
    ]);
    expect(plan.stepByKey.get(B)).to.equal(1);
    expect(plan.stepByKey.get(A)).to.equal(2);
    expect(plan.stepByKey.get(C)).to.equal(3);
    expect(plan.afterLast).to.equal(4);
    expect(readingStepOf(plan, D)).to.equal(4);
  });

  it("ignores lists in unticked folders", () => {
    const plan = buildReadingPlan(source(), []);
    expect(plan.paths).to.deep.equal([]);
    expect(plan.stepByKey.size).to.equal(0);
    expect(readingStepOf(plan, A)).to.equal(1);
    expect(readingStepOf(null, A)).to.equal(null);
  });

  it("uses the oldest note by date added, then key", () => {
    const folder = {
      collectionID: 1,
      notes: [
        {
          key: "ZZZZZZZ9",
          dateAdded: "2026-01-01 00:00:00",
          html: list("Late key", [A]),
        },
        {
          key: "YYYYYYY8",
          dateAdded: "2026-02-01 00:00:00",
          html: list("Newer", [B]),
        },
        {
          key: "XXXXXXX7",
          dateAdded: "2026-01-01 00:00:00",
          html: list("Oldest", [C]),
        },
      ],
      papers: papers(A, B, C),
    };
    const plan = buildReadingPlan(source({ folders: [folder] }), [1]);
    expect(plan.paths[0].topic).to.equal("Oldest");
  });

  it("skips a folder whose list note cannot be read", () => {
    const folder = {
      collectionID: 1,
      notes: [
        {
          key: "NNNNNNN6",
          dateAdded: "2026-01-01 00:00:00",
          html: "<p>no data</p>",
        },
      ],
      papers: papers(A),
    };
    const plan = buildReadingPlan(source({ folders: [folder] }), [1]);
    expect(plan.paths).to.deep.equal([]);
  });

  it("gives a paper in two lists the step of the first ticked list, and keeps both paths", () => {
    const two = source({
      folders: [
        {
          collectionID: 1,
          notes: [
            {
              key: "NNNNNNN6",
              dateAdded: "2026-01-01 00:00:00",
              html: list("One", [A, B]),
            },
          ],
          papers: papers(A, B),
        },
        {
          collectionID: 2,
          notes: [
            {
              key: "MMMMMMM6",
              dateAdded: "2026-01-01 00:00:00",
              html: list("Two", [C, D, B]),
            },
          ],
          papers: papers(B, C, D),
        },
      ],
    });
    const plan = buildReadingPlan(two, [2, 1]);
    expect(plan.paths.map((p) => p.collectionID)).to.deep.equal([2, 1]);
    expect(plan.stepByKey.get(B)).to.equal(3);
    expect(plan.stepByKey.get(A)).to.equal(1);
    expect(plan.afterLast).to.equal(4);
  });

  it("reads every paper's state, Unread when absent", () => {
    const plan = buildReadingPlan(
      source({
        stateNotes: [
          {
            key: "SSSSSSS2",
            html: state({ "doi:10.1000/b": ["read", "2026-11-01T00:00:00Z"] }),
          },
          {
            key: "TTTTTTT3",
            html: state({ [`user:${A}`]: ["reading", "2026-11-01T00:00:00Z"] }),
          },
        ],
      }),
      [],
    );
    expect(plan.stateByKey.get(B)).to.equal("read");
    expect(plan.stateByKey.get(A)).to.equal("reading");
    expect(plan.stateByKey.get(C)).to.equal("unread");
    expect(plan.stateByKey.has("external:1")).to.equal(false);
  });
});

describe("readStateFromNotes", () => {
  it("merges readable notes and skips unreadable ones", () => {
    const doc = readStateFromNotes([
      {
        key: "SSSSSSS2",
        html: state({ "doi:10.1000/b": ["read", "2026-11-01T00:00:00Z"] }),
      },
      {
        key: "TTTTTTT3",
        html: state({ "doi:10.1000/b": ["unread", "2026-11-02T00:00:00Z"] }),
      },
      { key: "UUUUUUU4", html: "<p>broken</p>" },
    ]);
    expect(doc.states["doi:10.1000/b"].state).to.equal("unread");
  });

  it("is empty with no notes", () => {
    expect(readStateFromNotes([])).to.deep.equal({ version: 1, states: {} });
    expect(EMPTY_READING_SOURCE.folders).to.deep.equal([]);
  });
});
