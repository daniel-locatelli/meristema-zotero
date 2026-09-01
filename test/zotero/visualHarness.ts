/**
 * A driving harness for the graph renderer, not a test.
 *
 * The graph is a canvas. Nothing about the ramp, the inset figure, the label
 * budget or the reciprocal edge lens can be asserted from a unit test, and the
 * five preceding tasks all landed unlooked-at. This opens the plugin's own
 * chrome window, mounts a canvas, drives the real `CitationGraphRenderer`, and
 * writes each frame out as a PNG a human (or a model) can look at.
 */
import type {
  CitationGraphEdge,
  CitationGraphModel,
  CitationGraphNode,
  GraphLayoutOptions,
} from "../../src/domain/graphTypes";
import { element, ensureStyles } from "../../src/services/graphViewControls";

declare const IOUtils: any;
declare const PathUtils: any;

/** Where the frames land. Overridable so the harness is not machine-bound. */
export function outputDirectory(): string {
  const pref = "extensions.zotero.meristema.visualOutDir";
  const configured = Services.prefs.getStringPref(pref, "");
  if (configured) return configured;
  return PathUtils.join(Zotero.getTempDirectory().path, "meristema-visual");
}

export async function writeFrame(
  canvas: HTMLCanvasElement,
  name: string,
): Promise<string> {
  const directory = outputDirectory();
  await IOUtils.makeDirectory(directory, { ignoreExisting: true });
  const url = canvas.toDataURL("image/png");
  const base64 = url.slice(url.indexOf(",") + 1);
  const view = canvas.ownerDocument.defaultView as any;
  const binary = view.atob(base64) as string;
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const path = PathUtils.join(directory, `${name}.png`);
  await IOUtils.write(path, bytes);
  return path;
}

/** A whole-window capture, so the chrome around the canvas is looked at too. */
export async function writeWindow(
  win: Window,
  name: string,
): Promise<string | null> {
  const context = (win as any).browsingContext;
  const global = context?.currentWindowGlobal;
  if (!global?.drawSnapshot) return null;
  const rect = new (win as any).DOMRect(0, 0, win.innerWidth, win.innerHeight);
  const bitmap = await global.drawSnapshot(rect, 1, "white");
  const canvas = win.document.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "canvas",
  ) as HTMLCanvasElement;
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  return writeFrame(canvas, name);
}

/** `dump` is pref-gated and absent in some contexts; never let it fail a run. */
export function note(message: string): void {
  try {
    Zotero.debug(`[visual] ${message}`);
  } catch {
    /* ignore */
  }
  try {
    (globalThis as any).dump?.(`[visual] ${message}\n`);
  } catch {
    /* ignore */
  }
}

/** A machine-readable trail, so the run is inspectable after Zotero exits. */
export async function writeReport(entries: unknown): Promise<string> {
  const directory = outputDirectory();
  await IOUtils.makeDirectory(directory, { ignoreExisting: true });
  const path = PathUtils.join(directory, "report.json");
  await IOUtils.writeUTF8(path, JSON.stringify(entries, null, 2));
  return path;
}

export function delay(ms: number): Promise<void> {
  return Zotero.Promise.delay(ms) as unknown as Promise<void>;
}

/** Deterministic, so two runs of the harness are comparable frame by frame. */
export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeNode(
  index: number,
  overrides: Partial<CitationGraphNode> = {},
): CitationGraphNode {
  const key = `local:${index}`;
  return {
    key,
    itemID: 10_000 + index,
    itemKey: `KEY${index}`,
    kind: "local",
    focusRole: null,
    externalWork: null,
    title: `Paper ${index}`,
    abstract: null,
    sourceTitle: null,
    authors: [`Author ${index}`],
    year: null,
    publicationDate: null,
    citationSequence: null,
    doi: null,
    tags: [],
    collectionIDs: [],
    citationCount: null,
    referenceCount: null,
    resolvedReferenceCount: 0,
    referenceCoverage: null,
    metricsUpdatedAt: null,
    dataAgeDays: null,
    provider: null,
    citationCountProvider: null,
    referenceCountProvider: null,
    providerWorkID: null,
    matchedBy: null,
    matchConfidence: null,
    matchConfirmed: false,
    metricStatus: null,
    fwci: null,
    citationPercentile: null,
    isTop1Percent: null,
    isTop10Percent: null,
    citationsLastYear: null,
    citationVelocity: null,
    citationAcceleration: null,
    influentialCitationCount: null,
    isRetracted: null,
    openAccessStatus: null,
    isOpenAccess: null,
    publicationType: null,
    sourceMetrics: null,
    metadataCompleteness: 1,
    incomingLibraryCitations: 0,
    outgoingLibraryReferences: 0,
    libraryCoverage: null,
    localGlobalImpactRatio: null,
    isIsolated: false,
    referenceAgeMean: null,
    referenceAgeSpread: null,
    selfCitationEstimate: null,
    futureReferenceCount: null,
    references: [],
    ...overrides,
  };
}

export function makeEdge(source: string, target: string): CitationGraphEdge {
  return {
    key: `${source}>${target}`,
    source,
    target,
    provenance: "harness",
    manual: false,
  };
}

export interface CorpusOptions {
  nodes: number;
  /** Fraction of papers with no year, to exercise the NO DATA lane. */
  missingYearShare?: number;
  edgesPerNode?: number;
  seed?: number;
}

const SUBJECTS = [
  "Structure",
  "Growth",
  "Signalling",
  "Patterning",
  "Regulation",
];

