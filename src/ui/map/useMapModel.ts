// The map model for the current project, analysis result and map settings,
// shared by the map, its legend, the controls and the member panel.

import { useMemo } from 'react';
import type { AttributeDefinition, Project } from '../../data/schema';
import type { AnalysisResult } from '../engineClient';
import { useAppStore, type LayoutKind, type MapSettings } from '../state/store';
import { ForceLayout, hierarchyParents, type LayoutSpec } from './layout';
import {
  NOT_RECORDED,
  attributeValues,
  buildMapModel,
  groupAttributes,
  roleLayer,
  type MapModel,
} from './model';
import { readMapTheme, type MapTheme } from './theme';
import { mapCopy } from '../copy/map';

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
  const layout: LayoutKind =
    settings.layout === 'hierarchy' && !hierarchyAvailable(project) ? 'force' : settings.layout;
  const ego =
    settings.ego && project.members.some((m) => m.id === settings.ego?.member)
      ? settings.ego
      : null;
  return {
    ...settings,
    layer,
    sizeMetric,
    fill,
    layout,
    groupBy: groupingAttribute(project, settings),
    ego,
  };
}

/** The member-reference attribute that holds formal managers (`manager_id` by default). */
export function managerAttribute(project: Project): AttributeDefinition | undefined {
  const refs = project.attribute_definitions.filter((a) => a.type === 'member_ref');
  return refs.find((a) => a.key === 'manager_id') ?? refs[0];
}

/** The formal hierarchy needs at least one member whose manager is another member. */
export function hierarchyAvailable(project: Project): boolean {
  const attr = managerAttribute(project);
  if (!attr) return false;
  const ids = new Set(project.members.map((m) => m.id));
  return project.members.some((m) => {
    const v = m.attributes[attr.key];
    return v !== null && v !== undefined && v !== m.id && ids.has(v);
  });
}

/** Attribute for the grouped and circular layouts: the chosen one, else team, else the first. */
export function groupingAttribute(project: Project, settings: MapSettings): string | null {
  const attrs = groupAttributes(project);
  if (settings.groupBy && attrs.some((a) => a.key === settings.groupBy)) return settings.groupBy;
  return (attrs.find((a) => a.key === 'team') ?? attrs[0])?.key ?? null;
}

/** Group index per member for an attribute, in display order; members without a value last. */
export function memberGroups(
  project: Project,
  key: string | null,
): { group: number[]; groups: string[] } {
  if (!key) return { group: project.members.map(() => 0), groups: [''] };
  const values = attributeValues(project, key);
  const position = new Map(values.map((v, i) => [v, i]));
  const missing = project.members.some((m) => (m.attributes[key] ?? null) === null);
  const groups = missing ? [...values, NOT_RECORDED] : values;
  const group = project.members.map((m) => {
    const v = m.attributes[key];
    return v === null || v === undefined ? values.length : (position.get(v) ?? values.length);
  });
  return { group, groups };
}

export interface LayoutRequest {
  key: string;
  spec: LayoutSpec;
  weights: Float64Array | undefined;
}

/** The layout for the current settings; the map and the comparison views share it. */
export function layoutRequest(
  project: Project,
  result: AnalysisResult,
  settings: MapSettings,
  revision: number,
): LayoutRequest {
  const names = project.members.map((m) => m.display_name);
  const weights = result.refs[settings.layer]?.weights;
  const base = `${String(revision)}|${String(project.members.length)}`;
  switch (settings.layout) {
    case 'grouped':
    case 'circular': {
      const { group, groups } = memberGroups(project, settings.groupBy);
      const labels = groups.map((g) => (g === NOT_RECORDED ? mapCopy.legend.notRecorded : g));
      const weightKey =
        settings.layout === 'grouped' ? `|${result.inputKey}|${settings.layer}` : '';
      return {
        key: `${base}|${settings.layout}|${settings.groupBy ?? ''}${weightKey}`,
        spec: { kind: settings.layout, group, groups: labels, names },
        weights,
      };
    }
    case 'hierarchy': {
      const attr = managerAttribute(project);
      const parent = hierarchyParents(
        project.members.map((m) => (attr ? (m.attributes[attr.key] ?? null) : null)),
        project.members.map((m) => m.id),
      );
      return { key: `${base}|hierarchy`, spec: { kind: 'hierarchy', parent, names }, weights };
    }
    default:
      return {
        key: `${base}|force|${result.inputKey}|${settings.layer}`,
        spec: { kind: 'force' },
        weights,
      };
  }
}

/** One layout for the whole app, so the map and the comparison views place members alike. */
export const sharedLayout = new ForceLayout();

export interface MapData {
  project: Project;
  result: AnalysisResult;
  settings: MapSettings;
  /** Members and ties after filters and the ego view: what every linked view shows. */
  model: MapModel;
  /** What the map draws: `model`, with the informal overlay on the hierarchy and the simulated removal. */
  mapModel: MapModel;
  layout: LayoutRequest;
  theme: MapTheme;
}

export function useMapData(): MapData | null {
  const project = useAppStore((s) => s.data.project);
  const revision = useAppStore((s) => s.data.revision);
  const result = useAppStore((s) => s.results.current);
  const raw = useAppStore((s) => s.map);
  const removal = useAppStore((s) =>
    s.tools.resilience && s.tools.showRemoval ? s.tools.removal : null,
  );
  return useMemo(() => {
    if (!project || !result || result.memberIds.length !== project.members.length) return null;
    const theme = mapTheme();
    const settings = effectiveSettings(project, result, raw);
    const model = buildMapModel(project, result, settings, theme);
    const informal = roleLayer(project, 'informal');
    const overlay =
      settings.layout === 'hierarchy' && informal && result.refs[informal.key]
        ? informal.key
        : undefined;
    const mapModel =
      overlay || (removal && removal.length > 0)
        ? buildMapModel(project, result, settings, theme, {
            ...(overlay ? { edgeLayer: overlay } : {}),
            ...(removal ? { removed: new Set(removal) } : {}),
          })
        : model;
    const layout = layoutRequest(project, result, settings, revision);
    return { project, result, settings, model, mapModel, layout, theme };
  }, [project, revision, result, raw, removal]);
}
