/**
 * Runs the `generation.sweep` work once, in this process (the worker runs it every 5 minutes):
 * fails and refunds generations queued or running longer than `GENERATION_STUCK_AFTER_MINUTES`
 * and calls the worker's completion hooks for them.
 *
 *   pnpm dev:sweep
 */
import "dotenv/config";
import { closeDb } from "../src/server/db/client";
import { getEnv } from "../src/server/env";
import { onGenerationFinished, sweepStuckGenerations } from "../src/server/generation";
import { closeJobQueue } from "../src/server/jobs";
import { generationHooks } from "../worker/handlers";

async function main(): Promise<void> {
  for (const hook of generationHooks) onGenerationFinished(hook);
  const minutes = getEnv().GENERATION_STUCK_AFTER_MINUTES;
  console.log(`Sweeping generations queued or running for more than ${minutes} minutes...`);
  const { failed } = await sweepStuckGenerations();
  console.log(`Failed and refunded: ${failed.length}`);
  for (const id of failed) console.log(`  ${id}`);
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeJobQueue();
    await closeDb();
  });
