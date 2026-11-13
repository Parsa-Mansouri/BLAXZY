/**
 * Runs the job queue against the real local Postgres (`docker compose up -d`). Each run installs
 * pg-boss into its own throwaway schema and drops it afterwards. Skipped automatically when
 * DATABASE_URL is missing or unreachable.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseReachable } from "@/server/test-support/integration";
import { z } from "zod";

const runId = randomBytes(4).toString("hex");
const schema = `pgboss_test_${runId}`;
const raceSchema = `pgboss_race_${runId}`;
// Must be set before the env is first read (each test file has its own module graph).
process.env.JOBS_SCHEMA = schema;

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
  const {
    defineHandler,
    defineJob,
    enqueue,
    InvalidJobPayloadError,
    isShutdownAbort,
    startWorker,
    stopWorker,
  } = await import("@/server/jobs");
  const { ensureQueue, getBackend, sendJob, startBackend } = await import("@/server/jobs/pg-boss");
  const { closeDb, getDb } = await import("@/server/db/client");

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
  /** Consumed: records what it received, so delivery after commit (or never) can be checked. */
  const transactional = defineJob({
    name: `test.tx.${runId}`,
    payload: message,
    dedupeKey: (payload) => payload.message,
  });
  /** Its handler enqueues an invalid payload: a failure of the handler, not of its own payload. */
  const nested = defineJob({
    name: `test.nested.${runId}`,
    payload: message,
    options: { retryLimit: 1, retryDelaySeconds: 0, retryBackoff: false },
  });
  /** No retries: its only attempt is the last. Blocks until aborted. */
  const interrupted = defineJob({
    name: `test.shutdown.${runId}`,
    payload: message,
    options: { retryLimit: 0 },
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
  const nestedAttempts: number[] = [];
  const shutdownSeen: { started: boolean; shutdownAbort: boolean | null; unwound: boolean } = {
    started: false,
    shutdownAbort: null,
    unwound: false,
  };
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
        defineHandler(transactional, async (payload) => {
          handled.push(payload.message);
        }),
        defineHandler(nested, async (_payload, context) => {
          nestedAttempts.push(context.attempt);
          await enqueue(once, { message: 42 } as unknown as { message: string });
        }),
        defineHandler(interrupted, async (_payload, context) => {
          shutdownSeen.started = true;
          await new Promise<void>((resolve) => {
            context.signal.addEventListener("abort", () => resolve(), { once: true });
          });
          shutdownSeen.shutdownAbort = isShutdownAbort(context.signal);
          // Unwinding takes a moment (a handler cleaning up); stopWorker must wait for it.
          await sleep(300);
          shutdownSeen.unwound = true;
          throw context.signal.reason;
        }),
      ],
      concurrency: { default: 1, perJob: { [deduped.name]: 0 } },
      pollingIntervalSeconds: 0.5,
    });
  }, 30_000);

  afterAll(async () => {
    await stopWorker(5_000);
    await closeDb();
    await dropSchemas();
  }, 30_000);

  /** A job's row, read straight from the queue's tables (works after the backend stopped). */
  async function jobRow(name: string, id: string) {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const result = await client.query<{ state: string; retry_limit: number }>(
        `select state, retry_limit from ${schema}.job where name = $1 and id = $2`,
        [name, id],
      );
      return result.rows[0];
    } finally {
      await client.end();
    }
  }

  class Rollback extends Error {}

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

  it("never delivers a job sent on a transaction that rolls back", async () => {
    let sentId: string | null = null;
    await expect(
      getDb().transaction(async (tx) => {
        sentId = await enqueue(transactional, { message: "rolled-back" }, { tx });
        throw new Rollback("caller failed after enqueueing");
      }),
    ).rejects.toBeInstanceOf(Rollback);
    expect(sentId).toEqual(expect.any(String));
    await sleep(2_000);
    expect(handled).not.toContain("rolled-back");
    const backend = await getBackend("web");
    expect(await backend.boss.findJobs(transactional.name, { id: sentId ?? undefined })).toEqual(
      [],
    );
  }, 20_000);

  it("delivers a job sent on a transaction once it commits (and dedupes inside it)", async () => {
    const ids = await getDb().transaction(async (tx) => {
      const first = await enqueue(transactional, { message: "committed" }, { tx });
      const duplicate = await enqueue(transactional, { message: "committed" }, { tx });
      // Not visible to the queue before the commit.
      await sleep(1_500);
      expect(handled).not.toContain("committed");
      return { first, duplicate };
    });
    expect(ids.first).toEqual(expect.any(String));
    expect(ids.duplicate).toBeNull();
    await waitFor(() => handled.includes("committed"));
    await sleep(1_000);
    expect(handled.filter((m) => m === "committed")).toHaveLength(1);
  }, 20_000);

  it("retries a handler whose nested enqueue has an invalid payload (not a poison job)", async () => {
    await enqueue(nested, { message: "nested" });
    await waitFor(() => nestedAttempts.length >= 2);
    expect(nestedAttempts).toEqual([1, 2]);
  }, 20_000);

  it("upgrades a standard queue in place when its job type gains a dedupe key", async () => {
    const backend = await getBackend("web");
    const name = `test.upgrade.${runId}`;
    await backend.boss.createQueue(name, { policy: "standard" });
    const plain = defineJob({ name, payload: z.object({ key: z.string() }) });
    const queuedBefore = await sendJob(backend, plain, { payload: { key: "a" }, dedupeKey: "a" });
    const keyed = defineJob({
      name,
      payload: z.object({ key: z.string() }),
      dedupeKey: (p) => p.key,
    });
    // A new process (the deploy that added the key) has not ensured the queue yet.
    backend.queues.delete(name);
    await ensureQueue(backend, keyed);
    expect((await backend.boss.getQueue(name))?.policy).toBe("exclusive");
    // The job queued before the upgrade is kept; new sends are deduplicated from now on.
    expect(queuedBefore).toEqual(expect.any(String));
    expect(await enqueue(keyed, { key: "b" })).toEqual(expect.any(String));
    expect(await enqueue(keyed, { key: "b" })).toBeNull();
  });

  // Last: it stops the worker.
  it("on shutdown, waits for an interrupted handler and gives its last attempt back", async () => {
    const id = await enqueue(interrupted, { message: "long" });
    await waitFor(() => shutdownSeen.started);
    await stopWorker(1_500);
    // stopWorker returned only after the handler unwound, with a shutdown reason.
    expect(shutdownSeen).toEqual({ started: true, shutdownAbort: true, unwound: true });
    // Its only attempt was the last one, yet the job is queued again (not failed for good).
    expect(await jobRow(interrupted.name, id ?? "")).toEqual({ state: "retry", retry_limit: 1 });
  }, 20_000);
});
