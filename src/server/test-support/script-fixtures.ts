/**
 * Integration-test support for the Script stage: reachability check, users and styled projects
 * with unique ids, and a cleanup that removes everything they created. Tests only.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import type { ProjectStyle } from "@/server/db/schema";

export const TEST_STYLE: ProjectStyle = {
  visualStyle: "Cinematic live-action",
  genre: "Drama",
  format: "movie",
  orientation: "landscape",
  totalDurationSeconds: 90,
};

export async function databaseReachable(): Promise<boolean> {
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    await client.query("select 1 from script_version limit 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Points the job queue at a throwaway schema; call before the env is first read. */
export function pointQueueAtThrowawaySchema(): string {
  const schema = `pgboss_it_${randomBytes(4).toString("hex")}`;
  process.env.JOBS_SCHEMA = schema;
  return schema;
}

export async function dropSchema(schema: string): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`drop schema if exists ${schema} cascade`);
  } finally {
    await client.end();
  }
}

export function createFixtures() {
  const userIds: string[] = [];

  async function newUser(): Promise<string> {
    const { getDb } = await import("@/server/db/client");
    const { user } = await import("@/server/db/schema");
    const id = `it-${randomUUID()}`;
    await getDb()
      .insert(user)
      .values({ id, name: "Script IT", email: `${id}@example.test` });
    userIds.push(id);
    return id;
  }

  /** A wizard project with its style saved (stage `script`). */
  async function newProject(ownerId: string, style: ProjectStyle = TEST_STYLE): Promise<string> {
    const projects = await import("@/server/projects");
    const created = await projects.createProject({ ownerId, title: "Script IT" });
    await projects.saveStyle({ projectId: created.id, userId: ownerId, style });
    return created.id;
  }

  /** Deletes every row the fixtures' users own (children first). */
  async function cleanup(): Promise<void> {
    if (userIds.length === 0) return;
    const { getDb } = await import("@/server/db/client");
    const s = await import("@/server/db/schema");
    const { inArray, or } = await import("drizzle-orm");
    const db = getDb();
    const owned = await db
      .select({ id: s.project.id })
      .from(s.project)
      .where(inArray(s.project.ownerId, userIds));
    const ids = owned.map((p) => p.id);
    if (ids.length > 0) {
      await db.delete(s.promptBlock).where(inArray(s.promptBlock.projectId, ids));
      await db.delete(s.asset).where(inArray(s.asset.projectId, ids));
      await db.delete(s.review).where(inArray(s.review.projectId, ids));
      await db.delete(s.scriptVersion).where(inArray(s.scriptVersion.projectId, ids));
      await db
        .delete(s.damiRun)
        .where(or(inArray(s.damiRun.projectId, ids), inArray(s.damiRun.userId, userIds)));
      await db.delete(s.projectEvent).where(inArray(s.projectEvent.projectId, ids));
      await db.delete(s.episode).where(inArray(s.episode.projectId, ids));
    }
    await db.delete(s.file).where(inArray(s.file.ownerId, userIds));
    if (ids.length > 0) await db.delete(s.project).where(inArray(s.project.id, ids));
    await db.delete(s.user).where(inArray(s.user.id, userIds));
  }

  return { newUser, newProject, cleanup };
}

/** A job context for calling handlers directly. */
export function jobContext(attempt = 1) {
  return { jobId: randomUUID(), attempt, signal: new AbortController().signal };
}
