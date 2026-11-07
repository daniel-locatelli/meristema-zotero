import { extractDataBlock, preBlockTexts } from "./html";

export type ParseFailure =
  "no-data" | "bad-json" | "unknown-version" | "bad-shape";

export type Parsed<T> =
  { ok: true; value: T } | { ok: false; reason: ParseFailure };

/** Which library an item key belongs to. */
export type LibraryLink = { kind: "user" } | { kind: "group"; id: number };

/** Zotero's item-key alphabet: digits 2 to 9 and capitals without O. */
export const ITEM_KEY_CHARS = "23456789ABCDEFGHIJKLMNPQRSTUVWXYZ";
const ITEM_KEY = new RegExp(`^[${ITEM_KEY_CHARS}]{8}$`);

export function isItemKey(value: unknown): value is string {
  return typeof value === "string" && ITEM_KEY.test(value);
}

/** The JSON object in a note's data block, once its version is 1. */
export function readVersionedBlock(
  html: string,
  attribute: string,
): Parsed<Record<string, unknown>> {
  const text = extractDataBlock(html, attribute) ?? versionedPreText(html);
  if (text === null) return { ok: false, reason: "no-data" };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: "bad-json" };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, reason: "bad-shape" };
  }
  const record = data as Record<string, unknown>;
  if (record.version === 1) return { ok: true, value: record };
  return {
    ok: false,
    reason:
      typeof record.version === "number" ? "unknown-version" : "bad-shape",
  };
}

/**
 * Zotero's note editor saves `<pre>` without its attribute, so a note with no
 * attributed block falls back to the first `<pre>` holding a JSON object with
 * its own `version` (any value: the version check comes after).
 */
function versionedPreText(html: string): string | null {
  for (const text of preBlockTexts(html)) {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      continue;
    }
    if (
      data &&
      typeof data === "object" &&
      !Array.isArray(data) &&
      Object.prototype.hasOwnProperty.call(data, "version")
    ) {
      return text;
    }
  }
  return null;
}
