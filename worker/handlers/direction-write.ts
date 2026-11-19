import { director, runDami, type DirectorOutput } from "../../src/server/damis";
import {
  failDirection,
  isDirectionOpen,
  loadBatchJob,
  saveBatch,
} from "../../src/server/direction";
import { setSectioningState } from "../../src/server/blocks";
import { defineHandler, directionWrite } from "../../src/server/jobs";
import { reopenProductionAfterScriptEdit } from "../../src/server/production";
import { ScriptInputError } from "../../src/server/script";
import { handleFailure } from "./failure";
import { classifyFailure } from "./script-failure";

/**
 * Writes one batch of a planned direction (`write_blocks` over a `block_range`, with the saved plan
 * verbatim). Batches of one run run in parallel; each stores only its own row, and the one that
 * finishes last assembles every batch's blocks (`saveBatch`, one transaction). A batch of a run
 * that was superseded or failed is skipped; a batch already stored is skipped. A batch that
 * fails for good fails the whole run (the user retries it as a whole).
 */
export const directionWriteHandler = defineHandler(directionWrite, async (payload, context) => {
  const { directionId, batchIndex } = payload;
  const job = await loadBatchJob(directionId, batchIndex);
  if (!job || job.batch.status !== "pending" || !(await isDirectionOpen(directionId))) return;
  const { direction } = job;
  const fail = async (message: string, runId: string | null) => {
    const { failed } = await failDirection(directionId, message, runId);
    if (failed) {
      await setSectioningState({
        projectId: direction.projectId,
        state: "failed",
        scriptVersionId: direction.scriptVersionId,
        failure: message,
        onlyFor: direction.scriptVersionId,
      });
    }
  };
  try {
    // The stored plan as it is: the input schema upgrades a plan written by Director v1.3.
    const plan: unknown = direction.plan;
    if (!plan) throw new ScriptInputError("The plan of this run is missing. Try again.");
    const { context: directorContext } = job;
    const run = await runDami(
      director,
      {
        mode: "write_blocks" as const,
        platform_config: directorContext.platform_config,
        block_mode: directorContext.block_mode,
        creative_bible: directorContext.creative_bible,
        asset_registry: directorContext.asset_registry,
        script: job.script,
        plan,
        block_range: `${job.batch.blockFrom}-${job.batch.blockTo}`,
      },
      { userId: job.ownerId, projectId: direction.projectId, signal: context.signal },
    );
    const output: DirectorOutput = run.output;
    const stored = await saveBatch({ directionId, batchIndex, output, runId: run.runId });
    if (stored.stored && stored.assembled && !stored.replaced.skipped) {
      await reopenProductionAfterScriptEdit(stored.projectId);
    }
  } catch (error) {
    await handleFailure(
      error,
      directionWrite,
      context,
      (d) => fail(d.message, d.runId),
      classifyFailure,
    );
  }
});
