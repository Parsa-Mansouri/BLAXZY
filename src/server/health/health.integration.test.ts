/**
 * Heartbeat rows, the rate-limited alert and the queue and bucket checks against the real local
 * Postgres and S3 store. Rows are keyed by this file's own ids (the database is shared).
 * Skipped when the services are unreachable.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { servicesReachable } from "@/server/test-support/integration";
import { dropSchema, pointQueueAtThrowawaySchema } from "@/server/test-support/script-fixtures";

const jobSchema = pointQueueAtThrowawaySchema();
const reachable = await servicesReachable();

describe.skipIf(!reachable)("health (integration)", async () => {
  const health = await import("./index");
  const { closeJobQueue, checkQueue } = await import("@/server/jobs");
  const { pingBucket } = await import("@/server/storage");
  const { closeDb, getDb } = await import("@/server/db/client");
  const { opsAlert, workerHeartbeat } = await import("@/server/db/schema");
  const { eq, inArray, sql } = await import("drizzle-orm");
  const db = getDb();
  const instances: string[] = [];
  const alertKeys: string[] = [];

  afterAll(async () => {
    if (instances.length > 0) {
      await db.delete(workerHeartbeat).where(inArray(workerHeartbeat.instanceId, instances));
    }
    if (alertKeys.length > 0) await db.delete(opsAlert).where(inArray(opsAlert.key, alertKeys));
    await closeJobQueue();
    await dropSchema(jobSchema);
    await closeDb();
  });

  const seenAt = async (id: string) =>
    (await db.select().from(workerHeartbeat).where(eq(workerHeartbeat.instanceId, id)))[0]?.seenAt;

  it("upserts one row per instance, reads it as alive, prunes it once silent, removes it", async () => {
    const instance = { ...health.newWorkerInstance(), id: `it-${randomUUID()}` };
    instances.push(instance.id);
    await health.recordHeartbeat(instance);
    const first = await seenAt(instance.id);
    await health.recordHeartbeat(instance);
    const rows = await db
      .select()
      .from(workerHeartbeat)
      .where(eq(workerHeartbeat.instanceId, instance.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.seenAt.getTime()).toBeGreaterThanOrEqual(first?.getTime() ?? 0);
    expect(await health.isWorkerAlive(60)).toBe(true);

    // Silent for an hour: pruned with a 30-minute threshold.
    await db
      .update(workerHeartbeat)
      .set({ seenAt: sql`now() - interval '1 hour'` })
      .where(eq(workerHeartbeat.instanceId, instance.id));
    expect(await health.pruneHeartbeats(30 * 60)).toBeGreaterThanOrEqual(1);
    expect(await seenAt(instance.id)).toBeUndefined();

    await health.recordHeartbeat(instance);
    await health.removeHeartbeat(instance.id);
    expect(await seenAt(instance.id)).toBeUndefined();
  });

  it("raises an alert once per window across callers", async () => {
    const key = `it.${randomUUID()}`;
    alertKeys.push(key);
    const raised = await Promise.all(
      [1, 2, 3].map(() => health.raiseRateLimitedAlert(key, 30, "test alert")),
    );
    expect(raised.filter(Boolean)).toHaveLength(1);
    expect(await health.raiseRateLimitedAlert(key, 30, "test alert")).toBe(false);
    await db
      .update(opsAlert)
      .set({ raisedAt: sql`now() - interval '31 minutes'` })
      .where(eq(opsAlert.key, key));
    expect(await health.raiseRateLimitedAlert(key, 30, "test alert")).toBe(true);
  });

  it("reaches the queue and the bucket", async () => {
    await expect(checkQueue()).resolves.toBeUndefined();
    await expect(pingBucket(AbortSignal.timeout(5000))).resolves.toBeUndefined();
  });

  it("reports readiness without failing on any dependency", async () => {
    const r = await health.checkReadiness();
    expect(r.checks).toMatchObject({ database: "ok", storage: "ok", queue: "ok" });
    expect(["ok", "degraded"]).toContain(r.status);
  });
});
