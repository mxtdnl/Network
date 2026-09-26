// Request router for the engine worker, separate from the worker entry so it
// can be tested without a Worker. It keeps the last prepared input (keyed by
// inputKey) for resilience and bootstrap requests, and one AbortController per
// running request so 'cancel' can stop it between steps. It also keeps the
// last analysis result: when the next input has the same `baseKey` (only the
// composite weights changed), every other result is reused. Only the
// composite's buffers are transferred; the rest are copied, so the kept result
// stays usable.

import {
  analysePrepared,
  prepare,
  runBootstrap,
  runPath,
  runResilience,
  type Prepared,
} from './analyse';
import { transferables, type EngineRequest, type EngineResponse, type RequestId } from './protocol';
import { CancelledError } from './schedule';
import { COMPOSITE, type AnalysisResult } from './types';

export type Post = (message: EngineResponse, transfer: ArrayBuffer[]) => void;

export function createEngineHandler(post: Post): (request: EngineRequest) => Promise<void> {
  let prepared: Prepared | null = null;
  let last: { baseKey: string; result: AnalysisResult } | null = null;
  const running = new Map<RequestId, AbortController>();

  const send = (message: EngineResponse, transfer = false) => {
    post(message, transfer ? transferables(message) : []);
  };

  return async (request) => {
    if (request.kind === 'cancel') {
      running.get(request.target)?.abort();
      return;
    }
    const { id } = request;
    const controller = new AbortController();
    running.set(id, controller);
    const control = {
      signal: controller.signal,
      onProgress: (fraction: number, stage: string) => {
        send({ id, kind: 'progress', fraction, stage });
      },
    };
    try {
      switch (request.kind) {
        case 'analyse': {
          const p = prepare(request.input);
          prepared = p;
          const { baseKey } = request.input;
          const reuse = baseKey !== undefined && last?.baseKey === baseKey ? last.result : null;
          const result = await analysePrepared(p, control, reuse);
          last = baseKey === undefined ? null : { baseKey, result };
          const composite = result.refs[COMPOSITE];
          post({ id, kind: 'analysis', result }, composite ? transferables(composite) : []);
          break;
        }
        case 'resilience': {
          const p = current(prepared, request.inputKey);
          send(
            { id, kind: 'resilience', result: runResilience(p, request.ref, request.removed) },
            true,
          );
          break;
        }
        case 'path': {
          const p = current(prepared, request.inputKey);
          send({ id, kind: 'path', result: runPath(p, request.ref, request.from, request.to) });
          break;
        }
        case 'bootstrap': {
          const p = current(prepared, request.inputKey);
          const result = await runBootstrap(p, request.opts, control);
          send({ id, kind: 'bootstrap', result }, true);
          break;
        }
      }
    } catch (err) {
      if (err instanceof CancelledError) send({ id, kind: 'cancelled' });
      else if (err instanceof StaleInputError)
        send({ id, kind: 'error', code: 'staleInput', message: err.message });
      else
        send({
          id,
          kind: 'error',
          code: 'internal',
          message: err instanceof Error ? err.message : String(err),
        });
    } finally {
      running.delete(id);
    }
  };
}

class StaleInputError extends Error {}

function current(prepared: Prepared | null, inputKey: string): Prepared {
  if (!prepared || prepared.input.inputKey !== inputKey) {
    throw new StaleInputError(
      'The analysis this request refers to is no longer loaded; run the analysis again.',
    );
  }
  return prepared;
}
