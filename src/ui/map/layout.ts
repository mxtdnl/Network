// Map layouts (spec §8) with d3-force on the main thread, so that dragging and
// pinning update synchronously (plan §4).
//
//   force      attraction proportional to the tie's weight on the selected
//              layer: strength = ATTRACTION × w / min(degree of either end),
//              d3's own degree scaling times the weight
//   grouped    members pulled towards one centre per value of an attribute,
//              with weak attraction along ties inside the pull
//   circular   members on a circle, in contiguous arcs per group
//   hierarchy  members placed by formal reporting line (manager ids); the
//              ties drawn over it are the informal ones (see useMapModel)
//
// Nothing animates on load (spec §12): a layout is settled before it is first
// drawn. A later change of layout, layer or weights moves members from where
// they were to where the new layout puts them by interpolation over
// `--m-layout` (plan Q16), and not at all under reduced motion.

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

export type LayoutSpec =
  | { kind: 'force' }
  | {
      kind: 'grouped' | 'circular';
      /** Group index per member, in display order (0 … groups.length − 1). */
      group: readonly number[];
      groups: readonly string[];
      /** Member names, to order members inside a group on the circle. */
      names: readonly string[];
    }
  | {
      kind: 'hierarchy';
      /** Manager's member index per member, −1 for none. Cycles are already broken. */
      parent: readonly number[];
      names: readonly string[];
    };

/** What the scene needs to annotate a layout: group labels or reporting lines. */
export type LayoutAnnotation =
  | { kind: 'none' }
  | { kind: 'groups'; circular: boolean; group: readonly number[]; groups: readonly string[] }
  | {
      kind: 'hierarchy';
      parent: readonly number[];
      column: readonly boolean[];
      /** Layout x of the vertical line a column of reports hangs from (NaN when not in a column). */
      spine: readonly number[];
      /** Layout distance below a manager at which their reporting lines branch. */
      drop: number;
    };

const ATTRACTION = 1;
const LINK_DISTANCE = 80;
const CHARGE = -300;
const SETTLE_TICKS = 300;
/** Layout units between neighbouring members on the circle and in the hierarchy. */
const SPACING = 44;
/** Width given to each leaf or column in the hierarchy, and the height of a level. */
const SLOT = 130;
const LEVEL = 110;
/** Rows of a column of reports: far enough apart for a label under each member. */
const ROW = 60;
/** Children that are all leaves, this many or more, stack in a column below their manager. */
const COLUMN_FROM = 4;
const COLUMN_INDENT = 28;

/** Unit square positions spread on a spiral, a deterministic starting point. */
function initialPosition(i: number): { x: number; y: number } {
  const r = 10 * Math.sqrt(i + 0.5);
  const a = i * Math.PI * (3 - Math.sqrt(5));
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
}

/** Evaluates a CSS cubic-bezier(x1, y1, x2, y2) easing at t. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const bez = (a: number, b: number, t: number) =>
    3 * a * t * (1 - t) ** 2 + 3 * b * t ** 2 * (1 - t) + t ** 3;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0;
    let hi = 1;
    let t = x;
    for (let i = 0; i < 30; i++) {
      const v = bez(x1, x2, t);
      if (Math.abs(v - x) < 1e-6) break;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return bez(y1, y2, t);
  };
}

/** Parses `cubic-bezier(a, b, c, d)` (an easing token); linear when it cannot. */
export function parseEasing(text: string): (t: number) => number {
  const m = /cubic-bezier\(([^)]+)\)/.exec(text);
  const p = m?.[1]?.split(',').map((x) => Number.parseFloat(x));
  if (!p || p.length !== 4 || p.some((x) => !Number.isFinite(x))) return (t) => t;
  return cubicBezier(p[0] as number, p[1] as number, p[2] as number, p[3] as number);
}

