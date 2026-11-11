/**
 * `retrySectioning` against the real local Postgres (jobs go to a throwaway queue schema, where
 * the test reads them back). Skipped when the database is unreachable.
 */
import "dotenv/config";
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  createFixtures,
  databaseReachable,
  dropSchema,
  pointQueueAtThrowawaySchema,
} from "@/server/test-support/script-fixtures";

const jobSchema = pointQueueAtThrowawaySchema();
const reachable = await databaseReachable();

describe.skipIf(!reachable)("retrySectioning (integration)", async () => {
  const blocks = await import("@/server/blocks");
  const { closeJobQueue } = await import("@/server/jobs");
  const { closeDb, getDb } = await import("@/server/db/client");
  const { project, projectEvent, scriptVersion } = await import("@/server/db/schema");
  const { and, eq } = await import("drizzle-orm");
  const fixtures = createFixtures();

  afterAll(async () => {
    await fixtures.cleanup();
    await closeJobQueue();
    await dropSchema(jobSchema);
    await closeDb();
  });

  async function acceptedVersion(projectId: string, versionNumber = 1): Promise<string> {
    const [row] = await getDb()
      .insert(scriptVersion)
      .values({ projectId, versionNumber, source: "edited", status: "accepted", content: "x" })
      .returning({ id: scriptVersion.id });
    if (!row) throw new Error("setup failed");
    return row.id;
  }

  /** Detection jobs queued for a version, read straight from the throwaway queue schema. */
  async function queuedDetections(versionId: string): Promise<number> {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const result = await client.query<{ n: string }>(
        `select count(*) as n from ${jobSchema}.job where name = $1 and data->>'scriptVersionId' = $2`,
        ["script.detect-assets", versionId],
      );
      return Number(result.rows[0]?.n ?? 0);
    } finally {
      await client.end();
    }
  }

  it("re-runs a failed run for the accepted version", async () => {
    const userId = await fixtures.newUser();
    const projectId = await fixtures.newProject(userId);
    const versionId = await acceptedVersion(projectId);
    await blocks.setSectioningState({
      projectId,
      state: "failed",
      scriptVersionId: versionId,
      failure: "The detector gave up.",
    });
    expect((await blocks.getSectioningStatus(projectId, userId))?.state).toBe("failed");

    const status = await blocks.retrySectioning({ projectId, userId });
    expect(status).toEqual({ state: "running", blockCount: 0, failure: null });

    const [row] = await getDb()
      .select({ stageState: project.stageState })
      .from(project)
      .where(eq(project.id, projectId));
    expect(blocks.readSectioningRecord(row?.stageState ?? {})).toEqual({
      state: "running",
      scriptVersionId: versionId,
      failure: null,
    });
    expect(await queuedDetections(versionId)).toBe(1);
    const events = await getDb()
      .select({ type: projectEvent.type })
      .from(projectEvent)
      .where(
        and(eq(projectEvent.projectId, projectId), eq(projectEvent.type, "sectioning.retried")),
      );
    expect(events).toHaveLength(1);
  });

  it("refuses unless the run failed", async () => {
    const userId = await fixtures.newUser();
    const projectId = await fixtures.newProject(userId);
    // No run yet.
    await expect(blocks.retrySectioning({ projectId, userId })).rejects.toBeInstanceOf(
      blocks.BlocksInputError,
    );
    const versionId = await acceptedVersion(projectId);
    for (const state of ["running", "done"] as const) {
      await blocks.setSectioningState({
        projectId,
        state,
        scriptVersionId: versionId,
        failure: null,
      });
      await expect(blocks.retrySectioning({ projectId, userId })).rejects.toThrow(
        "Only a run that failed can be tried again.",
      );
    }
    expect(await queuedDetections(versionId)).toBe(0);
  });

  it("refuses a failed run without an accepted script", async () => {
    const userId = await fixtures.newUser();
    const projectId = await fixtures.newProject(userId);
    const versionId = await acceptedVersion(projectId);
    await getDb()
      .update(scriptVersion)
      .set({ status: "superseded" })
      .where(eq(scriptVersion.id, versionId));
    await blocks.setSectioningState({
      projectId,
      state: "failed",
      scriptVersionId: versionId,
      failure: "x",
    });
    await expect(blocks.retrySectioning({ projectId, userId })).rejects.toThrow(
      "There is no accepted script to prepare.",
    );
  });

  it("reads another user's or an archived project as missing", async () => {
    const owner = await fixtures.newUser();
    const stranger = await fixtures.newUser();
    const projectId = await fixtures.newProject(owner);
    const versionId = await acceptedVersion(projectId);
    await blocks.setSectioningState({
      projectId,
      state: "failed",
      scriptVersionId: versionId,
      failure: "x",
    });
    expect(await blocks.retrySectioning({ projectId, userId: stranger })).toBeNull();
    expect(await blocks.retrySectioning({ projectId: "not-a-uuid", userId: owner })).toBeNull();
    await getDb().update(project).set({ archivedAt: new Date() }).where(eq(project.id, projectId));
    expect(await blocks.retrySectioning({ projectId, userId: owner })).toBeNull();
    expect(await queuedDetections(versionId)).toBe(0);
  });
});
