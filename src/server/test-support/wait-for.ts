/**
 * Waiting for real state in tests, instead of sleeping a fixed time and hoping.
 *
 * `waitFor` polls a condition on a short interval until it returns a truthy value (or throws a
 * timeout error naming what it waited for). A test that proves "nothing else happens" should wait
 * for a condition that is true only once the work is finished (a job row `completed`, a row in a
 * terminal status, a counter that a handler resolved) and then assert on the final state.
 */
export type WaitForOptions = {
  timeoutMs?: number;
  intervalMs?: number;
  /** Named in the timeout error. */
  description?: string;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Resolves with the first truthy value of `condition` (sync or async); rejects on timeout. */
export async function waitFor<T>(
  condition: () => T | Promise<T>,
  options: WaitForOptions = {},
): Promise<NonNullable<T>> {
  const { timeoutMs = 10_000, intervalMs = 20, description = "condition" } = options;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await condition();
    if (value) return value as NonNullable<T>;
    if (Date.now() >= deadline) {
      throw new Error(`timed out after ${timeoutMs} ms waiting for ${description}`);
    }
    await sleep(intervalMs);
  }
}

/**
 * Like `waitFor`, but resolves with the last value instead of rejecting when the time is up, for
 * tests that assert on the final value themselves (`expect(await ...).toBe("completed")` then
 * shows what the state was).
 */
export async function waitForValue<T>(
  read: () => T | Promise<T>,
  isDone: (value: T) => boolean,
  options: Omit<WaitForOptions, "description"> = {},
): Promise<T> {
  const { timeoutMs = 10_000, intervalMs = 20 } = options;
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!isDone(value) && Date.now() < deadline) {
    await sleep(intervalMs);
    value = await read();
  }
  return value;
}
