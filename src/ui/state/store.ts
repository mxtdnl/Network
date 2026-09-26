import { create } from 'zustand';
import { builtinLayer, defaultLayers } from '../../data/defaults';
import { applyRatingChanges, type RatingChange } from '../../data/ratings';
import type {
  AttributeFilter,
  AttributeKey,
  LayerDefinition,
  LayerKey,
  MemberId,
  Project,
} from '../../data/schema';
import type {
  AnalysisResult,
  BootstrapResult,
  PathResult,
  ResilienceResult,
} from '../engineClient';
import { readNoticeSeen, writeNoticeSeen } from './noticeStorage';
import {
  effectiveWeights,
  initialWeightState,
  type Preset,
  type SignedTreatment,
  type WeightState,
} from './presets';

export type CentreView = 'map' | 'matrix' | 'table' | 'compare';
export type RightPanel = 'member' | 'explore' | 'insights' | 'views' | 'coverage';
export type MatrixMode = 'explore' | 'enter';
export type CompareMode = 'layers' | 'formalInformal';

export interface UiState {
  centreView: CentreView;
  rightPanel: RightPanel;
  anonymise: boolean;
  firstRunNoticeSeen: boolean;
  noticeOpen: boolean;
  importOpen: boolean;
  /** The Matrix tab shows the adjacency matrix (explore) or the rating grid (enter). */
  matrixMode: MatrixMode;
  compareMode: CompareMode;
  /** Presentation mode: the saved view on screen, by position in the list; null in the workspace. */
  presentation: { index: number } | null;
}

export interface StatusMessage {
  text: string;
  tone: 'info' | 'error';
}

export type PersistenceStatus = 'off' | 'saving' | 'saved' | 'error';

export interface DataState {
  project: Project | null;
  /** Incremented on every change to the project (plan §1.3). */
  revision: number;
  matrixLayer: LayerKey | null;
  persistence: PersistenceStatus;
  status: StatusMessage | null;
}

/** Node-size metric, named as in the engine's node table (NodeMetricKey). */
export type SizeMetric =
  | 'inStrength'
  | 'outStrength'
  | 'strength'
  | 'inDegree'
  | 'outDegree'
  | 'degree'
  | 'betweenness'
  | 'harmonicIn'
  | 'harmonicOut'
  | 'harmonic'
  | 'eigenvector'
  | 'constraint'
  | 'effectiveSize'
  | 'clustering';

export type NodeFill = { kind: 'attribute'; key: AttributeKey } | { kind: 'community' };

/** Map layouts (spec §8). The hierarchy needs formal manager ids. */
export type LayoutKind = 'force' | 'grouped' | 'circular' | 'hierarchy';

/** Map encodings, filters and the analysis view (plan §1.3 `analysis` and `map`). */
export interface MapSettings {
  view: 'directed' | 'symmetrised';
  symmetrise: 'mean' | 'min' | 'max';
  /** The layer that drives layout attraction, edge width, node size and ranks: a layer key or 'composite'. */
  layer: string;
  sizeMetric: SizeMetric;
  fill: NodeFill;
  /** Display only (plan Q6): ties below this weight on `layer` are hidden. */
  threshold: number;
  /** Layers shown as an encoding: the formal and informal layers (edge style) and valence (edge colour). */
  layerToggles: Record<LayerKey, boolean>;
  /** When true, a layer switched off also hides its ties (CLAUDE.md D59). */
  hideOffLayers: boolean;
  filters: AttributeFilter[];
  search: string;
  layout: LayoutKind;
  /** Attribute for the grouped and circular layouts; null = team, else the first attribute. */
  groupBy: AttributeKey | null;
  /** Pointer mode on the map: pan (and click to select) or draw a lasso around members. */
  tool: 'pan' | 'lasso';
  /** Ego view: only the member and those within `depth` steps on the ties shown. */
  ego: { member: MemberId; depth: 1 | 2 } | null;
  /** Members highlighted by an insight or a saved view; the rest of the map is faded. */
  highlight: MemberId[];
}

export interface SelectionState {
  /** The member whose panel is open. */
  member: MemberId | null;
  hovered: MemberId | null;
  /** A subgroup chosen by multi-select or lasso, shared by every view. */
  group: MemberId[];
}

type Run<T> =
  | { status: 'running'; inputKey: string; result: null; error: null }
  | { status: 'ready'; inputKey: string; result: T; error: null }
  | { status: 'error'; inputKey: string; result: null; error: string };

