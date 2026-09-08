import { describe, it } from "node:test";
import { expect } from "chai";
import {
  bindZoteroSelection,
  normalizeItemIDs,
  sameItemIDs,
  type ItemsTreeLike,
  type LibrarySelection,
  type ZoteroSelectionSyncDeps,
} from "../../src/services/zoteroSelectionSync";

/** The part of Zotero's items tree the binder touches, driven by hand. */
class FakeTree implements ItemsTreeLike {
  listeners = new Set<() => void>();
  selected: number[] = [];
  /** Every `selectItems` call: the ids and the noRecurse flag. */
  selectCalls: { ids: number[]; noRecurse: boolean }[] = [];
  /** What the next `selectItems` resolves with; null makes it reject. */
  nextSelectResult: number | null = 1;
  onSelect = {
    addListener: (listener: () => void): void => {
      this.listeners.add(listener);
    },
    removeListener: (listener: () => void): void => {
      this.listeners.delete(listener);
    },
  };
  getSelectedItems(_asIDs: true): number[] {
    return [...this.selected];
  }
  selectItems(ids: number[], noRecurse: boolean): Promise<number> {
    this.selectCalls.push({ ids: [...ids], noRecurse });
    if (this.nextSelectResult === null) {
      return Promise.reject(new Error("tree gone"));
    }
    return Promise.resolve(this.nextSelectResult);
  }
  /** What Zotero does after a selection: fire every listener. */
  fire(selected: number[]): void {
    this.selected = selected;
    for (const listener of [...this.listeners]) listener();
  }
}

function deps(
  tree: ItemsTreeLike | null,
): ZoteroSelectionSyncDeps & { messages: string[] } {
  const messages: string[] = [];
  return {
    itemsView: () => tree,
    debug: (message) => messages.push(message),
    messages,
  };
}

