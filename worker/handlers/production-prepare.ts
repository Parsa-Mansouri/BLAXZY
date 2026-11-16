import { blockRevision, blockRevisionRunContext, runDami } from "../../src/server/damis";
import {
  blockRevise,
  defineHandler,
  productionPrepare,
  type JobContext,
  type JobDefinition,
} from "../../src/server/jobs";
import {
  buildBlockRevisionInput,
  failPreparation,
  loadPreparationJob,
  MAX_BLOCK_ASSETS,
  prepareBlockPrompt,
  ProductionInputError,
  revisionStorage,
  storePreparation,
  tooManyAssetsMessage,
} from "../../src/server/production";
import { classifyProductionFailure } from "./production-failure";
import { handleFailure } from "./failure";

type Output = {
  prompt: string;
  assetRefs: string[];
  notes: string[];
  revised?: { direction: unknown; prompt: string; assetRefs: string[] };
};

/**
 * Prepares a pending block version. `prepare` is code only: the blocks arrive already directed
 * (the Director wrote the prompt), so this binds the prompt's asset tags to reference tokens for
 * the assets that are ready (`prepareBlockPrompt`) and marks the block ready; the preparation's
 * run id is the Director run that wrote the block. `revise` answers a revision request on the
 * block's predecessor with Block Revision (Opus when the request regenerates): the revised block
 * replaces the version's Director data and prompt, and its production is bound by the same code.
 * Each job only handles its own kind of version (a revision answers a request on its predecessor).
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
    const ready = new Map(
      ctx.readyAssets.filter((a) => a.kind !== "voice").map((a) => [a.ref, a.name] as const),
    );
    let output: Output;
    let runId: string | null;
    if (mode === "prepare") {
      output = prepareBlockPrompt(block, ready);
      runId = block.damiRunId;
    } else {
      const revision = await buildBlockRevisionInput(ctx);
      const runContext = {
        userId: project.ownerId,
        projectId: project.id,
        signal: context.signal,
        ...blockRevisionRunContext(revision.input),
      };
      const run = await runDami(blockRevision, revision.input, runContext);
      const stored = revisionStorage(revision, block, run.output, ready);
      output = {
        prompt: stored.prepared.prompt,
        assetRefs: stored.prepared.assetRefs,
        notes: stored.notes,
        revised: stored.revised,
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

/** Block Revision on the predecessor and its revision request → the revised, prepared block. */
export const blockReviseHandler = defineHandler(blockRevise, (payload, context) =>
  prepareBlock(payload.blockId, "revise", blockRevise, context),
);
