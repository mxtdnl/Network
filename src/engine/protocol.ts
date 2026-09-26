// Typed message interface between ui/engineClient.ts and the engine worker
// (plan §1.2, CLAUDE.md D1). Every request carries an id; every response
// names the id it answers. Long operations send 'progress' messages and end
// with their result, 'cancelled' or 'error'.

import type {
  AnalysisInput,
  AnalysisResult,
  BootstrapOptions,
  BootstrapResult,
  LayerRef,
  MemberId,
  PathResult,
  ResilienceResult,
} from './types';

export type RequestId = number;

export type EngineRequest =
  | { id: RequestId; kind: 'analyse'; input: AnalysisInput }
  | { id: RequestId; kind: 'resilience'; inputKey: string; ref: LayerRef; removed: MemberId[] }
  | { id: RequestId; kind: 'bootstrap'; inputKey: string; opts: BootstrapOptions }
  | { id: RequestId; kind: 'path'; inputKey: string; ref: LayerRef; from: MemberId; to: MemberId }
  | { id: RequestId; kind: 'cancel'; target: RequestId };

export type EngineErrorCode = 'staleInput' | 'invalidRequest' | 'internal';

export type EngineResponse =
  | { id: RequestId; kind: 'progress'; fraction: number; stage: string }
  | { id: RequestId; kind: 'analysis'; result: AnalysisResult }
  | { id: RequestId; kind: 'resilience'; result: ResilienceResult }
  | { id: RequestId; kind: 'bootstrap'; result: BootstrapResult }
  | { id: RequestId; kind: 'path'; result: PathResult | null }
  | { id: RequestId; kind: 'cancelled' }
  | { id: RequestId; kind: 'error'; code: EngineErrorCode; message: string };

export type ResultResponse = Extract<
  EngineResponse,
  { kind: 'analysis' | 'resilience' | 'bootstrap' | 'path' }
>;

/** Collects the distinct ArrayBuffers under a value, for a transfer list. */
export function transferables(value: unknown): ArrayBuffer[] {
  const found = new Set<ArrayBuffer>();
  const seen = new Set<object>();
  const visit = (v: unknown): void => {
    if (v === null || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (ArrayBuffer.isView(v)) {
      if (v.buffer instanceof ArrayBuffer) found.add(v.buffer);
      return;
    }
    for (const x of Array.isArray(v) ? v : Object.values(v)) visit(x);
  };
  visit(value);
  return [...found];
}
