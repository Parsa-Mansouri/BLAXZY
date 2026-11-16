/**
 * Automatic project names against the real local Postgres, in sample mode: the first story (an
 * idea, or an uploaded script once the worker has read it) queues `project.name`, the handler
 * names an untitled project once, a rename by the user always wins, and a titled or already named
 * project is never queued or touched. Jobs go to a throwaway queue schema. Skipped when the
 * database is unreachable.
 */
import "dotenv/config";
import { Client } from "pg";
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

const IDEA =
  "A retired lighthouse keeper learns the lamp he tended for forty years is being replaced.";

describe.skipIf(!reachable)("project naming (integration, sample mode)", async () => {
  const projects = await import("../../src/server/projects");
  const script = await import("../../src/server/script");
  const { closeJobQueue } = await import("../../src/server/jobs");
  const { closeDb, getDb } = await import("../../src/server/db/client");
  const { damiRun, projectEvent } = await import("../../src/server/db/schema");
  const { and, asc, eq } = await import("drizzle-orm");
  const { projectNameHandler } = await import("./project-name");
  const { scriptCheckHandler } = await import("./script-check");
  const fixtures = createFixtures();

  afterAll(async () => {
    await fixtures.cleanup();
    await closeJobQueue();
    await dropSchema(jobSchema);
    await closeDb();
  });

  async function queuedJobs(projectId: string): Promise<{ scriptVersionId: string }[]> {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const result = await client.query<{ data: { scriptVersionId: string } }>(
        `select data from ${jobSchema}.job where name = 'project.name' and data->>'projectId' = $1`,
        [projectId],
      );
      return result.rows.map((r) => ({ scriptVersionId: r.data.scriptVersionId }));
    } finally {
      await client.end();
    }
  }

  const runHandler = (projectId: string, scriptVersionId: string) =>
    projectNameHandler.run({ projectId, scriptVersionId }, jobContext());

  async function current(ownerId: string, projectId: string) {
    const found = await projects.getProjectForUser(projectId, ownerId);
    if (!found) throw new Error("project missing");
    return found;
  }

  async function namerRuns(projectId: string): Promise<number> {
    const rows = await getDb()
      .select({ model: damiRun.model })
      .from(damiRun)
      .where(and(eq(damiRun.projectId, projectId), eq(damiRun.damiKey, "project-namer")));
    for (const row of rows) expect(row.model).toBe("sample");
    return rows.length;
  }

  async function events(projectId: string): Promise<string[]> {
    const rows = await getDb()
      .select({ type: projectEvent.type })
      .from(projectEvent)
      .where(eq(projectEvent.projectId, projectId))
      .orderBy(asc(projectEvent.createdAt));
    return rows.map((e) => e.type);
  }

  async function untitled() {
    const userId = await fixtures.newUser();
    const projectId = await fixtures.newProject(userId, undefined, { untitled: true });
    expect(await current(userId, projectId)).toMatchObject({
      title: "Untitled project",
      titleSource: "placeholder",
    });
    return { userId, projectId };
  }

  it("an idea queues the job and the handler names the project once", async () => {
    const { userId, projectId } = await untitled();
    const version = await script.startFromIdea({ projectId, userId, idea: IDEA });
    expect(await queuedJobs(projectId)).toEqual([{ scriptVersionId: version?.id }]);

    await runHandler(projectId, version?.id ?? "");
    await runHandler(projectId, version?.id ?? "");
    expect(await current(userId, projectId)).toMatchObject({
      title: "Retired Lighthouse Keeper Learns",
      titleSource: "auto",
    });
    expect(await namerRuns(projectId)).toBe(1);
    expect(await events(projectId)).toContain("project.named");
  });

  it("a brief queues the job too", async () => {
    const { userId, projectId } = await untitled();
    await script.startFromBrief({ projectId, userId, brief: IDEA });
    expect(await queuedJobs(projectId)).toHaveLength(1);
  });

  it("a rename before the job runs wins: the job does nothing", async () => {
    const { userId, projectId } = await untitled();
    const version = await script.startFromIdea({ projectId, userId, idea: IDEA });
    await projects.renameProject({ projectId, ownerId: userId, title: "My Own Title" });
    await runHandler(projectId, version?.id ?? "");
    expect(await current(userId, projectId)).toMatchObject({
      title: "My Own Title",
      titleSource: "user",
    });
    expect(await namerRuns(projectId)).toBe(0);
    expect(await events(projectId)).not.toContain("project.named");
  });

  it("a rename that lands after the name was made still wins", async () => {
    const { userId, projectId } = await untitled();
    await projects.renameProject({ projectId, ownerId: userId, title: "Mine" });
    const applied = await projects.applyAutoName({
      projectId,
      title: "Late Name",
      damiRunId: null,
    });
    expect(applied).toBe(false);
    expect((await current(userId, projectId)).title).toBe("Mine");
  });

  it("a second story does not queue or rename", async () => {
    const { userId, projectId } = await untitled();
    const first = await script.startFromIdea({ projectId, userId, idea: IDEA });
    await runHandler(projectId, first?.id ?? "");
    const named = await current(userId, projectId);
    expect(named.titleSource).toBe("auto");

    await script.failScriptVersion(first?.id ?? "", "stopped");
    const second = await script.startFromIdea({
      projectId,
      userId,
      idea: "Two sisters inherit a failing circus.",
    });
    expect(await queuedJobs(projectId)).toHaveLength(1);
    await runHandler(projectId, second?.id ?? "");
    expect((await current(userId, projectId)).title).toBe(named.title);
    expect(await namerRuns(projectId)).toBe(1);
  });

  it("a project the user titled is never queued", async () => {
    const userId = await fixtures.newUser();
    const projectId = await fixtures.newProject(userId);
    await script.startFromIdea({ projectId, userId, idea: IDEA });
    expect(await queuedJobs(projectId)).toHaveLength(0);
    expect(await current(userId, projectId)).toMatchObject({
      title: "Script IT",
      titleSource: "user",
    });
  });

  it("an upload is named once the worker has read the file", async () => {
    const { userId, projectId } = await untitled();
    const { putFileBytes } = await import("../../src/server/storage");
    const text = [
      "EXT. HARBOUR PIER - DUSK",
      "",
      "MARA (60s) hurries down the planks clutching a brass locket while the ferry horn sounds.",
      "",
      "MARA",
      "Wait. Please wait.",
    ].join("\n");
    const file = await putFileBytes({
      ownerId: userId,
      projectId,
      name: "pier.txt",
      mimeType: "text/plain",
      purpose: "script_document",
      bytes: new TextEncoder().encode(text),
    });
    const version = await script.startFromUpload({ projectId, userId, fileId: file.id });
    // The text only exists after the check: nothing is queued yet.
    expect(await queuedJobs(projectId)).toHaveLength(0);

    await scriptCheckHandler.run({ scriptVersionId: version?.id ?? "" }, jobContext());
    expect(await queuedJobs(projectId)).toEqual([{ scriptVersionId: version?.id }]);
    await runHandler(projectId, version?.id ?? "");
    const named = await current(userId, projectId);
    expect(named.titleSource).toBe("auto");
    expect(named.title).not.toBe("Untitled project");
  });
});
