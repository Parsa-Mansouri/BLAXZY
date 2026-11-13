import { lt, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { actionRateLimit } from "@/server/db/schema";
import { errorMessage, logLine } from "@/server/jobs/log";
import {
  RATE_LIMIT_BUCKETS,
  RATE_LIMIT_RETENTION_MINUTES,
  RATE_LIMIT_WINDOW_SECONDS,
  type RateLimitBucket,
} from "./buckets";

export type RateLimitResult =
  | { ok: true }
  | {
      ok: false;
      retryAfterSeconds: number;
      /** `limited`: over the limit. `unavailable`: the counter could not be read (fail closed). */
      reason: "limited" | "unavailable";
    };

export interface RateLimitInput {
  userId: string;
  bucket: RateLimitBucket;
  /** The current time; tests pass it to cross window boundaries. */
  now?: Date;
}

const WINDOW_MS = RATE_LIMIT_WINDOW_SECONDS * 1000;
/** What a fail-closed bucket tells the caller to wait when the counter cannot be read. */
const UNAVAILABLE_RETRY_SECONDS = 5;

function windowStartOf(now: Date): Date {
  return new Date(Math.floor(now.getTime() / WINDOW_MS) * WINDOW_MS);
}

/**
 * Counts one request of `userId` in `bucket` and says whether it is within the bucket's limit.
 * One atomic upsert per call (`INSERT ... ON CONFLICT DO UPDATE ... RETURNING`), so the count is
 * exact under any number of concurrent requests and web processes; nothing is kept in memory.
 *
 * A database error lets the request through for fail-open buckets (`poll`, `read`, `mutate`)
 * and refuses it for fail-closed ones (`expensive`, `upload`); either way it is logged.
 */
export async function checkRateLimit(input: RateLimitInput): Promise<RateLimitResult> {
  const { userId, bucket } = input;
  const rule = RATE_LIMIT_BUCKETS[bucket];
  const now = input.now ?? new Date();
  const windowStart = windowStartOf(now);
  const key = `${bucket}:${userId}`;

  let count: number;
  try {
    const [row] = await getDb()
      .insert(actionRateLimit)
      .values({ key, windowStart, count: 1 })
      .onConflictDoUpdate({
        target: [actionRateLimit.key, actionRateLimit.windowStart],
        set: { count: sql`${actionRateLimit.count} + 1` },
      })
      .returning({ count: actionRateLimit.count });
    if (!row) throw new Error("rate-limit upsert returned no row");
    count = row.count;
  } catch (error) {
    logLine(rule.failOpen ? "warn" : "error", "rate limit check failed", {
      bucket,
      userId,
      failOpen: rule.failOpen,
      error: errorMessage(error),
    });
    return rule.failOpen
      ? { ok: true }
      : { ok: false, retryAfterSeconds: UNAVAILABLE_RETRY_SECONDS, reason: "unavailable" };
  }

  if (count <= rule.limit) return { ok: true };
  const remainingMs = windowStart.getTime() + WINDOW_MS - now.getTime();
  return {
    ok: false,
    retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)),
    reason: "limited",
  };
}

/**
 * Deletes counter windows that ended more than `olderThanMinutes` ago (operational counters, not
 * domain data). Run by the `ratelimit.prune` job.
 */
export async function pruneRateLimits(
  options: { olderThanMinutes?: number; now?: Date } = {},
): Promise<{ pruned: number }> {
  const minutes = options.olderThanMinutes ?? RATE_LIMIT_RETENTION_MINUTES;
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - minutes * 60_000);
  const result = await getDb()
    .delete(actionRateLimit)
    .where(lt(actionRateLimit.windowStart, cutoff));
  return { pruned: result.rowCount ?? 0 };
}
