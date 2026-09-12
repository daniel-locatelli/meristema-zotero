import type { CitationGraphModel } from "../domain/graphTypes";
import type { LibrarySnapshot } from "../domain/types";
import { decodeGraphView } from "./graphViews";

function sanitizeFilename(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "meristema"
  );
}

interface SaveFileOptions {
  title: string;
  filename: string;
  extension: string;
  filterLabel: string;
}

async function chooseSavePath(
  document: Document,
  options: SaveFileOptions,
): Promise<string | null> {
  const parentWindow = document.defaultView;
  if (!parentWindow) {
    throw new Error("Unable to open the export save dialog.");
  }

  const picker = Components.classes["@mozilla.org/filepicker;1"].createInstance(
    Components.interfaces.nsIFilePicker,
  );
  picker.init(
    (parentWindow as any).browsingContext,
    options.title,
    picker.modeSave,
  );
  picker.defaultString = options.filename;
  picker.defaultExtension = options.extension;
  picker.appendFilter(options.filterLabel, `*.${options.extension}`);
  picker.appendFilters(picker.filterAll);

  const result = await new Promise<number>((resolve) => picker.open(resolve));
  if (result !== picker.returnOK && result !== picker.returnReplace) {
    return null;
  }
  return String(picker.file?.path ?? "").trim() || null;
}

export async function chooseOpenPath(
  document: Document,
  options: { title: string; extension: string; filterLabel: string },
): Promise<string | null> {
  const parentWindow = document.defaultView;
  if (!parentWindow) throw new Error("Unable to open the file dialog.");
  const picker = Components.classes["@mozilla.org/filepicker;1"].createInstance(
    Components.interfaces.nsIFilePicker,
  );
  picker.init(
    (parentWindow as any).browsingContext,
    options.title,
    picker.modeOpen,
  );
  picker.appendFilter(options.filterLabel, `*.${options.extension}`);
  picker.appendFilters(picker.filterAll);
  const result = await new Promise<number>((resolve) => picker.open(resolve));
  if (result !== picker.returnOK) return null;
  return String(picker.file?.path ?? "").trim() || null;
}

export type PickOpenPath = (document: Document) => Promise<string | null>;

const defaultViewPicker: PickOpenPath = (document) =>
  chooseOpenPath(document, {
    title: "Import view",
    extension: "json",
    filterLabel: "Meristema view (JSON)",
  });

/**
 * D4 import. The picker is a parameter so the Zotero suite can hand in a
 * temp file: an XPCOM picker built inside the function cannot be stubbed.
 * Returns null when the reader cancelled.
 */
export async function importGraphViewFile(
  document: Document,
  pick: PickOpenPath = defaultViewPicker,
): Promise<ReturnType<typeof decodeGraphView> | null> {
  const path = await pick(document);
  if (!path) return null;
  const contents = await Zotero.File.getContentsAsync(path);
  return decodeGraphView(String(contents));
}

async function saveExport(
  document: Document,
  options: SaveFileOptions,
  content: string | Blob,
): Promise<void> {
  const path = await chooseSavePath(document, options);
  if (!path) return;
  await Zotero.File.putContentsAsync(path, content);
}

export async function exportGraphJSON(
  document: Document,
  snapshot: LibrarySnapshot,
  model: CitationGraphModel,
  visibleKeys: Set<string>,
  includeExternal = false,
): Promise<void> {
  const nodes = model.nodes.filter((node) => visibleKeys.has(node.key));
  const keys = new Set(nodes.map((node) => node.key));
  const edges = model.edges.filter(
    (edge) => keys.has(edge.source) && keys.has(edge.target),
  );
  const filename = `${sanitizeFilename(snapshot.libraryName)}-meristema.json`;
  await saveExport(
    document,
    {
      title: "Export as JSON",
      filename,
      extension: "json",
      filterLabel: "JSON files",
    },
    JSON.stringify(
      {
        schema: "meristema/1",
        generatedAt: new Date().toISOString(),
        library: snapshot.libraryName,
        includeExternal,
        nodes,
        edges,
      },
      null,
      2,
    ),
  );
}

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export async function exportGraphCSV(
  document: Document,
  snapshot: LibrarySnapshot,
  model: CitationGraphModel,
  visibleKeys: Set<string>,
): Promise<void> {
  const nodes = model.nodes.filter((node) => visibleKeys.has(node.key));
  const keys = new Set(nodes.map((node) => node.key));
  const nodeByKey = new Map(nodes.map((node) => [node.key, node]));
  const lines = [
    [
      "source_item_key",
      "source_title",
      "source_doi",
      "target_item_key",
      "target_title",
      "target_doi",
      "provenance",
      "manual",
    ].join(","),
  ];
  for (const edge of model.edges) {
    if (!keys.has(edge.source) || !keys.has(edge.target)) continue;
    const source = nodeByKey.get(edge.source);
    const target = nodeByKey.get(edge.target);
    lines.push(
      [
        edge.source,
        source?.title,
        source?.doi,
        edge.target,
        target?.title,
        target?.doi,
        edge.provenance,
        edge.manual,
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  const filename = `${sanitizeFilename(snapshot.libraryName)}-citation-links.csv`;
  await saveExport(
    document,
    {
      title: "Export as CSV",
      filename,
      extension: "csv",
      filterLabel: "CSV files",
    },
    lines.join("\r\n"),
  );
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Unable to render the graph image."));
    }, "image/png");
  });
}

export async function exportGraphPNG(
  document: Document,
  canvas: HTMLCanvasElement,
  snapshot: LibrarySnapshot,
): Promise<void> {
  const filename = `${sanitizeFilename(snapshot.libraryName)}-meristema.png`;
  const path = await chooseSavePath(document, {
    title: "Export as PNG",
    filename,
    extension: "png",
    filterLabel: "PNG images",
  });
  if (!path) return;
  const blob = await canvasBlob(canvas);
  await Zotero.File.putContentsAsync(path, blob);
}
