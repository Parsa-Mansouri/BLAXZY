/**
 * The `generation.sweep` job's work (worker only): generations still `queued` or `running` long
 * after they were created (or started) are failed with a user-readable error and refunded, and
 * the completion hooks are told. A safety net for runs that died without finishing (a lost job,
 * a crashed worker past every retry); the normal path never needs it.
 *
 * Idempotent and safe beside running jobs: each generation is failed with the same conditional
 * update as a failed run (`queued`/`running` only), so a run that finishes at the same time either
 * wins (and the sweep skips it) or loses (and finds it failed). Only the call that changed a row
 * calls the hooks; if a hook throws, a `generation.run` job is queued, which finds the generation
 * finished and calls the hooks again with the queue's retries.
 */
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { generation } from "@/server/db/schema";
import { getEnv } from "@/server/env";
import { errorMessage, logLine } from "@/server/jobs/log";
import { notify } from "./run";
import { enqueueGeneration, failGeneration } from "./service";

export const STUCK_FAILURE =
  "This generation took too long and was stopped. Your credits were returned; try again.";

const BATCH_SIZE = 100;
/** Upper bound per sweep; the next sweep continues. */
const MAX_BATCHES = 20;

export type SweepResult = { failed: string[] };

export async function sweepStuckGenerations(
  options: {
    /** Default `GENERATION_STUCK_AFTER_MINUTES`. */
    stuckAfterMinutes?: number;
    now?: Date;
    /** Only this user's generations (tests). */
    userId?: string;
  } = {},
): Promise<SweepResult> {
  const minutes = options.stuckAfterMinutes ?? getEnv().GENERATION_STUCK_AFTER_MINUTES;
  const cutoff = new Date((options.now ?? new Date()).getTime() - minutes * 60_000);
  const failed: string[] = [];
  const seen = new Set<string>();

  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const rows = await getDb()
      .select({ id: generation.id })
      .from(generation)
      .where(
        and(
          inArray(generation.status, ["queued", "running"]),
          lt(sql`coalesce(${generation.startedAt}, ${generation.createdAt})`, cutoff),
          options.userId ? eq(generation.userId, options.userId) : undefined,
        ),
      )
      .orderBy(asc(generation.createdAt))
      .limit(BATCH_SIZE);
    const fresh = rows.filter((r) => !seen.has(r.id));
    if (fresh.length === 0) break;
    for (const { id } of fresh) {
      seen.add(id);
      if (!(await failGeneration(id, STUCK_FAILURE))) continue; // finished meanwhile
      failed.push(id);
      logLine("warn", "stuck generation failed and refunded", {
        generationId: id,
        stuckAfterMinutes: minutes,
      });
      await notifyOrRequeue(id);
    }
    if (rows.length < BATCH_SIZE) break;
  }
  return { failed };
}

async function notifyOrRequeue(generationId: string): Promise<void> {
  try {
    const [row] = await getDb()
      .select()
      .from(generation)
      .where(eq(generation.id, generationId))
      .limit(1);
    if (row) await notify(row);
  } catch (err) {
    logLine("error", "completion hook failed after sweep; queued a run to retry it", {
      generationId,
      error: errorMessage(err),
    });
    await enqueueGeneration(generationId);
  }
}