/** Circle and hierarchy target positions, and which children stack in a column. */
export function targetPositions(
  spec: LayoutSpec,
  n: number,
): { x: number[]; y: number[]; column: boolean[]; spine: number[] } | null {
  const x = new Array<number>(n).fill(0);
  const y = new Array<number>(n).fill(0);
  const column = new Array<boolean>(n).fill(false);
  const spine = new Array<number>(n).fill(NaN);
  if (spec.kind === 'circular') {
    const order = Array.from({ length: n }, (_, i) => i).sort(
      (a, b) =>
        (spec.group[a] ?? 0) - (spec.group[b] ?? 0) ||
        (spec.names[a] ?? '').localeCompare(spec.names[b] ?? '', 'en-GB') ||
        a - b,
    );
    const used = new Set(order.map((i) => spec.group[i] ?? 0));
    // One empty slot between groups, so each group reads as an arc.
    const slots = n + (used.size > 1 ? used.size : 0);
    const radius = Math.max((slots * SPACING) / (2 * Math.PI), SPACING);
    let slot = 0;
    let previous: number | null = null;
    for (const i of order) {
      const g = spec.group[i] ?? 0;
      if (previous !== null && g !== previous) slot += 1;
      previous = g;
      const a = -Math.PI / 2 + (2 * Math.PI * slot) / slots;
      x[i] = radius * Math.cos(a);
      y[i] = radius * Math.sin(a);
      slot += 1;
    }
    return { x, y, column, spine };
  }
  if (spec.kind === 'hierarchy') {
    const children: number[][] = Array.from({ length: n }, () => []);
    const roots: number[] = [];
    for (let i = 0; i < n; i++) {
      const p = spec.parent[i] ?? -1;
      if (p >= 0 && p < n) (children[p] as number[]).push(i);
      else roots.push(i);
    }
    const byName = (a: number, b: number) =>
      (spec.names[a] ?? '').localeCompare(spec.names[b] ?? '', 'en-GB') || a - b;
    const size = (i: number): number => 1 + (children[i] ?? []).reduce((s, c) => s + size(c), 0);
    for (const c of children) c.sort(byName);
    // Larger trees first; members with neither manager nor reports last.
    roots.sort((a, b) => size(b) - size(a) || byName(a, b));
    let cursor = 0;
    const place = (v: number, depth: number): void => {
      const kids = children[v] ?? [];
      y[v] = depth * LEVEL;
      if (kids.length === 0) {
        x[v] = cursor;
        cursor += SLOT;
        return;
      }
      // Reports with no reports of their own stack in one column under their
      // manager; managers among the reports get their own subtree beside it.
      const leaves = kids.filter((k) => (children[k] ?? []).length === 0);
      const branches = kids.filter((k) => (children[k] ?? []).length > 0);
      const stacked = leaves.length >= COLUMN_FROM || (leaves.length >= 2 && branches.length > 0);
      let first = Infinity;
      let last = -Infinity;
      if (stacked) {
        leaves.forEach((k, r) => {
          x[k] = cursor + COLUMN_INDENT;
          y[k] = depth * LEVEL + LEVEL * 0.7 + r * ROW;
          column[k] = true;
          spine[k] = cursor;
        });
        first = cursor;
        last = cursor;
        cursor += SLOT;
      }
      for (const k of stacked ? branches : kids) {
        place(k, depth + 1);
        first = Math.min(first, x[k] as number);
        last = Math.max(last, x[k] as number);
      }
      x[v] = (first + last) / 2;
    };
    for (const r of roots) place(r, 0);
    const mid = (cursor - SLOT) / 2;
    for (let i = 0; i < n; i++) {
      x[i] = (x[i] as number) - mid;
      spine[i] = (spine[i] as number) - mid;
    }
    return { x, y, column, spine };
  }
  return null;
}

export function layoutAnnotation(spec: LayoutSpec, n: number): LayoutAnnotation {
  if (spec.kind === 'grouped' || spec.kind === 'circular') {
    return {
      kind: 'groups',
      circular: spec.kind === 'circular',
      group: spec.group,
      groups: spec.groups,
    };
  }
  if (spec.kind === 'hierarchy') {
    const t = targetPositions(spec, n);
    return {
      kind: 'hierarchy',
      parent: spec.parent,
      column: t?.column ?? [],
      spine: t?.spine ?? [],
      drop: LEVEL * 0.35,
    };
  }
  return { kind: 'none' };
}

