import { applyGenerationResult } from "../../src/server/assets";
import type { GenerationFinishedHandler } from "../../src/server/generation";

/**
 * The generation completion hook of pre-production: moves the look or sheet that requested the
 * generation to review (or to failed). Idempotent; registered once in `worker/index.ts`.
 */
export const assetGenerationHook: GenerationFinishedHandler = (generation) =>
  applyGenerationResult(generation);
