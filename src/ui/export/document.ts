// The exported map as one renderer-neutral picture (CLAUDE.md D50, D107): the
// map's scene, the legend built from the same model, and the caption, laid out
// side by side and turned into a flat list of drawing primitives. The PNG, SVG
// and PDF exports all draw this list, so the three show exactly the same
// picture; only the backend differs (export/canvas.ts, svg.ts, pdf.ts).

import { legendSections, type LegendExtras, type LegendSection } from '../map/legend';
import type { MapModel } from '../map/model';
import type { Scene } from '../map/scene';
import type { ExportTheme } from './theme';

export type FontRole = 'label' | 'group' | 'regular' | 'medium';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Primitive =
  | {
      kind: 'lines';
      stroke: string;
      width: number;
      dash: number[];
      alpha: number;
      /** x1, y1, x2, y2 per segment. */
      coords: number[];
    }
  | { kind: 'polygon'; fill: string; alpha: number; points: number[] }
  | {
      kind: 'circle';
      x: number;
      y: number;
      r: number;
      fill: string | null;
      stroke: string | null;
      strokeWidth: number;
      dash: number[];
      alpha: number;
    }
  | { kind: 'rect'; x: number; y: number; width: number; height: number; fill: string }
  | { kind: 'polyline'; points: number[]; stroke: string; width: number }
  | {
      kind: 'text';
      x: number;
      y: number;
      text: string;
      role: FontRole;
      size: number;
      fill: string;
      align: 'left' | 'center' | 'right';
      /** A paper-coloured outline under the text, so labels stay readable over ties. */
      halo: { colour: string; width: number } | null;
      alpha: number;
    };

export interface Layer {
  /** Items outside this rectangle are not drawn (the map area); null draws everything. */
  clip: Rect | null;
  items: Primitive[];
}

export interface MapDocument {
  width: number;
  height: number;
  background: string;
  layers: Layer[];
  /** Every piece of text in the picture, for the SVG's accessible description and for tests. */
  title: string;
}

/** Width of a text in CSS pixels, for a font role and size. */
export type Measure = (text: string, role: FontRole, size: number) => number;

/** A rough measure (half an em per character) for tests without a canvas. */
export const roughMeasure: Measure = (text, role, size) =>
  text.length * size * (role === 'label' ? 0.45 : 0.5);

// ---------------------------------------------------------------- the scene

/** The map's scene as primitives, drawn as the canvas painter draws it (map/canvas.ts). */
export function scenePrimitives(scene: Scene): Primitive[] {
  const t = scene.theme;
  const out: Primitive[] = [];
  for (const b of scene.lines) {
    out.push({
      kind: 'lines',
      stroke: b.stroke,
      width: b.width,
      dash: b.dash,
      alpha: b.alpha,
      coords: b.coords,
    });
  }
  for (const a of scene.arrows) {
    for (let i = 0; i < a.coords.length; i += 6) {
      out.push({ kind: 'polygon', fill: a.fill, alpha: a.alpha, points: a.coords.slice(i, i + 6) });
    }
  }
  const dash = [t.dash / 2, t.dash / 2];
  for (const n of scene.nodes) {
    out.push({
      kind: 'circle',
      x: n.x,
      y: n.y,
      r: n.r,
      fill: n.fill,
      stroke: n.stroke,
      strokeWidth: n.strokeWidth,
      dash: n.dashed ? dash : [],
      alpha: n.alpha,
    });
  }
  const ring = (x: number, y: number, r: number, stroke: string, width: number): Primitive => ({
    kind: 'circle',
    x,
    y,
    r,
    fill: null,
    stroke,
    strokeWidth: width,
    dash: [],
    alpha: 1,
  });
  for (const r of scene.rings) {
    out.push(ring(r.x, r.y, r.r + t.line + t.focusWidth / 2, t.paper, t.focusWidth));
    out.push(ring(r.x, r.y, r.r + t.line + (t.focusWidth * 3) / 2, t.ink, t.focusWidth));
  }
  for (const r of scene.groupRings) {
    out.push(ring(r.x, r.y, r.r + t.line + t.focusWidth / 2, t.paper, t.focusWidth));
    out.push(ring(r.x, r.y, r.r + t.line + t.focusWidth, t.ink, t.line));
  }
  for (const l of scene.labels) {
    out.push({
      kind: 'text',
      x: l.x,
      y: l.y,
      text: l.text,
      role: 'label',
      size: t.labelSize,
      fill: t.ink,
      align: l.align ?? 'center',
      halo: { colour: t.paper, width: t.focusWidth * 2 },
      alpha: l.alpha,
    });
  }
  for (const l of scene.groupLabels) {
    out.push({
      kind: 'text',
      x: l.x,
      y: l.y,
      text: l.text,
      role: 'group',
      size: t.groupSize,
      fill: t.graphite,
      align: 'center',
      halo: { colour: t.paper, width: t.focusWidth * 2 },
      alpha: 1,
    });
  }
  return out;
}

