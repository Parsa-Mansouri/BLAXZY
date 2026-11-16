/**
 * Regression tests for the generation engine's durability fixes, against the local Postgres and
 * S3 store with the sample provider: the run job sent in the request's transaction, references
 * checked on the caller's transaction, completion hooks re-run by the sweep until they return,
 * first-come-first-served claims, one provider job per generation without a held lock, reuse of
 * an uploaded result, and shutdowns that change nothing. Skipped when a service is unreachable.
 */
import "dotenv/config";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { servicesReachable } from "../../src/server/test-support/generation-fixtures";
import {
  dropSchema,
  jobContext,
  pointQueueAtThrowawaySchema,
  TEST_STYLE,
} from "../../src/server/test-support/script-fixtures";

const jobSchema = pointQueueAtThrowawaySchema();
const reachable = await servicesReachable();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!reachable)("generation durability (integration, sample provider)", async () => {
  const billing = await import("../../src/server/billing");
  const gen = await import("../../src/server/generation");
  const { getProvider } = await import("../../src/server/providers");
  const { closeJobQueue, generationRun, JobShutdownError } = await import("../../src/server/jobs");
  const { closeDb, getDb } = await import("../../src/server/db/client");
  const { creditLedger, file, generation } = await import("../../src/server/db/schema");
  const { eq, sql } = await import("drizzle-orm");
  const { generationRunHandler } = await import("./generation-run");
  const { createGenerationFixtures } =
    await import("../../src/server/test-support/generation-fixtures");
  const fixtures = createGenerationFixtures();
  const provider = getProvider("sample");
  const last = generationRun.options.retryLimit + 1;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await fixtures.cleanup();
    await closeJobQueue();
    await dropSchema(jobSchema);
    await closeDb();
  });

  const run = (generationId: string, attempt = 1) =>
    generationRunHandler.run({ generationId }, jobContext(attempt));

  async function funded(credits = 100) {
    const userId = await fixtures.newUser();
    const projectId = await fixtures.newProject(userId);
    if (credits > 0) await billing.grantCredits({ userId, amount: credits });
    return { userId, projectId };
  }

  async function row(generationId: string) {
    const [r] = await getDb().select().from(generation).where(eq(generation.id, generationId));
    if (!r) throw new Error("generation row missing");
    return r;
  }

  async function entries(generationId: string) {
    const rows = await getDb()
      .select({ type: creditLedger.type, amount: creditLedger.amount })
      .from(creditLedger)
      .where(eq(creditLedger.generationId, generationId));
    return rows.map((e) => `${e.type}:${e.amount}`).sort();
  }

  /** `generation.run` jobs of a generation in the throwaway queue. */
  async function runJobs(generationId: string): Promise<number> {
    const result = await getDb().execute<{ n: number }>(
      sql.raw(
        `select count(*)::int as n from ${jobSchema}.job where name = 'generation.run' ` +
          `and data->>'generationId' = '${generationId}'`,
      ),
    );
    return result.rows[0]?.n ?? 0;
  }

  const look = (userId: string, projectId: string, prompt = "a lighthouse") => ({
    userId,
    projectId,
    purpose: "asset_look" as const,
    prompt,
    style: TEST_STYLE,
    maxCredits: 1_000,
  });

  class Rollback extends Error {}

  it("sends the run job in the request's transaction: none after a rollback, one after commit", async () => {
    const { userId, projectId } = await funded(20);
    let rolledBackId = "";
    await expect(
      getDb().transaction(async (tx) => {
        rolledBackId = (await gen.requestGeneration(look(userId, projectId), tx)).generationId;
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
    expect(await getDb().select().from(generation).where(eq(generation.id, rolledBackId))).toEqual(
      [],
    );
    expect(await runJobs(rolledBackId)).toBe(0);
    expect(await billing.getBalance(userId)).toBe(20);

    const { generationId } = await getDb().transaction((tx) =>
      gen.requestGeneration(look(userId, projectId), tx),
    );
    expect(await runJobs(generationId)).toBe(1);
    expect(await entries(generationId)).toEqual(["reserve:-4"]);
  });

  it("checks references on the caller's transaction (sees its uncommitted rows)", async () => {
    const { userId, projectId } = await funded(20);
    await expect(
      getDb().transaction(async (tx) => {
        // Visible only inside this transaction: a check on another connection would miss it.
        const [ref] = await tx
          .insert(file)
          .values({
            ownerId: userId,
            projectId,
            storageKey: `test/${crypto.randomUUID()}.png`,
            mimeType: "image/png",
            status: "ready",
          })
          .returning({ id: file.id });
        const { generationId } = await gen.requestGeneration(
          { ...look(userId, projectId), referenceFileIds: [ref?.id ?? ""] },
          tx,
        );
        expect(
          (await tx.select().from(generation).where(eq(generation.id, generationId)))[0],
        ).toMatchObject({ referenceFileIds: [ref?.id] });
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });

  it("re-notifies a finished generation whose hook kept failing, until it returns", async () => {
    const { userId, projectId } = await funded(20);
    const { generationId } = await getDb().transaction((tx) =>
      gen.requestGeneration(look(userId, projectId), tx),
    );
    let failing = true;
    const calls: string[] = [];
    const off = gen.onGenerationFinished(async (g) => {
      if (g.id !== generationId) return;
      calls.push(g.status);
      if (failing) throw new Error("hook down");
    });
    try {
      // Every attempt's hook call fails, the last one too: the generation is settled anyway.
      await expect(run(generationId, last)).rejects.toThrow("hook down");
      expect(await row(generationId)).toMatchObject({ status: "succeeded", notifiedAt: null });
      expect(await entries(generationId)).toEqual(["reserve:-4", "settle:0"]);

      // Within the grace period the sweep leaves it to the run's own retries.
      expect((await gen.sweepStuckGenerations({ userId })).renotified).toEqual([]);
      const later = new Date(Date.now() + 10 * 60_000);
      // Still failing: not marked, tried again next time.
      expect((await gen.sweepStuckGenerations({ userId, now: later })).renotified).toEqual([]);
      failing = false;
      expect((await gen.sweepStuckGenerations({ userId, now: later })).renotified).toEqual([
        generationId,
      ]);
      expect((await row(generationId)).notifiedAt).not.toBeNull();
      const before = calls.length;
      expect((await gen.sweepStuckGenerations({ userId, now: later })).renotified).toEqual([]);
      expect(calls).toHaveLength(before);
    } finally {
      off();
    }
  });

  it("marks a generation notified once its hooks return", async () => {
    const { userId, projectId } = await funded(20);
    const { generationId } = await getDb().transaction((tx) =>
      gen.requestGeneration(look(userId, projectId), tx),
    );
    await run(generationId);
    expect((await row(generationId)).notifiedAt).not.toBeNull();
  });

  it("claims queued generations first come, first served", async () => {
    const { userId, projectId } = await funded(0);
    // Two of three slots taken: one is free.
    for (let i = 0; i < 2; i++) {
      await fixtures.insertGeneration({ userId, projectId, status: "running" });
    }
    const older = await fixtures.insertGeneration({ userId, projectId, priceCredits: 0 });
    await billing.reserve({ userId, generationId: older, amount: 0 });
    const newer = await fixtures.insertGeneration({ userId, projectId, priceCredits: 0 });
    await billing.reserve({ userId, generationId: newer, amount: 0 });
    await getDb()
      .update(generation)
      .set({ createdAt: new Date(Date.now() - 60_000) })
      .where(eq(generation.id, older));

    await run(newer);
    expect((await row(newer)).status).toBe("queued");
    await run(older);
    expect((await row(older)).status).toBe("succeeded");
  });

  it("does not create a second provider job while another run holds the lease", async () => {
    const { userId, projectId } = await funded(0);
    const id = await fixtures.insertGeneration({ userId, projectId, priceCredits: 0 });
    await billing.reserve({ userId, generationId: id, amount: 0 });
    // Another run took the right to create, and is creating right now.
    await getDb()
      .update(generation)
      .set({ status: "running", startedAt: new Date(), providerClaimedAt: new Date() })
      .where(eq(generation.id, id));
    const create = vi.spyOn(provider, "create");
    const pending = run(id);
    await sleep(1_500);
    expect((await row(id)).status).toBe("running");
    // The other run stores its provider job; this one picks it up.
    const { providerJobId } = await provider.create(
      {
        kind: "image",
        purpose: "asset_look",
        model: "nano_banana_pro",
        prompt: "test",
        params: { aspectRatio: "16:9" },
        references: [],
      },
      { idempotencyKey: id },
    );
    create.mockClear();
    await getDb().update(generation).set({ providerJobId }).where(eq(generation.id, id));
    await pending;
    expect(create).not.toHaveBeenCalled();
    expect(await row(id)).toMatchObject({ status: "succeeded", providerJobId });
  });

  it("reuses an uploaded result on retry instead of downloading it again", async () => {
    const { userId, projectId } = await funded(20);
    const first = await getDb().transaction((tx) =>
      gen.requestGeneration(look(userId, projectId), tx),
    );
    await run(first.generationId);
    const done = await row(first.generationId);
    expect(done.params).toMatchObject({ uploadedResultFileId: done.resultFileId });

    // A run that uploaded and recorded its result, then died before marking it succeeded.
    const second = await getDb().transaction((tx) =>
      gen.requestGeneration(look(userId, projectId, "a harbour"), tx),
    );
    const { providerJobId } = await provider.create(
      {
        kind: "image",
        purpose: "asset_look",
        model: "nano_banana_pro",
        prompt: "a harbour",
        params: { aspectRatio: "16:9" },
        references: [],
      },
      { idempotencyKey: second.generationId },
    );
    await getDb()
      .update(generation)
      .set({
        status: "running",
        startedAt: new Date(),
        providerJobId,
        params: sql`${generation.params} || ${JSON.stringify({ uploadedResultFileId: done.resultFileId })}::jsonb`,
      })
      .where(eq(generation.id, second.generationId));
    const fetch = vi.spyOn(provider, "fetchResult");
    await run(second.generationId, 2);
    expect(fetch).not.toHaveBeenCalled();
    expect(await row(second.generationId)).toMatchObject({
      status: "succeeded",
      resultFileId: done.resultFileId,
    });
  });

  it("an attempt interrupted by a shutdown changes nothing, even the last one", async () => {
    const { userId, projectId } = await funded(20);
    const { generationId } = await getDb().transaction((tx) =>
      gen.requestGeneration(look(userId, projectId), tx),
    );
    const controller = new AbortController();
    controller.abort(new JobShutdownError());
    await expect(
      generationRunHandler.run(
        { generationId },
        { jobId: "j", attempt: last, signal: controller.signal },
      ),
    ).rejects.toBeInstanceOf(JobShutdownError);
    expect((await row(generationId)).status).toBe("running");
    expect(await entries(generationId)).toEqual(["reserve:-4"]);

    // An expired last attempt, by contrast, fails and refunds.
    const expired = new AbortController();
    expired.abort();
    await expect(
      generationRunHandler.run(
        { generationId },
        { jobId: "j", attempt: last, signal: expired.signal },
      ),
    ).resolves.toBeUndefined();
    expect((await row(generationId)).status).toBe("failed");
    expect(await entries(generationId)).toEqual(["refund:4", "reserve:-4"]);
  });
});