/**
 * A citation corpus with the shape the checks need: a spread of years and
 * citation counts, a few collections, and edges that run from the newer paper
 * to the older one so the arrowheads mean something.
 */
export function makeCorpus(options: CorpusOptions): CitationGraphModel {
  const {
    nodes: count,
    missingYearShare = 0,
    edgesPerNode = 1.4,
    seed = 7,
  } = options;
  const next = random(seed);
  const nodes: CitationGraphNode[] = [];
  for (let index = 0; index < count; index += 1) {
    const missingYear = next() < missingYearShare;
    const year = missingYear ? null : 1985 + Math.floor(next() * 40);
    // A long tail, so the size and colour ramps have something to say.
    const citationCount = Math.round(Math.pow(next(), 3) * 900);
    nodes.push(
      makeNode(index, {
        title: `${SUBJECTS[index % SUBJECTS.length]} of meristem tissue ${index}`,
        authors: [`Author ${index}`, `Coauthor ${index}`],
        year,
        citationCount,
        referenceCount: Math.round(next() * 60),
        collectionIDs: [1 + Math.floor(next() * 7)],
      }),
    );
  }

  const edges: CitationGraphEdge[] = [];
  const seen = new Set<string>();
  const add = (source: string, target: string): void => {
    if (source === target || seen.has(`${source}>${target}`)) return;
    seen.add(`${source}>${target}`);
    edges.push(makeEdge(source, target));
  };
  const wanted = Math.round(count * edgesPerNode);
  let attempts = 0;
  while (edges.length < wanted && attempts < wanted * 40) {
    attempts += 1;
    const source = nodes[Math.floor(next() * count)]!;
    const cited = nodes[Math.floor(next() * count)]!;
    // Newer cites older, unless a year is missing.
    if ((source.year ?? 0) < (cited.year ?? 0)) add(cited.key, source.key);
    else add(source.key, cited.key);
  }

  const byKey = new Map(nodes.map((node) => [node.key, node]));
  for (const edge of edges) {
    const source = byKey.get(edge.source);
    const cited = byKey.get(edge.target);
    if (source) source.outgoingLibraryReferences += 1;
    if (cited) cited.incomingLibraryCitations += 1;
  }

  return {
    nodes,
    edges,
    statistics: {
      nodes: nodes.length,
      resolvedNodes: nodes.length,
      edges: edges.length,
      isolatedNodes: 0,
    },
  };
}

export const BASE_LAYOUT: GraphLayoutOptions = {
  xMetric: "year",
  xScale: "linear",
  yMetric: "citations",
  yScale: "log",
  nodeSizeMetric: "citations",
  nodeColorMetric: "collection",
  nodeLabelMode: "author-year",
};

export const COLLECTION_LABELS = new Map<number, string>([
  [1, "Meristem structure"],
  [2, "Phyllotaxis"],
  [3, "Auxin transport"],
  [4, "Stem cells"],
  [5, "Root apical meristem"],
  [6, "Flowering"],
  [7, "Methods"],
]);

export interface Stage {
  window: Window;
  canvas: HTMLCanvasElement;
  /** The `.meristema-root` the theme's custom properties are written onto. */
  root: HTMLElement;
  /** The `.cm-main` row. A Key rail goes in here, before the graph area. */
  main: HTMLElement;
  graphArea: HTMLElement;
  close: () => void;
}

/**
 * Opens the plugin's own chrome window and builds the view's real shell in it —
 * `.meristema-root` > `.cm-main` > `.cm-graph-area` > the canvas — with
 * `graph.css` loaded. Anything mounted beside the canvas therefore lands in the
 * same box model and the same theme the product uses.
 */
export async function openStage(): Promise<Stage> {
  const host = Zotero.getMainWindows()[0] as any;
  const url = "chrome://meristema/content/graphWindow.xhtml";
  const popup = host.openDialog(
    url,
    "meristema-visual-harness",
    "chrome,dialog=no,resizable,centerscreen,width=1200,height=820",
  ) as Window;
  await new Promise<void>((resolve) => {
    if (popup.document?.readyState === "complete") {
      resolve();
      return;
    }
    popup.addEventListener("load", () => resolve(), { once: true });
  });
  await delay(250);

  const document = popup.document;
  ensureStyles(document);
  const mount = document.getElementById("meristema-window-root")!;
  const root = element(document, "div", "meristema-root");
  const main = element(document, "main", "cm-main");
  const graphArea = element(document, "section", "cm-graph-area");
  const canvas = element(document, "canvas", "cm-graph-canvas");
  graphArea.appendChild(canvas);
  main.appendChild(graphArea);
  root.appendChild(main);
  mount.appendChild(root);
  await delay(200);

  return {
    window: popup,
    canvas: canvas as HTMLCanvasElement,
    root,
    main,
    graphArea,
    close: () => popup.close(),
  };
}

/**
 * The initial fit is rAF-driven and needs a couple of stable frames.
 *
 * Gecko stops servicing `requestAnimationFrame` in an occluded window, and the
 * harness's popup is occluded whenever anything else takes the foreground. An
 * unraced wait therefore hangs until mocha's timeout, which lets the next case
 * start while this one is still drawing into the same canvas — one run in three
 * came out with interleaved frames that way. Every frame wait is raced against
 * a deadline so a stalled compositor costs a delay, not a run.
 */
export async function settle(win: Window, frames = 12): Promise<void> {
  for (let index = 0; index < frames; index += 1) {
    await Promise.race([
      new Promise<void>((resolve) =>
        win.requestAnimationFrame(() => resolve()),
      ),
      delay(50),
    ]);
  }
  await delay(80);
}
