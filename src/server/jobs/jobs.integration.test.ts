/**
 * Runs the job queue against the real local Postgres (`docker compose up -d`). Each run installs
 * pg-boss into its own throwaway schema and drops it afterwards. Skipped automatically when
 * DATABASE_URL is missing or unreachable.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

const runId = randomBytes(4).toString("hex");
const schema = `pgboss_test_${runId}`;
const raceSchema = `pgboss_race_${runId}`;
// Must be set before the env is first read (each test file has its own module graph).
process.env.JOBS_SCHEMA = schema;

async function databaseReachable(): Promise<boolean> {
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    await client.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function dropSchemas(): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`drop schema if exists ${schema} cascade`);
    await client.query(`drop schema if exists ${raceSchema} cascade`);
  } finally {
    await client.end();
  }
}

async function waitFor(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const reachable = await databaseReachable();

describe.skipIf(!reachable)("jobs (integration)", async () => {
  const { defineHandler, defineJob, enqueue, InvalidJobPayloadError, startWorker, stopWorker } =
    await import("@/server/jobs");
  const { getBackend, sendJob, startBackend } = await import("@/server/jobs/pg-boss");

  const message = z.object({ message: z.string() });
  const once = defineJob({ name: `test.once.${runId}`, payload: message });
  const flaky = defineJob({
    name: `test.flaky.${runId}`,
    payload: message,
    options: { retryLimit: 2, retryDelaySeconds: 0, retryBackoff: false },
  });
  const deduped = defineJob({
    name: `test.dedupe.${runId}`,
    payload: z.object({ key: z.string() }),
    dedupeKey: (payload) => payload.key,
  });

  /** Polls the job's state until it equals `expected` (or 10s pass); returns the last state. */
  async function waitForState(name: string, id: string | null, expected: string) {
    const backend = await getBackend("web");
    let state: string | undefined;
    const deadline = Date.now() + 10_000;
    while (state !== expected && Date.now() < deadline) {
      const [job] = await backend.boss.findJobs(name, { id: id ?? undefined });
      state = job?.state;
      if (state !== expected) await sleep(250);
    }
    return state;
  }

  const handled: string[] = [];
  const flakyAttempts: number[] = [];
  let receivedInvalid = false;

  beforeAll(async () => {
    await startWorker({
      handlers: [
        defineHandler(once, async (payload) => {
          if (payload.message === "invalid-on-receipt") receivedInvalid = true;
          handled.push(payload.message);
        }),
        defineHandler(flaky, async (_payload, context) => {
          flakyAttempts.push(context.attempt);
          if (context.attempt === 1) throw new Error("transient failure");
        }),
        // Not consumed here (concurrency 0), so queued jobs stay queued for the dedupe test.
        defineHandler(deduped, async () => undefined),
      ],
      concurrency: { default: 1, perJob: { [deduped.name]: 0 } },
      pollingIntervalSeconds: 0.5,
    });
  }, 30_000);

  afterAll(async () => {
    await stopWorker(5_000);
    await dropSchemas();
  }, 30_000);

  it("handles an enqueued job exactly once", async () => {
    const id = await enqueue(once, { message: "hello" });
    expect(id).toEqual(expect.any(String));
    await waitFor(() => handled.includes("hello"));
    await sleep(1_500);
    expect(handled.filter((m) => m === "hello")).toHaveLength(1);
  }, 20_000);

  it("retries a throwing handler and then succeeds", async () => {
    const id = await enqueue(flaky, { message: "retry me" });
    await waitFor(() => flakyAttempts.length >= 2);
    expect(flakyAttempts).toEqual([1, 2]);

    expect(await waitForState(flaky.name, id, "completed")).toBe("completed");
  }, 20_000);

  it("rejects an invalid payload at enqueue", async () => {
    const invalid = { message: 42 } as unknown as { message: string };
    await expect(enqueue(once, invalid)).rejects.toBeInstanceOf(InvalidJobPayloadError);
    await expect(enqueue(once, {} as { message: string })).rejects.toThrow(/message/);
  });

  it("fails a job whose payload is invalid on receipt, without retrying", async () => {
    const backend = await getBackend("web");
    const id = await sendJob(backend, once, { payload: { notMessage: "invalid-on-receipt" } });
    expect(await waitForState(once.name, id, "failed")).toBe("failed");
    const [job] = await backend.boss.findJobs(once.name, { id: id ?? undefined });
    expect(job?.retryCount).toBe(0);
    expect(receivedInvalid).toBe(false);
  }, 20_000);

  it("drops a duplicate while a job with the same dedupe key is in flight", async () => {
    const first = await enqueue(deduped, { key: "project-1" });
    const duplicate = await enqueue(deduped, { key: "project-1" });
    const other = await enqueue(deduped, { key: "project-2" });
    expect(first).toEqual(expect.any(String));
    expect(duplicate).toBeNull();
    expect(other).toEqual(expect.any(String));
  });

  it("installs the queue schema safely when several processes start at once", async () => {
    const config = {
      connectionString: process.env.DATABASE_URL ?? "",
      schema: raceSchema,
      poolMax: 2,
    };
    const backends = await Promise.all([
      startBackend({ ...config, role: "worker" }),
      startBackend({ ...config, role: "worker" }),
      startBackend({ ...config, role: "web" }),
      startBackend({ ...config, role: "web" }),
    ]);
    try {
      const ids = await Promise.all(
        backends.map((b) => sendJob(b, once, { payload: { message: "x" } })),
      );
      expect(ids.every((id) => typeof id === "string")).toBe(true);
    } finally {
      await Promise.all(backends.map((b) => b.boss.stop({ graceful: false, close: true })));
    }
  }, 60_000);
});
