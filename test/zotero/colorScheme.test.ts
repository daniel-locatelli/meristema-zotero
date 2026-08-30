/// <reference types="mocha" />
import { expect } from "chai";

// Zotero's General → Appearance control is bound to `browser.theme.toolbar-theme`
// (0 dark, 1 light, 2 follow the OS), Gecko's chrome colour-scheme pref. The graph
// renders into the main window and into a chrome:// detached window, so both are
// chrome-privileged documents, and the whole theme layer hangs off what
// `prefers-color-scheme` reports there.
//
// It reports the override correctly — but only to a media query list created after
// the change. Setting the pref triggers no restyle of an open document, so an
// existing `MediaQueryList` keeps its cached `matches` and never fires `change`.
// The renderer must therefore resolve the scheme freshly on every draw and hang
// its re-theming off a pref observer, not off the media query's `change` event.

const APPEARANCE_PREF = "browser.theme.toolbar-theme";

function mainWindow(): Window {
  const win = Zotero.getMainWindows()[0];
  expect(win, "a main Zotero window").to.exist;
  return win as unknown as Window;
}

async function setAppearance(value: number): Promise<void> {
  Services.prefs.setIntPref(APPEARANCE_PREF, value);
  await Zotero.Promise.delay(200);
}

function prefersDark(win: Window): boolean {
  return win.matchMedia("(prefers-color-scheme: dark)")!.matches;
}

describe("Zotero appearance override", function () {
  let original: number;

  before(function () {
    original = Services.prefs.getIntPref(APPEARANCE_PREF, 2);
  });

  after(function () {
    Services.prefs.setIntPref(APPEARANCE_PREF, original);
  });

  it("reaches prefers-color-scheme in a chrome document", async function () {
    const win = mainWindow();
    await setAppearance(0);
    expect(prefersDark(win), "explicit Dark").to.equal(true);
    await setAppearance(1);
    expect(prefersDark(win), "explicit Light").to.equal(false);
  });

  it("does not restyle an open document, so a cached query goes stale", async function () {
    const win = mainWindow();
    await setAppearance(1);

    const query = win.matchMedia("(prefers-color-scheme: dark)")!;
    let fired = false;
    query.addEventListener("change", () => {
      fired = true;
    });

    await setAppearance(0);
    await Zotero.Promise.delay(1000);

    expect(prefersDark(win), "a fresh query sees the change").to.equal(true);
    expect(query.matches, "the cached query does not").to.equal(false);
    expect(fired, "no change event is delivered").to.equal(false);
  });
});
