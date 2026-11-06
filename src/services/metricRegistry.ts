import type { CitationGraphNode, MetricID } from "../domain/graphTypes";
import { publicationYearOrNull } from "../domain/valueNormalization";

export type MetricGroup =
  "Core" | "Impact" | "Source" | "Library" | "Bibliography" | "Data quality";

export type MetricValueType =
  "integer" | "decimal" | "percentage" | "boolean" | "days";

export interface MetricDefinition {
  id: MetricID;
  label: string;
  shortLabel?: string;
  group: MetricGroup;
  description: string;
  interpretation?: string;
  valueType: MetricValueType;
  decimals?: number;
  allowsNegative?: boolean;
  column:
    | false
    | {
        primary: boolean;
        defaultVisible: boolean;
        width: number;
      };
  itemPane: "summary" | "advanced" | false;
  graph: {
    axis: boolean;
    logarithmic: boolean;
    nodeSize: boolean;
    nodeColor: boolean;
    filter: boolean;
  };
  value: (node: CitationGraphNode) => number | boolean | null;
}

export interface SupplementaryPropertyDefinition {
  id: string;
  label: string;
  description: string;
  group: MetricGroup;
  column:
    | false
    | {
        primary: boolean;
        defaultVisible: boolean;
        width: number;
      };
  itemPane: "summary" | "advanced" | false;
  graph: {
    nodeColor: boolean;
    filter: boolean;
  };
  value: (node: CitationGraphNode) => string | boolean | null;
  format: (value: string | boolean) => string;
}

const graphAll = {
  axis: true,
  logarithmic: true,
  nodeSize: true,
  nodeColor: true,
  filter: true,
};
const graphLinear = { ...graphAll, logarithmic: false };
/** Shown on a paper, never offered to the graph (W19). */
const graphNone = {
  axis: false,
  logarithmic: false,
  nodeSize: false,
  nodeColor: false,
  filter: false,
};

export const METRIC_DEFINITIONS: MetricDefinition[] = [
  {
    id: "year",
    label: "Publication year",
    group: "Core",
    description: "Publication year stored in the Zotero item.",
    valueType: "integer",
    column: false,
    itemPane: false,
    graph: { ...graphLinear, nodeSize: false },
    value: (node) => publicationYearOrNull(node.year),
  },
  {
    id: "citation-sequence",
    // The id predates the name; saved graphs and defaults store the id.
    label: "Publication order",
    group: "Core",
    description:
      "The graph's papers in publication order, one step apart. On a seeded graph the seed is 0, its references count down and its citers count up.",
    interpretation:
      "One step is one paper, not a fixed span of time. Full dates are used when known; papers with only the same year keep a fixed order.",
    valueType: "integer",
    allowsNegative: true,
    column: false,
    itemPane: false,
    graph: {
      axis: true,
      logarithmic: false,
      nodeSize: false,
      nodeColor: true,
      filter: false,
    },
    value: (node) => node.citationSequence,
  },
  {
    id: "citations",
    label: "Citations",
    group: "Core",
    description: "Number of works known to cite this paper.",
    valueType: "integer",
    column: { primary: true, defaultVisible: true, width: 88 },
    itemPane: "summary",
    graph: graphAll,
    value: (node) => node.citationCount,
  },
  {
    id: "references",
    label: "References",
    group: "Core",
    description: "Number of works known to be referenced by this paper.",
    valueType: "integer",
    column: { primary: true, defaultVisible: true, width: 92 },
    itemPane: "summary",
    graph: graphAll,
    value: (node) => node.referenceCount,
  },
  {
    id: "citation-rate",
    label: "Recent citation rate",
    shortLabel: "Citation rate",
    group: "Impact",
    description:
      "Average citations received per year over the three most recent complete calendar years, or the ones since the paper appeared.",
    valueType: "decimal",
    decimals: 2,
    column: { primary: false, defaultVisible: false, width: 124 },
    itemPane: "advanced",
    graph: graphAll,
    value: (node) => node.citationVelocity,
  },
  {
    id: "fwci",
    label: "FWCI",
    group: "Impact",
    description:
      "Field-Weighted Citation Impact reported by OpenAlex: citations received divided by the expected citations for comparable works. A value of 1 is approximately expected.",
    valueType: "decimal",
    decimals: 2,
    column: { primary: false, defaultVisible: false, width: 78 },
    itemPane: "advanced",
    graph: graphAll,
    value: (node) => node.fwci,
  },
  {
    id: "citation-percentile",
    label: "Citation percentile",
    group: "Impact",
    description:
      "OpenAlex citation percentile among works of the same type, publication year and subfield.",
    valueType: "percentage",
    decimals: 1,
    column: { primary: false, defaultVisible: false, width: 126 },
    itemPane: "advanced",
    // FWCI plots the same comparison and shows how far ahead the outliers are.
    graph: graphNone,
    value: (node) =>
      node.citationPercentile === null
        ? null
        : node.citationPercentile > 1
          ? node.citationPercentile / 100
          : node.citationPercentile,
  },
  {
    id: "influential-citations",
    label: "Highly influential citations",
    group: "Impact",
    description:
      "Number of citing works classified by Semantic Scholar as substantially influenced by this paper. The machine-generated classification is available only where sufficient citing-paper text can be analysed.",
    valueType: "integer",
    column: { primary: false, defaultVisible: false, width: 160 },
    itemPane: "advanced",
    graph: graphAll,
    value: (node) => node.influentialCitationCount,
  },
  {
    id: "library-coverage",
    label: "Connections in library",
    group: "Library",
    description:
      "Number of citation connections between this paper and papers in the current Zotero library. Incoming and outgoing connections are combined.",
    valueType: "integer",
    column: { primary: false, defaultVisible: false, width: 140 },
    itemPane: "advanced",
    graph: graphAll,
    value: (node) =>
      Math.max(
        0,
        node.incomingLibraryCitations + node.outgoingLibraryReferences,
      ),
  },
  {
    id: "reference-coverage",
    label: "Reference coverage",
    group: "Bibliography",
    description:
      "Retrieved structured references divided by the reported bibliography size.",
    valueType: "percentage",
    decimals: 1,
    column: { primary: false, defaultVisible: false, width: 132 },
    itemPane: "advanced",
    // It describes the data, not the paper: whether its References are whole.
    graph: graphNone,
    value: (node) => node.referenceCoverage,
  },
  {
    id: "metadata-completeness",
    label: "Metadata completeness",
    group: "Data quality",
    description:
      "Percentage of six Zotero metadata categories populated: title, creators, publication year, publication source, abstract and at least one external identifier.",
    valueType: "percentage",
    decimals: 0,
    column: { primary: false, defaultVisible: false, width: 150 },
    itemPane: "advanced",
    // For fixing records in the item list, not for reading a graph.
    graph: graphNone,
    value: (node) => node.metadataCompleteness,
  },
];

