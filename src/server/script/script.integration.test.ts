/**
 * The script services against the real local Postgres (jobs go to a throwaway queue schema; no
 * worker runs here, so versions are moved to review with `completeScriptVersion`). Skipped when
 * the database is unreachable.
 */
import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import {
  createFixtures,
  databaseReachable,
  dropSchema,
  pointQueueAtThrowawaySchema,
} from "@/server/test-support/script-fixtures";

const jobSchema = pointQueueAtThrowawaySchema();
const reachable = await databaseReachable();

describe.skipIf(!reachable)("script services (integration)", async () => {
  const script = await import("@/server/script");
  const { closeJobQueue } = await import("@/server/jobs");
  const { closeDb, getDb } = await import("@/server/db/client");
  const { damiRun, project, projectEvent, review } = await import("@/server/db/schema");
  const { and, eq, sql } = await import("drizzle-orm");
  const fixtures = createFixtures();

  afterAll(async () => {
    await fixtures.cleanup();
    await closeJobQueue();
    await dropSchema(jobSchema);
    await closeDb();
  });

  const CONTENT = [
    "FADE IN:",
    "",
    "EXT. HARBOUR PIER - DUSK",
    "",
    "MARA (60s) hurries down the planks clutching a brass locket.",
    "",
    "MARA",
    "Wait. Please wait.",
    "",
    "FADE OUT.",
  ].join("\n");

  /** Simulates the write job: a dami run row, then pending → in_review. */
  async function writeDone(versionId: string, projectId: string, model = "sample") {
    const [run] = await getDb()
      .insert(damiRun)
      .values({
        damiKey: "script-writer",
        damiVersion: "1.0.0",
        model,
        status: "succeeded",
        projectId,
        input: {},
      })
      .returning({ id: damiRun.id });
    if (!run) throw new Error("no run");
    const changed = await script.completeScriptVersion({
      versionId,
      content: CONTENT,
      damiRunId: run.id,
      notes: { title: "The Pier", logline: "Mara runs.", notes: ["A note."] },
    });
    return { runId: run.id, changed };
  }

  it("runs the lifecycle: brief → pending → in review → rejected → revised → accepted → superseded", async () => {
    const userId = await fixtures.newUser();
    const projectId = await fixtures.newProject(userId);

    const started = await script.startFromBrief({ projectId, userId, brief: "  A pier at dusk. " });
    expect(started).toMatchObject({
      versionNumber: 1,
      source: "generated",
      status: "pending",
      brief: "A pier at dusk.",
      content: null,
    });
    const v1 = started?.id ?? "";
    await expect(script.startFromBrief({ projectId, userId, brief: "again" })).rejects.toThrow(
      /still being prepared/,
    );
    expect((await script.getScriptState(projectId, userId))?.busy).toBe(true);

    const { runId, changed } = await writeDone(v1, projectId);
    expect(changed).toBe(true);
    expect((await writeDone(v1, projectId)).changed).toBe(false); // a duplicate run is a no-op
    const inReview = await script.getScriptVersion(v1, userId);
    expect(inReview).toMatchObject({
      status: "in_review",
      title: "The Pier",
      logline: "Mara runs.",
      notes: ["A note."],
      isSample: true,
      content: CONTENT,
    });

    const quote = "Wait. Please wait.";
    const start = CONTENT.indexOf(quote);
    const next = await script.submitScriptReview({
      projectId,
      userId,
      versionId: v1,
      decision: "rejected",
      note: "Warmer.",
      comments: [{ quote, start, end: start + quote.length, note: "Softer." }],
    });
    expect(next).toMatchObject({ versionNumber: 2, source: "revised", status: "pending" });
    expect((await script.getScriptVersion(v1, userId))?.status).toBe("rejected");
    const [stored] = await getDb().select().from(review).where(eq(review.subjectId, v1));
    expect(stored).toMatchObject({
      decision: "rejected",
      issueCodes: [],
      fixRequests: [],
      note: "Warmer.",
      damiRunId: runId,
    });
    expect(stored?.comments).toHaveLength(1);

    const v2 = next?.id ?? "";
    await writeDone(v2, projectId);
    const accepted = await script.submitScriptReview({
      projectId,
      userId,
      versionId: v2,
      decision: "accepted",
    });
    expect(accepted).toMatchObject({ id: v2, status: "accepted" });
    const [row] = await getDb().select().from(project).where(eq(project.id, projectId));
    expect(row?.stage).toBe("pre_production");
    expect(row?.stageState.sectioning).toMatchObject({ state: "running", scriptVersionId: v2 });

    // Editing with the same text is a no-op.
    const same = await script.editAcceptedScript({ projectId, userId, content: `${CONTENT}\n\n` });
    expect(same?.id).toBe(v2);

    const edited = await script.editAcceptedScript({
      projectId,
      userId,
      content: CONTENT.replace("Wait.", "Hold on."),
    });
    expect(edited).toMatchObject({
      versionNumber: 3,
      source: "edited",
      status: "accepted",
      title: "The Pier",
      isSample: false,
    });
    expect((await script.getScriptVersion(v2, userId))?.status).toBe("superseded");

    const state = await script.getScriptState(projectId, userId);
    expect(state?.current?.id).toBe(edited?.id);
    expect(state?.accepted?.id).toBe(edited?.id);
    expect(state?.versions.map((v) => v.versionNumber)).toEqual([3, 2, 1]);
    expect(state?.busy).toBe(false);

    const events = await getDb()
      .select({ type: projectEvent.type })
      .from(projectEvent)
      .where(eq(projectEvent.projectId, projectId));
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining([
        "script.started",
        "script.ready",
        "script.rejected",
        "script.accepted",
        "stage.advanced",
        "script.edited",
      ]),
    );
  });

  /** Jobs of a type queued for a version, read from the throwaway queue schema. */
  async function queued(name: string, versionId: string): Promise<number> {
    const result = await getDb().execute<{ n: number }>(
      sql`select count(*)::int as n from ${sql.raw(jobSchema)}.job
          where name = ${name} and data->>'scriptVersionId' = ${versionId}`,
    );
    return Number(result.rows[0]?.n ?? 0);
  }

  it("queues each version's job with it, and an edit supersedes a version still in review", async () => {
    const userId = await fixtures.newUser();
    const projectId = await fixtures.newProject(userId);
    const v1 = (await script.startFromBrief({ projectId, userId, brief: "A pier." }))?.id ?? "";
    expect(await queued("script.write", v1)).toBe(1);
    await writeDone(v1, projectId);
    await script.submitScriptReview({ projectId, userId, versionId: v1, decision: "accepted" });
    expect(await queued("script.detect-assets", v1)).toBe(1);

    // A new draft is waiting for review when the user edits the accepted script.
    const v2 = (await script.startFromBrief({ projectId, userId, brief: "Another." }))?.id ?? "";
    await writeDone(v2, projectId);
    expect((await script.getScriptVersion(v2, userId))?.status).toBe("in_review");
    const edited = await script.editAcceptedScript({
      projectId,
      userId,
      content: CONTENT.replace("Wait.", "Stop."),
    });
    expect(edited).toMatchObject({ versionNumber: 3, status: "accepted" });
    expect(await queued("script.detect-assets", edited?.id ?? "")).toBe(1);
    expect((await script.getScriptVersion(v2, userId))?.status).toBe("superseded");
    const state = await script.getScriptState(projectId, userId);
    expect(state?.current?.id).toBe(edited?.id);
    const [event] = await getDb()
      .select({ payload: projectEvent.payload })
      .from(projectEvent)
      .where(and(eq(projectEvent.projectId, projectId), eq(projectEvent.type, "script.edited")));
    expect(event?.payload).toMatchObject({ supersededInReview: [v2] });
  });

  it("keeps the failed attempt in the retry's event (the row is reset)", async () => {
    const userId = await fixtures.newUser();
    const projectId = await fixtures.newProject(userId);
    const v1 = (await script.startFromBrief({ projectId, userId, brief: "A pier." }))?.id ?? "";
    const [run] = await getDb()
      .insert(damiRun)
      .values({
        damiKey: "script-writer",
        damiVersion: "1.0.0",
        model: "sample",
        status: "failed",
        projectId,
        input: {},
      })
      .returning({ id: damiRun.id });
    expect(await script.failScriptVersion(v1, "Claude is busy right now.", run?.id)).toBe(true);
    const retried = await script.retryScriptVersion({ projectId, userId, versionId: v1 });
    expect(retried).toMatchObject({ status: "pending", failure: null });
    const [event] = await getDb()
      .select({ payload: projectEvent.payload })
      .from(projectEvent)
      .where(and(eq(projectEvent.projectId, projectId), eq(projectEvent.type, "script.retried")));
    expect(event?.payload).toEqual({
      versionId: v1,
      previousFailure: "Claude is busy right now.",
      previousDamiRunId: run?.id,
    });
    expect(await queued("script.write", v1)).toBe(1); // the queued job is reused (same key)
  });

  it("validates reviews", async () => {
    const userId = await fixtures.newUser();
    const projectId = await fixtures.newProject(userId);
    const v1 = (await script.startFromBrief({ projectId, userId, brief: "A pier." }))?.id ?? "";

    // Not in review yet.
    await expect(
      script.submitScriptReview({ projectId, userId, versionId: v1, decision: "accepted" }),
    ).rejects.toThrow(/no longer waiting/);
    await writeDone(v1, projectId);

    await expect(
      script.submitScriptReview({ projectId, userId, versionId: v1, decision: "rejected" }),
    ).rejects.toBeInstanceOf(script.ScriptInputError);
    await expect(
      script.submitScriptReview({
        projectId,
        userId,
        versionId: v1,
        decision: "rejected",
        note: "  ",
      }),
    ).rejects.toBeInstanceOf(script.ScriptInputError);
    await expect(
      script.submitScriptReview({
        projectId,
        userId,
        versionId: v1,
        decision: "rejected",
        note: "x".repeat(2001),
      }),
    ).rejects.toThrow(/2,000/);
    await expect(
      script.submitScriptReview({
        projectId,
        userId,
        versionId: v1,
        decision: "rejected",
        comments: [{ quote: "Nothing like this", start: 0, end: 5, note: "Hm" }],
      }),
    ).rejects.toThrow(/not in this version/);
    await expect(
      script.submitScriptReview({
        projectId,
        userId,
        versionId: v1,
        decision: "rejected",
        comments: [{ quote: "FADE IN:", start: 0, end: 99_999, note: "Hm" }],
      }),
    ).rejects.toThrow(/outside the script/);
    await expect(script.editAcceptedScript({ projectId, userId, content: "x" })).rejects.toThrow(
      /no accepted script/,
    );

    // A failed version can be retried; others cannot.
    await expect(script.retryScriptVersion({ projectId, userId, versionId: v1 })).rejects.toThrow(
      /failed/,
    );
    const rejected = await script.submitScriptReview({
      projectId,
      userId,
      versionId: v1,
      decision: "rejected",
      note: "More.",
    });
    const v2 = rejected?.id ?? "";
    expect(await script.failScriptVersion(v2, "Claude is busy right now.")).toBe(true);
    const failed = await script.getScriptVersion(v2, userId);
    expect(failed).toMatchObject({ status: "failed", failure: "Claude is busy right now." });
    const retried = await script.retryScriptVersion({ projectId, userId, versionId: v2 });
    expect(retried).toMatchObject({ status: "pending", failure: null });
  });

  it("refuses a project whose style is not set", async () => {
    const userId = await fixtures.newUser();
    const projects = await import("@/server/projects");
    const bare = await projects.createProject({ ownerId: userId, title: "No style" });
    await expect(script.startFromBrief({ projectId: bare.id, userId, brief: "x" })).rejects.toThrow(
      /style/,
    );
  });

  it("isolates users: another user's project and versions read as missing", async () => {
    const owner = await fixtures.newUser();
    const other = await fixtures.newUser();
    const projectId = await fixtures.newProject(owner);
    const v1 =
      (await script.startFromBrief({ projectId, userId: owner, brief: "Mine." }))?.id ?? "";
    await writeDone(v1, projectId);

    expect(await script.startFromBrief({ projectId, userId: other, brief: "Theirs." })).toBeNull();
    expect(await script.getScriptState(projectId, other)).toBeNull();
    expect(await script.getScriptVersion(v1, other)).toBeNull();
    expect(
      await script.submitScriptReview({
        projectId,
        userId: other,
        versionId: v1,
        decision: "accepted",
      }),
    ).toBeNull();
    expect(await script.retryScriptVersion({ projectId, userId: other, versionId: v1 })).toBeNull();
    expect(await script.editAcceptedScript({ projectId, userId: other, content: "x" })).toBeNull();
    expect(await script.getScriptState("not-a-uuid", owner)).toBeNull();
    // The owner still sees it untouched.
    expect((await script.getScriptVersion(v1, owner))?.status).toBe("in_review");
  });

  it("starts from an upload only with a ready file of the user", async () => {
    const userId = await fixtures.newUser();
    const other = await fixtures.newUser();
    const projectId = await fixtures.newProject(userId);
    const { putFileBytes } = await import("@/server/storage");
    const file = await putFileBytes({
      ownerId: userId,
      projectId,
      name: "pier.txt",
      mimeType: "text/plain",
      purpose: "script_document",
      bytes: new TextEncoder().encode(CONTENT),
    });
    await expect(
      script.startFromUpload({ projectId, userId: other, fileId: file.id }),
    ).rejects.toThrow(/not available/);
    const started = await script.startFromUpload({ projectId, userId, fileId: file.id });
    expect(started).toMatchObject({ source: "uploaded", status: "pending", versionNumber: 1 });
  });
});
