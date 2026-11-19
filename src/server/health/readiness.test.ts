import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isDatabaseHealthy = vi.fn<(ms?: number) => Promise<boolean>>();
const pingBucket = vi.fn<(signal: AbortSignal) => Promise<void>>();
const checkQueue = vi.fn<() => Promise<void>>();
const isWorkerAlive = vi.fn<(s: number) => Promise<boolean>>();
const returning = vi.fn<() => Promise<{ key: string }[]>>();
const logLine = vi.fn();

vi.mock("@/server/db/health", () => ({
  isDatabaseHealthy: (ms?: number) => isDatabaseHealthy(ms),
}));
vi.mock("@/server/storage", () => ({ pingBucket: (s: AbortSignal) => pingBucket(s) }));
vi.mock("@/server/jobs", () => ({ checkQueue: () => checkQueue() }));
vi.mock("./heartbeat", () => ({ isWorkerAlive: (s: number) => isWorkerAlive(s) }));
vi.mock("@/server/log", () => ({
  logLine: (...args: unknown[]) => logLine(...args),
  errorMessage: (e: unknown) => String(e),
}));
vi.mock("@/server/env", () => ({
  getEnv: () => ({
    HEALTH_CHECK_TIMEOUT_MS: 50,
    WORKER_DOWN_AFTER_SECONDS: 120,
    WORKER_DOWN_ALERT_MINUTES: 30,
  }),
}));
vi.mock("@/server/db/client", () => ({
  getDb: () => ({
    insert: () => ({ values: () => ({ onConflictDoUpdate: () => ({ returning }) }) }),
  }),
}));

import { checkReadiness, withTimeout } from "./readiness";

const hang = <T>() => new Promise<T>(() => undefined);

beforeEach(() => {
  isDatabaseHealthy.mockResolvedValue(true);
  pingBucket.mockResolvedValue(undefined);
  checkQueue.mockResolvedValue(undefined);
  isWorkerAlive.mockResolvedValue(true);
  returning.mockResolvedValue([{ key: "worker.down" }]);
});
afterEach(() => vi.resetAllMocks());

const alerts = () => logLine.mock.calls.filter((c) => (c[2] as { alert?: boolean })?.alert);

describe("checkReadiness", () => {
  it("is ok when every check passes", async () => {
    await expect(checkReadiness()).resolves.toEqual({
      status: "ok",
      checks: { database: "ok", storage: "ok", queue: "ok", worker: "ok" },
    });
    expect(isDatabaseHealthy).toHaveBeenCalledWith(50);
    expect(isWorkerAlive).toHaveBeenCalledWith(120);
    expect(alerts()).toHaveLength(0);
  });

  it("is unavailable when the database fails", async () => {
    isDatabaseHealthy.mockResolvedValue(false);
    const r = await checkReadiness();
    expect(r.status).toBe("unavailable");
    expect(r.checks.database).toBe("fail");
  });

  it("is unavailable when the bucket fails or hangs, without leaking the reason", async () => {
    pingBucket.mockRejectedValue(new Error("NoSuchBucket: secret-bucket at 10.0.0.5"));
    const failed = await checkReadiness();
    expect(failed).toMatchObject({ status: "unavailable", checks: { storage: "fail" } });
    expect(JSON.stringify(failed)).not.toContain("secret");

    pingBucket.mockImplementation(() => hang());
    expect((await checkReadiness()).checks.storage).toBe("fail");
  });

  it("aborts the bucket request when it times out", async () => {
    let seen: AbortSignal | undefined;
    pingBucket.mockImplementation((signal) => {
      seen = signal;
      return hang();
    });
    await checkReadiness();
    expect(seen?.aborted).toBe(true);
  });

  it("is unavailable when the queue fails or hangs", async () => {
    checkQueue.mockRejectedValue(new Error("relation pgboss.version does not exist"));
    expect((await checkReadiness()).checks.queue).toBe("fail");
    checkQueue.mockImplementation(() => hang());
    expect(await checkReadiness()).toMatchObject({
      status: "unavailable",
      checks: { queue: "fail" },
    });
  });

  it("is degraded (not unavailable) when the worker is down, and raises a rate-limited alert", async () => {
    isWorkerAlive.mockResolvedValue(false);
    await expect(checkReadiness()).resolves.toEqual({
      status: "degraded",
      checks: { database: "ok", storage: "ok", queue: "ok", worker: "down" },
    });
    expect(alerts()).toHaveLength(1);

    // Another replica raised it within the window: the conditional upsert returns nothing.
    returning.mockResolvedValue([]);
    expect((await checkReadiness()).status).toBe("degraded");
    expect(alerts()).toHaveLength(1);
  });

  it("reports the worker unknown (degraded, no alert) when its check fails", async () => {
    isWorkerAlive.mockRejectedValue(new Error("db down"));
    const r = await checkReadiness();
    expect(r).toMatchObject({ status: "degraded", checks: { worker: "unknown" } });
    expect(alerts()).toHaveLength(0);
  });

  it("runs the checks in parallel", async () => {
    const slow = () => new Promise<void>((resolve) => setTimeout(resolve, 30));
    pingBucket.mockImplementation(slow);
    checkQueue.mockImplementation(slow);
    isDatabaseHealthy.mockImplementation(() => slow().then(() => true));
    isWorkerAlive.mockImplementation(() => slow().then(() => true));
    const started = Date.now();
    expect((await checkReadiness()).status).toBe("ok");
    expect(Date.now() - started).toBeLessThan(110);
  });
});

describe("withTimeout", () => {
  it("returns the value, or the fallback on error or timeout", async () => {
    await expect(withTimeout(async () => 1, 50, 0)).resolves.toBe(1);
    await expect(withTimeout(() => Promise.reject(new Error("x")), 50, 0)).resolves.toBe(0);
    await expect(withTimeout(() => hang<number>(), 20, 0)).resolves.toBe(0);
  });
});
