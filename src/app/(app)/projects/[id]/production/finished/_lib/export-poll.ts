/** Consecutive failed polls of an export tolerated before the screen gives up on it. */
export const MAX_EXPORT_POLL_FAILURES = 3;

/**
 * What one poll result does to the run of failures: a success clears it, a failure adds one, and
 * after `MAX_EXPORT_POLL_FAILURES` in a row the export is reported as failed.
 */
export function afterExportPoll(
  failures: number,
  ok: boolean,
  max = MAX_EXPORT_POLL_FAILURES,
): { failures: number; giveUp: boolean } {
  if (ok) return { failures: 0, giveUp: false };
  const next = failures + 1;
  return { failures: next, giveUp: next >= max };
}
