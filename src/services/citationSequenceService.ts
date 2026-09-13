import type {
  CitationGraphEdge,
  CitationGraphNode,
} from "../domain/graphTypes";
import { publicationYearOrNull } from "../domain/valueNormalization";

interface PublicationOrder {
  value: number;
  precision: "day" | "month" | "year";
}

/**
 * Convert Zotero/provider dates into a sortable UTC value without inventing
 * day-level precision. Year-only dates use the middle of the year and
 * month-only dates use the middle of the month.
 */
export function publicationOrder(
  publicationDate: string | null | undefined,
  fallbackYear: number | null | undefined,
): PublicationOrder | null {
  const text = String(publicationDate ?? "").trim();
  const isoDay = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\D|$)/);
  if (isoDay) {
    const year = publicationYearOrNull(isoDay[1]);
    const month = Number(isoDay[2]);
    const day = Number(isoDay[3]);
    if (year !== null && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return { value: Date.UTC(year, month - 1, day), precision: "day" };
    }
  }

  const isoMonth = text.match(/^(\d{4})-(\d{1,2})(?:\D|$)/);
  if (isoMonth) {
    const year = publicationYearOrNull(isoMonth[1]);
    const month = Number(isoMonth[2]);
    if (year !== null && month >= 1 && month <= 12) {
      return { value: Date.UTC(year, month - 1, 15), precision: "month" };
    }
  }

  if (text && !/^\d{4}$/.test(text)) {
    const parsed = Date.parse(text);
    if (Number.isFinite(parsed)) {
      return { value: parsed, precision: "day" };
    }
  }

  const yearFromText = publicationYearOrNull(
    text.match(/\b(1[5-9]\d{2}|20\d{2}|21\d{2})\b/)?.[1],
  );
  const year = yearFromText ?? publicationYearOrNull(fallbackYear);
  return year === null
    ? null
    : { value: Date.UTC(year, 6, 1), precision: "year" };
}

function nodeOrder(node: CitationGraphNode): PublicationOrder | null {
  return publicationOrder(node.publicationDate, node.year);
}

function stableCompare(
  left: CitationGraphNode,
  right: CitationGraphNode,
): number {
  return (
    left.title.localeCompare(right.title, undefined, {
      sensitivity: "base",
    }) || left.key.localeCompare(right.key)
  );
}

function compareChronologically(
  left: CitationGraphNode,
  right: CitationGraphNode,
  ascending: boolean,
): number {
  const leftOrder = nodeOrder(left);
  const rightOrder = nodeOrder(right);
  if (leftOrder && rightOrder && leftOrder.value !== rightOrder.value) {
    return ascending
      ? leftOrder.value - rightOrder.value
      : rightOrder.value - leftOrder.value;
  }
  if (leftOrder && !rightOrder) return -1;
  if (!leftOrder && rightOrder) return 1;
  return stableCompare(left, right);
}

/**
 * Assign a graph-wide ordinal publication sequence. The earliest known paper
 * is 0, then 1, 2, and so on. This is intentionally ordinal: equal physical
 * spacing means one publication step, not a fixed amount of elapsed time.
 */
export function assignGraphCitationSequence(nodes: CitationGraphNode[]): void {
  for (const node of nodes) node.citationSequence = null;
  const ordered = nodes
    .filter((node) => nodeOrder(node) !== null)
    .sort((left, right) => compareChronologically(left, right, true));
  ordered.forEach((node, index) => {
    node.citationSequence = index;
  });
}

function relationToAnchor(
  key: string,
  anchorKey: string,
  edges: readonly CitationGraphEdge[],
): "reference" | "cited-by" | null {
  const anchorReferencesNode = edges.some(
    (edge) => edge.source === anchorKey && edge.target === key,
  );
  const nodeReferencesAnchor = edges.some(
    (edge) => edge.source === key && edge.target === anchorKey,
  );
  if (anchorReferencesNode && !nodeReferencesAnchor) return "reference";
  if (nodeReferencesAnchor && !anchorReferencesNode) return "cited-by";
  return null;
}

export type CitationSide = "reference" | "cited-by";

/**
 * The seed-relative citation sequence of a seeded graph, as a map (ADR 0008):
 * the primary seed is 0, its references are -1, -2, ... from newest to
 * oldest, citing papers are +1, +2, ... from earliest to latest. A paper with
 * no direct link to the seed takes the side `sideOf` reports (the walk's
 * direction for a paper it reached) and otherwise the side its date puts it
 * on, so a folder paper the walk never reached still has a position. Without
 * the anchor the map is the graph-wide ordinal. Every node is named.
 */
export function seedRelativeCitationSequence(
  nodes: readonly CitationGraphNode[],
  edges: readonly CitationGraphEdge[],
  primarySeedKey: string,
  sideOf: (key: string) => CitationSide | null,
): Map<string, number> {
  const sequence = new Map<string, number>();
  const anchor = nodes.find((node) => node.key === primarySeedKey);
  if (!anchor) {
    const ordered = nodes
      .filter((node) => nodeOrder(node) !== null)
      .sort((left, right) => compareChronologically(left, right, true));
    ordered.forEach((node, index) => sequence.set(node.key, index));
    return sequence;
  }
  sequence.set(anchor.key, 0);
  const anchorOrder = nodeOrder(anchor);
  const references: CitationGraphNode[] = [];
  const citedBy: CitationGraphNode[] = [];

  for (const node of nodes) {
    if (node.key === primarySeedKey) continue;
    const side =
      relationToAnchor(node.key, primarySeedKey, edges) ?? sideOf(node.key);
    if (side === "reference") {
      references.push(node);
      continue;
    }
    if (side === "cited-by") {
      citedBy.push(node);
      continue;
    }
    const order = nodeOrder(node);
    if (anchorOrder && order && order.value < anchorOrder.value) {
      references.push(node);
    } else {
      citedBy.push(node);
    }
  }

  references
    .sort((left, right) => compareChronologically(left, right, false))
    .forEach((node, index) => sequence.set(node.key, -(index + 1)));
  citedBy
    .sort((left, right) => compareChronologically(left, right, true))
    .forEach((node, index) => sequence.set(node.key, index + 1));
  return sequence;
}

/**
 * Stamp the seed-relative sequence on the nodes themselves, reading a paper's
 * side off its `focusRole`. Kept for callers that own their node objects; the
 * plot reads the map form through the renderer instead.
 */
export function assignFocusCitationSequence(
  nodes: CitationGraphNode[],
  edges: CitationGraphEdge[],
  primarySeedKey: string,
): void {
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  const sequence = seedRelativeCitationSequence(
    nodes,
    edges,
    primarySeedKey,
    (key) => {
      const role = byKey.get(key)?.focusRole;
      return role === "reference" || role === "cited-by" ? role : null;
    },
  );
  for (const node of nodes)
    node.citationSequence = sequence.get(node.key) ?? null;
}
