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

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.running < this.max) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      // The slot is handed over directly by release(), so `running` stays unchanged.
      this.waiting.push(resolve);
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

let processLimiter: Semaphore | undefined;

/** The per-process limit on concurrent Claude calls (`DAMI_MAX_CONCURRENCY`). */
export function getProcessClaudeLimiter(max: number): Semaphore {
  if (!processLimiter || processLimiter.max !== max) {
    processLimiter = new Semaphore(max);
  }
  return processLimiter;
}
