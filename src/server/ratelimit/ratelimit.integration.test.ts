/**
 * The action rate limiter against the real local Postgres. Skipped automatically when the
 * database is unavailable.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { databaseReachable } from "@/server/test-support/integration";

const reachable = await databaseReachable();

describe.skipIf(!reachable)("action rate limiter (integration)", async () => {
  const { checkRateLimit, pruneRateLimits, RATE_LIMIT_BUCKETS } =
    await import("@/server/ratelimit");
  const { getDb, closeDb } = await import("@/server/db/client");
  const { actionRateLimit } = await import("@/server/db/schema");

  // Keys are `<bucket>:<userId>`; every user id here starts with this run's prefix.
  const prefix = `rl-it-${randomUUID()}`;
  const newUser = () => `${prefix}-${randomUUID()}`;

  afterAll(async () => {
    for (const bucket of Object.keys(RATE_LIMIT_BUCKETS)) {
      await getDb()
        .delete(actionRateLimit)
        .where(like(actionRateLimit.key, `${bucket}:${prefix}%`));
    }
    await closeDb();
  });

  // The middle of a window, so a slow test never crosses a boundary by accident.
  const midWindow = () => {
    const now = Date.now();
    return new Date(now - (now % 60_000) + 30_000);
  };

  it("lets the limit through and refuses request N+1 with the time left in the window", async () => {
    const userId = newUser();
    const now = midWindow();
    const { limit } = RATE_LIMIT_BUCKETS.expensive;
    for (let i = 0; i < limit; i++) {
      await expect(checkRateLimit({ userId, bucket: "expensive", now })).resolves.toEqual({
        ok: true,
      });
    }
    await expect(checkRateLimit({ userId, bucket: "expensive", now })).resolves.toEqual({
      ok: false,
      retryAfterSeconds: 30,
      reason: "limited",
    });
  });

  it("keeps users and buckets independent", async () => {
    const first = newUser();
    const second = newUser();
    const now = midWindow();
    const { limit } = RATE_LIMIT_BUCKETS.expensive;
    for (let i = 0; i <= limit; i++)
      await checkRateLimit({ userId: first, bucket: "expensive", now });
    expect((await checkRateLimit({ userId: first, bucket: "expensive", now })).ok).toBe(false);
    expect((await checkRateLimit({ userId: second, bucket: "expensive", now })).ok).toBe(true);
    expect((await checkRateLimit({ userId: first, bucket: "mutate", now })).ok).toBe(true);
  });

  it("counts concurrent requests exactly", async () => {
    const userId = newUser();
    const now = midWindow();
    const results = await Promise.all(
      Array.from({ length: 50 }, () => checkRateLimit({ userId, bucket: "expensive", now })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(RATE_LIMIT_BUCKETS.expensive.limit);
    const [row] = await getDb()
      .select({ count: actionRateLimit.count })
      .from(actionRateLimit)
      .where(like(actionRateLimit.key, `expensive:${userId}`));
    expect(row?.count).toBe(50);
  });

  it("starts a fresh count in the next window", async () => {
    const userId = newUser();
    const now = midWindow();
    const { limit } = RATE_LIMIT_BUCKETS.upload;
    for (let i = 0; i <= limit; i++) await checkRateLimit({ userId, bucket: "upload", now });
    expect((await checkRateLimit({ userId, bucket: "upload", now })).ok).toBe(false);
    const later = new Date(now.getTime() + 60_000);
    expect((await checkRateLimit({ userId, bucket: "upload", now: later })).ok).toBe(true);
  });

  it("prunes old windows and keeps current ones", async () => {
    const userId = newUser();
    const now = midWindow();
    const old = new Date(now.getTime() - 60 * 60_000);
    await checkRateLimit({ userId, bucket: "read", now: old });
    await checkRateLimit({ userId, bucket: "read", now });

    const { pruned } = await pruneRateLimits({ olderThanMinutes: 10, now });
    expect(pruned).toBeGreaterThanOrEqual(1);
    const rows = await getDb()
      .select({ windowStart: actionRateLimit.windowStart })
      .from(actionRateLimit)
      .where(like(actionRateLimit.key, `read:${userId}`));
    expect(rows.map((r) => r.windowStart.getTime())).toEqual([
      now.getTime() - (now.getTime() % 60_000),
    ]);
  });
});
