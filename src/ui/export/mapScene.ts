// The map an export shows: the model and scene for the export's project and
// analysis (after the signed-layer exclusion), with names from the names layer
// (after anonymisation), drawn at the positions and zoom on screen.

import { mapCopy } from '../copy/map';
import { ForceLayout, type SavedPoint } from '../map/layout';
import type { LegendExtras } from '../map/legend';
import { buildMapModel, roleLayer, type MapModel } from '../map/model';
import { buildScene, NO_HIGHLIGHT, type Highlight, type Scene, type Transform } from '../map/scene';
import { layoutRequest } from '../map/useMapModel';
import type { Viewport } from '../map/viewport';
import type { MemberId } from '../../data/schema';
import type { ExportContext } from './context';
import type { ExportTheme } from './theme';

export interface MapState {
  /** Layout positions and pins of the map on screen (the shared layout), or null if it was never laid out. */
  positions: readonly SavedPoint[] | null;
  /** The key of the layout those positions belong to. */
  layoutKey: string | null;
  viewport: Viewport | null;
  revision: number;
  /** The subgroup, drawn with its rings as on screen. */
  group: readonly MemberId[];
  /** A shortest path on screen, with the analysis it was found in. */
  path: { members: readonly MemberId[]; inputKey: string } | null;
}

export interface ExportMap {
  model: MapModel;
  scene: Scene;
  extras: LegendExtras;
  /** Plain name of the layer the ties are drawn from. */
  layerName: string;
}

/** Fits the visible members into a canvas of the given size (the map's fit to view, without a legend to avoid). */
export function fitTransform(
  model: MapModel,
  positions: readonly { x: number; y: number }[],
  size: { width: number; height: number },
  theme: ExportTheme,
  circular: boolean,
): Transform {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const node of model.nodes) {
    const p = positions[node.index];
    if (!node.visible || !p) continue;
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  if (!Number.isFinite(x0)) return { x: size.width / 2, y: size.height / 2, k: 1 };
  const t = theme.map;
  const pad = t.nodeMax * 2 + t.labelSize * 2;
  const padX = circular ? pad + t.labelSize * 6 : pad;
  const bw = Math.max(x1 - x0, 1);
  const bh = Math.max(y1 - y0, 1);
  const k = Math.max(
    Number.MIN_VALUE,
    Math.min((size.width - 2 * padX) / bw, (size.height - 2 * pad) / bh),
  );
  return { x: size.width / 2 - (k * (x0 + x1)) / 2, y: size.height / 2 - (k * (y0 + y1)) / 2, k };
}

export function exportMap(
  ctx: ExportContext,
  state: MapState,
  theme: ExportTheme,
  measureLabel: (text: string) => number,
  /** Draw the members fitted into a map of this size instead of the view on screen (the PDF page). */
  fitTo: { width: number; height: number } | null = null,
): ExportMap {
  const { project, result, settings, names } = ctx;
  const t = theme.map;
  const model = buildMapModel(project, result, settings, t, names.byIndex);
  // Over the formal hierarchy the map draws informal collaboration ties (D62).
  const informal = roleLayer(project, 'informal');
  const overlay =
    settings.layout === 'hierarchy' && informal && result.refs[informal.key]
      ? informal.key
      : undefined;
  const mapModel = overlay
    ? buildMapModel(project, result, settings, t, names.byIndex, { edgeLayer: overlay })
    : model;

  // Positions: the map's own when they belong to this layout; otherwise the
  // layout is run again, starting from where members were drawn, so an export
  // that leaves layers out places members by the ties it shows.
  const request = layoutRequest(project, result, settings, state.revision, names);
  const layout = new ForceLayout();
  const onScreen = state.positions?.length === project.members.length ? state.positions : null;
  const same = onScreen !== null && state.layoutKey === request.key;
  if (onScreen) layout.seed(onScreen);
  const radii = model.nodes.map((n) => n.radius);
  if (same) {
    layout.update(request.key, project.members.length, request.weights, radii, request.spec);
    layout.seed(onScreen);
  } else {
    layout.update(request.key, project.members.length, request.weights, radii, request.spec);
  }
  const positions = layout.settled;

  const view = fitTo ? null : state.viewport;
  const size =
    fitTo ?? (view ? { width: view.width, height: view.height } : { ...theme.defaultSize });
  const transform =
    view && same
      ? view.transform
      : fitTransform(mapModel, positions, size, theme, settings.layout === 'circular');

  const index = new Map(project.members.map((m, i) => [m.id, i]));
  const indices = (ids: readonly MemberId[]) =>
    ids.map((id) => index.get(id)).filter((i): i is number => i !== undefined);
  const group = new Set(indices(state.group));
  // A path found in another analysis (the one on screen, before layers were left out) is not drawn.
  const path =
    state.path && state.path.inputKey === result.inputKey ? indices(state.path.members) : null;
  const highlight: Highlight = { ...NO_HIGHLIGHT, group, path };
  const scene = buildScene(
    mapModel,
    positions,
    transform,
    size,
    t,
    highlight,
    'all',
    measureLabel,
    layout.annotation,
  );
  const extras: LegendExtras = {
    layout: settings.layout,
    groupBy: project.attribute_definitions.find((a) => a.key === settings.groupBy)?.label ?? '',
    group: group.size,
    path: path !== null && path.length > 1,
    highlight: mapModel.highlighted?.size ?? 0,
  };
  const layerName =
    settings.layer === 'composite'
      ? mapCopy.controls.composite
      : (project.layers.find((l) => l.key === settings.layer)?.label ?? settings.layer);
  return { model: mapModel, scene, extras, layerName };
}
