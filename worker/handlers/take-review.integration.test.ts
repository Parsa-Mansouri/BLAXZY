/**
 * The Video Review of generated clips and the router behind a rejection, end to end against the
 * local Postgres and S3 store in sample mode: generation success queues `take.review`, the handler
 * stores frames, the report and the clip's last frame; rejecting a clip is routed (reroll, rebind
 * or revise) and executed; accepting stores PREV_END and marks the next shot with a notice when the end
 * changed. Revisions run through the real Block Revision (sample mode).
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
  "clip review and router (integration)",
  { timeout: 120_000 },
  async () => {
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
    const { and, asc, desc, eq, isNull, inArray, like, sql } = await import("drizzle-orm");
    const { generationRunHandler } = await import("./generation-run");
    const { blockReviseHandler, productionPrepareHandler } = await import("./production-prepare");
    const { takeGenerateHandler } = await import("./production-take");
    const { takeReviewHandler } = await import("./take-review");
    const { productionGenerationHook } = await import("./production-generation-hook");
    const { createProductionFixtures } =
      await import("../../src/server/test-support/production-fixtures");
    const { fixtureDirection, insertTestDirection } =
      await import("../../src/server/test-support/direction-fixtures");
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

    const DIRECTED = {
      excerpt: "NORA, LINA and SAM share breakfast in the kitchen.",
      prompt:
        "SCENE: Kitchen [location:Kitchen]. Nora [character:Nora], Lina [character:Lina] and Sam [character:Sam] eat.",
      assetRefs: ["location:Kitchen", "character:Nora", "character:Lina", "character:Sam"],
      title: "The climb",
      direction: await fixtureDirection(1),
    };
    const NEXT = {
      excerpt: "NORA boils the kettle.",
      prompt:
        "Nora [character:Nora] boils the Blue Kettle [prop:Blue Kettle] in the Kitchen [location:Kitchen]; Lina [character:Lina] and Sam [character:Sam] wait.",
      assetRefs: [
        "location:Kitchen",
        "character:Nora",
        "character:Lina",
        "character:Sam",
        "prop:Blue Kettle",
      ],
      title: "The lamp",
      direction: await fixtureDirection(2),
    };
    const OLD = {
      excerpt: "The beam sweeps the sea.",
      prompt: "SCENE: Kitchen [location:Kitchen]. The light moves across the table.",
      assetRefs: ["location:Kitchen"],
      title: "Beam, sea",
    };

    type Spec = typeof DIRECTED | typeof NEXT | typeof OLD;

    async function setup(shots: Spec[], credits = 1000) {
      const userId = await fixtures.newUser();
      const { projectId, scriptVersionId } = await fixtures.newProductionProject(userId);
      await billing.grantCredits({ userId, amount: credits });
      const nora = await fixtures.readyAsset(projectId, userId, "character", "Nora");
      await fixtures.readyAsset(projectId, userId, "character", "Lina");
      await fixtures.readyAsset(projectId, userId, "character", "Sam");
      await fixtures.readyAsset(projectId, userId, "location", "Kitchen");
      await fixtures.readyAsset(projectId, userId, "prop", "Blue Kettle");
      await fixtures.setBlocks(projectId, scriptVersionId, shots);
      await insertTestDirection(projectId, scriptVersionId);
      const rows = await getDb()
        .select({ lineageId: s.promptBlock.lineageId })
        .from(s.promptBlock)
        .where(and(eq(s.promptBlock.projectId, projectId), isNull(s.promptBlock.supersededAt)))
        .orderBy(asc(s.promptBlock.orderIndex));
      return {
        userId,
        projectId,
        scriptVersionId,
        nora,
        lineages: rows.map((r) => r.lineageId),
      };
    }

    /** Runs pending preparations, take jobs, generations and (unless off) clip reviews to the end. */
    async function drain(projectId: string, options: { review?: boolean } = {}): Promise<void> {
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
            await takeGenerateHandler.run({ takeId: take.id }, jobContext());
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
        if (options.review !== false) {
          const checking = await db
            .select({ id: s.blockTake.id })
            .from(s.blockTake)
            .where(
              and(eq(s.blockTake.projectId, projectId), eq(s.blockTake.autoReview, "pending")),
            );
          for (const { id } of checking) {
            await takeReviewHandler.run({ takeId: id }, jobContext());
            worked = true;
          }
        }
        if (!worked) return;
      }
      throw new Error("drain did not settle");
    }

    async function startDrafts(projectId: string, userId: string, options?: { review?: boolean }) {
      await production.ensurePrepared(projectId, userId);
      await drain(projectId, options);
      await production.approveAllBlocks({ projectId, userId });
      const quote = await production.quoteProduction(projectId, userId);
      if (!quote) throw new Error("quote missing");
      await production.startDrafts({ projectId, userId, expectedCredits: quote.drafts.credits });
      await drain(projectId, options);
    }

    async function latestTake(lineageId: string) {
      const [row] = await getDb()
        .select()
        .from(s.blockTake)
        .where(eq(s.blockTake.lineageId, lineageId))
        .orderBy(desc(s.blockTake.takeNumber))
        .limit(1);
      if (!row) throw new Error("no take");
      return row;
    }

    async function takeRow(takeId: string) {
      const [row] = await getDb().select().from(s.blockTake).where(eq(s.blockTake.id, takeId));
      if (!row) throw new Error("take missing");
      return row;
    }

    async function currentBlock(lineageId: string) {
      const block = await blocks.getCurrentBlock(lineageId);
      if (!block) throw new Error("block missing");
      return block;
    }

    async function reviewRows(takeId: string) {
      return getDb().select().from(s.review).where(eq(s.review.subjectId, takeId));
    }

    /** The take's report with its issues and keep points replaced (a report the router can act on). */
    async function craftReport(
      takeId: string,
      patch: Partial<
        Pick<
          import("../../src/server/damis").VideoReviewOutput,
          "issues" | "identity" | "keep_candidates"
        >
      >,
    ) {
      const take = await takeRow(takeId);
      const base = take.reviewReport;
      if (!base) throw new Error("the take has no report");
      await getDb()
        .update(s.blockTake)
        .set({ reviewReport: { ...base, verdict: "needs_fix", ...patch }, autoReview: "ready" })
        .where(eq(s.blockTake.id, takeId));
    }

    const issue = (
      id: string,
      cause: "ai_artifact" | "binding_suspect" | "instruction_miss",
      kind: import("../../src/server/damis").IssueKind,
      window = "0-5s",
    ) => ({
      issue_id: id,
      cause,
      kind,
      severity: "major" as const,
      from_s: 0.2,
      to_s: 0.8,
      window,
      planned: "As the plan says.",
      observed: "Not as planned.",
      evidence: ["f01"],
      review_option_id: "",
      label: `Finding ${id}.`,
      suggested_route:
        cause === "ai_artifact"
          ? ("reroll" as const)
          : cause === "binding_suspect"
            ? ("rebind" as const)
            : ("revise" as const),
    });

    /** How many block versions the project has (a revision adds one). */
    async function versionCount(projectId: string): Promise<number> {
      const rows = await getDb()
        .select({ id: s.promptBlock.id })
        .from(s.promptBlock)
        .where(eq(s.promptBlock.projectId, projectId));
      return rows.length;
    }

    async function jobsFor(name: string, takeId: string): Promise<number> {
      const result = await getDb().execute<{ n: number }>(
        sql`select count(*)::int as n from ${sql.raw(jobSchema)}.job
          where name = ${name} and data->>'takeId' = ${takeId}`,
      );
      return Number(result.rows[0]?.n ?? 0);
    }

    /* ------------------------------------------------------------------------------------ */

    it("reviews a generated clip: frames, report and last frame; old blocks are skipped", async () => {
      const { userId, projectId, lineages } = await setup([DIRECTED, OLD]);
      const [l1, l2] = lineages;
      if (!l1 || !l2) throw new Error("blocks missing");
      await startDrafts(projectId, userId, { review: false });

      // The hook marked the directed take pending and queued its review; the old block has none.
      const directed = await latestTake(l1);
      expect(directed).toMatchObject({
        status: "in_review",
        autoReview: "pending",
        reviewReport: null,
      });
      expect(await jobsFor("take.review", directed.id)).toBe(1);
      const old = await latestTake(l2);
      expect(old).toMatchObject({ status: "in_review", autoReview: "skipped" });
      expect(await jobsFor("take.review", old.id)).toBe(0);
      // The user can decide at once: the screen shows "checking" and no findings yet.
      const detailBefore = await production.getBlockDetail(l1, userId);
      expect(detailBefore?.takes[0]?.review).toMatchObject({ state: "pending", findings: [] });

      await takeReviewHandler.run({ takeId: directed.id }, jobContext());
      const reviewed = await takeRow(directed.id);
      expect(reviewed.autoReview).toBe("ready");
      expect(reviewed.reviewReport).toMatchObject({ dami: "video_review", block_id: 1 });
      expect(reviewed.lastFrameFileId).not.toBeNull();
      // Frames were stored as files of the project (named by take, frame and second).
      const frames = await getDb()
        .select({ name: s.file.originalName })
        .from(s.file)
        .where(and(eq(s.file.projectId, projectId), like(s.file.originalName, "take-%-f%.jpg")));
      expect(frames.length).toBeGreaterThanOrEqual(3);
      // The screen's view: the report as plain sentences.
      const view = (await production.getBlockDetail(l1, userId))?.takes[0]?.review;
      expect(view?.state).toBe("ready");
      expect(view?.findings.length).toBe(reviewed.reviewReport?.issues.length);
      // Running it again changes nothing.
      await takeReviewHandler.run({ takeId: directed.id }, jobContext());
      expect((await takeRow(directed.id)).reviewReport).toEqual(reviewed.reviewReport);
      // The take without direction is untouched.
      await takeReviewHandler.run({ takeId: old.id }, jobContext());
      expect(await takeRow(old.id)).toMatchObject({ autoReview: "skipped", lastFrameFileId: null });
    });

    it("a failed review never blocks the user", async () => {
      const { userId, projectId, lineages } = await setup([DIRECTED]);
      const [l1] = lineages;
      if (!l1) throw new Error("blocks missing");
      await startDrafts(projectId, userId, { review: false });
      const take = await latestTake(l1);
      // The clip file cannot be read as a video.
      const notVideo = await storage.putFileBytes({
        ownerId: userId,
        projectId,
        name: "x.txt",
        mimeType: "text/plain",
        purpose: "script_document",
        bytes: new TextEncoder().encode("not a clip"),
      });
      await getDb()
        .update(s.blockTake)
        .set({ fileId: notVideo.id })
        .where(eq(s.blockTake.id, take.id));

      // A failed attempt with retries left is retried (nothing recorded)...
      await expect(takeReviewHandler.run({ takeId: take.id }, jobContext(1))).rejects.toThrow();
      expect((await takeRow(take.id)).autoReview).toBe("pending");
      // ...and on the last one the review is marked failed.
      await expect(takeReviewHandler.run({ takeId: take.id }, jobContext(3))).rejects.toThrow();
      expect(await takeRow(take.id)).toMatchObject({ autoReview: "failed", status: "in_review" });
      expect((await production.getBlockDetail(l1, userId))?.takes[0]?.review.state).toBe("failed");
      // The user decides as usual.
      expect(
        await production.submitTakeReview({ takeId: take.id, userId, decision: "accepted" }),
      ).toBe("final_generating");
    });

    it("a confirmed rendering artifact is rerolled: same prompt and references, a new render", async () => {
      const { userId, projectId, lineages } = await setup([DIRECTED]);
      const [l1] = lineages;
      if (!l1) throw new Error("blocks missing");
      await startDrafts(projectId, userId);
      const first = await latestTake(l1);
      await craftReport(first.id, {
        issues: [
          issue("a1", "ai_artifact", "artifact_hands"),
          issue("a2", "ai_artifact", "artifact_face"),
        ],
      });

      // A quote says which route will run, at the price of one draft.
      expect(
        await production.quoteTakeSpend({
          takeId: first.id,
          userId,
          action: "reject",
          review: { confirmedIssueIds: ["a1"] },
        }),
      ).toMatchObject({ spends: true, credits: 20, route: "reroll" });

      const callsBefore = await versionCount(projectId);
      expect(
        await production.submitTakeReview({
          takeId: first.id,
          userId,
          decision: "rejected",
          confirmedIssueIds: ["a1"],
        }),
      ).toBe("draft_generating");
      expect(await versionCount(projectId)).toBe(callsBefore);
      const second = await latestTake(l1);
      expect(second).toMatchObject({
        stage: "draft",
        status: "pending",
        route: "reroll",
        parentId: first.id,
        prompt: first.prompt,
        confirmedCredits: 20,
        blockId: first.blockId,
      });
      expect(second.referenceFileIds).toEqual(first.referenceFileIds);
      // The dismissed finding (a2) is not part of the request; the confirmed one is.
      const [rejection] = await reviewRows(first.id);
      expect(rejection?.revisionRequest).toMatchObject({
        source: "take_review",
        takeId: first.id,
        observedIssues: [{ issue_id: "a1", cause: "ai_artifact", kind: "artifact_hands" }],
      });
      expect(rejection?.revisionRequest?.observedIssues).toHaveLength(1);
      expect(rejection?.note).toBeNull();

      // The new render is a new variant of the same request.
      await drain(projectId);
      const rendered = await takeRow(second.id);
      expect(rendered.status).toBe("in_review");
      const [g] = await getDb()
        .select()
        .from(s.generation)
        .where(eq(s.generation.id, rendered.generationId ?? ""));
      expect(JSON.stringify(g?.params)).toContain(second.id);

      // The same artifact again, from the reroll: still a reroll (one reroll before is not a loop).
      await craftReport(second.id, { issues: [issue("b1", "ai_artifact", "artifact_hands")] });
      await production.submitTakeReview({
        takeId: second.id,
        userId,
        decision: "rejected",
        confirmedIssueIds: ["b1"],
      });
      expect(await versionCount(projectId)).toBe(callsBefore);
      await drain(projectId);
      const third = await latestTake(l1);
      expect(third.route).toBe("reroll");

      // A third time in a row is the prompt provoking it: it goes to a revision instead.
      await craftReport(third.id, { issues: [issue("c1", "ai_artifact", "artifact_hands")] });
      expect(
        await production.submitTakeReview({
          takeId: third.id,
          userId,
          decision: "rejected",
          confirmedIssueIds: ["c1"],
        }),
      ).toBe("preparing");
      expect(await versionCount(projectId)).toBe(callsBefore + 1);
      const [loop] = await reviewRows(third.id);
      expect(loop?.revisionRequest).toMatchObject({
        regenerate: true,
        observedIssues: [{ issue_id: "c1", cause: "instruction_miss", kind: "artifact_hands" }],
      });
    });

    it("a wrong reference is rebound in code; a right one sends the confusion to a revision", async () => {
      const { userId, projectId, lineages, nora } = await setup([DIRECTED, NEXT]);
      const [l1, l2] = lineages;
      if (!l1 || !l2) throw new Error("blocks missing");
      await startDrafts(projectId, userId);
      const first = await latestTake(l1);
      const block = await currentBlock(l1);
      const noraIndex = (block.productionAssetRefs ?? []).indexOf("character:Nora");
      expect(noraIndex).toBeGreaterThanOrEqual(0);
      // Nora was attached with her look instead of her accepted sheet.
      const wrong = [...first.referenceFileIds];
      wrong[noraIndex] = nora.lookFileId;
      await getDb()
        .update(s.blockTake)
        .set({ referenceFileIds: wrong })
        .where(eq(s.blockTake.id, first.id));
      const wrongPerson = issue("r1", "binding_suspect", "identity");
      await craftReport(first.id, {
        issues: [wrongPerson],
        identity: [
          {
            character_id: "char_1",
            window: "0-5s",
            result: "matches_other_asset",
            other_asset_id: "loc_1",
            confidence: "high",
            frames: ["f01"],
          },
        ],
      });
      const callsBefore = await versionCount(projectId);
      expect(
        await production.submitTakeReview({
          takeId: first.id,
          userId,
          decision: "rejected",
          confirmedIssueIds: ["r1"],
        }),
      ).toBe("draft_generating");
      expect(await versionCount(projectId)).toBe(callsBefore);
      const rebound = await latestTake(l1);
      expect(rebound).toMatchObject({ route: "rebind", parentId: first.id, prompt: first.prompt });
      expect(rebound.referenceFileIds[noraIndex]).toBe(nora.sheetFileId);
      expect(rebound.referenceFileIds).toEqual(first.referenceFileIds);
      await drain(projectId);
      const [g] = await getDb()
        .select()
        .from(s.generation)
        .where(eq(s.generation.id, (await takeRow(rebound.id)).generationId ?? ""));
      expect(g?.referenceFileIds).toEqual(first.referenceFileIds);

      // Second shot: attached right, yet the model confused the person: an identity miss to revise.
      const other = await latestTake(l2);
      await craftReport(other.id, {
        issues: [issue("r2", "binding_suspect", "identity")],
        identity: [
          {
            character_id: "char_1",
            window: "0-5s",
            result: "matches_none",
            other_asset_id: "",
            confidence: "high",
            frames: ["f01"],
          },
        ],
      });
      expect(
        await production.submitTakeReview({
          takeId: other.id,
          userId,
          decision: "rejected",
          confirmedIssueIds: ["r2"],
        }),
      ).toBe("preparing");
      expect(await versionCount(projectId)).toBe(callsBefore + 1);
      const [row] = await reviewRows(other.id);
      expect(row?.revisionRequest?.observedIssues[0]).toMatchObject({
        issue_id: "r2",
        cause: "instruction_miss",
        kind: "identity",
      });
    });

    it("a missed instruction with a note and a timed note is a revision request; its new shot gets the draft", async () => {
      const { userId, projectId, lineages } = await setup([DIRECTED]);
      const [l1] = lineages;
      if (!l1) throw new Error("blocks missing");
      await startDrafts(projectId, userId);
      const first = await latestTake(l1);
      await craftReport(first.id, {
        issues: [
          issue("m1", "instruction_miss", "action"),
          issue("m2", "instruction_miss", "staging"),
        ],
        keep_candidates: [
          { id: "k1", window: "0-5s", what: "The opening", label: "The opening looks good." },
          { id: "k2", window: "5-10s", what: "The ending", label: "The ending looks good." },
        ],
      });
      const callsBefore = await versionCount(projectId);
      expect(
        await production.submitTakeReview({
          takeId: first.id,
          userId,
          decision: "rejected",
          note: "Make the climb slower.",
          confirmedIssueIds: ["m1"],
          keepIds: ["k1"],
          timedNotes: [{ fromS: 0.2, toS: 0.8, text: "He is already at the top here." }],
        }),
      ).toBe("preparing");
      expect(await versionCount(projectId)).toBe(callsBefore + 1);
      const [rejection] = await reviewRows(first.id);
      // Block Revision found the request on a linking review of the revised version.
      const [linking] = await getDb()
        .select()
        .from(s.review)
        .where(
          and(
            eq(s.review.subjectType, "prompt_block"),
            eq(s.review.subjectId, first.blockId),
            eq(s.review.decision, "rejected"),
          ),
        );
      expect(linking?.revisionRequest).toEqual(rejection?.revisionRequest);
      expect(rejection).toMatchObject({
        decision: "rejected",
        note: "Make the climb slower.",
        confirmedCredits: 20,
      });
      expect(rejection?.revisionRequest).toEqual({
        source: "take_review",
        note: "Make the climb slower.",
        timedNotes: [{ fromS: 0.2, toS: 0.8, text: "He is already at the top here." }],
        observedIssues: [
          {
            issue_id: "m1",
            cause: "instruction_miss",
            kind: "action",
            severity: "major",
            window: "0-5s",
            planned: "As the plan says.",
            observed: "Not as planned.",
            label: "Finding m1.",
          },
        ],
        keep: [{ window: "0-5s", what: "The opening" }],
        takeId: first.id,
        regenerate: false,
      });
      // The rejected take stays as decided; nothing is generated until the shot is prepared again.
      expect((await takeRow(first.id)).status).toBe("rejected");
      expect((await latestTake(l1)).id).toBe(first.id);
      const next = await currentBlock(l1);
      expect(next.versionNumber).toBe(2);
      expect(next.productionState).toBe("pending");

      // Prepared again, the new version is approved and gets its draft with the confirmed price.
      await drain(projectId);
      const draft = await latestTake(l1);
      expect(draft).toMatchObject({
        stage: "draft",
        route: "revise",
        parentId: first.id,
        blockId: next.id,
        confirmedCredits: 20,
        status: "in_review",
      });
      expect((await currentBlock(l1)).approvedAt).not.toBeNull();
      expect((await production.getBlockDetail(l1, userId))?.stage).toBe("draft_review");
    });

    it("refuses a rejection that is not confirmed at the current price, or on a stale shot, or with nothing to act on", async () => {
      const { PriceChangedError } = await import("../../src/server/generation");
      const { userId, projectId, lineages } = await setup([DIRECTED]);
      const [l1] = lineages;
      if (!l1) throw new Error("blocks missing");
      await startDrafts(projectId, userId);
      const take = await latestTake(l1);
      const reject = (input: Record<string, unknown>) =>
        production.submitTakeReview({
          takeId: take.id,
          userId,
          decision: "rejected",
          ...input,
        } as Parameters<typeof production.submitTakeReview>[0]);
      const callsBefore = await versionCount(projectId);

      await expect(reject({ note: "Slower.", expectedCredits: undefined })).rejects.toBeInstanceOf(
        PriceChangedError,
      );
      await expect(reject({ note: "Slower.", expectedCredits: 5 })).rejects.toBeInstanceOf(
        PriceChangedError,
      );
      // Nothing to act on: no note, no timed note, no finding.
      await expect(reject({ confirmedIssueIds: [] })).rejects.toThrow(/Tell us what to change/);
      // The script changed under the shot.
      await getDb()
        .update(s.promptBlock)
        .set({ stale: true, staleReason: "changed" })
        .where(eq(s.promptBlock.lineageId, l1));
      await expect(reject({ note: "Slower." })).rejects.toThrow(/script changed/);
      expect(await versionCount(projectId)).toBe(callsBefore);
      expect(await reviewRows(take.id)).toEqual([]);
      expect(await takeRow(take.id)).toMatchObject({ status: "in_review" });
      expect((await latestTake(l1)).id).toBe(take.id);
    });

    it("accepting stores the clip's last frame, and gives the next shot a hand-off notice when the end changed", async () => {
      const { userId, projectId, lineages } = await setup([DIRECTED, NEXT, OLD]);
      const [l1, l2] = lineages;
      if (!l1 || !l2) throw new Error("blocks missing");
      await startDrafts(projectId, userId);
      const first = await latestTake(l1);
      expect(first.lastFrameFileId).not.toBeNull();

      // The first shot is revised.
      await production.submitTakeReview({
        takeId: first.id,
        userId,
        decision: "rejected",
        note: "Let him stay at the bottom.",
      });
      await drain(projectId);
      const revised = await latestTake(l1);
      // ...and the revised shot now ends with an action still going on.
      const v2 = await currentBlock(l1);
      expect(v2.versionNumber).toBe(2);
      await getDb()
        .update(s.promptBlock)
        .set({
          direction: {
            ...(v2.direction as Record<string, unknown>),
            in_progress_at_end: "Nora is still pouring the tea.",
          },
        })
        .where(eq(s.promptBlock.id, v2.id));
      expect(revised).toMatchObject({ route: "revise", status: "in_review" });
      expect(revised.lastFrameFileId).not.toBeNull();

      // A take that has no last frame yet gets it from its review job after it is accepted.
      await getDb()
        .update(s.blockTake)
        .set({ lastFrameFileId: null })
        .where(eq(s.blockTake.id, revised.id));
      expect(await jobsFor("take.review", revised.id)).toBe(1);
      expect(
        await production.submitTakeReview({ takeId: revised.id, userId, decision: "accepted" }),
      ).toBe("final_generating");
      // The next shot already has a clip and was written from the first plan: it gets a notice
      // (it is not stale: it stays usable).
      const next = await currentBlock(l2);
      expect(next.stale).toBe(false);
      expect(next.handoffNotice).toMatchObject({ blockId: revised.blockId });
      expect((await production.getBlockDetail(l2, userId))?.handoffChanged).toBe(true);
      const events = await getDb()
        .select({ type: s.projectEvent.type })
        .from(s.projectEvent)
        .where(eq(s.projectEvent.projectId, projectId));
      expect(events.map((e) => e.type)).toContain("production.handoff_changed");

      await takeReviewHandler.run({ takeId: revised.id }, jobContext());
      const stored = await takeRow(revised.id);
      expect(stored.lastFrameFileId).not.toBeNull();

      // The next shot's review compares its opening with that frame (PREV_END).
      const nextTake = await latestTake(l2);
      await getDb()
        .update(s.blockTake)
        .set({ autoReview: "pending", reviewReport: null })
        .where(eq(s.blockTake.id, nextTake.id));
      await takeReviewHandler.run({ takeId: nextTake.id }, jobContext());
      const [run] = await getDb()
        .select({ input: s.damiRun.input })
        .from(s.damiRun)
        .where(and(eq(s.damiRun.damiKey, "video-review"), eq(s.damiRun.projectId, projectId)))
        .orderBy(desc(s.damiRun.createdAt))
        .limit(1);
      expect(run?.input).toMatchObject({ previous_end_frame: { fileId: stored.lastFrameFileId } });

      // Updating the shot needs the price of one draft (it has a clip), and nothing happens
      // without it.
      const { PriceChangedError } = await import("../../src/server/generation");
      await expect(
        production.updateShotForHandoff({ lineageId: l2, userId, expectedCredits: 5 }),
      ).rejects.toBeInstanceOf(PriceChangedError);
      await expect(
        production.updateShotForHandoff({ lineageId: l2, userId, expectedCredits: undefined }),
      ).rejects.toBeInstanceOf(PriceChangedError);
      expect((await currentBlock(l2)).versionNumber).toBe(1);
      expect((await takeRow(nextTake.id)).status).toBe("in_review");

      // Confirmed: the shot is revised from the new ending, its old clips are superseded, and
      // the new version gets its draft at the confirmed price. The notice is gone with the version.
      expect(await production.updateShotForHandoff({ lineageId: l2, userId })).toBe(l2);
      expect((await takeRow(nextTake.id)).status).toBe("superseded");
      const v2next = await currentBlock(l2);
      expect(v2next).toMatchObject({ versionNumber: 2, handoffNotice: null, stale: false });
      const [request] = await getDb()
        .select({ request: s.review.revisionRequest, credits: s.review.confirmedCredits })
        .from(s.review)
        .where(eq(s.review.subjectId, nextTake.id));
      expect(request?.credits).toBe(20);
      expect(request?.request?.note).toMatch(/now ends differently/);
      await drain(projectId);
      expect(await latestTake(l2)).toMatchObject({
        stage: "draft",
        route: "revise",
        parentId: nextTake.id,
        blockId: v2next.id,
        confirmedCredits: 20,
        status: "in_review",
      });
      await expect(production.updateShotForHandoff({ lineageId: l2, userId })).rejects.toThrow(
        /does not need an update/,
      );
    });

    it("a shot cut before the Director cannot be revised: the user is told, and nothing is spent", async () => {
      const { userId, projectId, lineages } = await setup([OLD]);
      const [l1] = lineages;
      if (!l1) throw new Error("blocks missing");
      await startDrafts(projectId, userId);
      const take = await latestTake(l1);
      expect(take.autoReview).toBe("skipped");
      await expect(
        production.submitTakeReview({
          takeId: take.id,
          userId,
          decision: "rejected",
          note: "Slower.",
        }),
      ).rejects.toThrow(/cut before the Director existed/);
      expect(await reviewRows(take.id)).toEqual([]);
      expect((await latestTake(l1)).id).toBe(take.id);
      expect(await takeRow(take.id)).toMatchObject({ status: "in_review" });
      // It can still be accepted.
      expect(
        await production.submitTakeReview({ takeId: take.id, userId, decision: "accepted" }),
      ).toBe("final_generating");
    });

    it("gives no notice when the accepted shot ends as planned", async () => {
      const { userId, projectId, lineages } = await setup([DIRECTED, NEXT]);
      const [l1, l2] = lineages;
      if (!l1 || !l2) throw new Error("blocks missing");
      await startDrafts(projectId, userId);
      await production.submitTakeReview({
        takeId: (await latestTake(l1)).id,
        userId,
        decision: "accepted",
      });
      const next = await currentBlock(l2);
      expect(next).toMatchObject({ stale: false, handoffNotice: null });
      expect((await production.getBlockDetail(l2, userId))?.handoffChanged).toBe(false);
    });
  },
);
