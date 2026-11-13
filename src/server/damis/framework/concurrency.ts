/** A counting semaphore: at most `max` tasks run at once, the rest wait in FIFO order. */
export class Semaphore {
  readonly max: number;
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(max: number) {
    if (!Number.isInteger(max) || max < 1) {
      throw new Error(`Semaphore size must be a positive integer, got ${max}`);
    }
    this.max = max;
  }

  get active(): number {
    return this.running;
  }

  get pending(): number {
    return this.waiting.length;
  }

  /**
   * Runs `task` once a slot is free. When `signal` aborts while the call is still queued, it
   * leaves the queue without taking a slot and rejects with the signal's reason; a task that is
   * already running is not interrupted here (it gets the signal itself).
   */
  async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquire(signal);
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    if (this.running < this.max) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      // The slot is handed over directly by release(), so `running` stays unchanged.
      const waiter = () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      };
      const onAbort = () => {
        const at = this.waiting.indexOf(waiter);
        if (at >= 0) this.waiting.splice(at, 1);
        reject(abortReason(signal));
      };
      this.waiting.push(waiter);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) {
      next();
    } else {
      this.running--;
    }
  }
}

function abortReason(signal: AbortSignal | undefined): unknown {
  return signal?.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

let processLimiter: Semaphore | undefined;

/**
 * The limit on concurrent Claude calls (`DAMI_MAX_CONCURRENCY`) of THIS process. It is per
 * process, not global: with several worker processes (and the web server, if it ever runs a
 * dami) the total number of concurrent Claude calls is the number of processes times this value.
 * Size it against the API rate limit divided by the number of processes.
 */
export function getProcessClaudeLimiter(max: number): Semaphore {
  if (!processLimiter || processLimiter.max !== max) {
    processLimiter = new Semaphore(max);
  }
  return processLimiter;
}
