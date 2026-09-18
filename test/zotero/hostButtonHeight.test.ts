/// <reference types="mocha" />
import { expect } from "chai";
import { createViewGallery } from "../../src/services/graphViewsMenu";
import { SHIPPED_GRAPH_VIEWS } from "../../src/services/graphViews";
import { createKeyRail } from "../../src/services/graphKeyRail";
import type { ScopeRailModel } from "../../src/services/graphScopeRailModel";

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
   * The Scope rail's folder and seed rows carry a `<button>` body styled by
   * `.cm-scope-row-body` — the hop rows carry a `<div>`, which is B71 below —
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

  /** A rail holding one open hop row: a label, and a count beside it. */
  const HOP_ROW_MODEL: ScopeRailModel = {
    countLine: "173 of 173 papers",
    seedsHeading: "Seeds",
    seeds: [],
    rows: [],
    hiddenLine: null,
    hops: {
      direction: "cited-by",
      rows: [
        {
          hop: 1,
          label: "Hop 1",
          count: "73/173",
          reported: null,
          fetchButton: false,
          checkbox: true,
          enabled: true,
          dimmed: false,
          opened: true,
          swatch: "#4f7cff",
        },
      ],
      progress: null,
      cutLine: "Top 50 citers per paper, most cited first",
    },
    floor: { value: 0, belowText: "off" },
  };

  /**
   * B71, which is B59's own fix read from the other side. The Scope rail builds
   * two kinds of row body: a `<button>` for the folder and seed rows
   * (`graphKeyRail.ts:492`) and a `<div>` for the hop rows (`:601`). B59 tagged
   * the layout rule `.meristema-root button.cm-scope-row-body`
   * (`graph.css:1648`) so it would beat the base rule at (0,1,1) — right for
   * the buttons, but it left the div matching no layout rule at all, and
   * `.cm-scope-hop-body` (`:1744`) declares only `cursor: default`. So the hop
   * body loses `display: flex` and its `gap: 6px`, its label and count fall
   * back to adjacent inline spans, and the rail reads `Seeds2` and
   * `Hop173/173`.
   *
   * Two things about how this is measured, both learned the hard way. It runs
   * in the main window because the visual harness opens its own window and
   * never loads Zotero's sheet (B44). And it measures the rail's *own* output
   * rather than a hand-built div: the one case that covered this rule
   * hand-wrote a `<button>` and so encoded the very assumption that broke.
   */
  it("keeps a gap between a hop row's label and its count", async function () {
    const measured = await inMainWindowStyled(
      (document) => {
        const rail = createKeyRail({
          document,
          onEmphasise: () => undefined,
          onScope: {
            toggleRow: () => undefined,
            selectRow: () => undefined,
            removeSeed: () => undefined,
            addSeed: () => undefined,
            showAllHidden: () => undefined,
            setHopDirection: () => undefined,
            fetchHop: () => undefined,
            toggleHop: () => undefined,
            fillControl: () => undefined,
            setFloor: () => undefined,
          },
        });
        rail.renderScope(HOP_ROW_MODEL);
        return rail.root;
      },
      (mount, host) => {
        const body = mount.querySelector(".cm-scope-hop-body") as HTMLElement;
        expect(body, "the rail drew a hop row body").to.exist;
        const label = body.querySelector(".cm-scope-row-label") as HTMLElement;
        const count = body.querySelector(".cm-scope-row-count") as HTMLElement;
        expect(label, "the hop row carries a label").to.exist;
        expect(count, "the hop row carries a count").to.exist;
        const labelBox = label.getBoundingClientRect();
        const countBox = count.getBoundingClientRect();
        // A row that never laid out reports a 0px gap and would fail for a
        // reason that has nothing to do with the cascade.
        expect(labelBox.width, "the label was laid out").to.be.greaterThan(0);
        expect(countBox.width, "the count was laid out").to.be.greaterThan(0);
        return {
          gap: countBox.left - labelBox.right,
          display: host.getComputedStyle(body)?.display ?? "",
        };
      },
    );
    expect(
      measured.gap,
      `the label and count sit 6px apart, but the gap is ` +
        `${measured.gap.toFixed(1)}px and the body computed ` +
        `display:${measured.display}`,
    ).to.be.greaterThan(5);
  });

  /**
   * The same mount, but measured only once both of the plugin's sheets have
   * loaded: a `<link>` loads asynchronously, and a sheet the window has not
   * seen yet is not applied when the next line reads a computed style.
   */
  async function inMainWindowStyled<T>(
    build: (document: Document) => HTMLElement,
    inspect: (mounted: HTMLElement, host: Window) => T,
    rootAttributes: Record<string, string> = {},
  ): Promise<T> {
    const host = Zotero.getMainWindows()[0] as unknown as Window;
    const document = host.document;
    const links = ["paperDetail.css", "graph.css"].map((name) => {
      const link = document.createElementNS(HTML_NS, "link") as HTMLLinkElement;
      link.rel = "stylesheet";
      link.href = `chrome://meristema/content/${name}`;
      return link;
    });
    const loaded = Promise.all(
      links.map(
        (link) =>
          new Promise<void>((resolve) => {
            link.addEventListener("load", () => resolve(), { once: true });
            link.addEventListener("error", () => resolve(), { once: true });
          }),
      ),
    );
    document.documentElement.append(...links);
    const mount = document.createElementNS(HTML_NS, "div") as HTMLElement;
    mount.className = "meristema-root";
    mount.style.cssText =
      "position:fixed; left:0; top:0; width:460px; z-index:9999;";
    for (const [name, value] of Object.entries(rootAttributes)) {
      if (name === "style") mount.style.cssText += value;
      else mount.setAttribute(name, value);
    }
    mount.append(build(document));
    document.documentElement.append(mount);
    try {
      await loaded;
      return inspect(mount, host);
    } finally {
      mount.remove();
      links.forEach((link) => link.remove());
    }
  }

  /** `rgb(…)`, `rgba(…)` or `color(srgb …)`, as 0–1 channels and an alpha. */
  function parseColor(value: string): [number, number, number, number] | null {
    const srgb =
      /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/.exec(value);
    if (srgb) {
      return [
        Number(srgb[1]),
        Number(srgb[2]),
        Number(srgb[3]),
        srgb[4] === undefined ? 1 : Number(srgb[4]),
      ];
    }
    const rgb = /rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)/.exec(
      value,
    );
    if (!rgb) return null;
    return [
      Number(rgb[1]) / 255,
      Number(rgb[2]) / 255,
      Number(rgb[3]) / 255,
      rgb[4] === undefined ? 1 : Number(rgb[4]),
    ];
  }

  /** WCAG contrast of an ink over an opaque ground, compositing the ink's alpha. */
  function contrast(ink: string, ground: string): number {
    const fg = parseColor(ink);
    const bg = parseColor(ground);
    if (!fg || !bg) return 0;
    const mixed = [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3]));
    const luminance = (c: number[]): number => {
      const [r, g, b] = c.map((v) =>
        v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
      );
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const a = luminance(mixed);
    const b = luminance(bg.slice(0, 3));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }

  /**
   * B46: the plugin's text links wear the base rule's hover box. They are
   * `<button>`s, and the base rule's `.meristema-root button:hover:not(:disabled)`
   * at (0,3,1) outranks their own class-only hover at (0,3,0) — so "+ Add
   * seed", Stop, Show all and the tutorial card's dismiss link all took an
   * accent-tinted 28px box on hover, under the underline they asked for. The
   * × beside them never did: its selectors carry the tag (B14).
   */
  const TEXT_LINKS = [
    ["cm-scope-add-seed", "+ Add seed"],
    ["cm-scope-hop-action", "Stop"],
    ["cm-scope-show-all", "Show all"],
    ["cm-link-button", "Don't show for this view again"],
  ] as const;

  function hovered(
    host: Window,
    button: HTMLElement,
  ): { background: string; decoration: string } {
    const inspector = (globalThis as any).InspectorUtils;
    expect(inspector, "InspectorUtils, to hold the hover state").to.exist;
    inspector.addPseudoClassLock(button, ":hover");
    try {
      const computed = host.getComputedStyle(button)!;
      return {
        background: computed.backgroundColor,
        decoration: computed.textDecorationLine,
      };
    } finally {
      inspector.removePseudoClassLock(button, ":hover");
    }
  }

  function buildTextLinks(document: Document): HTMLElement {
    const column = document.createElementNS(HTML_NS, "div") as HTMLElement;
    for (const [cls, label] of TEXT_LINKS) {
      const button = document.createElementNS(HTML_NS, "button") as HTMLElement;
      button.className = cls;
      button.textContent = label;
      column.append(button);
    }
    return column;
  }

  it("paints no box behind a hovered text link", async function () {
    const NEWLINE = String.fromCharCode(10);
    const painted = await inMainWindowStyled(buildTextLinks, (mount, host) =>
      TEXT_LINKS.map(([cls]) => {
        const button = mount.querySelector(`.${cls}`) as HTMLElement;
        return [cls, hovered(host, button).background] as const;
      }).filter(
        ([, background]) => !/rgba\(0, 0, 0, 0\)|transparent/.test(background),
      ),
    );
    expect(
      painted.length,
      `every hovered text link paints nothing:${NEWLINE}  ` +
        `${painted.map(([cls, bg]) => `${cls} painted ${bg}`).join(`${NEWLINE}  `)}${NEWLINE}`,
    ).to.equal(0);
  });

  it("underlines a hovered text link", async function () {
    const NEWLINE = String.fromCharCode(10);
    const plain = await inMainWindowStyled(buildTextLinks, (mount, host) =>
      TEXT_LINKS.map(([cls]) => {
        const button = mount.querySelector(`.${cls}`) as HTMLElement;
        return [cls, hovered(host, button).decoration] as const;
      }).filter(([, decoration]) => decoration !== "underline"),
    );
    expect(
      plain.length,
      `every hovered text link is underlined:${NEWLINE}  ` +
        `${plain.map(([cls, deco]) => `${cls} read "${deco}"`).join(`${NEWLINE}  `)}${NEWLINE}`,
    ).to.equal(0);
  });

  /**
   * B61: the Key rail's entries are `<button>`s whose hover rule
   * `.cm-key-entry:not(.cm-key-entry-static):hover` is (0,3,0), so the base
   * rule's `.meristema-root button:hover:not(:disabled)` at (0,3,1) paints its
   * accent tint over the neutral 8% the rail asks for — the symptom B59 fixed
   * on the Scope row. Measured against a swatch of the tint the rule names,
   * resolved in the same mount.
   */
  it("tints a hovered Key entry neutral, not accent", async function () {
    const measured = await inMainWindowStyled(
      (document) => {
        const column = document.createElementNS(HTML_NS, "div") as HTMLElement;
        column.className = "cm-key";
        const entry = document.createElementNS(
          HTML_NS,
          "button",
        ) as HTMLButtonElement;
        entry.className = "cm-key-entry";
        entry.type = "button";
        entry.setAttribute("aria-pressed", "false");
        const label = document.createElementNS(HTML_NS, "span") as HTMLElement;
        label.className = "cm-key-entry-label";
        label.textContent = "Journal article";
        entry.append(label);
        const swatch = document.createElementNS(HTML_NS, "div") as HTMLElement;
        swatch.className = "cm-test-swatch";
        swatch.style.background =
          "color-mix(in srgb, CanvasText 8%, transparent)";
        column.append(entry, swatch);
        return column;
      },
      (mount, host) => ({
        hovered: hovered(host, mount.querySelector(".cm-key-entry")!)
          .background,
        wanted: host.getComputedStyle(mount.querySelector(".cm-test-swatch")!)!
          .backgroundColor,
      }),
    );
    expect(
      measured.hovered,
      `a hovered Key entry paints ${measured.hovered}; its rule asks ` +
        `${measured.wanted}`,
    ).to.equal(measured.wanted);
  });

  /**
   * B61's other half: the prefixed reset `.meristema-root button.cm-key-entry`
   * sets a transparent background at (0,2,1), which outranks the pinned rule
   * `.cm-key-entry[aria-pressed="true"]` at (0,2,0) — so a pinned entry
   * painted nothing, and a pin had no pressed look in the rail at all.
   */
  it("tints a pinned Key entry with the accent", async function () {
    const measured = await inMainWindowStyled(
      (document) => {
        const column = document.createElementNS(HTML_NS, "div") as HTMLElement;
        column.className = "cm-key";
        const entry = document.createElementNS(
          HTML_NS,
          "button",
        ) as HTMLButtonElement;
        entry.className = "cm-key-entry";
        entry.type = "button";
        entry.setAttribute("aria-pressed", "true");
        const label = document.createElementNS(HTML_NS, "span") as HTMLElement;
        label.className = "cm-key-entry-label";
        label.textContent = "Journal article";
        entry.append(label);
        const swatch = document.createElementNS(HTML_NS, "div") as HTMLElement;
        swatch.className = "cm-test-swatch";
        swatch.style.background =
          "color-mix(in srgb, var(--cm-accent) 18%, transparent)";
        column.append(entry, swatch);
        return column;
      },
      (mount, host) => ({
        pinned: host.getComputedStyle(mount.querySelector(".cm-key-entry")!)!
          .backgroundColor,
        wanted: host.getComputedStyle(mount.querySelector(".cm-test-swatch")!)!
          .backgroundColor,
      }),
    );
    expect(
      measured.pinned,
      `a pinned Key entry paints ${measured.pinned}; its rule asks ` +
        `${measured.wanted}`,
    ).to.equal(measured.wanted);
  });

  /**
   * B57: the save panel's refusal is the line between the reader and a
   * rejected save, and it was the least legible one there — 11px in a 12px
   * panel, in a colour token nothing defines, so the `#a44c00` fallback in
   * both schemes, which reads on white and is about 3:1 on the dark panel.
   */
  function buildSaveWarning(document: Document): HTMLElement {
    const panel = document.createElementNS(HTML_NS, "div") as HTMLElement;
    panel.className = "cm-view-save";
    panel.style.cssText = "position:static; transform:none;";
    const error = document.createElementNS(HTML_NS, "p") as HTMLElement;
    error.className = "cm-view-save-error";
    error.textContent = "A view with that name already exists.";
    panel.append(error);
    return panel;
  }

  it("sets the save panel's name warning at the panel's own size", async function () {
    const sizes = await inMainWindowStyled(buildSaveWarning, (mount, host) => ({
      panel: host.getComputedStyle(mount.querySelector(".cm-view-save")!)!
        .fontSize,
      error: host.getComputedStyle(mount.querySelector(".cm-view-save-error")!)!
        .fontSize,
    }));
    expect(
      sizes.error,
      `the warning is ${sizes.error} in a ${sizes.panel} panel`,
    ).to.equal(sizes.panel);
  });

  for (const scheme of ["light", "dark"] as const) {
    it(`keeps the save panel's name warning readable on the ${scheme} panel`, async function () {
      const measured = await inMainWindowStyled(
        buildSaveWarning,
        (mount, host) => {
          const ink = host.getComputedStyle(
            mount.querySelector(".cm-view-save-error")!,
          )!.color;
          const ground = host.getComputedStyle(
            mount.querySelector(".cm-view-save")!,
          )!.backgroundColor;
          return { ink, ground, ratio: contrast(ink, ground) };
        },
        { "data-cm-scheme": scheme, style: `color-scheme:${scheme};` },
      );
      expect(
        measured.ratio,
        `the warning ${measured.ink} on ${measured.ground} is ` +
          `${measured.ratio.toFixed(2)}:1`,
      ).to.be.at.least(4.5);
    });
  }

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
