// Runs the analysis engine whenever the project, the analysis view or the
// composite weights change, and puts the result in the store. The engine
// client cancels a running analysis when a newer one starts (latest wins,
// CLAUDE.md D1), so rapid changes cost only the last run. A change of weights
// alone waits `--m-base` for the slider to settle and then recomputes only
// the composite (the worker reuses every other result for the same baseKey).

import {
  buildAnalysisInput,
  EngineCancelledError,
  EngineClient,
  type AnalysisResult,
  type Operation,
} from '../engineClient';
import { durationToken } from '../durations';
import { effectiveWeights, weightsKey } from './presets';
import { useAppStore, type AppState } from './store';
import { refreshTools } from './tools';

let client: EngineClient | null = null;
let running: Operation<AnalysisResult> | null = null;
let lastKey = '';
let lastBase = '';
let timer = 0;

/** The engine client shared by the analysis and the explore tools. */
export function engineClient(): EngineClient {
  client ??= new EngineClient();
  return client;
}

function baseKey(s: AppState): string {
  return `${String(s.data.revision)}:${s.map.view}:${s.map.symmetrise}`;
}

function keys(s: AppState) {
  const project = s.data.project;
  const weights = project ? effectiveWeights(project, s.weights) : null;
  const base = baseKey(s);
  return { base, key: weights ? `${base}:${weightsKey(weights)}` : base, weights };
}

const debounceMs = () => durationToken('--m-base');

function run(s: AppState): void {
  const project = s.data.project;
  const { base, key, weights } = keys(s);
  if (key === lastKey) return;
  const weightsOnly = base === lastBase && lastKey !== '';
  lastKey = key;
  lastBase = base;
  window.clearTimeout(timer);
  running?.cancel();
  running = null;
  if (!project || project.members.length === 0 || !weights) {
    s.setResults({ status: 'idle', current: null, error: null });
    return;
  }
  s.setResults({ status: 'running', error: null });
  const start = () => {
    const input = buildAnalysisInput(
      project,
      {
        view: s.map.view,
        symmetrise: s.map.symmetrise,
        weights: weights.weights,
        signedTreatment: weights.signedTreatment,
      },
      key,
    );
    const op = engineClient().analyse({ ...input, baseKey: base });
    running = op;
    op.promise.then(
      (result) => {
        if (running !== op) return;
        running = null;
        useAppStore.getState().setResults({ status: 'ready', current: result, error: null });
        refreshTools(result);
      },
      (e: unknown) => {
        if (running !== op || e instanceof EngineCancelledError) return;
        running = null;
        useAppStore.getState().setResults({
          status: 'error',
          error: e instanceof Error ? e.message : String(e),
        });
      },
    );
  };
  if (weightsOnly) timer = window.setTimeout(start, debounceMs());
  else start();
}

/** Starts watching the store; call once at start-up. */
export function startAnalysisSync(): () => void {
  run(useAppStore.getState());
  return useAppStore.subscribe((s) => {
    run(s);
  });
}
