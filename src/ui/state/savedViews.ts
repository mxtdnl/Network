// Saved views (spec §8): capture the map as it is now, and restore it later or
// step through views in presentation mode. A view holds the weights, the map's
// encodings, filters and layout, each member's position and pin, and the
// selection (schema version 2, data/schema.ts). Views live in the project, so
// they are saved in the .ona.json file; changing them does not re-run the
// analysis (store.updateProjectViews).

import type {
  MemberId,
  Project,
  SavedMapSettings,
  SavedPosition,
  SavedView,
  SavedWeights,
} from '../../data/schema';
import { savedViewsCopy } from '../copy/savedViews';
import type { SavedPoint } from '../map/layout';
import { sharedLayout } from '../map/useMapModel';
import { currentNames } from './names';
import { analysisKey } from './analysisSync';
import {
  initialMapSettings,
  useAppStore,
  type AppState,
  type MapSettings,
  type SizeMetric,
} from './store';
import type { WeightState } from './presets';

let counter = 0;

/** A view id that is unique within the project. */
export function newViewId(project: Project, now = Date.now()): string {
  const used = new Set(project.saved_views.map((v) => v.id));
  let id = '';
  do {
    counter += 1;
    id = `view-${now.toString(36)}-${counter.toString(36)}`;
  } while (used.has(id));
  return id;
}

/** The persistent part of the map settings: everything except search text and the pointer tool. */
export function mapToSaved(map: MapSettings): SavedMapSettings {
  return {
    view: map.view,
    symmetrise: map.symmetrise,
    layer: map.layer,
    sizeMetric: map.sizeMetric,
    fill:
      map.fill.kind === 'attribute'
        ? { kind: 'attribute', key: map.fill.key }
        : { kind: 'community' },
    threshold: map.threshold,
    layerToggles: { ...map.layerToggles },
    hideOffLayers: map.hideOffLayers,
    filters: map.filters.map((f) => ({ key: f.key, values: [...f.values] })),
    layout: map.layout,
    groupBy: map.groupBy,
    ego: map.ego ? { ...map.ego } : null,
    highlight: [...map.highlight],
  };
}

export function savedToMap(saved: SavedMapSettings, project: Project): MapSettings {
  const ids = new Set(project.members.map((m) => m.id));
  return {
    ...initialMapSettings(),
    ...saved,
    // An unknown metric is corrected by the map (effectiveSettings) to one the layer has.
    sizeMetric: saved.sizeMetric as SizeMetric,
    layerToggles: { ...saved.layerToggles },
    filters: saved.filters.map((f) => ({ key: f.key, values: [...f.values] })),
    ego: saved.ego && ids.has(saved.ego.member) ? { ...saved.ego } : null,
    highlight: saved.highlight.filter((id) => ids.has(id)),
  };
}

function weightsToSaved(w: WeightState): SavedWeights {
  return { preset: w.preset, custom: { ...w.custom }, customTreatment: { ...w.customTreatment } };
}

/** Positions by member id from the shared layout; empty when the map has not been drawn. */
export function capturePositions(
  project: Project,
  points: readonly SavedPoint[],
): Record<MemberId, SavedPosition> {
  if (points.length !== project.members.length) return {};
  const out: Record<MemberId, SavedPosition> = {};
  project.members.forEach((m, i) => {
    const p = points[i];
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y))
      out[m.id] = { x: p.x, y: p.y, pinned: p.pinned };
  });
  return out;
}

/** The current state as a saved view. */
export function captureView(name: string, caption = ''): SavedView | null {
  const s = useAppStore.getState();
  const project = s.data.project;
  if (!project) return null;
  return {
    id: newViewId(project),
    name,
    caption,
    created_at: new Date().toISOString(),
    weights: weightsToSaved(s.weights),
    map: mapToSaved(s.map),
    positions: capturePositions(project, sharedLayout.snapshot()),
    selection: { member: s.selection.member, group: [...s.selection.group] },
  };
}

/** A name not yet used by another view: "View 1", "View 2", … */
export function nextViewName(project: Project): string {
  const used = new Set(project.saved_views.map((v) => v.name));
  let k = project.saved_views.length + 1;
  while (used.has(savedViewsCopy.defaultName(k))) k += 1;
  return savedViewsCopy.defaultName(k);
}

const setViews = (fn: (views: SavedView[]) => SavedView[]) => {
  useAppStore.getState().updateProjectViews((p) => ({ ...p, saved_views: fn(p.saved_views) }));
};

