/// <reference types="mocha" />
import { expect } from "chai";
import { createViewGallery } from "../../src/services/graphViewsMenu";
import { SHIPPED_GRAPH_VIEWS } from "../../src/services/graphViews";

/**
 * B44: a plugin button in a Zotero tab is pinned to Zotero's own button height.
 *
 * `chrome://zotero-platform/content/zotero.css` ships
 *   `:is(button:where(:not(.btn, …)), …) { height: 28px }`.
 * `:where()` costs no specificity, so that selector weighs one type selector
 * and loses to every rule the plugin writes — but only for the properties the
 * plugin's rules declare. The base button rule declared `min-height` and never
 * `height`, so the host's 28px applied unopposed and any button holding more
 * than one line painted its text below its own box: the view gallery's cards,
 * and the View dropdown's rows, whose hit areas then sat a row out of step with
 * what was drawn.
 *
 * These checks run in Zotero's **main window**. That matters more than it
 * looks: the visual harness opens the graph in its own XUL window, which never
 * loads that sheet, so every existing suite stayed green while a graph in a tab
 * was broken. Anything guarding a rule of Zotero's own has to be measured where
 * Zotero's own rules apply.
 */
describe("B44, a plugin button's height in a Zotero tab", function () {
  const HTML_NS = "http://www.w3.org/1999/xhtml";

  /**
   * Mount a tree inside a `.meristema-root` in the main window, with the
   * graph's stylesheet attached, hand it over to be measured, then remove it.
   */
  function inMainWindow<T>(
    build: (document: Document) => HTMLElement,
    inspect: (mounted: HTMLElement, host: Window) => T,
  ): T {
    const host = Zotero.getMainWindows()[0] as unknown as Window;
    const document = host.document;
    const link = document.createElementNS(HTML_NS, "link") as HTMLLinkElement;
    link.rel = "stylesheet";
    link.href = "chrome://meristema/content/graph.css";
    document.documentElement.append(link);

    const mount = document.createElementNS(HTML_NS, "div") as HTMLElement;
    mount.className = "meristema-root";
    // Wide enough that the cards wrap the way they do on a real plot, and out
    // of the way of whatever the main window is showing.
    mount.style.cssText =
      "position:fixed; left:0; top:0; width:900px; z-index:9999;";
    mount.append(build(document));
    document.documentElement.append(mount);
    try {
      return inspect(mount, host);
    } finally {
      mount.remove();
      link.remove();
    }
  }

  /**
   * What a button is asked to hold against what its box actually gives it.
   * `scrollHeight` is the content's own height, so a box shorter than it is a
   * button whose text is painting outside itself.
   */
  function tooShort(root: HTMLElement, selector: string): string[] {
    const failures: string[] = [];
    for (const node of Array.from(root.querySelectorAll(selector))) {
      const button = node as HTMLElement;
      const box = button.getBoundingClientRect();
      if (button.scrollHeight > box.height + 0.5) {
        failures.push(
          `${button.className.split(" ")[0]} "${(button.textContent ?? "").slice(0, 32)}…" ` +
            `holds ${button.scrollHeight}px in a ${box.height.toFixed(1)}px box`,
        );
      }
    }
    return failures;
  }

  it("gives the gallery's cards room for the text they hold", function () {
    const NEWLINE = String.fromCharCode(10);
    const failures = inMainWindow(
      (document) => {
        const gallery = createViewGallery(document, {
          shipped: SHIPPED_GRAPH_VIEWS,
          onChoose: () => undefined,
          onBlank: () => undefined,
          onImport: () => undefined,
        });
        gallery.show(15);
        return gallery.root;
      },
      (mount) => {
        const cards = mount.querySelectorAll(".cm-view-gallery-card");
        expect(cards.length, "the gallery drew its cards").to.be.greaterThan(0);
        return tooShort(mount, ".cm-view-gallery-card");
      },
    );
    expect(
      failures.length,
      `every card is as tall as its text:${NEWLINE}  ` +
        `${failures.join(`${NEWLINE}  `)}${NEWLINE}`,
    ).to.equal(0);
  });

  /**
   * The dropdown's rows, which is where the same clamp stopped being cosmetic:
   * a row painted taller than its own box leaves every row below it hit at the
   * wrong place, and the last view could not be clicked at all.
   */
  it("gives the View dropdown's rows room for the text they hold", function () {
    const NEWLINE = String.fromCharCode(10);
    const failures = inMainWindow(
      (document) => {
        // The rows the dropdown builds, without the popup around them: two
        // lines of text in a button, which is the shape that broke.
        const list = document.createElementNS(HTML_NS, "div") as HTMLElement;
        list.className = "cm-view-menu";
        for (const view of SHIPPED_GRAPH_VIEWS) {
          const row = document.createElementNS(
            HTML_NS,
            "button",
          ) as HTMLElement;
          row.className = "cm-view-row";
          const body = document.createElementNS(HTML_NS, "span") as HTMLElement;
          body.className = "cm-view-row-body";
          for (const [cls, content] of [
            ["cm-view-row-name", view.name],
            ["cm-view-row-summary", view.summary],
          ] as const) {
            const span = document.createElementNS(
              HTML_NS,
              "span",
            ) as HTMLElement;
            span.className = cls;
            span.textContent = content;
            body.append(span);
          }
          row.append(body);
          list.append(row);
        }
        return list;
      },
      (mount) => {
        const rows = mount.querySelectorAll(".cm-view-row");
        expect(rows.length, "the dropdown drew its rows").to.be.greaterThan(0);
        return tooShort(mount, ".cm-view-row");
      },
    );
    expect(
      failures.length,
      `every row is as tall as its text:${NEWLINE}  ` +
        `${failures.join(`${NEWLINE}  `)}${NEWLINE}`,
    ).to.equal(0);
  });

  /**
   * B59, the same family read from the other side: a plugin button that wants
   * *no* chrome at all.
   *
   * The Scope rail's row body is a `<button>` styled by `.cm-scope-row-body`,
   * which is (0,1,0) and loses to the plugin's own base rule
   * `.meristema-root button` at (0,1,1) — so it kept the raised surface the
   * base rule paints, which is opaque and hid the selected row's accent fill
   * behind it, and the base rule's accent hover instead of its own neutral
   * tint. The neighbours that already fight this — `cm-scope-seed-remove`,
   * `cm-scope-add-seed` — carry a `.meristema-root` prefix for exactly this
   * reason.
   */
  it("leaves the Scope rail's row body without a background of its own", function () {
    const painted = inMainWindow(
      (document) => {
        const row = document.createElementNS(HTML_NS, "div") as HTMLElement;
        row.className = "cm-scope-row cm-scope-row-selected";
        const body = document.createElementNS(HTML_NS, "button") as HTMLElement;
        body.className = "cm-scope-row-body";
        const label = document.createElementNS(HTML_NS, "span") as HTMLElement;
        label.className = "cm-scope-row-label";
        label.textContent = "Structural Analysis";
        body.append(label);
        row.append(body);
        return row;
      },
      (mount, host) => {
        const body = mount.querySelector(".cm-scope-row-body") as HTMLElement;
        const computed = host.getComputedStyle(body);
        return computed?.backgroundColor ?? "";
      },
    );
    // The selected row's accent has to read through the label's own box, so the
    // button must paint nothing.
    expect(
      /rgba\(0, 0, 0, 0\)|transparent/.test(painted),
      `the row body paints no background of its own, but got "${painted}"`,
    ).to.equal(true);
  });

  /**
   * The floor the base rule is there to hold. `height: auto` beat the host's
   * clamp; `min-height` still has to keep a one-line button at 28px, or every
   * toolbar in the plugin loses a few pixels.
   */
  it("keeps a one-line button at its 28px floor", function () {
    const height = inMainWindow(
      (document) => {
        const button = document.createElementNS(
          HTML_NS,
          "button",
        ) as HTMLElement;
        button.className = "cm-secondary-button";
        button.textContent = "Start blank";
        return button;
      },
      (mount) =>
        (
          mount.querySelector(".cm-secondary-button") as HTMLElement
        ).getBoundingClientRect().height,
    );
    expect(height, `a one-line button is 28px, not ${height}`).to.equal(28);
  });
});
