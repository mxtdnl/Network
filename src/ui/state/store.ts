import { create } from 'zustand';
import { builtinLayer, defaultLayers } from '../../data/defaults';
import { applyRatingChanges, type RatingChange } from '../../data/ratings';
import type { LayerDefinition, LayerKey, Project } from '../../data/schema';
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
}

export type AppState = { ui: UiState; data: DataState } & Actions;

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
  };
});
