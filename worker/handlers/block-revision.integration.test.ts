/**
 * Block Revision wired into Production, against the local Postgres and S3 store in sample mode:
 * a rejected directed block is revised by `block.revise` (the note, the regenerate flag, the
 * neighbours' hand-offs and the change log), a take-review-sourced request written directly
 * reaches the dami through `requestBlockRevision`, `next_block_needs_update` is surfaced and the
 * next shot updated on request, an asset change on a directed block is an asset correction, and
 * an old block without Director data fails clearly. Handlers run directly; follow-up jobs go to a
 * throwaway queue schema.
 */
import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { servicesReachable } from "../../src/server/test-support/generation-fixtures";
import {
  dropSchema,
  jobContext,
  pointQueueAtThrowawaySchema,
} from "../../src/server/test-support/script-fixtures";

const jobSchema = pointQueueAtThrowawaySchema();
const reachable = await servicesReachable();

describe.skipIf(!reachable)(
  "block revision (integration, sample mode)",
  { timeout: 120_000 },
  async () => {
    const { autoConfirm, PRODUCTION_SPEND_FUNCTIONS } =
      await import("../../src/server/test-support/confirm-fixtures");
    const production = autoConfirm(
      await import("../../src/server/production"),
      PRODUCTION_SPEND_FUNCTIONS,
    );
    const damis = await import("../../src/server/damis");
    const { CLAUDE_MODELS } = await import("../../src/server/damis/framework/models");
    const { closeJobQueue } = await import("../../src/server/jobs");
    const { closeDb, getDb } = await import("../../src/server/db/client");
    const s = await import("../../src/server/db/schema");
    const { and, asc, eq, isNull, sql } = await import("drizzle-orm");
    const { blockReviseHandler, productionPrepareHandler } = await import("./production-prepare");
    const { createProductionFixtures } =
      await import("../../src/server/test-support/production-fixtures");
    const fixtures = createProductionFixtures();

    afterAll(async () => {
      await fixtures.cleanup();
      await closeJobQueue();
      await dropSchema(jobSchema);
      await closeDb();
    });

    async function drain(projectId: string): Promise<void> {
      for (let round = 0; round < 8; round++) {
        const pending = await getDb()
          .select({ id: s.promptBlock.id })
          .from(s.promptBlock)
          .where(
            and(
              eq(s.promptBlock.projectId, projectId),
              isNull(s.promptBlock.supersededAt),
              eq(s.promptBlock.productionState, "pending"),
            ),
          );
        if (pending.length === 0) return;
        for (const { id } of pending) {
          await productionPrepareHandler.run({ blockId: id }, jobContext());
          await blockReviseHandler.run({ blockId: id }, jobContext());
        }
      }
      throw new Error("drain did not settle");
    }

    /** A directed project with every block prepared and waiting for review. */
    async function setup() {
      const userId = await fixtures.newUser();
      const { projectId, scriptVersionId } = await fixtures.newProductionProject(userId);
      const directed = await fixtures.setDirectedBlocks(projectId, userId, scriptVersionId);
      await production.ensurePrepared(projectId, userId);
      await drain(projectId);
      return { userId, projectId, scriptVersionId, ...directed };
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

    /** The inputs of the project's Block Revision runs, oldest first. */
    async function revisionInputs(projectId: string) {
      const rows = await getDb()
        .select({ input: s.damiRun.input })
        .from(s.damiRun)
        .where(and(eq(s.damiRun.projectId, projectId), eq(s.damiRun.damiKey, "block-revision")))
        .orderBy(asc(s.damiRun.createdAt));
      return rows.map((r) => damis.blockRevisionInputSchema.parse(r.input));
    }

    const ISSUE = {
      issue_id: "i1",
      cause: "prompt",
      kind: "cuts",
      severity: "major",
      window: "0-5s",
      planned: "One continuous shot.",
      observed: "A cut at 3 s.",
      label: "An unplanned cut",
    };

    it("a rejected block is revised from the note, with the neighbours' hand-offs and a change log", async () => {
      const { userId, projectId } = await setup();
      const [l1, l2] = await lineages(projectId);
      if (!l1 || !l2) throw new Error("blocks missing");
      const before = await detail(l2, userId);
      expect(before.revision).toBeNull();
      const note = "Hold the camera closer on her hands.";
      expect(
        await production.submitBlockReview({ lineageId: l2, userId, decision: "rejected", note }),
      ).toBe("preparing");
      await expect(
        production.submitBlockReview({ lineageId: l2, userId, decision: "rejected", note }),
      ).rejects.toThrow(production.ProductionInputError);

      const [row] = await getDb().select().from(s.review).where(eq(s.review.subjectId, before.id));
      expect(row).toMatchObject({ decision: "rejected", note });
      expect(row?.revisionRequest).toMatchObject({
        source: "block_review",
        note,
        regenerate: false,
      });

      await drain(projectId);
      const [input] = await revisionInputs(projectId);
      if (!input) throw new Error("no revision run");
      expect(input.requests).toEqual({ director_notes: note });
      expect(damis.blockRevisionRunContext(input).model).toBe(CLAUDE_MODELS.sonnet);
      // The neighbours are the current blocks around it.
      const first = await detail(l1, userId);
      expect(input.neighbours.previous?.end_state).toBe(first.direction?.end_state);
      expect(input.neighbours.next).not.toBeNull();
      expect(input.script_excerpt).toBe(before.scriptExcerpt.trim());

      const after = await detail(l2, userId);
      expect(after.id).not.toBe(before.id);
      expect(after.stage).toBe("block_review");
      expect(after.revision?.changeLog.length).toBeGreaterThan(0);
      expect(after.notes).toEqual(expect.arrayContaining(after.revision?.changeLog ?? []));
      expect(after.direction?.shots.length).toBeGreaterThan(0);
      expect(after.direction?.scene_heading).toBe(before.direction?.scene_heading);
      expect(after.prompt).not.toMatch(/@char_|@loc_|@prop_/);
      expect(after.prompt).toMatch(/<<<image_1>>>/);
    });

    it("regenerate needs no note and selects Opus", async () => {
      const { userId, projectId } = await setup();
      const [l1] = await lineages(projectId);
      if (!l1) throw new Error("blocks missing");
      await production.submitBlockReview({
        lineageId: l1,
        userId,
        decision: "rejected",
        regenerate: true,
      });
      await drain(projectId);
      const [input] = await revisionInputs(projectId);
      if (!input) throw new Error("no revision run");
      expect(input.requests).toEqual({ regenerate: true });
      expect(damis.blockRevisionRunContext(input).model).toBe(CLAUDE_MODELS.opus);
      expect((await detail(l1, userId)).stage).toBe("block_review");
      // Without regenerate a rejection still needs words.
      await expect(
        production.submitBlockReview({ lineageId: l1, userId, decision: "rejected" }),
      ).rejects.toThrow(production.ProductionInputError);
    });

    it("a take-review request reaches the dami through requestBlockRevision", async () => {
      const { userId, projectId } = await setup();
      const [l1] = await lineages(projectId);
      if (!l1) throw new Error("blocks missing");
      const block = await detail(l1, userId);
      const takeId = crypto.randomUUID();
      const [reviewRow] = await getDb()
        .insert(s.review)
        .values({
          projectId,
          userId,
          subjectType: "generation",
          subjectId: takeId,
          decision: "rejected",
          revisionRequest: {
            source: "take_review",
            takeId,
            regenerate: false,
            observedIssues: [ISSUE],
            timedNotes: [{ fromS: 6, toS: 9, text: "Slower look toward the door." }],
            keep: [{ window: "10-15s", what: "the ending" }],
            note: "Fix the cut.",
          },
        })
        .returning({ id: s.review.id });
      if (!reviewRow) throw new Error("review missing");
      const next = await production.requestBlockRevision({
        blockId: block.id,
        userId,
        reviewId: reviewRow.id,
      });
      expect(next.lineageId).toBe(block.lineageId);
      expect(next.versionNumber).toBe(2);
      await drain(projectId);
      const [input] = await revisionInputs(projectId);
      if (!input) throw new Error("no revision run");
      expect(input.requests.observed_issues).toEqual(["i1"]);
      expect(input.requests.director_notes).toBe("Fix the cut.");
      expect(input.video_review?.issues[0]).toMatchObject({ kind: "cuts", window: "0-5s" });
      expect(input.timed_notes).toEqual([
        { from_s: 6, to_s: 9, category: "directing", note: "Slower look toward the door." },
      ]);
      expect(input.keep).toEqual([{ window: "10-15s", what: "the ending" }]);
      const revised = await detail(l1, userId);
      expect(revised.stage).toBe("block_review");
      expect(revised.revision?.changeLog.length).toBeGreaterThan(0);
      // The job found the request on a review of the block version itself.
      const [link] = await getDb()
        .select()
        .from(s.review)
        .where(and(eq(s.review.subjectType, "prompt_block"), eq(s.review.subjectId, block.id)));
      expect(link?.revisionRequest).toMatchObject({ source: "take_review", takeId });
    });

    it("a second revision carries the earlier attempts' failed fixes", async () => {
      const { userId, projectId } = await setup();
      const [l1] = await lineages(projectId);
      if (!l1) throw new Error("blocks missing");
      const ask = async (blockId: string) => {
        const [r] = await getDb()
          .insert(s.review)
          .values({
            projectId,
            userId,
            subjectType: "prompt_block",
            subjectId: blockId,
            decision: "rejected",
            revisionRequest: {
              source: "take_review",
              regenerate: false,
              observedIssues: [ISSUE],
              timedNotes: [],
              keep: [],
            },
          })
          .returning({ id: s.review.id });
        if (!r) throw new Error("review missing");
        return production.requestBlockRevision({ blockId, userId, reviewId: r.id });
      };
      await ask((await detail(l1, userId)).id);
      await drain(projectId);
      await ask((await detail(l1, userId)).id);
      await drain(projectId);
      const inputs = await revisionInputs(projectId);
      expect(inputs).toHaveLength(2);
      expect(inputs[0]?.attempt_history).toBeUndefined();
      expect(inputs[1]?.attempt_history?.[0]?.fixes[0]).toMatchObject({
        issue_kind: "cuts",
        window: "0-5s",
        outcome: "not_fixed",
      });
    });

    it("next_block_needs_update is shown and the next shot is updated on request", async () => {
      const { userId, projectId } = await setup();
      const [l1, l2] = await lineages(projectId);
      if (!l1 || !l2) throw new Error("blocks missing");
      await expect(production.requestNextShotUpdate({ lineageId: l1, userId })).rejects.toThrow(
        /does not need an update/,
      );
      await production.submitBlockReview({
        lineageId: l1,
        userId,
        decision: "rejected",
        note: "Wider.",
      });
      await drain(projectId);
      // The sample never moves an ending: set the flag as the real dami would report it.
      await getDb().execute(
        sql`update prompt_block set direction = jsonb_set(direction, '{revision,flags,next_block_needs_update}', 'true')
          where lineage_id = ${l1} and superseded_at is null`,
      );
      const flagged = await detail(l1, userId);
      expect(flagged.revision?.nextNeedsUpdate).toBe(true);
      const nextBefore = await detail(l2, userId);

      expect(await production.requestNextShotUpdate({ lineageId: l1, userId })).toBe(l2);
      await drain(projectId);
      const nextAfter = await detail(l2, userId);
      expect(nextAfter.id).not.toBe(nextBefore.id);
      expect(nextAfter.stage).toBe("block_review");
      const last = (await revisionInputs(projectId)).at(-1);
      expect(last?.requests.director_notes).toContain("now ends differently");
      expect(last?.neighbours.previous?.end_state).toBe(flagged.direction?.end_state);
      // Handled: the notice is gone and a second request is refused.
      expect((await detail(l1, userId)).revision?.nextNeedsUpdate).toBe(false);
      await expect(production.requestNextShotUpdate({ lineageId: l1, userId })).rejects.toThrow(
        /does not need an update|already updated/,
      );
    });

    it("an asset change on a directed block is an asset correction; a reorder is only a new binding", async () => {
      const { userId, projectId } = await setup();
      const [l1] = await lineages(projectId);
      if (!l1) throw new Error("blocks missing");
      const block = await detail(l1, userId);
      const attached = block.assets.map((a) => a.assetId);
      expect(attached.length).toBeGreaterThan(1);

      // The same assets in another order: code only, no Block Revision call.
      const reordered = await production.setBlockAssets({
        lineageId: l1,
        userId,
        assetIds: [...attached].reverse(),
      });
      expect(reordered?.stage).toBe("preparing");
      await drain(projectId);
      expect(await revisionInputs(projectId)).toHaveLength(0);

      // Removing one: the Director's id is asked to be removed from the shot.
      const kept = attached.slice(0, -1);
      const stillThere = (await detail(l1, userId)).assets.map((a) => a.assetId);
      const order = stillThere.filter((id) => kept.includes(id));
      await production.setBlockAssets({ lineageId: l1, userId, assetIds: order });
      await drain(projectId);
      const [input] = await revisionInputs(projectId);
      if (!input) throw new Error("no revision run");
      expect(input.requests.asset_correction?.remove).toHaveLength(1);
      expect(input.requests.asset_correction?.add).toEqual([]);
      const after = await detail(l1, userId);
      expect(after.stage).toBe("block_review");
      expect(after.assets.map((a) => a.assetId)).toEqual(order);
      // The sample does not rewrite assets; it says so instead of pretending.
      expect(after.revision?.notApplied.length).toBeGreaterThan(0);
    });

    it("a block without Director data is refused up front, and a stray job fails clearly", async () => {
      const userId = await fixtures.newUser();
      const { projectId, scriptVersionId } = await fixtures.newProductionProject(userId);
      await fixtures.readyAsset(projectId, userId, "character", "Tomas");
      await fixtures.setBlocks(projectId, scriptVersionId, [
        {
          excerpt: "TOMAS climbs.",
          prompt: "Tomas [character:Tomas] climbs.",
          assetRefs: ["character:Tomas"],
        },
      ]);
      await production.ensurePrepared(projectId, userId);
      await drain(projectId);
      const [l1] = await lineages(projectId);
      if (!l1) throw new Error("blocks missing");
      await expect(
        production.submitBlockReview({ lineageId: l1, userId, decision: "rejected", note: "x" }),
      ).rejects.toThrow(/before the Director existed/);
      const block = await detail(l1, userId);
      const [r] = await getDb()
        .insert(s.review)
        .values({
          projectId,
          userId,
          subjectType: "prompt_block",
          subjectId: block.id,
          decision: "rejected",
          revisionRequest: {
            source: "block_review",
            note: "x",
            regenerate: false,
            observedIssues: [],
            timedNotes: [],
            keep: [],
          },
        })
        .returning({ id: s.review.id });
      if (!r) throw new Error("review missing");
      await production.requestBlockRevision({ blockId: block.id, userId, reviewId: r.id });
      await drain(projectId);
      const failed = await detail(l1, userId);
      expect(failed.stage).toBe("prepare_failed");
      expect(failed.failure).toMatch(/before the Director existed/);
      expect(await revisionInputs(projectId)).toHaveLength(0);
    });
  },
);
