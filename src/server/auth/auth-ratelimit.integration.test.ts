/**
 * The auth rate limiter behind a trusted proxy, through better-auth's HTTP handler against the
 * real local Postgres. Skipped automatically when the database is unavailable.
 */
import "dotenv/config";
import { randomInt } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { databaseReachable } from "@/server/test-support/integration";

const PROXY = "10.20.30.40";
// Must be set before the env is first read (each test file has its own module graph).
process.env.AUTH_TRUSTED_PROXIES = "10.20.30.0/24";
delete process.env.AUTH_IP_HEADER;

const reachable = await databaseReachable();

describe.skipIf(!reachable)("auth rate limit behind a trusted proxy (integration)", async () => {
  const { getAuth } = await import("@/server/auth/config");
  const { getDb, closeDb } = await import("@/server/db/client");
  const { rateLimit } = await import("@/server/db/schema");
  const { getEnv } = await import("@/server/env");

  const auth = getAuth();
  const base = getEnv().BETTER_AUTH_URL;
  // Documentation ranges (never real clients), random per run so reruns do not collide.
  const clientA = `203.0.113.${randomInt(1, 255)}`;
  const clientB = `198.51.100.${randomInt(1, 255)}`;
  const keys = [clientA, clientB].map((ip) => `${ip}|/sign-in/email`);

  afterAll(async () => {
    await getDb().delete(rateLimit).where(inArray(rateLimit.key, keys));
    await closeDb();
  });

  function signIn(forwardedFor: string): Promise<Response> {
    return auth.handler(
      new Request(`${base}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": forwardedFor },
        body: JSON.stringify({ email: "nobody@example.test", password: "wrong-password-123" }),
      }),
    );
  }

  it("keys by the address the proxy saw, whatever the client puts in front", async () => {
    const statuses: number[] = [];
    // The client rotates the left-most value; the proxy appends the real address and itself.
    for (let i = 1; i <= 4; i++) {
      statuses.push((await signIn(`1.2.3.${i}, ${clientA}, ${PROXY}`)).status);
    }
    expect(statuses.slice(0, 3)).not.toContain(429);
    expect(statuses[3]).toBe(429);

    // Another real client behind the same proxy has its own bucket.
    expect((await signIn(`${clientB}, ${PROXY}`)).status).not.toBe(429);

    const rows = await getDb().select().from(rateLimit).where(inArray(rateLimit.key, keys));
    expect(rows.find((r) => r.key === keys[0])?.count).toBeGreaterThanOrEqual(3);
    expect(rows.find((r) => r.key === keys[1])?.count).toBe(1);
  });
});
