// Legend content derived from the map model, so the legend always shows the
// encodings in use (spec §8: every encoding is explained in a persistent
// legend). Pure data: the on-screen legend renders it, and the Phase 7 SVG
// and PNG exports will compose the same entries.

import { formatScale, formatValue, formatWeight, mapCopy } from '../copy/map';
import { metricCopy } from '../copy/metrics';
import type { EdgeStyle, MapModel } from './model';

const L = mapCopy.legend;

export type LegendSection =
  | {
      kind: 'size';
      title: string;
      variable: string;
      samples: { radius: number; label: string }[];
      notDefined: { radius: number; label: string } | null;
    }
  | {
      kind: 'fill';
      title: string;
      variable: string;
      /** hue: palette index, or -1 for the grey used by "Other" and "Not recorded" (dashed outline). */
      items: { hue: number; label: string }[];
    }
  | {
      kind: 'width';
      title: string;
      variable: string;
      samples: { width: number; label: string }[];
      notes: string[];
    }
  | {
      kind: 'colour';
      title: string;
      variable: string;
      /** Seven steps, −3 … +3, or empty when valence is hidden. */
      steps: { step: number; label: string }[];
      notRated: string | null;
    }
  | { kind: 'style'; title: string; variable: string; items: { style: EdgeStyle; label: string }[] }
  | { kind: 'arrows'; title: string; variable: string };

export interface LegendRadii {
  nodeMin: number;
  nodeMax: number;
  nodeUndefined: number;
  edgeMin: number;
  edgeMax: number;
}

export function layerName(model: MapModel): string {
  return model.layer === 'composite' ? mapCopy.controls.composite : model.layerLabel;
}

export function legendSections(model: MapModel, r: LegendRadii): LegendSection[] {
  const sections: LegendSection[] = [];
  const { lo, hi } = model.size;
  const defined = Number.isFinite(lo) && Number.isFinite(hi);
  const mid = (lo + hi) / 2;
  const radiusAt = (t: number) => Math.sqrt(r.nodeMin ** 2 + (r.nodeMax ** 2 - r.nodeMin ** 2) * t);
  sections.push({
    kind: 'size',
    title: L.size,
    variable: metricCopy[model.size.metric].label,
    samples: defined
      ? hi > lo
        ? formatScale([lo, mid, hi]).map((label, i) => ({ radius: radiusAt(i / 2), label }))
        : [{ radius: radiusAt(0.5), label: formatValue(lo) }]
      : [],
    notDefined: model.size.anyUndefined ? { radius: r.nodeUndefined, label: L.notDefined } : null,
  });

  sections.push({
    kind: 'fill',
    title: L.fill,
    variable: model.fill.kind === 'community' ? L.communityOf(layerName(model)) : model.fill.label,
    items: model.fill.groups.map((g) => ({
      hue: g.hue,
      label:
        g.kind === 'value'
          ? g.label
          : g.kind === 'community'
            ? L.community(Number(g.label))
            : g.kind === 'other'
              ? L.other(model.fill.otherGroups)
              : g.kind === 'notRecorded'
                ? L.notRecorded
                : L.noCommunity,
    })),
  });

  sections.push({
    kind: 'width',
    title: L.width,
    variable: L.widthScale(layerName(model)),
    samples: [0.2, 0.6, 1].map((w) => ({
      width: r.edgeMin + (r.edgeMax - r.edgeMin) * w,
      label: formatWeight(w),
    })),
    notes: [
      ...(model.threshold > 0 ? [L.threshold(formatWeight(model.threshold))] : []),
      ...(model.hiddenLayers.length > 0 ? [L.hiddenLayers(model.hiddenLabels)] : []),
    ],
  });

  sections.push({
    kind: 'colour',
    title: L.colour,
    variable: model.valenceShown ? L.valence : L.colourOff,
    steps: model.valenceShown
      ? [-3, -2, -1, 0, 1, 2, 3].map((step) => ({
          step,
          label: step > 0 ? `+${String(step)}` : step < 0 ? `−${String(-step)}` : '0',
        }))
      : [],
    notRated: model.valenceShown && model.anyValenceMissing ? L.valenceNotRated : null,
  });

  if (model.styleShown && model.stylesPresent.length > 0) {
    sections.push({
      kind: 'style',
      title: L.style,
      variable: L.styleVariable,
      items: model.stylesPresent.map((style) => ({
        style,
        label:
          style === 'formal'
            ? L.formal
            : style === 'informal'
              ? L.informal
              : style === 'both'
                ? L.both
                : L.neither,
      })),
    });
  }

  if (model.directed) sections.push({ kind: 'arrows', title: L.arrows, variable: L.arrowsText });
  return sections;
}