/** Engine requests made from the explore tools; each result names the analysis it belongs to. */
export interface ToolsState {
  path: ({ from: MemberId; to: MemberId; ref: string } & Run<PathResult | null>) | null;
  /** Members chosen for the resilience simulation. */
  removal: MemberId[];
  resilience: ({ ref: string } & Run<ResilienceResult>) | null;
  /** Whether the map hides the removed members. */
  showRemoval: boolean;
  bootstrap:
    | ({ ref: string; metric: string; progress: number } & (
        Run<BootstrapResult> | { status: 'cancelled'; inputKey: string; result: null; error: null }
      ))
    | null;
}

export interface ResultsState {
  status: 'idle' | 'running' | 'ready' | 'error';
  current: AnalysisResult | null;
  error: string | null;
}

interface Actions {
  setCentreView: (view: CentreView) => void;
  setRightPanel: (panel: RightPanel) => void;
  setAnonymise: (on: boolean) => void;
  openNotice: () => void;
  closeNotice: () => void;
  setImportOpen: (open: boolean) => void;
  setPresentation: (presentation: UiState['presentation']) => void;

  setProject: (project: Project | null, status?: StatusMessage) => void;
  setStatus: (status: StatusMessage | null) => void;
  setPersistence: (status: PersistenceStatus) => void;
  setMatrixLayer: (key: LayerKey) => void;
  setLayerEnabled: (key: LayerKey, enabled: boolean) => void;
  updateLayer: (key: LayerKey, patch: Pick<LayerDefinition, 'label' | 'question_wording'>) => void;
  deleteLayer: (key: LayerKey) => void;
  restoreLayer: (key: LayerKey) => void;
  applyRatings: (variable: LayerKey, changes: readonly RatingChange[]) => void;
  setCoverageThreshold: (threshold: number) => void;
  /**
   * Changes parts of the project the analysis does not read (saved views, the
   * anonymisation setting). The project is saved and persisted as usual, but
   * the revision does not move, so nothing is recalculated or laid out again.
   */
  updateProjectViews: (fn: (p: Project) => Project) => void;
  /** Applies a saved view's state in one step. */
  applyViewState: (patch: {
    map: MapSettings;
    weights: WeightState;
    selection: { member: MemberId | null; group: MemberId[] };
  }) => void;

  setMap: (patch: Partial<MapSettings>) => void;
  selectMember: (id: MemberId | null) => void;
  setHovered: (id: MemberId | null) => void;
  setResults: (patch: Partial<ResultsState>) => void;

  setMatrixMode: (mode: MatrixMode) => void;
  setCompareMode: (mode: CompareMode) => void;
  setPreset: (preset: Preset) => void;
  setLayerWeight: (key: LayerKey, value: number) => void;
  setTreatment: (key: LayerKey, treatment: SignedTreatment) => void;
  setGroup: (ids: MemberId[]) => void;
  toggleGroupMember: (id: MemberId) => void;
  setTools: (patch: Partial<ToolsState>) => void;
}

export type AppState = {
  ui: UiState;
  data: DataState;
  map: MapSettings;
  selection: SelectionState;
  results: ResultsState;
  weights: WeightState;
  tools: ToolsState;
} & Actions;

export function initialToolsState(): ToolsState {
  return { path: null, removal: [], resilience: null, showRemoval: true, bootstrap: null };
}

export function initialMapSettings(): MapSettings {
  return {
    view: 'directed',
    symmetrise: 'mean',
    layer: 'composite',
    sizeMetric: 'betweenness',
    fill: { kind: 'attribute', key: 'team' },
    threshold: 0,
    layerToggles: {},
    hideOffLayers: false,
    filters: [],
    search: '',
    layout: 'force',
    groupBy: null,
    tool: 'pan',
    ego: null,
    highlight: [],
  };
}

// The same metric in the other view: in- and out- columns become the single
// symmetrised column and back (CLAUDE.md D39).
const SYMMETRISED_METRIC: Partial<Record<SizeMetric, SizeMetric>> = {
  inStrength: 'strength',
  outStrength: 'strength',
  inDegree: 'degree',
  outDegree: 'degree',
  harmonicIn: 'harmonic',
  harmonicOut: 'harmonic',
};
const DIRECTED_METRIC: Partial<Record<SizeMetric, SizeMetric>> = {
  strength: 'inStrength',
  degree: 'inDegree',
  harmonic: 'harmonicIn',
};