interface Animation {
  from: { x: number; y: number }[];
  start: number;
  duration: number;
  ease: (t: number) => number;
}

export interface SavedPoint {
  x: number;
  y: number;
  pinned: boolean;
}

/** Per member in a settle job's state: x, y, vx, vy, fx, fy (NaN when not pinned), radius. */
const NODE_FIELDS = 7;

/** One attraction per pair of members, as parallel arrays. */
export interface LayoutLinks {
  source: Int32Array;
  target: Int32Array;
  weight: Float64Array;
}

/** A force or grouped layout to settle in a worker (see `ForceLayout.prepare`). */
export interface SettleJob {
  key: string;
  spec: LayoutSpec;
  /** NODE_FIELDS values per member. */
  state: Float64Array;
  links: LayoutLinks;
}

export interface SettleResult {
  /** x, y, vx, vy per member. */
  positions: Float64Array;
  alpha: number;
}

function layoutLinks(n: number, weights: Float64Array | undefined, spec: LayoutSpec): LayoutLinks {
  const source: number[] = [];
  const target: number[] = [];
  const weight: number[] = [];
  if (weights && spec.kind !== 'hierarchy' && spec.kind !== 'circular') {
    // One attraction per pair: the two directions add up.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = weights[i * n + j] as number;
        const b = weights[j * n + i] as number;
        const w = (a > 0 ? a : 0) + (b > 0 ? b : 0);
        if (w > 0) {
          source.push(i);
          target.push(j);
          weight.push(w);
        }
      }
    }
  }
  return {
    source: Int32Array.from(source),
    target: Int32Array.from(target),
    weight: Float64Array.from(weight),
  };
}

