/**
 * The generation engine end to end with the sample provider (instant), against the local
 * Postgres and S3 store: request → `generation.run` handler → stored PNG, settled or refunded
 * credits. Follow-up jobs go to a throwaway queue schema. Skipped when a service is unreachable.
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

describe.skipIf(!reachable)("generation engine (integration, sample provider)", async () => {
  const sharp = (await import("sharp")).default;
  const billing = await import("../../src/server/billing");
  const gen = await import("../../src/server/generation");
  const { getProvider } = await import("../../src/server/providers");
  const { FLAKY_WINDOW_MS } = await import("../../src/server/providers/sample/provider");
  const storage = await import("../../src/server/storage");
  const { closeJobQueue } = await import("../../src/server/jobs");
  const { closeDb, getDb } = await import("../../src/server/db/client");
  const { creditLedger, generation } = await import("../../src/server/db/schema");
  const { eq, sql } = await import("drizzle-orm");
  const { generationRunHandler } = await import("./generation-run");
  const { createGenerationFixtures } =
    await import("../../src/server/test-support/generation-fixtures");
  const fixtures = createGenerationFixtures();
  const provider = getProvider("sample");

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

  /** Requests without enqueueing (as a caller with its own transaction would). */
  async function requestOnly(input: Parameters<typeof gen.requestGeneration>[0]) {
    return getDb().transaction((tx) => gen.requestGeneration(input, tx));
  }

  it("quotes from the policy and the provider", async () => {
    expect(await gen.quoteGeneration({ purpose: "asset_look", style: TEST_STYLE })).toEqual({
      priceCredits: 4,
    });
    expect(await gen.quoteGeneration({ purpose: "asset_sheet", style: TEST_STYLE })).toEqual({
      priceCredits: 6,
    });
  });

  it("request → run → succeeded: stores a readable PNG, settles, calls the hook", async () => {
    const { userId, projectId } = await funded(20);
    const finished: string[] = [];
    const off = gen.onGenerationFinished(async (g) => {
      finished.push(`${g.id}:${g.status}`);
    });
    try {
      const look = await gen.requestGeneration({
        userId,
        projectId,
        purpose: "asset_look",
        prompt: "An old fisherman with a grey beard",
        label: "Tomas",
        style: TEST_STYLE,
      });
      expect(look.priceCredits).toBe(4);
      expect(await billing.getBalance(userId)).toBe(16);
      const queued = await gen.getGeneration(look.generationId, userId);
      expect(queued).toMatchObject({
        status: "queued",
        kind: "image",
        model: "nano_banana_pro",
        isSample: true,
        params: { aspectRatio: "16:9", label: "Tomas" },
      });

      await run(look.generationId);
      const done = await gen.getGeneration(look.generationId, userId);
      expect(done).toMatchObject({ status: "succeeded", error: null, attempts: 1 });
      const bytes = await storage.readFileBytes(done?.resultFileId ?? "");
      const meta = await sharp(bytes).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(["png", 1280, 720]);
      const info = await storage.getOwnedFileInfo(done?.resultFileId ?? "", userId);
      expect(info).toMatchObject({ mimeType: "image/png", projectId, status: "ready" });
      expect(await entries(look.generationId)).toEqual(["reserve:-4", "settle:0"]);
      expect(await billing.getBalance(userId)).toBe(16);
      expect(finished).toEqual([`${look.generationId}:succeeded`]);

      // A sheet with the look as its reference.
      const sheet = await gen.requestGeneration({
        userId,
        projectId,
        purpose: "asset_sheet",
        prompt: "Character sheet of Tomas",
        label: "Tomas",
        referenceFileIds: [done?.resultFileId ?? ""],
        style: TEST_STYLE,
      });
      await run(sheet.generationId);
      const sheetDone = await gen.getGeneration(sheet.generationId, userId);
      expect(sheetDone?.status).toBe("succeeded");
      const sheetMeta = await sharp(
        await storage.readFileBytes(sheetDone?.resultFileId ?? ""),
      ).metadata();
      expect([sheetMeta.width, sheetMeta.height]).toEqual([1600, 900]);
      expect(await billing.getBalance(userId)).toBe(10);
    } finally {
      off();
    }
  });

  it("refuses without enough credits and creates nothing", async () => {
    const { userId, projectId } = await funded(3);
    const error = await gen
      .requestGeneration({
        userId,
        projectId,
        purpose: "asset_look",
        prompt: "x",
        style: TEST_STYLE,
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(billing.InsufficientCreditsError);
    const [{ count } = { count: -1 }] = await getDb()
      .select({ count: sql<number>`count(*)::int` })
      .from(generation)
      .where(eq(generation.userId, userId));
    expect(count).toBe(0);
    expect(await billing.getBalance(userId)).toBe(3);
  });

  it("validates input: project ownership, prompt, a final without its draft", async () => {
    const { userId, projectId } = await funded();
    const other = await funded();
    const base = {
      userId,
      projectId,
      purpose: "asset_look" as const,
      prompt: "x",
      style: TEST_STYLE,
    };
    await expect(gen.requestGeneration({ ...base, projectId: other.projectId })).rejects.toThrow(
      gen.GenerationInputError,
    );
    await expect(gen.requestGeneration({ ...base, prompt: "  " })).rejects.toThrow(
      gen.GenerationInputError,
    );
    await expect(gen.requestGeneration({ ...base, purpose: "block_final" })).rejects.toThrow(
      /needs the accepted draft/,
    );
    expect(await gen.getGeneration("not-a-uuid", userId)).toBeNull();
  });

  it("[[fail]] → failed with a readable error and refunded", async () => {
    const { userId, projectId } = await funded(10);
    const finished: string[] = [];
    const off = gen.onGenerationFinished(async (g) => {
      finished.push(g.status);
    });
    try {
      const { generationId } = await requestOnly({
        userId,
        projectId,
        purpose: "asset_look",
        prompt: "please [[fail]]",
        style: TEST_STYLE,
      });
      expect(await billing.getBalance(userId)).toBe(6);
      await run(generationId);
      const failed = await gen.getGeneration(generationId, userId);
      expect(failed?.status).toBe("failed");
      expect(failed?.error).toContain("asked to fail");
      expect(failed?.resultFileId).toBeNull();
      expect(await entries(generationId)).toEqual(["refund:4", "reserve:-4"]);
      expect(await billing.getBalance(userId)).toBe(10);
      expect(finished).toEqual(["failed"]);
    } finally {
      off();
    }
  });

  it("[[flaky]] → retried, then succeeded, with one provider job", async () => {
    const { userId, projectId } = await funded(10);
    const create = vi.spyOn(provider, "create");
    const { generationId } = await requestOnly({
      userId,
      projectId,
      purpose: "asset_look",
      prompt: "a lighthouse [[flaky]]",
      style: TEST_STYLE,
    });
    await expect(run(generationId, 1)).rejects.toThrow(/temporary problem/);
    const between = await row(generationId);
    expect(between.status).toBe("running");
    expect(between.providerJobId).not.toBeNull();

    await sleep(FLAKY_WINDOW_MS + 100);
    await run(generationId, 2);
    const done = await row(generationId);
    expect(done).toMatchObject({ status: "succeeded", attempts: 2 });
    expect(done.providerJobId).toBe(between.providerJobId);
    expect(create).toHaveBeenCalledTimes(1);
    expect(await entries(generationId)).toEqual(["reserve:-4", "settle:0"]);
  });

  it("fails and refunds when a retryable failure hits the last attempt", async () => {
    const { userId, projectId } = await funded(10);
    const { generationId } = await requestOnly({
      userId,
      projectId,
      purpose: "asset_look",
      prompt: "[[flaky]]",
      style: TEST_STYLE,
    });
    await run(generationId, 4); // retryLimit 3 → the 4th attempt is the last
    expect((await row(generationId)).status).toBe("failed");
    expect(await billing.getBalance(userId)).toBe(10);
  });

  it("running the handler twice (in turn or at once) charges and creates once", async () => {
    const { userId, projectId } = await funded(20);
    const create = vi.spyOn(provider, "create");
    const first = await requestOnly({
      userId,
      projectId,
      purpose: "asset_look",
      prompt: "twice in turn",
      style: TEST_STYLE,
    });
    await run(first.generationId);
    await run(first.generationId);
    expect((await row(first.generationId)).attempts).toBe(1);

    const second = await requestOnly({
      userId,
      projectId,
      purpose: "asset_look",
      prompt: "twice at once",
      style: TEST_STYLE,
    });
    await Promise.all([run(second.generationId), run(second.generationId)]);
    expect((await row(second.generationId)).status).toBe("succeeded");

    expect(create).toHaveBeenCalledTimes(2);
    for (const { generationId } of [first, second]) {
      expect(await entries(generationId)).toEqual(["reserve:-4", "settle:0"]);
    }
    expect(await billing.getBalance(userId)).toBe(12);
  });

  it("refuses another user's reference file, at request and at run time", async () => {
    const owner = await funded(10);
    const stranger = await funded(10);
    const theirs = await storage.putFileBytes({
      ownerId: stranger.userId,
      projectId: stranger.projectId,
      name: "secret.png",
      mimeType: "image/png",
      purpose: "asset_image",
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    });
    await expect(
      gen.requestGeneration({
        userId: owner.userId,
        projectId: owner.projectId,
        purpose: "asset_sheet",
        prompt: "sheet",
        referenceFileIds: [theirs.id],
        style: TEST_STYLE,
      }),
    ).rejects.toThrow(gen.GenerationInputError);
    expect(await billing.getBalance(owner.userId)).toBe(10);

    // A row that names it anyway (written around the service) fails before anything is sent.
    const create = vi.spyOn(provider, "create");
    const generationId = await fixtures.insertGeneration({
      userId: owner.userId,
      projectId: owner.projectId,
      priceCredits: 4,
      referenceFileIds: [theirs.id],
    });
    await billing.reserve({ userId: owner.userId, generationId, amount: 4 });
    await run(generationId);
    const failed = await row(generationId);
    expect(failed.status).toBe("failed");
    expect(failed.error).toMatch(/reference/i);
    expect(create).not.toHaveBeenCalled();
    expect(await billing.getBalance(owner.userId)).toBe(10);
  });

  it("reschedules (does not fail) a generation over the per-user limit", async () => {
    const { userId, projectId } = await funded(10);
    for (let i = 0; i < 3; i++) {
      await fixtures.insertGeneration({ userId, projectId, status: "running" });
    }
    const { generationId } = await requestOnly({
      userId,
      projectId,
      purpose: "asset_look",
      prompt: "wait your turn",
      style: TEST_STYLE,
    });
    const create = vi.spyOn(provider, "create");
    const before = Date.now();
    await run(generationId);
    const waiting = await row(generationId);
    expect(waiting).toMatchObject({ status: "queued", attempts: 0, providerJobId: null });
    expect(create).not.toHaveBeenCalled();

    const jobs = await getDb().execute<{ state: string; start_after: Date }>(
      sql.raw(
        `select state, start_after from ${jobSchema}.job where name = 'generation.run' ` +
          `and data->>'generationId' = '${generationId}'`,
      ),
    );
    expect(jobs.rows).toHaveLength(1);
    expect(jobs.rows[0]?.state).toBe("created");
    expect(new Date(jobs.rows[0]?.start_after ?? 0).getTime()).toBeGreaterThan(before + 5_000);

    // Once a slot frees up, the follow-up runs it.
    await getDb()
      .update(generation)
      .set({ status: "failed", finishedAt: new Date() })
      .where(sql`${generation.userId} = ${userId} and ${generation.status} = 'running'`);
    await run(generationId);
    expect((await row(generationId)).status).toBe("succeeded");
  });
});
