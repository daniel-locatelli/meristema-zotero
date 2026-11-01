/// <reference types="mocha" />
import { expect } from "chai";
import { getGraphViewController } from "../../src/services/graphViewService";
import {
  makeCorpus,
  openViewStage,
  settle,
  type ViewStage,
} from "./visualHarness";

const DOI = "10.5555/f9.offer.case";

/**
 * F9: a library paper whose DOI field is empty while its match carries one.
 * The harness draws a corpus whose first node is a real item (so Paper
 * details can read and write its field) with a title match on that DOI; the
 * pane must show the evidence, write nothing until the reader confirms, and
 * then write it into the item.
 */
describe("Paper details offers a matched DOI (F9)", function () {
  let stage: ViewStage | null = null;
  let itemID: number | null = null;

  after(async function () {
    this.timeout(15_000);
    stage?.close();
    if (itemID !== null) await Zotero.Items.erase(itemID);
  });

  it("shows an unconfirmed match's evidence and writes the DOI on confirm", async function () {
    this.timeout(60_000);
    const item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField("title", "F9 paper with no DOI");
    itemID = (await item.saveTx()) as number;

    const corpus = makeCorpus({ nodes: 40 });
    const subject = corpus.nodes[0]!;
    subject.itemID = itemID;
    subject.title = "F9 paper with no DOI";
    subject.doi = DOI;
    subject.matchConfirmed = false;
    subject.matchedBy = "title";
    subject.matchConfidence = 0.9;

    stage = await openViewStage(corpus);
    await settle(stage.window, 10);
    getGraphViewController(stage.mount)!.addFocusItems([itemID]);
    await settle(stage.window, 10);

    const offer = stage.root.querySelector(
      ".cm-detail-body .cm-doi-offer",
    ) as HTMLElement | null;
    expect(
      offer,
      `the pane offers the DOI; it reads "${stage.root.querySelector(".cm-detail-body")?.textContent?.slice(0, 200)}"`,
    ).to.exist;
    expect(offer!.textContent).to.contain(`Its match has ${DOI}.`);
    expect(offer!.textContent).to.contain("Matched by title, 90% sure.");
    expect(
      String((Zotero.Items.get(itemID) as Zotero.Item).getField("DOI")),
      "nothing is written before the press",
    ).to.equal("");

    const confirm = (
      Array.from(offer!.querySelectorAll("button")) as HTMLButtonElement[]
    ).find((button) => button.textContent?.trim() === "Confirm and add DOI");
    expect(confirm, "an unconfirmed match asks for a confirm").to.exist;
    confirm!.click();
    const deadline = Date.now() + 10_000;
    while (
      String((Zotero.Items.get(itemID) as Zotero.Item).getField("DOI")) !==
        DOI &&
      Date.now() < deadline
    ) {
      await settle(stage.window, 2);
    }
    expect(
      String((Zotero.Items.get(itemID) as Zotero.Item).getField("DOI")),
      "the confirm writes the DOI into the item",
    ).to.equal(DOI);
  });
});
