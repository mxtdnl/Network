// Web Worker entry for the analysis engine (spec §6). The UI talks to it only
// through ui/engineClient.ts.

import { createEngineHandler } from './handler';
import type { EngineRequest } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;

const handle = createEngineHandler((message, transfer) => {
  scope.postMessage(message, transfer);
});

scope.onmessage = (event: MessageEvent<EngineRequest>) => {
  void handle(event.data);
};