export function saveCurrentView(name?: string): SavedView | null {
  const project = useAppStore.getState().data.project;
  if (!project) return null;
  const clean = name?.trim() ?? '';
  const view = captureView(clean === '' ? nextViewName(project) : clean);
  if (!view) return null;
  setViews((views) => [...views, view]);
  useAppStore.getState().setStatus({
    text: savedViewsCopy.saved(currentNames().text(view.name)),
    tone: 'info',
  });
  return view;
}

export function renameView(id: string, name: string): boolean {
  const clean = name.trim();
  if (clean === '') return false;
  setViews((views) => views.map((v) => (v.id === id ? { ...v, name: clean } : v)));
  return true;
}

export function setViewCaption(id: string, caption: string): void {
  setViews((views) =>
    views.map((v) => (v.id === id && v.caption !== caption ? { ...v, caption } : v)),
  );
}

/** Moves a view up (−1) or down (+1) in the list and the presentation order. */
export function moveView(id: string, delta: -1 | 1): void {
  setViews((views) => {
    const i = views.findIndex((v) => v.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= views.length) return views;
    const next = [...views];
    const [moved] = next.splice(i, 1);
    if (moved) next.splice(j, 0, moved);
    return next;
  });
}

export function deleteView(id: string): void {
  const view = useAppStore.getState().data.project?.saved_views.find((v) => v.id === id);
  setViews((views) => views.filter((v) => v.id !== id));
  if (view) {
    useAppStore.getState().setStatus({
      text: savedViewsCopy.deleted(currentNames().text(view.name)),
      tone: 'info',
    });
  }
}

/** Replaces a view's state with the current one, keeping its name and caption. */
export function updateView(id: string): void {
  const current = captureView('');
  if (!current) return;
  setViews((views) =>
    views.map((v) =>
      v.id === id
        ? {
            ...v,
            weights: current.weights,
            map: current.map,
            positions: current.positions,
            selection: current.selection,
          }
        : v,
    ),
  );
}

/** Puts the app in the state a view recorded and shows the map. */
export function restoreView(view: SavedView): void {
  const s = useAppStore.getState();
  const project = s.data.project;
  if (!project) return;
  const ids = new Set(project.members.map((m) => m.id));
  const weights: WeightState = {
    preset: view.weights.preset,
    custom: { ...view.weights.custom },
    customTreatment: { ...view.weights.customTreatment },
  };
  const points = project.members.map((m) => view.positions[m.id] ?? null);
  const hasPositions = points.some((p) => p !== null);
  s.applyViewState({
    map: savedToMap(view.map, project),
    weights,
    selection: {
      member:
        view.selection.member !== null && ids.has(view.selection.member)
          ? view.selection.member
          : null,
      group: view.selection.group.filter((id) => ids.has(id)),
    },
  });
  if (hasPositions) placeWhenAnalysed(points);
}

let waiting: (() => void) | null = null;

/**
 * The force and grouped layouts settle on the analysis's weights, so saved
 * positions are applied once the analysis the view asks for is on screen;
 * applied earlier, the layout would settle again from them when the new
 * weights arrive. The map draws the next model, which picks them up.
 */
function placeWhenAnalysed(points: (SavedPoint | null)[]): void {
  waiting?.();
  waiting = null;
  const key = analysisKey(useAppStore.getState());
  const ready = (st: AppState) =>
    st.results.status !== 'running' && st.results.current?.inputKey === key;
  if (ready(useAppStore.getState())) {
    sharedLayout.requestPositions(points);
    // A new map object makes the map draw again, which applies the positions.
    const st = useAppStore.getState();
    st.setMap({ ...st.map });
    return;
  }
  const stop = useAppStore.subscribe((st) => {
    if (analysisKey(st) !== key) {
      // The user changed something before the analysis finished: the view is no longer on screen.
      stop();
      waiting = null;
    } else if (ready(st)) {
      stop();
      waiting = null;
      sharedLayout.requestPositions(points);
    }
  });
  waiting = stop;
}

export function restoreViewById(id: string): void {
  const s = useAppStore.getState();
  const view = s.data.project?.saved_views.find((v) => v.id === id);
  if (!view) return;
  restoreView(view);
  s.setStatus({ text: savedViewsCopy.restored(currentNames().text(view.name)), tone: 'info' });
}
