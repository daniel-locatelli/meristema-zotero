/// <reference types="mocha" />
import { expect } from "chai";
import { config } from "../../package.json";
import { getOpenAlexAPIKey } from "../../src/services/citationPreferences";
import { graphThemeFor } from "../../src/services/graphTheme";
import { emptyGraphViewState } from "../../src/services/graphViewState";
import { getPluginDatabase } from "../../src/services/pluginDatabase";
import {
  createSavedGraph,
  deleteSavedGraph,
  listSavedGraphs,
} from "../../src/services/savedGraphService";
import { delay } from "./visualHarness";

const COLLECTION_NAME = "Stage 3 hops";
/** Zotero's appearance: 0 dark, 1 light, 2 follow the OS. */
const APPEARANCE_PREF = "browser.theme.toolbar-theme";
/**
 * Every fixture DOI and work ID carries the whole clock, never a slice of it
 * that repeats (B79): lists and checks persist in the test profile, and a
 * paper an earlier run stored is one the fill never asks for again.
 */
const RUN = String(Date.now());
/**
 * One library paper, served by the suite's own index (B74) in both
 * directions. Six citers and three references: small enough that a hop-2
 * fill lands in seconds, large enough that every count the ladder shows is
 * non-zero.
 */
const FIXTURE_TITLE = "Stage 3 hop fixture";
const FIXTURE_DOI = `10.5555/hops.${RUN}.seed`;
const SAVED_GRAPH_NAME = "Stage 3 hop graph";
const V4_GRAPH_NAME = "Stage 3 v4 both";
/** The one-time notice a version 4 `both` record earns on open. */
const BOTH_NOTICE = "Directions are now one at a time; showing Citers";
/**
 * B50's paper: one the fill has never expanded, with citers in the served
 * index, so once the providers answer again hop 1 fills from whichever
 * answers first.
 */
const REFUSAL_TITLE = "Stage 3 refusal fixture";
const REFUSAL_DOI = `10.5555/hops.${RUN}.refusal`;
/** Every provider a fill may ask. The wrapper answers these with HTTP 429. */
const REFUSED_URL =
  /^https:\/\/(api\.semanticscholar\.org|opencitations\.net|api\.opencitations\.net|api\.openalex\.org)\//;
/**
 * B72's seed carries a DOI of its own, fabricated like its citers. The case
 * serves every provider itself, so the seed never has to be a paper an index
 * really knows — and a DOI nothing else uses is the only way to be sure no
 * DOI-keyed state reaches it. The external-works metadata mirror keys by DOI,
 * and B50 runs immediately before against a real one, so sharing that DOI let
 * a stored citer count bound this case's own fetch.
 */
const DRAIN_SEED_DOI = "10.5555/b72.drain.seed";
/**
 * The seed's own citation list. B72's wrapper answers every other
 * OpenCitations citation URL with an empty list, so hop-1 papers report no
 * citers while the seed still fills hop 1. The DOI reaches the wrapper either
 * raw or percent-encoded.
 */
const SEED_CITATIONS = new RegExp(
  `opencitations\\.net/index/v2/citations/doi:(${DRAIN_SEED_DOI.replace(
    /[.]/g,
    "\\.",
  )}|${encodeURIComponent(DRAIN_SEED_DOI).replace(/[.]/g, "\\.")})`,
  "i",
);
/**
 * The seed's citers, fabricated so the case owns them. Two DOIs no library
 * item carries, so `localNodeForWork` matches nothing and each arrives as an
 * external node: `itemID: 0`, OpenCitations as its provider, the DOI as its
 * provider work ID. Those are exactly the three conditions
 * `graphViewService.ts:3898` requires before it hints a work ID, and a hint is
 * what B72's path needs — a hop-1 paper whose empty list nothing backs.
 */
const DRAIN_CITERS = ["10.5555/b72.drain.a", "10.5555/b72.drain.b"];
/**
 * The refusal anchor, and the reason this case can go red at all: a SECOND
 * SEED the library holds, carrying a DOI no index knows. A library paper has
 * no work-ID hint and no provider of its own, so the fill asks Semantic
 * Scholar first (the automatic citations order, `registry.ts`), is refused,
 * and re-opens the window every time it lapses. Without it the window opened
 * once, at the first seed's expansion, and had closed again by the time the
 * hop-1 papers landed — so nobody was sitting out, their landings were not
 * refused, and pre-fix code drained the plan correctly.
 *
 * It is a seed rather than a third citer because `planHopFill` ranks
 * `hop === 0` at 0, ahead of every hop-1 paper, so the anchor is expanded
 * first on every cycle by the product's own rule, whatever else is going on.
 * Ordering it by selection was tried first and lost the race in red run 7:
 * both children expanded while the window was shut, so neither landing was
 * refused, both were failed, and the plan emptied down to the anchor. Why the
 * selection did not hold was never established — external keys are `focus:…`
 * (graphFocusService.ts:56) and sort ahead of a library item key in the
 * `key.localeCompare` tiebreak, so any cycle where `selectedKey` is not the
 * anchor hands the children the plan. Rank 0 removes the question entirely.
 */
// No fixture DOI here may be a prefix of another: `urlNames` matches by
// substring on the percent-encoded form, so `…drain.a` matched `…drain.anchor`
// and misattributed the anchor's own lookups to a citer (green run 2).
const DRAIN_ANCHOR_DOI = "10.5555/b72.drain.refuser";
const DRAIN_SEED_TITLE = `${REFUSAL_TITLE} (drain)`;
const DRAIN_ANCHOR_TITLE = `${REFUSAL_TITLE} (anchor)`;
/** Hop 1: the two citers with no citers of their own. */
const DRAIN_HOP_1 = DRAIN_CITERS.length;
/**
 * What the plan holds once hop 2 is fetched: those two, and the anchor seed,
 * which cannot leave until the deferral limit fails it.
 */
const DRAIN_PLANNED = DRAIN_CITERS.length + 1;
/** The seed's citation page in OpenCitations' own row shape. */
const DRAIN_CITER_LIST = JSON.stringify(
  DRAIN_CITERS.map((doi) => ({ citing: `doi:${doi}` })),
);
/** Semantic Scholar's own host: the provider this case keeps sitting out. */
const SEMANTIC_SCHOLAR_HOST = /^https:\/\/api\.semanticscholar\.org\//;
/** OpenCitations' work lookup — the request a work-ID hint skips. */
const META_LOOKUP = /opencitations\.net\/meta\/v1\/metadata\//i;
/**
 * Every provider host the B72 case answers for itself. Anything else — Zotero's
 * own traffic — still reaches the network, so the wrapper cannot break the
 * session it runs in.
 */
const PROVIDER_HOST =
  /^https:\/\/(api\.semanticscholar\.org|opencitations\.net|api\.opencitations\.net|api\.openalex\.org|api\.crossref\.org|inspirehep\.net)\//;
/** Grouped digits as the machine locale prints them (de-CH: 1'200). */
const COUNT_FORMAT = new Intl.NumberFormat(undefined, { useGrouping: true });
/**
 * The OpenAlex key pref the D8 block sets for itself. It lives out here rather
 * than in the block: reading `config.prefsPrefix` inside a `describe` body is a
 * member expression at collection time, which `mocha/no-setup-in-describe`
 * refuses.
 */
const OPEN_ALEX_KEY_PREF = `${config.prefsPrefix}.openAlexAPIKey`;
/** The layout a graph opens with, kept out here for the same reason. */
const GRAPH_APPEARANCE_PREF = `${config.prefsPrefix}.graphAppearance`;
/**
 * The shared-citers block's fixtures (Stage 4, B78), unique per run: the
 * check's answers persist in the test profile for up to 180 days.
 */
const W = (n: number): string => `W9${RUN}${n}`;
const SEED_A = {
  doi: `10.5555/shared.${RUN}.a`,
  id: W(50),
  title: `${FIXTURE_TITLE} (shared A)`,
};
const SEED_B = {
  doi: `10.5555/shared.${RUN}.b`,
  id: W(60),
  title: `${FIXTURE_TITLE} (shared B)`,
};
/**
 * W51 cites both seeds; W52 cites A only; W53 cites B only. W54 cites
 * both but made only A's list: the cut dropped it from B's (B78), and
 * only its reference list says it cites B.
 */
const CITERS_OF: Record<string, string[]> = {
  [SEED_A.id]: [W(51), W(52), W(54)],
  [SEED_B.id]: [W(51), W(53)],
};
const REFERENCES_OF: Record<string, string[]> = {
  [W(51)]: [SEED_A.id, SEED_B.id],
  [W(52)]: [SEED_A.id],
  [W(53)]: [SEED_B.id],
  [W(54)]: [SEED_A.id, SEED_B.id],
};
const citerDOI = (id: string): string => `10.5555/shared.${id.toLowerCase()}`;

/** A provider sitting out a window: a refusal, never an error (ADR 0013). */
function providerRefusal(): unknown {
  return { status: 429, responseText: "", getResponseHeader: () => null };
}
/** A provider answering, with the body the case wants it to answer. */
function providerAnswer(responseText: string): unknown {
  return { status: 200, responseText, getResponseHeader: () => null };
}
/** A provider that does not know the paper: final, unlike a refusal. */
function providerNotFound(): unknown {
  return { status: 404, responseText: "", getResponseHeader: () => null };
}

/**
 * The index the whole suite is served from (B74). Keyless Semantic Scholar
 * throttled the suite against itself: a second full run within the hour was
 * refused, and the hop cases read `0/0` with nothing broken. So every
 * provider host is answered here, and nothing reaches the network.
 *
 * Semantic Scholar is first in both automatic orders, so it carries the
 * fills; OpenCitations answers too, for B50's seed while Semantic Scholar is
 * still sitting out its window. Every count is honest (a list as long as the
 * count beside it), so no fill moves on to another provider. Each answer
 * waits a little, as a real one does: the Refresh case needs a fill it can
 * catch running.
 *
 * The blocks after the ten cases install wrappers of their own over this
 * one. Each answers its own provider traffic and hands the rest down, so
 * they run as they did before.
 */
interface ServedPaper {
  id: string;
  doi: string;
  title: string;
  year: number;
  cites: readonly string[];
}
const SERVED_LATENCY_MS = 400;
const served = (n: string, title: string, year: number, cites: string[]) => ({
  id: `hops${RUN}${n}`,
  doi: `10.5555/hops.${RUN}.${n}`,
  title,
  year,
  cites,
});
const servedID = (n: string): string => `hops${RUN}${n}`;
/**
 * The fixture cites three papers, one of which cites a fourth, so References
 * reaches hop 2. Six papers cite the fixture, and one paper cites all six,
 * so every hop-1 expansion under Citers finds a citer and the fill stays
 * busy for six round trips.
 */
const HOP_CITERS = ["c1", "c2", "c3", "c4", "c5", "c6"];
const SERVED_PAPERS: readonly ServedPaper[] = [
  {
    ...served("seed", FIXTURE_TITLE, 2015, ["r1", "r2", "r3"].map(servedID)),
    doi: FIXTURE_DOI,
  },
  served("r1", "Stage 3 reference one", 2010, [servedID("r4")]),
  served("r2", "Stage 3 reference two", 2011, []),
  served("r3", "Stage 3 reference three", 2012, []),
  served("r4", "Stage 3 reference of a reference", 2005, []),
  ...HOP_CITERS.map((n, index) =>
    served(n, `Stage 3 citer ${n}`, 2016 + index, [servedID("seed")]),
  ),
  served("d1", "Stage 3 citer of citers", 2023, HOP_CITERS.map(servedID)),
  {
    ...served("refusal", REFUSAL_TITLE, 2012, []),
    doi: REFUSAL_DOI,
  },
  served("e1", "Stage 3 refusal citer one", 2014, [servedID("refusal")]),
  served("e2", "Stage 3 refusal citer two", 2015, [servedID("refusal")]),
];

function servedPaper(identifier: string): ServedPaper | undefined {
  const doi = /^doi:(.+)$/i.exec(identifier)?.[1]?.toLowerCase();
  return SERVED_PAPERS.find((paper) =>
    doi ? paper.doi.toLowerCase() === doi : paper.id === identifier,
  );
}

function citersOf(paper: ServedPaper): ServedPaper[] {
  return SERVED_PAPERS.filter((other) => other.cites.includes(paper.id));
}

function referencesOf(paper: ServedPaper): ServedPaper[] {
  return paper.cites.map((id) => servedPaper(id)!);
}

function semanticScholarPaper(paper: ServedPaper): unknown {
  return {
    paperId: paper.id,
    externalIds: { DOI: paper.doi },
    title: paper.title,
    year: paper.year,
    publicationDate: `${paper.year}-01-01`,
    authors: [{ authorId: "1", name: "A. Author" }],
    citationCount: citersOf(paper).length,
    referenceCount: paper.cites.length,
  };
}

/** Semantic Scholar's lookup, relation pages and batch, from the index. */
function semanticScholarAnswer(url: URL, options: any): unknown {
  if (url.pathname.endsWith("/paper/batch")) {
    const ids = (JSON.parse(String(options?.body ?? "{}")).ids ??
      []) as string[];
    return providerAnswer(
      JSON.stringify(
        ids.map((id) => {
          const paper = servedPaper(id);
          return paper ? semanticScholarPaper(paper) : null;
        }),
      ),
    );
  }
  const match =
    /^\/graph\/v1\/paper\/([^/]+)(?:\/(citations|references))?$/.exec(
      url.pathname,
    );
  const paper = match ? servedPaper(decodeURIComponent(match[1]!)) : undefined;
  if (!paper) return providerNotFound();
  if (!match![2])
    return providerAnswer(JSON.stringify(semanticScholarPaper(paper)));
  const rows =
    match![2] === "citations"
      ? citersOf(paper).map((p) => ({ citingPaper: semanticScholarPaper(p) }))
      : referencesOf(paper).map((p) => ({
          citedPaper: semanticScholarPaper(p),
        }));
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const limit = Number(url.searchParams.get("limit") ?? 100);
  const page = rows.slice(offset, offset + limit);
  return providerAnswer(
    JSON.stringify({
      data: page,
      ...(offset + limit < rows.length ? { next: offset + limit } : {}),
    }),
  );
}

/** OpenCitations' citation and reference rows, from the index. */
function openCitationsAnswer(url: URL): unknown {
  const match = /\/index\/v2\/(citations|references)\/doi:(.+)$/.exec(
    url.pathname,
  );
  const paper = match
    ? servedPaper(`doi:${decodeURIComponent(match[2]!)}`)
    : undefined;
  if (!paper) return providerAnswer("[]");
  return providerAnswer(
    JSON.stringify(
      match![1] === "citations"
        ? citersOf(paper).map((p) => ({
            citing: `doi:${p.doi}`,
            creation: `${p.year}-01-01`,
          }))
        : referencesOf(paper).map((p) => ({ cited: `doi:${p.doi}` })),
    ),
  );
}

/** Every provider host, answered from the index; anything else goes out. */
function serveIndex(live: any): (...args: any[]) => Promise<unknown> {
  return async (method: string, url: string, options?: unknown) => {
    if (!PROVIDER_HOST.test(url))
      return live.call(Zotero.HTTP, method, url, options);
    await delay(SERVED_LATENCY_MS);
    const parsed = new URL(url);
    if (SEMANTIC_SCHOLAR_HOST.test(url))
      return semanticScholarAnswer(parsed, options);
    if (/opencitations\.net$/.test(parsed.hostname))
      return openCitationsAnswer(parsed);
    return providerNotFound();
  };
}

/**
 * Lays a block's own answers over whatever answers now (the served index,
 * unless another block has wrapped it), and returns the undo. A URL `hosts`
 * does not match goes down to the layer beneath.
 */
function interceptProviders(
  answer: (url: string) => unknown,
  hosts: RegExp = PROVIDER_HOST,
): () => void {
  const below = Zotero.HTTP.request;
  (Zotero.HTTP as any).request = async (
    method: string,
    url: string,
    options?: unknown,
  ) =>
    hosts.test(url)
      ? answer(url)
      : below.call(Zotero.HTTP, method, url, options);
  return () => {
    (Zotero.HTTP as any).request = below;
  };
}

/**
 * One OpenAlex record. A null `count` leaves `cited_by_count` out, which real
 * OpenAlex never does; D8 needs it absent (see its CITERS).
 */
