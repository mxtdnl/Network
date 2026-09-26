// The map model for the current project, analysis result and map settings,
// shared by the map, its legend, the controls and the member panel.

import { useMemo } from 'react';
import type { Project } from '../../data/schema';
import type { AnalysisResult } from '../engineClient';
import { useAppStore, type MapSettings } from '../state/store';
import { buildMapModel, type MapModel } from './model';
import { readMapTheme, type MapTheme } from './theme';

let cachedTheme: MapTheme | null = null;

/** Map tokens, read from the stylesheet once. */
export function mapTheme(): MapTheme {
  cachedTheme ??= readMapTheme();
  return cachedTheme;
}

/** Layers the map can draw ties from: the composite and every unsigned layer the engine analysed. */
export function drawableLayers(project: Project, result: AnalysisResult): string[] {
  const refs = result.refOrder.filter((ref) => {
    const r = result.refs[ref];
    return r !== undefined && (r.kind === 'unsigned' || r.kind === 'composite');
  });
  const order = new Map(project.layers.map((l, i) => [l.key, i]));
  return refs.sort((a, b) =>
    a === 'composite' ? -1 : b === 'composite' ? 1 : (order.get(a) ?? 0) - (order.get(b) ?? 0),
  );
}

/** Settings with the layer and metric corrected to ones the current result has. */
export function effectiveSettings(
  project: Project,
  result: AnalysisResult,
  settings: MapSettings,
): MapSettings {
  const layers = drawableLayers(project, result);
  const layer = layers.includes(settings.layer) ? settings.layer : (layers[0] ?? settings.layer);
  const columns = result.refs[layer]?.node.columns ?? {};
  const sizeMetric = settings.sizeMetric in columns ? settings.sizeMetric : 'betweenness';
  const fill =
    settings.fill.kind === 'attribute' &&
    !project.attribute_definitions.some((a) => a.key === (settings.fill as { key: string }).key)
      ? ({ kind: 'community' } as const)
      : settings.fill;
  return { ...settings, layer, sizeMetric, fill };
}

export interface MapData {
  project: Project;
  result: AnalysisResult;
  settings: MapSettings;
  model: MapModel;
  theme: MapTheme;
}

export function useMapData(): MapData | null {
  const project = useAppStore((s) => s.data.project);
  const result = useAppStore((s) => s.results.current);
  const raw = useAppStore((s) => s.map);
  return useMemo(() => {
    if (!project || !result || result.memberIds.length !== project.members.length) return null;
    const theme = mapTheme();
    const settings = effectiveSettings(project, result, raw);
    const model = buildMapModel(project, result, settings, theme);
    return { project, result, settings, model, theme };
  }, [project, result, raw]);
}
