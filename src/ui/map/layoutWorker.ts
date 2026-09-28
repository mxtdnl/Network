// Settles large force and grouped layouts off the main thread (CLAUDE.md D111),
// so a change of weights or layer does not stall the page while d3-force runs
// its settling ticks. The result is the same as settling on the main thread.

import { settleJob, type SettleJob, type SettleResult } from './layout';

export interface LayoutWorkerRequest {
  id: number;
  job: SettleJob;
}

export interface LayoutWorkerResponse {
  id: number;
  result: SettleResult;
}

self.onmessage = (event: MessageEvent<LayoutWorkerRequest>) => {
  const { id, job } = event.data;
  const result = settleJob(job);
  const response: LayoutWorkerResponse = { id, result };
  (self as unknown as Worker).postMessage(response, [result.positions.buffer]);
};