function openAlexWork(paper: {
  id: string;
  doi: string;
  title: string;
  year: number;
  count: number | null;
}): unknown {
  return {
    id: `https://openalex.org/${paper.id}`,
    doi: `https://doi.org/${paper.doi}`,
    display_name: paper.title,
    publication_year: paper.year,
    publication_date: `${paper.year}-01-01`,
    ...(paper.count === null ? {} : { cited_by_count: paper.count }),
    referenced_works_count: 0,
    authorships: [
      {
        author: { id: "https://openalex.org/A1", display_name: "A. Author" },
      },
    ],
    primary_location: null,
  };
}

/**
 * Hold until `count()` has stood still for `idleMs`, so a case starts from a
 * quiet baseline. Saving a library item queues an automatic citation-data
 * update of its own (automaticUpdateCoordinator.ts, 1.2 s after the save), and
 * that update is what puts the paper on the plot at all, so it cannot be
 * turned off — D8's run 2 turned it off and the node-menu walk was offered the
 * outer fixture alone. It is not the fill's traffic either, and counting it
 * would read like the fill asking providers it never asked, so the case waits
 * it out instead.
 */
async function untilQuiet(
  count: () => number,
  idleMs: number,
  capMs: number,
): Promise<boolean> {
  const deadline = Date.now() + capMs;
  let seen = count();
  let since = Date.now();
  while (Date.now() < deadline) {
    await delay(500);
    if (count() !== seen) {
      seen = count();
      since = Date.now();
    } else if (Date.now() - since >= idleMs) return true;
  }
  return false;
}

function shown(popup: Element): Promise<void> {
  return new Promise((resolve) => {
    if ((popup as any).state === "open") return resolve();
    popup.addEventListener("popupshown", () => resolve(), { once: true });
  });
}

function customMenu(popup: Element, l10nID: string): any {
  const menu = Array.from(popup.children).find(
    (child) => (child as HTMLElement).dataset?.l10nId === l10nID,
  );
  expect(menu, `menu ${l10nID}`).to.exist;
  return menu;
}

async function waitFor<T>(
  probe: () => T | null | undefined | false,
  timeoutMs: number,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await delay(50);
  }
}

function command(element: Element): void {
  const win = element.ownerDocument.defaultView as any;
  element.dispatchEvent(new win.Event("command", { bubbles: true }));
}

