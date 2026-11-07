import {
  ITEM_KEY_CHARS,
  readVersionedBlock,
  type LibraryLink,
  type Parsed,
} from "./common";
import { normalizeDOI } from "./doi";
import { dataBlock } from "./html";

export const READ_STATE_TAG = "meristema-reading-state";
export const READ_STATE_ATTRIBUTE = "meristema-reading-state";

export type ReadState = "unread" | "reading" | "read";

export interface ReadStateEntry {
  state: ReadState;
  at: string;
}

export interface ReadStateDoc {
  version: 1;
  states: Record<string, ReadStateEntry>;
}

export interface PaperRef {
  doi: string | null;
  library: LibraryLink;
  key: string;
}

/** Tags mirrored onto papers for Zotero apps without plugins; Unread has none. */
export const MIRROR_TAGS = { reading: "_reading", read: "_read" } as const;

const RANK: Record<ReadState, number> = { unread: 0, reading: 1, read: 2 };
const KEY_ID = new RegExp(`^(?:user|group-\\d+):[${ITEM_KEY_CHARS}]{8}$`);

export function paperId(ref: PaperRef): string {
  const doi = normalizeDOI(ref.doi);
  if (doi) return `doi:${doi}`;
  return ref.library.kind === "user"
    ? `user:${ref.key}`
    : `group-${ref.library.id}:${ref.key}`;
}

/** `doi:` and a DOI already in normalised form, or a library and item key. */
export function isPaperId(value: string): boolean {
  if (value.startsWith("doi:")) {
    const doi = value.slice(4);
    return normalizeDOI(doi) === doi;
  }
  return KEY_ID.test(value);
}

export function emptyReadState(): ReadStateDoc {
  return { version: 1, states: {} };
}

function isReadState(value: unknown): value is ReadState {
  return value === "unread" || value === "reading" || value === "read";
}

/** ISO 8601 date and time with a zone: the only `at` the formats accept. */
const AT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?:Z|([+-])(\d{2}):(\d{2}))$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * The instant `at` names, in milliseconds since the epoch, or null when it is
 * off the grammar or no real calendar time. Computed here, never by the
 * engine's `Date.parse`: the fraction is cut to its first three digits, and
 * 24:00, a leap second or an impossible day is no time at all.
 */
function instantOf(at: unknown): number | null {
  if (typeof at !== "string") return null;
  const m = AT.exec(at);
  if (!m) return null;
  const [year, month, day, hour, minute, second] = m
    .slice(1, 7)
    .map((part) => Number(part));
  const offsetHours = m[9] === undefined ? 0 : Number(m[9]);
  const offsetMinutes = m[10] === undefined ? 0 : Number(m[10]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (offsetHours > 23 || offsetMinutes > 59) return null;
  const millis = Number((m[7] ?? "").padEnd(3, "0").slice(0, 3));
  const offset = (offsetHours * 60 + offsetMinutes) * 60000;
  const utc = new Date(0);
  utc.setUTCFullYear(year, month - 1, day);
  utc.setUTCHours(hour, minute, second, millis);
  return utc.getTime() - (m[8] === "-" ? -offset : offset);
}

function isValidAt(at: unknown): at is string {
  return instantOf(at) !== null;
}

export function parseReadState(html: string): Parsed<ReadStateDoc> {
  const block = readVersionedBlock(html, READ_STATE_ATTRIBUTE);
  if (!block.ok) return block;
  const raw = block.value.states;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "bad-shape" };
  }
  const states: Record<string, ReadStateEntry> = {};
  for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!isPaperId(id) || !entry || typeof entry !== "object") continue;
    const { state, at } = entry as Record<string, unknown>;
    if (!isReadState(state)) continue;
    if (!isValidAt(at)) continue;
    states[id] = { state, at };
  }
  return { ok: true, value: { version: 1, states } };
}

export function stateOf(doc: ReadStateDoc, id: string): ReadState {
  return Object.hasOwn(doc.states, id) ? doc.states[id].state : "unread";
}

export function setState(
  doc: ReadStateDoc,
  id: string,
  state: ReadState,
  at: string,
): ReadStateDoc {
  if (!isPaperId(id)) throw new RangeError(`Not a paper id: ${id}`);
  if (!isValidAt(at)) throw new RangeError(`Unparsable read-state date: ${at}`);
  return { version: 1, states: { ...doc.states, [id]: { state, at } } };
}

function later(a: ReadStateEntry, b: ReadStateEntry): ReadStateEntry {
  const ta = instantOf(a.at);
  const tb = instantOf(b.at);
  if ((ta === null) !== (tb === null)) return ta !== null ? a : b;
  if (ta !== null && tb !== null && ta !== tb) return ta > tb ? a : b;
  if (RANK[a.state] !== RANK[b.state]) {
    return RANK[a.state] > RANK[b.state] ? a : b;
  }
  return a.at >= b.at ? a : b;
}

export function mergeReadStates(
  a: ReadStateDoc,
  b: ReadStateDoc,
): ReadStateDoc {
  const states: Record<string, ReadStateEntry> = { ...a.states };
  for (const [id, entry] of Object.entries(b.states)) {
    states[id] = Object.hasOwn(states, id) ? later(states[id], entry) : entry;
  }
  return { version: 1, states };
}

export function nextUp(
  steps: readonly { key: string }[],
  stateOfKey: (key: string) => ReadState,
): string | null {
  return (
    steps.find((step) => stateOfKey(step.key) === "reading")?.key ??
    steps.find((step) => stateOfKey(step.key) === "unread")?.key ??
    null
  );
}

export function mirrorTag(state: ReadState): string | null {
  return state === "unread" ? null : MIRROR_TAGS[state];
}

/** The whole note, with ids sorted so equal states write equal notes. */
export function writeReadState(doc: ReadStateDoc): string {
  const ids = Object.keys(doc.states).sort();
  const states = Object.fromEntries(
    ids.map((id) => [
      id,
      { state: doc.states[id].state, at: doc.states[id].at },
    ]),
  );
  const count = (state: ReadState) =>
    ids.filter((id) => doc.states[id].state === state).length;
  return (
    `<h1>Reading state</h1>` +
    `<p>${count("reading")} reading, ${count("read")} read. Kept by Meristema Reading.</p>` +
    `<p>Plugin data (do not edit)</p>` +
    dataBlock(READ_STATE_ATTRIBUTE, JSON.stringify({ version: 1, states }))
  );
}
