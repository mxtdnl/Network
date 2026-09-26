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
import type { AnalysisResult } from '../engineClient';
import { readNoticeSeen, writeNoticeSeen } from './noticeStorage';

export type CentreView = 'map' | 'matrix' | 'table' | 'compare';
export type RightPanel = 'member' | 'insights' | 'coverage';

export interface UiState {
  centreView: CentreView;
  rightPanel: RightPanel;
  anonymise: boolean;
  firstRunNoticeSeen: boolean;
  noticeOpen: boolean;
  importOpen: boolean;
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
}

export interface SelectionState {
  /** The member whose panel is open. */
  member: MemberId | null;
  hovered: MemberId | null;
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

  setMap: (patch: Partial<MapSettings>) => void;
  selectMember: (id: MemberId | null) => void;
  setHovered: (id: MemberId | null) => void;
  setResults: (patch: Partial<ResultsState>) => void;
}

export type AppState = {
  ui: UiState;
  data: DataState;
  map: MapSettings;
  selection: SelectionState;
  results: ResultsState;
} & Actions;

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
  };
}

export function initialDataState(): DataState {
  return { project: null, revision: 0, matrixLayer: null, persistence: 'off', status: null };
}

const now = () => new Date().toISOString();

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
    selection: { member: null, hovered: null },
    results: { status: 'idle', current: null, error: null },

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
      set({
        map: { ...initialMapSettings(), fill },
        selection: { member: null, hovered: null },
        results: { status: 'idle', current: null, error: null },
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
  };
});
