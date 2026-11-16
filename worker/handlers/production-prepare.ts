import { blockReviser, runDami } from "../../src/server/damis";
import {
  blockRevise,
  defineHandler,
  productionPrepare,
  type JobContext,
  type JobDefinition,
} from "../../src/server/jobs";
import {
  blockReviserInput,
  failPreparation,
  loadPreparationJob,
  MAX_BLOCK_ASSETS,
  prepareBlockPrompt,
  ProductionInputError,
  storePreparation,
  tooManyAssetsMessage,
} from "../../src/server/production";
import { classifyProductionFailure } from "./production-failure";
import { handleFailure } from "./failure";

/**
 * Prepares a pending block version. `prepare` is code only: the blocks arrive already directed
 * (the Director wrote the prompt), so this binds the prompt's asset tags to reference tokens for
 * the assets that are ready (`prepareBlockPrompt`) and marks the block ready; the preparation's
 * run id is the Director run that wrote the block. `revise` answers the rejected review of the
 * block's predecessor with block-reviser (the draft reviser, until Block Revision replaces it).
 * Each job only handles its own kind of version (a revision answers a rejected predecessor).
 */
async function prepareBlock(
  blockId: string,
  mode: "prepare" | "revise",
  job: JobDefinition,
  context: JobContext,
): Promise<void> {
  const ctx = await loadPreparationJob(blockId);
  if (!ctx || ctx.block.productionState !== "pending" || ctx.block.supersededAt) return;
  if ((ctx.revision !== null) !== (mode === "revise")) return; // the other job's version
  const { block, project } = ctx;
  try {
    if (block.stale) {
      throw new ProductionInputError("The script changed under this shot. Wait for the new shots.");
    }
    let output: { prompt: string; assetRefs: string[]; notes: string[] };
    let runId: string | null;
    if (mode === "prepare") {
      const ready = new Map(
        ctx.readyAssets.filter((a) => a.kind !== "voice").map((a) => [a.ref, a.name] as const),
      );
      output = prepareBlockPrompt(block, ready);
      runId = block.damiRunId;
    } else {
      if (!project.style) throw new ProductionInputError("Choose the project's style first.");
      const runContext = { userId: project.ownerId, projectId: project.id, signal: context.signal };
      const run = await runDami(blockReviser, blockReviserInput(ctx, project.style), runContext);
      output = {
        prompt: run.output.prompt,
        assetRefs: run.output.assetRefs,
        notes: run.output.changeSummary.map((c) => c.change),
      };
      runId = run.runId;
    }
    if (output.assetRefs.length > MAX_BLOCK_ASSETS) {
      await failPreparation(blockId, tooManyAssetsMessage(output.assetRefs.length), runId);
      return;
    }
    await storePreparation({ blockId, ...output, damiRunId: runId });
  } catch (error) {
    await handleFailure(
      error,
      job,
      context,
      async (d) => {
        await failPreparation(blockId, d.message, d.runId);
      },
      classifyProductionFailure,
    );
  }
}

/** Binds the block's directed prompt to its reference tokens (code only). */
export const productionPrepareHandler = defineHandler(productionPrepare, (payload, context) =>
  prepareBlock(payload.blockId, "prepare", productionPrepare, context),
);

/** block-reviser on the rejected predecessor and its review → prepared prompt and references. */
export const blockReviseHandler = defineHandler(blockRevise, (payload, context) =>
  prepareBlock(payload.blockId, "revise", blockRevise, context),
);
