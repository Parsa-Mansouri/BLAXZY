/**
 * A job that runs a Creative Bible consumer, against the real local Postgres in sample mode:
 * a bible still compiling defers the job (a delayed copy with a raised `bibleWaits`, the dami is
 * not run), a ready one is passed to the dami, and a failed, superseded or timed-out one runs
 * without. Jobs go to a throwaway queue schema. Skipped when the database is unreachable.
 */
import "dotenv/config";
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import type { ProjectStyle } from "../../src/server/db/schema";
import {
  createFixtures,
  databaseReachable,
  dropSchema,
  jobContext,
  pointQueueAtThrowawaySchema,
} from "../../src/server/test-support/script-fixtures";

const jobSchema = pointQueueAtThrowawaySchema();
const reachable = await databaseReachable();

describe.skipIf(!reachable)("creative bible wait (integration, sample mode)", async () => {
  const projects = await import("../../src/server/projects");
  const script = await import("../../src/server/script");
  const damis = await import("../../src/server/damis");
  const jobs = await import("../../src/server/jobs");
  const { closeDb, getDb } = await import("../../src/server/db/client");
  const { creativeBible, damiRun } = await import("../../src/server/db/schema");
  const { and, eq } = await import("drizzle-orm");
  const { scriptWriteHandler } = await import("./script-write");
  const bibleFixture = (
    await import("../../src/server/damis/creative-dna/fixtures/model-output.json")
  ).default;
  const fixtures = createFixtures();

  afterAll(async () => {
    await fixtures.cleanup();
    await jobs.closeJobQueue();
    await dropSchema(jobSchema);
    await closeDb();
  });

  const style: ProjectStyle = {
    visualStyle: "noir",
    genre: "drama",
    format: "movie",
    orientation: "portrait",
    totalDurationSeconds: 60,
  };

  /** A project with a registry style, so saving it requested a pending bible. */
  async function setup() {
    const userId = await fixtures.newUser();
    const projectId = await fixtures.newProject(userId, style);
    const bible = await projects.getLatestBible(projectId);
    if (!bible || bible.status !== "pending") throw new Error("expected a pending bible");
    const version = await script.startFromBrief({
      projectId,
      userId,
      brief: "An old fisherman named Tomas finds a map in a bottle.",
    });
    return { userId, projectId, bible, versionId: version?.id ?? "" };
  }

  async function queued(versionId: string) {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const result = await client.query<{ waits: string | null; start_after: Date }>(
        `select data->>'bibleWaits' as waits, start_after from ${jobSchema}.job ` +
          `where name = 'script.write' and data->>'scriptVersionId' = $1 order by created_on`,
        [versionId],
      );
      return result.rows;
    } finally {
      await client.end();
    }
  }

  async function writerRuns(projectId: string) {
    return getDb()
      .select({ input: damiRun.input })
      .from(damiRun)
      .where(and(eq(damiRun.projectId, projectId), eq(damiRun.damiKey, "script-writer")));
  }

  const run = (versionId: string, bibleWaits?: number) =>
    scriptWriteHandler.run(
      { scriptVersionId: versionId, ...(bibleWaits ? { bibleWaits } : {}) },
      jobContext(),
    );

  const status = async (versionId: string, userId: string) =>
    (await script.getScriptVersion(versionId, userId))?.status;

  it("a pending bible defers the job: a delayed copy is queued, no dami runs", async () => {
    const { userId, projectId, versionId } = await setup();
    const before = (await queued(versionId)).length;
    const startedAt = Date.now();
    await run(versionId);
    expect(await status(versionId, userId)).toBe("pending");
    expect(await writerRuns(projectId)).toHaveLength(0);
    const rows = await queued(versionId);
    expect(rows).toHaveLength(before + 1);
    const copy = rows.at(-1);
    expect(copy?.waits).toBe("1");
    expect(copy?.start_after.getTime()).toBeGreaterThan(startedAt + 10_000);
  });

  it("each deferral has its own key: the next wait is queued beside the earlier copy", async () => {
    const { userId, projectId, versionId } = await setup();
    await run(versionId);
    await run(versionId, 1);
    await run(versionId, 1); // a retry of the same deferral changes nothing (deduped)
    const waits = (await queued(versionId)).map((r) => r.waits).filter(Boolean);
    expect(waits).toEqual(["1", "2"]);
    expect(await status(versionId, userId)).toBe("pending");
    expect(await writerRuns(projectId)).toHaveLength(0);
  });

  it("a bible that becomes ready is used: the dami runs once with its slice", async () => {
    const { userId, projectId, bible, versionId } = await setup();
    await run(versionId);
    const parsed = damis.creativeBibleSchema.parse(bibleFixture);
    expect(
      await projects.completeCreativeBible({ bibleId: bible.id, bible: parsed, damiRunId: null }),
    ).toBe(true);
    await run(versionId, 1);
    await run(versionId, 1); // a duplicate delivery does not run the dami again
    expect(await status(versionId, userId)).toBe("in_review");
    const runs = await writerRuns(projectId);
    expect(runs).toHaveLength(1);
    const input = runs[0]?.input as { creativeDna?: string };
    expect(input.creativeDna).toBe(damis.renderCreativeDna("script_writer", parsed).text);
    expect(input.creativeDna).toContain("<creative_dna ");
  });

  it("a bible older than the limit is given up on: the dami runs without one", async () => {
    const { userId, projectId, bible, versionId } = await setup();
    await getDb()
      .update(creativeBible)
      .set({ createdAt: new Date(Date.now() - projects.BIBLE_WAIT_LIMIT_MS - 60_000) })
      .where(eq(creativeBible.id, bible.id));
    await run(versionId, 30);
    expect(await status(versionId, userId)).toBe("in_review");
    const runs = await writerRuns(projectId);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.input).not.toHaveProperty("creativeDna");
  });

  it("a failed bible runs without one at once", async () => {
    const { userId, projectId, bible, versionId } = await setup();
    await projects.failCreativeBible({ bibleId: bible.id, failure: "no", damiRunId: null });
    await run(versionId);
    expect(await status(versionId, userId)).toBe("in_review");
    const runs = await writerRuns(projectId);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.input).not.toHaveProperty("creativeDna");
  });

  it("bibleForRun reads the newest row: none, young, old, failed, superseded, ready", async () => {
    const userId = await fixtures.newUser();
    const noStyle = await projects.createProject({ ownerId: userId, title: "No bible" });
    expect(await projects.bibleForRun(noStyle.id)).toEqual({ kind: "none", reason: "none" });

    const { projectId, bible } = await setup();
    const at = (ms: number) => ({ now: new Date(bible.createdAt.getTime() + ms) });
    expect(await projects.bibleForRun(projectId, at(60_000))).toEqual({ kind: "wait" });
    expect(await projects.bibleForRun(projectId, at(projects.BIBLE_WAIT_LIMIT_MS))).toEqual({
      kind: "none",
      reason: "timed_out",
    });
    await projects.failCreativeBible({ bibleId: bible.id, failure: "no", damiRunId: null });
    expect(await projects.bibleForRun(projectId, at(60_000))).toEqual({
      kind: "none",
      reason: "failed",
    });
    await getDb()
      .update(creativeBible)
      .set({ status: "superseded" })
      .where(eq(creativeBible.id, bible.id));
    expect(await projects.bibleForRun(projectId)).toEqual({ kind: "none", reason: "superseded" });
    await getDb()
      .update(creativeBible)
      .set({ status: "ready", bible: bibleFixture })
      .where(eq(creativeBible.id, bible.id));
    const ready = await projects.bibleForRun(projectId);
    expect(ready.kind).toBe("ready");
  });
});
