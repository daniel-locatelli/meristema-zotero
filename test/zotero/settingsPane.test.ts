/// <reference types="mocha" />
import { expect } from "chai";
import { config } from "../../package.json";

async function until<T>(
  read: () => T | null | undefined,
  timeoutMs = 10000,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value) return value;
    await Zotero.Promise.delay(50);
  }
  return null;
}

describe("Meristema settings", function () {
  this.timeout(30000);

  it("updates every library, with no library choice to make (D30)", async function () {
    // An older version stored a narrower selection; the pane must open on it.
    const stale = `${config.prefsPrefix}.updateLibraryIDs`;
    const previous = Zotero.Prefs.get(stale, true);
    Zotero.Prefs.set(stale, "[1]", true);
    const win = (Zotero.Utilities.Internal as any).openPreferences(
      `${config.addonRef}-preferences`,
    ) as Window;
    try {
      const button = await until(() => {
        const found = win.document?.getElementById(
          "zotero-prefpane-meristema-refresh-all",
        );
        return found?.textContent?.trim() ? found : null;
      });
      expect(button, "the bulk-update button rendered").to.exist;
      expect(button!.textContent!.trim()).to.equal("Update all libraries now");
      expect(
        win.document.getElementById(
          "zotero-prefpane-meristema-update-libraries",
        ),
        "the Libraries to update section is gone",
      ).to.equal(null);
    } finally {
      win.close();
      if (previous === undefined) Zotero.Prefs.clear(stale, true);
      else Zotero.Prefs.set(stale, previous as string, true);
    }
  });
});
