/**
 * Follow-up jobs are never lost between a committed state change and its enqueue: the next
 * sequence of a long script is queued with the stored progress (and a retry re-issues it), and a
 * correction round whose detection was applied still gets its re-cut on retry. Against the local
 * Postgres with a throwaway queue schema. Skipped when the database is unreachable.
 */
import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import {
  createFixtures,
  databaseReachable,
  dropSchema,
  jobContext,
  pointQueueAtThrowawaySchema,
} from "../../src/server/test-support/script-fixtures";

const jobSchema = pointQueueAtThrowawaySchema();
const reachable = await databaseReachable();

describe.skipIf(!reachable)("continuations (integration)", async () => {
  const script = await import("../../src/server/script");
  const blocks = await import("../../src/server/blocks");
  const assetJobs = await import("../../src/server/assets/jobs");
  const { closeJobQueue } = await import("../../src/server/jobs");
  const { closeDb, getDb } = await import("../../src/server/db/client");
  const s = await import("../../src/server/db/schema");
  const { sql } = await import("drizzle-orm");
  const { scriptWriteSegmentHandler } = await import("./script-write-segment");
  const fixtures = createFixtures();

  afterAll(async () => {
    await fixtures.cleanup();
    await closeJobQueue();
    await dropSchema(jobSchema);
    await closeDb();
  });

  async function jobs(name: string, versionId: string) {
    const result = await getDb().execute<{ data: Record<string, unknown> }>(
      sql.raw(
        `select data from ${jobSchema}.job where name = '${name}' ` +
          `and data->>'scriptVersionId' = '${versionId}' and state = 'created'`,
      ),
    );
    return result.rows.map((r) => r.data);
  }

  async function dropJobs(name: string, versionId: string) {
    await getDb().execute(
      sql.raw(
        `delete from ${jobSchema}.job where name = '${name}' ` +
          `and data->>'scriptVersionId' = '${versionId}'`,
      ),
    );
  }

  async function version(projectId: string, status: "pending" | "accepted") {
    const [row] = await getDb()
      .insert(s.scriptVersion)
      .values({ projectId, versionNumber: 1, source: "generated", status, content: "x" })
      .returning({ id: s.scriptVersion.id });
    if (!row) throw new Error("setup failed");
    return row.id;
  }

  const progress = {
    nextIndex: 1,
    scenes: [],
    ledger: null,
    warnings: [],
    assumptions: [],
    runIds: [],
  };

  it("queues the next sequence with the stored progress; a retry re-issues it", async () => {
    const userId = await fixtures.newUser();
    const projectId = await fixtures.newProject(userId);
    const versionId = await version(projectId, "pending");

    expect(await script.storeSegmentProgress({ versionId, expectedIndex: 0, progress })).toBe(true);
    expect(await jobs("script.write-segment", versionId)).toEqual([
      { scriptVersionId: versionId, segmentIndex: 1 },
    ]);
    // A duplicate store changes nothing and queues nothing more.
    expect(await script.storeSegmentProgress({ versionId, expectedIndex: 0, progress })).toBe(
      false,
    );
    expect(await jobs("script.write-segment", versionId)).toHaveLength(1);

    // Progress stored without its job (as before the fix): the retry of sequence 0 re-issues it.
    await dropJobs("script.write-segment", versionId);
    await scriptWriteSegmentHandler.run(
      { scriptVersionId: versionId, segmentIndex: 0 },
      jobContext(2),
    );
    expect(await jobs("script.write-segment", versionId)).toEqual([
      { scriptVersionId: versionId, segmentIndex: 1 },
    ]);
  });

  it("knows when a re-cut is still owed after a correction round, and queues it with its state", async () => {
    const userId = await fixtures.newUser();
    const projectId = await fixtures.newProject(userId);
    const versionId = await version(projectId, "accepted");
    expect(await assetJobs.sectioningOwedAfterDetection(projectId, versionId)).toBe(false);

    await getDb()
      .insert(s.assetDetection)
      .values({ projectId, scriptVersionId: versionId, mode: "fix" });
    // No blocks yet: owed.
    expect(await assetJobs.sectioningOwedAfterDetection(projectId, versionId)).toBe(true);

    // Blocks cut after the detection: nothing owed.
    await getDb().insert(s.promptBlock).values({
      projectId,
      scriptVersionId: versionId,
      orderIndex: 0,
      scriptExcerpt: "x",
      prompt: "x",
    });
    expect(await assetJobs.sectioningOwedAfterDetection(projectId, versionId)).toBe(false);

    // A newer detection (the round answered, its re-cut never queued): owed again.
    await getDb()
      .insert(s.assetDetection)
      .values({
        projectId,
        scriptVersionId: versionId,
        mode: "fix",
        createdAt: new Date(Date.now() + 60_000),
      });
    expect(await assetJobs.sectioningOwedAfterDetection(projectId, versionId)).toBe(true);

    await assetJobs.queueResection(projectId, versionId);
    expect(await jobs("script.section", versionId)).toEqual([
      { scriptVersionId: versionId, resection: true },
    ]);
    expect((await blocks.getSectioningStatus(projectId, userId))?.state).toBe("running");
    // Queued twice: one job (deduplicated per version and kind of cut).
    await assetJobs.queueResection(projectId, versionId);
    expect(await jobs("script.section", versionId)).toHaveLength(1);

    // A failed re-cut is the user's to retry: not re-issued behind their back.
    await blocks.setSectioningState({
      projectId,
      state: "failed",
      scriptVersionId: versionId,
      failure: "x",
    });
    expect(await assetJobs.sectioningOwedAfterDetection(projectId, versionId)).toBe(false);
  });
});
