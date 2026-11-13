/**
 * Runs the `generation.sweep` work once, in this process (the worker runs it every 5 minutes):
 * fails and refunds generations queued or running longer than `GENERATION_STUCK_AFTER_MINUTES`
 * and calls the worker's completion hooks for them.
 *
 *   pnpm dev:sweep
 */
import "dotenv/config";
import { getEnv } from "../src/server/env";
import { onGenerationFinished, sweepStuckGenerations } from "../src/server/generation";
import { generationHooks } from "../worker/handlers";
import { assertDevOnly, runScript } from "./_lib";

async function main(): Promise<void> {
  assertDevOnly("dev:sweep");
  for (const hook of generationHooks) onGenerationFinished(hook);
  const minutes = getEnv().GENERATION_STUCK_AFTER_MINUTES;
  console.log(`Sweeping generations queued or running for more than ${minutes} minutes...`);
  const { failed } = await sweepStuckGenerations();
  console.log(`Failed and refunded: ${failed.length}`);
  for (const id of failed) console.log(`  ${id}`);
}

runScript(main, { queue: true });
