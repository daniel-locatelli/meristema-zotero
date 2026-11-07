import { describe, it } from "node:test";
import { expect } from "chai";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { URL, fileURLToPath } from "node:url";

const here = fileURLToPath(new URL("../../", import.meta.url));
const sibling = join(here, "..", "zotero-meristema-reading");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

function sameTree(ours: string, theirs: string, only?: RegExp): void {
  const pick = (dir: string): string[] =>
    files(dir)
      .map((path) => relative(dir, path).split("\\").join("/"))
      .filter((path) => !only || only.test(path))
      .sort();
  const mine = pick(ours);
  expect(mine, `files under ${ours}`).to.deep.equal(pick(theirs));
  for (const path of mine) {
    expect(
      readFileSync(join(ours, path)).equals(readFileSync(join(theirs, path))),
      `${path} differs from zotero-meristema-reading; copy it over again`,
    ).to.equal(true);
  }
}

describe("vendored reading format", { skip: !existsSync(sibling) }, () => {
  it("matches zotero-meristema-reading/src/format", () => {
    sameTree(
      join(here, "src", "readingFormat"),
      join(sibling, "src", "format"),
      /\.ts$/,
    );
  });
  it("matches zotero-meristema-reading/fixtures", () => {
    sameTree(
      join(here, "test", "fixtures", "reading-format"),
      join(sibling, "fixtures"),
    );
  });
});
