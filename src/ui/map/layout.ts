// Force-directed layout (spec §8) with d3-force on the main thread, so that
// dragging and pinning update synchronously (plan §4). Link attraction is
// proportional to the tie's weight on the selected layer: strength =
// ATTRACTION × w / min(degree of either end), d3's own degree scaling times the
// weight, which keeps dense layers stable.
//
// Nothing animates on load (spec §12): a new layout is settled before it is
// first drawn. The simulation runs visibly only after a drag.

import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';

export interface LayoutNode extends SimulationNodeDatum {
  index: number;
  radius: number;
}

interface LayoutLink extends SimulationLinkDatum<LayoutNode> {
  weight: number;
}

const ATTRACTION = 1;
const LINK_DISTANCE = 80;
const CHARGE = -300;
const SETTLE_TICKS = 300;

/** Unit square positions spread on a spiral, a deterministic starting point. */
function initialPosition(i: number): { x: number; y: number } {
  const r = 10 * Math.sqrt(i + 0.5);
  const a = i * Math.PI * (3 - Math.sqrt(5));
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
}

export class ForceLayout {
  readonly nodes: LayoutNode[] = [];
  private simulation: Simulation<LayoutNode, LayoutLink> | null = null;
  private key = '';

  /**
   * Rebuilds the forces for new weights. Members keep their positions (and
   * pins) from the previous layout, so a change of layer or view moves only
   * what the new weights move. Returns true when the layout changed.
   */
  update(
    key: string,
    n: number,
    weights: Float64Array | undefined,
    radii: readonly number[],
  ): boolean {
    if (key === this.key && this.nodes.length === n) {
      this.nodes.forEach((node, i) => {
        node.radius = radii[i] ?? node.radius;
      });
      return false;
    }
    this.key = key;
    if (this.nodes.length !== n) {
      this.nodes.length = 0;
      for (let i = 0; i < n; i++) {
        this.nodes.push({ index: i, radius: radii[i] ?? 0, ...initialPosition(i) });
      }
    }
    const links: LayoutLink[] = [];
    if (weights) {
      // One attraction per pair: the two directions add up.
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = weights[i * n + j] as number;
          const b = weights[j * n + i] as number;
          const w = (a > 0 ? a : 0) + (b > 0 ? b : 0);
          if (w > 0) links.push({ source: i, target: j, weight: w });
        }
      }
    }
    const degree = new Array<number>(n).fill(0);
    for (const l of links) {
      degree[l.source as number] = (degree[l.source as number] ?? 0) + 1;
      degree[l.target as number] = (degree[l.target as number] ?? 0) + 1;
    }
    this.simulation?.stop();
    this.simulation = forceSimulation(this.nodes)
      .force(
        'link',
        forceLink<LayoutNode, LayoutLink>(links)
          .distance(LINK_DISTANCE)
          .strength(
            (l) =>
              (ATTRACTION * l.weight) /
              Math.max(
                1,
                Math.min(
                  degree[(l.source as LayoutNode).index] ?? 1,
                  degree[(l.target as LayoutNode).index] ?? 1,
                ),
              ),
          ),
      )
      .force(
        'charge',
        forceManyBody<LayoutNode>()
          .strength(CHARGE)
          .distanceMax(LINK_DISTANCE * 8),
      )
      .force(
        'collide',
        forceCollide<LayoutNode>((d) => d.radius + 4),
      )
      // Weak pull to the centre keeps separate components on screen.
      .force('x', forceX<LayoutNode>(0).strength(0.04))
      .force('y', forceY<LayoutNode>(0).strength(0.04))
      .stop();
    this.simulation.tick(SETTLE_TICKS);
    return true;
  }

  /** Starts the visible simulation (during a drag). */
  reheat(onTick: () => void): void {
    this.simulation?.on('tick', onTick).alphaTarget(0.3).restart();
  }

  cool(): void {
    this.simulation?.alphaTarget(0);
  }

  stop(): void {
    this.simulation?.stop();
  }

  pin(i: number, x: number, y: number): void {
    const node = this.nodes[i];
    if (!node) return;
    node.fx = x;
    node.fy = y;
  }

  unpinAll(): void {
    for (const node of this.nodes) {
      node.fx = null;
      node.fy = null;
    }
  }

  get pinned(): number {
    return this.nodes.filter((n) => n.fx !== null && n.fx !== undefined).length;
  }

  get positions(): readonly { x: number; y: number }[] {
    return this.nodes as { x: number; y: number }[];
  }
}
