import { defineHandler, type JobSchedule } from "../../src/server/jobs";
import { ratelimitPrune } from "../../src/server/jobs/definitions";
import { logLine } from "../../src/server/jobs/log";
import { pruneRateLimits } from "../../src/server/ratelimit";

/** Deletes server-action rate-limit windows that ended long ago. */
export const ratelimitPruneHandler = defineHandler(ratelimitPrune, async () => {
  const { pruned } = await pruneRateLimits();
  logLine("info", "rate limit prune done", { pruned });
});

/** Every 5 minutes. */
export const ratelimitPruneSchedule: JobSchedule = {
  job: ratelimitPrune,
  cron: "*/5 * * * *",
  payload: {},
};