/** Moves primitives by (dx, dy). */
export function translate(items: readonly Primitive[], dx: number, dy: number): Primitive[] {
  const shift = (c: readonly number[]) => c.map((v, i) => v + (i % 2 === 0 ? dx : dy));
  return items.map((p): Primitive => {
    switch (p.kind) {
      case 'lines':
        return { ...p, coords: shift(p.coords) };
      case 'polygon':
      case 'polyline':
        return { ...p, points: shift(p.points) };
      case 'circle':
      case 'rect':
      case 'text':
        return { ...p, x: p.x + dx, y: p.y + dy };
    }
  });
}

// --------------------------------------------------------------- text wrap

/** Breaks text into lines no wider than `width`; a single word wider than that stays whole. */
export function wrap(text: string, width: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter((w) => w !== '');
    let line = '';
    for (const word of words) {
      const next = line === '' ? word : `${line} ${word}`;
      if (line !== '' && measure(next) > width) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

// ------------------------------------------------------------------ legend

const VALENCE_STEPS = [-3, -2, -1, 0, 1, 2, 3];

interface Item {
  width: number;
  height: number;
  /** Draws the item with its top left corner at (x, y). */
  draw: (x: number, y: number) => Primitive[];
}

/** The legend as primitives in a column `width` wide, starting at (0, 0); returns its height. */
export function legendPrimitives(
  model: MapModel,
  theme: ExportTheme,
  extras: LegendExtras | null,
  width: number,
  measure: Measure,
): { items: Primitive[]; height: number } {
  const t = theme.map;
  const L = theme.legend;
  const sections = legendSections(model, t, extras);
  const out: Primitive[] = [];
  let y = 0;
  const text = (
    x: number,
    baseline: number,
    s: string,
    role: FontRole,
    fill: string,
  ): Primitive => ({
    kind: 'text',
    x,
    y: baseline,
    text: s,
    role,
    size: L.size,
    fill,
    align: 'left',
    halo: null,
    alpha: 1,
  });
  // Baseline of a line of legend text whose box starts at `top`.
  const baseline = (top: number) => top + (L.line + L.size * 0.7) / 2;
  const lines = (s: string, role: FontRole, fill: string) => {
    for (const line of wrap(s, width, (x) => measure(x, role, L.size))) {
      out.push(text(0, baseline(y), line, role, fill));
      y += L.line;
    }
  };

  const box = t.nodeMax * 2 + t.line * 2;
  const lineW = box * 1.5;
  const labelled = (graphicW: number, graphicH: number, label: string) => {
    const role: FontRole = 'regular';
    const lw = label === '' ? 0 : measure(label, role, L.size);
    const h = Math.max(graphicH, L.line);
    return (graphic: (x: number, cy: number) => Primitive[]): Item => ({
      width: graphicW + (label === '' ? 0 : theme.legendItemGap + lw),
      height: h,
      draw: (x, top) => [
        ...graphic(x, top + h / 2),
        ...(label === ''
          ? []
          : [
              text(
                x + graphicW + theme.legendItemGap,
                baseline(top + (h - L.line) / 2),
                label,
                role,
                t.graphite,
              ),
            ]),
      ],
    });
  };
  const edge = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    stroke: string,
    w: number,
    dash: number[] = [],
  ): Primitive => ({ kind: 'lines', stroke, width: w, dash, alpha: 1, coords: [x1, y1, x2, y2] });
  const node = (cx: number, cy: number, r: number, alpha = 1): Primitive => ({
    kind: 'circle',
    x: cx,
    y: cy,
    r,
    fill: theme.field,
    stroke: t.ink,
    strokeWidth: t.line,
    dash: [],
    alpha,
  });

  const flow = (items: Item[], list: boolean) => {
    // Items run along a row and wrap; a list puts one item per row.
    let x = 0;
    let rowH = 0;
    for (const item of items) {
      if (x > 0 && (list || x + item.width > width)) {
        y += rowH;
        x = 0;
        rowH = 0;
      }
      out.push(...item.draw(x, y));
      x += item.width + theme.legendRowGap;
      rowH = Math.max(rowH, item.height);
    }
    y += rowH;
  };

  const samples = (section: LegendSection): Item[] => {
    switch (section.kind) {
      case 'size':
        return [
          ...section.samples.map((s) =>
            labelled(
              s.radius * 2 + t.line * 2,
              box,
              s.label,
            )((x, cy) => [node(x + s.radius + t.line, cy, s.radius)]),
          ),
          ...(section.notDefined
            ? [
                labelled(
                  box,
                  box,
                  section.notDefined.label,
                )((x, cy) => [
                  node(x + box / 2, cy, section.notDefined?.radius ?? t.nodeUndefined),
                ]),
              ]
            : []),
        ];
      case 'fill':
        return section.items.map((item) =>
          labelled(
            theme.legendDot,
            theme.legendDot,
            item.label,
          )((x, cy) => [
            {
              kind: 'circle',
              x: x + theme.legendDot / 2,
              y: cy,
              r: theme.legendDot / 2 - t.line / 2,
              fill: item.hue >= 0 ? (t.categorical[item.hue] ?? t.other) : t.other,
              stroke: t.ink,
              strokeWidth: t.line,
              dash: item.hue >= 0 ? [] : [t.dash / 2, t.dash / 2],
              alpha: 1,
            },
          ]),
        );
      case 'width':
        return section.samples.map((s) =>
          labelled(
            t.swatch,
            L.line,
            s.label,
          )((x, cy) => [edge(x, cy, x + t.swatch, cy, t.stone, s.width)]),
        );
      case 'colour': {
        if (section.steps.length === 0) return [];
        const rampW = t.swatch * VALENCE_STEPS.length;
        const ramp: Item = {
          width: rampW,
          height: theme.rampHeight + L.line,
          draw: (x, top) => [
            ...section.steps.map((s, k): Primitive => ({
              kind: 'rect',
              x: x + k * t.swatch,
              y: top,
              width: t.swatch,
              height: theme.rampHeight,
              fill: t.valence[s.step + 3] ?? t.stone,
            })),
            text(
              x,
              baseline(top + theme.rampHeight),
              section.steps[0]?.label ?? '',
              'regular',
              t.graphite,
            ),
            {
              ...text(x + rampW / 2, baseline(top + theme.rampHeight), '0', 'regular', t.graphite),
              align: 'center',
            },
            {
              ...text(
                x + rampW,
                baseline(top + theme.rampHeight),
                section.steps[section.steps.length - 1]?.label ?? '',
                'regular',
                t.graphite,
              ),
              align: 'right',
            },
          ],
        };
        return [
          ramp,
          ...(section.notRated
            ? [
                labelled(
                  box,
                  L.line,
                  section.notRated,
                )((x, cy) => [edge(x, cy, x + box, cy, t.other, t.edgeMax / 2)]),
              ]
            : []),
        ];
      }
      case 'style':
        return section.items.map((item) => {
          const w = t.edgeMax / 2;
          const dash =
            item.style === 'informal'
              ? [t.dash, t.gap]
              : item.style === 'neither'
                ? [t.dot, t.gap]
                : [];
          const o = (w + t.gap / 2) / 2;
          return labelled(
            lineW,
            L.line,
            item.label,
          )((x, cy) =>
            item.style === 'both'
              ? [
                  edge(x, cy - o, x + lineW, cy - o, t.stone, w),
                  edge(x, cy + o, x + lineW, cy + o, t.stone, w, [t.dash, t.gap]),
                ]
              : [edge(x, cy, x + lineW, cy, t.stone, w, dash)],
          );
        });
      case 'arrows': {
        const head = t.arrow + t.edgeMax / 2;
        return [
          labelled(
            lineW,
            L.line,
            '',
          )((x, cy) => [
            edge(x, cy, x + lineW - head, cy, t.stone, t.edgeMax / 2),
            {
              kind: 'polygon',
              fill: t.stone,
              alpha: 1,
              points: [
                x + lineW,
                cy,
                x + lineW - head,
                cy - head / 2,
                x + lineW - head,
                cy + head / 2,
              ],
            },
          ]),
        ];
      }
      case 'position':
        if (!section.reportingLines) return [];
        return [
          labelled(
            lineW,
            box,
            section.reportingLines,
          )((x, cy) => [
            {
              kind: 'polyline',
              points: [x + t.line, cy - box / 2 + t.line, x + t.line, cy, x + lineW, cy],
              stroke: t.stone,
              width: t.line,
            },
          ]),
        ];
      case 'marks':
        return section.items.map((item) =>
          labelled(
            box,
            box,
            item.label,
          )((x, cy) => {
            if (item.mark === 'highlight')
              return [
                node(x + box / 2 - t.nodeMin - t.line, cy, t.nodeMin),
                node(x + box / 2 + t.nodeMin + t.line, cy, t.nodeMin, t.fade),
              ];
            if (item.mark === 'path') return [edge(x, cy, x + box, cy, t.ink, t.focusWidth)];
            return [
              node(x + box / 2, cy, t.nodeMin),
              {
                kind: 'circle',
                x: x + box / 2,
                y: cy,
                r: t.nodeMin + t.line + t.focusWidth,
                fill: null,
                stroke: t.ink,
                strokeWidth: t.line,
                dash: [],
                alpha: 1,
              },
            ];
          }),
        );
    }
  };

  sections.forEach((section, k) => {
    if (k > 0) y += theme.legendSectionGap;
    lines(section.title, 'medium', t.ink);
    if (section.variable !== '') lines(section.variable, 'regular', t.graphite);
    const list = section.kind === 'fill' || section.kind === 'style' || section.kind === 'marks';
    flow(samples(section), list);
    if (section.kind === 'width')
      for (const note of section.notes) lines(note, 'regular', t.graphite);
  });
  return { items: out, height: y };
}

// ---------------------------------------------------------------- document

export interface ComposeInput {
  scene: Scene;
  model: MapModel;
  extras: LegendExtras | null;
  theme: ExportTheme;
  caption: string;
  measure: Measure;
  /** Text for the SVG title element (not drawn). */
  title: string;
}

/** Map at the left, legend in a column beside it, caption under both. */
export function composeMap(input: ComposeInput): MapDocument {
  const { scene, theme, measure } = input;
  const pad = theme.padding;
  const gap = theme.gap;
  const legend = legendPrimitives(input.model, theme, input.extras, theme.legendWidth, measure);
  const mapRect: Rect = { x: pad, y: pad, width: scene.width, height: scene.height };
  const width = pad + scene.width + gap + theme.legendWidth + pad;
  let y = pad + Math.max(scene.height, legend.height);
  const captionItems: Primitive[] = [];
  const caption = input.caption.trim();
  if (caption !== '') {
    y += gap;
    const C = theme.caption;
    for (const line of wrap(caption, width - pad * 2, (s) => measure(s, 'regular', C.size))) {
      captionItems.push({
        kind: 'text',
        x: pad,
        y: y + (C.line + C.size * 0.7) / 2,
        text: line,
        role: 'regular',
        size: C.size,
        fill: theme.map.ink,
        align: 'left',
        halo: null,
        alpha: 1,
      });
      y += C.line;
    }
  }
  return {
    width,
    height: y + pad,
    background: theme.map.paper,
    title: input.title,
    layers: [
      { clip: mapRect, items: translate(scenePrimitives(scene), pad, pad) },
      {
        clip: null,
        items: translate(legend.items, pad + scene.width + gap, pad),
      },
      { clip: null, items: captionItems },
    ],
  };
}

/** Every text drawn in the document, in drawing order. */
export function documentText(doc: MapDocument): string[] {
  return doc.layers.flatMap((l) => l.items.flatMap((p) => (p.kind === 'text' ? [p.text] : [])));
}

/** Every colour used in the document. */
export function documentColours(doc: MapDocument): Set<string> {
  const out = new Set<string>();
  for (const l of doc.layers) {
    for (const p of l.items) {
      if (p.kind === 'lines' || p.kind === 'polyline') out.add(p.stroke.toLowerCase());
      if (p.kind === 'polygon' || p.kind === 'rect' || p.kind === 'text')
        out.add(p.fill.toLowerCase());
      if (p.kind === 'circle') {
        if (p.fill) out.add(p.fill.toLowerCase());
        if (p.stroke) out.add(p.stroke.toLowerCase());
      }
    }
  }
  return out;
}
