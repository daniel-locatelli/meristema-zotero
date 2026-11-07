import { after, describe, it } from "node:test";
import { expect } from "chai";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { URL, fileURLToPath } from "node:url";

import type { LibraryLink } from "../../src/readingFormat/common";
import {
  parseReadingList,
  resolveReadingList,
  writeReadingList,
  type FolderItem,
  type ReadingListDoc,
  type ResolvedStep,
} from "../../src/readingFormat/readingList";
import {
  emptyReadState,
  isPaperId,
  mergeReadStates,
  mirrorTag,
  nextUp,
  paperId,
  parseReadState,
  stateOf,
  writeReadState,
  type PaperRef,
  type ReadState,
  type ReadStateDoc,
  type ReadStateEntry,
} from "../../src/readingFormat/readState";

const root = fileURLToPath(
  new URL("../fixtures/reading-format/", import.meta.url),
);
const text = (path: string): string => readFileSync(root + path, "utf8");
const json = <T>(path: string): T => JSON.parse(text(path)) as T;

interface Index {
  lists: string[];
  states: string[];
  writes: string[];
  paperIds: string;
  nextUp: string;
}
type CaseDir = "lists" | "states" | "writes";
const DIRS: readonly CaseDir[] = ["lists", "states", "writes"];
const index = json<Index>("index.json");
const cases = (dir: CaseDir): string[] => index[dir];

// Every case the index names must run, and nothing else.
const ran = new Set<string>();
after(() => {
  const listed = [
    ...DIRS.flatMap((dir) => index[dir].map((name) => `${dir}/${name}`)),
    index.paperIds,
    index.nextUp,
  ];
  expect([...ran].sort()).to.deep.equal(listed.sort());
});

type Failure = { ok: false; reason: string };

interface ListCase {
  note: string;
  folder: FolderItem[];
  expect:
    | Failure
    | {
        ok: true;
        topic: string;
        steps: ResolvedStep[];
        unordered: string[];
      };
}

interface StateCase {
  notes: string[];
  expect:
    | Failure
    | {
        ok: true;
        states: Record<string, ReadStateEntry>;
        absent: string[];
        mirror: Record<string, string | null>;
      };
}

describe("list fixtures", () => {
  for (const name of cases("lists")) {
    it(name, () => {
      ran.add(`lists/${name}`);
      const c = json<ListCase>(`lists/${name}`);
      const want = c.expect;
      const parsed = parseReadingList(text(`lists/${c.note}`));
      if (!want.ok) {
        expect(parsed).to.deep.equal({ ok: false, reason: want.reason });
        return;
      }
      if (!parsed.ok) throw new Error(`${name} failed: ${parsed.reason}`);
      expect(parsed.value.topic).to.equal(want.topic);
      expect(resolveReadingList(parsed.value, c.folder)).to.deep.equal({
        steps: want.steps,
        unordered: want.unordered,
      });
    });
  }
});

describe("state fixtures", () => {
  const mergeAll = (notes: string[]): ReadStateDoc => {
    let doc: ReadStateDoc = emptyReadState();
    for (const note of notes) {
      const parsed = parseReadState(text(`states/${note}`));
      if (!parsed.ok) throw new Error(`${note} failed: ${parsed.reason}`);
      doc = mergeReadStates(doc, parsed.value);
    }
    return doc;
  };

  for (const name of cases("states")) {
    const c = json<StateCase>(`states/${name}`);
    const want = c.expect;
    if (!want.ok) {
      it(name, () => {
        ran.add(`states/${name}`);
        expect(c.notes, "a failure case has one note").to.have.length(1);
        expect(parseReadState(text(`states/${c.notes[0]}`))).to.deep.equal({
          ok: false,
          reason: want.reason,
        });
      });
      continue;
    }
    const orders =
      c.notes.length > 1 ? [c.notes, [...c.notes].reverse()] : [c.notes];
    for (const notes of orders) {
      it(`${name} (${notes.join(", ")})`, () => {
        ran.add(`states/${name}`);
        const doc = mergeAll(notes);
        expect(doc.states).to.deep.equal(want.states);
        for (const id of want.absent) {
          expect(Object.hasOwn(doc.states, id), id).to.equal(false);
          expect(stateOf(doc, id), id).to.equal("unread");
        }
        for (const [id, tag] of Object.entries(want.mirror)) {
          expect(mirrorTag(stateOf(doc, id)), id).to.equal(tag);
        }
      });
    }
  }
});

