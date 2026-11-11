import { blockReviser, runDami, textBlocks } from "../../src/server/damis";
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
  ProductionInputError,
  storePreparation,
  textBlocksInput,
  tooManyAssetsMessage,
} from "../../src/server/production";
import { classifyProductionFailure } from "./production-failure";
import { handleFailure } from "./script-failure";

/**
 * Prepares a pending block version: `prepare` binds its asset mentions to reference tokens with
 * text-blocks; `revise` answers the rejected review of its predecessor with block-reviser. Each
 * job only handles its own kind of version (a revision answers a rejected predecessor).
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
    if (!project.style) throw new ProductionInputError("Choose the project's style first.");
    const runContext = { userId: project.ownerId, projectId: project.id, signal: context.signal };
    let output: { prompt: string; assetRefs: string[]; notes: string[] };
    let runId: string;
    if (mode === "prepare") {
      const run = await runDami(textBlocks, textBlocksInput(ctx, project.style), runContext);
      output = run.output;
      runId = run.runId;
    } else {
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

/** text-blocks on the block's section prompt → prepared prompt and references. */
export const productionPrepareHandler = defineHandler(productionPrepare, (payload, context) =>
  prepareBlock(payload.blockId, "prepare", productionPrepare, context),
);

/** block-reviser on the rejected predecessor and its review → prepared prompt and references. */
export const blockReviseHandler = defineHandler(blockRevise, (payload, context) =>
  prepareBlock(payload.blockId, "revise", blockRevise, context),
);
