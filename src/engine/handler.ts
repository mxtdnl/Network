// Request router for the engine worker, separate from the worker entry so it
// can be tested without a Worker. It keeps the last prepared input (keyed by
// inputKey) for resilience and bootstrap requests, and one AbortController per
// running request so 'cancel' can stop it between steps.

import { analysePrepared, prepare, runBootstrap, runResilience, type Prepared } from './analyse';
import { transferables, type EngineRequest, type EngineResponse, type RequestId } from './protocol';
import { CancelledError } from './schedule';

export type Post = (message: EngineResponse, transfer: ArrayBuffer[]) => void;

export function createEngineHandler(post: Post): (request: EngineRequest) => Promise<void> {
  let prepared: Prepared | null = null;
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
          const result = await analysePrepared(p, control);
          send({ id, kind: 'analysis', result }, true);
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
