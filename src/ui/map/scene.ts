// Scene: the map as renderer-neutral drawing instructions in screen space
// (CSS pixels). The canvas painter draws it on every frame; the Phase 7 SVG
// export will serialise the same scene, so exports match the screen.
//
// Zoom is semantic: it spreads member positions, while node radii, edge widths
// and labels keep their screen size, so text stays legible on a projector at
// every zoom level.

import { valenceColour } from './colour';
import type { EdgeStyle, MapModel } from './model';
import type { MapTheme } from './theme';

export interface Transform {
  x: number;
  y: number;
  k: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface LineBatch {
  stroke: string;
  width: number;
  dash: number[];
  alpha: number;
  /** x1, y1, x2, y2 for each segment. */
  coords: number[];
}

export interface ArrowBatch {
  fill: string;
  alpha: number;
  /** Three points per arrowhead. */
  coords: number[];
}

export interface NodeMark {
  index: number;
  x: number;
  y: number;
  r: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  dashed: boolean;
  alpha: number;
}

export interface RingMark {
  x: number;
  y: number;
  r: number;
}

export interface LabelMark {
  x: number;
  y: number;
  text: string;
  alpha: number;
}

export interface Scene {
  width: number;
  height: number;
  background: string;
  lines: LineBatch[];
  arrows: ArrowBatch[];
  nodes: NodeMark[];
  rings: RingMark[];
  labels: LabelMark[];
  theme: MapTheme;
}

export interface Highlight {
  hovered: number | null;
  focused: number | null;
  selected: number | null;
}

/** Members to keep at full strength; null when nothing is highlighted. */
export function highlightSet(model: MapModel, h: Highlight): Set<number> | null {
  const centre = h.hovered ?? h.focused ?? h.selected;
  if (centre !== null && model.nodes[centre]?.visible) {
    return new Set([centre, ...(model.neighbours[centre] ?? [])]);
  }
  if (model.searchMatches) return model.searchMatches;
  return null;
}

/** Up to this many visible members, every member is labelled. */
export const LABEL_ALL_BELOW = 60;

export function toScreen(p: Point, t: Transform): Point {
  return { x: p.x * t.k + t.x, y: p.y * t.k + t.y };
}

/**
 * Builds the scene. `part` 'all' is the complete picture (used for export and
 * as the interaction cache); 'lit' is only the highlighted members and their
 * ties, at full strength and without background, drawn over a faded copy of
 * the cached picture while something is highlighted.
 */
export function buildScene(
  model: MapModel,
  positions: readonly Point[],
  t: Transform,
  size: { width: number; height: number },
  theme: MapTheme,
  h: Highlight,
  part: 'all' | 'lit' = 'all',
  measure: (text: string) => number = (text) => text.length * theme.labelSize * 0.5,
): Scene {
  const lit = highlightSet(model, h);
  const onlyLit = part === 'lit' && lit !== null;
  const faded = (i: number) => lit !== null && !lit.has(i);
  const screen = positions.map((p) => toScreen(p, t));
  const batches = new Map<string, LineBatch>();
  const arrows = new Map<string, ArrowBatch>();
  const margin = theme.nodeMax + theme.edgeMax;
  const outside = (a: Point, b: Point) =>
    (a.x < -margin && b.x < -margin) ||
    (a.y < -margin && b.y < -margin) ||
    (a.x > size.width + margin && b.x > size.width + margin) ||
    (a.y > size.height + margin && b.y > size.height + margin);

  const dashFor = (style: EdgeStyle, width: number): number[] => {
    const f = Math.max(1, width);
    if (style === 'informal') return [theme.dash * f, theme.gap * f];
    if (style === 'neither') return [theme.dot * f, theme.gap * f];
    return [];
  };
  const line = (
    stroke: string,
    width: number,
    dash: number[],
    alpha: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ) => {
    // Widths are grouped in quarter pixels so ties draw in few batches.
    const w = Math.round(width * 4) / 4;
    const key = `${stroke}|${String(w)}|${dash.join(',')}|${String(alpha)}`;
    let b = batches.get(key);
    if (!b) {
      b = { stroke, width: w, dash, alpha, coords: [] };
      batches.set(key, b);
    }
    b.coords.push(x1, y1, x2, y2);
  };

  const valenceCache = new Map<number, string>();
  const colourFor = (v: number) => {
    if (!model.valenceShown) return theme.stone;
    if (Number.isNaN(v)) return theme.other;
    const q = Math.round(v * 10) / 10;
    let c = valenceCache.get(q);
    if (c === undefined) {
      c = valenceColour(theme.valence, q);
      valenceCache.set(q, c);
    }
    return c;
  };

  // Faded ties first, so highlighted ties sit on top of them.
  const edges = lit
    ? [
        ...model.edges.filter((e) => !(lit.has(e.source) && lit.has(e.target))),
        ...model.edges.filter((e) => lit.has(e.source) && lit.has(e.target)),
      ]
    : model.edges;
  const centre = h.hovered ?? h.focused ?? h.selected;

  for (const e of edges) {
    const a = screen[e.source];
    const b = screen[e.target];
    if (!a || !b || outside(a, b)) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const ux = dx / len;
    const uy = dy / len;
    // Perpendicular, to the right of the direction of travel.
    const px = -uy;
    const py = ux;
    const incident =
      lit === null ||
      (centre !== null && model.nodes[centre]?.visible
        ? e.source === centre || e.target === centre
        : lit.has(e.source) && lit.has(e.target));
    if (onlyLit && !incident) continue;
    const alpha = incident ? 1 : theme.fade;
    const stroke = colourFor(e.valence);
    const off = e.reciprocated ? theme.pairOffset + e.width / 2 : 0;
    let x1 = a.x + px * off;
    let y1 = a.y + py * off;
    let x2 = b.x + px * off;
    let y2 = b.y + py * off;

    if (model.directed) {
      const target = model.nodes[e.target];
      const head = theme.arrow + e.width;
      const tip = (target?.radius ?? 0) + theme.line;
      if (len > tip + head) {
        const tx = x2 - ux * tip;
        const ty = y2 - uy * tip;
        const bx = tx - ux * head;
        const by = ty - uy * head;
        const half = head / 2;
        const key = `${stroke}|${String(alpha)}`;
        let ab = arrows.get(key);
        if (!ab) {
          ab = { fill: stroke, alpha, coords: [] };
          arrows.set(key, ab);
        }
        ab.coords.push(tx, ty, bx + px * half, by + py * half, bx - px * half, by - py * half);
        x2 = bx;
        y2 = by;
      }
    }
    if (e.style === 'both') {
      // Solid line with a parallel dashed line (design-system §2.3).
      const o = e.width + theme.gap / 2;
      line(
        stroke,
        e.width,
        [],
        alpha,
        x1 - (px * o) / 2,
        y1 - (py * o) / 2,
        x2 - (px * o) / 2,
        y2 - (py * o) / 2,
      );
      x1 += (px * o) / 2;
      y1 += (py * o) / 2;
      x2 += (px * o) / 2;
      y2 += (py * o) / 2;
      line(stroke, e.width, dashFor('informal', e.width), alpha, x1, y1, x2, y2);
    } else {
      line(stroke, e.width, dashFor(e.style, e.width), alpha, x1, y1, x2, y2);
    }
  }

  const nodes: NodeMark[] = [];
  const candidates: (LabelMark & { priority: number })[] = [];
  const visibleCount = model.nodes.filter((n) => n.visible).length;
  const order = model.nodes.filter((n) => n.visible && (!onlyLit || lit.has(n.index)));
  if (lit) order.sort((p, q) => Number(lit.has(p.index)) - Number(lit.has(q.index)));
  for (const node of order) {
    const p = screen[node.index];
    if (!p) continue;
    const group = model.fill.groups[node.group];
    const hue = group?.hue ?? -1;
    const alpha = faded(node.index) ? theme.fade : 1;
    nodes.push({
      index: node.index,
      x: p.x,
      y: p.y,
      r: node.radius,
      fill: hue >= 0 ? (theme.categorical[hue] ?? theme.other) : theme.other,
      stroke: theme.ink,
      strokeWidth: theme.line,
      dashed: hue < 0,
      alpha,
    });
    const labelled =
      visibleCount <= LABEL_ALL_BELOW ||
      (lit !== null && lit.has(node.index) && lit.size <= LABEL_ALL_BELOW) ||
      node.index === h.selected;
    if (labelled) {
      const own = node.index === (h.hovered ?? h.focused ?? h.selected);
      candidates.push({
        x: p.x,
        y: p.y + node.radius + theme.labelGap + theme.labelSize,
        text: node.name,
        alpha,
        // The member in focus first, then highlighted members, then larger members.
        priority:
          (own ? 2e6 : 0) + (lit?.has(node.index) === true && alpha === 1 ? 1e6 : 0) + node.radius,
      });
    }
  }

  // Labels never overlap: each is placed only if it clears those already placed.
  const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const labels: LabelMark[] = [];
  candidates.sort((a, b) => b.priority - a.priority);
  for (const c of candidates) {
    const w = measure(c.text) / 2 + theme.labelGap;
    const box = { x0: c.x - w, y0: c.y - theme.labelSize, x1: c.x + w, y1: c.y + theme.labelGap };
    if (placed.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0))
      continue;
    placed.push(box);
    labels.push({ x: c.x, y: c.y, text: c.text, alpha: c.alpha });
  }

  const rings: RingMark[] = [];
  for (const i of new Set([h.selected, h.focused])) {
    if (i === null) continue;
    const node = model.nodes[i];
    const p = screen[i];
    if (node?.visible && p) rings.push({ x: p.x, y: p.y, r: node.radius });
  }

  return {
    width: size.width,
    height: size.height,
    background: onlyLit ? '' : theme.paper,
    lines: [...batches.values()],
    arrows: [...arrows.values()],
    nodes,
    rings,
    labels,
    theme,
  };
}

/** The member under a screen point, topmost first; a small margin eases small targets. */
export function hitTest(scene: Scene, x: number, y: number, slop: number): number | null {
  for (let k = scene.nodes.length - 1; k >= 0; k--) {
    const n = scene.nodes[k];
    if (!n) continue;
    const r = Math.max(n.r, slop) + scene.theme.line;
    if ((x - n.x) ** 2 + (y - n.y) ** 2 <= r * r) return n.index;
  }
  return null;
}