function normalize(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The citation hop ladder, walked through the plugin's own chrome. The test
 * bundle is a second copy of the plugin, so nothing here reaches into a view:
 * a graph is opened from Tools › Meristema › New Graph, a library paper the
 * served index knows is made a seed from the plot's own node menu, and every
 * outcome is read from the rendered rail. Every failure carries the counts it
 * saw.
 *
 * The cases run in order against that one graph: the seed the first adds is
 * the ladder the rest walk, and the sixth saves what the first five left.
 */
describe("Citation hops (Stage 3)", function () {
  let win: any;
  /** The graph this suite opened; case 6 closes it. */
  let tabID: string | null = null;
  /** A blank graph kept only for its File menu once the main tab is gone. */
  let hostTabID: string | null = null;
  /** The saved graph reopened in case 6. */
  let reopenedTabID: string | null = null;
  /** The version 4 record opened in case 7. */
  let v4TabID: string | null = null;
  /** The window case 8 moves the version 4 graph into. */
  let v4Window: Window | null = null;
  /** Whichever tab the rail helpers read: the main graph, then the reopened. */
  let currentTabID: string | null = null;
  let collectionID: number | null = null;
  let fixtureIDs: number[] = [];
  let v4GraphID: number | null = null;
  /** Set while File › Save's name dialog is answered by the suite. */
  let promptStubbed = false;
  let realPrompt: any = null;
  /** `Zotero.HTTP.request` as the suite found it, while the index serves. */
  let liveRequest: any = null;

  function tabContent(id: string | null): HTMLElement | null {
    if (!id) return null;
    return (win.Zotero_Tabs.getTabContent(id) as HTMLElement) ?? null;
  }

  /**
   * The graph rendered in this suite's current tab. Asking the document for
   * `.meristema-root` would answer with whichever graph another suite left
   * behind while its tab was still closing.
   */
  function rootOf(id: string | null): HTMLElement {
    const root = tabContent(id)?.querySelector(
      ".meristema-root",
    ) as HTMLElement | null;
    expect(root, `the graph in tab ${id} is rendered`).to.exist;
    return root as HTMLElement;
  }

  function graphRoot(): HTMLElement {
    return rootOf(currentTabID);
  }

  function graphTabs(): any[] {
    return (win.Zotero_Tabs._tabs as any[]).filter(
      (tab) => tab.type === config.addonRef,
    );
  }

  /** The `shown` half of the rail's `{shown} of {total} papers`. */
  function scopeCount(): number {
    const line =
      graphRoot().querySelector(".cm-scope-count")?.textContent ?? "";
    return Number(/^([\d,]+) of/.exec(line)?.[1]?.replace(/,/g, "") ?? "0");
  }

  /** One row of the Citation hops block, or null before a seed exists. */
  function hopRow(hop: number): HTMLElement | null {
    return graphRoot().querySelector(
      `.cm-scope-hop-row[data-hop="${hop}"]`,
    ) as HTMLElement | null;
  }

  function hopRowText(hop: number): string {
    const row = hopRow(hop);
    return row ? normalize(row.textContent) : `no row for hop ${hop}`;
  }

  /**
   * The row's count, or null while the row carries the Fetch button instead
   * (`.cm-scope-row-count` is not rendered on the first row past the depth).
   */
  function hopCountText(hop: number): string | null {
    const text = hopRow(hop)?.querySelector(".cm-scope-row-count")?.textContent;
    return text === undefined || text === null ? null : normalize(text);
  }

  /** `{shown}/{available}` as numbers, or null when the row shows no pair. */
  function hopCounts(hop: number): { shown: number; available: number } | null {
    const text = hopCountText(hop);
    // The rail groups with Intl.NumberFormat, whose separator follows the
    // machine's locale — de-CH prints 1'200 — so take each side whole
    // and strip all that is not a digit, rather than naming separators.
    const match = text ? new RegExp("^([^/]+)/([^/]+)$").exec(text) : null;
    if (!match) return null;
    return {
      shown: Number(match[1]!.replace(/\D/g, "")),
      available: Number(match[2]!.replace(/\D/g, "")),
    };
  }

  /** The runner's progress line, absent while it has nothing to do. */
  function progressText(): string {
    const line = graphRoot().querySelector(".cm-scope-hop-progress");
    return line ? normalize(line.textContent) : "no progress line";
  }

  /** The progress line while the runner has work in hand: `expanding · {n} left`. */
  function isExpanding(line: string): boolean {
    return /^expanding · \d+ left/.test(line);
  }

  /**
   * Press Refresh and wait for its whole cycle: it must report busy (or have
   * finished before the first sample) and come back pressable. Without this
   * the assertions after a Refresh read the ladder the Refresh has not
   * touched yet, and pass whether or not it did anything.
   */
  async function refreshCycle(): Promise<string> {
    await pressRefresh();
    const busy = await waitFor(
      () =>
        refreshButton().disabled ||
        refreshButton().getAttribute("aria-busy") === "true",
      10_000,
    );
    const free = await waitFor(
      () =>
        !refreshButton().disabled &&
        refreshButton().getAttribute("aria-busy") !== "true",
      150_000,
    );
    return `refresh went busy: ${Boolean(busy)}, came back: ${Boolean(free)}`;
  }

  /** The `Fetch hop N` button, which sits in the first row past the depth. */
  function fetchButton(hop: number): HTMLButtonElement | null {
    const button = hopRow(hop)?.querySelector(
      ".cm-scope-hop-fetch",
    ) as HTMLButtonElement | null;
    return button ?? null;
  }

  function hopCheckbox(hop: number): HTMLInputElement {
    const box = hopRow(hop)?.querySelector(
      "input.cm-scope-check",
    ) as HTMLInputElement | null;
    expect(box, `hop ${hop} carries a checkbox; row read "${hopRowText(hop)}"`)
      .to.exist;
    return box as HTMLInputElement;
  }

  /** One cell of the Citers | References switch. */
  function directionCell(label: "Citers" | "References"): HTMLButtonElement {
    const cell = (
      Array.from(
        graphRoot().querySelectorAll(".cm-scope-hops .cm-segmented-cell"),
      ) as HTMLButtonElement[]
    ).find((candidate) => normalize(candidate.textContent) === label);
    expect(cell, `the ${label} cell of the direction switch`).to.exist;
    return cell as HTMLButtonElement;
  }

  function directionState(): string {
    return (
      Array.from(
        graphRoot().querySelectorAll(".cm-scope-hops .cm-segmented-cell"),
      ) as HTMLButtonElement[]
    )
      .map(
        (cell) =>
          `${normalize(cell.textContent)}=${cell.getAttribute("aria-checked")}`,
      )
      .join(" ");
  }

  function refreshButton(): HTMLButtonElement {
    const button = (
      Array.from(
        graphRoot().querySelectorAll(".cm-toolbar-button"),
      ) as HTMLButtonElement[]
    ).find((candidate) => normalize(candidate.textContent) === "Refresh");
    expect(button, "the toolbar's Refresh button").to.exist;
    return button as HTMLButtonElement;
  }

  /** Press Refresh, once it is free to be pressed. */
  async function pressRefresh(): Promise<void> {
    const button = await waitFor(() => {
      const live = refreshButton();
      return live.disabled ? null : live;
    }, 30_000);
    expect(
      button,
      `Refresh never became pressable; title "${refreshButton().title}", ` +
        `aria-busy ${refreshButton().getAttribute("aria-busy")}`,
    ).to.exist;
    button!.click();
  }

  function statusText(id: string | null = currentTabID): string {
    return normalize(
      tabContent(id)?.querySelector(".cm-toolbar-status")?.textContent,
    );
  }

  /**
   * Wait, keeping every distinct state the ladder passed through on the way.
   * A hop that never fills says nothing in the DOM at the end — whether the
   * runner ever had work is only visible while it is working, so the trace is
   * what a failure here is diagnosed from.
   */
  async function traceUntil(
    probe: () => boolean,
    timeoutMs: number,
  ): Promise<string> {
    const trace: string[] = [];
    const started = Date.now();
    let last = "";
    for (;;) {
      const sample =
        `hop1 "${hopRowText(1)}" hop2 "${hopRowText(2)}" ` +
        `${progressText()} scope ${scopeCount()}`;
      if (sample !== last) {
        trace.push(`+${Date.now() - started}ms ${sample}`);
        last = sample;
      }
      if (probe()) break;
      if (Date.now() - started > timeoutMs) {
        trace.push(`gave up after ${Date.now() - started}ms`);
        break;
      }
      await delay(200);
    }
    return (
      trace.join(" || ") +
      `; recent Zotero errors: ${
        (Zotero.getErrors(true) as string[]).slice(-3).join(" || ") || "none"
      }`
    );
  }

  /** The whole ladder in one line, for an assertion message. */
  function ladder(): string {
    const rows: string[] = [];
    for (let hop = 0; hop <= 3; hop += 1) rows.push(hopRowText(hop));
    return rows.join(" | ");
  }

  /**
   * D4's gallery sits over the plot of a graph that has never chosen a view,
   * and its backdrop blur is the first suspect for a walk's flake (B43), so
   * every failure of the walk says what the gallery was doing.
   */
  function galleryState(): string {
    const section = graphRoot().querySelector(
      ".cm-view-gallery",
    ) as HTMLElement | null;
    if (!section) return "no gallery in the DOM";
    return section.hidden ? "gallery present, hidden" : "gallery SHOWN";
  }

  /** Take the gallery off the plot, so the node-menu walk has a clear canvas. */
  async function dismissGallery(id: string | null): Promise<void> {
    const section = await waitFor(() => {
      const live = tabContent(id)?.querySelector(
        ".cm-view-gallery",
      ) as HTMLElement | null;
      return live && !live.hidden ? live : null;
    }, 10_000);
    if (!section) return;
    const start = (
      Array.from(section.querySelectorAll("button")) as HTMLButtonElement[]
    ).find((button) => normalize(button.textContent) === "Start blank");
    if (!start) return;
    start.click();
    await waitFor(() => section.hidden, 5_000);
  }

  function nodeMenuItems(): HTMLButtonElement[] {
    const menu = graphRoot().querySelector(".cm-node-menu") as HTMLElement;
    if (!menu || menu.hidden) return [];
    return (
      Array.from(
        menu.querySelectorAll(".cm-node-menu-item"),
      ) as HTMLButtonElement[]
    ).filter((button) => !button.hidden);
  }

  function closeNodeMenu(): void {
    const menu = graphRoot().querySelector(".cm-node-menu") as HTMLElement;
    if (!menu || menu.hidden) return;
    menu.dispatchEvent(
      new win.KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
    );
  }

  /**
   * Right-click the fixture's node and hand back one of its menu entries, the
   * way the Scope rail suite does: the plot answers where its papers are by
   * putting the hovered paper's tooltip on the canvas, so the search walks
   * the plot with pointer moves and right-clicks every point that names a
   * paper it has not tried. Here the tooltip must also name the fixture —
   * a hop of the wrong paper would prove nothing.
   *
   * The grid is walked in whole CSS pixels (B43): a synthetic PointerEvent
   * keeps a fractional clientX but a synthetic MouseEvent is delivered at the
   * truncated integer, so a hover and a right-click "at the same point" can
   * reach the renderer a pixel apart. Each pass re-reads the canvas: a
   * library update mid-walk remounts the plot and replaces it (B83).
   */
  async function nodeMenuEntry(
    label: string,
    titleIncludes: string,
  ): Promise<HTMLButtonElement> {
    let canvas = graphRoot().querySelector("canvas") as HTMLCanvasElement;
    const firstCanvas = canvas;
    const move = (x: number, y: number): void => {
      canvas.dispatchEvent(
        new win.PointerEvent("pointermove", {
          bubbles: true,
          clientX: x,
          clientY: y,
        }),
      );
    };
    const tried = new Set<string>();
    const clicks: string[] = [];
    const menuState = (): string => {
      const menu = graphRoot().querySelector(".cm-node-menu") as HTMLElement;
      if (!menu) return "no menu element";
      if (menu.hidden) return "menu hidden";
      return `menu open [${nodeMenuItems()
        .map((button) => button.textContent?.trim())
        .join(", ")}]`;
    };
    const started = Date.now();
    const deadline = started + 20_000;
    let passes = 0;
    for (;;) {
      passes += 1;
      canvas = graphRoot().querySelector("canvas") as HTMLCanvasElement;
      const box = canvas.getBoundingClientRect();
      const left = Math.ceil(box.left);
      const top = Math.ceil(box.top);
      for (let y = top + 4; y < box.bottom - 4; y += 5) {
        for (let x = left + 4; x < box.right - 4; x += 5) {
          move(x, y);
          const paper = canvas.title;
          if (!paper || tried.has(paper)) continue;
          tried.add(paper);
          if (!paper.includes(titleIncludes)) continue;
          const rightClick = new win.MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
          });
          canvas.dispatchEvent(rightClick);
          clicks.push(
            `${paper.split("\n")[0]} @${x},${y} pass ${passes}: ` +
              `hit=${rightClick.defaultPrevented} ${menuState()}`,
          );
          const entry = nodeMenuItems().find(
            (button) => button.textContent?.trim() === label,
          );
          if (entry) return entry;
          closeNodeMenu();
        }
      }
      if (Date.now() > deadline) break;
      await delay(500);
    }
    expect.fail(
      `no node menu entry reading ${label} on a paper named ${titleIncludes}` +
        `; ${tried.size} paper(s) offered ${[...tried].join(" | ") || "nothing"}` +
        `; ${passes} pass(es) over the canvas in ${Date.now() - started}ms` +
        `; ${galleryState()}` +
        `; clicks: ${clicks.join(" || ") || "none"}` +
        `; the walk's canvas was ${firstCanvas === canvas ? "never replaced" : "replaced by a remount"}` +
        `, the Scope section read "${normalize(graphRoot().querySelector(".cm-scope-section")?.textContent)}"` +
        `; recent Zotero errors: ${
          (Zotero.getErrors(true) as string[]).slice(-5).join(" || ") || "none"
        }`,
    );
  }

  /** Open a graph from Tools › Meristema › New Graph; hand back its tab id. */
  async function openNewGraphTab(): Promise<string> {
    const doc = win.document as Document;
    const already = new Set(graphTabs().map((tab) => tab.id));
    const toolsPopup = doc.getElementById("menu_ToolsPopup")!;
    let showing = shown(toolsPopup);
    (toolsPopup as any).openPopup(null, "after_start", 0, 0, false, false);
    await showing;
    const tools = customMenu(toolsPopup, `${config.addonRef}-tools-submenu`);
    showing = shown(tools.menupopup);
    tools.openMenu(true);
    await showing;
    command(
      customMenu(tools.menupopup, `${config.addonRef}-new-graph-view-command`),
    );
    (toolsPopup as any).hidePopup();
    const tab = await waitFor(
      () => graphTabs().find((candidate) => !already.has(candidate.id)),
      20_000,
    );
    expect(tab, "the new graph's tab").to.exist;
    return tab!.id as string;
  }

  /**
   * Open a saved graph from a live graph's own File menu — the saved-graph
   * menu the D4 suite uses — and hand back the tab it lands in.
   */
  async function openSavedGraphFromFileMenu(
    hostID: string,
    name: string,
  ): Promise<string> {
    const before = new Set(graphTabs().map((tab) => tab.id));
    const fileButton = (): HTMLButtonElement => {
      const found = (
        Array.from(
          rootOf(hostID).querySelectorAll(".cm-toolbar-button"),
        ) as HTMLButtonElement[]
      ).find((candidate) => normalize(candidate.textContent).includes("File"));
      expect(found, "the toolbar's File button").to.exist;
      return found as HTMLButtonElement;
    };
    fileButton().click();
    const entry = await waitFor(() => {
      const menu = rootOf(hostID).querySelector(
        ".cm-graph-menu",
      ) as HTMLElement | null;
      if (!menu || menu.hidden) {
        fileButton().click();
        return null;
      }
      return (
        Array.from(
          menu.querySelectorAll(
            '.cm-graph-menu-list button[data-action="open"]',
          ),
        ) as HTMLButtonElement[]
      ).find((candidate) => normalize(candidate.textContent).includes(name));
    }, 15_000);
    expect(entry, `File › Open did not list ${name}`).to.exist;
    entry!.click();
    const opened = await waitFor(
      () => graphTabs().find((tab) => !before.has(tab.id)),
      25_000,
    );
    expect(opened, `the tab for ${name}`).to.exist;
    return opened!.id as string;
  }

  /**
   * File › Save on an unbound graph asks for a name through Services.prompt,
   * which is modal. The stub answers it and is installed by redefining the
   * property — the object itself is not writable — and it outlives the async
   * handler behind the menu, so it is taken down only once the save landed.
   */
  function stubPrompt(name: string): void {
    if (promptStubbed) return;
    realPrompt = (Services as any).prompt;
    const stub: any = {
      prompt: (
        _window: unknown,
        _title: unknown,
        _message: unknown,
        value: { value: string },
      ) => {
        value.value = name;
        return true;
      },
    };
    for (const method of ["confirmEx", "confirm", "alert", "confirmCheck"]) {
      stub[method] = (...args: unknown[]) =>
        realPrompt[method]?.(...(args as never[]));
    }
    Object.defineProperty(Services, "prompt", {
      configurable: true,
      get: () => stub,
    });
    promptStubbed = true;
  }

  function restorePrompt(): void {
    if (!promptStubbed) return;
    Object.defineProperty(Services, "prompt", {
      configurable: true,
      get: () => realPrompt,
    });
    promptStubbed = false;
  }

  /** The File menu's own Save, clicked. */
  async function clickFileSave(hostID: string): Promise<void> {
    const fileButton = (): HTMLButtonElement => {
      const found = (
        Array.from(
          rootOf(hostID).querySelectorAll(".cm-toolbar-button"),
        ) as HTMLButtonElement[]
      ).find((candidate) => normalize(candidate.textContent).includes("File"));
      expect(found, "the toolbar's File button").to.exist;
      return found as HTMLButtonElement;
    };
    fileButton().click();
    const save = await waitFor(() => {
      const menu = rootOf(hostID).querySelector(
        ".cm-graph-menu",
      ) as HTMLElement | null;
      if (!menu || menu.hidden) {
        fileButton().click();
        return null;
      }
      return menu.querySelector(
        'button[data-action="save"]',
      ) as HTMLButtonElement | null;
    }, 15_000);
    expect(save, "the File menu's Save").to.exist;
    save!.click();
  }

  before(async function () {
    this.timeout(90_000);
    win = Zotero.getMainWindows()[0];
    // Before the fixture is saved: saving it queues an automatic update that
    // asks the providers about it.
    liveRequest = Zotero.HTTP.request;
    (Zotero.HTTP as any).request = serveIndex(liveRequest);
    const libraryID = Zotero.Libraries.userLibraryID;
    const collection = new Zotero.Collection();
    collection.libraryID = libraryID;
    collection.name = COLLECTION_NAME;
    collectionID = await collection.saveTx();
    // One paper only: the node-menu walk has to land on this DOI, and a
    // second fixture would only give it somewhere else to land.
    const item = new Zotero.Item("journalArticle");
    item.libraryID = libraryID;
    item.setField("title", FIXTURE_TITLE);
    item.setField("date", "2015");
    item.setField("DOI", FIXTURE_DOI);
    item.addToCollection(collectionID);
    fixtureIDs.push(await item.saveTx());

    tabID = await openNewGraphTab();
    currentTabID = tabID;
    win.Zotero_Tabs.select(tabID);
    const rail = await waitFor(
      () =>
        tabContent(tabID)?.querySelector(".cm-scope-section .cm-scope-count"),
      30_000,
    );
    expect(rail, "the rail's Scope section").to.exist;
    // A graph that has never chosen a view is greeted by the gallery, which
    // sits over the plot the walk below reads.
    await dismissGallery(tabID);
    const fit = await waitFor(
      () =>
        graphRoot().querySelector(
          '.cm-zoom-controls button[data-action="fit"]',
        ) as HTMLButtonElement | null,
      10_000,
    );
    expect(fit, "the rail's fit button").to.exist;
    fit!.click();
    await waitFor(() => {
      const canvas = graphRoot().querySelector("canvas");
      return canvas ? canvas.getBoundingClientRect().width > 10 : false;
    }, 10_000);
  });

  /*
   * Every step runs, whatever state the cases left. A failed case can leave a
   * tab closing, a prompt stubbed and a saved graph row behind, and a hook
   * that threw before the cleanup would strand all three for the next suite.
   * The first error is kept and rethrown once the cleanup is done.
   */
  after(async function () {
    this.timeout(60_000);
    let failure: unknown = null;
    const record = (error: unknown): void => {
      if (failure === null) failure = error;
    };
    try {
      restorePrompt();
    } catch (error) {
      record(error);
    }
    try {
      if (v4Window && !v4Window.closed) v4Window.close();
      for (const id of [v4TabID, reopenedTabID, hostTabID, tabID]) {
        if (id) win.Zotero_Tabs.close(id);
      }
      await delay(500);
    } catch (error) {
      record(error);
    }
    v4TabID = null;
    reopenedTabID = null;
    hostTabID = null;
    tabID = null;
    currentTabID = null;
    try {
      if (v4GraphID !== null) await deleteSavedGraph(v4GraphID);
      v4GraphID = null;
      const saved = await listSavedGraphs(Zotero.Libraries.userLibraryID);
      for (const graph of saved) {
        if (graph.name === SAVED_GRAPH_NAME || graph.name === V4_GRAPH_NAME) {
          await deleteSavedGraph(graph.id);
        }
      }
    } catch (error) {
      record(error);
    }
    try {
      for (const id of fixtureIDs) await Zotero.Items.erase(id);
      fixtureIDs = [];
      if (collectionID !== null) {
        const collection = Zotero.Collections.get(collectionID) as any;
        if (collection) await collection.eraseTx();
        collectionID = null;
      }
    } catch (error) {
      record(error);
    }
    if (liveRequest) (Zotero.HTTP as any).request = liveRequest;
    liveRequest = null;
    if (failure !== null) throw failure;
  });

  it("fills hop 1 once the paper becomes a seed", async function () {
    // The seed path no longer fetches anything (Task 12): hop 1 is the
    // runner's first landing, so this wait covers a served round-trip.
    this.timeout(120_000);
    (await nodeMenuEntry("Add as seed", FIXTURE_TITLE)).click();
    const row = await waitFor(() => hopRow(1), 20_000);
    expect(
      row,
      `the ladder never appeared; ${galleryState()}; scope ${scopeCount()}`,
    ).to.exist;
    const trace = await traceUntil(() => {
      const counts = hopCounts(1);
      return counts !== null && counts.available > 0;
    }, 60_000);
    const counts = hopCounts(1);
    expect(
      counts,
      `hop 1 never reported a count; hop 1 read "${hopRowText(1)}"; ` +
        `Seeds read "${hopRowText(0)}"; ${galleryState()}; trace: ${trace}`,
    ).to.not.equal(null);
    expect(
      counts!.available,
      `hop 1 read "${hopCountText(1)}"; Seeds read "${hopRowText(0)}"; ` +
        `${galleryState()}; trace: ${trace}`,
    ).to.be.greaterThan(0);
    expect(
      counts!.shown,
      `hop 1 shows fewer than it has: "${hopCountText(1)}"; ` +
        `Seeds read "${hopRowText(0)}"; ${progressText()}; ${galleryState()}`,
    ).to.equal(counts!.available);
  });

  it("opens hop 2 from the Fetch hop 2 button", async function () {
    this.timeout(180_000);
    const button = fetchButton(2);
    expect(
      button,
      `hop 2 carries no Fetch button; hop 2 read "${hopRowText(2)}"; ` +
        `ladder ${ladder()}`,
    ).to.exist;
    expect(
      normalize(button!.textContent),
      `the button in the hop 2 row read "${normalize(button!.textContent)}"`,
    ).to.equal("Fetch hop 2");
    expect(
      hopCountText(2),
      `hop 2 already had a count before the fetch: "${hopRowText(2)}"`,
    ).to.equal(null);
    button!.click();
    const trace = await traceUntil(() => {
      const counts = hopCounts(2);
      return counts !== null && counts.available > 0;
    }, 120_000);
    const counts = hopCounts(2);
    expect(
      counts,
      `hop 2 never left "not fetched"; hop 1 read "${hopCountText(1)}"; ` +
        `hop 2 read "${hopRowText(2)}"; trace: ${trace}`,
    ).to.not.equal(null);
    expect(
      counts!.available,
      `hop 1 read "${hopCountText(1)}"; hop 2 read "${hopCountText(2)}"; ` +
        `trace: ${trace}`,
    ).to.be.greaterThan(0);
  });

  it("keeps Refresh pressable while the fill runs", async function () {
    // The guard is only worth anything at a moment the runner is actually
    // filling: reading an idle graph's Refresh button proves nothing. So the
    // case first establishes a fill — case 2's may already have drained, and
    // a Refresh starts a fresh one by widening the seed's own list — and
    // then reads the button and the progress line in the same tick.
    this.timeout(180_000);
    if (!isExpanding(progressText())) await pressRefresh();
    let seenWhileBusy = "none";
    const moment = await waitFor(() => {
      const line = progressText();
      if (!isExpanding(line)) return null;
      const live = refreshButton();
      if (live.disabled || live.getAttribute("aria-busy") === "true") {
        // The reader's own Refresh is allowed to hold its button while it
        // runs; what must not happen is the runner holding it.
        seenWhileBusy = `${line} (Refresh busy)`;
        return null;
      }
      return `${line} | Refresh enabled, aria-busy ${live.getAttribute("aria-busy")}`;
    }, 120_000);
    expect(
      moment,
      `never saw the runner filling with Refresh free; the last fill seen ` +
        `while Refresh was held was "${seenWhileBusy}"; progress now ` +
        `"${progressText()}"; Refresh disabled=${refreshButton().disabled} ` +
        `aria-busy ${refreshButton().getAttribute("aria-busy")}; ` +
        `ladder ${ladder()}`,
    ).to.exist;
    expect(
      moment,
      "the moment read must carry the fill's own progress line",
    ).to.match(/^expanding · \d+ left/);
  });

  it("fills hop 2 again after a Refresh", async function () {
    // The timing-shaped case, run a second time: the ladder must reach the
    // same place from a seed whose lists are refetched under it.
    this.timeout(240_000);
    const before = hopCounts(2);
    const beforeText = hopCountText(2);
    // `hopCounts(2).available > 0` is already true on entry, so a wait for it
    // returns on its first tick and proves nothing. Wait for the Refresh's
    // own cycle instead, then hold the ladder to what it read before it.
    const cycle = await refreshCycle();
    // The spec ("The fill") accepts that a manual refresh may shrink a
    // seed's list, so this does not bound `available` against `before`; it
    // only requires the row still reads a real, non-empty count.
    await waitFor(() => {
      const counts = hopCounts(2);
      return counts !== null && counts.available >= 1;
    }, 120_000);
    const counts = hopCounts(2);
    expect(
      counts,
      `hop 2 lost its count across a Refresh; it read "${beforeText}" before ` +
        `and "${hopRowText(2)}" after; hop 1 read "${hopCountText(1)}"; ` +
        `${cycle}; progress: ${progressText()}`,
    ).to.not.equal(null);
    expect(
      counts!.available,
      `hop 2 read "${beforeText}" before the Refresh and "${hopCountText(2)}" ` +
        `after (delta ${counts!.available - (before?.available ?? 0)}); ` +
        `${cycle}; progress: ${progressText()}`,
    ).to.be.at.least(1);
  });

  it("hides the hop 2 papers when hop 1 is unticked, and brings them back", async function () {
    this.timeout(60_000);
    const scopeBefore = scopeCount();
    const hop2Before = hopCountText(2);
    hopCheckbox(1).click();
    await waitFor(() => hopCounts(2)?.shown === 0, 20_000);
    const hidden = hopCounts(2);
    expect(
      hidden?.shown,
      `unticking hop 1 left hop 2 showing; before hop 2 read "${hop2Before}" ` +
        `and scope ${scopeBefore}, after hop 2 read "${hopCountText(2)}" and ` +
        `scope ${scopeCount()}; ladder ${ladder()}`,
    ).to.equal(0);
    expect(
      scopeCount(),
      `the plot kept every paper; scope was ${scopeBefore}, is ` +
        `${scopeCount()}; ladder ${ladder()}`,
    ).to.be.lessThan(scopeBefore);
    hopCheckbox(1).click();
    await waitFor(() => (hopCounts(2)?.shown ?? 0) > 0, 20_000);
    expect(
      hopCounts(2)?.shown ?? 0,
      `re-ticking hop 1 did not bring hop 2 back; before "${hop2Before}", ` +
        `after "${hopCountText(2)}"; scope was ${scopeBefore}, is ` +
        `${scopeCount()}; ladder ${ladder()}`,
    ).to.be.greaterThan(0);
  });

  it("rebuilds the ladder on the References side of the switch", async function () {
    this.timeout(180_000);
    const before = ladder();
    directionCell("References").click();
    // The Citers ladder is still in the DOM when the click returns, and its
    // hop 1 already reads a count — so waiting only for "hop 1 has a count"
    // is satisfied by the stale one. Wait for the rebuild first.
    const rebuildTrace = await traceUntil(() => ladder() !== before, 60_000);
    expect(
      ladder(),
      `the ladder never left its Citers shape after the switch; it read ` +
        `${before}; ${directionState()}; trace: ${rebuildTrace}`,
    ).to.not.equal(before);
    const trace = await traceUntil(() => {
      const counts = hopCounts(1);
      return counts !== null && counts.available > 0;
    }, 120_000);
    const counts = hopCounts(1);
    expect(
      counts,
      `References never filled hop 1; the ladder read ${before} before and ` +
        `${ladder()} after; ${directionState()}; trace: ${trace}`,
    ).to.not.equal(null);
    expect(
      counts!.available,
      `hop 1 read "${hopCountText(1)}" on References; ${directionState()}; ` +
        `trace: ${trace}`,
    ).to.be.greaterThan(0);
    expect(
      directionCell("References").getAttribute("aria-checked"),
      `the switch reads ${directionState()}; ladder ${ladder()}`,
    ).to.equal("true");
    expect(
      directionCell("Citers").getAttribute("aria-checked"),
      `the switch reads ${directionState()}`,
    ).to.equal("false");
  });

  it("fills References hop 1 again after a Refresh", async function () {
    // The second timing-shaped case, repeated as the first one is, and held
    // to the count it read before the Refresh rather than to "more than 0",
    // which was already true when the case started.
    this.timeout(240_000);
    const before = hopCounts(1);
    const beforeText = hopCountText(1);
    const cycle = await refreshCycle();
    // The spec ("The fill") accepts that a manual refresh may shrink a
    // seed's list, so this does not bound `available` against `before`; it
    // only requires the row still reads a real, non-empty count.
    await waitFor(() => {
      const counts = hopCounts(1);
      return counts !== null && counts.available >= 1;
    }, 120_000);
    const counts = hopCounts(1);
    expect(
      counts,
      `References hop 1 lost its count across a Refresh; it read ` +
        `"${beforeText}" before and "${hopRowText(1)}" after; ` +
        `${directionState()}; ${cycle}; progress: ${progressText()}`,
    ).to.not.equal(null);
    expect(
      counts!.available,
      `hop 1 read "${beforeText}" before the Refresh and "${hopCountText(1)}" ` +
        `after (delta ${counts!.available - (before?.available ?? 0)}); ` +
        `${directionState()}; ${cycle}; progress: ${progressText()}`,
    ).to.be.at.least(1);
  });

  it("saves the graph and finds its direction and depth on reopening", async function () {
    this.timeout(120_000);
    const savedLadder = ladder();
    const savedDirection = directionState();
    stubPrompt(SAVED_GRAPH_NAME);
    await clickFileSave(tabID!);
    // The save is asynchronous behind the menu, so the store is polled here
    // rather than through `waitFor`, whose probe is synchronous.
    const deadline = Date.now() + 30_000;
    let names = (await listSavedGraphs(Zotero.Libraries.userLibraryID)).map(
      (graph) => graph.name,
    );
    while (!names.includes(SAVED_GRAPH_NAME) && Date.now() < deadline) {
      await delay(250);
      names = (await listSavedGraphs(Zotero.Libraries.userLibraryID)).map(
        (graph) => graph.name,
      );
    }
    expect(
      names,
      `File › Save wrote no row; the toolbar status read "${statusText()}"`,
    ).to.include(SAVED_GRAPH_NAME);
    restorePrompt();

    // A graph bound to the row is simply activated by Open, so the tab has to
    // go before the record can be read back. A blank graph is kept for its
    // File menu, which is the saved-graph menu this reopens from.
    hostTabID = await openNewGraphTab();
    await dismissGallery(hostTabID);
    win.Zotero_Tabs.close(tabID!);
    tabID = null;
    await delay(500);
    reopenedTabID = await openSavedGraphFromFileMenu(
      hostTabID,
      SAVED_GRAPH_NAME,
    );
    currentTabID = reopenedTabID;
    win.Zotero_Tabs.select(reopenedTabID);
    const row = await waitFor(
      () =>
        tabContent(reopenedTabID)?.querySelector(
          '.cm-scope-hop-row[data-hop="2"]',
        ),
      40_000,
    );
    expect(
      row,
      `the reopened graph never drew a ladder; it was saved as ` +
        `${savedLadder} (${savedDirection})`,
    ).to.exist;
    expect(
      directionCell("References").getAttribute("aria-checked"),
      `the reopened switch reads ${directionState()}; it was saved as ` +
        `${savedDirection}; ladder ${ladder()}`,
    ).to.equal("true");
    expect(
      hopRowText(2),
      `hop 2 came back unfetched; it was saved as ${savedLadder}, ` +
        `reopened as ${ladder()}`,
    ).to.not.contain("not fetched");
    expect(
      hopCountText(2),
      `hop 2 shows a Fetch button instead of a count; it was saved as ` +
        `${savedLadder}, reopened as ${ladder()}; hop 2 read ` +
        `"${hopRowText(2)}", count "${hopCountText(2)}"`,
    ).to.not.be.null;
    expect(
      hopRowText(1),
      `hop 1 came back unfetched; it was saved as ${savedLadder}, ` +
        `reopened as ${ladder()}`,
    ).to.not.contain("not fetched");
  });

  it("says so once when a version 4 record asked for both directions", async function () {
    this.timeout(120_000);
    // A version 4 row, written raw: the store always writes the current
    // version, so the fields version 5 added have to come back out by hand.
    const v4 = {
      ...emptyGraphViewState(),
      version: 4,
      explore: { direction: "both", locality: "all" },
    } as Record<string, unknown>;
    delete v4.hops;
    const summary = await createSavedGraph(
      Zotero.Libraries.userLibraryID,
      V4_GRAPH_NAME,
      emptyGraphViewState(),
    );
    v4GraphID = summary.id;
    const db = getPluginDatabase();
    expect(db, "the plugin database is open").to.exist;
    await db!.queryAsync("UPDATE saved_graphs_v1 SET state = ? WHERE id = ?", [
      JSON.stringify(v4),
      summary.id,
    ]);

    v4TabID = await openSavedGraphFromFileMenu(hostTabID!, V4_GRAPH_NAME);
    const status = await waitFor(
      () => (statusText(v4TabID) === BOTH_NOTICE ? BOTH_NOTICE : null),
      40_000,
    );
    expect(
      status,
      `the toolbar of the version 4 graph read "${statusText(v4TabID)}"`,
    ).to.equal(BOTH_NOTICE);
    // The notice is sticky: `setStatus` arms no auto-clear timer for a
    // sticky message (graphViewService.ts's `setStatus`), so it cannot be
    // cleared by the 2500 ms timeout on its own. The status bar is a shared,
    // last-writer-wins surface though, so another `setStatus` call may land
    // on top of it in the meantime; the case only owns "sticky is honoured",
    // not exclusive ownership of the bar for three seconds. Accept the
    // notice or any other non-empty status, and fail only on the empty
    // string that a timed-out non-sticky message would leave behind.
    // So the case records every text the bar shows over the next 2.8 s
    // (the auto-clear is 2.5 s) and fails only on the notice going straight
    // to "": an empty bar after some *other* message is that message's own
    // timeout, which the contract allows (the 2026-09-13 suite run saw
    // exactly that once; the sample at 2.8 s alone could not tell the two
    // apart).
    const shown: string[] = [BOTH_NOTICE];
    for (let tick = 0; tick < 28; tick += 1) {
      await delay(100);
      const text = statusText(v4TabID);
      if (text !== shown[shown.length - 1]) shown.push(text);
    }
    const emptiedFrom = shown.findIndex(
      (text, index) =>
        index > 0 && text === "" && shown[index - 1] === BOTH_NOTICE,
    );
    expect(
      emptiedFrom,
      `the sticky migration notice went straight to "" (auto-cleared); the ` +
        `bar showed ${JSON.stringify(shown)} over 2.8s`,
    ).to.equal(-1);

    // A refresh of the open graphs remounts the tab: erasing any item makes
    // the plugin re-render every open graph 250 ms later. The notice is for
    // this open of the graph, not for its first render, so it has to come
    // back on the remounted view. It used to be lost for good, which is how
    // a citation update landing just after the tab opened failed this case.
    const rootBefore = tabContent(v4TabID)?.querySelector(".meristema-root");
    const scratch = new Zotero.Item("journalArticle");
    scratch.libraryID = Zotero.Libraries.userLibraryID;
    scratch.setField("title", "Stage 3 v4 remount scratch");
    await Zotero.Items.erase(await scratch.saveTx());
    const remounted = await waitFor(() => {
      const root = tabContent(v4TabID)?.querySelector(".meristema-root");
      return root && root !== rootBefore ? root : null;
    }, 10_000);
    expect(remounted, "the erase remounted the version 4 graph").to.exist;
    const back = await waitFor(
      () => (statusText(v4TabID) === BOTH_NOTICE ? BOTH_NOTICE : null),
      5_000,
    );
    expect(
      back,
      `after the remount the toolbar read "${statusText(v4TabID)}"`,
    ).to.equal(BOTH_NOTICE);
  });

  it("keeps the version 4 notice in a detached window across a remount", async function () {
    this.timeout(60_000);
    expect(v4TabID, "case 7 left the version 4 graph open").to.exist;
    const windowType = `${config.addonRef}:window`;
    const graphWindows = (): Window[] =>
      Array.from(Services.wm.getEnumerator(windowType) as any) as Window[];
    const windowsBefore = new Set(graphWindows());

    // Zotero's own tab menu, as a reader moves the tab: `_openMenu` builds the
    // popup from the tab type's hooks, and Move › Move to New Window calls the
    // plugin's `moveToNewWindow` hook.
    const popupset = win.document.querySelector("popupset") as Element;
    const popupsBefore = new Set(Array.from(popupset.children));
    win.Zotero_Tabs._openMenu(0, 0, v4TabID);
    const menu = Array.from(popupset.children).find(
      (child) => !popupsBefore.has(child),
    ) as any;
    expect(menu, "the tab's context menu").to.exist;
    const moveLabel = Zotero.getString("tabs.moveToWindow");
    const moveItem = Array.from(menu.querySelectorAll("menuitem")).find(
      (item: any) => item.getAttribute("label") === moveLabel,
    ) as Element | undefined;
    expect(moveItem, `the tab menu's "${moveLabel}"`).to.exist;
    command(moveItem!);
    menu.hidePopup?.();

    const popup = await waitFor(
      () => graphWindows().find((candidate) => !windowsBefore.has(candidate)),
      20_000,
    );
    expect(popup, "the graph's detached window").to.exist;
    v4Window = popup!;
    v4TabID = null;
    const detachedStatus = (): string =>
      normalize(
        popup!.document.querySelector(
          "#meristema-window-root .cm-toolbar-status",
        )?.textContent,
      );
    const detachedRoot = (): Element | null =>
      popup!.document.querySelector("#meristema-window-root .meristema-root");
    const rendered = await waitFor(detachedRoot, 20_000);
    expect(rendered, "the detached window rendered the graph").to.exist;
    const moved = await waitFor(
      () => (detachedStatus() === BOTH_NOTICE ? BOTH_NOTICE : null),
      5_000,
    );
    expect(
      moved,
      `after the move the detached toolbar read "${detachedStatus()}"`,
    ).to.equal(BOTH_NOTICE);

    // The same remount case 7 forces on a tab, now on the window: erasing an
    // item re-renders every open graph, detached ones included.
    const rootBefore = detachedRoot();
    const scratch = new Zotero.Item("journalArticle");
    scratch.libraryID = Zotero.Libraries.userLibraryID;
    scratch.setField("title", "Stage 3 v4 detached remount scratch");
    await Zotero.Items.erase(await scratch.saveTx());
    const remounted = await waitFor(() => {
      const root = detachedRoot();
      return root && root !== rootBefore ? root : null;
    }, 10_000);
    expect(remounted, "the erase remounted the detached graph").to.exist;
    const back = await waitFor(
      () => (detachedStatus() === BOTH_NOTICE ? BOTH_NOTICE : null),
      5_000,
    );
    expect(
      back,
      `after the remount the detached toolbar read "${detachedStatus()}"`,
    ).to.equal(BOTH_NOTICE);
  });

  /**
   * B50: a refusal is not a failure. Every provider the fill can ask answers
   * HTTP 429 at once, through a wrapper on `Zotero.HTTP.request`, which
   * `requestJSON` reads at call time. The seed must stay in the plan, the
   * line must count down in place, Stop must pause it, and once the providers
   * answer again Resume must fill hop 1 straight away.
   *
   * Its own tab and its own paper: the paper above is expanded already, and a
   * fill never asks for a stored list again.
   */
  describe("under provider refusals (B50)", function () {
    let refusalTabID: string | null = null;
    let refusalItemID: number | null = null;
    let undo: (() => void) | null = null;

    function refuseProviders(): void {
      undo ??= interceptProviders(providerRefusal, REFUSED_URL);
    }

    function answerAgain(): void {
      undo?.();
      undo = null;
    }

    function countdownText(): string {
      return normalize(
        graphRoot().querySelector(".cm-scope-hop-countdown")?.textContent,
      );
    }

    before(async function () {
      this.timeout(90_000);
      const item = new Zotero.Item("journalArticle");
      item.libraryID = Zotero.Libraries.userLibraryID;
      item.setField("title", REFUSAL_TITLE);
      item.setField("date", "2012");
      item.setField("DOI", REFUSAL_DOI);
      refusalItemID = await item.saveTx();

      refusalTabID = await openNewGraphTab();
      currentTabID = refusalTabID;
      win.Zotero_Tabs.select(refusalTabID);
      const rail = await waitFor(
        () =>
          tabContent(refusalTabID)?.querySelector(
            ".cm-scope-section .cm-scope-count",
          ),
        30_000,
      );
      expect(rail, "the refusal tab's Scope section").to.exist;
      await dismissGallery(refusalTabID);
      const fit = await waitFor(
        () =>
          graphRoot().querySelector(
            '.cm-zoom-controls button[data-action="fit"]',
          ) as HTMLButtonElement | null,
        10_000,
      );
      expect(fit, "the refusal tab's fit button").to.exist;
      fit!.click();
      await waitFor(() => {
        const canvas = graphRoot().querySelector("canvas");
        return canvas ? canvas.getBoundingClientRect().width > 10 : false;
      }, 10_000);
    });

    after(async function () {
      this.timeout(30_000);
      let failure: unknown = null;
      const record = (error: unknown): void => {
        if (failure === null) failure = error;
      };
      try {
        answerAgain();
      } catch (error) {
        record(error);
      }
      try {
        if (refusalTabID) win.Zotero_Tabs.close(refusalTabID);
        await delay(500);
      } catch (error) {
        record(error);
      }
      refusalTabID = null;
      currentTabID = null;
      try {
        if (refusalItemID !== null) await Zotero.Items.erase(refusalItemID);
        refusalItemID = null;
      } catch (error) {
        record(error);
      }
      if (failure !== null) throw failure;
    });

    it("keeps the seed in the plan while every provider refuses, and fills once they answer", async function () {
      this.timeout(180_000);
      refuseProviders();
      try {
        (await nodeMenuEntry("Add as seed", REFUSAL_TITLE)).click();

        // 1. The refusal line, counting down in place.
        const line = await waitFor(
          () =>
            /refusing · retry in \d+ (s|min)/.test(progressText())
              ? graphRoot().querySelector(".cm-scope-hop-progress")
              : null,
          60_000,
        );
        expect(
          line,
          `the line never read "refusing"; it read "${progressText()}"; ` +
            `hop 1 "${hopRowText(1)}"; recent Zotero errors: ${
              (Zotero.getErrors(true) as string[]).slice(-3).join(" || ") ||
              "none"
            }`,
        ).to.exist;
        const first = countdownText();
        const ticked = await waitFor(
          () => (countdownText() !== first ? countdownText() : null),
          5_000,
        );
        expect(ticked, `the countdown stayed at "${first}"`).to.exist;
        expect(
          graphRoot().querySelector(".cm-scope-hop-progress") === line,
          `the line was rebuilt while counting down; it reads "${progressText()}"`,
        ).to.equal(true);

        // 2. Stop pauses it: the refused seed is still one paper left.
        const stop = line!.querySelector(
          ".cm-scope-hop-action",
        ) as HTMLButtonElement | null;
        expect(normalize(stop?.textContent), "the line's action").to.equal(
          "Stop",
        );
        stop!.click();
        const paused = await waitFor(
          () =>
            /1 left · Resume$/.test(progressText()) ? progressText() : null,
          10_000,
        );
        expect(paused, `after Stop the line read "${progressText()}"`).to.exist;

        // 3. The providers answer again; Resume fills hop 1 at once.
        answerAgain();
        const resume = graphRoot().querySelector(
          ".cm-scope-hop-progress .cm-scope-hop-action",
        ) as HTMLButtonElement | null;
        expect(normalize(resume?.textContent), "the paused action").to.equal(
          "Resume",
        );
        resume!.click();
        const trace = await traceUntil(
          () => (hopCounts(1)?.available ?? 0) > 0,
          60_000,
        );
        expect(
          hopCounts(1)?.available ?? 0,
          `hop 1 never filled after Resume; trace: ${trace}`,
        ).to.be.greaterThan(0);
      } finally {
        answerAgain();
      }
    });
  });

  /**
   * B72: a fill must finish even while one provider refuses for good. The case
   * serves every provider itself, so nothing here depends on what an index
   * holds today: Semantic Scholar answers HTTP 429 throughout, so it sits out
   * a window and every landing counts as refused, while OpenCitations answers
   * the seed with two fabricated citers and answers each of those citers with
   * an empty list. OpenAlex never enters it: it pages citations only with a
   * key (`isPagingProvider`), so on a keyless profile it is not a candidate at
   * all — and `before` asserts the profile has none, rather than letting a key
   * quietly turn this into a different scenario.
   *
   * Those hop-1 papers are external and carry OpenCitations' own work ID, so
   * the fill hints it and the lookup that would back their empty list is
   * skipped. Before the fix each was deferred for ever and `n left` never
   * fell; now each is stored as "no citers" and the plan drains.
   *
   * What makes that reachable is the second seed, the refusal anchor
   * (`DRAIN_ANCHOR_DOI`). A window only ever opens where a provider was asked
   * and refused, so without a paper that keeps asking Semantic Scholar the one
   * window the first seed opened simply lapses, the children land with nobody
   * sitting out, and pre-fix code drains the plan correctly. A seed is rank 0
   * in `planHopFill`, ahead of every hop-1 paper, so the anchor is expanded
   * first on every cycle and renews the window before either child lands.
   *
   * Three traps this case is shaped to avoid, each of which produced a false
   * green before. It has to fetch hop 2: the defect is in expanding the hop-1
   * papers, and only a fetch past the depth puts them in a plan, so expanding
   * the seed alone drains whatever the code does. "Drained" has to mean the
   * progress line is GONE — pre-fix code alternates expanding and refusing,
   * and a refusal countdown is not `expanding` either, so any weaker reading
   * passes on the first cool-down. And the drain cannot be the only signal:
   * the anchor is refused on every cycle, so pre-fix it alone pins the plan
   * for ever whatever the children do. The assertion that is B72's own is that
   * `n left` FALLS BELOW the three it started at — pre-fix the children are
   * deferred and stay counted, so it cannot; post-fix each is stored on its
   * first landing and only the anchor is left.
   */
  describe("when one provider sits out and another has no citers (B72)", function () {
    let drainTabID: string | null = null;
    let drainItemID: number | null = null;
    let anchorItemID: number | null = null;
    let undo: (() => void) | null = null;
    /** Every provider URL the case saw, as the evidence it asserts on. */
    let asked: string[] = [];
    /**
     * When each request went out and each reading of the progress line first
     * appeared, in seconds from the case's start. The deferral ladder runs on
     * real timers (B75), so a red run has to say when, not only what.
     */
    let timeline: string[] = [];
    let startedAt = 0;
    let lastLine = "";

    function mark(what: string): void {
      timeline.push(
        `+${((Date.now() - startedAt) / 1000).toFixed(1)}s ${what}`,
      );
    }

    /**
     * Whether the graph's window still delivers animation frames. A window
     * that is covered or minimised gets them late or not at all, and the fill
     * once re-planned on a frame alone (B75: `frames DO NOT fire in 3 s,
     * visibility hidden` under a line stuck on `expanding · 1 left`), so a
     * stalled line has to say which world it stalled in.
     */
    async function frameProbe(): Promise<string> {
      const view = graphRoot().ownerDocument!.defaultView!;
      const began = Date.now();
      const fired = await Promise.race([
        new Promise<boolean>((resolve) =>
          view.requestAnimationFrame(() => resolve(true)),
        ),
        delay(3_000).then(() => false),
      ]);
      return (
        `frames ${fired ? `fire (${Date.now() - began} ms)` : "DO NOT fire in 3 s"}, ` +
        `visibility ${view.document.visibilityState}, ` +
        `focus ${view.document.hasFocus()}`
      );
    }

    /** The progress line, recorded whenever its text changes. */
    function watchedLine(): string {
      const line = progressText().replace(/retry in .*/, "retry in …");
      if (line !== lastLine) {
        lastLine = line;
        mark(`line "${line}"`);
      }
      return progressText();
    }

    /**
     * The whole provider surface, served from here. Every provider request in
     * the plugin funnels through one `Zotero.HTTP.request` call, so this is
     * the entire network a fill can reach. Anything that is not a provider
     * host still goes out, so Zotero's own traffic is untouched.
     */
    function serveProvidersOffline(): void {
      undo ??= interceptProviders((url) => {
        asked.push(url);
        mark(url.replace(/^https:\/\/([^/]+)\/.*?([^/?]*)(\?.*)?$/, "$1 …$2"));
        // The seed's citers, and then nothing for each of them.
        if (/opencitations\.net\/index\/v2\/citations\//.test(url))
          return providerAnswer(
            SEED_CITATIONS.test(url) ? DRAIN_CITER_LIST : "[]",
          );
        // The seed and the anchor are library papers, so their own expansions
        // still look the DOI up; not-found answers that well enough and keeps
        // the case offline. A hinted hop-1 paper must never reach here — the
        // work-ID hint is what skips this lookup, and the case asserts both
        // that the children skipped it and that the anchor did not.
        if (META_LOOKUP.test(url)) return providerAnswer("[]");
        // Every other provider sits out the window.
        return providerRefusal();
      });
    }

    function answerAgain(): void {
      undo?.();
      undo = null;
    }

    /**
     * The `{n}` of `expanding · {n} left`, or null while the line reads
     * anything else. A refusal countdown carries no count at all, so null
     * means "not expanding just now", never "nothing left".
     */
    function leftCount(): number | null {
      // Grouped by Intl.NumberFormat above 999, in the machine's own locale
      // (de-CH prints 1'200), so take the count whole and strip all that
      // is not a digit, rather than naming the separators.
      const match = /^expanding · (.+?) left/.exec(watchedLine());
      return match ? Number(match[1]!.replace(/\D/g, "")) : null;
    }

    /** Whether a recorded provider URL names this DOI, raw or encoded. */
    function urlNames(url: string, doi: string): boolean {
      const lower = url.toLowerCase();
      return (
        lower.includes(doi.toLowerCase()) ||
        lower.includes(encodeURIComponent(doi).toLowerCase())
      );
    }

    before(async function () {
      this.timeout(90_000);
      // OpenAlex pages citations only with a key, and this case is built on
      // the fill having exactly two candidates: Semantic Scholar, which always
      // refuses, and OpenCitations, which answers. A key would add a third and
      // change what every landing means. Skip rather than fail: a configured
      // key is this profile's business, not a product defect, and a red here
      // would read like one.
      if (getOpenAlexAPIKey() !== "") this.skip();
      const item = new Zotero.Item("journalArticle");
      item.libraryID = Zotero.Libraries.userLibraryID;
      item.setField("title", DRAIN_SEED_TITLE);
      item.setField("date", "2012");
      item.setField("DOI", DRAIN_SEED_DOI);
      drainItemID = await item.saveTx();

      // The refusal anchor, a library paper the seed's citation page names. It
      // holds Semantic Scholar's window open for the whole fill; see the
      // block's own comment for why the case is vacuous without it.
      const anchor = new Zotero.Item("journalArticle");
      anchor.libraryID = Zotero.Libraries.userLibraryID;
      anchor.setField("title", DRAIN_ANCHOR_TITLE);
      anchor.setField("date", "2013");
      anchor.setField("DOI", DRAIN_ANCHOR_DOI);
      anchorItemID = await anchor.saveTx();

      drainTabID = await openNewGraphTab();
      currentTabID = drainTabID;
      win.Zotero_Tabs.select(drainTabID);
      const rail = await waitFor(
        () =>
          tabContent(drainTabID)?.querySelector(
            ".cm-scope-section .cm-scope-count",
          ),
        30_000,
      );
      expect(rail, "the drain tab's Scope section").to.exist;
      await dismissGallery(drainTabID);
      // Fit before anything walks the plot, as B50's block does. Without it
      // the camera keeps whatever extent it opened on, and the anchor widened
      // the data's span enough to push the earliest paper off screen: red run
      // 6 walked the canvas 36 times in 20 s and was offered only the anchor
      // and the Stage 3 fixture, never the seed it was looking for.
      const fit = await waitFor(
        () =>
          graphRoot().querySelector(
            '.cm-zoom-controls button[data-action="fit"]',
          ) as HTMLButtonElement | null,
        10_000,
      );
      expect(fit, "the drain tab's fit button").to.exist;
      fit!.click();
      await waitFor(() => {
        const canvas = graphRoot().querySelector("canvas");
        return canvas ? canvas.getBoundingClientRect().width > 10 : false;
      }, 10_000);
    });

    after(async function () {
      this.timeout(30_000);
      let failure: unknown = null;
      const record = (error: unknown): void => {
        if (failure === null) failure = error;
      };
      try {
        answerAgain();
      } catch (error) {
        record(error);
      }
      try {
        if (drainTabID) win.Zotero_Tabs.close(drainTabID);
        await delay(500);
      } catch (error) {
        record(error);
      }
      drainTabID = null;
      currentTabID = null;
      try {
        if (drainItemID !== null) await Zotero.Items.erase(drainItemID);
        drainItemID = null;
      } catch (error) {
        record(error);
      }
      try {
        if (anchorItemID !== null) await Zotero.Items.erase(anchorItemID);
        anchorItemID = null;
      } catch (error) {
        record(error);
      }
      if (failure !== null) throw failure;
    });

    it("drains the plan instead of re-asking papers with no citers", async function () {
      // The anchor can only leave the plan through the deferral limit, which
      // is three deferrals at 30 s, 1 min and 2 min (graphHopRunnerModel.ts,
      // COOL_DOWN_MS and DEFERRAL_LIMIT), so the drain lands a little past
      // 210 s and the case needs room well past that.
      this.timeout(420_000);
      asked = [];
      timeline = [];
      lastLine = "";
      startedAt = Date.now();
      serveProvidersOffline();
      try {
        (await nodeMenuEntry("Add as seed", DRAIN_SEED_TITLE)).click();
        // Hop 1 is the seed's own citers, served by the wrapper, so the count
        // is known exactly rather than being whatever an index holds today.
        const filled = await waitFor(
          () => hopCounts(1)?.available ?? null,
          120_000,
        );
        expect(
          filled,
          `hop 1 never filled; it read "${hopRowText(1)}"; ` +
            `${asked.length} provider request(s): ${asked.join(" | ")}`,
        ).to.equal(DRAIN_HOP_1);
        // A window opens only where a provider was actually asked and refused,
        // so the seed's own expansion asking Semantic Scholar is what makes
        // the first landings refused ones. Without this the case could pass
        // with nothing ever sitting out a window.
        expect(
          asked.filter((url) => SEMANTIC_SCHOLAR_HOST.test(url)),
          `Semantic Scholar was never asked, so no refusal window opened; ` +
            `${asked.length} request(s): ${asked.join(" | ")}`,
        ).to.not.be.empty;
        // The anchor joins as a SECOND SEED. That is what guarantees it is
        // expanded before either child: a seed is rank 0 in `planHopFill`,
        // and rank beats every other term in the ordering.
        (await nodeMenuEntry("Add as seed", DRAIN_ANCHOR_TITLE)).click();
        const seeded = await waitFor(
          () => (hopCountText(0) === "2" ? hopCountText(0) : null),
          30_000,
        );
        expect(
          seeded,
          `the anchor never became a second seed, so nothing renews Semantic ` +
            `Scholar's window; the Seeds row reads "${hopRowText(0)}"`,
        ).to.exist;
        // The hop-1 papers only enter a plan once hop 2 is fetched, and it is
        // expanding them — not the seed — that B72 never finishes.
        const fetchHop2 = fetchButton(2);
        expect(
          fetchHop2,
          `hop 2 carries no Fetch button, so the hop-1 papers never enter a ` +
            `plan; hop 1 read "${hopRowText(1)}", hop 2 "${hopRowText(2)}"`,
        ).to.exist;
        fetchHop2!.click();
        // The progress line renders only while a fill is in flight, so confirm
        // one actually started before treating any absence as "drained". The
        // count cannot establish that: it moves as the plan is built, and
        // pre-fix runs recorded the first expanding tick reading 1 (run 7) and
        // 3 (run 9) from the same code. The trace only ever grows, so asking it
        // is race-free — and both children having been asked for their own
        // citers is precisely what "the fill started on all of hop 1" means.
        // It must hold in both worlds: this is the vacuity guard, and the
        // discrimination belongs to the two assertions below.
        const started = await waitFor(
          () =>
            DRAIN_CITERS.every((doi) =>
              asked.some(
                (url) =>
                  /index\/v2\/citations\//i.test(url) && urlNames(url, doi),
              ),
            ) || null,
          120_000,
        );
        expect(
          started,
          `the fill never started on all of hop 1, so what follows would be ` +
            `vacuous; the line reads "${progressText()}", ` +
            `hop 1 "${hopRowText(1)}", hop 2 "${hopRowText(2)}"; ` +
            // The recorded URLs are an ordered trace, so the order of the
            // citation requests says which paper the fill expanded first and
            // whether Semantic Scholar was asked between them.
            `${started ? "" : await frameProbe()}; timeline: ${timeline.join(" | ")}`,
        ).to.exist;
        // The anchor is a library paper, so nothing hints its work ID and its
        // expansion looks the DOI up. That is the fixture's own guard: were it
        // to arrive as an external node instead, it would be hinted like the
        // children, would never ask Semantic Scholar, and the count below
        // could fall for reasons that are not B72's.
        const anchorLookedUp = await waitFor(
          () =>
            asked.some(
              (url) => META_LOOKUP.test(url) && urlNames(url, DRAIN_ANCHOR_DOI),
            ) || null,
          60_000,
        );
        expect(
          anchorLookedUp,
          `the anchor's work ID was hinted, so it is not the library paper ` +
            `the case needs and no window is being renewed; ` +
            `${asked.length} request(s): ${asked.join(" | ")}`,
        ).to.exist;
        // B72 itself. Pre-fix each child's hinted empty list is unbacked, so
        // each is deferred and stays counted (ADR 0013) and this count cannot
        // fall below the three it started at, however long the fill runs.
        // Post-fix each is stored as "no citers" on its first landing and only
        // the anchor is left.
        const fell = await waitFor(() => {
          const left = leftCount();
          return left !== null && left < DRAIN_PLANNED ? left : null;
        }, 90_000);
        expect(
          fell,
          `the papers with no citers never left the plan: the line reads ` +
            `"${progressText()}", hop 1 "${hopRowText(1)}"; ` +
            `${asked.length} provider request(s): ${asked.join(" | ")}`,
        ).to.exist;
        // The fix's other half, and the slower one: the anchor is refused on
        // every cycle, so only the deferral limit can end it. Drained means
        // the line is GONE, the one reading a stalled fill cannot produce —
        // pre-fix it alternates expanding and refusing for ever, and a refusal
        // countdown is not `expanding` either.
        // B72 review, Important 1: "ended" no longer means the line is gone.
        // A paper the deferral limit failed keeps a line carrying the only
        // Resume that brings it back (ADR 0014), so the anchor settles on
        // "1 gave up" rather than vanishing. What must stop either way — and
        // what pre-fix code cannot do — is the expanding/refusing alternation.
        const drained = await waitFor(() => {
          const line = watchedLine();
          return line === "no progress line" || /gave up/.test(line)
            ? line
            : null;
        }, 300_000);
        expect(
          drained,
          `the plan never drained; the line reads "${progressText()}", ` +
            `hop 1 "${hopRowText(1)}", hop 2 "${hopRowText(2)}"; ` +
            `${drained ? "" : await frameProbe()}; timeline: ${timeline.join(" | ")}`,
        ).to.exist;
        // The scenario really ran: each hop-1 paper was asked for its own
        // citers, and none of them was looked up first. That skipped lookup
        // is the hint (externalDiscoveryService.ts:1288-1299) — the call-site
        // wiring no unit test covers, and the reason an empty list needs
        // backing at all.
        const expanded = DRAIN_CITERS.filter((doi) =>
          asked.some(
            (url) => /index\/v2\/citations\//i.test(url) && urlNames(url, doi),
          ),
        );
        expect(
          expanded,
          `the hop-1 papers were never expanded; ` +
            `${asked.length} request(s): ${asked.join(" | ")}`,
        ).to.have.lengthOf(DRAIN_CITERS.length);
        const lookedUp = asked.filter(
          (url) =>
            META_LOOKUP.test(url) &&
            DRAIN_CITERS.some((doi) => urlNames(url, doi)),
        );
        expect(
          lookedUp,
          `a hop-1 paper was looked up, so its empty list was backed by a ` +
            `match rather than by the fill's own work-ID hint`,
        ).to.deep.equal([]);
        // And the anchor did its job: Semantic Scholar was asked again after
        // the seed's own expansion, which is the only thing that can re-open
        // the window the children's landings need in order to count as
        // refused. One ask alone would mean the window lapsed unrenewed.
        expect(
          asked.filter((url) => SEMANTIC_SCHOLAR_HOST.test(url)).length,
          `Semantic Scholar was asked once and never again, so its window was ` +
            `never renewed and the children landed with nobody sitting out`,
        ).to.be.greaterThan(1);
        expect(
          hopCountText(2),
          `hop 2 still carries the Fetch button, so the depth never moved`,
        ).to.not.equal(null);
      } finally {
        answerAgain();
      }
    });
  });

  /**
   * D8: with a key, the fill asks OpenAlex first, sorted, and every list
   * comes back with metadata. Served offline: the key is a fake set for the
   * case alone, and the wrapper answers every provider host itself, so a
   * keyless profile runs it too and nothing reaches the network.
   */
  describe("with an OpenAlex key (D8)", function () {
    const SEED_DOI = "10.5555/d8.order.seed";
    const SEED_TITLE = `${FIXTURE_TITLE} (D8 order)`;
    /**
     * The seed's two citers. Neither carries a citation count of its own, so
     * the `meta.count: 0` of its own citer page is the only total behind its
     * empty list — the D8 path where a hinted expansion takes its reported
     * count from the list answer (externalDiscoveryService.ts, "Reported
     * count for free"). A count would ruin the case twice over: red run 5
     * gave each 9 and 4, and an empty page against a reported 9 is an
     * INCOMPLETE list, so the fill rightly moved on to the next provider
     * (Semantic Scholar was asked for both) and hop 1 never drained, leaving
     * hop 2 reading "0/0" where the rail's "none yet" needs a drained hop
     * above it.
     *
     * This is a deliberate divergence from real OpenAlex, which always sends
     * `cited_by_count`. If both citers carried their honest `0`,
     * `externalDiscoveryService.ts:1329-1339`'s `reportedCount === 0` early
     * return would hand back `{ works: [], complete: true }` for each without
     * a request — the fill would trust the reported zero and never page
     * `cites:W802` or `cites:W803`, so the honest real-data total would be 2
     * (the seed's lookup and its citer page), not the plan's
     * `2 + CITERS.length` = 4. Omitting the field routes the expansion down
     * the "reported count for free" path instead, so the case exercises the
     * unknown-count path where the list answer's own `meta.count` supplies
     * the total.
     */
    const CITERS = [
      { id: "W802", doi: "10.5555/d8.order.a" },
      { id: "W803", doi: "10.5555/d8.order.b" },
    ];
    let previousKey: unknown = undefined;
    let seedItemID: number | null = null;
    let tabID: string | null = null;
    let undo: (() => void) | null = null;
    let asked: string[] = [];
    /**
     * What the provider line carried before the case began, as evidence: the
     * outer suite's own fixture item shares the library and its update may
     * still be in flight when this block opens.
     */
    let settledAfter = 0;
    let wentQuiet = false;
    /**
     * Whether the fake is answering yet. Saving a library item queues an
     * automatic citation-data update of its own, and that update fetches the
     * paper's citers exactly as a fill would: red run 3 read hop 1 as 2/2 with
     * not one request of its own, because the seed's list was already stored
     * before the case clicked anything, and a stored list is nothing for the
     * fill to fetch. Until the case opens, every OpenAlex URL is answered
     * not-found, so the update stores no list and the list the case reads is
     * the one its own fill asked for.
     */
    let serving = false;

    /**
     * The seed's own record, carrying the LIBRARY item's title and year. A
     * lookup answer whose title contradicts the local one and shares no author
     * is "ambiguous", not "same-work" (`severeLocalContradiction`,
     * src/domain/workIdentity.ts), and an ambiguous lookup is dropped, so the
     * fill holds no OpenAlex work ID for the seed and never pages its citers:
     * red run 1 read "Hop 1 0/0" with the lookup answered and no `cites:` page
     * behind it. The citers are external papers with no local record to
     * contradict, so they keep the generic shape.
     */
    function seedWork(): unknown {
      return openAlexWork({
        id: "W801",
        doi: SEED_DOI,
        title: SEED_TITLE,
        year: 2019,
        count: CITERS.length,
      });
    }

    function serveOpenAlex(): void {
      undo ??= interceptProviders((url) => {
        asked.push(url);
        // Not a refusal: a 429 makes the automatic update come back on a
        // cool-down (30 s, 1 min, 2 min) and land in the middle of a case
        // that counts requests, while a not-found is final and lets the
        // library's own update settle before the case starts. What the other
        // providers would answer is not this case's evidence anyway — the
        // case asserts that none of them was asked at all.
        if (!serving || !/^https:\/\/api\.openalex\.org\//.test(url))
          return providerNotFound();
        const parsed = new URL(url);
        const path = decodeURIComponent(parsed.pathname);
        // The seed is a library paper: its own expansion looks the DOI up.
        // The outer suite's fixtures share the library, so a lookup of any
        // other DOI is not this case's and is answered not-found rather than
        // handed the seed's record.
        if (/\/works\/doi/i.test(path)) {
          return path.includes(SEED_DOI)
            ? providerAnswer(JSON.stringify(seedWork()))
            : providerNotFound();
        }
        const filter = parsed.searchParams.get("filter") ?? "";
        if (filter === "cites:W801") {
          return providerAnswer(
            JSON.stringify({
              results: CITERS.map((citer) =>
                openAlexWork({
                  ...citer,
                  title: `D8 paper ${citer.id}`,
                  year: 2021,
                  count: null,
                }),
              ),
              meta: { count: CITERS.length },
            }),
          );
        }
        // Each citer's own page (cites:W802, cites:W803), and anything else
        // this fake did not name above: empty with a reported total of 0.
        return providerAnswer(
          JSON.stringify({ results: [], meta: { count: 0 } }),
        );
      });
    }

    function answerAgain(): void {
      undo?.();
      undo = null;
    }

    function cutLine(): string {
      const line = graphRoot().querySelector(".cm-scope-hop-cut");
      return line ? normalize(line.textContent) : "no cut line";
    }

    /**
     * The seed title's distinctive fragment, lowercased: a title search for
     * the seed (no DOI, no `W80x`) is still this case's own traffic, in both
     * its raw and percent-encoded forms.
     */
    const SEED_TITLE_FRAGMENT = "d8 order";

    /**
     * Whether a recorded URL names one of THIS case's papers, by DOI (raw or
     * encoded), by OpenAlex work ID, or by a title search naming the seed.
     * The outer suite's fixture item shares the library and its own metadata
     * update keeps asking every provider about `FIXTURE_DOI` while this case
     * runs; that traffic is not the fill's and is not this case's to read.
     */
    function mine(url: string): boolean {
      const lower = url.toLowerCase();
      return (
        /w80[123]/.test(lower) ||
        [SEED_DOI, ...CITERS.map((citer) => citer.doi)].some(
          (doi) =>
            lower.includes(doi.toLowerCase()) ||
            lower.includes(encodeURIComponent(doi).toLowerCase()),
        ) ||
        lower.includes(SEED_TITLE_FRAGMENT) ||
        lower.includes(encodeURIComponent(SEED_TITLE_FRAGMENT).toLowerCase())
      );
    }

    /**
     * The requests the FILL made about this case's papers: the seed's own
     * lookup, and one citer page per expansion. Seeding a paper also sets the
     * graph's own enrichment of it going — red run 5 recorded two
     * `ids.openalex:W801` lookups, one of them for open-access locations —
     * and that is not the fill asking for a list.
     */
    function fillRequests(): string[] {
      return asked.filter((url) => {
        if (!mine(url)) return false;
        const parsed = new URL(url);
        return (
          /\/works\/doi/i.test(decodeURIComponent(parsed.pathname)) ||
          (parsed.searchParams.get("filter") ?? "").startsWith("cites:")
        );
      });
    }

    before(async function () {
      this.timeout(240_000);
      previousKey = Zotero.Prefs.get(OPEN_ALEX_KEY_PREF, true);
      Zotero.Prefs.set(OPEN_ALEX_KEY_PREF, "d8-test-key", true);
      serveOpenAlex();
      const item = new Zotero.Item("journalArticle");
      item.libraryID = Zotero.Libraries.userLibraryID;
      item.setField("title", SEED_TITLE);
      item.setField("date", "2019");
      item.setField("DOI", SEED_DOI);
      seedItemID = await item.saveTx();
      tabID = await openNewGraphTab();
      currentTabID = tabID;
      win.Zotero_Tabs.select(tabID);
      const rail = await waitFor(
        () =>
          tabContent(tabID)?.querySelector(".cm-scope-section .cm-scope-count"),
        30_000,
      );
      expect(rail, "the D8 tab's Scope section").to.exist;
      await dismissGallery(tabID);
      const fit = await waitFor(
        () =>
          graphRoot().querySelector(
            '.cm-zoom-controls button[data-action="fit"]',
          ) as HTMLButtonElement | null,
        10_000,
      );
      expect(fit, "the D8 tab's fit button").to.exist;
      fit!.click();
      wentQuiet = await untilQuiet(() => asked.length, 10_000, 120_000);
      settledAfter = asked.length;
    });

    after(async function () {
      this.timeout(30_000);
      serving = false;
      answerAgain();
      if (previousKey === undefined || previousKey === null)
        Zotero.Prefs.clear(OPEN_ALEX_KEY_PREF, true);
      else Zotero.Prefs.set(OPEN_ALEX_KEY_PREF, previousKey as string, true);
      if (tabID) win.Zotero_Tabs.close(tabID);
      await delay(500);
      tabID = null;
      currentTabID = null;
      if (seedItemID !== null) await Zotero.Items.erase(seedItemID);
      seedItemID = null;
    });

    it("fills through OpenAlex alone, sorted, with the rows and the cut line the data allows", async function () {
      this.timeout(180_000);
      asked = [];
      serving = true;
      (await nodeMenuEntry("Add as seed", SEED_TITLE)).click();
      const filled = await waitFor(
        () => hopCounts(1)?.available ?? null,
        60_000,
      );
      expect(
        filled,
        `hop 1 never filled; it read "${hopRowText(1)}"; ${asked.length} request(s): ${asked.join(" | ")}` +
          ` (before the case: ${settledAfter} request(s), line ${wentQuiet ? "quiet" : "STILL BUSY"})`,
      ).to.equal(CITERS.length);
      // OpenAlex first: about this case's papers, nobody else was asked at all.
      expect(
        asked.filter(
          (url) => mine(url) && !/^https:\/\/api\.openalex\.org\//.test(url),
        ),
        `a provider other than OpenAlex was asked about this case's papers: ${asked.filter(mine).join(" | ")}`,
      ).to.be.empty;
      // Sorted: the seed's citer page carried the sort.
      const citerPages = asked.filter(
        (url) => new URL(url).searchParams.get("filter") === "cites:W801",
      );
      expect(
        citerPages,
        `the seed's citer page; ${asked.length} request(s): ${asked.join(" | ")}`,
      ).to.not.be.empty;
      expect(
        new URL(citerPages[0]!).searchParams.get("sort"),
        `the seed's citer page: ${citerPages[0]}`,
      ).to.equal("cited_by_count:desc");
      // The rows: Seeds, Hop 1, a Fetch row for hop 2, nothing else.
      expect(
        Array.from(graphRoot().querySelectorAll(".cm-scope-hop-row")).map(
          (row) => (row as HTMLElement).dataset.hop,
        ),
        `rows: ${Array.from(graphRoot().querySelectorAll(".cm-scope-hop-row"))
          .map((row) => normalize(row?.textContent))
          .join(" | ")}`,
      ).to.deep.equal(["0", "1", "2"]);
      expect(fetchButton(2), "hop 2's Fetch button").to.exist;
      expect(
        cutLine(),
        `rail rows: ${Array.from(
          graphRoot().querySelectorAll(".cm-scope-hop-row"),
        )
          .map((row) => normalize(row?.textContent))
          .join(" | ")}`,
      ).to.equal("Top 50 citers per paper, most cited first");
      // Hop 2: both citers expand to nothing, so hop 2 reads none yet and no
      // Fetch row follows it.
      fetchButton(2)!.click();
      // Hop 2 reads "none yet" the moment it opens, before either citer has
      // been asked anything, so waiting on that word alone is vacuous: red
      // run 4 reached the last assertion with the pair still in flight and
      // counted 2 requests. The recorded URLs only ever grow, so asking them
      // for both citer pages is race-free, and it is exactly what "the fill
      // ran on all of hop 1" means.
      const expanded = await waitFor(
        () =>
          CITERS.every((citer) =>
            asked.some(
              (url) =>
                new URL(url).searchParams.get("filter") === `cites:${citer.id}`,
            ),
          ) || null,
        60_000,
      );
      expect(
        expanded,
        `the fill never asked both hop-1 papers for their own citers; hop 1 read "${hopRowText(1)}", hop 2 "${hopRowText(2)}", line "${progressText()}"; ${asked.length} request(s): ${asked.join(" | ")}`,
      ).to.exist;
      // Drained means the progress line is GONE (B72), and only a drained
      // fill has a final request count to assert on.
      const drained = await waitFor(
        () => (progressText() === "no progress line" ? "drained" : null),
        60_000,
      );
      expect(
        drained,
        `the fill never drained; the line reads "${progressText()}", hop 2 "${hopRowText(2)}"; ${asked.length} request(s): ${asked.join(" | ")}`,
      ).to.exist;
      const empty = await waitFor(
        () => (hopCountText(2) === "none yet" ? hopCountText(2) : null),
        60_000,
      );
      expect(
        empty,
        `hop 2 never read none yet; it read "${hopRowText(2)}", line "${progressText()}"; ${asked.length} request(s): ${asked.join(" | ")}`,
      ).to.exist;
      expect(fetchButton(3), "no Fetch row past an empty hop").to.equal(null);
      expect(
        Array.from(graphRoot().querySelectorAll(".cm-scope-hop-row")).map(
          (row) => (row as HTMLElement).dataset.hop,
        ),
        `rows: ${Array.from(graphRoot().querySelectorAll(".cm-scope-hop-row"))
          .map((row) => normalize(row?.textContent))
          .join(" | ")}`,
      ).to.deep.equal(["0", "1", "2"]);
      // No hydration: the hop-1 list carried metadata, so nothing looked its
      // papers up in a batch.
      expect(
        asked.filter(
          (url) =>
            /filter=(ids\.openalex|doi)%3A/i.test(url) &&
            CITERS.some(
              (citer) =>
                url.toLowerCase().includes(citer.id.toLowerCase()) ||
                url
                  .toLowerCase()
                  .includes(encodeURIComponent(citer.doi).toLowerCase()),
            ),
        ),
        `a hydration batch was asked for the hop-1 papers: ${asked.filter(mine).join(" | ")}`,
      ).to.be.empty;
      // Still OpenAlex alone, now that every expansion has landed.
      expect(
        asked.filter(
          (url) => mine(url) && !/^https:\/\/api\.openalex\.org\//.test(url),
        ),
        `a provider other than OpenAlex was asked about this case's papers: ${asked.filter(mine).join(" | ")}`,
      ).to.be.empty;
      // The seed's lookup, its own citer page, and one page per citer of
      // unknown count.
      expect(
        fillRequests().length,
        `fill requests: ${fillRequests().join(" | ")} (of ${asked.length} in all: ${asked.join(" | ")}; before the case: ${settledAfter}, line ${wentQuiet ? "quiet" : "STILL BUSY"})`,
      ).to.equal(2 + CITERS.length);
    });
  });

  /**
   * Stage 4: the citation floor. Served offline the way D8 is — a fake key for
   * the case alone, and a wrapper that answers every provider host itself — so
   * a keyless profile runs it and nothing reaches the network. Every helper
   * this block needs from D8 is block-scoped there, so it keeps its own copy.
   */
  describe("with a citation floor (Stage 4)", function () {
    const SEED_DOI = "10.5555/floor.seed";
    const SEED_TITLE = `${FIXTURE_TITLE} (floor)`;
    /** Named apart from the seed: the node-menu walk matches on a substring. */
    const NO_DATA_TITLE = "Stage 4 floor lane paper";
    /**
     * The floor the case sets, between the seed's own three citations and the
     * one citer above it. The seed's count matters because the camera fits the
     * VISIBLE cloud after every expansion (`fitCurrentGraph`), and a floor
     * line outside that cloud is off the plot, where the renderer draws no
     * tag and answers no hit (`drawFloor`, `onPlot`): red run 2 put the floor
     * at 2, which left the seed and its one surviving citer both at 3, and the
     * hover walk found no floor anywhere on the canvas. A seed is never under
     * the floor, so it is the one paper that can hold the cloud open beneath
     * the line.
     */
    const FLOOR = 5;
    /**
     * Three citers whose counts straddle the floor; each one's own page holds
     * exactly its count, so the fill drains. W903's `0` is the reported-zero
     * return (externalDiscoveryService.ts): its expansion pages nothing at
     * all, which is why no expected page list ever names it.
     */
    const CITERS = [
      { id: "W901", doi: "10.5555/floor.a", count: 1, citers: ["W911"] },
      {
        id: "W902",
        doi: "10.5555/floor.b",
        count: 6,
        citers: ["W912", "W913", "W914", "W915", "W916", "W917"],
      },
      { id: "W903", doi: "10.5555/floor.c", count: 0, citers: [] },
    ];
    /** Hop 2 once the one citer above the floor has been paged, and once the floor is off. */
    const citersOf = (id: string): number =>
      CITERS.find((citer) => citer.id === id)?.citers.length ?? 0;
    let previousKey: unknown = undefined;
    /** Choosing a view writes the layout back; the profile keeps what it had. */
    let previousAppearance: unknown = undefined;
    let seedItemID: number | null = null;
    let noDataItemID: number | null = null;
    let tabID: string | null = null;
    let undo: (() => void) | null = null;
    let asked: string[] = [];
    /** Evidence for the messages: the line's state when the case took over. */
    let settledAfter = 0;
    let wentQuiet = false;
    /** A citer, or the seed's citer's citer, with the count the case gives it. */
    const work = (id: string, doi: string, count: number): unknown =>
      openAlexWork({ id, doi, title: `Floor paper ${id}`, year: 2021, count });

    /**
     * The fake, answering from the moment it is installed — which is where
     * this block parts company with D8. D8 holds every answer back until its
     * case clicks, so that the library's own automatic update of the new item
     * stores nothing and the list the case reads is the one its own fill asked
     * for. Here the update must instead run to the end BEFORE the graph is
     * built: a graph whose papers carry no citation count is never offered a
     * citation axis (`createMetricSelect`, `normaliseLayoutFor`), and the
     * floor is drawn on that axis and on no other — red run 5 opened on
     * year × free and the renderer drew no floor anywhere. Red run 6 answered
     * the seed's lookup alone and left its citer page not-found: the update
     * stored an empty list, and hop 1 opened reading "none yet" with nothing
     * left for the fill to fetch. So the seed's own list comes from the
     * update, and what the case's clicks still have to fetch — the hop-2 citer
     * pages, which the update never asks for, since it walks one library paper
     * and not a hop — is exactly what the case reads.
     */
    function serve(): void {
      undo ??= interceptProviders((url) => {
        asked.push(url);
        // A not-found is final; a 429 would bring the automatic update back on
        // a cool-down in the middle of a case that counts requests (D8).
        if (!/^https:\/\/api\.openalex\.org\//.test(url))
          return providerNotFound();
        const parsed = new URL(url);
        const path = decodeURIComponent(parsed.pathname);
        // The seed's own record carries the LIBRARY item's title and year: a
        // lookup that contradicts the local one is ambiguous, and an ambiguous
        // lookup is dropped, leaving the fill no work ID to page (D8).
        if (/\/works\/doi/i.test(path)) {
          return path.includes(SEED_DOI)
            ? providerAnswer(
                JSON.stringify(
                  openAlexWork({
                    id: "W900",
                    doi: SEED_DOI,
                    title: SEED_TITLE,
                    year: 2019,
                    count: CITERS.length,
                  }),
                ),
              )
            : providerNotFound();
        }
        const filter = parsed.searchParams.get("filter") ?? "";
        if (filter === "cites:W900") {
          return providerAnswer(
            JSON.stringify({
              results: CITERS.map((citer) =>
                work(citer.id, citer.doi, citer.count),
              ),
              meta: { count: CITERS.length },
            }),
          );
        }
        const citer = CITERS.find(
          (candidate) => filter === `cites:${candidate.id}`,
        );
        if (citer) {
          return providerAnswer(
            JSON.stringify({
              results: citer.citers.map((id) =>
                work(id, `10.5555/floor.${id.toLowerCase()}`, 0),
              ),
              meta: { count: citer.citers.length },
            }),
          );
        }
        return providerAnswer(
          JSON.stringify({ results: [], meta: { count: 0 } }),
        );
      });
    }

    function restore(): void {
      undo?.();
      undo = null;
    }

    /** The citer pages the fill asked for, in the order it asked. */
    function citerPages(): string[] {
      return asked.filter((url) =>
        /^cites:W90[123]$/.test(new URL(url).searchParams.get("filter") ?? ""),
      );
    }

    function pagedFilters(): string[] {
      return citerPages().map(
        (url) => new URL(url).searchParams.get("filter") ?? "",
      );
    }

    function floorInput(): HTMLInputElement {
      const input = graphRoot().querySelector(
        ".cm-scope-floor-input",
      ) as HTMLInputElement | null;
      expect(input, "the Citation floor field").to.exist;
      return input!;
    }

    function floorRowText(): string {
      return normalize(
        graphRoot().querySelector(".cm-scope-floor-row")?.textContent,
      );
    }

    /**
     * The gear's Y axis metric: the second select of the panel's second
     * section (X axis, Y axis, Nodes). The floor is drawn on the axis that
     * shows citations and on no other, so this is the case's precondition.
     */
    function yAxisMetric(): string {
      const section = graphRoot().querySelectorAll(".cm-appearance-section")[1];
      const selects = Array.from(
        section?.querySelectorAll("select") ?? [],
      ) as HTMLSelectElement[];
      return selects[1]?.value ?? "no Y axis select";
    }

    /** Everything about the floor's row, for an assertion that has to explain itself. */
    function floorEvidence(): string {
      const active = win.document.activeElement as Element | null;
      return (
        `y axis ${yAxisMetric()}, row "${floorRowText()}", field "${floorInput().value}", ` +
        `${graphRoot().querySelectorAll(".cm-scope-floor-input").length} field(s), ` +
        `focus ${active ? `${active.localName}.${active.className}` : "none"}` +
        `; recent Zotero errors: ${
          (Zotero.getErrors(true) as string[]).slice(-5).join(" || ") || "none"
        }`
      );
    }

    /**
     * Commit a floor in the field, the way the reader's Enter does. The field
     * is not focused first: the rail holds its Scope render back while the
     * field has focus and lets it out on blur, and that bookkeeping is the
     * rail's own to test — here it would only stand between the case and the
     * row it reads.
     */
    async function typeFloor(value: number): Promise<void> {
      const input = floorInput();
      input.value = String(value);
      input.dispatchEvent(new win.Event("change", { bubbles: true }));
      const settled = await waitFor(
        () => (value > 0 ? /\d+ below/.test(floorRowText()) : null),
        10_000,
      );
      expect(settled, `the floor row never took ${value}: ${floorEvidence()}`)
        .to.exist;
    }

    /**
     * Walk the plot in whole CSS pixels (B43) until the canvas title reads the
     * floor. Either end of the gesture serves: the tag always grabs the floor,
     * and the bare line grabs it wherever no node sits under it.
     */
    function findTag(): {
      point: { x: number; y: number } | null;
      /** Every distinct title the walk was offered, as evidence when it finds none. */
      seen: string[];
    } {
      const canvas = graphRoot().querySelector("canvas") as HTMLCanvasElement;
      const box = canvas.getBoundingClientRect();
      const left = Math.ceil(box.left);
      const top = Math.ceil(box.top);
      const seen = new Set<string>();
      for (let y = top + 2; y < box.bottom - 2; y += 3) {
        for (let x = left + 2; x < box.right - 2; x += 3) {
          canvas.dispatchEvent(
            new win.PointerEvent("pointermove", {
              bubbles: true,
              clientX: x,
              clientY: y,
            }),
          );
          const title = canvas.title;
          if (title.startsWith("floor:")) return { point: { x, y }, seen: [] };
          if (title) seen.add(`${title.split("\n")[0]} @${x},${y}`);
        }
      }
      return { point: null, seen: [...seen] };
    }

    /**
     * Open the graph on Overview — year across, citations up. The floor is
     * drawn on the axis that shows citations and on no other (graphFloor.ts,
     * `floorLinePlacement`), and a graph opens with the layout the profile
     * last stored: red runs 3 and 4 found `yMetric: "free"` in the test
     * profile's `graphAppearance`, so the plot had no citation axis, the
     * renderer drew no line, and the hover walk was offered 237 paper titles
     * and not one floor. Choosing the view is the reader's own way to say
     * which axes the plot has.
     */
    async function chooseOverview(id: string | null): Promise<void> {
      const gallery = (): HTMLElement | null =>
        (tabContent(id)?.querySelector(".cm-view-gallery") as HTMLElement) ??
        null;
      const card = await waitFor(() => {
        const live = gallery();
        return live && !live.hidden
          ? (live.querySelector(
              '.cm-view-gallery-card[data-view-id="overview"]',
            ) as HTMLButtonElement | null)
          : null;
      }, 15_000);
      expect(card, "the gallery's Overview card").to.exist;
      card!.click();
      const gone = await waitFor(() => gallery()?.hidden ?? false, 10_000);
      expect(gone, `the gallery after Overview; ${galleryState()}`).to.equal(
        true,
      );
    }

    before(async function () {
      this.timeout(240_000);
      previousKey = Zotero.Prefs.get(OPEN_ALEX_KEY_PREF, true);
      Zotero.Prefs.set(OPEN_ALEX_KEY_PREF, "floor-test-key", true);
      previousAppearance = Zotero.Prefs.get(GRAPH_APPEARANCE_PREF, true);
      serve();
      const item = new Zotero.Item("journalArticle");
      item.libraryID = Zotero.Libraries.userLibraryID;
      item.setField("title", SEED_TITLE);
      item.setField("date", "2019");
      item.setField("DOI", SEED_DOI);
      seedItemID = await item.saveTx();
      // A paper with no identifier, and so no citation count ever: it sits in
      // the plot's no-data lane, under the axis, and the floor never touches a
      // paper whose count is unknown. The camera fits the VISIBLE cloud, so
      // without a point below the axis the world's own bottom edge — the only
      // place a dragged floor reads 0 — can sit off the canvas entirely.
      const noData = new Zotero.Item("journalArticle");
      noData.libraryID = Zotero.Libraries.userLibraryID;
      noData.setField("title", NO_DATA_TITLE);
      noData.setField("date", "2018");
      noDataItemID = await noData.saveTx();
      // The library's own update of the seed runs before the graph is built,
      // not after: the display settings list only the metrics the loaded
      // papers carry (`createMetricSelect`), and a view asking for an axis the
      // graph has no data for lands on Free instead (`normaliseLayoutFor`).
      // Red run 5 opened the tab first, so no paper had a citation count when
      // the gear was built, Overview came out as year × free, and with neither
      // axis showing citations the renderer drew no floor at all.
      wentQuiet = await untilQuiet(() => asked.length, 10_000, 120_000);
      settledAfter = asked.length;
      tabID = await openNewGraphTab();
      currentTabID = tabID;
      win.Zotero_Tabs.select(tabID);
      const rail = await waitFor(
        () =>
          tabContent(tabID)?.querySelector(".cm-scope-section .cm-scope-count"),
        30_000,
      );
      expect(rail, "the floor tab's Scope section").to.exist;
      await chooseOverview(tabID);
      const fit = await waitFor(
        () =>
          graphRoot().querySelector(
            '.cm-zoom-controls button[data-action="fit"]',
          ) as HTMLButtonElement | null,
        10_000,
      );
      expect(fit, "the floor tab's fit button").to.exist;
      fit!.click();
      expect(yAxisMetric(), "the Y axis Overview landed on").to.equal(
        "citations",
      );
      // The test Zotero starts its suites while the database check still holds
      // the pane under a progress overlay a real pointer cannot cross. A
      // reader's Zotero is unlocked; lower the overlay the way Zotero does.
      const unlocked = await Promise.race([
        Zotero.unlockPromise.then(() => true),
        delay(5_000).then(() => false),
      ]);
      if (!unlocked) Zotero.hideZoteroPaneOverlays();
      const overlay = win.document.getElementById(
        "zotero-pane-overlay",
      ) as HTMLElement | null;
      const overlayDown = await waitFor(
        () => !overlay || win.getComputedStyle(overlay).display === "none",
        10_000,
      );
      expect(overlayDown, "the pane's progress overlay is down").to.equal(true);
    });

    after(async function () {
      this.timeout(30_000);
      restore();
      if (previousKey === undefined || previousKey === null)
        Zotero.Prefs.clear(OPEN_ALEX_KEY_PREF, true);
      else Zotero.Prefs.set(OPEN_ALEX_KEY_PREF, previousKey as string, true);
      if (previousAppearance === undefined || previousAppearance === null)
        Zotero.Prefs.clear(GRAPH_APPEARANCE_PREF, true);
      else
        Zotero.Prefs.set(
          GRAPH_APPEARANCE_PREF,
          previousAppearance as string,
          true,
        );
      if (tabID) win.Zotero_Tabs.close(tabID);
      await delay(500);
      tabID = null;
      currentTabID = null;
      if (seedItemID !== null) await Zotero.Items.erase(seedItemID);
      seedItemID = null;
      if (noDataItemID !== null) await Zotero.Items.erase(noDataItemID);
      noDataItemID = null;
    });

    it("hides under the floor, fills only above it, and the drag brings the rest back", async function () {
      this.timeout(180_000);
      // Hop 2 with the floor on: the citers of the one paper above it. With
      // the floor off: the citer under it brings its own along.
      const HOP_2 = citersOf("W902");
      const HOP_2_OFF = HOP_2 + citersOf("W901");
      asked = [];
      (await nodeMenuEntry("Add as seed", SEED_TITLE)).click();
      const filled = await waitFor(
        () => hopCounts(1)?.available ?? null,
        60_000,
      );
      expect(
        filled,
        `hop 1 never filled; it read "${hopRowText(1)}"; ${asked.join(" | ")}` +
          ` (before the case: ${settledAfter} request(s), line ${wentQuiet ? "quiet" : "STILL BUSY"})`,
      ).to.equal(3);

      // The floor hides the two citers under it and leaves the count beside
      // the field reading how many it took.
      await typeFloor(FLOOR);
      expect(floorInput().value, floorEvidence()).to.equal(String(FLOOR));
      expect(floorRowText(), floorEvidence()).to.include("2 below");
      expect(hopCounts(1), hopRowText(1)).to.deep.equal({
        shown: 1,
        available: 3,
      });

      // The fill expands SHOWN papers only, so the one citer above the floor
      // is the only one paged — and the papers it brings back carry a count of
      // 0 apiece, so the same floor hides them as they land.
      fetchButton(2)!.click();
      const hop2 = await waitFor(
        () => (hopCounts(2)?.available ? hopCounts(2) : null),
        60_000,
      );
      expect(
        hop2,
        `hop 2: "${hopRowText(2)}"; pages ${pagedFilters().join(" | ")}`,
      ).to.deep.equal({ shown: 0, available: HOP_2 });
      expect(
        pagedFilters(),
        "only the citer above the floor was paged",
      ).to.deep.equal(["cites:W902"]);

      // Dragging the floor off the bottom of the plot turns it off, and the
      // fill re-plans on the release: the citer that was under the floor is
      // paged now, and W903's reported zero still pages nothing.
      const walk = findTag();
      const tag = walk.point;
      expect(
        tag,
        `the floor's tag on the plot; ${galleryState()}; ${floorEvidence()}` +
          `; the walk was offered ${walk.seen.length} title(s): ${walk.seen.slice(0, 12).join(" | ") || "none"}`,
      ).to.exist;
      const canvas = graphRoot().querySelector("canvas") as HTMLCanvasElement;
      const box = canvas.getBoundingClientRect();
      // A real pointer, not a constructed PointerEvent: the renderer captures
      // the pointer on the way down, and `setPointerCapture` throws on a
      // synthetic pointer id. Whole pixels, since a MouseEvent truncates
      // fractions (B43). The walk down stops at the first frame the field
      // reads 0 — each move is handled and the rail rebuilt before
      // `sendMouseEvent` returns — so the gesture is as short as the camera
      // allows and the last y it needed is in the message.
      const utils = win.windowUtils;
      const endY = Math.floor(box.bottom) - 2;
      const seen: string[] = [];
      utils.sendMouseEvent("mousedown", tag!.x, tag!.y, 0, 1, 0, false, 0, 0);
      let y = tag!.y;
      while (y < endY) {
        y = Math.min(endY, y + 8);
        utils.sendMouseEvent("mousemove", tag!.x, y, 0, 0, 0, false, 0, 0);
        seen.push(`${y}:${floorInput().value}`);
        if (floorInput().value === "0") break;
      }
      utils.sendMouseEvent("mouseup", tag!.x, y, 0, 1, 0, false, 0, 0);
      const off = await waitFor(() => floorInput().value === "0", 5_000);
      expect(
        off,
        `the drag from ${tag!.x},${tag!.y} down to ${y} (canvas bottom ${endY})` +
          ` left the field at "${floorInput().value}"; the floor it read on the` +
          ` way: ${seen.join(" ")}; ${floorEvidence()}`,
      ).to.equal(true);
      expect(floorRowText(), floorEvidence()).to.include("off");
      const back = await waitFor(
        () => (hopCounts(2)?.available === HOP_2_OFF ? hopCounts(2) : null),
        60_000,
      );
      expect(
        back,
        `hop 2 after the drag: "${hopRowText(2)}"; pages ${pagedFilters().join(" | ")}`,
      ).to.deep.equal({ shown: HOP_2_OFF, available: HOP_2_OFF });
      expect(
        [...pagedFilters()].sort(),
        `pages after the drag: ${pagedFilters().join(" | ")}`,
      ).to.deep.equal(["cites:W901", "cites:W902"]);
    });
  });

  describe("with shared citers (Stage 4)", function () {
    let previousKey: unknown = undefined;
    let previousAppearance: unknown = undefined;
    let itemIDs: number[] = [];
    let tabID: string | null = null;
    let undo: (() => void) | null = null;
    let checkRequests = 0;
    let openAlexRequests = 0;
    /** The seeds whose own lookup the fake has answered. */
    const lookedUp = new Set<string>();

    /** Every paper here carries ten citations; the case reads links, not counts. */
    const work = (id: string, doi: string, title: string, year: number) =>
      openAlexWork({ id, doi, title, year, count: 10 });

    /** Answers from install, as the floor's block does, for the same reason. */
    function serve(): void {
      undo ??= interceptProviders((url) => {
        if (!/^https:\/\/api\.openalex\.org\//.test(url))
          return providerNotFound();
        openAlexRequests += 1;
        const parsed = new URL(url);
        const path = decodeURIComponent(parsed.pathname);
        if (/\/works\/doi/i.test(path)) {
          const seed = [SEED_A, SEED_B].find((s) => path.includes(s.doi));
          if (seed) lookedUp.add(seed.doi);
          return seed
            ? providerAnswer(
                JSON.stringify(work(seed.id, seed.doi, seed.title, 2019)),
              )
            : providerNotFound();
        }
        const filter = parsed.searchParams.get("filter") ?? "";
        if (parsed.searchParams.get("select") === "id,doi,referenced_works") {
          // The seed-link check (B78): answer by ID or DOI, every value of
          // the OR filter.
          checkRequests += 1;
          const [field, rest = ""] = filter.split(":", 2);
          const known = [
            { id: SEED_A.id, doi: SEED_A.doi },
            { id: SEED_B.id, doi: SEED_B.doi },
            ...[W(51), W(52), W(53), W(54)].map((id) => ({
              id,
              doi: citerDOI(id),
            })),
          ];
          const values = rest.split("|");
          return providerAnswer(
            JSON.stringify({
              results: known
                .filter((w) => values.includes(field === "doi" ? w.doi : w.id))
                .map((w) => ({
                  id: `https://openalex.org/${w.id}`,
                  doi: `https://doi.org/${w.doi}`,
                  referenced_works: (REFERENCES_OF[w.id] ?? []).map(
                    (r) => `https://openalex.org/${r}`,
                  ),
                })),
            }),
          );
        }
        const cited = /^cites:(W\d+)$/.exec(filter)?.[1];
        const citers = cited ? (CITERS_OF[cited] ?? []) : [];
        return providerAnswer(
          JSON.stringify({
            results: citers.map((id) =>
              work(id, citerDOI(id), `Shared paper ${id}`, 2021),
            ),
            meta: { count: citers.length },
          }),
        );
      });
    }

    function restore(): void {
      undo?.();
      undo = null;
    }

    function keyEntries(): string[] {
      return [...graphRoot().querySelectorAll(".cm-key-entry")].map((entry) =>
        normalize(entry?.textContent),
      );
    }

    /** The count span of the Key entry whose label starts with `prefix`. */
    function tierCount(prefix: string): string | null {
      for (const entry of graphRoot().querySelectorAll(
        ".cm-key-entry",
      ) as unknown as Iterable<Element>) {
        const label = normalize(
          entry.querySelector(".cm-key-entry-label")?.textContent,
        );
        if (label.startsWith(prefix))
          return normalize(
            entry.querySelector(".cm-key-entry-count")?.textContent,
          );
      }
      return null;
    }

    function sharedInput(): HTMLInputElement {
      const input = graphRoot().querySelector(
        ".cm-scope-shared-input",
      ) as HTMLInputElement | null;
      expect(input, "the Shared by field").to.exist;
      return input!;
    }

    function sharedRowText(): string {
      return normalize(
        graphRoot().querySelector(".cm-scope-shared-row")?.textContent,
      );
    }

    before(async function () {
      this.timeout(240_000);
      previousKey = Zotero.Prefs.get(OPEN_ALEX_KEY_PREF, true);
      Zotero.Prefs.set(OPEN_ALEX_KEY_PREF, "shared-test-key", true);
      previousAppearance = Zotero.Prefs.get(GRAPH_APPEARANCE_PREF, true);
      serve();
      for (const seed of [SEED_A, SEED_B]) {
        const item = new Zotero.Item("journalArticle");
        item.libraryID = Zotero.Libraries.userLibraryID;
        item.setField("title", seed.title);
        item.setField("date", "2019");
        item.setField("DOI", seed.doi);
        itemIDs.push(await item.saveTx());
      }
      tabID = await openNewGraphTab();
      currentTabID = tabID;
      win.Zotero_Tabs.select(tabID);
      const rail = await waitFor(
        () =>
          tabContent(tabID)?.querySelector(".cm-scope-section .cm-scope-count"),
        30_000,
      );
      expect(rail, "the shared tab's Scope section").to.exist;
      // Start blank and fit, as every other block does, but only once both
      // seeds are on the plot: the camera keeps the extent it fits to, and
      // with the outer fixture served (B74) that extent no longer happened
      // to cover the seeds.
      await dismissGallery(tabID);
      const looked = await waitFor(() => lookedUp.size === 2, 60_000);
      expect(looked, `seeds looked up: ${[...lookedUp].join(", ")}`).to.exist;
      await delay(1_000);
      const fit = await waitFor(
        () =>
          graphRoot().querySelector(
            '.cm-zoom-controls button[data-action="fit"]',
          ) as HTMLButtonElement | null,
        10_000,
      );
      expect(fit, "the shared tab's fit button").to.exist;
      fit!.click();
    });

    after(async function () {
      this.timeout(30_000);
      restore();
      if (previousKey === undefined || previousKey === null)
        Zotero.Prefs.clear(OPEN_ALEX_KEY_PREF, true);
      else Zotero.Prefs.set(OPEN_ALEX_KEY_PREF, previousKey as string, true);
      if (previousAppearance === undefined || previousAppearance === null)
        Zotero.Prefs.clear(GRAPH_APPEARANCE_PREF, true);
      else
        Zotero.Prefs.set(
          GRAPH_APPEARANCE_PREF,
          previousAppearance as string,
          true,
        );
      if (tabID) win.Zotero_Tabs.close(tabID);
      await delay(500);
      tabID = null;
      currentTabID = null;
      for (const id of itemIDs) await Zotero.Items.erase(id);
      itemIDs = [];
    });

    it("colours both papers citing both seeds into the top tier, one found only by the check, and the rule keeps them", async function () {
      this.timeout(180_000);
      (await nodeMenuEntry("Add as seed", SEED_A.title)).click();
      await waitFor(() => hopCounts(1)?.available ?? null, 60_000);
      (await nodeMenuEntry("Add as seed", SEED_B.title)).click();
      const filled = await waitFor(
        () => (hopCounts(1)?.available === 4 ? hopCounts(1) : null),
        60_000,
      );
      expect(filled, `hop 1 read "${hopRowText(1)}"`).to.deep.equal({
        shown: 4,
        available: 4,
      });

      const option = graphRoot().querySelector(
        'option[data-metric="seed-links"]',
      ) as HTMLOptionElement | null;
      expect(option, "the Seeds linked option").to.exist;
      expect(option!.disabled, "offered with two seeds").to.equal(false);
      const select = option!.parentElement as HTMLSelectElement;
      select.value = "seed-links";
      select.dispatchEvent(new win.Event("change", { bubbles: true }));
      const tiers = await waitFor(
        () =>
          tierCount("Cite all 2 seeds") === COUNT_FORMAT.format(2)
            ? keyEntries()
            : null,
        30_000,
      );
      expect(tiers, `the Key read: ${keyEntries().join(" | ")}`).to.exist;
      expect(tierCount("Cite 1 seed"), `Key: ${tiers!.join(" | ")}`).to.equal(
        COUNT_FORMAT.format(2),
      );

      const input = sharedInput();
      input.value = "2";
      input.dispatchEvent(new win.Event("change", { bubbles: true }));
      const narrowed = await waitFor(
        () => (hopCounts(1)?.shown === 2 ? hopCounts(1) : null),
        10_000,
      );
      expect(
        narrowed,
        `hop 1 read "${hopRowText(1)}"; the row read "${sharedRowText()}"`,
      ).to.deep.equal({ shown: 2, available: 4 });
      expect(sharedRowText()).to.include("2 below");
    });

    /**
     * B79: the gate closes on a live graph. Clearing the key refreshes the
     * open graphs (the preference observer), so W54 loses the link only its
     * reference list gave it without a reopen, and nothing is asked; the key
     * back reads the stored list again, still without asking.
     */
    it("drops the check's link as soon as the key goes, and takes it back from the store", async function () {
      this.timeout(120_000);
      // Clearing the key remounts the graph, which cancels a check still in
      // flight, and that paper is rightly asked again once the key is back;
      // so the fill and the check go quiet first.
      let seen = openAlexRequests;
      let since = Date.now();
      const deadline = since + 60_000;
      while (Date.now() < deadline && Date.now() - since < 3_000) {
        await delay(500);
        if (openAlexRequests !== seen) {
          seen = openAlexRequests;
          since = Date.now();
        }
      }
      const asked = checkRequests;
      Zotero.Prefs.clear(OPEN_ALEX_KEY_PREF, true);
      const dropped = await waitFor(
        () =>
          tierCount("Cite all 2 seeds") === COUNT_FORMAT.format(1)
            ? keyEntries()
            : null,
        30_000,
      );
      expect(dropped, `the Key read: ${keyEntries().join(" | ")}`).to.exist;
      expect(checkRequests, "checks asked without a key").to.equal(asked);

      Zotero.Prefs.set(OPEN_ALEX_KEY_PREF, "shared-test-key", true);
      const back = await waitFor(
        () =>
          tierCount("Cite all 2 seeds") === COUNT_FORMAT.format(2)
            ? keyEntries()
            : null,
        30_000,
      );
      expect(back, `the Key read: ${keyEntries().join(" | ")}`).to.exist;
      expect(checkRequests, "checks asked with the key back").to.equal(asked);
    });

    /**
     * B52: the Key follows the gear's colouring on its own. A layout change
     * never reached `updateSummary`, so on a graph whose fill had gone quiet
     * the rail went on naming the hop colours under Uniform. The Key is read
     * straight after the change, before anything else can rebuild it.
     */
    it("drops the hop colours from the Key when the colouring leaves Citation hop", async function () {
      this.timeout(120_000);
      // Uniform carries no `data-metric`, so the colour select is found by
      // its Citation hop option and driven by value.
      const colouring = (metric: string): void => {
        const select = graphRoot().querySelector(
          'option[data-metric="citation-hop"]',
        )?.parentElement as HTMLSelectElement | null;
        expect(select, "the colour select").to.exist;
        select!.value = metric;
        expect(select!.value, `the ${metric} option`).to.equal(metric);
        select!.dispatchEvent(new win.Event("change", { bubbles: true }));
      };
      const hopRows = (): string[] =>
        // "Seed" is also a state row, so only the hop rows tell the
        // colouring apart.
        keyEntries().filter((entry) => /^Hop \d/.test(entry));

      let seen = openAlexRequests;
      let since = Date.now();
      const deadline = since + 60_000;
      while (Date.now() < deadline && Date.now() - since < 3_000) {
        await delay(500);
        if (openAlexRequests !== seen) {
          seen = openAlexRequests;
          since = Date.now();
        }
      }

      colouring("citation-hop");
      expect(
        hopRows(),
        `under Citation hop the Key read: ${keyEntries().join(" | ")}`,
      ).to.not.be.empty;

      colouring("uniform");
      expect(
        hopRows(),
        `under Uniform the Key read: ${keyEntries().join(" | ")}`,
      ).to.be.empty;
      expect(
        keyEntries().some((entry) => entry.startsWith("Paper")),
        `under Uniform the Key read: ${keyEntries().join(" | ")}`,
      ).to.equal(true);
    });

    /**
     * B82: a theme flip repaints the Key. The renderer's notice refreshed only
     * the Scope rail, so the Key's swatches kept the old theme's colours. The
     * Paper swatch under Uniform is the theme's own neutral, read off the Key
     * with nothing but the flip between the two readings.
     */
    it("repaints the Key's swatches when the appearance flips", async function () {
      this.timeout(60_000);
      const select = graphRoot().querySelector(
        'option[data-metric="citation-hop"]',
      )?.parentElement as HTMLSelectElement | null;
      expect(select, "the colour select").to.exist;
      select!.value = "uniform";
      select!.dispatchEvent(new win.Event("change", { bubbles: true }));
      const paperFill = (): string | null => {
        for (const entry of graphRoot().querySelectorAll(
          ".cm-key-entry",
        ) as unknown as Iterable<Element>) {
          const label = normalize(
            entry.querySelector(".cm-key-entry-label")?.textContent,
          );
          if (label.startsWith("Paper"))
            return entry.querySelector("circle")?.getAttribute("fill") ?? null;
        }
        return null;
      };
      const scheme = (): string | undefined => graphRoot().dataset.cmScheme;

      const original = Services.prefs.getIntPref(APPEARANCE_PREF, 2);
      try {
        Services.prefs.setIntPref(APPEARANCE_PREF, 1);
        await delay(800);
        const light = { scheme: scheme(), fill: paperFill() };
        Services.prefs.setIntPref(APPEARANCE_PREF, 0);
        await delay(1_500);
        const dark = { scheme: scheme(), fill: paperFill() };
        const evidence =
          `light: scheme=${light.scheme} fill=${light.fill}; ` +
          `dark: scheme=${dark.scheme} fill=${dark.fill}; ` +
          `the Key read: ${keyEntries().join(" | ")}`;

        // The flip happened, and the Key had the light neutral before it.
        expect(light.scheme, `light first (${evidence})`).to.equal("light");
        expect(dark.scheme, `the chrome went dark (${evidence})`).to.equal(
          "dark",
        );
        expect(light.fill, `the light Paper swatch (${evidence})`).to.equal(
          graphThemeFor("light").states.uniformFill,
        );
        expect(dark.fill, `the dark Paper swatch (${evidence})`).to.equal(
          graphThemeFor("dark").states.uniformFill,
        );
      } finally {
        Services.prefs.setIntPref(APPEARANCE_PREF, original);
        await delay(300);
      }
    });
  });
});
