// Engine requests made by the explore tools: shortest path, the resilience
// simulation and the rank-stability bootstrap. Each result records the
// analysis (inputKey) and layer it was computed on. When a new analysis
// arrives (a data, view or weight change), the path and the resilience
// simulation are recomputed, because they are quick; a bootstrap is not
// re-run on its own, because it takes a while: its result is dropped with a
// note asking the analyst to run it again.

import {
  EngineCancelledError,
  type AnalysisResult,
  type BootstrapMetric,
  type BootstrapResult,
  type Operation,
} from '../engineClient';
import type { MemberId } from '../../data/schema';
import { effectiveSettings } from '../map/useMapModel';
import { engineClient } from './analysisSync';
import { useAppStore } from './store';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The layer the map draws ties from, corrected to one the result has. */
function currentRef(result: AnalysisResult): string | null {
  const s = useAppStore.getState();
  if (!s.data.project) return null;
  return effectiveSettings(s.data.project, result, s.map).layer;
}

function currentResult(): AnalysisResult | null {
  const r = useAppStore.getState().results;
  return r.status === 'ready' ? r.current : null;
}

export function findPath(from: MemberId, to: MemberId): void {
  const result = currentResult();
  const s = useAppStore.getState();
  if (!result) return;
  const ref = currentRef(result);
  if (!ref) return;
  const inputKey = result.inputKey;
  s.setTools({
    path: { from, to, ref, status: 'running', inputKey, result: null, error: null },
  });
  engineClient()
    .path(inputKey, ref, from, to)
    .promise.then(
      (path) => {
        const p = useAppStore.getState().tools.path;
        if (p?.from !== from || p.to !== to || p.inputKey !== inputKey) return;
        useAppStore.getState().setTools({
          path: { from, to, ref, status: 'ready', inputKey, result: path, error: null },
        });
      },
      (e: unknown) => {
        if (e instanceof EngineCancelledError) return;
        const p = useAppStore.getState().tools.path;
        if (p?.from !== from || p.to !== to || p.inputKey !== inputKey) return;
        useAppStore.getState().setTools({
          path: { from, to, ref, status: 'error', inputKey, result: null, error: message(e) },
        });
      },
    );
}

export function clearPath(): void {
  useAppStore.getState().setTools({ path: null });
}

export function simulateRemoval(removed: readonly MemberId[] = []): void {
  const result = currentResult();
  const s = useAppStore.getState();
  const ids = removed.length > 0 ? [...removed] : s.tools.removal;
  if (!result || ids.length === 0) return;
  const ref = currentRef(result);
  if (!ref) return;
  const inputKey = result.inputKey;
  s.setTools({
    removal: ids,
    showRemoval: true,
    resilience: { ref, status: 'running', inputKey, result: null, error: null },
  });
  engineClient()
    .resilience(inputKey, ref, ids)
    .promise.then(
      (r) => {
        if (useAppStore.getState().tools.resilience?.inputKey !== inputKey) return;
        useAppStore.getState().setTools({
          resilience: { ref, status: 'ready', inputKey, result: r, error: null },
        });
      },
      (e: unknown) => {
        if (e instanceof EngineCancelledError) return;
        if (useAppStore.getState().tools.resilience?.inputKey !== inputKey) return;
        useAppStore.getState().setTools({
          resilience: { ref, status: 'error', inputKey, result: null, error: message(e) },
        });
      },
    );
}

export function endSimulation(): void {
  useAppStore.getState().setTools({ resilience: null });
}

let bootstrapOp: Operation<BootstrapResult> | null = null;

export function runBootstrap(metric: BootstrapMetric): void {
  const result = currentResult();
  const s = useAppStore.getState();
  const project = s.data.project;
  if (!result || !project) return;
  const ref = currentRef(result);
  if (!ref) return;
  const inputKey = result.inputKey;
  bootstrapOp?.cancel();
  const op = engineClient().bootstrap(
    inputKey,
    {
      ref,
      metric,
      replicates: project.settings.bootstrap.replicates,
      dropFraction: project.settings.bootstrap.drop_fraction,
      seed: project.settings.random_seed,
    },
    (fraction) => {
      const b = useAppStore.getState().tools.bootstrap;
      if (bootstrapOp !== op || b?.status !== 'running') return;
      // The worker reports after every resample; the page shows whole percents, so it
      // re-renders only when that figure changes, or thousands of resamples would
      // keep the main thread too busy to answer Cancel.
      if (Math.floor(fraction * 100) === Math.floor(b.progress * 100)) return;
      useAppStore.getState().setTools({ bootstrap: { ...b, progress: fraction } });
    },
  );
  bootstrapOp = op;
  const base = { ref, metric, inputKey };
  s.setTools({
    bootstrap: { ...base, progress: 0, status: 'running', result: null, error: null },
  });
  op.promise.then(
    (r) => {
      if (bootstrapOp !== op) return;
      bootstrapOp = null;
      useAppStore.getState().setTools({
        bootstrap: { ...base, progress: 1, status: 'ready', result: r, error: null },
      });
    },
    (e: unknown) => {
      if (bootstrapOp !== op) return;
      bootstrapOp = null;
      const progress = useAppStore.getState().tools.bootstrap?.progress ?? 0;
      useAppStore.getState().setTools({
        bootstrap:
          e instanceof EngineCancelledError
            ? { ...base, progress, status: 'cancelled', result: null, error: null }
            : { ...base, progress, status: 'error', result: null, error: message(e) },
      });
    },
  );
}

export function cancelBootstrap(): void {
  bootstrapOp?.cancel();
}

/** Called with every new analysis result. */
export function refreshTools(result: AnalysisResult): void {
  const { tools } = useAppStore.getState();
  if (tools.path && tools.path.inputKey !== result.inputKey) {
    const ids = new Set(result.memberIds);
    if (ids.has(tools.path.from) && ids.has(tools.path.to))
      findPath(tools.path.from, tools.path.to);
    else clearPath();
  }
  if (tools.resilience && tools.resilience.inputKey !== result.inputKey) {
    const ids = new Set(result.memberIds);
    const removal = tools.removal.filter((id) => ids.has(id));
    if (removal.length > 0) simulateRemoval(removal);
    else useAppStore.getState().setTools({ resilience: null, removal });
  }
  if (tools.bootstrap && tools.bootstrap.inputKey !== result.inputKey) {
    bootstrapOp?.cancel();
    bootstrapOp = null;
    useAppStore.getState().setTools({ bootstrap: null });
  }
}