type WriteCase =
  | {
      kind: "list";
      doc: ReadingListDoc;
      labels: Record<string, string>;
      library: LibraryLink;
      note: string;
    }
  | { kind: "state"; doc: ReadStateDoc; note: string };

describe("write fixtures", () => {
  for (const name of cases("writes")) {
    it(name, () => {
      ran.add(`writes/${name}`);
      const c = json<WriteCase>(`writes/${name}`);
      const want = text(`writes/${c.note}`);
      if (c.kind === "list") {
        const label = (key: string): string => {
          if (!Object.hasOwn(c.labels, key)) throw new Error(`no label ${key}`);
          return c.labels[key];
        };
        const note = writeReadingList(c.doc, label, c.library);
        expect(note).to.equal(want);
        expect(parseReadingList(note)).to.deep.equal({
          ok: true,
          value: c.doc,
        });
      } else {
        const note = writeReadState(c.doc);
        expect(note).to.equal(want);
        expect(parseReadState(note)).to.deep.equal({ ok: true, value: c.doc });
      }
    });
  }
});

describe("paper-id fixtures", () => {
  const all = json<{ ref: PaperRef; id: string }[]>(index.paperIds);
  it("has cases", () => {
    ran.add(index.paperIds);
    expect(all).to.not.be.empty;
  });
  for (const c of all) {
    it(c.id, () => {
      expect(paperId(c.ref)).to.equal(c.id);
      expect(isPaperId(c.id)).to.equal(true);
    });
  }
});

describe("next-up fixtures", () => {
  const all = json<
    {
      steps: string[];
      states: Record<string, ReadState>;
      expect: string | null;
    }[]
  >(index.nextUp);
  it("has cases", () => {
    ran.add(index.nextUp);
    expect(all).to.not.be.empty;
  });
  all.forEach((c, index) => {
    it(`case ${index + 1}`, () => {
      const steps = c.steps.map((key) => ({ key }));
      expect(nextUp(steps, (key) => c.states[key] ?? "unread")).to.equal(
        c.expect,
      );
    });
  });
});

describe("fixture index", () => {
  const notesOf = (dir: CaseDir, name: string): string[] => {
    const c = json<{ note?: string; notes?: string[] }>(`${dir}/${name}`);
    return (c.notes ?? [c.note ?? ""]).map((note) => `${dir}/${note}`);
  };
  const filesIn = (dir: string): string[] =>
    readdirSync(root + dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) =>
        relative(root, join(entry.parentPath, entry.name)).split(sep).join("/"),
      );

  for (const dir of DIRS) {
    it(`lists every case in ${dir}/, and only those`, () => {
      expect(index[dir], dir).to.not.be.empty;
      const onDisk = filesIn(dir)
        .filter((path) => path.endsWith(".json"))
        .map((path) => path.slice(dir.length + 1));
      expect([...index[dir]].sort()).to.deep.equal(onDisk.sort());
    });
  }

  it("leaves no file under fixtures/ unused", () => {
    const used = new Set([
      "README.md",
      "index.json",
      index.paperIds,
      index.nextUp,
      ...DIRS.flatMap((dir) =>
        index[dir].flatMap((name) => [`${dir}/${name}`, ...notesOf(dir, name)]),
      ),
    ]);
    expect(filesIn("").filter((path) => !used.has(path))).to.deep.equal([]);
    for (const path of used) expect(text(path), path).to.be.a("string");
  });
});
