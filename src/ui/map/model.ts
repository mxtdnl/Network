// The map model: which members and ties are drawn and how each one is encoded
// (spec §8). Pure: no DOM, no canvas. The canvas painter and the SVG export
// (Phase 7) both draw from a scene built on this model, so the two cannot
// disagree.
//
// One visual channel carries one variable:
//   node size   → the chosen metric on the selected layer
//   node fill   → the chosen attribute, or the community on the selected layer
//   edge width  → the tie's weight (0–1) on the selected layer
//   edge colour → valence of the pair, on the diverging scale
//   edge style  → formal versus informal, when both layers are shown
//   arrowheads  → directed view only

import { FI_CLASS, type AnalysisResult } from '../engineClient';
import {
  isCategorical,
  type AttributeDefinition,
  type LayerDefinition,
  type Project,
} from '../../data/schema';
import type { MapSettings, SizeMetric } from '../state/store';

export const NOT_RECORDED = '\u0000not-recorded';
export const MAX_HUES = 8;

export type EdgeStyle = 'plain' | 'formal' | 'informal' | 'both' | 'neither';

export interface MapNode {
  index: number;
  id: string;
  name: string;
  visible: boolean;
  /** Raw metric value; NaN when not defined. */
  sizeValue: number;
  radius: number;
  /** Index into `fill.groups`. */
  group: number;
}

export interface MapEdge {
  source: number;
  target: number;
  weight: number;
  width: number;
  /** Valence on the palette scale −3…+3; NaN when not rated or not shown. */
  valence: number;
  style: EdgeStyle;
  /** Directed view: the reverse tie is also drawn, so the two are offset. */
  reciprocated: boolean;
}

export type FillGroupKind = 'value' | 'community' | 'other' | 'notRecorded' | 'noCommunity';

export interface FillGroup {
  key: string;
  kind: FillGroupKind;
  /** The attribute value, or the community number from 1. */
  label: string;
  /** Palette index 0–7, or -1 for the "Other" / "Not recorded" grey. */
  hue: number;
  members: number;
}

export interface SizeScale {
  metric: SizeMetric;
  lo: number;
  hi: number;
  anyUndefined: boolean;
}

export interface MapModel {
  n: number;
  directed: boolean;
  layer: string;
  layerLabel: string;
  nodes: MapNode[];
  edges: MapEdge[];
  /** Neighbours through the drawn ties, either direction, visible members only. */
  neighbours: number[][];
  size: SizeScale;
  fill: {
    kind: 'attribute' | 'community';
    label: string;
    groups: FillGroup[];
    otherGroups: number;
  };
  valenceShown: boolean;
  anyValenceMissing: boolean;
  styleShown: boolean;
  stylesPresent: EdgeStyle[];
  threshold: number;
  /** Layers switched off whose ties are hidden (keys). */
  hiddenLayers: string[];
  hiddenLabels: string[];
  searchMatches: Set<number> | null;
}

export interface Radii {
  nodeMin: number;
  nodeMax: number;
  nodeUndefined: number;
  edgeMin: number;
  edgeMax: number;
}

/** The valence layer used for edge colour: the core `valence` layer when enabled. */
export function valenceLayer(project: Project): LayerDefinition | undefined {
  return project.layers.find((l) => l.key === 'valence' && l.enabled && l.signed);
}

export function roleLayer(project: Project, role: 'formal' | 'informal') {
  return project.layers.find((l) => l.role === role && l.enabled && !l.signed);
}

/**
 * Layers whose map toggle is offered. By default, the layers that carry an
 * encoding: formal and informal (style) and valence (colour). When switching a
 * layer off hides its ties (CLAUDE.md D59), every enabled rated layer.
 */
export function toggleLayers(project: Project, hideOff = false): LayerDefinition[] {
  if (hideOff) return project.layers.filter((l) => l.enabled && !isCategorical(l));
  return [
    roleLayer(project, 'formal'),
    roleLayer(project, 'informal'),
    valenceLayer(project),
  ].filter((l): l is LayerDefinition => l !== undefined);
}

