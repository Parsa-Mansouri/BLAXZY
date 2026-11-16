/**
 * Production end to end against the local Postgres and S3 store, in sample mode (damis answer at
 * once, the sample provider renders real MP4s with ffmpeg): the services, the production job
 * handlers, the generation handler and the export handler run directly, with the completion hook
 * registered as the worker does. Follow-up jobs go to a throwaway queue schema. Skipped when a
 * service or ffmpeg is unavailable.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ffmpegReady } from "../../src/server/test-support/integration";
import { servicesReachable } from "../../src/server/test-support/generation-fixtures";
import {
  dropSchema,
  jobContext,
  pointQueueAtThrowawaySchema,
} from "../../src/server/test-support/script-fixtures";

const jobSchema = pointQueueAtThrowawaySchema();
const reachable = await servicesReachable();
const hasFfmpeg = reachable && (await ffmpegReady());

describe.skipIf(!hasFfmpeg)(
  "production (integration, sample mode)",
  { timeout: 120_000 },
  async () => {
    const { unzipSync } = await import("fflate");
    const { autoConfirm, PRODUCTION_SPEND_FUNCTIONS } =
      await import("../../src/server/test-support/confirm-fixtures");
    const production = autoConfirm(
      await import("../../src/server/production"),
      PRODUCTION_SPEND_FUNCTIONS,
    );
    const billing = await import("../../src/server/billing");
    const blocks = await import("../../src/server/blocks");
    const gen = await import("../../src/server/generation");
    const storage = await import("../../src/server/storage");
    const { closeJobQueue } = await import("../../src/server/jobs");
    const { closeDb, getDb } = await import("../../src/server/db/client");
    const s = await import("../../src/server/db/schema");
    const { and, asc, eq, inArray, isNull, sql } = await import("drizzle-orm");
    const { generationRunHandler } = await import("./generation-run");
    const { blockReviseHandler, productionPrepareHandler } = await import("./production-prepare");
    const { takeFixHandler, takeGenerateHandler } = await import("./production-take");
    const { exportBuildHandler } = await import("./production-export");
    const { productionDispatchHandler } = await import("./production-dispatch");
    const { productionGenerationHook } = await import("./production-generation-hook");
    const { createProductionFixtures } =
      await import("../../src/server/test-support/production-fixtures");
    const fixtures = createProductionFixtures();
    let unregister: () => void = () => undefined;

    beforeAll(() => {
      unregister = gen.onGenerationFinished(productionGenerationHook);
    });

    afterAll(async () => {
      unregister();
      await fixtures.cleanup();
      await closeJobQueue();
      await dropSchema(jobSchema);
      await closeDb();
    });

    /* -------------------------------------------------------------------------------------- */

    const SHOTS = [
      {
        excerpt: "TOMAS climbs the stairs of the lighthouse.",
        prompt:
          "SCENE: Lighthouse [location:Lighthouse].\nTomas [character:Tomas] climbs the stairs.",
        assetRefs: ["location:Lighthouse", "character:Tomas"],
        title: "The climb",
      },
      {
        excerpt: "TOMAS lights the lamp.",
        prompt: "Tomas [character:Tomas] lights the Lamp [prop:Lamp] at the top of the tower.",
        assetRefs: ["character:Tomas", "prop:Lamp"],
        title: "The lamp",
      },
      {
        excerpt: "The beam sweeps the sea.",
        prompt: "SCENE: Lighthouse [location:Lighthouse]. The beam sweeps the dark sea.",
        assetRefs: ["location:Lighthouse"],
        title: "Beam, sea",
      },
    ];

    type ShotSpec = (typeof SHOTS)[number] & { durationSeconds?: number };
    async function setup(credits: number, shots: ShotSpec[] = SHOTS) {
      const userId = await fixtures.newUser();
      const { projectId, scriptVersionId } = await fixtures.newProductionProject(userId);
      if (credits > 0) await billing.grantCredits({ userId, amount: credits });
      const tomas = await fixtures.readyAsset(projectId, userId, "character", "Tomas");
      const lighthouse = await fixtures.readyAsset(projectId, userId, "location", "Lighthouse");
      const lamp = await fixtures.readyAsset(projectId, userId, "prop", "Lamp");
      await fixtures.setBlocks(projectId, scriptVersionId, shots);
      return { userId, projectId, scriptVersionId, tomas, lighthouse, lamp };
    }

    /** A project whose blocks were written by the (sample) Director, with every asset ready. */
    async function setupDirected(credits: number) {
      const userId = await fixtures.newUser();
      const { projectId, scriptVersionId } = await fixtures.newProductionProject(userId);
      if (credits > 0) await billing.grantCredits({ userId, amount: credits });
      const directed = await fixtures.setDirectedBlocks(projectId, userId, scriptVersionId);
      return { userId, projectId, scriptVersionId, ...directed };
    }

    /** Runs every pending preparation, take job and generation of the project until none is left. */
    async function drain(projectId: string): Promise<void> {
      const db = getDb();
      for (let round = 0; round < 12; round++) {
        let worked = false;
        const pendingBlocks = await db
          .select({ id: s.promptBlock.id })
          .from(s.promptBlock)
          .where(
            and(
              eq(s.promptBlock.projectId, projectId),
              isNull(s.promptBlock.supersededAt),
              eq(s.promptBlock.productionState, "pending"),
            ),
          );
        for (const { id } of pendingBlocks) {
          await productionPrepareHandler.run({ blockId: id }, jobContext());
          await blockReviseHandler.run({ blockId: id }, jobContext());
          worked = true;
        }
        const pendingTakes = await db
          .select()
          .from(s.blockTake)
          .where(and(eq(s.blockTake.projectId, projectId), eq(s.blockTake.status, "pending")));
        for (const take of pendingTakes) {
          if (!take.generationId) {
            const handler = take.prompt === null ? takeFixHandler : takeGenerateHandler;
            await handler.run({ takeId: take.id }, jobContext());
            worked = true;
          }
        }
        const queued = await db
          .select({ id: s.generation.id })
          .from(s.generation)
          .where(
            and(
              eq(s.generation.projectId, projectId),
              inArray(s.generation.status, ["queued", "running"]),
            ),
          );
        for (const { id } of queued) {
          await generationRunHandler.run({ generationId: id }, jobContext());
          worked = true;
        }
        if (!worked) return;
      }
      throw new Error("drain did not settle");
    }

    async function lineages(projectId: string): Promise<string[]> {
      const rows = await getDb()
        .select({ lineageId: s.promptBlock.lineageId })
        .from(s.promptBlock)
        .where(and(eq(s.promptBlock.projectId, projectId), isNull(s.promptBlock.supersededAt)))
        .orderBy(asc(s.promptBlock.orderIndex));
      return rows.map((r) => r.lineageId);
    }

    async function detail(lineageId: string, userId: string) {
      const d = await production.getBlockDetail(lineageId, userId);
      if (!d) throw new Error("detail missing");
      return d;
    }

    async function takeRow(takeId: string) {
      const [row] = await getDb().select().from(s.blockTake).where(eq(s.blockTake.id, takeId));
      if (!row) throw new Error("take missing");
      return row;
    }

    async function generationRow(id: string) {
      const [row] = await getDb().select().from(s.generation).where(eq(s.generation.id, id));
      if (!row) throw new Error("generation missing");
      return row;
    }

    async function latestTakeId(lineageId: string, userId: string): Promise<string> {
      const id = (await detail(lineageId, userId)).takes[0]?.id;
      if (!id) throw new Error("no take");
      return id;
    }

    async function prepareAndApprove(projectId: string, userId: string) {
      await production.ensurePrepared(projectId, userId);
      await drain(projectId);
      return production.approveAllBlocks({ projectId, userId });
    }

    async function startAllDrafts(projectId: string, userId: string) {
      const quote = await production.quoteProduction(projectId, userId);
      if (!quote) throw new Error("quote missing");
      const started = await production.startDrafts({
        projectId,
        userId,
        expectedCredits: quote.drafts.credits,
      });
      await drain(projectId);
      return started;
    }

    async function events(projectId: string) {
      const rows = await getDb()
        .select({ type: s.projectEvent.type })
        .from(s.projectEvent)
        .where(eq(s.projectEvent.projectId, projectId));
      return rows.map((r) => r.type);
    }

    /* -------------------------------------------------------------------------------------- */

    it("prepare → review → assets → approve → drafts → fixes → finals → done → export", async () => {
      const { userId, projectId, tomas, lighthouse, lamp } = await setup(1000);
      const [l1, l2, l3] = await lineages(projectId);
      if (!l1 || !l2 || !l3) throw new Error("blocks missing");

      let overview = await production.getProductionOverview(projectId, userId);
      expect(overview).toMatchObject({ phase: "preparing", blockCount: 3, canStartDrafts: false });

      // Preparation is code: no dami runs; a second call starts nothing new.
      await production.ensurePrepared(projectId, userId);
      await production.ensurePrepared(projectId, userId);
      expect(
        (await events(projectId)).filter((e) => e === "production.prepare_started"),
      ).toHaveLength(1);
      await drain(projectId);
      overview = await production.getProductionOverview(projectId, userId);
      expect(overview).toMatchObject({ phase: "block_review", counts: { block_review: 3 } });
      const d1 = await detail(l1, userId);
      expect(d1.stage).toBe("block_review");
      expect(d1.prompt).toContain("Lighthouse <<<image_1>>>");
      expect(d1.prompt).toContain("Tomas <<<image_2>>>");
      expect(d1.assets.map((a) => a.ref)).toEqual(["location:Lighthouse", "character:Tomas"]);
      // A location is attached with its approved Hero; a character with its sheet.
      expect(d1.assets[0]?.thumbnailFileId).toBe(lighthouse.lookFileId);
      const d2 = await detail(l2, userId);
      expect(d2.prompt).toBe(
        "Tomas <<<image_1>>> lights the Lamp <<<image_2>>> at the top of the tower.",
      );
      const prepareRuns = await getDb()
        .select({ key: s.damiRun.damiKey })
        .from(s.damiRun)
        .where(eq(s.damiRun.projectId, projectId));
      expect(prepareRuns.filter((r) => r.key === "text-blocks")).toHaveLength(0);

      // A shot cut before the Director existed has no direction to revise: asking for changes
      // fails clearly and leaves the shot as it is (revisions are covered by the directed tests).
      await expect(
        production.submitBlockReview({
          lineageId: l1,
          userId,
          decision: "rejected",
          note: "Closer on his hands.",
        }),
      ).rejects.toThrow(/before the Director existed/);
      expect((await detail(l1, userId)).id).toBe(d1.id);
      expect((await detail(l1, userId)).stage).toBe("block_review");

      // Change the third block's assets: the lighthouse and the lamp (not named there before).
      await expect(
        production.setBlockAssets({ lineageId: l3, userId, assetIds: [randomId()] }),
      ).rejects.toThrow(production.ProductionInputError);
      const changed = await production.setBlockAssets({
        lineageId: l3,
        userId,
        assetIds: [lighthouse.assetId, lamp.assetId],
      });
      expect(changed?.stage).toBe("preparing");
      await drain(projectId);
      const d3 = await detail(l3, userId);
      expect(d3.assets.map((a) => a.ref)).toEqual(["location:Lighthouse", "prop:Lamp"]);
      expect(d3.prompt).toContain("<<<image_2>>>");

      // Approve all; the completion gate is closed.
      expect(await production.approveAllBlocks({ projectId, userId })).toBe(3);
      await expect(production.completeProduction({ projectId, userId })).rejects.toThrow(
        /3 shots are not final yet/,
      );
      overview = await production.getProductionOverview(projectId, userId);
      expect(overview).toMatchObject({ counts: { approved: 3 }, canStartDrafts: true });

      // Quote and start: a wrong price is refused.
      const quote = await production.quoteProduction(projectId, userId);
      expect(quote).toEqual({ drafts: { count: 3, credits: 60 }, finalsEach: 60, balance: 1000 });
      await expect(
        production.startDrafts({ projectId, userId, expectedCredits: 59 }),
      ).rejects.toThrow(/price changed/);
      expect(await production.startDrafts({ projectId, userId, expectedCredits: 60 })).toEqual({
        started: 3,
      });
      expect((await detail(l1, userId)).stage).toBe("draft_generating");
      expect((await detail(l1, userId)).busy).toBe(true);
      await drain(projectId);
      overview = await production.getProductionOverview(projectId, userId);
      expect(overview).toMatchObject({ phase: "generating", counts: { draft_review: 3 } });

      // The draft: references are the sheets in token order, with the poster stored.
      const draft1 = await takeRow(await latestTakeId(l1, userId));
      expect(draft1).toMatchObject({ stage: "draft", status: "in_review", takeNumber: 1 });
      expect(draft1.fileId).not.toBeNull();
      expect(draft1.posterFileId).not.toBeNull();
      expect(draft1.referenceFileIds).toEqual([lighthouse.lookFileId, tomas.sheetFileId]);
      const draftGen = await generationRow(draft1.generationId ?? "");
      expect(draftGen).toMatchObject({
        purpose: "block_draft",
        status: "succeeded",
        priceCredits: 20,
      });
      expect(draftGen.params).toMatchObject({
        resolution: "480p",
        durationSeconds: 1,
        sound: true,
      });
      const view1 = (await detail(l1, userId)).takes[0];
      expect(view1).toMatchObject({ isSample: true, priceCredits: 20, stage: "draft" });
      expect((await detail(l1, userId)).posterFileId).toBe(draft1.posterFileId);

      // The hook is idempotent.
      await production.applyTakeGenerationResult({ ...draftGen, posterFileId: null });
      expect(await takeRow(draft1.id)).toMatchObject({
        status: "in_review",
        fileId: draft1.fileId,
        posterFileId: draft1.posterFileId,
      });

      // Reject the first draft with a note → a fixed draft (take-fixer).
      expect(
        await production.submitTakeReview({
          takeId: draft1.id,
          userId,
          decision: "rejected",
          note: "Keep his face sharp.",
        }),
      ).toBe("draft_generating");
      const [takeReview] = await getDb()
        .select()
        .from(s.review)
        .where(eq(s.review.subjectId, draft1.id));
      expect(takeReview).toMatchObject({
        subjectType: "generation",
        decision: "rejected",
        issueCodes: [],
        note: "Keep his face sharp.",
        damiRunId: draft1.damiRunId,
      });
      await drain(projectId);
      const fixed1 = await takeRow(await latestTakeId(l1, userId));
      expect(fixed1).toMatchObject({
        stage: "draft",
        status: "in_review",
        takeNumber: 2,
        parentId: draft1.id,
      });
      expect(fixed1.prompt).toContain("RETRY (draft)");
      expect(fixed1.damiRunId).not.toBe(draft1.damiRunId);

      // Accept it → a final from that exact draft.
      expect(
        await production.submitTakeReview({ takeId: fixed1.id, userId, decision: "accepted" }),
      ).toBe("final_generating");
      await drain(projectId);
      const final1 = await takeRow(await latestTakeId(l1, userId));
      expect(final1).toMatchObject({
        stage: "final",
        status: "in_review",
        draftTakeId: fixed1.id,
        prompt: fixed1.prompt,
      });
      expect(final1.referenceFileIds).toEqual(fixed1.referenceFileIds);
      const finalGen = await generationRow(final1.generationId ?? "");
      expect(finalGen).toMatchObject({ purpose: "block_final", status: "succeeded" });
      expect(finalGen.params).toMatchObject({
        resolution: "1080p",
        draftGenerationId: fixed1.generationId,
      });
      expect(
        await production.submitTakeReview({ takeId: final1.id, userId, decision: "accepted" }),
      ).toBe("done");
      // Reviewing it again is refused; the hook does not reopen it.
      await expect(
        production.submitTakeReview({ takeId: final1.id, userId, decision: "accepted" }),
      ).rejects.toThrow(/no longer waiting/);
      await production.applyTakeGenerationResult({ ...finalGen, posterFileId: null });
      expect((await takeRow(final1.id)).status).toBe("accepted");

      // Second block: final rejected → back to a new draft.
      const draft2 = await latestTakeId(l2, userId);
      await production.submitTakeReview({ takeId: draft2, userId, decision: "accepted" });
      await drain(projectId);
      const final2 = await latestTakeId(l2, userId);
      expect(
        await production.submitTakeReview({
          takeId: final2,
          userId,
          decision: "rejected",
          note: "The video flickers.",
        }),
      ).toBe("draft_generating");
      await drain(projectId);
      const redraft2 = await takeRow(await latestTakeId(l2, userId));
      expect(redraft2).toMatchObject({ stage: "draft", status: "in_review", parentId: final2 });
      expect(redraft2.prompt).toContain("RETRY (final)");
      await production.submitTakeReview({ takeId: redraft2.id, userId, decision: "accepted" });
      await drain(projectId);
      await production.submitTakeReview({
        takeId: await latestTakeId(l2, userId),
        userId,
        decision: "accepted",
      });

      // Third block straight through.
      await production.submitTakeReview({
        takeId: await latestTakeId(l3, userId),
        userId,
        decision: "accepted",
      });
      await drain(projectId);
      await production.submitTakeReview({
        takeId: await latestTakeId(l3, userId),
        userId,
        decision: "accepted",
      });
      overview = await production.getProductionOverview(projectId, userId);
      expect(overview).toMatchObject({ phase: "finished", canComplete: true, counts: { done: 3 } });

      // Finished clips, one by one.
      const clips = await production.listFinishedClips(projectId, userId, { limit: 2 });
      expect(clips?.items.map((c) => c.downloadName)).toEqual([
        "script-it_B001_the-climb.mp4",
        "script-it_B002_the-lamp.mp4",
      ]);
      const rest = await production.listFinishedClips(projectId, userId, {
        cursor: clips?.nextCursor,
      });
      expect(rest?.items.map((c) => c.downloadName)).toEqual(["script-it_B003_beam-sea.mp4"]);
      expect(rest?.nextCursor).toBeNull();
      const url = await production.getClipDownloadUrl({ lineageId: l1, userId });
      expect(url).toContain("response-content-disposition");
      expect(decodeURIComponent(url ?? "")).toContain("script-it_B001_the-climb.mp4");

      // The ZIP: every clip in order with its name, and shots.csv.
      const requested = await production.requestExport({ projectId, userId });
      expect(requested).toMatchObject({ status: "pending", clipCount: 3, downloadUrl: null });
      await exportBuildHandler.run({ exportId: requested?.id ?? "" }, jobContext());
      const ready = await production.getExport(requested?.id ?? "", userId);
      expect(ready).toMatchObject({ status: "ready", clipCount: 3 });
      expect(ready?.downloadUrl).toContain("_clips.zip");
      const [bundle] = await getDb()
        .select()
        .from(s.exportBundle)
        .where(eq(s.exportBundle.id, requested?.id ?? ""));
      const zip = await storage.readFileBytes(bundle?.fileId ?? "");
      const files = unzipSync(zip);
      const all = [...(clips?.items ?? []), ...(rest?.items ?? [])];
      expect(Object.keys(files)).toEqual(["shots.csv", ...all.map((c) => c.downloadName)]);
      for (const clip of all) {
        expect(files[clip.downloadName]).toEqual(await storage.readFileBytes(clip.fileId));
      }
      const csv = new TextDecoder().decode(files["shots.csv"]).replace(/^\uFEFF/, "");
      const lines = csv.trimEnd().split("\r\n");
      expect(lines[0]).toBe("order,title,duration_seconds,file_name,script_excerpt");
      expect(lines[1]).toBe(
        "1,The climb,1,script-it_B001_the-climb.mp4,TOMAS climbs the stairs of the lighthouse.",
      );
      expect(lines[3]).toBe('3,"Beam, sea",1,script-it_B003_beam-sea.mp4,The beam sweeps the sea.');
      // Nothing changed: the same bundle is reused.
      expect((await production.requestExport({ projectId, userId }))?.id).toBe(requested?.id);

      // Credits: 3 + 1 fix + 1 redraft drafts (20 each), 3 + 1 finals (60 each).
      expect(await billing.getBalance(userId)).toBe(1000 - 5 * 20 - 4 * 60);

      expect(await production.completeProduction({ projectId, userId })).toBe(true);
      expect(await production.completeProduction({ projectId, userId })).toBe(false);
      const kinds = new Set(await events(projectId));
      for (const type of [
        "production.prepare_started",
        "production.block_prepared",
        "production.block_assets_set",
        "production.blocks_approved",
        "production.drafts_started",
        "production.take_ready",
        "production.take_rejected",
        "production.take_accepted",
        "production.export_requested",
        "production.export_ready",
        "production.completed",
      ]) {
        expect(kinds, type).toContain(type);
      }
    });

    it("short credits, a failing generation with its refund, and retries", async () => {
      const shots = [
        SHOTS[0] as (typeof SHOTS)[number],
        { ...(SHOTS[1] as (typeof SHOTS)[number]), prompt: `${SHOTS[1]?.prompt} [[fail]]` },
      ];
      const { userId, projectId } = await setup(30, shots);
      const [l1, l2] = await lineages(projectId);
      if (!l1 || !l2) throw new Error("blocks missing");
      expect(await prepareAndApprove(projectId, userId)).toBe(2);

      // The batch needs 40; 30 is refused up front.
      await expect(
        production.startDrafts({ projectId, userId, expectedCredits: 40 }),
      ).rejects.toThrow(/need 40 credits and your balance is 30/);
      await billing.grantCredits({ userId, amount: 10 });
      expect(await production.startDrafts({ projectId, userId, expectedCredits: 40 })).toEqual({
        started: 2,
      });
      // Something else spends credits before the takes reserve: each take reserves on its own.
      const [other] = await getDb()
        .insert(s.generation)
        .values({
          userId,
          projectId,
          kind: "image",
          purpose: "asset_look",
          provider: "sample",
          model: "x",
          prompt: "elsewhere",
          status: "succeeded",
          priceCredits: 5,
        })
        .returning({ id: s.generation.id });
      await billing.reserve({ userId, generationId: other?.id ?? "", amount: 5 });
      await takeGenerateHandler.run({ takeId: await latestTakeId(l1, userId) }, jobContext());
      await drain(projectId);

      // First take reserved 20 (15 left); the second could not: failed with the credits message.
      const t1 = await takeRow(await latestTakeId(l1, userId));
      expect(t1.status).toBe("in_review");
      const t2 = await takeRow(await latestTakeId(l2, userId));
      expect(t2).toMatchObject({ status: "failed", generationId: null });
      expect(t2.failure).toMatch(/You need 20 credits for this; you have 15/);
      expect((await detail(l2, userId)).stage).toBe("failed");

      // Retry with credits: the [[fail]] prompt fails at the provider and is refunded.
      await billing.grantCredits({ userId, amount: 100 });
      expect(await production.retryTake({ takeId: t2.id, userId })).toBe("draft_generating");
      await drain(projectId);
      const failed = await takeRow(t2.id);
      expect(failed.status).toBe("failed");
      expect(failed.failure).toMatch(/asked to fail/);
      const ledger = await getDb()
        .select({ type: s.creditLedger.type, amount: s.creditLedger.amount })
        .from(s.creditLedger)
        .where(eq(s.creditLedger.generationId, failed.generationId ?? ""));
      expect(ledger.map((e) => `${e.type}:${e.amount}`).sort()).toEqual([
        "refund:20",
        "reserve:-20",
      ]);
      expect(await billing.getBalance(userId)).toBe(115);

      // A retry runs a new generation each time (still failing here, refunded again).
      const firstGeneration = failed.generationId;
      await production.retryTake({ takeId: t2.id, userId });
      await drain(projectId);
      const again = await takeRow(t2.id);
      expect(again.status).toBe("failed");
      expect(again.generationId).not.toBe(firstGeneration);
      // Rule 4: the reset row loses the link to the failed attempt; the retry's event keeps it.
      const retried = await getDb()
        .select({ payload: s.projectEvent.payload })
        .from(s.projectEvent)
        .where(
          and(
            eq(s.projectEvent.projectId, projectId),
            eq(s.projectEvent.type, "production.take_retried"),
          ),
        )
        .orderBy(asc(s.projectEvent.createdAt));
      expect(retried.at(-1)?.payload).toMatchObject({
        takeId: t2.id,
        previousGenerationId: firstGeneration,
        previousFailure: expect.stringMatching(/asked to fail/),
      });
      expect(retried.at(0)?.payload).toMatchObject({
        previousGenerationId: null,
        previousFailure: expect.stringMatching(/You need 20 credits/),
      });
      expect(await billing.getBalance(userId)).toBe(115);
      await expect(production.retryTake({ takeId: t1.id, userId })).rejects.toThrow(
        /Only the latest clip that failed/,
      );
    });

    it("a final, a new draft and a retry need the price the user saw; the worker spends no more", async () => {
      const { PriceChangedError } = await import("../../src/server/generation");
      const { InsufficientCreditsError } = await import("../../src/server/billing");
      const { userId, projectId } = await setup(400, [SHOTS[0] as (typeof SHOTS)[number]]);
      const [l1] = await lineages(projectId);
      if (!l1) throw new Error("blocks missing");
      await prepareAndApprove(projectId, userId);

      // The drafts: the batch total, stored per draft as what the worker may spend on it.
      await expect(
        production.startDrafts({ projectId, userId, expectedCredits: undefined as never }),
      ).rejects.toThrow(/Confirm the price/);
      await expect(
        production.startDrafts({ projectId, userId, expectedCredits: 19 }),
      ).rejects.toBeInstanceOf(production.PriceChangedError);
      await production.startDrafts({ projectId, userId, expectedCredits: 20 });
      const d1 = await takeRow(await latestTakeId(l1, userId));
      expect(d1.confirmedCredits).toBe(20);
      await drain(projectId);

      // Accepting a draft makes a final: the final's price (60).
      const draft = await takeRow(await latestTakeId(l1, userId));
      expect(draft.status).toBe("in_review");
      const accept = (expectedCredits: number | undefined) =>
        production.submitTakeReview({
          takeId: draft.id,
          userId,
          decision: "accepted",
          expectedCredits,
        });
      await expect(accept(undefined)).rejects.toBeInstanceOf(PriceChangedError);
      await expect(accept(20)).rejects.toBeInstanceOf(PriceChangedError);
      expect((await takeRow(draft.id)).status).toBe("in_review");
      const balance = await billing.getBalance(userId);
      await getDb()
        .update(s.creditBalance)
        .set({ balance: 10 })
        .where(eq(s.creditBalance.userId, userId));
      await expect(accept(60)).rejects.toBeInstanceOf(InsufficientCreditsError);
      expect((await takeRow(draft.id)).status).toBe("in_review");
      await getDb()
        .update(s.creditBalance)
        .set({ balance })
        .where(eq(s.creditBalance.userId, userId));
      expect(await accept(60)).toBe("final_generating");
      const final = await takeRow(await latestTakeId(l1, userId));
      expect(final).toMatchObject({ stage: "final", confirmedCredits: 60 });

      // The worker never spends above what was confirmed: a lower confirmed price fails the take
      // with nothing reserved.
      await getDb()
        .update(s.blockTake)
        .set({ confirmedCredits: 59 })
        .where(eq(s.blockTake.id, final.id));
      const before = await billing.getBalance(userId);
      await drain(projectId);
      const refused = await takeRow(final.id);
      expect(refused).toMatchObject({ status: "failed", generationId: null });
      expect(refused.failure).toMatch(/price changed/);
      expect(await billing.getBalance(userId)).toBe(before);

      // Trying it again is a new spend (the final's price).
      const retryFinal = (expectedCredits: number | undefined) =>
        production.retryTake({ takeId: final.id, userId, expectedCredits });
      await expect(retryFinal(undefined)).rejects.toBeInstanceOf(PriceChangedError);
      await expect(retryFinal(20)).rejects.toBeInstanceOf(PriceChangedError);
      expect(await retryFinal(60)).toBe("final_generating");
      expect((await takeRow(final.id)).confirmedCredits).toBe(60);
      await drain(projectId);
      const done = await takeRow(final.id);
      expect(done.status).toBe("in_review");

      // A final is accepted for nothing: no price needed.
      expect(
        await production.submitTakeReview({
          takeId: final.id,
          userId,
          decision: "accepted",
          expectedCredits: undefined,
        }),
      ).toBe("done");
    });

    it("rejecting a draft needs the draft's price and stores it on the new draft", async () => {
      const { PriceChangedError } = await import("../../src/server/generation");
      const { userId, projectId } = await setup(200, [SHOTS[0] as (typeof SHOTS)[number]]);
      const [l1] = await lineages(projectId);
      if (!l1) throw new Error("blocks missing");
      await prepareAndApprove(projectId, userId);
      await startAllDrafts(projectId, userId);
      const draft = await takeRow(await latestTakeId(l1, userId));
      const reject = (expectedCredits: number | undefined) =>
        production.submitTakeReview({
          takeId: draft.id,
          userId,
          decision: "rejected",
          note: "More wind",
          expectedCredits,
        });
      // "Don't ask again" only hides the dialog: the server checks the price all the same.
      await billing.setSkipCreditConfirm(userId, true);
      await expect(reject(undefined)).rejects.toBeInstanceOf(PriceChangedError);
      await expect(reject(60)).rejects.toBeInstanceOf(PriceChangedError);
      expect((await takeRow(draft.id)).status).toBe("in_review");
      expect(await reject(20)).toBe("draft_generating");
      const next = await takeRow(await latestTakeId(l1, userId));
      expect(next).toMatchObject({ stage: "draft", confirmedCredits: 20 });

      // The quotes: what each decision would cost.
      await drain(projectId);
      const again = await takeRow(next.id);
      expect(
        await production.quoteTakeSpend({ takeId: again.id, userId, action: "accept" }),
      ).toMatchObject({ spends: true, credits: 60 });
      expect(
        await production.quoteTakeSpend({ takeId: again.id, userId, action: "reject" }),
      ).toMatchObject({ spends: true, credits: 20 });
      const stranger = await fixtures.newUser();
      expect(
        await production.quoteTakeSpend({ takeId: again.id, userId: stranger, action: "reject" }),
      ).toBeNull();
    });

    it("isolates projects by owner", async () => {
      const { userId, projectId } = await setup(100);
      const [l1] = await lineages(projectId);
      if (!l1) throw new Error("blocks missing");
      await prepareAndApprove(projectId, userId);
      await startAllDrafts(projectId, userId);
      const takeId = await latestTakeId(l1, userId);
      const stranger = await fixtures.newUser();

      expect(await production.getProductionOverview(projectId, stranger)).toBeNull();
      expect(await production.listProductionBlocks(projectId, stranger)).toBeNull();
      expect(await production.getBlockDetail(l1, stranger)).toBeNull();
      expect(await production.quoteProduction(projectId, stranger)).toBeNull();
      expect(await production.approveAllBlocks({ projectId, userId: stranger })).toBe(0);
      expect(
        await production.submitBlockReview({
          lineageId: l1,
          userId: stranger,
          decision: "accepted",
        }),
      ).toBeNull();
      expect(
        await production.setBlockAssets({ lineageId: l1, userId: stranger, assetIds: [] }),
      ).toBeNull();
      expect(
        await production.submitTakeReview({ takeId, userId: stranger, decision: "accepted" }),
      ).toBeNull();
      expect(await production.retryTake({ takeId, userId: stranger })).toBeNull();
      expect(await production.retryPreparation({ lineageId: l1, userId: stranger })).toBeNull();
      await expect(
        production.startDrafts({ projectId, userId: stranger, expectedCredits: 0 }),
      ).rejects.toThrow(/not found/);
      expect(await production.listFinishedClips(projectId, stranger)).toBeNull();
      expect(await production.getClipDownloadUrl({ lineageId: l1, userId: stranger })).toBeNull();
      expect(await production.requestExport({ projectId, userId: stranger })).toBeNull();
      expect(await production.completeProduction({ projectId, userId: stranger })).toBe(false);
      await production.ensurePrepared(projectId, stranger); // no-op
      expect((await takeRow(takeId)).status).toBe("in_review");

      // Stage filter and pagination of the owner's list.
      const page = await production.listProductionBlocks(projectId, userId, {
        limit: 2,
        stage: ["draft_review"],
      });
      expect(page?.items).toHaveLength(2);
      const next = await production.listProductionBlocks(projectId, userId, {
        limit: 2,
        stage: ["draft_review"],
        cursor: page?.nextCursor,
      });
      expect(next?.items).toHaveLength(1);
      expect(next?.nextCursor).toBeNull();
    });

    it("a script edit sends changed blocks back to preparation and keeps unchanged finals", async () => {
      const { userId, projectId, scriptVersionId } = await setup(1000);
      const [l1, l2, l3] = await lineages(projectId);
      if (!l1 || !l2 || !l3) throw new Error("blocks missing");
      await prepareAndApprove(projectId, userId);
      await startAllDrafts(projectId, userId);
      await production.submitTakeReview({
        takeId: await latestTakeId(l1, userId),
        userId,
        decision: "accepted",
      });
      await drain(projectId);
      const final1 = await latestTakeId(l1, userId);
      await production.submitTakeReview({ takeId: final1, userId, decision: "accepted" });
      const draft2 = await latestTakeId(l2, userId);

      // The script changes: every block is stale until it is cut again.
      await blocks.markBlocksStale({ projectId, reason: "The script changed (version 2)." });
      expect(await production.getProductionOverview(projectId, userId)).toMatchObject({
        phase: "preparing",
        counts: { preparing: 3 },
      });
      expect((await detail(l2, userId)).failure).toMatch(/script changed/);
      await expect(
        production.submitTakeReview({ takeId: draft2, userId, decision: "accepted" }),
      ).rejects.toThrow(/script changed/);
      await expect(production.approveAllBlocks({ projectId, userId })).resolves.toBe(0);

      // New blocks: the first unchanged, the second rewritten, the third dropped, a new fourth.
      await fixtures.setBlocks(projectId, scriptVersionId, [
        SHOTS[0] as (typeof SHOTS)[number],
        {
          ...(SHOTS[1] as (typeof SHOTS)[number]),
          prompt: "Tomas [character:Tomas] trims the wick.",
          assetRefs: ["character:Tomas"],
        },
        {
          excerpt: "Dawn over the rocks.",
          prompt: "Dawn light over the rocks below the Lighthouse [location:Lighthouse].",
          assetRefs: ["location:Lighthouse"],
          title: "Dawn",
        },
      ]);
      const [n1, n2, n4] = await lineages(projectId);
      expect(n1).toBe(l1);
      expect(n2).toBe(l2);
      expect(n4).not.toBe(l3);
      expect((await detail(l1, userId)).stage).toBe("done");
      expect((await detail(l2, userId)).stage).toBe("preparing");
      await expect(production.completeProduction({ projectId, userId })).rejects.toThrow(
        /2 shots are not final yet/,
      );

      await production.ensurePrepared(projectId, userId);
      expect((await takeRow(draft2)).status).toBe("superseded");
      expect((await takeRow(final1)).status).toBe("accepted");
      const dropped = await getDb()
        .select({ status: s.blockTake.status })
        .from(s.blockTake)
        .where(eq(s.blockTake.lineageId, l3));
      expect(dropped.map((t) => t.status)).toEqual(["superseded"]);
      await drain(projectId);
      expect((await detail(l2, userId)).stage).toBe("block_review");
      expect((await detail(n4 ?? "", userId)).stage).toBe("block_review");
      expect((await detail(l2, userId)).posterFileId).toBeNull();
      expect(await production.getProductionOverview(projectId, userId)).toMatchObject({
        phase: "block_review",
        counts: { done: 1, block_review: 2 },
      });
    });

    it("a failed preparation is retried, and an asset that is no longer ready stops a draft", async () => {
      const { userId, projectId, tomas } = await setup(100, [SHOTS[0] as (typeof SHOTS)[number]]);
      const [l1] = await lineages(projectId);
      if (!l1) throw new Error("blocks missing");
      await production.ensurePrepared(projectId, userId);
      const [pending] = await getDb()
        .select({ id: s.promptBlock.id })
        .from(s.promptBlock)
        .where(and(eq(s.promptBlock.lineageId, l1), isNull(s.promptBlock.supersededAt)));
      await production.failPreparation(pending?.id ?? "", "Claude is busy right now.");
      expect((await detail(l1, userId)).stage).toBe("prepare_failed");
      expect((await detail(l1, userId)).failure).toBe("Claude is busy right now.");
      expect(await production.retryPreparation({ lineageId: l1, userId })).toBe("preparing");
      await drain(projectId);
      expect(await production.approveAllBlocks({ projectId, userId })).toBe(1);

      // Tomas's sheet is sent back in pre-production: no longer ready.
      await getDb()
        .update(s.assetSheet)
        .set({ status: "rejected" })
        .where(eq(s.assetSheet.assetId, tomas.assetId));
      await startAllDrafts(projectId, userId);
      const take = await takeRow(await latestTakeId(l1, userId));
      expect(take.status).toBe("failed");
      expect(take.failure).toMatch(/“Tomas” is not ready in Pre-production any more/);
      expect(await billing.getBalance(userId)).toBe(100);
    });

    /* -------------------------------------------------------------------------------------- */
    /* Jobs on the transaction, fan-out, filters and cursors                                   */
    /* -------------------------------------------------------------------------------------- */

    /** Jobs of a type queued for a row, read from the throwaway queue schema. */
    async function queued(name: string, key: string, value: string): Promise<number> {
      const result = await getDb().execute<{ n: number }>(
        sql`select count(*)::int as n from ${sql.raw(jobSchema)}.job
            where name = ${name} and data->>${key} = ${value}`,
      );
      return Number(result.rows[0]?.n ?? 0);
    }

    /** Fan-out jobs of one kind queued for a project. */
    async function dispatches(projectId: string, kind: "prepare" | "takes"): Promise<number> {
      const result = await getDb().execute<{ n: number }>(
        sql`select count(*)::int as n from ${sql.raw(jobSchema)}.job
            where name = 'production.dispatch' and data->>'projectId' = ${projectId}
              and data->>'kind' = ${kind}`,
      );
      return Number(result.rows[0]?.n ?? 0);
    }

    /** Jobs of a type queued for the blocks of a project. */
    async function queuedForBlocks(name: string, projectId: string): Promise<number> {
      const result = await getDb().execute<{ n: number }>(
        sql`select count(*)::int as n from ${sql.raw(jobSchema)}.job j
            join prompt_block b on b.id = (j.data->>'blockId')::uuid
            where j.name = ${name} and b.project_id = ${projectId}`,
      );
      return Number(result.rows[0]?.n ?? 0);
    }

    it("claims blocks with one fan-out job on the claim, which queues each block's job once", async () => {
      const { userId, projectId } = await setup(1000);
      const [l1] = await lineages(projectId);
      if (!l1) throw new Error("blocks missing");
      // A page rendered twice: one claim, one fan-out job, no per-block job sent by the request.
      await production.ensurePrepared(projectId, userId);
      await production.ensurePrepared(projectId, userId);
      expect(await dispatches(projectId, "prepare")).toBe(1);
      expect(await queuedForBlocks("production.prepare", projectId)).toBe(0);
      expect((await production.getProductionOverview(projectId, userId))?.phase).toBe("preparing");

      // The fan-out queues one preparation per pending block; running it again adds nothing.
      await productionDispatchHandler.run({ projectId, kind: "prepare" }, jobContext());
      await productionDispatchHandler.run({ projectId, kind: "prepare" }, jobContext());
      expect(await queuedForBlocks("production.prepare", projectId)).toBe(3);

      await drain(projectId);
    });

    it("a rejected directed block's revision job is sent on the review and the fan-out picks it too", async () => {
      const { userId, projectId, scriptVersionId } = await setupDirected(1000);
      const [l1] = await lineages(projectId);
      if (!l1) throw new Error("blocks missing");
      await production.ensurePrepared(projectId, userId);
      await drain(projectId);
      await production.submitBlockReview({
        lineageId: l1,
        userId,
        decision: "rejected",
        note: "Wrong camera angle.",
      });
      expect(scriptVersionId).toBeTruthy();
      expect(await queuedForBlocks("block.revise", projectId)).toBe(1);
      expect(await production.dispatchProductionJobs(projectId, "prepare")).toBe(1);
      expect(await queuedForBlocks("block.revise", projectId)).toBe(1);
    });

    it("a 30 second block is prepared by code and generated at 30 seconds", async () => {
      const { userId, projectId } = await setup(1000, [
        { ...SHOTS[0]!, durationSeconds: 30 },
        { ...SHOTS[1]!, durationSeconds: 15 },
      ]);
      const [l1, l2] = await lineages(projectId);
      if (!l1 || !l2) throw new Error("blocks missing");
      await prepareAndApprove(projectId, userId);
      await startAllDrafts(projectId, userId);
      const takes = await getDb()
        .select()
        .from(s.blockTake)
        .where(eq(s.blockTake.projectId, projectId));
      const byLineage = new Map(takes.map((t) => [t.lineageId, t]));
      const long = byLineage.get(l1);
      const short = byLineage.get(l2);
      if (!long?.generationId || !short?.generationId) throw new Error("takes not generated");
      expect((await generationRow(long.generationId)).params).toMatchObject({
        durationSeconds: 30,
      });
      expect((await generationRow(short.generationId)).params).toMatchObject({
        durationSeconds: 15,
      });
      expect(long.failure).toBeNull();
      expect(long.status).toBe("in_review");
      expect(long.fileId).not.toBeNull();
    }, 120_000);

    it("starts drafts in one batch with one fan-out job, numbering after earlier takes", async () => {
      const { userId, projectId } = await setup(1000);
      const [l1, l2, l3] = await lineages(projectId);
      if (!l1 || !l2 || !l3) throw new Error("blocks missing");
      await prepareAndApprove(projectId, userId);
      const quote = await production.quoteProduction(projectId, userId);
      const wrong = production.startDrafts({ projectId, userId, expectedCredits: 1 });
      await expect(wrong).rejects.toBeInstanceOf(production.PriceChangedError);
      await expect(wrong).rejects.toBeInstanceOf(production.ProductionInputError);
      await expect(wrong).rejects.toThrow(production.PRICE_CHANGED_MESSAGE);

      // An old (superseded) take on the first lineage: the new draft is numbered after it.
      const [block1] = await getDb()
        .select({ id: s.promptBlock.id })
        .from(s.promptBlock)
        .where(and(eq(s.promptBlock.lineageId, l1), isNull(s.promptBlock.supersededAt)));
      await getDb()
        .insert(s.blockTake)
        .values({
          projectId,
          blockId: block1?.id ?? "",
          lineageId: l1,
          takeNumber: 1,
          stage: "draft",
          status: "superseded",
        });

      expect(
        await production.startDrafts({
          projectId,
          userId,
          expectedCredits: quote?.drafts.credits ?? -1,
        }),
      ).toEqual({ started: 3 });
      const takes = await getDb()
        .select()
        .from(s.blockTake)
        .where(and(eq(s.blockTake.projectId, projectId), eq(s.blockTake.status, "pending")));
      expect(new Map(takes.map((t) => [t.lineageId, t.takeNumber]))).toEqual(
        new Map([
          [l1, 2],
          [l2, 1],
          [l3, 1],
        ]),
      );
      expect(takes.every((t) => t.prompt !== null && t.stage === "draft")).toBe(true);
      expect(await dispatches(projectId, "takes")).toBe(1);
      expect(await production.dispatchProductionJobs(projectId, "takes")).toBe(3);
      for (const take of takes) expect(await queued("take.generate", "takeId", take.id)).toBe(1);
      expect(await production.dispatchProductionJobs(projectId, "takes")).toBe(3);
      for (const take of takes) expect(await queued("take.generate", "takeId", take.id)).toBe(1);
      await drain(projectId);
      const overview = await production.getProductionOverview(projectId, userId);
      expect(overview?.counts.draft_review).toBe(3);
    });

    it("filters blocks by stage in the database, matching the derived stage, with cursors", async () => {
      const { userId, projectId } = await setup(1000);
      const [l1, l2, l3] = await lineages(projectId);
      if (!l1 || !l2 || !l3) throw new Error("blocks missing");
      await production.ensurePrepared(projectId, userId);
      await drain(projectId);
      await production.submitBlockReview({ lineageId: l2, userId, decision: "accepted" });
      const all = await production.listProductionBlocks(projectId, userId, { limit: 50 });
      expect(all?.items.map((b) => b.stage)).toEqual(["block_review", "approved", "block_review"]);
      for (const stage of production.BLOCK_PRODUCTION_STAGES) {
        const page = await production.listProductionBlocks(projectId, userId, { stage: [stage] });
        expect(page?.items.map((b) => b.lineageId)).toEqual(
          all?.items.filter((b) => b.stage === stage).map((b) => b.lineageId),
        );
      }
      // Paged through a filter: one match per page, then the end.
      const first = await production.listProductionBlocks(projectId, userId, {
        stage: ["block_review"],
        limit: 1,
      });
      expect(first?.items.map((b) => b.lineageId)).toEqual([l1]);
      const second = await production.listProductionBlocks(projectId, userId, {
        stage: ["block_review"],
        limit: 1,
        cursor: first?.nextCursor,
      });
      expect(second?.items.map((b) => b.lineageId)).toEqual([l3]);
      expect(second?.nextCursor).toBeNull();

      // Takes count: drafts in review, then one accepted (its final generating).
      await production.approveAllBlocks({ projectId, userId });
      await startAllDrafts(projectId, userId);
      const filtered = async (stage: (typeof production.BLOCK_PRODUCTION_STAGES)[number]) =>
        (await production.listProductionBlocks(projectId, userId, { stage: [stage] }))?.items.map(
          (b) => b.lineageId,
        );
      expect(await filtered("draft_review")).toEqual([l1, l2, l3]);
      await production.submitTakeReview({
        takeId: await latestTakeId(l1, userId),
        userId,
        decision: "accepted",
      });
      expect(await filtered("final_generating")).toEqual([l1]);
      expect(await filtered("draft_review")).toEqual([l2, l3]);

      // Forged cursors are input errors, not database errors.
      const forged = (text: string) => Buffer.from(text, "utf8").toString("base64url");
      for (const cursor of [forged(`1e300|${l1}`), forged(`99999999999|${l1}`), "%%%"]) {
        await expect(
          production.listProductionBlocks(projectId, userId, { cursor }),
        ).rejects.toBeInstanceOf(production.ProductionInputError);
        await expect(
          production.listFinishedClips(projectId, userId, { cursor }),
        ).rejects.toBeInstanceOf(production.ProductionInputError);
        await expect(blocks.listBlocks(projectId, userId, { cursor })).rejects.toBeInstanceOf(
          blocks.BlocksInputError,
        );
      }
    });

    /* -------------------------------------------------------------------------------------- */
    /* A finished film and a script edit                                                       */
    /* -------------------------------------------------------------------------------------- */

    async function projectStage(projectId: string): Promise<string> {
      const [row] = await getDb()
        .select({ stage: s.project.stage })
        .from(s.project)
        .where(eq(s.project.id, projectId));
      return row?.stage ?? "";
    }

    /** Accepts every draft and final waiting for review until every shot is done. */
    async function acceptEverything(projectId: string, userId: string) {
      for (let round = 0; round < 4; round++) {
        await drain(projectId);
        for (const lineageId of await lineages(projectId)) {
          const d = await detail(lineageId, userId);
          if (d.stage === "draft_review" || d.stage === "final_review") {
            await production.submitTakeReview({
              takeId: await latestTakeId(lineageId, userId),
              userId,
              decision: "accepted",
            });
          }
        }
      }
      await drain(projectId);
    }

    async function finishFilm(projectId: string, userId: string) {
      await prepareAndApprove(projectId, userId);
      await startAllDrafts(projectId, userId);
      await acceptEverything(projectId, userId);
      expect(await production.completeProduction({ projectId, userId })).toBe(true);
      expect(await projectStage(projectId)).toBe("done");
    }

    /** A new accepted script version, as an edit makes. */
    async function newScriptVersion(projectId: string, userId: string, versionNumber: number) {
      const [row] = await getDb()
        .insert(s.scriptVersion)
        .values({
          projectId,
          versionNumber,
          source: "edited",
          status: "accepted",
          content: "INT. LIGHTHOUSE - NIGHT\nTOMAS lights the old lamp.",
          createdBy: userId,
          decidedAt: new Date(),
        })
        .returning({ id: s.scriptVersion.id });
      if (!row) throw new Error("insert failed");
      return row.id;
    }

    const EDITED_LAMP = {
      ...(SHOTS[1] as (typeof SHOTS)[number]),
      excerpt: "TOMAS lights the old lamp.",
      prompt: "Tomas [character:Tomas] lights the old Lamp [prop:Lamp] at the top of the tower.",
    };

    it("a script edit reopens a finished film, keeps unchanged finals, and it finishes again", async () => {
      const { userId, projectId, tomas, lamp } = await setup(2000);
      const [l1, l2, l3] = await lineages(projectId);
      if (!l1 || !l2 || !l3) throw new Error("blocks missing");
      // The user's own choice of assets on the first shot, which the edit does not touch.
      await production.ensurePrepared(projectId, userId);
      await drain(projectId);
      await production.setBlockAssets({
        lineageId: l1,
        userId,
        assetIds: [tomas.assetId, lamp.assetId],
      });
      await finishFilm(projectId, userId);
      const finalOf1 = await latestTakeId(l1, userId);
      const [lampBefore] = await getDb()
        .select({ versionNumber: s.promptBlock.versionNumber })
        .from(s.promptBlock)
        .where(and(eq(s.promptBlock.lineageId, l2), isNull(s.promptBlock.supersededAt)));

      // The edit: one dialogue line of the second shot changes. Detection marks the blocks stale,
      // then sectioning cuts them again and reopens the film (what script.section does).
      await blocks.markBlocksStale({ projectId, reason: "The script changed (version 2)." });
      expect(await production.reopenProductionAfterScriptEdit(projectId)).toBe(false); // stale
      expect((await production.ensurePrepared(projectId, userId)).reopened).toBe(false);
      expect(await projectStage(projectId)).toBe("done");
      const v2 = await newScriptVersion(projectId, userId, 2);
      const replaced = await blocks.replaceBlocks({
        projectId,
        scriptVersionId: v2,
        damiRunIds: [],
        blocks: [
          SHOTS[0] as (typeof SHOTS)[number],
          EDITED_LAMP,
          SHOTS[2] as (typeof SHOTS)[number],
        ].map((spec, i) => ({
          title: spec.title,
          scriptExcerpt: spec.excerpt,
          prompt: spec.prompt,
          durationSeconds: 1,
          assetRefs: spec.assetRefs,
          orderIndex: i,
          startLine: i + 1,
          endLine: i + 1,
          start: i * 10,
          end: i * 10 + 9,
        })),
      });
      expect(replaced).toMatchObject({ carried: 3, created: 0, reset: 1 });
      expect(await production.reopenProductionAfterScriptEdit(projectId)).toBe(true);
      expect(await production.reopenProductionAfterScriptEdit(projectId)).toBe(false);
      expect(await projectStage(projectId)).toBe("production");
      expect(await events(projectId)).toContain("stage.reopened");

      // The edited shot continues its lineage with the next version; the others are untouched.
      expect(await lineages(projectId)).toEqual([l1, l2, l3]);
      const [lampAfter] = await getDb()
        .select({ versionNumber: s.promptBlock.versionNumber })
        .from(s.promptBlock)
        .where(and(eq(s.promptBlock.lineageId, l2), isNull(s.promptBlock.supersededAt)));
      expect(lampAfter?.versionNumber).toBe((lampBefore?.versionNumber ?? 0) + 1);
      const shot1 = await detail(l1, userId);
      expect(shot1.stage).toBe("done");
      expect(shot1.assets.map((a) => a.ref).sort()).toEqual([tomas.ref, lamp.ref].sort());
      expect(shot1.scriptChanged).toBe(false);
      expect((await detail(l2, userId)).stage).toBe("preparing");
      expect((await detail(l2, userId)).scriptChanged).toBe(true);
      expect((await detail(l3, userId)).stage).toBe("done");

      // The unchanged finals stay watchable and downloadable; the whole film waits.
      const clips = await production.listFinishedClips(projectId, userId);
      expect(clips?.items.map((c) => c.lineageId)).toEqual([l1, l3]);
      expect(clips?.items[0]?.downloadName).toBe("script-it_B001_the-climb.mp4");
      expect(await production.getClipDownloadUrl({ lineageId: l1, userId })).toContain("http");
      await expect(production.requestExport({ projectId, userId })).rejects.toThrow(
        /1 shot is not final yet/,
      );
      expect(await production.getProductionOverview(projectId, userId)).toMatchObject({
        projectStage: "production",
        phase: "preparing",
      });

      // Entering Production prepares the changed shot; it is made again and the film finishes.
      await production.ensurePrepared(projectId, userId);
      await drain(projectId);
      expect((await detail(l2, userId)).stage).toBe("block_review");
      expect((await detail(l2, userId)).scriptChanged).toBe(true);
      expect(await production.approveAllBlocks({ projectId, userId })).toBe(1);
      expect((await detail(l2, userId)).scriptChanged).toBe(false);
      expect(await startAllDrafts(projectId, userId)).toEqual({ started: 1 });
      await acceptEverything(projectId, userId);
      expect(await latestTakeId(l1, userId)).toBe(finalOf1);
      expect(await production.completeProduction({ projectId, userId })).toBe(true);
      expect(await projectStage(projectId)).toBe("done");
      expect((await production.listFinishedClips(projectId, userId))?.items).toHaveLength(3);
    });

    it("heals a finished film stranded with shots that are not final", async () => {
      const { userId, projectId, scriptVersionId } = await setup(2000);
      const [l1, l2] = await lineages(projectId);
      if (!l1 || !l2) throw new Error("blocks missing");
      await prepareAndApprove(projectId, userId);
      await startAllDrafts(projectId, userId);
      // The second shot's first draft is rejected, so its lineage keeps a rejected take.
      await production.submitTakeReview({
        takeId: await latestTakeId(l2, userId),
        userId,
        decision: "rejected",
        note: "The action is wrong.",
      });
      await acceptEverything(projectId, userId);
      expect(await production.completeProduction({ projectId, userId })).toBe(true);

      // An edit handled before the fix: the shots were cut again, but the film stayed done.
      await blocks.markBlocksStale({ projectId, reason: "The script changed (version 2)." });
      await fixtures.setBlocks(projectId, scriptVersionId, [
        SHOTS[0] as (typeof SHOTS)[number],
        EDITED_LAMP,
        SHOTS[2] as (typeof SHOTS)[number],
      ]);
      expect(await projectStage(projectId)).toBe("done");
      expect(await production.getProductionOverview(projectId, userId)).toMatchObject({
        projectStage: "done",
        phase: "preparing",
      });

      // Entering Production reopens it (once) and prepares the reset shot.
      expect(await production.ensurePrepared(projectId, userId)).toEqual({ reopened: true });
      expect(await production.ensurePrepared(projectId, userId)).toEqual({ reopened: false });
      expect(await projectStage(projectId)).toBe("production");
      await drain(projectId);
      // The old rejected draft belongs to the old version: the shot is back in shot review.
      expect((await detail(l2, userId)).stage).toBe("block_review");
      expect((await detail(l1, userId)).stage).toBe("done");
      await production.approveAllBlocks({ projectId, userId });
      await startAllDrafts(projectId, userId);
      await acceptEverything(projectId, userId);
      expect(await production.completeProduction({ projectId, userId })).toBe(true);
    });
  },
);

function randomId(): string {
  return crypto.randomUUID();
}
