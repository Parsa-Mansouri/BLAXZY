/**
 * Runs the projects service against the real local Postgres. Skipped automatically when
 * DATABASE_URL is missing or unreachable.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";

async function databaseReachable(): Promise<boolean> {
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    await client.query("select 1 from project_event limit 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const reachable = await databaseReachable();

describe.skipIf(!reachable)("projects service (integration)", async () => {
  const projects = await import("@/server/projects");
  const { getDb, closeDb } = await import("@/server/db/client");
  const { project, projectEvent, user } = await import("@/server/db/schema");

  const userIds: string[] = [];
  async function newUser(): Promise<string> {
    const id = `it-${randomUUID()}`;
    await getDb()
      .insert(user)
      .values({ id, name: "Test", email: `${id}@example.test` });
    userIds.push(id);
    return id;
  }

  afterAll(async () => {
    const db = getDb();
    if (userIds.length > 0) {
      const owned = await db
        .select({ id: project.id })
        .from(project)
        .where(inArray(project.ownerId, userIds));
      const ids = owned.map((p) => p.id);
      if (ids.length > 0) {
        await db.delete(projectEvent).where(inArray(projectEvent.projectId, ids));
        await db.delete(project).where(inArray(project.id, ids));
      }
      await db.delete(user).where(inArray(user.id, userIds));
    }
    await closeDb();
  });

  it("creates a wizard project at the style stage and logs an event", async () => {
    const ownerId = await newUser();
    const created = await projects.createProject({ ownerId, title: "  Midnight  " });
    expect(created).toMatchObject({ title: "Midnight", mode: "wizard", stage: "style", ownerId });
    const events = await getDb()
      .select()
      .from(projectEvent)
      .where(eq(projectEvent.projectId, created.id));
    expect(events.map((e) => e.type)).toEqual(["project.created"]);
  });

  it("rejects empty and overlong titles", async () => {
    const ownerId = await newUser();
    await expect(projects.createProject({ ownerId, title: "   " })).rejects.toBeInstanceOf(
      projects.ProjectInputError,
    );
    await expect(projects.createProject({ ownerId, title: "x".repeat(121) })).rejects.toThrow(
      /under 120/,
    );
  });

  it("never leaks projects across owners", async () => {
    const alice = await newUser();
    const bob = await newUser();
    const mine = await projects.createProject({ ownerId: alice, title: "Alice film" });

    expect(await projects.getProjectForUser(mine.id, alice)).not.toBeNull();
    expect(await projects.getProjectForUser(mine.id, bob)).toBeNull();
    expect(await projects.getProjectForUser("not-a-uuid", alice)).toBeNull();
    expect(await projects.getProjectForUser(randomUUID(), alice)).toBeNull();

    expect(
      await projects.renameProject({ projectId: mine.id, ownerId: bob, title: "Hacked" }),
    ).toBe(null);
    expect(await projects.archiveProject({ projectId: mine.id, ownerId: bob })).toBe(false);
    expect((await projects.getProjectForUser(mine.id, alice))?.title).toBe("Alice film");
    expect((await projects.listProjects({ ownerId: bob })).items).toHaveLength(0);
  });

  it("renames and archives without deleting", async () => {
    const ownerId = await newUser();
    const created = await projects.createProject({ ownerId, title: "Old" });
    const renamed = await projects.renameProject({
      projectId: created.id,
      ownerId,
      title: " New ",
    });
    expect(renamed?.title).toBe("New");

    expect(await projects.archiveProject({ projectId: created.id, ownerId })).toBe(true);
    expect(await projects.archiveProject({ projectId: created.id, ownerId })).toBe(false);
    expect(await projects.getProjectForUser(created.id, ownerId)).toBeNull();
    expect((await projects.listProjects({ ownerId })).items).toHaveLength(0);

    const rows = await getDb().select().from(project).where(eq(project.id, created.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.archivedAt).not.toBeNull();
    const events = await getDb()
      .select()
      .from(projectEvent)
      .where(eq(projectEvent.projectId, created.id));
    expect(events.map((e) => e.type).sort()).toEqual([
      "project.archived",
      "project.created",
      "project.renamed",
    ]);
  });

  it("paginates newest first with a stable cursor, skipping archived projects", async () => {
    const ownerId = await newUser();
    const created: Awaited<ReturnType<typeof projects.createProject>>[] = [];
    for (let i = 0; i < 7; i++) {
      created.push(await projects.createProject({ ownerId, title: `Film ${i}` }));
    }
    await projects.archiveProject({ projectId: created[3]!.id, ownerId });
    // Touching a project moves it to the top.
    await projects.renameProject({ projectId: created[0]!.id, ownerId, title: "Film 0 renamed" });

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: Awaited<ReturnType<typeof projects.listProjects>> = await projects.listProjects({
        ownerId,
        limit: 2,
        cursor,
      });
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items.map((p) => p.id));
      cursor = page.nextCursor;
      pages++;
    } while (cursor);

    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(6);
    expect(seen).not.toContain(created[3]!.id);
    expect(seen[0]).toBe(created[0]!.id);
    expect(seen.slice(1)).toEqual([6, 5, 4, 2, 1].map((i) => created[i]!.id));
  });

  it("caps the page size and rejects forged cursors", async () => {
    const ownerId = await newUser();
    await expect(projects.listProjects({ ownerId, limit: 51 })).rejects.toBeInstanceOf(
      projects.ProjectInputError,
    );
    await expect(projects.listProjects({ ownerId, cursor: "garbage" })).rejects.toBeInstanceOf(
      projects.ProjectInputError,
    );
  });
});
