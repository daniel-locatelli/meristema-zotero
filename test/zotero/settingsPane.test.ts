/// <reference types="mocha" />
import { expect } from "chai";
import { config } from "../../package.json";
import { resetAllPreferences } from "../../src/services/citationPreferences";

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

  it("resets every setting and keeps the API keys", function () {
    const name = (pref: string): string => `${config.prefsPrefix}.${pref}`;
    Zotero.Prefs.set(name("showMetricTooltips"), false, true);
    Zotero.Prefs.set(name("providerAutomatic"), false, true);
    Zotero.Prefs.set(name("openAlexAPIKey"), "kept-key", true);
    try {
      resetAllPreferences();
      expect(Zotero.Prefs.get(name("showMetricTooltips"), true)).to.equal(true);
      expect(Zotero.Prefs.get(name("providerAutomatic"), true)).to.equal(true);
      expect(Zotero.Prefs.get(name("openAlexAPIKey"), true)).to.equal(
        "kept-key",
      );
    } finally {
      Zotero.Prefs.clear(name("openAlexAPIKey"), true);
    }
  });

  it("greys no update option, and the first untick leaves automatic", async function () {
    const name = (pref: string): string => `${config.prefsPrefix}.${pref}`;
    const prefs = ["automaticUpdates", "updateNewItems", "updateModifiedItems"];
    const previous = prefs.map((pref) => Zotero.Prefs.get(name(pref), true));
    for (const pref of prefs) Zotero.Prefs.clear(name(pref), true);
    const win = (Zotero.Utilities.Internal as any).openPreferences(
      `${config.addonRef}-preferences`,
    ) as Window;
    try {
      const child = await until(
        () =>
          win.document?.getElementById(
            "zotero-prefpane-meristema-update-new-items",
          ) as HTMLInputElement | null,
      );
      expect(child, "the option rendered").to.exist;
      const other = win.document.getElementById(
        "zotero-prefpane-meristema-update-modified-items",
      ) as HTMLInputElement;
      const parent = win.document.getElementById(
        "zotero-prefpane-meristema-automatic-updates",
      ) as HTMLInputElement;
      const ready = await until(() => (parent.checked ? true : null));
      expect(ready, "automatic reads on").to.equal(true);
      expect(child!.disabled, "the option is not greyed").to.equal(false);
      expect(child!.checked, "and reads on").to.equal(true);

      child!.click();
      expect(Zotero.Prefs.get(name("automaticUpdates"), true)).to.equal(false);
      expect(parent.checked, "the parent follows").to.equal(false);
      expect(Zotero.Prefs.get(name("updateNewItems"), true)).to.equal(false);
      expect(
        Zotero.Prefs.get(name("updateModifiedItems"), true),
        "the other keeps what it read",
      ).to.equal(true);
      expect(other.checked).to.equal(true);
    } finally {
      win.close();
      prefs.forEach((pref, i) => {
        const value = previous[i];
        if (value === undefined || value === null) {
          Zotero.Prefs.clear(name(pref), true);
        } else {
          Zotero.Prefs.set(name(pref), value as boolean, true);
        }
      });
    }
  });

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
