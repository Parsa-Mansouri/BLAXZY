import type { GenerationFinishedHandler } from "../../src/server/generation";
import { applyTakeGenerationResult } from "../../src/server/production";

/**
 * The generation completion hook of Production: moves the take that requested the generation to
 * review (with its clip and poster) or to failed. Idempotent; registered once in `worker/index.ts`.
 */
export const productionGenerationHook: GenerationFinishedHandler = (generation) =>
  applyTakeGenerationResult(generation);
