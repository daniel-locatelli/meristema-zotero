import type { GraphNodeColorMetric } from "./graphTypes";

/**
 * Metrics the graph no longer offers (W19), each with the metric a stored
 * appearance that named it reads instead. Saved graphs, views and defaults
 * keep the old id, so they keep opening.
 */
const RETIRED_METRICS = new Map<string, GraphNodeColorMetric>([
  // Last year's count alone; the three-year mean answers the same question.
  ["citations-last-year", "citation-rate"],
  // Two noisy years, and it scales with a paper's size.
  ["citation-acceleration", "citation-rate"],
  // Still on a paper's sidebar, but FWCI plots the same comparison.
  ["citation-percentile", "fwci"],
  // The journal's, not the paper's, and nothing replaces them.
  ["journal-h-index", "citations"],
  ["journal-i10-index", "citations"],
  ["two-year-mean-citedness", "citations"],
  // Still on a paper's sidebar; it describes the data, not the paper.
  ["reference-coverage", "references"],
  // Partial references and one old citation skew them.
  ["reference-age-mean", "year"],
  ["reference-age-spread", "year"],
  // Surnames alone matched different authors.
  ["self-citation-estimate", "references"],
  // Still a column and on a paper's sidebar; it describes the record.
  ["metadata-completeness", "citations"],
  // A colouring: the plot rings and labels a retracted paper under any.
  ["retraction", "uniform"],
]);

const METRIC_FIELDS = [
  "xMetric",
  "yMetric",
  "nodeSizeMetric",
  "nodeColorMetric",
] as const;

/** A stored appearance with each retired metric read as its replacement. */
export function withCurrentMetrics<T extends object>(appearance: T): T {
  const record = appearance as Record<string, unknown>;
  let current: Record<string, unknown> | null = null;
  for (const field of METRIC_FIELDS) {
    const value = record[field];
    const replacement =
      typeof value === "string" ? RETIRED_METRICS.get(value) : undefined;
    if (replacement === undefined) continue;
    current ??= { ...record };
    current[field] = replacement;
  }
  return (current ?? appearance) as T;
}
