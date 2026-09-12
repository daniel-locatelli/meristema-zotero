import type {
  CitationGraphNode,
  GraphAxisMetric,
  GraphLayoutOptions,
  GraphNodeColorMetric,
  GraphNodeSizeMetric,
  MetricID,
} from "../domain/graphTypes";
import {
  axisMetricDefinitions,
  getMetricDefinition,
  metricValue,
  nodeColorMetricDefinitions,
  nodeSizeMetricDefinitions,
} from "./metricRegistry";

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

const NON_METRIC_COLOURS = new Set<string>([
  "uniform",
  "publication-type",
  "provider",
  "open-access",
  "retraction",
]);

function firstAvailable<T extends string>(
  nodes: readonly CitationGraphNode[],
  requested: T,
  candidates: readonly { id: MetricID }[],
  passthrough: (value: T) => boolean,
): T {
  if (passthrough(requested)) return requested;
  if (metricHasData(nodes, requested as MetricID)) return requested;
  const fallback = candidates.find((c) => metricHasData(nodes, c.id));
  return (fallback?.id ?? requested) as T;
}

/**
 * What the gear would land on if asked for `layout` on this graph: a metric
 * with no data becomes the first that has some, a scale goes linear where
 * the metric is not logarithmic, and a free axis is always linear.
 */
export function normaliseLayoutFor(
  nodes: readonly CitationGraphNode[],
  layout: GraphLayoutOptions,
): GraphLayoutOptions {
  const axes = axisMetricDefinitions();
  const xMetric = firstAvailable<GraphAxisMetric>(
    nodes,
    layout.xMetric,
    axes,
    (v) => v === "free",
  );
  const yMetric = firstAvailable<GraphAxisMetric>(
    nodes,
    layout.yMetric,
    axes,
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
      nodeSizeMetricDefinitions(),
      (v) => v === "uniform",
    ),
    nodeColorMetric: firstAvailable<GraphNodeColorMetric>(
      nodes,
      layout.nodeColorMetric,
      nodeColorMetricDefinitions().filter((c) => !NON_METRIC_COLOURS.has(c.id)),
      (v) => NON_METRIC_COLOURS.has(v),
    ),
    nodeLabelMode: layout.nodeLabelMode,
  };
}
