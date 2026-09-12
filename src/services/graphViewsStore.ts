import { config } from "../../package.json";
import {
  decodeGraphViewRecord,
  encodeGraphView,
  type GraphViewDefinition,
} from "./graphViews";

/*
 * D4: the reader's own views, stored in the Zotero profile beside
 * graphAppearance. The record on disk is the wire form plus `id`, one array;
 * the wire field `meristemaView` versions each record, so there is no
 * separate version preference. Unparseable is empty, never thrown.
 */

const key = (name: string): string => `${config.prefsPrefix}.${name}`;
const VIEWS = "graphViews";
const DISMISSED = "graphViewTutorialsDismissed";

function readRaw(name: string): unknown {
  try {
    return JSON.parse(String(Zotero.Prefs.get(key(name), true) ?? ""));
  } catch {
    return null;
  }
}

export function listSavedGraphViews(): GraphViewDefinition[] {
  const raw = readRaw(VIEWS);
  if (!Array.isArray(raw)) return [];
  const out: GraphViewDefinition[] = [];
  for (const record of raw) {
    const id =
      typeof record === "object" &&
      record &&
      typeof (record as { id?: unknown }).id === "string"
        ? (record as { id: string }).id
        : null;
    if (!id || !id.startsWith("user:")) continue;
    const decoded = decodeGraphViewRecord(record, id);
    if (decoded.ok) out.push(decoded.view);
  }
  return out;
}

function writeViews(views: readonly GraphViewDefinition[]): void {
  const records = views.map((v) => ({
    ...JSON.parse(encodeGraphView(v)),
    id: v.id,
  }));
  Zotero.Prefs.set(key(VIEWS), JSON.stringify(records), true);
}

export function saveGraphView(view: GraphViewDefinition): void {
  const others = listSavedGraphViews().filter((v) => v.id !== view.id);
  writeViews([...others, view]);
}

export function deleteGraphView(id: string): void {
  writeViews(listSavedGraphViews().filter((v) => v.id !== id));
  writeDismissed(readDismissed().filter((d) => d !== id));
}

function readDismissed(): string[] {
  const raw = readRaw(DISMISSED);
  return Array.isArray(raw)
    ? raw.filter((d): d is string => typeof d === "string")
    : [];
}

function writeDismissed(ids: readonly string[]): void {
  Zotero.Prefs.set(key(DISMISSED), JSON.stringify([...new Set(ids)]), true);
}

export function isTutorialDismissed(id: string): boolean {
  return readDismissed().includes(id);
}

export function dismissTutorial(id: string): void {
  writeDismissed([...readDismissed(), id]);
}
