/**
 * Pre-production end to end against the local Postgres and S3 store, in sample mode (damis and
 * generations answer at once): the services, the four asset job handlers and the generation
 * handler run directly, with the completion hook registered as the worker does. Follow-up jobs go
 * to a throwaway queue schema. Skipped when a service is unreachable.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AssetKind } from "../../src/server/db/schema";
import { servicesReachable } from "../../src/server/test-support/generation-fixtures";
import {
  dropSchema,
  jobContext,
  pointQueueAtThrowawaySchema,
} from "../../src/server/test-support/script-fixtures";

const jobSchema = pointQueueAtThrowawaySchema();
const reachable = await servicesReachable();

describe.skipIf(!reachable)(
  "pre-production (integration, sample mode)",
  { timeout: 30_000 },
  async () => {
    const assets = await import("../../src/server/assets");
    const billing = await import("../../src/server/billing");
    const blocks = await import("../../src/server/blocks");
    const { onGenerationFinished } = await import("../../src/server/generation");
    const { closeJobQueue } = await import("../../src/server/jobs");
    const { closeDb, getDb } = await import("../../src/server/db/client");
    const s = await import("../../src/server/db/schema");
    const { and, eq } = await import("drizzle-orm");
    const { assetLookFixHandler, assetLookGenerateHandler } = await import("./asset-look");
    const { assetSheetFixHandler, assetSheetGenerateHandler } = await import("./asset-sheet");
    const { generationRunHandler } = await import("./generation-run");
    const { assetGenerationHook } = await import("./asset-generation-hook");
    const { createPreProductionFixtures } =
      await import("../../src/server/test-support/preprod-fixtures");
    const fixtures = createPreProductionFixtures();
    let unregister: () => void = () => undefined;

    beforeAll(() => {
      unregister = onGenerationFinished(assetGenerationHook);
    });

    afterAll(async () => {
      unregister();
      await fixtures.cleanup();
      await closeJobQueue();
      await dropSchema(jobSchema);
      await closeDb();
    });

    const lines = (i: number) => ({
      startLine: i + 1,
      endLine: i + 1,
      start: i * 10,
      end: i * 10 + 9,
    });

    /* -------------------------------------------------------------------------------------- */

    async function setup(credits = 200) {
      const userId = await fixtures.newUser();
      const projectId = await fixtures.newPreProductionProject(userId);
      if (credits > 0) await billing.grantCredits({ userId, amount: credits });
      return { userId, projectId };
    }

    async function add(
      projectId: string,
      userId: string,
      kind: AssetKind = "character",
      name = "Tomas",
    ) {
      const created = await assets.addAsset({
        projectId,
        userId,
        kind,
        name,
        description: "An old lighthouse keeper with a grey beard.",
      });
      if (!created) throw new Error("addAsset returned null");
      return created;
    }

    async function lookRow(lookId: string) {
      const [row] = await getDb().select().from(s.assetLook).where(eq(s.assetLook.id, lookId));
      if (!row) throw new Error("look missing");
      return row;
    }

    async function sheetRow(sheetId: string) {
      const [row] = await getDb().select().from(s.assetSheet).where(eq(s.assetSheet.id, sheetId));
      if (!row) throw new Error("sheet missing");
      return row;
    }

    async function generationRow(id: string) {
      const [row] = await getDb().select().from(s.generation).where(eq(s.generation.id, id));
      if (!row) throw new Error("generation missing");
      return row;
    }

    /** Runs a look's job (generate or fix) and then its generation. */
    async function produceLook(lookId: string) {
      const look = await lookRow(lookId);
      const handler = look.parentId ? assetLookFixHandler : assetLookGenerateHandler;
      await handler.run({ lookId }, jobContext());
      const after = await lookRow(lookId);
      if (after.generationId) {
        await generationRunHandler.run({ generationId: after.generationId }, jobContext());
      }
      return lookRow(lookId);
    }

    async function produceSheet(sheetId: string) {
      const sheet = await sheetRow(sheetId);
      const handler = sheet.parentId ? assetSheetFixHandler : assetSheetGenerateHandler;
      await handler.run({ sheetId }, jobContext());
      const after = await sheetRow(sheetId);
      if (after.generationId) {
        await generationRunHandler.run({ generationId: after.generationId }, jobContext());
      }
      return sheetRow(sheetId);
    }

    async function detail(assetId: string, userId: string) {
      const d = await assets.getAssetDetail(assetId, userId);
      if (!d) throw new Error("detail missing");
      return d;
    }

    async function reviewsOf(subjectId: string) {
      return getDb().select().from(s.review).where(eq(s.review.subjectId, subjectId));
    }

    async function events(projectId: string) {
      const rows = await getDb()
        .select({ type: s.projectEvent.type })
        .from(s.projectEvent)
        .where(eq(s.projectEvent.projectId, projectId));
      return rows.map((r) => r.type);
    }

    /* -------------------------------------------------------------------------------------- */

    it("prompt → look review → reject → fixed look → accept → sheet → reject → fix → ready", async () => {
      const { userId, projectId } = await setup(200);
      const tomas = await add(projectId, userId);
      expect((await detail(tomas.id, userId)).stage).toBe("needs_image");

      const look1 = await assets.startLookFromPrompt({
        assetId: tomas.id,
        userId,
        prompt: "A weathered keeper in a navy wool coat",
      });
      expect(look1).toMatchObject({ status: "pending", source: "generated", versionNumber: 1 });
      expect((await detail(tomas.id, userId)).stage).toBe("generating");
      expect((await detail(tomas.id, userId)).busy).toBe(true);

      const produced1 = await produceLook(look1?.id ?? "");
      expect(produced1.status).toBe("in_review");
      expect(produced1.fileId).not.toBeNull();
      expect(produced1.prompt).toContain("navy wool coat");
      const gen1 = await generationRow(produced1.generationId ?? "");
      expect(gen1).toMatchObject({ purpose: "asset_look", status: "succeeded" });
      expect(gen1.params).toMatchObject({ label: "Tomas" });
      const cards = await assets.listAssetCards(projectId, userId, { kind: "character" });
      expect(cards?.items[0]).toMatchObject({
        stage: "look_review",
        thumbnailFileId: produced1.fileId,
      });

      // Reject with codes: a fixed look, from the asset-fixer.
      expect(
        await assets.submitLookReview({
          lookId: produced1.id,
          userId,
          decision: "rejected",
          issueCodes: ["wrong_age", "lighting_poor"],
          note: "Older, please.",
        }),
      ).toBe("generating");
      const [review1] = await reviewsOf(produced1.id);
      expect(review1).toMatchObject({
        subjectType: "asset_look",
        decision: "rejected",
        issueCodes: ["wrong_age", "lighting_poor"],
        note: "Older, please.",
        damiRunId: produced1.damiRunId,
      });
      const d1 = await detail(tomas.id, userId);
      const look2 = d1.looks[0];
      expect(look2).toMatchObject({ versionNumber: 2, status: "pending" });
      const produced2 = await produceLook(look2?.id ?? "");
      expect(produced2).toMatchObject({ status: "in_review", parentId: produced1.id });
      expect(produced2.prompt).toContain("Revised:");
      const [fixRun] = await getDb()
        .select({ damiKey: s.damiRun.damiKey })
        .from(s.damiRun)
        .where(eq(s.damiRun.id, produced2.damiRunId ?? ""));
      expect(fixRun?.damiKey).toBe("asset-fixer");

      // Accept: a sheet is started with the look attached.
      expect(
        await assets.submitLookReview({ lookId: produced2.id, userId, decision: "accepted" }),
      ).toBe("building_sheet");
      const [acceptReview] = await reviewsOf(produced2.id);
      expect(acceptReview).toMatchObject({ decision: "accepted", damiRunId: produced2.damiRunId });
      const d2 = await detail(tomas.id, userId);
      expect(d2.stage).toBe("building_sheet");
      const sheet1 = d2.sheets[0];
      expect(sheet1).toMatchObject({ status: "pending", lookId: produced2.id });
      const producedSheet1 = await produceSheet(sheet1?.id ?? "");
      expect(producedSheet1.status).toBe("in_review");
      const sheetGen = await generationRow(producedSheet1.generationId ?? "");
      expect(sheetGen).toMatchObject({
        purpose: "asset_sheet",
        referenceFileIds: [produced2.fileId],
      });
      expect(sheetGen.params).toMatchObject({ label: "Tomas sheet" });
      expect((await detail(tomas.id, userId)).stage).toBe("sheet_review");

      // Reject the sheet: a fixed one.
      await expect(
        assets.submitSheetReview({ sheetId: producedSheet1.id, userId, decision: "rejected" }),
      ).rejects.toThrow(/pick an issue/);
      expect(
        await assets.submitSheetReview({
          sheetId: producedSheet1.id,
          userId,
          decision: "rejected",
          issueCodes: ["missing_view"],
        }),
      ).toBe("building_sheet");
      const [sheetReview] = await reviewsOf(producedSheet1.id);
      expect(sheetReview).toMatchObject({
        subjectType: "asset_sheet",
        issueCodes: ["missing_view"],
        damiRunId: producedSheet1.damiRunId,
      });
      const sheet2 = (await detail(tomas.id, userId)).sheets[0];
      const producedSheet2 = await produceSheet(sheet2?.id ?? "");
      expect(producedSheet2).toMatchObject({ status: "in_review", parentId: producedSheet1.id });
      const fixGen = await generationRow(producedSheet2.generationId ?? "");
      expect(fixGen.referenceFileIds).toEqual([produced2.fileId]);

      expect(
        await assets.submitSheetReview({
          sheetId: producedSheet2.id,
          userId,
          decision: "accepted",
        }),
      ).toBe("ready");
      const final = await detail(tomas.id, userId);
      expect(final).toMatchObject({ stage: "ready", busy: false });
      expect(final.looks.map((l) => l.status)).toEqual(["accepted", "rejected"]);
      expect(final.sheets.map((sh) => sh.status)).toEqual(["accepted", "rejected"]);
      expect(final.looks[0]?.isSample).toBe(true);
      const readyCards = await assets.listAssetCards(projectId, userId, { kind: "character" });
      expect(readyCards?.items[0]).toMatchObject({
        stage: "ready",
        thumbnailFileId: producedSheet2.fileId,
      });

      // 4 + 4 + 6 + 6 credits, each charged once.
      expect(await billing.getBalance(userId)).toBe(200 - 20);
      const types = await events(projectId);
      expect(types).toEqual(
        expect.arrayContaining(["asset.added", "asset.look_accepted", "asset.sheet_accepted"]),
      );
    });

    it("guided answers are validated against the kind's questions", async () => {
      const { userId, projectId } = await setup(50);
      const place = await add(projectId, userId, "location", "The Lighthouse");
      const valid = {
        setting: "Exterior",
        era: "Early 20th century (1900-1945)",
        architecture: "A white stone tower on a cliff",
        time_of_day: "Dusk",
        weather: "Fog or mist",
        mood: "Lonely and empty",
      };
      const start = (answers: Record<string, string>) =>
        assets.startLookFromGuided({ assetId: place.id, userId, answers });
      await expect(start({ ...valid, colour: "red" })).rejects.toThrow(
        /does not match any question/,
      );
      const { mood: _mood, ...missing } = valid;
      void _mood;
      await expect(start(missing)).rejects.toThrow(/What is the mood/);
      await expect(start({ ...valid, weather: "Hail" })).rejects.toThrow(/offered answers/);
      await expect(start({ ...valid, architecture: "x".repeat(1001) })).rejects.toThrow(
        /under 1000/,
      );

      const look = await start({ ...valid, signature_detail: "  " });
      expect(look).toMatchObject({ status: "pending", userPrompt: null, guidedAnswers: valid });
      const produced = await produceLook(look?.id ?? "");
      expect(produced.status).toBe("in_review");
      expect(produced.prompt).toContain("Fog or mist");
    });

    it("uploads: ready, owned, right purpose; rejecting an upload goes back to needs_image", async () => {
      const { userId, projectId } = await setup(50);
      const prop = await add(projectId, userId, "prop", "Brass lantern");
      const other = await fixtures.newUser();
      const othersImage = await fixtures.storedImage(other);
      const audio = await fixtures.storedAudio(userId);
      await expect(
        assets.startLookFromUpload({ assetId: prop.id, userId, fileId: othersImage }),
      ).rejects.toThrow(/not available/);
      await expect(
        assets.startLookFromUpload({ assetId: prop.id, userId, fileId: audio }),
      ).rejects.toThrow(/png/);
      // A file that was never confirmed (pending).
      const [pending] = await getDb()
        .insert(s.file)
        .values({
          ownerId: userId,
          storageKey: `u/${userId}/_/${crypto.randomUUID()}/x.png`,
          mimeType: "image/png",
          status: "pending",
        })
        .returning({ id: s.file.id });
      await expect(
        assets.startLookFromUpload({ assetId: prop.id, userId, fileId: pending?.id ?? "" }),
      ).rejects.toThrow(/not available/);

      const image = await fixtures.storedImage(userId, projectId);
      const uploaded = await assets.startLookFromUpload({
        assetId: prop.id,
        userId,
        fileId: image,
      });
      expect(uploaded).toMatchObject({ status: "in_review", source: "uploaded", fileId: image });
      expect(
        await assets.submitLookReview({
          lookId: uploaded?.id ?? "",
          userId,
          decision: "rejected",
          note: "Wrong lantern.",
        }),
      ).toBe("needs_image");
      expect((await detail(prop.id, userId)).stage).toBe("needs_image");

      const image2 = await fixtures.storedImage(userId);
      const again = await assets.startLookFromUpload({ assetId: prop.id, userId, fileId: image2 });
      expect(
        await assets.submitLookReview({ lookId: again?.id ?? "", userId, decision: "accepted" }),
      ).toBe("building_sheet");
      const sheet = (await detail(prop.id, userId)).sheets[0];
      const produced = await produceSheet(sheet?.id ?? "");
      expect(produced.status).toBe("in_review");
      expect((await generationRow(produced.generationId ?? "")).referenceFileIds).toEqual([image2]);
      expect(await billing.getBalance(userId)).toBe(50 - 6);
    });

    it("voices: a recording is accepted on upload, needs no sheet, and is never generated", async () => {
      const { userId, projectId } = await setup(0);
      const voice = await add(projectId, userId, "voice", "Tomas's voice");
      expect((await detail(voice.id, userId)).stage).toBe("needs_recording");
      await expect(
        assets.startLookFromPrompt({ assetId: voice.id, userId, prompt: "A deep gravelly voice" }),
      ).rejects.toThrow(/recorded/);
      await expect(
        assets.startLookFromGuided({ assetId: voice.id, userId, answers: {} }),
      ).rejects.toThrow(/recorded/);
      const image = await fixtures.storedImage(userId);
      await expect(
        assets.startLookFromUpload({ assetId: voice.id, userId, fileId: image }),
      ).rejects.toThrow(/mp3/);
      const audio = await fixtures.storedAudio(userId);
      const look = await assets.startLookFromUpload({ assetId: voice.id, userId, fileId: audio });
      expect(look).toMatchObject({ status: "accepted", source: "uploaded" });
      const d = await detail(voice.id, userId);
      expect(d).toMatchObject({ stage: "ready", sheets: [] });
      const cards = await assets.listAssetCards(projectId, userId, { kind: "voice" });
      expect(cards?.items[0]).toMatchObject({ stage: "ready", thumbnailFileId: null });
      // A new recording replaces the old one.
      const audio2 = await fixtures.storedAudio(userId);
      await assets.startLookFromUpload({ assetId: voice.id, userId, fileId: audio2 });
      expect((await detail(voice.id, userId)).looks.map((l) => l.status)).toEqual([
        "accepted",
        "superseded",
      ]);
    });

    it("insufficient credits → failed with the amount → grant → retry charges once", async () => {
      const { userId, projectId } = await setup(0);
      const tomas = await add(projectId, userId);
      const look = await assets.startLookFromPrompt({
        assetId: tomas.id,
        userId,
        prompt: "A keeper in oilskins",
      });
      const failed = await produceLook(look?.id ?? "");
      expect(failed).toMatchObject({
        status: "failed",
        failure: "You need 4 credits for this; you have 0.",
        generationId: null,
      });
      expect(failed.prompt).not.toBeNull();
      expect(await detail(tomas.id, userId)).toMatchObject({ stage: "failed", busy: false });

      await billing.grantCredits({ userId, amount: 10 });
      expect(await assets.retryLook({ lookId: failed.id, userId })).toBe("generating");
      const produced = await produceLook(failed.id);
      expect(produced.status).toBe("in_review");
      const runs = await getDb()
        .select({ id: s.damiRun.id })
        .from(s.damiRun)
        .where(
          and(eq(s.damiRun.projectId, projectId), eq(s.damiRun.damiKey, "asset-prompt-writer")),
        );
      expect(runs).toHaveLength(1); // the stored prompt was reused
      expect(await billing.getBalance(userId)).toBe(6);
      const ledger = await getDb()
        .select({ type: s.creditLedger.type })
        .from(s.creditLedger)
        .where(eq(s.creditLedger.userId, userId));
      expect(ledger.map((e) => e.type).sort()).toEqual(["grant", "reserve", "settle"]);
    });

    it("a provider failure fails the look and refunds; the hook twice is harmless", async () => {
      const { userId, projectId } = await setup(20);
      const tomas = await add(projectId, userId);
      const look = await assets.startLookFromPrompt({
        assetId: tomas.id,
        userId,
        prompt: "A keeper [[fail]]",
      });
      const failed = await produceLook(look?.id ?? "");
      expect(failed.status).toBe("failed");
      expect(failed.failure).toMatch(/sample provider was asked to fail/);
      expect(await billing.getBalance(userId)).toBe(20);
      const generationId = failed.generationId ?? "";
      expect((await generationRow(generationId)).status).toBe("failed");

      // Retry: a new generation, never the refunded one; then the old hook arrives again.
      await assets.retryLook({ lookId: failed.id, userId });
      await assetLookGenerateHandler.run({ lookId: failed.id }, jobContext());
      const retried = await lookRow(failed.id);
      expect(retried.status).toBe("pending");
      expect(retried.generationId).not.toBe(generationId);
      const old = await generationRow(generationId);
      await assetGenerationHook(old);
      expect((await lookRow(failed.id)).status).toBe("pending"); // the stale hook changed nothing

      // The new generation fails too ([[fail]] is in the stored prompt); calling the hook again
      // for it changes nothing more.
      await generationRunHandler.run({ generationId: retried.generationId ?? "" }, jobContext());
      const after = await lookRow(failed.id);
      expect(after.status).toBe("failed");
      const g = await generationRow(retried.generationId ?? "");
      await assetGenerationHook(g);
      await assetGenerationHook(g);
      expect(await lookRow(failed.id)).toEqual(after);
      expect(await billing.getBalance(userId)).toBe(20);

      // Succeeded twice: one in_review, unchanged by the repeat.
      const tomas2 = await add(projectId, userId, "character", "Mara");
      const ok = await assets.startLookFromPrompt({ assetId: tomas2.id, userId, prompt: "A girl" });
      const done = await produceLook(ok?.id ?? "");
      const okGen = await generationRow(done.generationId ?? "");
      await generationRunHandler.run({ generationId: okGen.id }, jobContext()); // finished: hook again
      await assetGenerationHook(okGen);
      expect(await lookRow(done.id)).toEqual(done);
    });

    it("one look or sheet in flight per asset; handlers run twice create one generation", async () => {
      const { userId, projectId } = await setup(50);
      const tomas = await add(projectId, userId);
      const look = await assets.startLookFromPrompt({ assetId: tomas.id, userId, prompt: "A man" });
      await expect(
        assets.startLookFromPrompt({ assetId: tomas.id, userId, prompt: "Another man" }),
      ).rejects.toThrow(/still being worked on/);
      const image = await fixtures.storedImage(userId);
      await expect(
        assets.startLookFromUpload({ assetId: tomas.id, userId, fileId: image }),
      ).rejects.toThrow(/still being worked on/);

      await assetLookGenerateHandler.run({ lookId: look?.id ?? "" }, jobContext());
      await assetLookGenerateHandler.run({ lookId: look?.id ?? "" }, jobContext());
      const gens = await getDb()
        .select({ id: s.generation.id })
        .from(s.generation)
        .where(eq(s.generation.projectId, projectId));
      expect(gens).toHaveLength(1);
      expect(await billing.getBalance(userId)).toBe(46);
      await generationRunHandler.run({ generationId: gens[0]?.id ?? "" }, jobContext());
      await expect(
        assets.startLookFromUpload({ assetId: tomas.id, userId, fileId: image }),
      ).rejects.toThrow(/Review the current image/);

      await assets.submitLookReview({ lookId: look?.id ?? "", userId, decision: "accepted" });
      await expect(assets.replaceLook({ assetId: tomas.id, userId })).rejects.toThrow(
        /still being worked on/,
      );
      const sheet = (await detail(tomas.id, userId)).sheets[0];
      await produceSheet(sheet?.id ?? "");
      await assets.submitSheetReview({ sheetId: sheet?.id ?? "", userId, decision: "accepted" });
      await expect(
        assets.startLookFromUpload({ assetId: tomas.id, userId, fileId: image }),
      ).rejects.toThrow(/Replace it/);

      // Replace: start over.
      expect(await assets.replaceLook({ assetId: tomas.id, userId })).toBe("needs_image");
      const replaced = await detail(tomas.id, userId);
      expect(replaced.looks[0]?.status).toBe("superseded");
      expect(replaced.sheets[0]?.status).toBe("superseded");
      const fresh = await assets.startLookFromUpload({ assetId: tomas.id, userId, fileId: image });
      expect(fresh).toMatchObject({ status: "in_review", versionNumber: 2 });

      // Removed assets cannot be worked on.
      expect(await assets.removeAsset({ assetId: tomas.id, userId })).toBe(true);
      await expect(
        assets.submitLookReview({ lookId: fresh?.id ?? "", userId, decision: "accepted" }),
      ).rejects.toThrow(/removed/);
    });

    it("isolates users and requires the pre-production stage", async () => {
      const { userId, projectId } = await setup(10);
      const tomas = await add(projectId, userId);
      const look = await assets.startLookFromPrompt({ assetId: tomas.id, userId, prompt: "A man" });
      const stranger = await fixtures.newUser();
      expect(await assets.getAssetDetail(tomas.id, stranger)).toBeNull();
      expect(await assets.getPreProductionOverview(projectId, stranger)).toBeNull();
      expect(await assets.listAssetCards(projectId, stranger, { kind: "character" })).toBeNull();
      expect(
        await assets.startLookFromPrompt({ assetId: tomas.id, userId: stranger, prompt: "x y z" }),
      ).toBeNull();
      expect(
        await assets.submitLookReview({
          lookId: look?.id ?? "",
          userId: stranger,
          decision: "accepted",
        }),
      ).toBeNull();
      expect(await assets.retryLook({ lookId: look?.id ?? "", userId: stranger })).toBeNull();
      expect(await assets.replaceLook({ assetId: tomas.id, userId: stranger })).toBeNull();
      expect(
        await assets.updateAsset({ assetId: tomas.id, userId: stranger, name: "Hacked" }),
      ).toBeNull();
      expect(await assets.removeAsset({ assetId: tomas.id, userId: stranger })).toBe(false);
      expect(
        await assets.addAsset({ projectId, userId: stranger, kind: "prop", name: "Knife" }),
      ).toBeNull();
      expect(await assets.completePreProduction({ projectId, userId: stranger })).toBe(false);

      const early = await fixtures.newProject(userId); // still at the script stage
      await expect(
        assets.addAsset({ projectId: early, userId, kind: "prop", name: "Knife" }),
      ).rejects.toThrow(/Accept a script/);
      await expect(assets.getPreProductionOverview(early, userId)).rejects.toThrow(
        /Accept a script/,
      );
    });

    it("adds, updates and merges assets; merge rewrites the blocks' assetRefs", async () => {
      const { userId, projectId } = await setup(0);
      const keep = await add(projectId, userId, "character", "Tomas");
      const dupe = await add(projectId, userId, "character", "Old Tomas");
      const again = await add(projectId, userId, "character", "Tomas");
      expect([keep.slug, dupe.slug, again.slug]).toEqual(["tomas", "old-tomas", "tomas-2"]);
      expect(keep.origin).toBe("manual");
      const updated = await assets.updateAsset({
        assetId: dupe.id,
        userId,
        name: "Tomas (old)",
        description: "",
      });
      expect(updated).toMatchObject({ name: "Tomas (old)", slug: "old-tomas", description: null });

      const scriptVersionId = await fixtures.acceptedScript(projectId, userId);
      await blocks.replaceBlocks({
        projectId,
        scriptVersionId,
        damiRunIds: [],
        blocks: [
          {
            title: "Stairs",
            scriptExcerpt: "TOMAS climbs the stairs.",
            prompt: "Tomas climbs.",
            durationSeconds: 8,
            assetRefs: ["character:old-tomas", "location:lighthouse"],
            orderIndex: 0,
            ...lines(0),
          },
          {
            title: "Both",
            scriptExcerpt: "TOMAS meets himself.",
            prompt: "Both.",
            durationSeconds: 6,
            assetRefs: ["character:tomas", "character:old-tomas"],
            orderIndex: 1,
            ...lines(1),
          },
          {
            title: "Other",
            scriptExcerpt: "The sea.",
            prompt: "Sea.",
            durationSeconds: 5,
            assetRefs: ["location:lighthouse"],
            orderIndex: 2,
            ...lines(2),
          },
        ],
      });
      await expect(
        assets.mergeAssets({ keepId: keep.id, mergeId: keep.id, userId }),
      ).rejects.toThrow(/two different/);
      const prop = await add(projectId, userId, "prop", "Lantern");
      await expect(
        assets.mergeAssets({ keepId: keep.id, mergeId: prop.id, userId }),
      ).rejects.toThrow(/same kind/);

      const merged = await assets.mergeAssets({ keepId: keep.id, mergeId: dupe.id, userId });
      expect(merged?.id).toBe(keep.id);
      const current = await blocks.listBlocks(projectId, userId);
      expect(current?.items.map((b) => b.assetRefs)).toEqual([
        ["character:tomas", "location:lighthouse"],
        ["character:tomas"],
        ["location:lighthouse"],
      ]);
      expect(current?.items.map((b) => b.versionNumber)).toEqual([2, 2, 1]);
      const all = await getDb()
        .select({ id: s.promptBlock.id })
        .from(s.promptBlock)
        .where(eq(s.promptBlock.projectId, projectId));
      expect(all).toHaveLength(5); // the two old versions are kept
      const list = await assets.listAssets(projectId, userId, { kind: "character" });
      expect(list?.items.map((a) => a.id)).toEqual([keep.id, again.id]);
      const removed = await assets.getAssetDetail(dupe.id, userId);
      expect(removed?.asset.status).toBe("removed");
      await expect(
        assets.startLookFromPrompt({ assetId: dupe.id, userId, prompt: "Old man" }),
      ).rejects.toThrow(/removed/);
      expect(await events(projectId)).toEqual(
        expect.arrayContaining(["asset.added", "asset.updated", "asset.merged"]),
      );
    });

    it("completes pre-production only when every active asset is ready, once", async () => {
      const { userId, projectId } = await setup(100);
      const tomas = await add(projectId, userId);
      const voice = await add(projectId, userId, "voice", "Narrator");
      const extra = await add(projectId, userId, "prop", "Spare oar");

      let overview = await assets.getPreProductionOverview(projectId, userId);
      expect(overview).toEqual({
        kinds: [
          { kind: "character", total: 1, ready: 0 },
          { kind: "prop", total: 1, ready: 0 },
          { kind: "voice", total: 1, ready: 0 },
        ],
        total: 3,
        ready: 0,
        canComplete: false,
      });
      await expect(assets.completePreProduction({ projectId, userId })).rejects.toThrow(
        /0 of 3 are ready/,
      );

      const image = await fixtures.storedImage(userId);
      const look = await assets.startLookFromUpload({ assetId: tomas.id, userId, fileId: image });
      await assets.submitLookReview({ lookId: look?.id ?? "", userId, decision: "accepted" });
      const sheet = (await detail(tomas.id, userId)).sheets[0];
      await produceSheet(sheet?.id ?? "");
      await assets.submitSheetReview({ sheetId: sheet?.id ?? "", userId, decision: "accepted" });
      await assets.startLookFromUpload({
        assetId: voice.id,
        userId,
        fileId: await fixtures.storedAudio(userId),
      });
      overview = await assets.getPreProductionOverview(projectId, userId);
      expect(overview).toMatchObject({ total: 3, ready: 2, canComplete: false });

      // Removing the unfinished asset leaves only ready ones.
      await assets.removeAsset({ assetId: extra.id, userId });
      overview = await assets.getPreProductionOverview(projectId, userId);
      expect(overview).toMatchObject({ total: 2, ready: 2, canComplete: true });
      expect(overview?.kinds.map((k) => k.kind)).toEqual(["character", "voice"]);

      expect(await assets.completePreProduction({ projectId, userId })).toBe(true);
      expect(await assets.completePreProduction({ projectId, userId })).toBe(false);
      const [p] = await getDb()
        .select({ stage: s.project.stage })
        .from(s.project)
        .where(eq(s.project.id, projectId));
      expect(p?.stage).toBe("production");
      const types = await events(projectId);
      expect(types.filter((t) => t === "preproduction.completed")).toHaveLength(1);
      const advanced = await getDb()
        .select({ payload: s.projectEvent.payload })
        .from(s.projectEvent)
        .where(
          and(eq(s.projectEvent.projectId, projectId), eq(s.projectEvent.type, "stage.advanced")),
        );
      expect(advanced.filter((e) => e.payload?.to === "production")).toHaveLength(1);
      expect(types).toEqual(expect.arrayContaining(["asset.removed"]));
      // Still viewable (an earlier stage), but no longer completable.
      expect((await assets.getPreProductionOverview(projectId, userId))?.canComplete).toBe(false);
    });
  },
);