/** Tie weights (view) of the layers switched off whose ties are hidden; a signed layer counts both signs. */
function hiddenLayerWeights(
  project: Project,
  result: AnalysisResult,
  settings: MapSettings,
): { key: string; weights: Float64Array[] }[] {
  if (!settings.hideOffLayers) return [];
  return toggleLayers(project, true)
    .filter((l) => !isToggledOn(settings, l.key))
    .map((l) => ({
      key: l.key,
      weights: (l.signed ? [`${l.key}+`, `${l.key}-`] : [l.key])
        .map((ref) => result.refs[ref]?.weights)
        .filter((w): w is Float64Array => w !== undefined),
    }));
}

export function isToggledOn(settings: MapSettings, key: string): boolean {
  return settings.layerToggles[key] ?? true;
}

/** Attributes that can colour nodes or filter them (not member references). */
export function groupAttributes(project: Project): AttributeDefinition[] {
  return project.attribute_definitions.filter((a) => a.type !== 'member_ref');
}

/** Values of an attribute that members have, in display order: defined categories, then first appearance. */
export function attributeValues(project: Project, key: string): string[] {
  const def = project.attribute_definitions.find((a) => a.key === key);
  const present = new Set<string>();
  const appearance: string[] = [];
  for (const m of project.members) {
    const v = m.attributes[key];
    if (v !== null && v !== undefined && !present.has(v)) {
      present.add(v);
      appearance.push(v);
    }
  }
  const defined = (def?.categories ?? []).filter((c) => present.has(c));
  const known = new Set(defined);
  return [...defined, ...appearance.filter((v) => !known.has(v))];
}

/** Pair valence on the palette scale (−3…+3) in the current view; NaN = not rated. */
export function valenceMatrix(project: Project, settings: MapSettings): Float64Array | null {
  const layer = valenceLayer(project);
  if (!layer) return null;
  const n = project.members.length;
  const index = new Map(project.members.map((m, i) => [m.id, i]));
  const raw = new Float64Array(n * n).fill(NaN);
  for (const t of project.ties) {
    if (t.variable !== layer.key || t.wave !== 1 || typeof t.value !== 'number') continue;
    const i = index.get(t.rater_id);
    const j = index.get(t.ratee_id);
    if (i === undefined || j === undefined || i === j) continue;
    // Same scaling as the engine (method notes §1.2): −1…+1, then to the 7-step palette.
    const s = t.value >= 0 ? t.value / layer.max : t.value / Math.abs(layer.min);
    raw[i * n + j] = s * 3;
  }
  if (settings.view === 'directed') return raw;
  const out = new Float64Array(n * n).fill(NaN);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = raw[i * n + j] as number;
      const b = raw[j * n + i] as number;
      let v: number;
      if (Number.isNaN(a)) v = b;
      else if (Number.isNaN(b)) v = a;
      else if (settings.symmetrise === 'mean') v = (a + b) / 2;
      else if (settings.symmetrise === 'min') v = Math.min(a, b);
      else v = Math.max(a, b);
      out[i * n + j] = v;
      out[j * n + i] = v;
    }
  }
  return out;
}

function memberMatchesFilters(
  attributes: Record<string, string | null>,
  filters: MapSettings['filters'],
): boolean {
  return filters.every((f) => {
    if (f.values.length === 0) return true;
    const v = attributes[f.key] ?? null;
    return f.values.includes(v ?? NOT_RECORDED);
  });
}

