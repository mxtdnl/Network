// Runs the analysis engine whenever the project or the analysis view changes,
// and puts the result in the store. The engine client cancels a running
// analysis when a newer one starts (latest wins, CLAUDE.md D1), so rapid
// changes cost only the last run.

import { EngineCancelledError, EngineClient, type Operation } from '../engineClient';
import type { AnalysisResult } from '../engineClient';
import { useAppStore, type AppState } from './store';

let client: EngineClient | null = null;
let running: Operation<AnalysisResult> | null = null;
let lastKey = '';

function inputKey(s: AppState): string {
  return `${String(s.data.revision)}:${s.map.view}:${s.map.symmetrise}`;
}

function run(s: AppState): void {
  const project = s.data.project;
  const key = inputKey(s);
  if (key === lastKey) return;
  lastKey = key;
  running?.cancel();
  running = null;
  if (!project || project.members.length === 0) {
    s.setResults({ status: 'idle', current: null, error: null });
    return;
  }
  client ??= new EngineClient();
  s.setResults({ status: 'running', error: null });
  const op = client.analyseProject(
    project,
    { view: s.map.view, symmetrise: s.map.symmetrise, weights: {}, signedTreatment: {} },
    key,
  );
  running = op;
  op.promise.then(
    (result) => {
      if (running !== op) return;
      running = null;
      useAppStore.getState().setResults({ status: 'ready', current: result, error: null });
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
}

/** Starts watching the store; call once at start-up. */
export function startAnalysisSync(): () => void {
  run(useAppStore.getState());
  return useAppStore.subscribe((s) => {
    run(s);
  });
}