const host = {} as Window;

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Zotero selection sync", function () {
  it("normalises ids: sorted, deduplicated, finite positives only", function () {
    expect(normalizeItemIDs([5, 3, 5, 0, -1, NaN, 3.5, 3])).to.deep.equal([
      3, 5,
    ]);
    expect(sameItemIDs([1, 2], [1, 2])).to.equal(true);
    expect(sameItemIDs([1, 2], [2, 1])).to.equal(false);
    expect(sameItemIDs([], [])).to.equal(true);
  });

  it("publishes a new selection and not the same one twice", function () {
    const tree = new FakeTree();
    const binding = bindZoteroSelection(host, deps(tree));
    const seen: LibrarySelection[] = [];
    binding.subscribe((selection) => seen.push(selection));
    expect(binding.current().itemIDs).to.deep.equal([]);

    tree.fire([7, 3]);
    expect(seen.map((s) => s.itemIDs)).to.deep.equal([[3, 7]]);
    expect(binding.current().itemIDs).to.deep.equal([3, 7]);

    tree.fire([3, 7]);
    expect(seen.length, "an equal set is not republished").to.equal(1);

    tree.fire([]);
    expect(seen.map((s) => s.itemIDs)).to.deep.equal([[3, 7], []]);
  });

  it("publishes the echo of its own selectListed, so sibling graphs follow", async function () {
    const tree = new FakeTree();
    const binding = bindZoteroSelection(host, deps(tree));
    const seen: number[][] = [];
    binding.subscribe((selection) => seen.push(selection.itemIDs));

    binding.selectListed([42]);
    expect(tree.selectCalls).to.deep.equal([{ ids: [42], noRecurse: true }]);
    await flush();
    tree.fire([42]);
    expect(seen, "the echo is published once").to.deep.equal([[42]]);
    expect(binding.current().itemIDs).to.deep.equal([42]);

    tree.fire([42]);
    expect(seen.length, "an equal follow-up is not republished").to.equal(1);

    tree.fire([42, 43]);
    expect(seen, "a different set after it is published").to.deep.equal([
      [42],
      [42, 43],
    ]);
  });

  it("selectListed is a no-op when the ids are already current", function () {
    const tree = new FakeTree();
    const binding = bindZoteroSelection(host, deps(tree));
    tree.fire([9]);
    binding.selectListed([9]);
    expect(tree.selectCalls).to.deep.equal([]);
  });

  it("changes nothing when no row was listed, and publishes only what the tree fires", async function () {
    const tree = new FakeTree();
    const d = deps(tree);
    const binding = bindZoteroSelection(host, d);
    const seen: number[][] = [];
    binding.subscribe((selection) => seen.push(selection.itemIDs));

    tree.nextSelectResult = 0;
    binding.selectListed([5]);
    await flush();
    expect(
      binding.current().itemIDs,
      "a zero-row select moves nothing",
    ).to.deep.equal([]);
    expect(seen, "and publishes nothing on its own").to.deep.equal([]);

    tree.nextSelectResult = null;
    binding.selectListed([6]);
    await flush();
    expect(
      binding.current().itemIDs,
      "a rejected select moves nothing",
    ).to.deep.equal([]);
    expect(seen).to.deep.equal([]);
    expect(d.messages.some((m) => m.includes("tree gone"))).to.equal(true);

    // Only the tree's own event moves the binding.
    tree.fire([6]);
    expect(seen).to.deep.equal([[6]]);
  });

  it("keeps publishing past a subscriber that throws", function () {
    const tree = new FakeTree();
    const d = deps(tree);
    const binding = bindZoteroSelection(host, d);
    const seen: number[][] = [];
    binding.subscribe(() => {
      throw new Error("bad subscriber");
    });
    binding.subscribe((selection) => seen.push(selection.itemIDs));
    tree.fire([1]);
    expect(seen).to.deep.equal([[1]]);
    expect(d.messages.some((m) => m.includes("bad subscriber"))).to.equal(true);
  });

  it("hands out copies", function () {
    const tree = new FakeTree();
    const binding = bindZoteroSelection(host, deps(tree));
    let received: number[] = [];
    binding.subscribe((selection) => {
      received = selection.itemIDs;
    });
    tree.fire([2, 1]);
    received.push(99);
    binding.current().itemIDs.push(98);
    expect(binding.current().itemIDs).to.deep.equal([1, 2]);
  });

  it("unsubscribes and disposes", function () {
    const tree = new FakeTree();
    const binding = bindZoteroSelection(host, deps(tree));
    const seen: number[][] = [];
    const unsubscribe = binding.subscribe((s) => seen.push(s.itemIDs));
    tree.fire([1]);
    unsubscribe();
    tree.fire([2]);
    expect(seen).to.deep.equal([[1]]);
    expect(tree.listeners.size).to.equal(1);
    binding.dispose();
    expect(tree.listeners.size, "dispose removes the tree listener").to.equal(
      0,
    );
  });

  it("attaches later when the tree is not there at bind time", function () {
    let tree: FakeTree | null = null;
    const d = deps(null);
    d.itemsView = () => tree;
    const binding = bindZoteroSelection(host, d);
    expect(d.messages.length, "logged once").to.equal(1);
    expect(binding.current().itemIDs).to.deep.equal([]);
    expect(d.messages.length, "and not again").to.equal(1);

    tree = new FakeTree();
    const seen: number[][] = [];
    binding.subscribe((s) => seen.push(s.itemIDs));
    binding.selectListed([4]);
    expect(tree.selectCalls).to.deep.equal([{ ids: [4], noRecurse: true }]);
    expect(tree.listeners.size, "attached on first success").to.equal(1);
    tree.fire([8]);
    expect(seen).to.deep.equal([[8]]);
  });

  it("starts from the list's live selection, without publishing it", function () {
    const tree = new FakeTree();
    tree.selected = [11, 4];
    const binding = bindZoteroSelection(host, deps(tree));
    const seen: number[][] = [];
    binding.subscribe((s) => seen.push(s.itemIDs));
    expect(binding.current().itemIDs).to.deep.equal([4, 11]);
    expect(seen).to.deep.equal([]);
    tree.fire([4, 11]);
    expect(seen, "the same set is not an event").to.deep.equal([]);
    tree.fire([5]);
    expect(seen).to.deep.equal([[5]]);
  });

  it("never throws out of the tree listener", function () {
    const tree = new FakeTree();
    const d = deps(tree);
    bindZoteroSelection(host, d);
    tree.getSelectedItems = () => {
      throw new Error("tree exploded");
    };
    expect(() => tree.fire([1])).to.not.throw();
    expect(d.messages.some((m) => m.includes("tree exploded"))).to.equal(true);
  });
});
