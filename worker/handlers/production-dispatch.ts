import { productionDispatch } from "../../src/server/jobs/definitions";
import { defineHandler } from "../../src/server/jobs";
import { dispatchProductionJobs } from "../../src/server/production";

/**
 * Fans a project's production work out into per-row jobs (see `dispatchProductionJobs`): sent on
 * the transaction that claimed the blocks (`ensurePrepared`) or created the drafts
 * (`startDrafts`), so the request itself sends one job however many rows it touched. Safe to run
 * twice; a failure is retried (nothing to record on a row).
 */
export const productionDispatchHandler = defineHandler(productionDispatch, async (payload) => {
  const count = await dispatchProductionJobs(payload.projectId, payload.kind);
  console.info(
    `[production.dispatch] ${payload.kind}: queued ${count} job(s) for ${payload.projectId}`,
  );
});
