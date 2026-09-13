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
  // A seeded graph's sequence is a map on the renderer, computed after the
  // appearance controls are created (ADR 0008), so the option stays
  // selectable even when the library graph has no precise publication dates.
  if (metric === "citation-sequence") return true;
  return nodes.some((node) => {
    const value = metricValue(node, metric);
    return typeof value === "number" && Number.isFinite(value);
  });
}

/**
 * Whether the gear would offer this colour option: "uniform" always is, each
 * categorical value (publication type, provider, open access, retraction)
 * needs at least one node carrying that field (mirrored verbatim from the
 * gear's `categoricalDefinitions` in graphViewControls.ts so the two cannot
 * drift), and any other value is a metric checked by `metricHasData`.
 */
export function colourOptionHasData(
  nodes: readonly CitationGraphNode[],
  colour: GraphNodeColorMetric,
): boolean {
  switch (colour) {
    case "uniform":
      return true;
    case "publication-type":
      return nodes.some((node) => Boolean(node.publicationType));
    case "provider":
      return nodes.some((node) => Boolean(node.provider));
    case "open-access":
      return nodes.some(
        (node) => node.isOpenAccess !== null || Boolean(node.openAccessStatus),
      );
    case "retraction":
      return nodes.some((node) => node.isRetracted !== null);
    case "citation-hop":
      return true;
    default:
      return metricHasData(nodes, colour);
  }
}

function firstAvailable<T extends string>(
  requested: T,
  fallback: T,
  isAvailable: (value: T) => boolean,
): T {
  return isAvailable(requested) ? requested : fallback;
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
    layout.xMetric,
    "free",
    (v) => v === "free" || metricHasData(nodes, v),
  );
  const yMetric = firstAvailable<GraphAxisMetric>(
    layout.yMetric,
    "free",
    (v) => v === "free" || metricHasData(nodes, v),
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
      layout.nodeSizeMetric,
      "uniform",
      (v) => v === "uniform" || metricHasData(nodes, v),
    ),
    nodeColorMetric: firstAvailable<GraphNodeColorMetric>(
      layout.nodeColorMetric,
      "uniform",
      (v) => colourOptionHasData(nodes, v),
    ),
    nodeLabelMode: layout.nodeLabelMode,
  };
}
