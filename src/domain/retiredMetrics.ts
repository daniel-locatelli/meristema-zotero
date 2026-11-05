import type { MetricID } from "./graphTypes";

/**
 * Metrics removed from the registry (W19), each with the metric a stored
 * appearance that named it reads instead. Saved graphs, views and defaults
 * keep the old id, so they keep opening.
 */
const RETIRED_METRICS = new Map<string, MetricID>([
  // Last year's count alone; the three-year mean answers the same question.
  ["citations-last-year", "citation-rate"],
  // Two noisy years, and it scales with a paper's size.
  ["citation-acceleration", "citation-rate"],
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
