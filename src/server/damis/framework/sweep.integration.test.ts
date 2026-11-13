/**
 * Runs `sweepStuckDamiRuns` against the real local Postgres (`docker compose up -d`,
 * `pnpm db:migrate`). Skipped automatically when DATABASE_URL is missing or unreachable.
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
    await client.query("select 1 from dami_run limit 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const reachable = await databaseReachable();

describe.skipIf(!reachable)("sweepStuckDamiRuns (integration)", async () => {
  const { getDb, closeDb } = await import("@/server/db/client");
  const { damiRun } = await import("@/server/db/schema");
  const { sweepStuckDamiRuns } = await import("./sweep");

  const db = getDb();
  const key = `it-sweep-${randomUUID()}`;
  const ids: string[] = [];
  const now = new Date("2030-01-01T12:00:00Z");
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

  async function insert(status: string, startedAt: Date): Promise<string> {
    const [row] = await db
      .insert(damiRun)
      .values({
        damiKey: key,
        damiVersion: "0.0.1",
        model: "sample",
        status: status as "running",
        input: {},
        startedAt,
      })
      .returning({ id: damiRun.id });
    const id = row?.id ?? "";
    ids.push(id);
    return id;
  }

  afterAll(async () => {
    if (ids.length > 0) await db.delete(damiRun).where(inArray(damiRun.id, ids));
    await closeDb();
  });

  it("aborts only old running rows, leaves the rest, and is idempotent", async () => {
    const old = await insert("running", minutesAgo(200));
    const fresh = await insert("running", minutesAgo(10));
    const done = await insert("succeeded", minutesAgo(300));

    const first = await sweepStuckDamiRuns({ now });
    // Other tests may leave their own old running rows: assert on ours.
    expect(first.swept).toBeGreaterThanOrEqual(1);

    const rows = await db
      .select()
      .from(damiRun)
      .where(inArray(damiRun.id, [old, fresh, done]));
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(old)).toMatchObject({ status: "aborted" });
    expect(byId.get(old)?.error).toContain("Swept");
    expect(byId.get(old)?.finishedAt).toEqual(now);
    expect(byId.get(fresh)?.status).toBe("running");
    expect(byId.get(done)?.status).toBe("succeeded");

    const [again] = [await sweepStuckDamiRuns({ now })];
    expect(again.swept).toBe(0);
  });

  it("does not clobber a run that finished in the meantime", async () => {
    const id = await insert("running", minutesAgo(500));
    // The run finishes between the sweeper's select and update: simulate by finishing first.
    await db.update(damiRun).set({ status: "succeeded" }).where(eq(damiRun.id, id));
    await sweepStuckDamiRuns({ now });
    const [row] = await db.select().from(damiRun).where(eq(damiRun.id, id));
    expect(row?.status).toBe("succeeded");
  });

  it("respects a custom limit", async () => {
    const id = await insert("running", minutesAgo(20));
    await sweepStuckDamiRuns({ now, stuckAfterMinutes: 30 });
    expect((await db.select().from(damiRun).where(eq(damiRun.id, id)))[0]?.status).toBe("running");
    await sweepStuckDamiRuns({ now, stuckAfterMinutes: 15 });
    expect((await db.select().from(damiRun).where(eq(damiRun.id, id)))[0]?.status).toBe("aborted");
  });

  it("rejects a non-positive limit", async () => {
    await expect(sweepStuckDamiRuns({ stuckAfterMinutes: 0 })).rejects.toThrow();
  });
});
