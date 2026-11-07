import {
  isItemKey,
  readVersionedBlock,
  type LibraryLink,
  type Parsed,
} from "./common";
import { dataBlock, escapeHtml } from "./html";

export const READING_LIST_TAG = "meristema-reading-list";
export const READING_LIST_ATTRIBUTE = "meristema-reading-list";

export interface ReadingListStep {
  key: string;
  why: string;
}

export interface ReadingListDoc {
  version: 1;
  topic: string;
  steps: ReadingListStep[];
}

export interface FolderItem {
  key: string;
  title: string;
}

export interface ResolvedStep {
  step: number;
  key: string;
  why: string;
}

export interface ResolvedList {
  steps: ResolvedStep[];
  unordered: string[];
}

const BAD_SHAPE = { ok: false, reason: "bad-shape" } as const;

export function parseReadingList(html: string): Parsed<ReadingListDoc> {
  const block = readVersionedBlock(html, READING_LIST_ATTRIBUTE);
  if (!block.ok) return block;
  const { topic, steps } = block.value;
  if (typeof topic !== "string" || !Array.isArray(steps)) return BAD_SHAPE;
  const seen = new Set<string>();
  const kept: ReadingListStep[] = [];
  for (const step of steps as unknown[]) {
    if (!step || typeof step !== "object") return BAD_SHAPE;
    const { key, why } = step as Record<string, unknown>;
    const reason =
      typeof why === "string" ? why : why === undefined ? "" : null;
    if (!isItemKey(key) || reason === null) return BAD_SHAPE;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push({ key, why: reason });
  }
  return { ok: true, value: { version: 1, topic, steps: kept } };
}

function byTitleThenKey(a: FolderItem, b: FolderItem): number {
  const ta = a.title.toLowerCase();
  const tb = b.title.toLowerCase();
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

export function resolveReadingList(
  doc: ReadingListDoc,
  folder: readonly FolderItem[],
): ResolvedList {
  const present = new Set(folder.map((item) => item.key));
  const steps = doc.steps
    .filter((step) => present.has(step.key))
    .map((step, index) => ({ step: index + 1, key: step.key, why: step.why }));
  const ordered = new Set(steps.map((step) => step.key));
  const unordered = folder
    .filter((item) => !ordered.has(item.key))
    .sort(byTitleThenKey)
    .map((item) => item.key);
  return { steps, unordered };
}

export function itemHref(link: LibraryLink, key: string): string {
  return link.kind === "user"
    ? `zotero://select/library/items/${key}`
    : `zotero://select/groups/${link.id}/items/${key}`;
}

/** The whole note: a readable part rebuilt from `doc`, then the data block. */
export function writeReadingList(
  doc: ReadingListDoc,
  label: (key: string) => string,
  link: LibraryLink,
): string {
  const items = doc.steps
    .map((step) => {
      const why = step.why ? `: ${escapeHtml(step.why)}` : "";
      return `<li><a href="${itemHref(link, step.key)}">${escapeHtml(label(step.key))}</a>${why}</li>`;
    })
    .join("");
  const json = JSON.stringify({
    version: 1,
    topic: doc.topic,
    steps: doc.steps.map((step) => ({ key: step.key, why: step.why })),
  });
  return (
    `<h1>Reading list - ${escapeHtml(doc.topic)}</h1>` +
    `<ol>${items}</ol>` +
    `<p>Plugin data (do not edit)</p>` +
    dataBlock(READING_LIST_ATTRIBUTE, json)
  );
}
