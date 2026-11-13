import { sweepStuckGenerations } from "../../src/server/generation";
import { defineHandler, generationSweep, type JobSchedule } from "../../src/server/jobs";
import { logLine } from "../../src/server/jobs/log";

/**
 * Fails and refunds stuck generations, re-sends long-waiting queued ones and calls the hooks again
 * for finished generations whose hooks never returned (see sweep.ts).
 */
export const generationSweepHandler = defineHandler(generationSweep, async () => {
  const { failed, renotified, requeued } = await sweepStuckGenerations();
  logLine("info", "generation sweep done", {
    failed: failed.length,
    renotified: renotified.length,
    requeued: requeued.length,
  });
});

/** Every 5 minutes. */
export const generationSweepSchedule: JobSchedule = {
  job: generationSweep,
  cron: "*/5 * * * *",
  payload: {},
};
