// The only seam between the UI and the analysis engine (plan §1.1). Wraps the
// worker's typed message interface in promises. A new request of a kind
// cancels the previous one of that kind (latest wins, CLAUDE.md D1), and every
// long request can report progress and be cancelled.

import { buildAnalysisInput, type AnalysisOptions } from '../engine/input';
import {
  transferables,
  type EngineRequest,
  type EngineResponse,
  type RequestId,
  type ResultResponse,
} from '../engine/protocol';
import type {
  AnalysisInput,
  AnalysisResult,
  BootstrapOptions,
  BootstrapResult,
  LayerRef,
  MemberId,
  PathResult,
  ResilienceResult,
} from '../engine/types';
import type { Project } from '../data/schema';

export type {
  AnalysisResult,
  BootstrapOptions,
  BootstrapResult,
  PathResult,
  ResilienceResult,
} from '../engine/types';
export type {
  BootstrapMetric,
  CompositeFormula,
  InsightOutcome,
  InsightRuleId,
  InsightUnavailable,
  InsightView,
  Observation,
  ResilienceSnapshot,
} from '../engine/types';
export { INSIGHT_RULES, INSIGHT_RULE_ORDER } from '../engine/insights';
export { buildAnalysisInput };
export { FI_CLASS } from '../engine/types';
// Pure helpers the linked views call on the weights a result already holds.
export { OVERLAP, subgroupDensity, tieOverlap } from '../engine/metrics/subgroup';

export interface WorkerLike {
  postMessage(message: EngineRequest, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<EngineResponse>) => void) | null;
  terminate(): void;
}

export class EngineCancelledError extends Error {
  constructor() {
    super('The analysis was cancelled.');
    this.name = 'EngineCancelledError';
  }
}

export class EngineError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

export type Progress = (fraction: number, stage: string) => void;

interface Pending {
  kind: ResultResponse['kind'];
  resolve: (r: ResultResponse) => void;
  reject: (e: Error) => void;
  onProgress: Progress | undefined;
}

type RequestBody = EngineRequest extends infer R
  ? R extends { id: RequestId }
    ? Omit<R, 'id'>
    : never
  : never;

export interface Operation<T> {
  id: RequestId;
  promise: Promise<T>;
  cancel(): void;
}

export function createEngineWorker(): WorkerLike {
  return new Worker(new URL('../engine/worker.ts', import.meta.url), {
    type: 'module',
  });
}

export class EngineClient {
  private nextId = 1;
  private readonly pending = new Map<RequestId, Pending>();
  private readonly latest = new Map<string, RequestId>();

  constructor(private readonly worker: WorkerLike = createEngineWorker()) {
    worker.onmessage = (event) => {
      this.receive(event.data);
    };
  }

  analyse(input: AnalysisInput, onProgress?: Progress): Operation<AnalysisResult> {
    return this.request({ kind: 'analyse', input }, 'analysis', onProgress, (r) => r.result);
  }

  analyseProject(
    project: Project,
    options: AnalysisOptions,
    inputKey: string,
    onProgress?: Progress,
  ): Operation<AnalysisResult> {
    return this.analyse(buildAnalysisInput(project, options, inputKey), onProgress);
  }

  resilience(inputKey: string, ref: LayerRef, removed: MemberId[]): Operation<ResilienceResult> {
    return this.request(
      { kind: 'resilience', inputKey, ref, removed },
      'resilience',
      undefined,
      (r) => r.result,
    );
  }

  path(
    inputKey: string,
    ref: LayerRef,
    from: MemberId,
    to: MemberId,
  ): Operation<PathResult | null> {
    return this.request(
      { kind: 'path', inputKey, ref, from, to },
      'path',
      undefined,
      (r) => r.result,
    );
  }

  bootstrap(
    inputKey: string,
    opts: BootstrapOptions,
    onProgress?: Progress,
  ): Operation<BootstrapResult> {
    return this.request(
      { kind: 'bootstrap', inputKey, opts },
      'bootstrap',
      onProgress,
      (r) => r.result,
    );
  }

  cancel(id: RequestId): void {
    if (this.pending.has(id))
      this.worker.postMessage({ id: this.nextId++, kind: 'cancel', target: id }, []);
  }

  dispose(): void {
    for (const p of this.pending.values()) p.reject(new EngineCancelledError());
    this.pending.clear();
    this.worker.terminate();
  }

  private request<K extends ResultResponse['kind'], T>(
    body: RequestBody,
    kind: K,
    onProgress: Progress | undefined,
    pick: (r: Extract<ResultResponse, { kind: K }>) => T,
  ): Operation<T> {
    const previous = this.latest.get(kind);
    if (previous !== undefined) this.cancel(previous);
    const id = this.nextId++;
    this.latest.set(kind, id);
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        kind,
        resolve: (r) => {
          resolve(pick(r as Extract<ResultResponse, { kind: K }>));
        },
        reject,
        onProgress,
      });
    });
    const message = { ...body, id };
    // Rating tensors move to the worker rather than being copied.
    this.worker.postMessage(
      message,
      message.kind === 'analyse' ? transferables(message.input.ratings) : [],
    );
    return {
      id,
      promise,
      cancel: () => {
        this.cancel(id);
      },
    };
  }

  private receive(message: EngineResponse): void {
    const p = this.pending.get(message.id);
    if (!p) return;
    switch (message.kind) {
      case 'progress':
        p.onProgress?.(message.fraction, message.stage);
        return;
      case 'cancelled':
        p.reject(new EngineCancelledError());
        break;
      case 'error':
        p.reject(new EngineError(message.code, message.message));
        break;
      default:
        if (message.kind === p.kind) p.resolve(message);
        else p.reject(new EngineError('invalidRequest', `Unexpected ${message.kind} response`));
    }
    this.pending.delete(message.id);
    if (this.latest.get(p.kind) === message.id) this.latest.delete(p.kind);
  }
}