function fillGroups(
  project: Project,
  result: AnalysisResult,
  settings: MapSettings,
  layerLabel: string,
): MapModel['fill'] & { memberGroup: number[] } {
  const n = project.members.length;
  const groups: FillGroup[] = [];
  const memberGroup = new Array<number>(n).fill(0);

  if (settings.fill.kind === 'community') {
    const c = result.refs[settings.layer]?.communities ?? null;
    const base = { kind: 'community' as const, label: layerLabel };
    if (!c) {
      groups.push({ key: 'none', kind: 'noCommunity', label: '', hue: -1, members: n });
      return { ...base, groups, otherGroups: 0, memberGroup };
    }
    const sizes = new Array<number>(c.count).fill(0);
    for (const k of c.membership) sizes[k] = (sizes[k] ?? 0) + 1;
    const coloured = Math.min(c.count, MAX_HUES);
    for (let k = 0; k < coloured; k++) {
      groups.push({
        key: String(k),
        kind: 'community',
        label: String(k + 1),
        hue: k,
        members: sizes[k] ?? 0,
      });
    }
    const otherGroups = c.count - coloured;
    if (otherGroups > 0) {
      const members = sizes.slice(coloured).reduce((s, x) => s + x, 0);
      groups.push({ key: 'other', kind: 'other', label: '', hue: -1, members });
    }
    c.membership.forEach((k, i) => {
      memberGroup[i] = k < coloured ? k : coloured;
    });
    return { ...base, groups, otherGroups, memberGroup };
  }

  const key = settings.fill.key;
  const def = project.attribute_definitions.find((a) => a.key === key);
  const values = attributeValues(project, key);
  const coloured = values.length > MAX_HUES ? MAX_HUES : values.length;
  const position = new Map(values.map((v, i) => [v, i]));
  const counts = new Array<number>(values.length).fill(0);
  let missing = 0;
  project.members.forEach((m) => {
    const v = m.attributes[key];
    const p = v === null || v === undefined ? undefined : position.get(v);
    if (p === undefined) missing += 1;
    else counts[p] = (counts[p] ?? 0) + 1;
  });
  values.slice(0, coloured).forEach((v, i) => {
    groups.push({ key: v, kind: 'value', label: v, hue: i, members: counts[i] ?? 0 });
  });
  const otherGroups = values.length - coloured;
  const otherIndex = groups.length;
  if (otherGroups > 0) {
    const members = counts.slice(coloured).reduce((s, x) => s + x, 0);
    groups.push({ key: 'other', kind: 'other', label: '', hue: -1, members });
  }
  const missingIndex = groups.length;
  if (missing > 0)
    groups.push({ key: NOT_RECORDED, kind: 'notRecorded', label: '', hue: -1, members: missing });
  project.members.forEach((m, i) => {
    const v = m.attributes[key];
    const p = v === null || v === undefined ? undefined : position.get(v);
    memberGroup[i] = p === undefined ? missingIndex : p < coloured ? p : otherIndex;
  });
  return { kind: 'attribute', label: def?.label ?? key, groups, otherGroups, memberGroup };
}

function edgeStyle(cls: number, f: number, g: number): EdgeStyle {
  switch (cls) {
    case FI_CLASS.formalOnly:
      return 'formal';
    case FI_CLASS.informalOnly:
      return 'informal';
    case FI_CLASS.both:
      return 'both';
    case FI_CLASS.notClassified:
      // One of the two was not rated: show what is known (CLAUDE.md D53).
      if (f > 0) return 'formal';
      if (g > 0) return 'informal';
      return 'neither';
    default:
      return 'neither';
  }
}