export const SUPPLEMENTARY_PROPERTY_DEFINITIONS: SupplementaryPropertyDefinition[] =
  [
    {
      id: "openAccessStatus",
      label: "Open Access",
      description:
        "Open-access status reported by scholarly-data providers. Detailed values may include Gold, Diamond, Hybrid, Green, Bronze or Open.",
      group: "Data quality",
      column: { primary: false, defaultVisible: false, width: 104 },
      itemPane: "advanced",
      graph: { nodeColor: true, filter: true },
      value: (node) => node.openAccessStatus ?? node.isOpenAccess,
      format: (value) =>
        typeof value === "boolean"
          ? value
            ? "Open"
            : "Closed"
          : String(value),
    },
    {
      id: "retractionStatus",
      label: "Retracted",
      description:
        "Whether a scholarly-data provider reports that this work has been retracted. Verify critical cases with the publisher.",
      group: "Data quality",
      column: { primary: false, defaultVisible: false, width: 92 },
      itemPane: "advanced",
      graph: { nodeColor: true, filter: true },
      value: (node) => node.isRetracted,
      format: (value) => (value === true ? "Yes" : "No"),
    },
    {
      id: "lastUpdate",
      label: "Last update",
      description:
        "Date and time of the most recent successful general citation-data refresh for this paper.",
      group: "Data quality",
      column: { primary: false, defaultVisible: false, width: 150 },
      itemPane: "advanced",
      graph: { nodeColor: false, filter: false },
      value: (node) => node.metricsUpdatedAt,
      format: (value) =>
        typeof value === "string" && value
          ? new Date(value).toLocaleString()
          : "—",
    },
    {
      id: "matchMethod",
      label: "Match method",
      description:
        "Identifier or metadata field used to match the Zotero item to the external scholarly record.",
      group: "Data quality",
      column: { primary: false, defaultVisible: false, width: 112 },
      itemPane: "advanced",
      graph: { nodeColor: false, filter: false },
      value: (node) => node.matchedBy,
      format: (value) =>
        String(value)
          .replace("arxiv", "arXiv ID")
          .replace("pmid", "PMID")
          .replace("doi", "DOI")
          .replace("isbn", "ISBN")
          .replace("title", "Exact title"),
    },
  ];

const BY_ID = new Map(METRIC_DEFINITIONS.map((metric) => [metric.id, metric]));
export function getMetricDefinition(id: MetricID): MetricDefinition {
  const metric = BY_ID.get(id);
  if (!metric) throw new Error(`Unknown Meristema metric: ${id}`);
  return metric;
}

export function metricValue(
  node: CitationGraphNode,
  id: MetricID,
): number | boolean | null {
  return getMetricDefinition(id).value(node);
}

export function formatMetricValue(
  id: MetricID,
  value: number | boolean | null,
): string {
  if (value === null || value === undefined) return "—";
  const definition = getMetricDefinition(id);
  if (definition.valueType === "boolean") return value ? "Yes" : "No";
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (definition.valueType === "percentage") {
    return new Intl.NumberFormat(undefined, {
      style: "percent",
      useGrouping: false,
      maximumFractionDigits: definition.decimals ?? 1,
    }).format(value);
  }
  if (definition.valueType === "days") {
    return `${new Intl.NumberFormat(undefined, { useGrouping: false, maximumFractionDigits: 0 }).format(value)} d`;
  }
  const formatted = new Intl.NumberFormat(undefined, {
    useGrouping: false,
    maximumFractionDigits:
      definition.valueType === "integer" ? 0 : (definition.decimals ?? 2),
  }).format(value);
  return id === "citation-sequence" && value > 0 ? `+${formatted}` : formatted;
}

export function metricTooltip(id: MetricID): string {
  const metric = getMetricDefinition(id);
  return [metric.description, metric.interpretation].filter(Boolean).join("\n");
}

export function axisMetricDefinitions(): MetricDefinition[] {
  return METRIC_DEFINITIONS.filter((metric) => metric.graph.axis);
}
export function nodeSizeMetricDefinitions(): MetricDefinition[] {
  return METRIC_DEFINITIONS.filter((metric) => metric.graph.nodeSize);
}
export function nodeColorMetricDefinitions(): MetricDefinition[] {
  return METRIC_DEFINITIONS.filter((metric) => metric.graph.nodeColor);
}
