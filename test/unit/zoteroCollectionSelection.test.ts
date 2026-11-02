import { describe, it } from "node:test";
import { expect } from "chai";

import { bindZoteroCollectionSelection } from "../../src/services/zoteroCollectionSelection";

function fakeTree(initial: number | null) {
  let selected = initial;
  const listeners = new Set<() => void>();
  return {
    deps: {
      collectionsView: () => ({
        onSelect: {
          addListener: (listener: () => void) => listeners.add(listener),
          removeListener: (listener: () => void) => listeners.delete(listener),
        },
      }),
      selectedCollectionID: () => selected,
      debug: () => undefined,
    },
    pick(id: number | null) {
      selected = id;
      for (const listener of [...listeners]) listener();
    },
    listeners,
  };
}

describe("the folder selection binding (F12)", function () {
  it("reports a folder the reader picks, not the one selected at attach", function () {
    const tree = fakeTree(4);
    const seen: number[] = [];
    bindZoteroCollectionSelection(
      {} as Window,
      (id) => seen.push(id),
      tree.deps,
    );
    expect(seen, "nothing at attach").to.deep.equal([]);
    tree.pick(7);
    tree.pick(7);
    expect(seen, "one report per change").to.deep.equal([7]);
  });

  it("ignores a library or a search, and reports the folder picked after", function () {
    const tree = fakeTree(null);
    const seen: number[] = [];
    bindZoteroCollectionSelection(
      {} as Window,
      (id) => seen.push(id),
      tree.deps,
    );
    tree.pick(3);
    tree.pick(null);
    tree.pick(3);
    expect(seen).to.deep.equal([3, 3]);
  });

  it("stops listening once disposed", function () {
    const tree = fakeTree(null);
    const seen: number[] = [];
    const binding = bindZoteroCollectionSelection(
      {} as Window,
      (id) => seen.push(id),
      tree.deps,
    );
    binding.dispose();
    tree.pick(5);
    expect(seen).to.deep.equal([]);
    expect(tree.listeners.size).to.equal(0);
  });
});
