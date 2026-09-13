/**
 * The hop model: a breadth-first walk from the seeds over the stored citation
 * lists in one direction. Pure and DOM-free. It never fetches; the runner in
 * graphViewService.ts fills the lists it reads (spec, "The hop model").
 */
import type {
  CitationGraphEdge,
  CitationGraphNode,
} from "../domain/graphTypes";
import { assignFocusCitationSequence } from "./citationSequenceService";

export type HopDirection = "cited-by" | "references";

export const MAX_HOP_DEPTH = 6;

export interface HopEntry {
  key: string;
  /** 0 for seeds, 1..depth otherwise. */
  hop: number;
  /** Every paper one hop shallower that links here. */
  parents: string[];
  /**
   * Its own list in this direction is stored.
   *
   * Only meaningful below the walk's depth. At `hop === depth` the walk never
   * asks — reading a leaf's list is the expensive part of a deep fill and no
   * consumer needs the answer there: `planHopFill` skips `hop >= depth`
   * (graphHopFillModel.ts) and `drainExpandedFitSeeds` reads seeds, which are
   * always hop 0 (graphViewService.ts). So `false` at the depth means "not
   * asked", not "no stored list".
   */
  expanded: boolean;
}

export interface HopNeighbour {
  /** The library's own node, or an external node built from the stored work. */
  node: CitationGraphNode;
  provenance: string;
}

export interface HopNeighbourhood {
  /** A stored summary exists for this paper in this direction. */
  expanded: boolean;
  neighbours: readonly HopNeighbour[];
}

export type HopNeighbourLookup = (
  key: string,
  direction: HopDirection,
) => HopNeighbourhood;

export interface GraphHopModel {
  direction: HopDirection;
  depth: number;
  seeds: CitationGraphNode[];
  seedKeys: Set<string>;
  entries: Map<string, HopEntry>;
  /** Every paper reached, seeds first, each once. */
  nodes: CitationGraphNode[];
  /** One edge per parent link, citer → cited. */
  edges: CitationGraphEdge[];
  externalKeys: Set<string>;
  /** Papers reached at each hop; index 0 is the seeds. Length depth + 1. */
  availableByHop: number[];
}

export interface GraphHopInput {
  seeds: readonly CitationGraphNode[];
  direction: HopDirection;
  depth: number;
  neighbours: HopNeighbourLookup;
  /** Library edges between seeds, kept as they are. */
  seedEdges?: readonly CitationGraphEdge[];
}

export function clampHopDepth(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.min(MAX_HOP_DEPTH, Math.max(1, Math.floor(value)));
}

function hopEdge(
  source: string,
  target: string,
  provenance: string,
): CitationGraphEdge {
  return {
    key: `${source}>${target}:hop`,
    source,
    target,
    provenance,
    manual: false,
  };
}

function cloneNode(
  node: CitationGraphNode,
  role: CitationGraphNode["focusRole"],
  hop: number,
): CitationGraphNode {
  return {
    ...node,
    kind: node.kind ?? "local",
    focusRole: role,
    hop,
    authors: [...node.authors],
    tags: [...node.tags],
    collectionIDs: [...node.collectionIDs],
    references: [...node.references],
    externalWork: node.externalWork
      ? { ...node.externalWork, authors: [...node.externalWork.authors] }
      : null,
  };
}

