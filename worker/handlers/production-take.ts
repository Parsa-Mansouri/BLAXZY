import { runDami, takeFixer } from "../../src/server/damis";
import {
  defineHandler,
  takeFix,
  takeGenerate,
  type JobContext,
  type JobDefinition,
} from "../../src/server/jobs";
import {
  assertTakeBlockUsable,
  failTake,
  loadTakeJob,
  ProductionInputError,
  requestTakeGeneration,
  storeTakePrompt,
  takeFixerInput,
} from "../../src/server/production";
import { classifyProductionFailure } from "./production-failure";
import { handleFailure } from "./script-failure";

/**
 * Produces a pending take: `fix` first writes its prompt with the take-fixer from the rejected
 * parent's review (unless one is stored); both then request the generation. The completion hook
 * moves the take to review. `generate` handles takes that already have their prompt (drafts from
 * the prepared block, finals from their draft, and retries).
 */
async function produceTake(
  takeId: string,
  mode: "generate" | "fix",
  job: JobDefinition,
  context: JobContext,
): Promise<void> {
  const ctx = await loadTakeJob(takeId);
  if (!ctx || ctx.take.status !== "pending") return;
  if (mode === "generate" && ctx.take.prompt === null) return; // the fix job's take
  if (mode === "fix" && ctx.take.parentId === null) return; // not a fix
  const { take, project } = ctx;
  try {
    if (!project.style) throw new ProductionInputError("Choose the project's style first.");
    if (take.prompt === null) {
      assertTakeBlockUsable(ctx);
      const run = await runDami(takeFixer, takeFixerInput(ctx, project.style), {
        userId: project.ownerId,
        projectId: project.id,
        signal: context.signal,
      });
      await storeTakePrompt({ takeId, prompt: run.output.prompt, damiRunId: run.runId });
    }
    await requestTakeGeneration(takeId);
  } catch (error) {
    await handleFailure(
      error,
      job,
      context,
      async (d) => {
        await failTake(takeId, d.message, d.runId);
      },
      classifyProductionFailure,
    );
  }
}

/** A draft from the prepared block, or a final from its accepted draft → generation. */
export const takeGenerateHandler = defineHandler(takeGenerate, (payload, context) =>
  produceTake(payload.takeId, "generate", takeGenerate, context),
);

/** take-fixer on the rejected take's prompt and review → prompt → generation (block_draft). */
export const takeFixHandler = defineHandler(takeFix, (payload, context) =>
  produceTake(payload.takeId, "fix", takeFix, context),
);
