import { eq } from "drizzle-orm";
import { getDb, type Db } from "@/server/db/client";
import { damiRun, type DamiRunStatus } from "@/server/db/schema";
import type { TokenUsage } from "./pricing";

export type DamiRunStart = {
  damiKey: string;
  damiVersion: string;
  model: string;
  userId: string | null;
  projectId: string | null;
  input: unknown;
};

type DamiRunEnd = {
  attempts: number;
  /** Null when no API call returned a response. */
  usage: TokenUsage | null;
  costUsd: number | null;
};

export type DamiRunFinish =
  | (DamiRunEnd & { status: "succeeded"; output: unknown })
  | (DamiRunEnd & { status: "failed"; error: string })
  /** Stopped through the abort signal, or swept after its process died. Not an API failure. */
  | (DamiRunEnd & { status: "aborted"; error: string });

/** Persistence for dami runs. The runner is its only user, and so the only writer of dami_run. */
export interface DamiRunStore {
  /** Inserts a `running` row and returns its id. */
  start(run: DamiRunStart): Promise<string>;
  finish(runId: string, result: DamiRunFinish): Promise<void>;
}

export function createDrizzleDamiRunStore(db: Db = getDb()): DamiRunStore {
  return {
    async start(run) {
      const [row] = await db
        .insert(damiRun)
        .values({
          damiKey: run.damiKey,
          damiVersion: run.damiVersion,
          model: run.model,
          status: "running",
          userId: run.userId,
          projectId: run.projectId,
          input: run.input,
          startedAt: new Date(),
        })
        .returning({ id: damiRun.id });
      if (!row) throw new Error("dami_run insert returned no row");
      return row.id;
    },
    async finish(runId, result) {
      const usage = result.usage;
      await db
        .update(damiRun)
        .set({
          // `aborted` is stored as free text; DamiRunStatus (db/schema.ts) should list it.
          status: result.status as string as DamiRunStatus,
          output: result.status === "succeeded" ? result.output : null,
          error: result.status === "succeeded" ? null : result.error,
          attempts: result.attempts,
          inputTokens: usage?.inputTokens ?? null,
          outputTokens: usage?.outputTokens ?? null,
          cacheReadTokens: usage?.cacheReadTokens ?? null,
          cacheWriteTokens: usage?.cacheWriteTokens ?? null,
          costUsd: result.costUsd === null ? null : result.costUsd.toFixed(6),
          finishedAt: new Date(),
        })
        .where(eq(damiRun.id, runId));
    },
  };
}
