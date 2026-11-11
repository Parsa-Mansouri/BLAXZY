/**
 * Completion hooks: code that must react when a generation finishes (pre-production moves its
 * look or sheet forward). Registered once per worker process at startup; this is configuration,
 * not request state.
 *
 * Delivery is at-least-once: a hook can be called again for the same generation (a retried or
 * duplicate job), so hooks must be idempotent (conditional updates). A hook that throws fails the
 * job attempt; the retry finds the generation finished and calls the hooks again.
 */
import type { GenerationPurpose, GenerationStatus } from "@/server/db/schema";

export type FinishedGeneration = {
  id: string;
  purpose: GenerationPurpose;
  status: GenerationStatus;
  resultFileId: string | null;
  /**
   * A succeeded video's poster, else null. Always set by the engine; optional in the type so a
   * `generation` row (which has no such column) can still be passed to a hook directly.
   */
  posterFileId?: string | null;
  error: string | null;
};

export type GenerationFinishedHandler = (generation: FinishedGeneration) => Promise<void>;

const handlers = new Set<GenerationFinishedHandler>();

/** Registers a completion hook. Returns a function that removes it (tests). */
export function onGenerationFinished(handler: GenerationFinishedHandler): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

/** Calls every hook in registration order; the first error is rethrown after all have run. */
export async function notifyGenerationFinished(generation: FinishedGeneration): Promise<void> {
  let firstError: unknown;
  for (const handler of [...handlers]) {
    try {
      await handler(generation);
    } catch (err) {
      firstError ??= err;
    }
  }
  if (firstError !== undefined) throw firstError;
}
