/**
 * The citation floor's pure half: how a dragged value rounds, where the line
 * sits on the plot, what its tag says. The renderer draws from this and the
 * view service holds the value; neither decides anything the other needs.
 */
import type { GraphAxisMetric, GraphScaleType } from "../domain/graphTypes";
import { clamp, inverseScaleValue, scaleValue } from "./graphMetricScale";

/**
 * The plot's box in world units. The renderer and its scene each keep the
 * same four numbers; a fourth copy is the price of keeping this module free
 * of the renderer.
 */
export const WORLD_PLOT = {
  left: 105,
  right: 1030,
  top: 60,
  bottom: 675,
} as const;

const COUNT_FORMAT = new Intl.NumberFormat(undefined, { useGrouping: true });

/**
 * A dragged floor reads as a round number: integers under 20, fives to 100,
 * tens to 1,000, hundreds past that. Never below 0.
 */
export function roundFloor(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const step = value < 20 ? 1 : value < 100 ? 5 : value < 1000 ? 10 : 100;
  return Math.max(0, Math.round(value / step) * step);
}

export interface FloorAxisInput {
  metric: GraphAxisMetric;
  scale: GraphScaleType;
  /** The axis's full domain, or null when the axis has none to show. */
  domain: [number, number] | null;
}

export interface FloorLinePlacement {
  axis: "x" | "y";
  /** The line's world coordinate on that axis: a y for "y", an x for "x". */
  world: number;
}

function showsCitations(input: FloorAxisInput): input is FloorAxisInput & {
  domain: [number, number];
} {
  return input.metric === "citations" && input.domain !== null;
}

/**
 * Where the line goes: on Y when Y shows citations, else on X when X does,
 * else nowhere. A floor under the domain (0 on any scale, 1 on a log axis
 * starting at 1) sits on the axis edge; one past it sits on the far edge.
 */
export function floorLinePlacement(
  x: FloorAxisInput,
  y: FloorAxisInput,
  floor: number,
): FloorLinePlacement | null {
  const axis = showsCitations(y) ? "y" : showsCitations(x) ? "x" : null;
  if (axis === null) return null;
  const input = axis === "y" ? y : x;
  const domain = input.domain as [number, number];
  const t =
    floor <= 0
      ? 0
      : clamp(scaleValue(floor, domain[0], domain[1], input.scale), 0, 1);
  return axis === "y"
    ? {
        axis,
        world: WORLD_PLOT.bottom - t * (WORLD_PLOT.bottom - WORLD_PLOT.top),
      }
    : {
        axis,
        world: WORLD_PLOT.left + t * (WORLD_PLOT.right - WORLD_PLOT.left),
      };
}

/**
 * The floor a pointer asks for at a world coordinate on the line's axis. At
 * or past the axis edge it is 0 on every scale: a log domain starting at 1
 * could otherwise never reach off.
 */
export function floorAtWorld(
  axis: "x" | "y",
  input: FloorAxisInput,
  world: number,
): number {
  const t =
    axis === "y"
      ? (WORLD_PLOT.bottom - world) / (WORLD_PLOT.bottom - WORLD_PLOT.top)
      : (world - WORLD_PLOT.left) / (WORLD_PLOT.right - WORLD_PLOT.left);
  if (t <= 0 || input.domain === null) return 0;
  return roundFloor(
    inverseScaleValue(clamp(t, 0, 1), input.domain, input.scale),
  );
}

/** The handle tag's text, also the canvas title while the tag is hovered. */
export function floorTagText(floor: number, below: number): string {
  if (floor <= 0) return "⇕ floor: off";
  return `⇕ floor: ≥ ${COUNT_FORMAT.format(floor)} citations · ${COUNT_FORMAT.format(below)} below`;
}
