import type {
  CitationGraphNode,
  GraphAxisMetric,
  GraphLayoutOptions,
  GraphNodeColorMetric,
  GraphNodeSizeMetric,
  MetricID,
} from "../domain/graphTypes";
import { getMetricDefinition, metricValue } from "./metricRegistry";

/**
 * The gear's selects list only metrics with data in the loaded nodes, and a
 * view is applied and compared by the same rule (spec, "Metrics the graph
 * cannot show"), so the rule lives here once.
 */
export function metricHasData(
  nodes: readonly CitationGraphNode[],
  metric: MetricID,
): boolean {
  // Focus projections derive this metric after the appearance controls are
  // created, so it must remain selectable even when the initial library graph
  // has no precise publication dates.
  if (metric === "citation-sequence") return true;
  return nodes.some((node) => {
    const value = metricValue(node, metric);
    return typeof value === "number" && Number.isFinite(value);
  });
}

function firstAvailable<T extends string>(
  nodes: readonly CitationGraphNode[],
  requested: T,
  fallback: T,
  passthrough: (value: T) => boolean,
): T {
  if (passthrough(requested)) return requested;
  if (metricHasData(nodes, requested as MetricID)) return requested;
  return fallback;
}

/**
 * What the gear would land on if asked for `layout` on this graph: a metric
 * with no data becomes Free on an axis and Uniform for size and colour, as
 * the gear's selects do (they fall back to the first non-disabled option,
 * which is Free or Uniform, not the first metric with data); a scale goes
 * linear where the metric is not logarithmic, and a free axis is always
 * linear.
 */
export function normaliseLayoutFor(
  nodes: readonly CitationGraphNode[],
  layout: GraphLayoutOptions,
): GraphLayoutOptions {
  const xMetric = firstAvailable<GraphAxisMetric>(
    nodes,
    layout.xMetric,
    "free",
    (v) => v === "free",
  );
  const yMetric = firstAvailable<GraphAxisMetric>(
    nodes,
    layout.yMetric,
    "free",
    (v) => v === "free",
  );
  const scaleFor = (
    metric: GraphAxisMetric,
    scale: GraphLayoutOptions["xScale"],
  ): GraphLayoutOptions["xScale"] =>
    metric !== "free" &&
    scale === "log" &&
    getMetricDefinition(metric).graph.logarithmic
      ? "log"
      : "linear";
  return {
    xMetric,
    xScale: scaleFor(xMetric, layout.xScale),
    yMetric,
    yScale: scaleFor(yMetric, layout.yScale),
    nodeSizeMetric: firstAvailable<GraphNodeSizeMetric>(
      nodes,
      layout.nodeSizeMetric,
      "uniform",
      (v) => v === "uniform",
    ),
    nodeColorMetric: firstAvailable<GraphNodeColorMetric>(
      nodes,
      layout.nodeColorMetric,
      "uniform",
      (v) =>
        v === "uniform" ||
        v === "publication-type" ||
        v === "provider" ||
        v === "open-access" ||
        v === "retraction",
    ),
    nodeLabelMode: layout.nodeLabelMode,
  };
}
