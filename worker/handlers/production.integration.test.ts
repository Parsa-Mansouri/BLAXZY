/**
 * Production end to end against the local Postgres and S3 store, in sample mode (damis answer at
 * once, the sample provider renders real MP4s with ffmpeg): the services, the production job
 * handlers, the generation handler and the export handler run directly, with the completion hook
 * registered as the worker does. Follow-up jobs go to a throwaway queue schema. Skipped when a
 * service or ffmpeg is unavailable.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ffmpegAvailable } from "../../src/server/providers/ffmpeg";
import { servicesReachable } from "../../src/server/test-support/generation-fixtures";
import {
  dropSchema,
  jobContext,
  pointQueueAtThrowawaySchema,
} from "../../src/server/test-support/script-fixtures";

const jobSchema = pointQueueAtThrowawaySchema();
const reachable = await servicesReachable();
const hasFfmpeg = reachable && (await ffmpegAvailable());
if (reachable && !hasFfmpeg) {
  console.warn("ffmpeg is not available: Production integration tests skipped");
}

describe.skipIf(!hasFfmpeg)(
  "production (integration, sample mode)",
  { timeout: 120_000 },
  async () => {
    const { unzipSync } = await import("fflate");
    const production = await import("../../src/server/production");
    const billing = await import("../../src/server/billing");
    const blocks = await import("../../src/server/blocks");
    const gen = await import("../../src/server/generation");
    const storage = await import("../../src/server/storage");
    const { closeJobQueue } = await import("../../src/server/jobs");
    const { closeDb, getDb } = await import("../../src/server/db/client");
    const s = await import("../../src/server/db/schema");
    const { and, asc, eq, inArray, isNull } = await import("drizzle-orm");
    const { generationRunHandler } = await import("./generation-run");
    const { blockReviseHandler, productionPrepareHandler } = await import("./production-prepare");
    const { takeFixHandler, takeGenerateHandler } = await import("./production-take");
    const { exportBuildHandler } = await import("./production-export");
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
          "SCENE: Lighthouse [location:lighthouse].\nTomas [character:tomas] climbs the stairs.",
        assetRefs: ["location:lighthouse", "character:tomas"],
        title: "The climb",
      },
      {
        excerpt: "TOMAS lights the lamp.",
        prompt: "Tomas [character:tomas] lights the Lamp [prop:lamp] at the top of the tower.",
        assetRefs: ["character:tomas", "prop:lamp"],
        title: "The lamp",
      },
      {
        excerpt: "The beam sweeps the sea.",
        prompt: "SCENE: Lighthouse [location:lighthouse]. The beam sweeps the dark sea.",
        assetRefs: ["location:lighthouse"],
        title: "Beam, sea",
      },
    ];

    async function setup(credits: number, shots = SHOTS) {
      const userId = await fixtures.newUser();
      const { projectId, scriptVersionId } = await fixtures.newProductionProject(userId);
      if (credits > 0) await billing.grantCredits({ userId, amount: credits });
      const tomas = await fixtures.readyAsset(projectId, userId, "character", "tomas", "Tomas");
      const lighthouse = await fixtures.readyAsset(
        projectId,
        userId,
        "location",
        "lighthouse",
        "Lighthouse",
      );
      const lamp = await fixtures.readyAsset(projectId, userId, "prop", "lamp", "Lamp");
      await fixtures.setBlocks(projectId, scriptVersionId, shots);
      return { userId, projectId, scriptVersionId, tomas, lighthouse, lamp };
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

      // Preparation: one text-blocks run per block; a second call starts nothing new.
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
      expect(d1.assets.map((a) => a.ref)).toEqual(["location:lighthouse", "character:tomas"]);
      expect(d1.assets[0]?.thumbnailFileId).toBe(lighthouse.sheetFileId);
      const d2 = await detail(l2, userId);
      expect(d2.prompt).toContain("CONTINUITY"); // the previous block's tail
      const prepareRuns = await getDb()
        .select({ key: s.damiRun.damiKey })
        .from(s.damiRun)
        .where(eq(s.damiRun.projectId, projectId));
      expect(prepareRuns.filter((r) => r.key === "text-blocks")).toHaveLength(3);

      // Block review: reject the first with a code → a revised version.
      await expect(
        production.submitBlockReview({ lineageId: l1, userId, decision: "rejected" }),
      ).rejects.toThrow(production.ProductionInputError);
      expect(
        await production.submitBlockReview({
          lineageId: l1,
          userId,
          decision: "rejected",
          issueCodes: ["wrong_camera"],
          note: "Closer on his hands.",
        }),
      ).toBe("preparing");
      const [blockReview] = await getDb()
        .select()
        .from(s.review)
        .where(eq(s.review.subjectId, d1.id));
      expect(blockReview).toMatchObject({
        subjectType: "prompt_block",
        decision: "rejected",
        issueCodes: ["wrong_camera"],
      });
      const [prepared1] = await getDb()
        .select({ run: s.promptBlock.productionDamiRunId })
        .from(s.promptBlock)
        .where(eq(s.promptBlock.id, d1.id));
      expect(blockReview?.damiRunId).toBe(prepared1?.run);
      await drain(projectId);
      const revised = await detail(l1, userId);
      expect(revised.id).not.toBe(d1.id);
      expect(revised.stage).toBe("block_review");
      expect(revised.prompt).toContain("REVISED");
      expect(revised.notes.length).toBeGreaterThan(0);

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
      expect(d3.assets.map((a) => a.ref)).toEqual(["location:lighthouse", "prop:lamp"]);
      expect(d3.prompt).toContain("<<<image_2>>>");

      // Approve all; the completion gate is closed.
      expect(await production.approveAllBlocks({ projectId, userId })).toBe(3);
      await expect(production.completeProduction({ projectId, userId })).rejects.toThrow(
        /0 of 3 are done/,
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
      expect(draft1.referenceFileIds).toEqual([lighthouse.sheetFileId, tomas.sheetFileId]);
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

      // Reject the first draft with codes → a fixed draft (take-fixer).
      expect(
        await production.submitTakeReview({
          takeId: draft1.id,
          userId,
          decision: "rejected",
          issueCodes: ["face_distorted", "too_static"],
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
        issueCodes: ["face_distorted", "too_static"],
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
          issueCodes: ["flicker"],
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
        "script-it_E01_B001_the-climb.mp4",
        "script-it_E01_B002_the-lamp.mp4",
      ]);
      const rest = await production.listFinishedClips(projectId, userId, {
        cursor: clips?.nextCursor,
      });
      expect(rest?.items.map((c) => c.downloadName)).toEqual(["script-it_E01_B003_beam-sea.mp4"]);
      expect(rest?.nextCursor).toBeNull();
      const url = await production.getClipDownloadUrl({ lineageId: l1, userId });
      expect(url).toContain("response-content-disposition");
      expect(decodeURIComponent(url ?? "")).toContain("script-it_E01_B001_the-climb.mp4");

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
      expect(lines[0]).toBe("order,episode,title,duration_seconds,file_name,script_excerpt");
      expect(lines[1]).toBe(
        "1,1,The climb,1,script-it_E01_B001_the-climb.mp4,TOMAS climbs the stairs of the lighthouse.",
      );
      expect(lines[3]).toBe(
        '3,1,"Beam, sea",1,script-it_E01_B003_beam-sea.mp4,The beam sweeps the sea.',
      );
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
        "production.block_rejected",
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
      expect(await billing.getBalance(userId)).toBe(115);
      await expect(production.retryTake({ takeId: t1.id, userId })).rejects.toThrow(
        /Only the latest clip that failed/,
      );
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
          prompt: "Tomas [character:tomas] trims the wick.",
          assetRefs: ["character:tomas"],
        },
        {
          excerpt: "Dawn over the rocks.",
          prompt: "Dawn light over the rocks below the Lighthouse [location:lighthouse].",
          assetRefs: ["location:lighthouse"],
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
        /1 of 3 are done/,
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
  },
);

function randomId(): string {
  return crypto.randomUUID();
}