export function buildMapModel(
  project: Project,
  result: AnalysisResult,
  settings: MapSettings,
  radii: Radii,
): MapModel {
  const n = project.members.length;
  const directed = result.view === 'directed';
  const ref = result.refs[settings.layer];
  const layerDef = project.layers.find((l) => l.key === settings.layer);
  const layerLabel = layerDef?.label ?? settings.layer;

  // Node size: area proportional to the metric between the smallest and largest defined value.
  const column = ref?.node.columns[settings.sizeMetric];
  let lo = Infinity;
  let hi = -Infinity;
  let anyUndefined = false;
  for (let i = 0; i < n; i++) {
    const v = column ? (column[i] as number) : NaN;
    if (Number.isFinite(v)) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    } else anyUndefined = true;
  }
  const radius = (v: number) => {
    if (!Number.isFinite(v)) return radii.nodeUndefined;
    const t = hi > lo ? (v - lo) / (hi - lo) : 0.5;
    const a = radii.nodeMin ** 2 + (radii.nodeMax ** 2 - radii.nodeMin ** 2) * t;
    return Math.sqrt(a);
  };

  const fill = fillGroups(project, result, settings, layerLabel);
  const query = settings.search.trim().toLocaleLowerCase('en-GB');
  const searchMatches = query === '' ? null : new Set<number>();

  const nodes: MapNode[] = project.members.map((m, i) => {
    const sizeValue = column ? (column[i] as number) : NaN;
    if (searchMatches && m.display_name.toLocaleLowerCase('en-GB').includes(query))
      searchMatches.add(i);
    return {
      index: i,
      id: m.id,
      name: m.display_name,
      visible: memberMatchesFilters(m.attributes, settings.filters),
      sizeValue,
      radius: radius(sizeValue),
      group: fill.memberGroup[i] ?? 0,
    };
  });
  if (searchMatches) for (const i of searchMatches) if (!nodes[i]?.visible) searchMatches.delete(i);

  const weights = ref?.weights;
  const valenceOn = isToggledOn(settings, 'valence');
  const valence = valenceOn ? valenceMatrix(project, settings) : null;
  const formal = roleLayer(project, 'formal');
  const informal = roleLayer(project, 'informal');
  const fi = result.multiplex?.formalInformal ?? null;
  const styleShown =
    fi !== null &&
    formal !== undefined &&
    informal !== undefined &&
    isToggledOn(settings, formal.key) &&
    isToggledOn(settings, informal.key);
  const fW = formal ? result.refs[formal.key]?.weights : undefined;
  const gW = informal ? result.refs[informal.key]?.weights : undefined;

  const edges: MapEdge[] = [];
  const neighbours: number[][] = Array.from({ length: n }, () => []);
  const present = new Set<EdgeStyle>();
  let anyValenceMissing = false;
  const hidden = hiddenLayerWeights(project, result, settings);
  const hiddenWeights = hidden.flatMap((h) => h.weights);
  const shown = (k: number) => {
    if (hiddenWeights.some((hw) => (hw[k] as number) > 0)) return false;
    const w = weights ? (weights[k] as number) : NaN;
    return w > 0 && w >= settings.threshold;
  };
  if (weights) {
    for (let i = 0; i < n; i++) {
      if (!nodes[i]?.visible) continue;
      for (let j = directed ? 0 : i + 1; j < n; j++) {
        if (i === j || !nodes[j]?.visible) continue;
        const k = i * n + j;
        if (!shown(k)) continue;
        const w = weights[k] as number;
        const v = valence ? (valence[k] as number) : NaN;
        if (valence && Number.isNaN(v)) anyValenceMissing = true;
        const style: EdgeStyle = styleShown
          ? edgeStyle(
              fi.classes[k] as number,
              fW ? (fW[k] as number) : NaN,
              gW ? (gW[k] as number) : NaN,
            )
          : 'plain';
        present.add(style);
        edges.push({
          source: i,
          target: j,
          weight: w,
          width: radii.edgeMin + (radii.edgeMax - radii.edgeMin) * w,
          valence: v,
          style,
          reciprocated: directed && shown(j * n + i),
        });
        const ni = neighbours[i] as number[];
        const nj = neighbours[j] as number[];
        if (!ni.includes(j)) ni.push(j);
        if (!nj.includes(i)) nj.push(i);
      }
    }
  }
  const order: EdgeStyle[] = ['formal', 'informal', 'both', 'neither'];

  return {
    n,
    directed,
    layer: settings.layer,
    layerLabel,
    nodes,
    edges,
    neighbours,
    size: { metric: settings.sizeMetric, lo, hi, anyUndefined },
    fill: {
      kind: fill.kind,
      label: fill.label,
      groups: fill.groups,
      otherGroups: fill.otherGroups,
    },
    valenceShown: valence !== null,
    anyValenceMissing,
    styleShown,
    stylesPresent: order.filter((s) => present.has(s)),
    threshold: settings.threshold,
    hiddenLayers: hidden.map((h) => h.key),
    hiddenLabels: hidden.map((h) => project.layers.find((l) => l.key === h.key)?.label ?? h.key),
    searchMatches,
  };
}

/**
 * Keyboard traversal (spec §12): from member `from`, the neighbour whose
 * direction best matches the arrow key; when no neighbour lies that way, the
 * nearest visible member that way, so members without ties stay reachable.
 */
export function nextMember(
  model: MapModel,
  positions: readonly { x: number; y: number }[],
  from: number,
  dir: { x: number; y: number },
): number | null {
  const p = positions[from];
  if (!p) return null;
  const pick = (candidates: Iterable<number>, minCos: number) => {
    let best: number | null = null;
    let bestScore = Infinity;
    for (const j of candidates) {
      const q = positions[j];
      if (j === from || !q || !model.nodes[j]?.visible) continue;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist === 0) continue;
      const cos = (dx * dir.x + dy * dir.y) / dist;
      if (cos < minCos) continue;
      // Prefer members straight ahead, then near ones.
      const score = dist * (2 - cos);
      if (score < bestScore) {
        bestScore = score;
        best = j;
      }
    }
    return best;
  };
  // Neighbours within 90° of the arrow first, then anyone within 45°.
  return (
    pick(model.neighbours[from] ?? [], 1e-9) ??
    pick(
      model.nodes.map((node) => node.index),
      Math.SQRT1_2 - 1e-9,
    )
  );
}