export function metricForView(metric: SizeMetric, view: MapSettings['view']): SizeMetric {
  const table = view === 'directed' ? DIRECTED_METRIC : SYMMETRISED_METRIC;
  return table[metric] ?? metric;
}

export function initialUiState(noticeSeen: boolean): UiState {
  return {
    centreView: 'map',
    rightPanel: 'member',
    anonymise: false,
    firstRunNoticeSeen: noticeSeen,
    noticeOpen: !noticeSeen,
    importOpen: false,
    matrixMode: 'explore',
    compareMode: 'layers',
    presentation: null,
  };
}

export function initialDataState(): DataState {
  return { project: null, revision: 0, matrixLayer: null, persistence: 'off', status: null };
}

const now = () => new Date().toISOString();

/** The weight state as Custom, starting from the current preset's values. */
function toCustom(s: { data: DataState; weights: WeightState }): WeightState {
  if (s.weights.preset === 'custom' || !s.data.project) return { ...s.weights, preset: 'custom' };
  const current = effectiveWeights(s.data.project, s.weights);
  return { preset: 'custom', custom: current.weights, customTreatment: current.signedTreatment };
}

export const useAppStore = create<AppState>()((set, get) => {
  const setUi = (patch: Partial<UiState>) => {
    set((s) => ({ ui: { ...s.ui, ...patch } }));
  };
  const setData = (patch: Partial<DataState>) => {
    set((s) => ({ data: { ...s.data, ...patch } }));
  };
  // Every project change goes through here, so the revision always moves.
  const change = (fn: (p: Project) => Project, status?: StatusMessage) => {
    const { project, revision } = get().data;
    if (!project) return;
    const next = fn(project);
    if (next === project) return;
    setData({
      project: { ...next, meta: { ...next.meta, modified_at: now() } },
      revision: revision + 1,
      ...(status ? { status } : {}),
    });
  };
  const mapLayers = (fn: (layers: LayerDefinition[]) => LayerDefinition[]) => (p: Project) => ({
    ...p,
    layers: fn(p.layers),
  });

  return {
    ui: initialUiState(readNoticeSeen()),
    data: initialDataState(),
    map: initialMapSettings(),
    selection: { member: null, hovered: null, group: [] },
    results: { status: 'idle', current: null, error: null },
    weights: initialWeightState(),
    tools: initialToolsState(),

    // A status message describes the last action; moving to another view
    // starts something new, so the message is cleared rather than left stale.
    setCentreView: (centreView) => {
      setUi({ centreView });
      setData({ status: null });
    },
    setRightPanel: (rightPanel) => {
      setUi({ rightPanel });
      setData({ status: null });
    },
    setAnonymise: (anonymise) => {
      setUi({ anonymise });
      const { project } = get().data;
      if (project && project.settings.anonymise !== anonymise) {
        setData({ project: { ...project, settings: { ...project.settings, anonymise } } });
      }
    },
    openNotice: () => {
      setUi({ noticeOpen: true });
    },
    closeNotice: () => {
      writeNoticeSeen();
      setUi({ noticeOpen: false, firstRunNoticeSeen: true });
    },
    setImportOpen: (importOpen) => {
      setUi({ importOpen });
    },
    setPresentation: (presentation) => {
      setUi({ presentation });
    },

    setProject: (project, status) => {
      const firstEnabled = project?.layers.find((l) => l.enabled)?.key ?? null;
      setData({
        project,
        revision: get().data.revision + 1,
        matrixLayer: firstEnabled,
        status: status ?? null,
      });
      // A new project starts from the default encodings; filters and the
      // selection name members and categories of the old one.
      const fill = project?.attribute_definitions.some((a) => a.key === 'team')
        ? initialMapSettings().fill
        : ({ kind: 'community' } as const);
      // A project saved with names hidden opens with names hidden.
      if (project?.settings.anonymise) setUi({ anonymise: true });
      set({
        map: { ...initialMapSettings(), fill },
        selection: { member: null, hovered: null, group: [] },
        results: { status: 'idle', current: null, error: null },
        weights: initialWeightState(),
        tools: initialToolsState(),
      });
    },
    setStatus: (status) => {
      setData({ status });
    },
    setPersistence: (persistence) => {
      setData({ persistence });
    },
    setMatrixLayer: (matrixLayer) => {
      setData({ matrixLayer });
    },
    setLayerEnabled: (key, enabled) => {
      change(mapLayers((layers) => layers.map((l) => (l.key === key ? { ...l, enabled } : l))));
      const { project, matrixLayer } = get().data;
      const current = project?.layers.find((l) => l.key === matrixLayer);
      if (!current?.enabled) {
        setData({ matrixLayer: project?.layers.find((l) => l.enabled)?.key ?? null });
      }
    },
    updateLayer: (key, patch) => {
      change(mapLayers((layers) => layers.map((l) => (l.key === key ? { ...l, ...patch } : l))));
    },
    deleteLayer: (key) => {
      change((p) => {
        const layer = p.layers.find((l) => l.key === key);
        if (!layer || layer.core) return p; // core layers are never deleted
        return {
          ...p,
          layers: p.layers.filter((l) => l.key !== key),
          ties: p.ties.filter((t) => t.variable !== key),
        };
      });
      if (get().data.matrixLayer === key) {
        setData({ matrixLayer: get().data.project?.layers.find((l) => l.enabled)?.key ?? null });
      }
    },
    restoreLayer: (key) => {
      const layer = builtinLayer(key);
      if (!layer) return;
      // Built-in layers keep their default order; other layers follow them.
      const order = new Map(defaultLayers().map((l, i) => [l.key, i]));
      const rank = (k: string) => order.get(k) ?? order.size;
      change((p) =>
        p.layers.some((l) => l.key === key)
          ? p
          : { ...p, layers: [...p.layers, layer].sort((a, b) => rank(a.key) - rank(b.key)) },
      );
    },
    applyRatings: (variable, changes) => {
      change((p) => applyRatingChanges(p, variable, changes, now()));
    },
    setCoverageThreshold: (coverage_threshold) => {
      change((p) => ({ ...p, settings: { ...p.settings, coverage_threshold } }));
    },
    updateProjectViews: (fn) => {
      const { project } = get().data;
      if (!project) return;
      const next = fn(project);
      if (next === project) return;
      setData({ project: { ...next, meta: { ...next.meta, modified_at: now() } } });
    },
    applyViewState: ({ map, weights, selection }) => {
      set((s) => ({
        map,
        weights,
        selection: { ...s.selection, member: selection.member, group: [...selection.group] },
        tools: { ...initialToolsState(), removal: [] },
        ui: { ...s.ui, centreView: 'map' },
      }));
    },

    setMap: (patch) => {
      set((s) => {
        const next = { ...s.map, ...patch };
        if (patch.view && patch.sizeMetric === undefined) {
          next.sizeMetric = metricForView(next.sizeMetric, patch.view);
        }
        return { map: next };
      });
    },
    selectMember: (member) => {
      set((s) => ({ selection: { ...s.selection, member } }));
    },
    setHovered: (hovered) => {
      if (get().selection.hovered === hovered) return;
      set((s) => ({ selection: { ...s.selection, hovered } }));
    },
    setResults: (patch) => {
      set((s) => ({ results: { ...s.results, ...patch } }));
    },

    setMatrixMode: (matrixMode) => {
      setUi({ matrixMode });
    },
    setCompareMode: (compareMode) => {
      setUi({ compareMode });
    },
    setPreset: (preset) => {
      set((s) => ({ weights: { ...s.weights, preset } }));
    },
    // Moving a slider or changing a treatment under a preset starts a Custom
    // weighting from that preset's values, so nothing jumps.
    setLayerWeight: (key, value) => {
      set((s) => ({
        weights: { ...toCustom(s), custom: { ...toCustom(s).custom, [key]: value } },
      }));
    },
    setTreatment: (key, treatment) => {
      set((s) => {
        const w = toCustom(s);
        return { weights: { ...w, customTreatment: { ...w.customTreatment, [key]: treatment } } };
      });
    },
    setGroup: (group) => {
      set((s) => ({ selection: { ...s.selection, group: [...new Set(group)] } }));
    },
    toggleGroupMember: (id) => {
      set((s) => {
        const group = s.selection.group.includes(id)
          ? s.selection.group.filter((m) => m !== id)
          : [...s.selection.group, id];
        return { selection: { ...s.selection, group } };
      });
    },
    setTools: (patch) => {
      set((s) => ({ tools: { ...s.tools, ...patch } }));
    },
  };
});
