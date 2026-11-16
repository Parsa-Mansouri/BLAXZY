/**
 * Pre-production end to end against the local Postgres and S3 store, in sample mode (damis and
 * generations answer at once): the services, the four asset job handlers and the generation
 * handler run directly, with the completion hook registered as the worker does. Follow-up jobs go
 * to a throwaway queue schema. Skipped when a service is unreachable.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AssetDetectorOutput } from "../../src/server/damis";
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
    const { and, eq, sql } = await import("drizzle-orm");
    const { assetLookFixHandler, assetLookGenerateHandler } = await import("./asset-look");
    const { assetSheetFixHandler, assetSheetGenerateHandler } = await import("./asset-sheet");
    const { assetSheetAssembleHandler, assetSheetPlanHandler, assetSheetViewsAdvanceHandler } =
      await import("./asset-sheet-pack");
    const { generationRunHandler } = await import("./generation-run");
    const { latestViewRows } = await import("../../src/server/assets/packs");
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

    /** Jobs of a queue in the throwaway schema whose payload has `field` = `value`. */
    async function queued(name: string, field: string, value: string): Promise<number> {
      const result = await getDb().execute<{ n: number }>(
        sql.raw(
          `select count(*)::int as n from ${jobSchema}.job where name = '${name}' ` +
            `and data->>'${field}' = '${value}'`,
        ),
      );
      return result.rows[0]?.n ?? 0;
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

    /** Moves the project's assets' creation a minute back (past the double-submit window). */
    async function backdate(projectId: string) {
      await getDb()
        .update(s.asset)
        .set({ createdAt: sql`now() - interval '1 minute'` })
        .where(eq(s.asset.projectId, projectId));
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

      // The Character Generator drew a 16:9 board; the first character resolves the style.
      expect(produced1.spec).toMatchObject({
        generator: "character-generator",
        aspectRatio: "16:9",
      });
      expect(gen1.params).toMatchObject({ aspectRatio: "16:9" });
      const [styled] = await getDb()
        .select({ style: s.project.style })
        .from(s.project)
        .where(eq(s.project.id, projectId));
      expect(styled?.style?.styleDescriptor).toBe(produced1.spec?.styleUsed);

      // Reject with catalog picks: a fix round of the Character Generator.
      await expect(
        assets.submitLookReview({
          lookId: produced1.id,
          userId,
          decision: "rejected",
          selections: [{ code: "P05" }],
        }),
      ).rejects.toThrow(/Say what you want/);
      expect(
        await assets.submitLookReview({
          lookId: produced1.id,
          userId,
          decision: "rejected",
          selections: [
            { code: "T14" },
            { code: "P01", value: "noticeably older" },
            { code: "T01", viewId: "closeup" },
          ],
          note: "Older, please.",
        }),
      ).toBe("generating");
      const [review1] = await reviewsOf(produced1.id);
      expect(review1).toMatchObject({
        subjectType: "asset_look",
        decision: "rejected",
        issueCodes: ["T14", "P01", "T01"],
        note: "Older, please.",
        damiRunId: produced1.damiRunId,
      });
      expect(review1?.fixRequests[1]).toMatchObject({
        type: "preference",
        code: "P01",
        instruction: expect.stringContaining("noticeably older"),
      });
      const d1 = await detail(tomas.id, userId);
      const look2 = d1.looks[0];
      expect(look2).toMatchObject({ versionNumber: 2, status: "pending" });
      const produced2 = await produceLook(look2?.id ?? "");
      expect(produced2).toMatchObject({ status: "in_review", parentId: produced1.id });
      expect(produced2.prompt).toContain("noticeably older");
      expect(produced2.prompt).toContain("close-up");
      expect(produced2.spec?.appliedFixes.map((f) => f.code)).toEqual(["T14", "P01", "T01"]);
      const [fixRun] = await getDb()
        .select({ damiKey: s.damiRun.damiKey, input: s.damiRun.input })
        .from(s.damiRun)
        .where(eq(s.damiRun.id, produced2.damiRunId ?? ""));
      expect(fixRun?.damiKey).toBe("character-generator");
      expect(fixRun?.input).toMatchObject({ previousPrompt: produced1.prompt });
      expect((await generationRow(produced2.generationId ?? "")).params).toMatchObject({
        variant: produced2.id,
      });

      // A re-roll (R01) alone keeps the prompt and the dami run: only the seed changes.
      expect(
        await assets.submitLookReview({
          lookId: produced2.id,
          userId,
          decision: "rejected",
          selections: [{ code: "R01" }],
        }),
      ).toBe("generating");
      const reroll = await produceLook((await detail(tomas.id, userId)).looks[0]?.id ?? "");
      expect(reroll).toMatchObject({
        status: "in_review",
        prompt: produced2.prompt,
        damiRunId: produced2.damiRunId,
      });
      expect((await generationRow(reroll.generationId ?? "")).params).toMatchObject({
        variant: reroll.id,
      });
      expect((await detail(tomas.id, userId)).rejectedInARow).toBe(2);

      // Accept: a sheet is started with the look attached.
      expect(
        await assets.submitLookReview({ lookId: reroll.id, userId, decision: "accepted" }),
      ).toBe("building_sheet");
      const [acceptReview] = await reviewsOf(reroll.id);
      expect(acceptReview).toMatchObject({ decision: "accepted", damiRunId: reroll.damiRunId });
      const d2 = await detail(tomas.id, userId);
      expect(d2.stage).toBe("building_sheet");
      const sheet1 = d2.sheets[0];
      expect(sheet1).toMatchObject({ status: "pending", lookId: reroll.id });
      const producedSheet1 = await produceSheet(sheet1?.id ?? "");
      expect(producedSheet1.status).toBe("in_review");
      const sheetGen = await generationRow(producedSheet1.generationId ?? "");
      expect(sheetGen).toMatchObject({
        purpose: "asset_sheet",
        referenceFileIds: [reroll.fileId],
      });
      expect(sheetGen.params).toMatchObject({ label: "Tomas sheet" });
      expect((await detail(tomas.id, userId)).stage).toBe("sheet_review");

      // Reject the sheet: a fixed one.
      await expect(
        assets.submitSheetReview({ sheetId: producedSheet1.id, userId, decision: "rejected" }),
      ).rejects.toThrow(/Say what is wrong/);
      expect(
        await assets.submitSheetReview({
          sheetId: producedSheet1.id,
          userId,
          decision: "rejected",
          selections: [{ code: "ST20" }],
        }),
      ).toBe("building_sheet");
      const [sheetReview] = await reviewsOf(producedSheet1.id);
      expect(sheetReview).toMatchObject({
        subjectType: "asset_sheet",
        issueCodes: ["ST20"],
        damiRunId: producedSheet1.damiRunId,
      });
      expect(sheetReview?.fixRequests[0]).toMatchObject({ type: "technical", code: "ST20" });
      expect(producedSheet1.spec).toMatchObject({
        maker: "sheet-generator-character",
        editMode: "full",
      });
      expect(producedSheet1.spec?.detailCells).toHaveLength(6);
      const sheet2 = (await detail(tomas.id, userId)).sheets[0];
      const producedSheet2 = await produceSheet(sheet2?.id ?? "");
      expect(producedSheet2).toMatchObject({ status: "in_review", parentId: producedSheet1.id });
      // ST20 only touches the detail frames: the previous sheet is attached and edited.
      expect(producedSheet2.spec?.editMode).toBe("edit_previous_sheet");
      const fixGen = await generationRow(producedSheet2.generationId ?? "");
      expect(fixGen.referenceFileIds).toEqual([reroll.fileId, producedSheet1.fileId]);

      expect(
        await assets.submitSheetReview({
          sheetId: producedSheet2.id,
          userId,
          decision: "accepted",
        }),
      ).toBe("ready");
      const final = await detail(tomas.id, userId);
      expect(final).toMatchObject({ stage: "ready", busy: false });
      expect(final.looks.map((l) => l.status)).toEqual(["accepted", "rejected", "rejected"]);
      expect(final.sheets.map((sh) => sh.status)).toEqual(["accepted", "rejected"]);
      expect(final.looks[0]?.isSample).toBe(true);
      const readyCards = await assets.listAssetCards(projectId, userId, { kind: "character" });
      expect(readyCards?.items[0]).toMatchObject({
        stage: "ready",
        thumbnailFileId: producedSheet2.fileId,
      });

      // Three looks (4 each) and two sheets (6 each), each charged once.
      expect(await billing.getBalance(userId)).toBe(200 - 24);
      const types = await events(projectId);
      expect(types).toEqual(
        expect.arrayContaining(["asset.added", "asset.look_accepted", "asset.sheet_accepted"]),
      );
    });

    it("refuses catalog picks of another designer; a location's critical fields are checked before lock", async () => {
      const { userId, projectId } = await setup(200);
      const cafe = await add(projectId, userId, "location", "Corner Cafe");
      const look = await assets.startLookFromPrompt({
        assetId: cafe.id,
        userId,
        prompt: "A small corner cafe at dawn",
      });
      const produced = await produceLook(look?.id ?? "");
      expect(produced.spec).toMatchObject({ generator: "location-generator", aspectRatio: "16:9" });
      expect(produced.spec?.fields.length).toBeGreaterThan(0);
      await expect(
        assets.submitLookReview({
          lookId: produced.id,
          userId,
          decision: "rejected",
          selections: [{ code: "T01" }],
        }),
      ).rejects.toThrow(/does not apply/);
      expect(await reviewsOf(produced.id)).toHaveLength(0);
      await expect(
        assets.submitLookReview({ lookId: produced.id, userId, decision: "accepted" }),
      ).rejects.toThrow(/highlighted fields/);
      const confirmedFields = assets.fieldsToConfirm(produced.spec);
      expect(confirmedFields.length).toBeGreaterThan(0);
      expect(
        await assets.submitLookReview({
          lookId: produced.id,
          userId,
          decision: "accepted",
          confirmedFields,
        }),
      ).toBe("building_sheet");
      const sheet = (await detail(cafe.id, userId)).sheets[0];
      await assetSheetPlanHandler.run({ sheetId: sheet?.id ?? "" }, jobContext());
      const planned = await detail(cafe.id, userId);
      expect(planned.stage).toBe("sheet_review");
      const reverse = planned.packViews.find((v) => v.viewId === "reverse_wide");
      expect(reverse).toBeDefined();
      await expect(
        assets.submitSheetViewReview({
          viewRowId: reverse?.id ?? "",
          userId,
          decision: "rejected",
          selections: [{ code: "ST01" }],
        }),
      ).rejects.toThrow(/does not apply|no longer waiting/);
    });

    it("a spec-card edit is a fix round; the location's own photo can be the Hero", async () => {
      const { userId, projectId } = await setup(50);
      const pier = await add(projectId, userId, "location", "Harbour Pier");
      const image = await fixtures.storedImage(userId, projectId);
      const look = await assets.startDesign({
        assetId: pier.id,
        userId,
        references: [{ fileId: image, role: "hero" }],
      });
      // The designer took the photo as it is: in review at once, no generation, no credits.
      const produced = await produceLook(look?.id ?? "");
      expect(produced).toMatchObject({ status: "in_review", fileId: image, generationId: null });
      expect(produced.spec?.heroMode).toBe("use_uploaded");
      expect(await billing.getBalance(userId)).toBe(50);

      const field = assets.fieldsToConfirm(produced.spec)[0] ?? "";
      expect(
        await assets.submitLookReview({
          lookId: produced.id,
          userId,
          decision: "rejected",
          specEdits: [{ field, value: "A narrow stone pier, 40 m long" }],
        }),
      ).toBe("generating");
      const [edit] = await reviewsOf(produced.id);
      expect(edit?.fixRequests[0]).toMatchObject({ code: assets.SPEC_EDIT_CODE });
      const fixed = await produceLook((await detail(pier.id, userId)).looks[0]?.id ?? "");
      expect(fixed.status).toBe("in_review");
      expect(fixed.spec?.heroMode).toBe("restyle_uploaded");
      expect(fixed.spec?.appliedFixes.map((f) => f.code)).toEqual([assets.SPEC_EDIT_CODE]);
      expect((await generationRow(fixed.generationId ?? "")).referenceFileIds).toEqual([image]);
    });

    it("guided answers are checked against the asset's remaining questions", async () => {
      const { userId, projectId } = await setup(50);
      const place = await add(projectId, userId, "location", "The Lighthouse");
      const { questions } = await detail(place.id, userId);
      // The script describes it, so "what is it" is skipped; shape, materials and light are asked.
      expect(questions.map((q) => q.id)).not.toContain("what_is_it");
      expect(questions.map((q) => q.id)).toEqual(
        expect.arrayContaining(["shape_size", "materials_colors", "light_atmosphere"]),
      );
      const valid: Record<string, string> = {};
      for (const q of questions) {
        if (!q.optional) valid[q.id] = q.options?.[0]?.value ?? "Whitewashed stone";
      }
      valid.light_atmosphere = "ai_decides";
      valid.shape_size = "A tall round tower, narrow inside"; // own words for a choice
      const start = (answers: Record<string, string>) =>
        assets.startLookFromGuided({ assetId: place.id, userId, answers });
      await expect(start({ ...valid, colour: "red" })).rejects.toThrow(
        /does not match any question/,
      );
      const { materials_colors: _m, ...missing } = valid;
      void _m;
      await expect(start(missing)).rejects.toThrow(/main materials/);
      await expect(start({ ...valid, shape_size: "x".repeat(1001) })).rejects.toThrow(/under 1000/);

      const look = await start({ ...valid, fixed_elements: "  " });
      expect(look).toMatchObject({ status: "pending", userPrompt: null, guidedAnswers: valid });
      const produced = await produceLook(look?.id ?? "");
      expect(produced.status).toBe("in_review");
      expect(produced.prompt).toContain("Whitewashed stone");
      const [run] = await getDb()
        .select({ input: s.damiRun.input })
        .from(s.damiRun)
        .where(eq(s.damiRun.id, produced.damiRunId ?? ""));
      expect(run?.input).toMatchObject({ guidedAnswers: { light_atmosphere: "ai_decides" } });
    });

    it("photos are references with a role; dropping a photo is part of a fix round", async () => {
      const { userId, projectId } = await setup(50);
      const prop = await add(projectId, userId, "prop", "Brass lantern");
      const other = await fixtures.newUser();
      const othersImage = await fixtures.storedImage(other);
      const audio = await fixtures.storedAudio(userId);
      const image = await fixtures.storedImage(userId, projectId);
      const design = (references: { fileId: string; role: string; note?: string }[]) =>
        assets.startDesign({ assetId: prop.id, userId, references });
      await expect(design([{ fileId: othersImage, role: "identity" }])).rejects.toThrow(
        /not available/,
      );
      await expect(design([{ fileId: audio, role: "identity" }])).rejects.toThrow(/png/);
      await expect(design([{ fileId: image, role: "face" }])).rejects.toThrow(/what each photo/);
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
      await expect(design([{ fileId: pending?.id ?? "", role: "identity" }])).rejects.toThrow(
        /not available/,
      );
      // An image upload no longer becomes the look.
      await expect(
        assets.startLookFromUpload({ assetId: prop.id, userId, fileId: image }),
      ).rejects.toThrow(/role/);

      const look = await design([{ fileId: image, role: "identity", note: "the red handle" }]);
      expect(look?.references).toEqual([
        { fileId: image, role: "identity", note: "the red handle" },
      ]);
      const produced = await produceLook(look?.id ?? "");
      expect(produced.spec).toMatchObject({ generator: "prop-generator", aspectRatio: "3:4" });
      const gen = await generationRow(produced.generationId ?? "");
      expect(gen.referenceFileIds).toEqual([image]);
      expect(gen.params).toMatchObject({ aspectRatio: "3:4" });

      // "Drop the photo": the change is made from words alone.
      expect(
        await assets.submitLookReview({
          lookId: produced.id,
          userId,
          decision: "rejected",
          selections: [{ code: "AP02", customText: "dark green" }],
          references: [],
        }),
      ).toBe("generating");
      const fixed = await produceLook((await detail(prop.id, userId)).looks[0]?.id ?? "");
      expect(fixed.references).toEqual([]);
      expect(fixed.spec?.changesIdentity).toBe(true);
      expect((await generationRow(fixed.generationId ?? "")).referenceFileIds).toEqual([]);
      expect(await billing.getBalance(userId)).toBe(50 - 8);
    });

    it("a prop the designer cannot place asks one question; the answer designs it", async () => {
      const { userId, projectId } = await setup(50);
      const device = await assets.addAsset({ projectId, userId, kind: "prop", name: "The device" });
      const look = await assets.startDesign({ assetId: device?.id ?? "", userId });
      const asked = await produceLook(look?.id ?? "");
      expect(asked.status).toBe("needs_input");
      expect(asked.generationId).toBeNull();
      const d = await detail(device?.id ?? "", userId);
      expect(d.stage).toBe("needs_answer");
      const question = d.looks[0]?.spec?.questions.find((q) => q.blocking);
      expect(question).toBeDefined();
      await expect(
        assets.startDesign({ assetId: device?.id ?? "", userId, prompt: "A radio" }),
      ).rejects.toThrow(/question first/);
      await expect(
        assets.answerLookQuestion({ lookId: asked.id, userId, answers: {} }),
      ).rejects.toThrow(/I’m not sure/);
      expect(
        await assets.answerLookQuestion({
          lookId: asked.id,
          userId,
          answers: { [question?.id ?? ""]: "ai_decides" },
        }),
      ).toBe("generating");
      const next = (await detail(device?.id ?? "", userId)).looks[0];
      expect(next).toMatchObject({
        parentId: asked.id,
        clarifyAnswers: { [question?.id ?? ""]: question?.default },
      });
      expect((await lookRow(asked.id)).status).toBe("superseded");
      const designed = await produceLook(next?.id ?? "");
      expect(designed.status).toBe("in_review");
      expect(designed.prompt).toContain(question?.default ?? "");
    });

    it("a prop standing in a location waits for its Hero, then is designed with it", async () => {
      const { userId, projectId } = await setup(100);
      const cabin = await add(projectId, userId, "location", "Ferry Cabin");
      const locket = await add(projectId, userId, "prop", "Brass locket");
      await getDb()
        .update(s.asset)
        .set({ details: { locationIds: ["ferry cabin"] } })
        .where(eq(s.asset.id, locket.id));
      const cabinLook = await assets.startLookFromPrompt({
        assetId: cabin.id,
        userId,
        prompt: "A cramped cabin",
      });
      const propLook = await assets.startLookFromPrompt({
        assetId: locket.id,
        userId,
        prompt: "A small locket",
      });
      expect(propLook).toMatchObject({ status: "pending", started: false });
      expect((await detail(locket.id, userId)).waitingFor).toEqual(["Ferry Cabin"]);
      const cabinDone = await produceLook(cabinLook?.id ?? "");
      expect((await detail(locket.id, userId)).waitingFor).toEqual(["Ferry Cabin"]);
      // Waiting can be skipped: that prop is designed without the Hero.
      const lantern = await add(projectId, userId, "prop", "Lantern");
      await getDb()
        .update(s.asset)
        .set({ details: { locationIds: ["Ferry Cabin"] } })
        .where(eq(s.asset.id, lantern.id));
      const lanternLook = await assets.startLookFromPrompt({
        assetId: lantern.id,
        userId,
        prompt: "An oil lantern",
      });
      expect(await assets.startWithoutWaiting({ assetId: lantern.id, userId })).toBe("generating");
      expect((await produceLook(lanternLook?.id ?? "")).status).toBe("in_review");
      await expect(assets.startWithoutWaiting({ assetId: lantern.id, userId })).rejects.toThrow(
        /already started/,
      );
      await assets.submitLookReview({
        lookId: cabinDone.id,
        userId,
        decision: "accepted",
        confirmedFields: assets.fieldsToConfirm(cabinDone.spec),
      });
      expect((await detail(locket.id, userId)).waitingFor).toEqual([]);
      // Accepting the cabin queued the prop's job (here it is run by hand).
      const designed = await produceLook(propLook?.id ?? "");
      expect(designed.status).toBe("in_review");
      const [run] = await getDb()
        .select({ input: s.damiRun.input })
        .from(s.damiRun)
        .where(eq(s.damiRun.id, designed.damiRunId ?? ""));
      expect(run?.input).toMatchObject({
        linkedLocations: [{ name: "Ferry Cabin", heroFileId: cabinDone.fileId }],
      });
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
          and(eq(s.damiRun.projectId, projectId), eq(s.damiRun.damiKey, "character-generator")),
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
      // The failed attempt stays on record (the row is cleared for the new one).
      const [retried1] = await getDb()
        .select({ payload: s.projectEvent.payload })
        .from(s.projectEvent)
        .where(
          and(
            eq(s.projectEvent.projectId, projectId),
            eq(s.projectEvent.type, "asset.look_retried"),
          ),
        );
      expect(retried1?.payload).toMatchObject({
        lookId: failed.id,
        previousGenerationId: generationId,
        previousFailure: failed.failure,
      });
      // Its job was sent with the retry.
      expect(await queued("asset.look.generate", "lookId", failed.id)).toBeGreaterThan(0);
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

      await assetLookGenerateHandler.run({ lookId: look?.id ?? "" }, jobContext());
      await assetLookGenerateHandler.run({ lookId: look?.id ?? "" }, jobContext());
      const gens = await getDb()
        .select({ id: s.generation.id })
        .from(s.generation)
        .where(eq(s.generation.projectId, projectId));
      expect(gens).toHaveLength(1);
      expect(await billing.getBalance(userId)).toBe(46);
      // The run job was sent with the generation (same transaction), once.
      expect(await queued("generation.run", "generationId", gens[0]?.id ?? "")).toBe(1);
      await generationRunHandler.run({ generationId: gens[0]?.id ?? "" }, jobContext());
      await expect(
        assets.startLookFromPrompt({ assetId: tomas.id, userId, prompt: "Another man" }),
      ).rejects.toThrow(/Review the current image/);

      await assets.submitLookReview({ lookId: look?.id ?? "", userId, decision: "accepted" });
      await expect(assets.replaceLook({ assetId: tomas.id, userId })).rejects.toThrow(
        /still being worked on/,
      );
      const sheet = (await detail(tomas.id, userId)).sheets[0];
      await produceSheet(sheet?.id ?? "");
      await assets.submitSheetReview({ sheetId: sheet?.id ?? "", userId, decision: "accepted" });
      await expect(
        assets.startLookFromPrompt({ assetId: tomas.id, userId, prompt: "Another man" }),
      ).rejects.toThrow(/Replace it/);

      // Replace: start over.
      expect(await assets.replaceLook({ assetId: tomas.id, userId })).toBe("needs_image");
      const replaced = await detail(tomas.id, userId);
      expect(replaced.looks[0]?.status).toBe("superseded");
      expect(replaced.sheets[0]?.status).toBe("superseded");
      const fresh = await produceLook(
        (await assets.startLookFromPrompt({ assetId: tomas.id, userId, prompt: "A man" }))?.id ??
          "",
      );
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

    it("adds, renames and merges assets; renames and merges rewrite the blocks' refs and tags", async () => {
      const { userId, projectId } = await setup(0);
      const keep = await add(projectId, userId, "character", "Tomas");
      const dupe = await add(projectId, userId, "character", "Old Tomas");
      // A double submit returns the asset just added: no "Tomas (2)".
      const doubleClick = await add(projectId, userId, "character", "TOMAS");
      expect(doubleClick.id).toBe(keep.id);
      // A distinct later add of the same name is deliberate: "Tomas (2)".
      await backdate(projectId);
      const again = await add(projectId, userId, "character", "Tomas");
      expect([keep.name, dupe.name, again.name]).toEqual(["Tomas", "Old Tomas", "Tomas (2)"]);
      await backdate(projectId);
      const lower = await add(projectId, userId, "character", "tomas");
      expect(lower.name).toBe("tomas (3)");
      expect(keep.origin).toBe("manual");
      const updated = await assets.updateAsset({
        assetId: dupe.id,
        userId,
        name: "Tomas (old)",
        description: "",
      });
      expect(updated).toMatchObject({ name: "Tomas (old)", description: null });
      const clash = await assets.updateAsset({ assetId: lower.id, userId, name: "TOMAS (2)" });
      expect(clash?.name).toBe("TOMAS (3)"); // its own old name is free again

      const scriptVersionId = await fixtures.acceptedScript(projectId, userId);
      await blocks.replaceBlocks({
        projectId,
        scriptVersionId,
        damiRunIds: [],
        blocks: [
          {
            title: "Stairs",
            scriptExcerpt: "TOMAS climbs the stairs.",
            prompt: "Tomas [character:Tomas (old)] climbs the Lighthouse [location:Lighthouse].",
            durationSeconds: 8,
            assetRefs: ["character:Tomas (old)", "location:Lighthouse"],
            orderIndex: 0,
            ...lines(0),
          },
          {
            title: "Both",
            scriptExcerpt: "TOMAS meets himself.",
            prompt: "Tomas [character:Tomas] meets Tomas [character:Tomas (old)].",
            durationSeconds: 6,
            assetRefs: ["character:Tomas", "character:Tomas (old)"],
            orderIndex: 1,
            ...lines(1),
          },
          {
            title: "Other",
            scriptExcerpt: "The sea.",
            prompt: "Sea.",
            durationSeconds: 5,
            assetRefs: ["location:Lighthouse"],
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
        ["character:Tomas", "location:Lighthouse"],
        ["character:Tomas"],
        ["location:Lighthouse"],
      ]);
      expect(current?.items.map((b) => b.prompt)).toEqual([
        "Tomas [character:Tomas] climbs the Lighthouse [location:Lighthouse].",
        "Tomas [character:Tomas] meets Tomas [character:Tomas].",
        "Sea.",
      ]);
      expect(current?.items.map((b) => b.versionNumber)).toEqual([2, 2, 1]);
      const all = await getDb()
        .select({ id: s.promptBlock.id })
        .from(s.promptBlock)
        .where(eq(s.promptBlock.projectId, projectId));
      expect(all).toHaveLength(5); // the two old versions are kept
      const list = await assets.listAssets(projectId, userId, { kind: "character" });
      expect(list?.items.map((a) => a.id)).toEqual([keep.id, again.id, lower.id]);

      // A rename is a new id: the blocks that name the asset get a new version with the new ref.
      const renamed = await assets.updateAsset({ assetId: keep.id, userId, name: "Tomas: Senior" });
      expect(renamed?.name).toBe("Tomas - Senior");
      const afterRename = await blocks.listBlocks(projectId, userId);
      expect(afterRename?.items.map((b) => b.assetRefs)).toEqual([
        ["character:Tomas - Senior", "location:Lighthouse"],
        ["character:Tomas - Senior"],
        ["location:Lighthouse"],
      ]);
      expect(afterRename?.items[0]?.prompt).toBe(
        "Tomas [character:Tomas - Senior] climbs the Lighthouse [location:Lighthouse].",
      );
      expect(afterRename?.items.map((b) => b.versionNumber)).toEqual([3, 3, 1]);
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

      const look = await produceLook(
        (await assets.startLookFromPrompt({ assetId: tomas.id, userId, prompt: "A man" }))?.id ??
          "",
      );
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

    it("a voice-only narrator is a hidden character that never blocks completion", async () => {
      const { userId, projectId } = await setup(100);
      const tomas = await add(projectId, userId);
      const narrator = await add(projectId, userId, "character", "Narrator");
      await getDb()
        .update(s.asset)
        .set({ details: { subkind: "voice_only", needsVisual: false, speaks: true } })
        .where(eq(s.asset.id, narrator.id));

      // Not listed, not counted, not waited for.
      const overview = await assets.getPreProductionOverview(projectId, userId);
      expect(overview).toEqual({
        kinds: [{ kind: "character", total: 1, ready: 0 }],
        total: 1,
        ready: 0,
        canComplete: false,
      });
      const cards = await assets.listAssetCards(projectId, userId, { kind: "character" });
      expect(cards?.items.map((c) => c.asset.name)).toEqual(["Tomas"]);
      expect((await assets.countAssetsByKind(projectId, userId))?.character).toBe(1);
      expect(await assets.nextAssetNeedingInput(projectId, userId, tomas.id)).toBeNull();
      // No designer is ever started for it.
      await expect(
        assets.startLookFromPrompt({ assetId: narrator.id, userId, prompt: "A deep voice" }),
      ).rejects.toThrow(/only a voice/);
      // The sectioner does not see it either (it has no image to attach).
      expect((await assets.getSectionerAssets(projectId)).map((a) => a.name)).toEqual(["Tomas"]);

      const look = await produceLook(
        (await assets.startLookFromPrompt({ assetId: tomas.id, userId, prompt: "A man" }))?.id ??
          "",
      );
      await assets.submitLookReview({ lookId: look?.id ?? "", userId, decision: "accepted" });
      const sheet = (await detail(tomas.id, userId)).sheets[0];
      await produceSheet(sheet?.id ?? "");
      await assets.submitSheetReview({ sheetId: sheet?.id ?? "", userId, decision: "accepted" });
      expect(await assets.getPreProductionOverview(projectId, userId)).toMatchObject({
        total: 1,
        ready: 1,
        canComplete: true,
      });
      expect(await assets.completePreProduction({ projectId, userId })).toBe(true);
    });

    /** Runs the pack's advance and every generation it requested. */
    async function advancePack(sheetId: string) {
      await assetSheetViewsAdvanceHandler.run({ sheetId }, jobContext());
      const rows = await getDb()
        .select()
        .from(s.assetSheetView)
        .where(and(eq(s.assetSheetView.sheetId, sheetId), eq(s.assetSheetView.status, "pending")));
      for (const row of rows) {
        if (row.generationId) {
          await generationRunHandler.run({ generationId: row.generationId }, jobContext());
        }
      }
    }

    async function viewRow(id: string) {
      const [row] = await getDb()
        .select()
        .from(s.assetSheetView)
        .where(eq(s.assetSheetView.id, id));
      if (!row) throw new Error("view missing");
      return row;
    }

    async function acceptLocation(userId: string, projectId: string, name: string) {
      const created = await add(projectId, userId, "location", name);
      const look = await assets.startLookFromPrompt({
        assetId: created.id,
        userId,
        prompt: "A cramped ferry cabin at night",
      });
      const produced = await produceLook(look?.id ?? "");
      await assets.submitLookReview({
        lookId: produced.id,
        userId,
        decision: "accepted",
        confirmedFields: assets.fieldsToConfirm(produced.spec),
      });
      return { asset: created, look: produced };
    }

    it("location pack: plan, views in order, a fix that edits, a re-roll, lock, contact sheet", async () => {
      const { userId, projectId } = await setup(400);
      const { asset: cabin, look } = await acceptLocation(userId, projectId, "Ferry Cabin");
      const sheetId = (await detail(cabin.id, userId)).sheets[0]?.id ?? "";
      // A pack queued on the character job is handed to the plan job; nothing is generated.
      await assetSheetGenerateHandler.run({ sheetId }, jobContext());
      expect((await sheetRow(sheetId)).generationId).toBeNull();
      await assetSheetPlanHandler.run({ sheetId }, jobContext());
      const planned = await sheetRow(sheetId);
      expect(planned.status).toBe("in_review");
      // A retry after the plan was stored queues the advance again (the first attempt may have
      // died before queueing it).
      await getDb().execute(
        sql.raw(
          `delete from ${jobSchema}.job where name = 'asset.sheet.views.advance' ` +
            `and data->>'sheetId' = '${sheetId}'`,
        ),
      );
      await assetSheetPlanHandler.run({ sheetId }, jobContext(2));
      expect(await queued("asset.sheet.views.advance", "sheetId", sheetId)).toBe(1);
      expect(planned.spec?.maker).toBe("sheet-generator-location");
      let d = await detail(cabin.id, userId);
      expect(d.stage).toBe("sheet_review");
      expect(d.packViews[0]?.viewId).toBe("reverse_wide");
      expect(d.lockGate).toMatchObject({ canLock: false });
      expect(d.dnaCard?.anchors.length).toBeGreaterThan(0);

      // Only the reverse has no unapproved dependency: it is generated first.
      await advancePack(sheetId);
      d = await detail(cabin.id, userId);
      const reverse = d.packViews.find((v) => v.viewId === "reverse_wide");
      expect(reverse?.status).toBe("in_review");
      expect(d.packViews.filter((v) => v.status === "planned")).toHaveLength(
        d.packViews.length - 1,
      );
      const reverseRow = await viewRow(reverse?.id ?? "");
      const reverseGen = await generationRow(reverseRow.generationId ?? "");
      expect(reverseGen.referenceFileIds).toEqual([look.fileId]);
      expect(reverseGen.params).toMatchObject({ aspectRatio: "16:9" });

      // The proposed wall must be approved with the view.
      await expect(
        assets.submitSheetViewReview({
          viewRowId: reverse?.id ?? "",
          userId,
          decision: "accepted",
        }),
      ).rejects.toThrow(/proposes/);
      await assets.submitSheetViewReview({
        viewRowId: reverse?.id ?? "",
        userId,
        decision: "accepted",
        hypothesesApproved: true,
      });
      await advancePack(sheetId);
      d = await detail(cabin.id, userId);
      const corner = d.packViews.find((v) => v.viewId === "corner_a");
      expect(corner?.status).toBe("in_review");
      const cornerRow = await viewRow(corner?.id ?? "");
      const cornerGen = await generationRow(cornerRow.generationId ?? "");
      expect(cornerGen.referenceFileIds).toEqual([look.fileId, reverseRow.fileId]);

      // LST05 is edit-eligible: the fix round re-writes only this view and edits its image.
      expect(
        await assets.submitSheetViewReview({
          viewRowId: corner?.id ?? "",
          userId,
          decision: "rejected",
          selections: [{ code: "LST05" }],
        }),
      ).toBe("sheet_review");
      d = await detail(cabin.id, userId);
      const fixVersion = d.packViews.find((v) => v.viewId === "corner_a");
      expect(fixVersion).toMatchObject({ status: "planned", versionNumber: 2 });
      await assetSheetPlanHandler.run({ sheetId, viewRowId: fixVersion?.id ?? "" }, jobContext());
      await advancePack(sheetId);
      d = await detail(cabin.id, userId);
      const fixed = d.packViews.find((v) => v.viewId === "corner_a");
      expect(fixed).toMatchObject({ status: "in_review", editMode: "edit_previous_view" });
      const fixedRow = await viewRow(fixed?.id ?? "");
      const fixedGen = await generationRow(fixedRow.generationId ?? "");
      expect(fixedGen.referenceFileIds).toContain(cornerRow.fileId);

      // LSR01 re-rolls: same prompt, a new seed, no dami call.
      await assets.submitSheetViewReview({
        viewRowId: fixed?.id ?? "",
        userId,
        decision: "rejected",
        selections: [{ code: "LSR01" }],
      });
      await advancePack(sheetId);
      d = await detail(cabin.id, userId);
      const rerolled = d.packViews.find((v) => v.viewId === "corner_a");
      expect(rerolled).toMatchObject({ status: "in_review", versionNumber: 3 });
      const rerolledRow = await viewRow(rerolled?.id ?? "");
      expect(rerolledRow.prompt).toBe(fixedRow.prompt);
      expect(rerolledRow.damiRunId).toBe(fixedRow.damiRunId);

      // Hero and Reverse approved: the pack locks, the rest is set aside, a contact sheet is made.
      expect(d.lockGate).toMatchObject({ canLock: true });
      expect(await assets.lockSheet({ sheetId, userId })).toBe("ready");
      d = await detail(cabin.id, userId);
      expect(d.stage).toBe("ready");
      expect(d.packViews.find((v) => v.viewId === "corner_a")?.status).toBe("superseded");
      // The lock sent the assemble job with it.
      expect(await queued("asset.sheet.assemble", "sheetId", sheetId)).toBe(1);
      await assetSheetAssembleHandler.run({ sheetId }, jobContext());
      const contact = (await sheetRow(sheetId)).fileId;
      expect(contact).not.toBeNull();
      // A duplicate run finds the file and uploads nothing.
      await assetSheetAssembleHandler.run({ sheetId }, jobContext(2));
      expect((await sheetRow(sheetId)).fileId).toBe(contact);
      const contactFiles = await getDb()
        .select({ id: s.file.id })
        .from(s.file)
        .where(
          and(eq(s.file.projectId, projectId), eq(s.file.originalName, "pack_contact_sheet.png")),
        );
      expect(contactFiles).toHaveLength(1);
      // Production attaches the Hero and lists the approved views.
      const refs = await assets.listReadyReferenceAssets(projectId);
      const ref = refs.find((r) => r.assetId === cabin.id);
      expect(ref).toMatchObject({ referenceFileId: look.fileId });
      expect(ref?.views.map((v) => v.viewId)).toEqual(["reverse_wide"]);
    });

    it("design changes from a sheet go back to the designer; the sheet rebuilds after", async () => {
      const { userId, projectId } = await setup(400);
      const { asset: cabin, look } = await acceptLocation(userId, projectId, "Ferry Cabin");
      const sheetId = (await detail(cabin.id, userId)).sheets[0]?.id ?? "";
      await assetSheetPlanHandler.run({ sheetId }, jobContext());
      await advancePack(sheetId);
      const reverse = (await detail(cabin.id, userId)).packViews[0];
      await expect(
        assets.submitSheetViewReview({
          viewRowId: reverse?.id ?? "",
          userId,
          decision: "rejected",
          selections: [{ code: "LSX01" }],
        }),
      ).rejects.toThrow(/design/);
      expect(
        await assets.submitSheetViewReview({
          viewRowId: reverse?.id ?? "",
          userId,
          decision: "rejected",
          selections: [{ code: "LSX01", customText: "Put a second window on the east wall" }],
        }),
      ).toBe("generating");
      let d = await detail(cabin.id, userId);
      expect(d.stage).toBe("generating");
      expect(d.looks[1]).toMatchObject({ id: look.id, status: "rejected" });
      expect((await sheetRow(sheetId)).status).toBe("rejected");
      const lookReviews = await reviewsOf(look.id);
      expect(lookReviews.find((r) => r.decision === "rejected")?.fixRequests[0]).toMatchObject({
        code: "LSX01",
        customText: "Put a second window on the east wall",
      });
      // The designer's fix round; accepting it starts a new pack.
      const next = await produceLook(d.looks[0]?.id ?? "");
      expect(next.parentId).toBe(look.id);
      expect(next.status).toBe("in_review");
      await assets.submitLookReview({
        lookId: next.id,
        userId,
        decision: "accepted",
        confirmedFields: assets.fieldsToConfirm(next.spec),
      });
      d = await detail(cabin.id, userId);
      expect(d.stage).toBe("building_sheet");
      expect(d.sheets[0]?.lookId).toBe(next.id);

      // A character: SR01 re-rolls the sheet; SX01 goes back to the Character Generator.
      const tomas = await add(projectId, userId);
      const started = await assets.startLookFromPrompt({
        assetId: tomas.id,
        userId,
        prompt: "An old lighthouse keeper",
      });
      const tLook = await produceLook(started?.id ?? "");
      await assets.submitLookReview({ lookId: tLook.id, userId, decision: "accepted" });
      const s1 = await produceSheet((await detail(tomas.id, userId)).sheets[0]?.id ?? "");
      await assets.submitSheetReview({
        sheetId: s1.id,
        userId,
        decision: "rejected",
        selections: [{ code: "SR01" }],
      });
      const s2 = await produceSheet((await detail(tomas.id, userId)).sheets[0]?.id ?? "");
      expect(s2).toMatchObject({ prompt: s1.prompt, damiRunId: s1.damiRunId, status: "in_review" });
      expect((await generationRow(s2.generationId ?? "")).params).toMatchObject({
        variant: s2.id,
      });
      expect(
        await assets.submitSheetReview({
          sheetId: s2.id,
          userId,
          decision: "rejected",
          selections: [{ code: "SX01", customText: "Give him a red scarf" }],
        }),
      ).toBe("generating");
      const t = await detail(tomas.id, userId);
      expect(t.looks[0]).toMatchObject({ status: "pending", parentId: tLook.id });
      expect(t.sheets[0]?.status).toBe("rejected");
    });

    it("prop sheet: the level's views gate the lock; the scale card is kept", async () => {
      const { userId, projectId } = await setup(600);
      const box = await add(projectId, userId, "prop", "Music Box");
      const started = await assets.startLookFromPrompt({
        assetId: box.id,
        userId,
        prompt: "A hero music box with a lid that opens",
      });
      const look = await produceLook(started?.id ?? "");
      expect(look.status).toBe("in_review");
      await assets.submitLookReview({
        lookId: look.id,
        userId,
        decision: "accepted",
        confirmedFields: assets.fieldsToConfirm(look.spec),
      });
      const sheetId = (await detail(box.id, userId)).sheets[0]?.id ?? "";
      await assetSheetPlanHandler.run({ sheetId }, jobContext());
      const sheet = await sheetRow(sheetId);
      expect(sheet.spec?.maker).toBe("sheet-generator-prop");
      expect(sheet.spec?.scaleCard?.text.length).toBeGreaterThan(0);
      let d = await detail(box.id, userId);
      expect(d.packViews.length).toBeGreaterThan(0);
      const first = d.packViews[0];
      await advancePack(sheetId);
      d = await detail(box.id, userId);
      const firstNow = d.packViews.find((v) => v.viewId === first?.viewId);
      expect(firstNow?.status).toBe("in_review");
      const row = await viewRow(firstNow?.id ?? "");
      const gen = await generationRow(row.generationId ?? "");
      expect(gen.referenceFileIds[0]).toBe(look.fileId);
      expect(gen.params).toMatchObject({ aspectRatio: row.aspectRatio });
      if (sheet.spec?.sheetLevel !== "simple") {
        expect(d.lockGate?.canLock).toBe(false);
        await expect(assets.lockSheet({ sheetId, userId })).rejects.toThrow(/Approve these first/);
      }
    });

    it("a foreign id is missing before anything about it is read; answers are bounded", async () => {
      const { userId, projectId } = await setup(0);
      const voice = await add(projectId, userId, "voice", "Tomas's voice");
      const recording = await assets.startLookFromUpload({
        assetId: voice.id,
        userId,
        fileId: await fixtures.storedAudio(userId),
      });
      const stranger = await fixtures.newUser();
      const photo = await fixtures.storedImage(stranger);
      const references = [{ fileId: photo, role: "hero" }];
      // The same answer as for an id that does not exist: nothing about the asset's kind leaks.
      expect(
        await assets.submitLookReview({
          lookId: recording?.id ?? "",
          userId: stranger,
          decision: "rejected",
          note: "Different",
          references,
        }),
      ).toBeNull();
      expect(
        await assets.submitLookReview({
          lookId: crypto.randomUUID(),
          userId: stranger,
          decision: "rejected",
          note: "Different",
          references,
        }),
      ).toBeNull();
      expect(
        await assets.startDesign({ assetId: voice.id, userId: stranger, references }),
      ).toBeNull();

      const tomas = await add(projectId, userId);
      const tooMany = Object.fromEntries(
        Array.from({ length: assets.MAX_GUIDED_ANSWERS + 1 }, (_, i) => [`q${i}`, "x"]),
      );
      await expect(
        assets.startLookFromGuided({ assetId: tomas.id, userId, answers: tooMany }),
      ).rejects.toThrow(/more answers than questions/);
    });

    it("a waiting prop wakes when its location is skipped, merged away or dropped by the detector", async () => {
      const { userId, projectId } = await setup(100);
      /** A location with a look in flight and a prop that waits for it. */
      async function waitingPair(locationName: string, propName: string, waitsFor = locationName) {
        const location = await add(projectId, userId, "location", locationName);
        await assets.startLookFromPrompt({ assetId: location.id, userId, prompt: "A place" });
        const prop = await add(projectId, userId, "prop", propName);
        await getDb()
          .update(s.asset)
          .set({ details: { locationIds: [waitsFor] } })
          .where(eq(s.asset.id, prop.id));
        const look = await assets.startLookFromPrompt({
          assetId: prop.id,
          userId,
          prompt: "A small object",
        });
        expect(look).toMatchObject({ status: "pending", started: false });
        expect(await queued("asset.look.generate", "lookId", look?.id ?? "")).toBe(0);
        return { location, prop, lookId: look?.id ?? "" };
      }

      // Skipped from the detected list (ADP01).
      const cabin = await waitingPair("Ferry Cabin", "Locket");
      expect(
        await assets.submitDetectionReview({
          projectId,
          userId,
          selections: [{ code: "ADP01", targetNames: ["location:ferry cabin"] }],
        }),
      ).toEqual({ skipped: 1, started: false });
      expect(await queued("asset.look.generate", "lookId", cabin.lookId)).toBe(1);

      // Merged away into a location that is not being designed.
      const boilerRoom = await add(projectId, userId, "location", "Boiler Room");
      const gauge = await waitingPair("Boiler Rm", "Gauge");
      await assets.mergeAssets({ keepId: boilerRoom.id, mergeId: gauge.location.id, userId });
      expect(await queued("asset.look.generate", "lookId", gauge.lookId)).toBe(1);

      // A wake that never came: the look can still be started by hand.
      const deck = await waitingPair("Deck", "Rope");
      expect(await detail(deck.prop.id, userId)).toMatchObject({
        waitingFor: ["Deck"],
        canStartWithoutWaiting: true,
      });
      await getDb()
        .update(s.assetLook)
        .set({ status: "failed", failure: "x" })
        .where(eq(s.assetLook.assetId, deck.location.id));
      expect(await detail(deck.prop.id, userId)).toMatchObject({
        waitingFor: [],
        canStartWithoutWaiting: true,
      });
      expect(await assets.startWithoutWaiting({ assetId: deck.prop.id, userId })).toBe(
        "generating",
      );
      expect(await queued("asset.look.generate", "lookId", deck.lookId)).toBe(1);
      expect((await detail(deck.prop.id, userId)).canStartWithoutWaiting).toBe(false);
      // A look that never waited is never offered the button.
      const tomas = await add(projectId, userId);
      await assets.startLookFromPrompt({ assetId: tomas.id, userId, prompt: "A man" });
      expect((await detail(tomas.id, userId)).canStartWithoutWaiting).toBe(false);

      // Removed by the detector (an incremental answer that drops the location).
      const pier = await getDb()
        .insert(s.asset)
        .values({
          projectId,
          kind: "location",
          name: "Harbour Pier",
          origin: "detected",
          details: { sceneRefs: ["1"] },
          displayOrder: 99,
        })
        .returning();
      const pierId = pier[0]?.id ?? "";
      await assets.startLookFromPrompt({ assetId: pierId, userId, prompt: "A pier" });
      const lantern = await add(projectId, userId, "prop", "Lantern");
      await getDb()
        .update(s.asset)
        .set({ details: { locationIds: ["Harbour Pier"] } })
        .where(eq(s.asset.id, lantern.id));
      const lanternLook = await assets.startLookFromPrompt({
        assetId: lantern.id,
        userId,
        prompt: "An oil lantern",
      });
      expect(await queued("asset.look.generate", "lookId", lanternLook?.id ?? "")).toBe(0);
      const state = await assets.loadDetectorState(projectId);
      const view = assets.detectorView(state.rows, []);
      const pierTemp = view.tempByName.get("location:harbour pier") ?? "";
      expect(pierTemp).not.toBe("");
      const output: AssetDetectorOutput = {
        output_version: "output_21",
        mode: "incremental",
        scene_index: [],
        characters: [],
        locations: [],
        props: [],
        diff: { added: [], updated: [], removed: [pierTemp] },
        summary: {
          scene_count: 0,
          character_count: 0,
          location_count: 0,
          prop_count: 0,
        },
        applied_fixes: [],
        assumptions: [],
        warnings: [],
      };
      const result = await assets.applyDetection({
        projectId,
        scriptVersionId: await fixtures.acceptedScript(projectId, userId),
        damiRunId: null,
        mode: "incremental",
        output,
        byTemp: view.byTemp,
      });
      expect(result.removed).toBe(1);
      expect(await queued("asset.look.generate", "lookId", lanternLook?.id ?? "")).toBe(1);
    });

    it("a pack sent back to its designer stops; a failed view retries with its job; plans are capped", async () => {
      const { userId, projectId } = await setup(600);
      const { asset: cabin } = await acceptLocation(userId, projectId, "Ferry Cabin");
      const sheetId = (await detail(cabin.id, userId)).sheets[0]?.id ?? "";
      await assetSheetPlanHandler.run({ sheetId }, jobContext());
      await advancePack(sheetId);
      const reverse = (await detail(cabin.id, userId)).packViews[0];
      expect(reverse?.status).toBe("in_review");
      const generations = async () =>
        (
          await getDb()
            .select({ id: s.generation.id })
            .from(s.generation)
            .where(eq(s.generation.projectId, projectId))
        ).length;
      const before = await generations();
      expect(
        await assets.submitSheetViewReview({
          viewRowId: reverse?.id ?? "",
          userId,
          decision: "rejected",
          selections: [{ code: "LSX01", customText: "A second window on the east wall" }],
        }),
      ).toBe("generating");
      const views = await getDb()
        .select({ status: s.assetSheetView.status })
        .from(s.assetSheetView)
        .where(eq(s.assetSheetView.sheetId, sheetId));
      expect(views.length).toBeGreaterThan(1);
      expect(views.every((v) => v.status === "superseded")).toBe(true);
      // An advance still queued for the old pack requests nothing (no credits spent).
      await advancePack(sheetId);
      expect(await generations()).toBe(before);

      // A view that failed is retried with its advance sent in the same transaction, and the
      // failed attempt stays on record.
      const { asset: room } = await acceptLocation(userId, projectId, "Engine Room");
      const roomSheetId = (await detail(room.id, userId)).sheets[0]?.id ?? "";
      await assetSheetPlanHandler.run({ sheetId: roomSheetId }, jobContext());
      const planned = (await detail(room.id, userId)).packViews[0];
      expect(await assets.failSheetView(planned?.id ?? "", "The view could not be made.")).toBe(
        true,
      );
      await getDb().execute(
        sql.raw(
          `delete from ${jobSchema}.job where name = 'asset.sheet.views.advance' ` +
            `and data->>'sheetId' = '${roomSheetId}'`,
        ),
      );
      expect(await assets.retrySheetView({ viewRowId: planned?.id ?? "", userId })).toBe(
        "sheet_review",
      );
      expect(await queued("asset.sheet.views.advance", "sheetId", roomSheetId)).toBe(1);
      expect((await viewRow(planned?.id ?? "")).status).toBe("planned");
      const [retried] = await getDb()
        .select({ payload: s.projectEvent.payload })
        .from(s.projectEvent)
        .where(
          and(
            eq(s.projectEvent.projectId, projectId),
            eq(s.projectEvent.type, "asset.sheet_view_retried"),
          ),
        );
      expect(retried?.payload).toMatchObject({
        viewRowId: planned?.id,
        previousFailure: "The view could not be made.",
        previousGenerationId: null,
      });

      // A plan of more than 20 views, or with a view twice, is refused.
      const spec = (await sheetRow(roomSheetId)).spec;
      if (!spec) throw new Error("no plan");
      const plannedView = (viewId: string) => ({
        viewId,
        label: viewId,
        purpose: null,
        prompt: "A view",
        aspectRatio: "16:9" as const,
        referenceOrder: [],
        dependsOn: [],
        mustShow: [],
        mustNotShow: [],
        reviewFocus: [],
        newHypotheses: [],
        editMode: "full" as const,
        warnings: [],
      });
      await expect(
        assets.storePackPlan({
          sheetId: roomSheetId,
          spec,
          views: Array.from({ length: 21 }, (_, i) => plannedView(`view_${i}`)),
          damiRunId: crypto.randomUUID(),
        }),
      ).rejects.toThrow(/at most 20/);
      await expect(
        assets.storePackPlan({
          sheetId: roomSheetId,
          spec,
          views: [plannedView("reverse_wide"), plannedView("reverse_wide")],
          damiRunId: crypto.randomUUID(),
        }),
      ).rejects.toThrow(/same view twice/);

      // An older pack with more than 20 views is listed whole, never cut by view id.
      await getDb()
        .insert(s.assetSheetView)
        .values(
          Array.from({ length: 22 }, (_, i) => ({
            sheetId,
            assetId: cabin.id,
            projectId,
            viewId: `legacy_${String(i).padStart(2, "0")}`,
            versionNumber: 1,
            label: `Legacy ${i}`,
            position: 100 + i,
            status: "superseded" as const,
          })),
        );
      const all = await latestViewRows(getDb(), sheetId);
      expect(all.filter((v) => v.viewId.startsWith("legacy_"))).toHaveLength(22);
      expect(all.length).toBeGreaterThan(22);
    });
  },
);
