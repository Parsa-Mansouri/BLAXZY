import { runGeneration } from "../../src/server/generation";
import { defineHandler, generationRun } from "../../src/server/jobs";

/** Runs a generation at its provider, stores the result, settles or refunds (see run.ts). */
export const generationRunHandler = defineHandler(generationRun, async (payload, context) => {
  await runGeneration(payload.generationId, context);
});
