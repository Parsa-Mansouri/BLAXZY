/**
 * The stuck-row sweep against the real local Postgres, with the job queue in a throwaway schema:
 * a pending row whose job failed for good (a worker killed during the last attempt) or vanished is
 * failed with the "took too long" copy; a row whose job is queued, retrying, running or finished a
 * moment ago is left alone; a second sweep is a no-op. Scoped to this file's projects (other
 * suites share the database). Skipped when the database is unreachable.
 */
import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import {
  createFixtures,
  databaseReachable,
  dropSchema,
  pointQueueAtThrowawaySchema,
} from "../../src/server/test-support/script-fixtures";

const jobSchema = pointQueueAtThrowawaySchema();
const reachable = await databaseReachable();

describe.skipIf(!reachable)("sweepStuckRows (integration)", async () => {
  const script = await import("../../src/server/script");
  const { closeJobQueue } = await import("../../src/server/jobs");
  const { closeDb, getDb } = await import("../../src/server/db/client");
  const s = await import("../../src/server/db/schema");
  const { eq, sql } = await import("drizzle-orm");
  const { sweepStuckRows } = await import("./stuck-rows");
  const { TOOK_TOO_LONG } = await import("./failure");
  const fixtures = createFixtures();
  const db = getDb();
  const jobTable = sql`${sql.identifier(jobSchema)}.job`;

  afterAll(async () => {
    await fixtures.cleanup();
    await closeJobQueue();
    await dropSchema(jobSchema);
    await closeDb();
  });

  /** The row was created an hour ago (past any grace). */
  async function age(versionId: string): Promise<void> {
    await db
      .update(s.scriptVersion)
      .set({ createdAt: new Date(Date.now() - 60 * 60_000) })
      .where(eq(s.scriptVersion.id, versionId));
  }

  /** Puts every job of the version in `state`, finished `finishedMinutesAgo` ago when terminal. */
  async function setJobs(versionId: string, state: string, finishedMinutesAgo = 60) {
    const finished = new Date(Date.now() - finishedMinutesAgo * 60_000).toISOString();
    const terminal = ["completed", "failed", "cancelled"].includes(state);
    await db.execute(
      sql`update ${jobTable} set state = ${state}::${sql.identifier(jobSchema)}.job_state,
          completed_on = ${terminal ? finished : null}::timestamptz
          where data->>'scriptVersionId' = ${versionId}`,
    );
  }

  async function status(versionId: string) {
    const [row] = await db
      .select({ status: s.scriptVersion.status, notes: s.scriptVersion.damiNotes })
      .from(s.scriptVersion)
      .where(eq(s.scriptVersion.id, versionId));
    return row;
  }

  async function setup(kind: "brief" | "idea" = "brief") {
    const userId = await fixtures.newUser();
    const projectId = await fixtures.newProject(userId);
    const version =
      kind === "brief"
        ? await script.startFromBrief({ projectId, userId, brief: "A lighthouse keeper's dog." })
        : await script.startFromIdea({ projectId, userId, idea: "A lighthouse keeper's dog." });
    const versionId = version?.id ?? "";
    await age(versionId);
    const jobs = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from ${jobTable} where data->>'scriptVersionId' = ${versionId}`,
    );
    expect(jobs.rows[0]?.n).toBe(1);
    return { projectId, versionId };
  }

  const sweep = (projectId: string) =>
    sweepStuckRows({ graceMinutes: 15, projectIds: [projectId] });

  it("leaves a row whose job is queued, retrying or running", async () => {
    const { projectId, versionId } = await setup();
    for (const state of ["created", "retry", "active"]) {
      await setJobs(versionId, state);
      const { recovered } = await sweep(projectId);
      expect(recovered).toEqual([]);
      expect((await status(versionId))?.status).toBe("pending");
    }
  });

  it("leaves a row whose job finished within the grace window", async () => {
    const { projectId, versionId } = await setup();
    await setJobs(versionId, "failed", 2);
    expect((await sweep(projectId)).recovered).toEqual([]);
    expect((await status(versionId))?.status).toBe("pending");
  });

  it("leaves a row younger than the grace window, even without a job", async () => {
    const { projectId, versionId } = await setup();
    await db.execute(sql`delete from ${jobTable} where data->>'scriptVersionId' = ${versionId}`);
    await db
      .update(s.scriptVersion)
      .set({ createdAt: new Date() })
      .where(eq(s.scriptVersion.id, versionId));
    expect((await sweep(projectId)).recovered).toEqual([]);
    expect((await status(versionId))?.status).toBe("pending");
  });

  it("fails a row whose job failed for good, once (a second sweep is a no-op)", async () => {
    const { projectId, versionId } = await setup();
    await setJobs(versionId, "failed", 30);
    const first = await sweep(projectId);
    expect(first.recovered).toEqual([{ kind: "script_version", id: versionId, projectId }]);
    const row = await status(versionId);
    expect(row?.status).toBe("failed");
    expect(script.readScriptNotes(row?.notes).failure).toBe(TOOK_TOO_LONG);
    // The failure is the one the screens show, with its retry.
    const events = await db
      .select({ type: s.projectEvent.type })
      .from(s.projectEvent)
      .where(eq(s.projectEvent.projectId, projectId));
    expect(events.map((e) => e.type)).toContain("script.failed");

    expect((await sweep(projectId)).recovered).toEqual([]);
  });

  it("fails a row whose job is gone", async () => {
    const { projectId, versionId } = await setup();
    await db.execute(sql`delete from ${jobTable} where data->>'scriptVersionId' = ${versionId}`);
    const { recovered } = await sweep(projectId);
    expect(recovered.map((r) => r.id)).toEqual([versionId]);
    expect((await status(versionId))?.status).toBe("failed");
  });

  it("keeps the user's own idea for an enhanced version whose job was lost", async () => {
    const { projectId, versionId } = await setup("idea");
    await setJobs(versionId, "failed", 30);
    expect((await sweep(projectId)).recovered.map((r) => r.id)).toEqual([versionId]);
    const [row] = await db
      .select({ status: s.scriptVersion.status, content: s.scriptVersion.content })
      .from(s.scriptVersion)
      .where(eq(s.scriptVersion.id, versionId));
    expect(row).toEqual({ status: "in_review", content: "A lighthouse keeper's dog." });
  });

  it("fails a look whose job is gone, and leaves a prop's untouched first look (it may wait)", async () => {
    const userId = await fixtures.newUser();
    const projectId = await fixtures.newProject(userId);
    const old = new Date(Date.now() - 60 * 60_000);
    const [hero, lamp] = await db
      .insert(s.asset)
      .values([
        { projectId, kind: "character", name: "Mara" },
        { projectId, kind: "prop", name: "Lamp" },
      ])
      .returning({ id: s.asset.id });
    const [stuck, waiting] = await db
      .insert(s.assetLook)
      .values([
        {
          assetId: hero?.id ?? "",
          projectId,
          versionNumber: 1,
          source: "generated",
          createdAt: old,
        },
        {
          assetId: lamp?.id ?? "",
          projectId,
          versionNumber: 1,
          source: "generated",
          createdAt: old,
        },
      ])
      .returning({ id: s.assetLook.id });
    const { recovered } = await sweep(projectId);
    expect(recovered.filter((r) => r.kind === "asset_look").map((r) => r.id)).toEqual([stuck?.id]);
    const rows = await db
      .select({ id: s.assetLook.id, status: s.assetLook.status, failure: s.assetLook.failure })
      .from(s.assetLook)
      .where(eq(s.assetLook.projectId, projectId));
    expect(rows.find((r) => r.id === stuck?.id)).toMatchObject({
      status: "failed",
      failure: TOOK_TOO_LONG,
    });
    expect(rows.find((r) => r.id === waiting?.id)?.status).toBe("pending");
  });
});