export function buildGraphHopModel(input: GraphHopInput): GraphHopModel | null {
  const depth = clampHopDepth(input.depth);
  const seeds = [
    ...new Map(input.seeds.map((seed) => [seed.key, seed])).values(),
  ].map((seed) => cloneNode(seed, "seed", 0));
  if (!seeds.length) return null;
  const seedKeys = new Set(seeds.map((seed) => seed.key));
  const role = input.direction === "references" ? "reference" : "cited-by";

  /**
   * One lookup per key per walk. A non-leaf key used to be read twice — once
   * for its entry's `expanded`, once as a frontier parent — and each read is a
   * store lookup and a fragment clone.
   */
  const neighbourhoods = new Map<string, HopNeighbourhood>();
  const neighbourhoodOf = (key: string): HopNeighbourhood => {
    const memo = neighbourhoods.get(key);
    if (memo) return memo;
    const fresh = input.neighbours(key, input.direction);
    neighbourhoods.set(key, fresh);
    return fresh;
  };

  const entries = new Map<string, HopEntry>();
  const nodes = new Map<string, CitationGraphNode>();
  const edges = new Map<string, CitationGraphEdge>();
  for (const edge of input.seedEdges ?? []) {
    if (seedKeys.has(edge.source) && seedKeys.has(edge.target)) {
      edges.set(edge.key, { ...edge });
    }
  }
  for (const seed of seeds) {
    nodes.set(seed.key, seed);
    entries.set(seed.key, {
      key: seed.key,
      hop: 0,
      parents: [],
      expanded: neighbourhoodOf(seed.key).expanded,
    });
  }

  let frontier = seeds.map((seed) => seed.key);
  for (let hop = 1; hop <= depth && frontier.length; hop += 1) {
    const next: string[] = [];
    for (const parentKey of frontier) {
      const neighbourhood = neighbourhoodOf(parentKey);
      for (const neighbour of neighbourhood.neighbours) {
        const key = neighbour.node.key;
        if (key === parentKey) continue;
        const edge =
          input.direction === "references"
            ? hopEdge(parentKey, key, neighbour.provenance)
            : hopEdge(key, parentKey, neighbour.provenance);
        if (!edges.has(edge.key)) edges.set(edge.key, edge);
        const existing = entries.get(key);
        if (existing) {
          // A seed is never reassigned; a paper keeps its shallowest hop and
          // gains the parent.
          if (!existing.parents.includes(parentKey)) {
            existing.parents.push(parentKey);
          }
          continue;
        }
        entries.set(key, {
          key,
          hop,
          parents: [parentKey],
          // At the depth this paper is a leaf: nobody reads its `expanded`,
          // and asking would read every leaf's list (see HopEntry.expanded).
          expanded: hop < depth ? neighbourhoodOf(key).expanded : false,
        });
        nodes.set(key, cloneNode(neighbour.node, role, hop));
        next.push(key);
      }
    }
    frontier = next;
  }

  const availableByHop = Array.from({ length: depth + 1 }, () => 0);
  for (const entry of entries.values()) availableByHop[entry.hop] += 1;

  const projectedNodes = [...nodes.values()];
  const projectedEdges = [...edges.values()];
  assignFocusCitationSequence(projectedNodes, projectedEdges, seeds[0].key);
  return {
    direction: input.direction,
    depth,
    seeds,
    seedKeys,
    entries,
    nodes: projectedNodes,
    edges: projectedEdges,
    externalKeys: new Set(
      projectedNodes
        .filter((node) => node.kind === "external")
        .map((node) => node.key),
    ),
    availableByHop,
  };
}

/** The hop of every paper the model reached, for the renderer and the Key. */
export function hopByKey(model: GraphHopModel): Map<string, number> {
  return new Map(
    [...model.entries.values()].map((entry) => [entry.key, entry.hop]),
  );
}

/**
 * Every paper whose chain of parents leads back to this seed. The rail's seed
 * row emphasises these.
 */
export function reachedFromSeed(
  model: GraphHopModel,
  seedKey: string,
): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const entry of model.entries.values()) {
    for (const parent of entry.parents) {
      const list = childrenOf.get(parent) ?? [];
      list.push(entry.key);
      childrenOf.set(parent, list);
    }
  }
  const reached = new Set<string>();
  const stack = [...(childrenOf.get(seedKey) ?? [])];
  while (stack.length) {
    const key = stack.pop()!;
    if (reached.has(key) || model.seedKeys.has(key)) continue;
    reached.add(key);
    stack.push(...(childrenOf.get(key) ?? []));
  }
  return reached;
}
