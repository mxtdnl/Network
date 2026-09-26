// Cooperative scheduling for long operations in the worker: progress reports,
// cancellation checks, and yielding to the event loop so a 'cancel' message
// can be received while a computation is running.

export class CancelledError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'CancelledError';
  }
}

export type ProgressFn = (fraction: number, stage: string) => void;

export interface RunControl {
  signal?: AbortSignal;
  onProgress?: ProgressFn;
}

/** Longest stretch of work between yields, in milliseconds. */
const SLICE_MS = 25;

export class Scheduler {
  private last = now();
  constructor(private readonly control: RunControl = {}) {}

  progress(fraction: number, stage: string): void {
    this.control.onProgress?.(Math.min(Math.max(fraction, 0), 1), stage);
  }

  check(): void {
    if (this.control.signal?.aborted) throw new CancelledError();
  }

  /** Yields if the current slice is used up, then checks for cancellation. */
  async pause(): Promise<void> {
    this.check();
    if (now() - this.last < SLICE_MS) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    this.last = now();
    this.check();
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
