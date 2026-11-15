/**
 * The Creative Bible against the real local Postgres, in sample mode: saving a Style requests a
 * bible and queues its job, the handler compiles it (idempotently), and a Style change supersedes
 * it with a new version. Jobs go to a throwaway queue schema. Skipped when the database is
 * unreachable.
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

describe.skipIf(!reachable)("creative bible (integration, sample mode)", async () => {
  const projects = await import("../../src/server/projects");
  const damis = await import("../../src/server/damis");
  const { closeJobQueue } = await import("../../src/server/jobs");
  const { closeDb, getDb } = await import("../../src/server/db/client");
  const { creativeBible, damiRun, projectEvent } = await import("../../src/server/db/schema");
  const { and, asc, eq } = await import("drizzle-orm");
  const { projectCreativeDnaHandler } = await import("./project-creative-dna");
  const fixtures = createFixtures();

  afterAll(async () => {
    await fixtures.cleanup();
    await closeJobQueue();
    await dropSchema(jobSchema);
    await closeDb();
  });

  const style = (overrides: Partial<ProjectStyle> = {}): ProjectStyle => ({
    visualStyle: "noir",
    genre: "drama",
    format: "movie",
    orientation: "portrait",
    totalDurationSeconds: 60,
    ...overrides,
  });

  async function newProject() {
    const userId = await fixtures.newUser();
    const created = await projects.createProject({ ownerId: userId, title: "Bible IT" });
    return { userId, projectId: created.id };
  }

  const save = (userId: string, projectId: string, s: ProjectStyle) =>
    projects.saveStyle({ projectId, userId, style: s });

  async function rows(projectId: string) {
    return getDb()
      .select()
      .from(creativeBible)
      .where(eq(creativeBible.projectId, projectId))
      .orderBy(asc(creativeBible.versionNumber));
  }

  async function queuedJobs(bibleId: string): Promise<number> {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const result = await client.query(
        `select id from ${jobSchema}.job where name = 'project.creative-dna' and data->>'bibleId' = $1`,
        [bibleId],
      );
      return result.rowCount ?? 0;
    } finally {
      await client.end();
    }
  }

  async function runHandler(bibleId: string): Promise<void> {
    await projectCreativeDnaHandler.run({ bibleId }, jobContext());
  }

  async function runs(projectId: string): Promise<number> {
    const found = await getDb()
      .select({ model: damiRun.model })
      .from(damiRun)
      .where(and(eq(damiRun.projectId, projectId), eq(damiRun.damiKey, "creative-dna")));
    for (const row of found) expect(row.model).toBe("sample");
    return found.length;
  }

  async function events(projectId: string): Promise<string[]> {
    const found = await getDb()
      .select({ type: projectEvent.type })
      .from(projectEvent)
      .where(eq(projectEvent.projectId, projectId))
      .orderBy(asc(projectEvent.createdAt));
    return found.map((e) => e.type);
  }

  it("saving a registry style creates a pending bible and queues its job", async () => {
    const { userId, projectId } = await newProject();
    await save(userId, projectId, style());
    const [first, ...rest] = await rows(projectId);
    expect(rest).toHaveLength(0);
    expect(first).toMatchObject({
      versionNumber: 1,
      genreId: "genre.drama",
      styleId: "style.noir",
      status: "pending",
      bible: null,
      damiRunId: null,
    });
    expect(first?.styleSnapshot).toMatchObject({ visualStyle: "noir", genre: "drama" });
    expect(await queuedJobs(first?.id ?? "")).toBe(1);
    expect(await events(projectId)).toContain("creative_bible.requested");
    expect(await projects.getReadyBible(projectId)).toBeNull();
  });

  it("the handler stores a ready bible that passes the schema, and runs once", async () => {
    const { userId, projectId } = await newProject();
    await save(userId, projectId, style({ genre: "sci-fi", visualStyle: "3d-animation" }));
    const [pending] = await rows(projectId);
    const id = pending?.id ?? "";
    await runHandler(id);
    await runHandler(id);
    expect(await runs(projectId)).toBe(1);

    const [stored] = await rows(projectId);
    expect(stored).toMatchObject({ status: "ready", failure: null });
    expect(stored?.finishedAt).not.toBeNull();
    expect(stored?.damiRunId).not.toBeNull();
    const parsed = damis.creativeBibleSchema.safeParse(stored?.bible);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.selection).toEqual({
      genre_id: "genre.sci_fi",
      style_id: "style.animation_3d",
    });
    expect(parsed.data?.project_frame).toMatchObject({
      orientation: "portrait",
      blocks_per_episode: 4,
    });

    const ready = await projects.getReadyBible(projectId);
    expect(ready).toMatchObject({ id, versionNumber: 1, genreId: "genre.sci_fi" });
    expect((await projects.getLatestBible(projectId))?.id).toBe(id);
    expect(await events(projectId)).toContain("creative_bible.ready");
  });

  it("saving the same style again creates nothing; a changed genre supersedes with version 2", async () => {
    const { userId, projectId } = await newProject();
    await save(userId, projectId, style());
    const [v1] = await rows(projectId);
    await runHandler(v1?.id ?? "");

    // Nothing the bible depends on changed (only a field a dami writes).
    await save(userId, projectId, style({ lookLine: "Hard light." }));
    expect(await rows(projectId)).toHaveLength(1);
    expect((await projects.getLatestBible(projectId))?.status).toBe("ready");

    await save(userId, projectId, style({ genre: "thriller" }));
    const all = await rows(projectId);
    expect(all.map((r) => [r.versionNumber, r.status, r.genreId])).toEqual([
      [1, "superseded", "genre.drama"],
      [2, "pending", "genre.thriller"],
    ]);
    expect(await queuedJobs(all[1]?.id ?? "")).toBe(1);
    // While version 2 compiles, nothing is ready: the old one is never served.
    expect(await projects.getReadyBible(projectId)).toBeNull();

    // A stale job for the superseded row does nothing.
    const before = await runs(projectId);
    await runHandler(v1?.id ?? "");
    expect(await runs(projectId)).toBe(before);
    expect((await rows(projectId))[0]?.status).toBe("superseded");

    await runHandler(all[1]?.id ?? "");
    expect(await projects.getReadyBible(projectId)).toMatchObject({
      versionNumber: 2,
      genreId: "genre.thriller",
    });

    // Orientation and duration changes count too.
    await save(userId, projectId, style({ genre: "thriller", orientation: "landscape" }));
    await save(
      userId,
      projectId,
      style({ genre: "thriller", orientation: "landscape", totalDurationSeconds: 90 }),
    );
    expect((await rows(projectId)).map((r) => r.versionNumber)).toEqual([1, 2, 3, 4]);
  });

  it("a typed Other genre or style gets no bible and supersedes the old one", async () => {
    const { userId, projectId } = await newProject();
    await save(userId, projectId, style({ genre: "Kitchen-sink realism" }));
    expect(await rows(projectId)).toHaveLength(0);

    await save(userId, projectId, style());
    const [v1] = await rows(projectId);
    await runHandler(v1?.id ?? "");
    expect(await projects.getReadyBible(projectId)).not.toBeNull();

    await save(userId, projectId, style({ visualStyle: "Felt and thread" }));
    const all = await rows(projectId);
    expect(all.map((r) => r.status)).toEqual(["superseded"]);
    expect(await projects.getReadyBible(projectId)).toBeNull();
    expect(await events(projectId)).toContain("creative_bible.superseded");

    // Back to a registry style: a new version, never a reused row.
    await save(userId, projectId, style());
    expect((await rows(projectId)).map((r) => [r.versionNumber, r.status])).toEqual([
      [1, "superseded"],
      [2, "pending"],
    ]);
  });

  it("a failed bible is requested again when the Style is saved again", async () => {
    const { userId, projectId } = await newProject();
    await save(userId, projectId, style());
    const [v1] = await rows(projectId);
    expect(
      await projects.failCreativeBible({
        bibleId: v1?.id ?? "",
        failure: "Try again.",
        damiRunId: null,
      }),
    ).toBe(true);
    // A second failure or completion of the same row changes nothing.
    expect(
      await projects.failCreativeBible({
        bibleId: v1?.id ?? "",
        failure: "Again.",
        damiRunId: null,
      }),
    ).toBe(false);
    expect((await rows(projectId))[0]).toMatchObject({ status: "failed", failure: "Try again." });

    await save(userId, projectId, style());
    expect((await rows(projectId)).map((r) => [r.versionNumber, r.status])).toEqual([
      [1, "superseded"],
      [2, "pending"],
    ]);
  });

  it("a series compiles with its episode math", async () => {
    const { userId, projectId } = await newProject();
    await save(
      userId,
      projectId,
      style({ format: "series", totalDurationSeconds: 540, episodeDurationSeconds: 90 }),
    );
    const [v1] = await rows(projectId);
    await runHandler(v1?.id ?? "");
    const ready = await projects.getReadyBible(projectId);
    expect(ready?.bible.project_frame).toMatchObject({
      format: "series",
      episode_count: 6,
      blocks_per_episode: 6,
    });
    expect(ready?.bible.slices.for_script_writer.series_rules.length).toBeGreaterThan(0);
  });
});
