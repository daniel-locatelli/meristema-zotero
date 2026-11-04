/// <reference types="mocha" />
import { expect } from "chai";
import { createImportArea } from "../../src/services/paperDetailView";
import { delay } from "./visualHarness";

/**
 * B114's chooser: typing a folder's name and pressing Enter adds the paper
 * there, with no click. Enter never files a paper in no collection.
 */
describe("The collection chooser's Enter", function () {
  let win: Window & typeof globalThis;
  let document: Document;
  let collection: any;
  const importedIDs: number[] = [];

  before(async function () {
    win = Zotero.getMainWindow() as unknown as Window & typeof globalThis;
    document = win.document;
    collection = new Zotero.Collection();
    collection.libraryID = Zotero.Libraries.userLibraryID;
    collection.name = "Chooser Enter fixture";
    await collection.saveTx();
  });

  after(async function () {
    for (const id of importedIDs) await Zotero.Items.erase(id);
    await collection.eraseTx();
  });

  function area(inLibraryItemKey: string | null = null) {
    const imported: Zotero.Item[] = [];
    const made = createImportArea(
      document,
      {
        provider: "openalex",
        providerWorkID: `W-enter-${Date.now()}`,
        doi: null,
        title: "Chooser Enter paper",
        year: 2021,
        authors: ["Ada Lovelace"],
        inLibraryItemKey,
      } as any,
      {
        origin: "graph",
        collectionChooser: true,
        showInZotero: () => undefined,
        snapshot: {
          libraryID: Zotero.Libraries.userLibraryID,
          collections: [
            {
              collectionID: collection.id,
              name: "Other",
              path: "Other",
              depth: 0,
            },
            {
              collectionID: collection.id,
              name: collection.name,
              path: collection.name,
              depth: 0,
            },
          ],
        },
      } as any,
      (item) => {
        imported.push(item);
        if (!importedIDs.includes(item.id)) importedIDs.push(item.id);
      },
    );
    made.openChooser();
    const search = made.root.querySelector(
      ".cm-collection-search",
    ) as HTMLInputElement;
    const type = (value: string): void => {
      search.value = value;
      search.dispatchEvent(new win.Event("input", { bubbles: true }));
    };
    const pressEnter = (): void => {
      search.dispatchEvent(
        new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    };
    return { root: made.root, imported, type, pressEnter };
  }

  it("marks the first match and adds the paper to it", async function () {
    this.timeout(20_000);
    const { root, imported, type, pressEnter } = area();
    type("chooser enter");
    const marked = root.querySelector(".cm-collection-choice--next");
    expect(marked?.textContent, "the row Enter would take").to.include(
      "Chooser Enter fixture",
    );
    pressEnter();
    for (let i = 0; i < 100 && !imported.length; i += 1) await delay(100);
    expect(imported, "the paper is added").to.have.length(1);
    expect(imported[0]!.getCollections()).to.deep.equal([collection.id]);
  });

  it("files a paper the library already holds", async function () {
    this.timeout(20_000);
    const held = new Zotero.Item("journalArticle");
    held.libraryID = Zotero.Libraries.userLibraryID;
    held.setField("title", "Chooser Enter held paper");
    await held.saveTx();
    importedIDs.push(held.id);
    const { imported, type, pressEnter } = area(held.key);
    type("chooser enter");
    pressEnter();
    for (let i = 0; i < 100 && !imported.length; i += 1) await delay(100);
    expect(imported, "the paper comes back").to.have.length(1);
    expect(held.getCollections()).to.deep.equal([collection.id]);
  });

  it("does nothing with no match, or with no search", async function () {
    const { imported, type, pressEnter } = area();
    pressEnter();
    type("no folder is called this");
    pressEnter();
    await delay(200);
    expect(imported).to.be.empty;
  });
});