/** Builds the stopped simulation of a layout over `nodes`; fixed layouts also place them. */
function configureSimulation(
  nodes: LayoutNode[],
  layoutLinks: LayoutLinks,
  spec: LayoutSpec,
): Simulation<LayoutNode, LayoutLink> {
  const n = nodes.length;
  const links: LayoutLink[] = Array.from(layoutLinks.weight, (weight, k) => ({
    source: layoutLinks.source[k] as number,
    target: layoutLinks.target[k] as number,
    weight,
  }));
  const degree = new Array<number>(n).fill(0);
  for (const l of links) {
    degree[l.source as number] = (degree[l.source as number] ?? 0) + 1;
    degree[l.target as number] = (degree[l.target as number] ?? 0) + 1;
  }
  const linkStrength = (scale: number) => (l: LayoutLink) =>
    (scale * ATTRACTION * l.weight) /
    Math.max(
      1,
      Math.min(
        degree[(l.source as LayoutNode).index] ?? 1,
        degree[(l.target as LayoutNode).index] ?? 1,
      ),
    );

  const sim = forceSimulation(nodes).stop();
  const targets = targetPositions(spec, n);
  if (targets) {
    // Fixed positions: members sit on their targets; a drag moves only the dragged member.
    nodes.forEach((node, i) => {
      node.x = targets.x[i];
      node.y = targets.y[i];
      node.vx = 0;
      node.vy = 0;
    });
    sim
      .force('x', forceX<LayoutNode>((d) => targets.x[d.index] ?? 0).strength(1))
      .force('y', forceY<LayoutNode>((d) => targets.y[d.index] ?? 0).strength(1));
  } else if (spec.kind === 'grouped') {
    const centres = groupCentres(spec.group, spec.groups.length);
    sim
      .force(
        'link',
        forceLink<LayoutNode, LayoutLink>(
          links.filter((l) => spec.group[l.source as number] === spec.group[l.target as number]),
        )
          .distance(LINK_DISTANCE / 2)
          .strength(linkStrength(0.3)),
      )
      .force(
        'charge',
        forceManyBody<LayoutNode>()
          .strength(CHARGE / 6)
          .distanceMax(LINK_DISTANCE * 2),
      )
      .force(
        'collide',
        forceCollide<LayoutNode>((d) => d.radius + SPACING / 4),
      )
      .force(
        'x',
        forceX<LayoutNode>((d) => centres[spec.group[d.index] ?? 0]?.x ?? 0).strength(0.3),
      )
      .force(
        'y',
        forceY<LayoutNode>((d) => centres[spec.group[d.index] ?? 0]?.y ?? 0).strength(0.3),
      );
  } else {
    sim
      .force(
        'link',
        forceLink<LayoutNode, LayoutLink>(links).distance(LINK_DISTANCE).strength(linkStrength(1)),
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
      .force('y', forceY<LayoutNode>(0).strength(0.04));
  }
  return sim;
}

/**
 * Settles a job exactly as `ForceLayout.update` would on the main thread (the
 * same forces, starting state and number of ticks), for the layout worker.
 */
export function settleJob(job: SettleJob): SettleResult {
  const n = job.state.length / NODE_FIELDS;
  const nodes: LayoutNode[] = [];
  for (let i = 0; i < n; i++) {
    const s = job.state.subarray(i * NODE_FIELDS, (i + 1) * NODE_FIELDS);
    nodes.push({
      index: i,
      x: s[0],
      y: s[1],
      vx: s[2],
      vy: s[3],
      fx: Number.isNaN(s[4]) ? null : s[4],
      fy: Number.isNaN(s[5]) ? null : s[5],
      radius: s[6] as number,
    });
  }
  const sim = configureSimulation(nodes, job.links, job.spec);
  sim.tick(SETTLE_TICKS);
  const positions = new Float64Array(n * 4);
  nodes.forEach((node, i) => {
    positions.set([node.x ?? 0, node.y ?? 0, node.vx ?? 0, node.vy ?? 0], i * 4);
  });
  return { positions, alpha: sim.alpha() };
}

export class ForceLayout {
  readonly nodes: LayoutNode[] = [];
  private simulation: Simulation<LayoutNode, LayoutLink> | null = null;
  private key = '';
  private animation: Animation | null = null;
  private display: { x: number; y: number }[] = [];
  /** Positions to apply after the next update (a restored saved view), by member index. */
  private pending: (SavedPoint | null)[] | null = null;
  private restored = false;
  /** The key of a layout being settled in a worker, or ''. */
  private awaiting = '';
  annotation: LayoutAnnotation = { kind: 'none' };

  /**
   * Places members where a saved view drew them, and pins the ones it had
   * pinned, once the next `update` has built the layout. Members without a
   * saved position keep the position the layout gives them.
   */
  requestPositions(positions: (SavedPoint | null)[]): void {
    this.pending = positions;
  }

  /**
   * Starts a fresh layout from given positions and pins, so a later `update`
   * with other weights moves members only as far as the new weights move them
   * (the map export uses it when the signed-layer exclusion changes the ties).
   */
  seed(points: readonly SavedPoint[]): void {
    this.simulation?.stop();
    this.nodes.length = 0;
    points.forEach((p, index) => {
      this.nodes.push({
        index,
        radius: 0,
        x: p.x,
        y: p.y,
        vx: 0,
        vy: 0,
        fx: p.pinned ? p.x : null,
        fy: p.pinned ? p.y : null,
      });
    });
  }

  /** True once after saved positions were applied, so the view can be fitted to them. */
  takeRestored(): boolean {
    const r = this.restored;
    this.restored = false;
    return r;
  }

  private applyPending(): boolean {
    const pending = this.pending;
    this.pending = null;
    if (!pending || pending.length !== this.nodes.length) return false;
    this.simulation?.stop();
    pending.forEach((p, i) => {
      const node = this.nodes[i];
      if (!node || !p) return;
      node.x = p.x;
      node.y = p.y;
      node.vx = 0;
      node.vy = 0;
      node.fx = p.pinned ? p.x : null;
      node.fy = p.pinned ? p.y : null;
    });
    this.restored = true;
    return true;
  }

  /**
   * Rebuilds the forces for new weights or a new layout. Members start from
   * their previous positions (and pins, in the force layout), so a change of
   * layer or weights moves only what the new weights move. Returns true when
   * the layout changed.
   */
  update(
    key: string,
    n: number,
    weights: Float64Array | undefined,
    radii: readonly number[],
    spec: LayoutSpec = { kind: 'force' },
  ): boolean {
    return this.prepare(key, n, weights, radii, spec, Infinity).changed;
  }

  /**
   * As `update`, but a force or grouped layout with at least `workerMinLinks`
   * attractions is not settled here: the settling is returned as a job for a
   * worker (`settleJob`), and `accept` applies its result. Until then the
   * layout keeps its previous positions and key. Returns `changed` when the
   * layout was rebuilt here.
   */
  prepare(
    key: string,
    n: number,
    weights: Float64Array | undefined,
    radii: readonly number[],
    spec: LayoutSpec,
    workerMinLinks: number,
  ): { changed: boolean; job: SettleJob | null } {
    if (key === this.key && this.nodes.length === n) {
      this.nodes.forEach((node, i) => {
        node.radius = radii[i] ?? node.radius;
      });
      return { changed: this.applyPending(), job: null };
    }
    // The same layout is already being settled in a worker.
    if (key === this.awaiting && this.nodes.length === n) return { changed: false, job: null };
    this.awaiting = '';
    const kindChanged = this.annotation.kind !== layoutAnnotation(spec, n).kind;
    if (this.nodes.length !== n) {
      this.nodes.length = 0;
      for (let i = 0; i < n; i++) {
        this.nodes.push({ index: i, radius: radii[i] ?? 0, ...initialPosition(i) });
      }
    }
    // A fixed layout places everyone; pins from a force layout do not carry over.
    if (spec.kind !== 'force' || kindChanged) this.unpinAll();
    const links = layoutLinks(n, weights, spec);

    this.simulation?.stop();
    const settles = spec.kind === 'force' || spec.kind === 'grouped';
    if (settles && links.weight.length >= workerMinLinks) {
      this.awaiting = key;
      const state = new Float64Array(n * NODE_FIELDS);
      this.nodes.forEach((node, i) => {
        state.set(
          [
            node.x ?? 0,
            node.y ?? 0,
            node.vx ?? 0,
            node.vy ?? 0,
            node.fx ?? NaN,
            node.fy ?? NaN,
            node.radius,
          ],
          i * NODE_FIELDS,
        );
      });
      return { changed: false, job: { key, spec, state, links } };
    }
    this.key = key;
    this.annotation = layoutAnnotation(spec, n);
    const sim = configureSimulation(this.nodes, links, spec);
    if (settles) sim.tick(SETTLE_TICKS);
    this.simulation = sim;
    this.applyPending();
    return { changed: true, job: null };
  }

  /**
   * Applies a worker's settled positions for `job`. Returns false, changing
   * nothing, when the layout has moved on since the job was prepared.
   */
  accept(job: SettleJob, settled: SettleResult): boolean {
    if (job.key !== this.awaiting || settled.positions.length !== this.nodes.length * 4)
      return false;
    this.awaiting = '';
    this.key = job.key;
    this.annotation = layoutAnnotation(job.spec, this.nodes.length);
    this.nodes.forEach((node, i) => {
      node.x = settled.positions[i * 4];
      node.y = settled.positions[i * 4 + 1];
      node.vx = settled.positions[i * 4 + 2];
      node.vy = settled.positions[i * 4 + 3];
    });
    // The same forces, already settled: a drag continues from here.
    const sim = configureSimulation(this.nodes, job.links, job.spec).alpha(settled.alpha);
    this.simulation = sim;
    this.applyPending();
    return true;
  }

  /** Moves the drawn positions from `from` to the settled ones over `duration` ms. */
  animateFrom(
    from: readonly { x: number; y: number }[],
    duration: number,
    ease: (t: number) => number,
    now: number,
  ): void {
    if (duration <= 0 || from.length !== this.nodes.length) {
      this.animation = null;
      return;
    }
    const moved = this.nodes.some((node, i) => {
      const p = from[i];
      return !p || Math.abs((node.x ?? 0) - p.x) > 0.5 || Math.abs((node.y ?? 0) - p.y) > 0.5;
    });
    if (!moved) {
      this.animation = null;
      return;
    }
    this.animation = { from: from.map((p) => ({ x: p.x, y: p.y })), start: now, duration, ease };
    this.advance(now);
  }

  get animating(): boolean {
    return this.animation !== null;
  }

  /** Updates the drawn positions for time `now`; false once the animation has finished. */
  advance(now: number): boolean {
    const a = this.animation;
    if (!a) return false;
    const t = Math.min(1, (now - a.start) / a.duration);
    if (t >= 1) {
      this.animation = null;
      return false;
    }
    const e = a.ease(t);
    this.display = this.nodes.map((node, i) => {
      const p = a.from[i] ?? { x: node.x ?? 0, y: node.y ?? 0 };
      return { x: p.x + ((node.x ?? 0) - p.x) * e, y: p.y + ((node.y ?? 0) - p.y) * e };
    });
    return true;
  }

  /** Ends an animation at once, at the settled positions (a drag or a click skips it). */
  finish(): void {
    this.animation = null;
  }

  /** Starts the visible simulation (during a drag). */
  reheat(onTick: () => void): void {
    this.finish();
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

  /** Settled position and pin of every member, for a saved view. */
  snapshot(): SavedPoint[] {
    // A pinned member is where its pin holds it, even before the simulation has moved it there.
    return this.nodes.map((node) => {
      const pinned = node.fx !== null && node.fx !== undefined;
      return {
        x: pinned ? (node.fx as number) : (node.x ?? 0),
        y: pinned ? (node.fy ?? node.y ?? 0) : (node.y ?? 0),
        pinned,
      };
    });
  }

  /** The key of the layout last built (a map export compares it with its own request). */
  get currentKey(): string {
    return this.key;
  }

  get pinned(): number {
    return this.nodes.filter((n) => n.fx !== null && n.fx !== undefined).length;
  }

  /** Positions as drawn now: interpolated while a transition runs. */
  get positions(): readonly { x: number; y: number }[] {
    return this.animation ? this.display : (this.nodes as { x: number; y: number }[]);
  }

  /** Positions the layout has settled on. */
  get settled(): readonly { x: number; y: number }[] {
    return this.nodes as { x: number; y: number }[];
  }
}

/** Group centres on a grid, far enough apart for the largest group. */
function groupCentres(group: readonly number[], count: number): { x: number; y: number }[] {
  const sizes = new Array<number>(Math.max(count, 1)).fill(0);
  for (const g of group) sizes[g] = (sizes[g] ?? 0) + 1;
  const largest = Math.max(1, ...sizes);
  const cell = 2 * Math.sqrt(largest) * SPACING * 0.9 + SPACING * 1.5;
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / columns);
  return Array.from({ length: count }, (_, g) => ({
    x: ((g % columns) - (columns - 1) / 2) * cell,
    y: (Math.floor(g / columns) - (rows - 1) / 2) * cell,
  }));
}

/** Formal managers as member indices, with cycles broken (a manager chain that loops ends at the loop). */
export function hierarchyParents(
  managerIds: readonly (string | null)[],
  memberIds: readonly string[],
): number[] {
  const index = new Map(memberIds.map((id, i) => [id, i]));
  const parent = managerIds.map((m, i) => {
    const p = m === null ? undefined : index.get(m);
    return p === undefined || p === i ? -1 : p;
  });
  for (let i = 0; i < parent.length; i++) {
    const seen = new Set<number>([i]);
    let v = parent[i] as number;
    let prev = i;
    while (v >= 0) {
      if (seen.has(v)) {
        parent[prev] = -1;
        break;
      }
      seen.add(v);
      prev = v;
      v = parent[v] as number;
    }
  }
  return parent;
}
