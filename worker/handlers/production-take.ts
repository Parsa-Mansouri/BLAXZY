import {
  defineHandler,
  takeGenerate,
  type JobContext,
  type JobDefinition,
} from "../../src/server/jobs";
import {
  failTake,
  loadTakeJob,
  ProductionInputError,
  requestTakeGeneration,
} from "../../src/server/production";
import { classifyProductionFailure } from "./production-failure";
import { handleFailure } from "./failure";

const NO_PROMPT = "This clip has no prompt to render from. Ask for changes again.";

/**
 * Requests the generation of a pending take (a draft from its prepared block, a reroll or rebind
 * of an earlier draft, a final from its accepted draft, or a retry). The take already has its
 * prompt; the completion hook moves it to review.
 */
async function produceTake(takeId: string, job: JobDefinition, context: JobContext): Promise<void> {
  const ctx = await loadTakeJob(takeId);
  if (!ctx || ctx.take.status !== "pending") return;
  const { take, project } = ctx;
  try {
    if (!project.style) throw new ProductionInputError("Choose the project's style first.");
    if (take.prompt === null) throw new ProductionInputError(NO_PROMPT);
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

/** A take's prompt and references → its generation (block_draft or block_final). */
export const takeGenerateHandler = defineHandler(takeGenerate, (payload, context) =>
  produceTake(payload.takeId, takeGenerate, context),
);
