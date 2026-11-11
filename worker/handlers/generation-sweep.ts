import { sweepStuckGenerations } from "../../src/server/generation";
import { defineHandler, generationSweep, type JobSchedule } from "../../src/server/jobs";
import { logLine } from "../../src/server/jobs/log";

/** Fails and refunds generations stuck past `GENERATION_STUCK_AFTER_MINUTES` (see sweep.ts). */
export const generationSweepHandler = defineHandler(generationSweep, async () => {
  const { failed } = await sweepStuckGenerations();
  logLine("info", "generation sweep done", { failed: failed.length });
});

/** Every 5 minutes. */
export const generationSweepSchedule: JobSchedule = {
  job: generationSweep,
  cron: "*/5 * * * *",
  payload: {},
};
