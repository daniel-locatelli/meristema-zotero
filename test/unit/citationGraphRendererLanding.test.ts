import { describe, it } from "node:test";
import { expect } from "chai";
import { CitationGraphRenderer } from "../../src/services/citationGraphRenderer";
import type { CitationGraphNode } from "../../src/domain/graphTypes";
import { WORLD_PLOT } from "../../src/services/graphFloor";
import {
  attachView,
  FakeCanvas,
  FREE_LAYOUT,
  model,
  node,
} from "./graphRendererDoubles";

/**
 * What a landing does to the nodes already drawn (B47). During a fill papers
 * land one at a time; each landing used to restart the overlap relaxation from
 * the anchors and recompute the axis domain from every node, so one paper
 * landing in a crowd moved the whole crowd, and a new maximum moved almost
 * every node. A landing now moves only the neighbours it overlaps, each node
 * stays within a value-sized distance of its anchor, and the domain only grows
 * while the fill runs.
 */
describe("CitationGraphRenderer landing", function () {
  function placed(
    nodes: CitationGraphNode[],
    layout: Partial<typeof FREE_LAYOUT> = {},
  ): {
    renderer: CitationGraphRenderer;
    nodes: CitationGraphNode[];
  } {
    const canvas = new FakeCanvas();
    const graph = model(nodes);
    const renderer = new CitationGraphRenderer({
      canvas: canvas as unknown as HTMLCanvasElement,
      model: graph,
      layout: {
        ...FREE_LAYOUT,
        xMetric: "year",
        yMetric: "citations",
        ...layout,
      },
      collectionLabels: new Map(),
      onSelectionChange: () => undefined,
      onOpenNode: () => undefined,
    });
    attachView(canvas);
    return { renderer, nodes: graph.nodes };
  }

  function snapshot(
    renderer: CitationGraphRenderer,
    keys: string[],
  ): Map<string, { x: number; y: number }> {
    return new Map(keys.map((key) => [key, { ...renderer.positionOf(key)! }]));
  }

  function moves(
    renderer: CitationGraphRenderer,
    before: Map<string, { x: number; y: number }>,
  ): Map<string, number> {
    return new Map(
      [...before].map(([key, position]) => {
        const after = renderer.positionOf(key)!;
        return [key, Math.hypot(after.x - position.x, after.y - position.y)];
      }),
    );
  }

  /** A crowd of 40 around 2020 and 10 citations, and ten far older papers. */
  function crowdAndFar(): CitationGraphNode[] {
    const crowd = Array.from({ length: 40 }, (_value, index) =>
      node(`crowd${index}`, {
        year: 2019 + (index % 3),
        citationCount: 6 + (index % 9),
      }),
    );
    const far = Array.from({ length: 10 }, (_value, index) =>
      node(`far${index}`, {
        year: 1990 + index,
        citationCount: 800 + index * 40,
      }),
    );
    return [node("top", { year: 1985, citationCount: 1200 }), ...far, ...crowd];
  }

  it("moves only a landing's neighbours, and those a little", function () {
    const { renderer, nodes } = placed(crowdAndFar());
    renderer.setFillActive(true);
    const keys = nodes.map((paper) => paper.key);
    const before = snapshot(renderer, keys);
    nodes.push(node("landed", { year: 2020, citationCount: 10 }));
    renderer.syncModel();
    const moved = moves(renderer, before);
    const far = keys.filter((key) => !key.startsWith("crowd"));
    const crowd = keys.filter((key) => key.startsWith("crowd"));
    const farMove = Math.max(...far.map((key) => moved.get(key)!));
    const crowdMove = Math.max(...crowd.map((key) => moved.get(key)!));
    const crowdMoved = crowd.filter((key) => moved.get(key)! > 0.5).length;
    const evidence = `far max ${farMove.toFixed(2)}, crowd max ${crowdMove.toFixed(2)}, crowd moved >0.5: ${crowdMoved}/40`;
    expect(farMove, evidence).to.equal(0);
    expect(crowdMove, evidence).to.be.below(20);
    expect(crowdMoved, evidence).to.be.below(20);
  });

  it("keeps a node within half a year of its anchor on a year axis", function () {
    const { renderer, nodes } = placed(crowdAndFar());
    const domain = renderer.axisScale(nodes, "x")!.domain;
    const perYear =
      (WORLD_PLOT.right - WORLD_PLOT.left) / (domain[1] - domain[0]);
    const worst = Math.max(
      ...nodes.map((paper) => {
        const anchor = WORLD_PLOT.left + (paper.year! - domain[0]) * perYear;
        return Math.abs(renderer.positionOf(paper.key)!.x - anchor) / perYear;
      }),
    );
    expect(worst, `worst displacement ${worst.toFixed(3)} years`).to.be.at.most(
      0.5 + 1e-9,
    );
  });

  it("keeps a node within a fraction of a tick of its anchor on a count axis", function () {
    const { renderer, nodes } = placed(crowdAndFar());
    const scale = renderer.axisScale(nodes, "y")!;
    const span = WORLD_PLOT.bottom - WORLD_PLOT.top;
    const perCitation = span / (scale.domain[1] - scale.domain[0]);
    // 0..1200 runs in steps of 200, so a tick is 200 citations.
    const tick = 200 * perCitation;
    const worst = Math.max(
      ...nodes.map((paper) => {
        const anchor =
          WORLD_PLOT.bottom -
          (paper.citationCount! - scale.domain[0]) * perCitation;
        return Math.abs(renderer.positionOf(paper.key)!.y - anchor) / tick;
      }),
    );
    expect(worst, `worst displacement ${worst.toFixed(3)} ticks`).to.be.at.most(
      0.25 + 1e-9,
    );
  });

  it("holds the domain grow-only while a fill runs and settles it at rest", function () {
    const { renderer, nodes } = placed(crowdAndFar());
    const domain = (): [number, number] =>
      renderer.axisScale(nodes, "y")!.domain;
    expect(domain()).to.deep.equal([0, 1200]);
    renderer.setFillActive(true);
    nodes.push(node("record", { year: 2000, citationCount: 2900 }));
    renderer.syncModel();
    expect(domain(), "a new maximum grows the domain").to.deep.equal([0, 3000]);
    nodes.pop();
    renderer.syncModel();
    expect(domain(), "a paper leaving does not shrink it").to.deep.equal([
      0, 3000,
    ]);
    const before = renderer.positionOf("top")!.y;
    renderer.setFillActive(false);
    expect(domain(), "at rest the domain is tight again").to.deep.equal([
      0, 1200,
    ]);
    expect(
      renderer.positionOf("top")!.y,
      "settling re-projects the nodes",
    ).to.not.equal(before);
  });
});
