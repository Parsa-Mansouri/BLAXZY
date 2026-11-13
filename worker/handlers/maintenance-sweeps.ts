import { sweepStuckDamiRuns } from "../../src/server/damis";
import { damiSweep, defineHandler, fileSweep, type JobSchedule } from "../../src/server/jobs";
import { logLine } from "../../src/server/jobs/log";
import { sweepAbandonedUploads } from "../../src/server/storage";

/**
 * Uploads still pending after this long are abandoned. Six hours, so a very large export that is
 * still uploading is never swept.
 */
export const ABANDONED_UPLOAD_MINUTES = 360;

/** Marks dami runs whose process died (still `running` long after) as aborted. */
export const damiSweepHandler = defineHandler(damiSweep, async () => {
  const { swept } = await sweepStuckDamiRuns();
  logLine("info", "dami sweep done", { swept });
});

/** Marks long-pending uploads as abandoned and removes their objects (rows are kept). */
export const fileSweepHandler = defineHandler(fileSweep, async () => {
  const { swept } = await sweepAbandonedUploads({ olderThanMinutes: ABANDONED_UPLOAD_MINUTES });
  logLine("info", "file sweep done", { swept });
});

/** Every 15 minutes. */
export const damiSweepSchedule: JobSchedule = {
  job: damiSweep,
  cron: "*/15 * * * *",
  payload: {},
};

/** Every 15 minutes. */
export const fileSweepSchedule: JobSchedule = {
  job: fileSweep,
  cron: "*/15 * * * *",
  payload: {},
};
