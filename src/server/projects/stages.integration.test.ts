/** Stage state machine against the real local Postgres; skipped when it is unreachable. */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";

async function databaseReachable(): Promise<boolean> {
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    await client.query("select 1 from episode limit 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const reachable = await databaseReachable();

describe.skipIf(!reachable)("stage state machine (integration)", async () => {
  const projects = await import("@/server/projects");
  const { getDb, closeDb } = await import("@/server/db/client");
  const { project, projectEvent, episode, user, file } = await import("@/server/db/schema");
  const { putFileBytes } = await import("@/server/storage");

  const userIds: string[] = [];
  async function newUser(): Promise<string> {
    const id = `it-${randomUUID()}`;
    await getDb()
      .insert(user)
      .values({ id, name: "Test", email: `${id}@example.test` });
    userIds.push(id);
    return id;
  }
  async function newProject() {
    const ownerId = await newUser();
    const p = await projects.createProject({ ownerId, title: "Stages" });
    return { ownerId, p };
  }
  const base = {
    visualStyle: "noir",
    genre: "thriller",
    orientation: "landscape" as const,
  };
  const movie = (total: number) => ({
    ...base,
    format: "movie" as const,
    totalDurationSeconds: total,
  });
  const series = (total: number, per: number) => ({
    ...base,
    format: "series" as const,
    totalDurationSeconds: total,
    episodeDurationSeconds: per,
  });
  async function episodesOf(projectId: string) {
    return getDb()
      .select()
      .from(episode)
      .where(eq(episode.projectId, projectId))
      .orderBy(asc(episode.number));
  }
  async function eventTypes(projectId: string) {
    const rows = await getDb()
      .select()
      .from(projectEvent)
      .where(eq(projectEvent.projectId, projectId))
      .orderBy(asc(projectEvent.createdAt));
    return rows.map((r) => r.type);
  }

  afterAll(async () => {
    const db = getDb();
    if (userIds.length > 0) {
      const owned = await db
        .select({ id: project.id })
        .from(project)
        .where(inArray(project.ownerId, userIds));
      const ids = owned.map((p) => p.id);
      await db.delete(file).where(inArray(file.ownerId, userIds));
      if (ids.length > 0) {
        await db.delete(episode).where(inArray(episode.projectId, ids));
        await db.delete(projectEvent).where(inArray(projectEvent.projectId, ids));
        await db.delete(project).where(inArray(project.id, ids));
      }
      await db.delete(user).where(inArray(user.id, userIds));
    }
    await closeDb();
  });

  it("stores a look described by references, checking its images", async () => {
    const { ownerId, p } = await newProject();
    const image = await putFileBytes({
      ownerId,
      projectId: p.id,
      name: "still.png",
      mimeType: "image/png",
      purpose: "style_reference",
      bytes: new Uint8Array([137, 80, 78, 71]),
    });
    const style = {
      ...movie(600),
      visualStyle: "anything",
      references: {
        visualStyle: {
          titles: ["Heat", " heat "],
          description: "Night city.",
          fileIds: [image.id],
        },
      },
    };
    const saved = await projects.saveStyle({ projectId: p.id, userId: ownerId, style });
    expect(saved?.style?.visualStyle).toBe("Like Heat. Night city.");
    expect(saved?.style?.references?.visualStyle).toEqual({
      titles: ["Heat"],
      description: "Night city.",
      fileIds: [image.id],
    });

    const other = await newProject();
    await expect(
      projects.saveStyle({ projectId: other.p.id, userId: other.ownerId, style }),
    ).rejects.toThrow(/could not be found/);
  });

  it("first save advances style to script, later saves do not", async () => {
    const { ownerId, p } = await newProject();
    const saved = await projects.saveStyle({ projectId: p.id, userId: ownerId, style: movie(600) });
    expect(saved?.stage).toBe("script");
    expect(saved?.style?.totalDurationSeconds).toBe(600);
    const again = await projects.saveStyle({ projectId: p.id, userId: ownerId, style: movie(900) });
    expect(again?.stage).toBe("script");
    expect(again?.style?.totalDurationSeconds).toBe(900);
    const events = await eventTypes(p.id);
    expect(events).toContain("style.saved");
    expect(events).toContain("style.changed");
    expect(events.filter((t) => t === "stage.advanced")).toHaveLength(1);
  });

  it("does not move a project that is already past script", async () => {
    const { ownerId, p } = await newProject();
    await projects.saveStyle({ projectId: p.id, userId: ownerId, style: movie(600) });
    await projects.advanceStage({ projectId: p.id, from: "script", to: "pre_production" });
    const again = await projects.saveStyle({ projectId: p.id, userId: ownerId, style: movie(700) });
    expect(again?.stage).toBe("pre_production");
  });

  it("creates one episode for a movie and reconciles series episodes without deleting", async () => {
    const { ownerId, p } = await newProject();
    await projects.saveStyle({ projectId: p.id, userId: ownerId, style: movie(600) });
    let eps = await episodesOf(p.id);
    expect(eps.map((e) => [e.number, e.targetDurationSeconds])).toEqual([[1, 600]]);

    await projects.saveStyle({ projectId: p.id, userId: ownerId, style: series(1000, 300) });
    eps = await episodesOf(p.id);
    expect(eps.map((e) => [e.number, e.targetDurationSeconds])).toEqual([
      [1, 300],
      [2, 300],
      [3, 300],
      [4, 300],
    ]);

    await projects.saveStyle({ projectId: p.id, userId: ownerId, style: series(600, 300) });
    eps = await episodesOf(p.id);
    expect(eps).toHaveLength(4);
    expect(eps.map((e) => e.targetDurationSeconds)).toEqual([300, 300, 300, 300]);

    await projects.saveStyle({ projectId: p.id, userId: ownerId, style: series(900, 450) });
    eps = await episodesOf(p.id);
    expect(eps).toHaveLength(4);
    expect(eps[0]?.targetDurationSeconds).toBe(450);
    expect(eps[1]?.targetDurationSeconds).toBe(450);

    const listed = await projects.listEpisodes(p.id, ownerId);
    expect(listed?.map((e) => e.number)).toEqual([1, 2, 3, 4]);
  });

  it("rejects invalid styles with user-safe messages and changes nothing", async () => {
    const { ownerId, p } = await newProject();
    const bad = async (style: unknown, message: RegExp) => {
      await expect(projects.saveStyle({ projectId: p.id, userId: ownerId, style })).rejects.toThrow(
        message,
      );
    };
    await bad({ ...base }, /valid|Choose/);
    await bad(movie(4), /between 5 seconds and 4 hours/);
    await bad(movie(4 * 3600 + 1), /between 5 seconds and 4 hours/);
    await bad({ ...movie(600), episodeDurationSeconds: 60 }, /no episode duration/);
    await bad(
      { ...series(600, 60), episodeDurationSeconds: undefined },
      /needs an episode duration|valid/,
    );
    await bad(series(600, 3), /between 5 seconds and 4 hours/);
    await bad(series(600, 700), /longer than the whole series|valid/);
    await bad(series(3600, 30), /more than 100 episodes/);
    const fresh = await projects.getProjectForUser(p.id, ownerId);
    expect(fresh?.stage).toBe("style");
    expect(fresh?.style).toBeNull();
    expect(await episodesOf(p.id)).toHaveLength(0);
  });

  it("isolates owners", async () => {
    const { p } = await newProject();
    const other = await newUser();
    expect(
      await projects.saveStyle({ projectId: p.id, userId: other, style: movie(600) }),
    ).toBeNull();
    expect(await projects.listEpisodes(p.id, other)).toBeNull();
    expect(
      await projects.saveStyle({ projectId: "nope", userId: other, style: movie(600) }),
    ).toBeNull();
    expect(await episodesOf(p.id)).toHaveLength(0);
  });

  it("lets exactly one concurrent advanceStage win", async () => {
    const { p } = await newProject();
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        projects.advanceStage({ projectId: p.id, from: "style", to: "script" }),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await eventTypes(p.id)).filter((t) => t === "stage.advanced")).toHaveLength(1);
  });
});

describe("canOpenStage", async () => {
  const projects = await import("@/server/projects");
  const at = (stage: string) => ({ stage });
  it("opens the current and earlier stages only; done opens everything", () => {
    expect(projects.canOpenStage(at("style"), "style")).toBe(true);
    expect(projects.canOpenStage(at("style"), "script")).toBe(false);
    expect(projects.canOpenStage(at("production"), "script")).toBe(true);
    expect(projects.canOpenStage(at("script"), "production")).toBe(false);
    expect(projects.canOpenStage(at("done"), "production")).toBe(true);
  });
});
