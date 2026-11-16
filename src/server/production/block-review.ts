/** Reviewing prepared blocks, and choosing a block's assets before its clip is made. */
import { describeAssetsById } from "@/server/assets";
import { approveBlocks, createNextBlockVersion } from "@/server/blocks";
import { isVoiceRef } from "@/server/damis";
import { getDb } from "@/server/db/client";
import { review } from "@/server/db/schema";
import { logProjectEvent } from "@/server/projects";
import {
  assertWritable,
  isUuid,
  lineageStage,
  lockLineage,
  openProject,
  parse,
  reviewReason,
  STALE_MESSAGE,
} from "./access";
import { ProductionInputError } from "./errors";
import { blockReviewInput, projectInput, setAssetsInput } from "./inputs";
import { BUSY_MESSAGE, NOT_IN_REVIEW } from "./messages";
import { enqueuePreparation } from "./preparation";
import {
  assetCorrectionForChange,
  ASSETS_ONLY_REQUEST,
  directedBlockOf,
  isEmptyCorrection,
  NOT_DIRECTED_MESSAGE,
  requestBlockRevision,
} from "./revision";
import type { RevisionRequest } from "./revision-request";
import { blockView } from "./read";
import type { BlockProductionStage } from "./stage";
import { supersedeLineageTakes } from "./takes";
import { type ProductionBlock, projectStages } from "./views";

const BEFORE_GENERATION: readonly BlockProductionStage[] = [
  "block_review",
  "approved",
  "prepare_failed",
];

/**
 * Sets the assets (references) of a block before generation: ready image assets of the project,
 * in the order given. Creates the block's next version holding the choice and prepares it again,
 * so the prompt's tokens match the new list. Returns the new version (preparing).
 */
export async function setBlockAssets(input: {
  lineageId: string;
  userId: string;
  assetIds: string[];
}): Promise<ProductionBlock | null> {
  const { lineageId, userId, assetIds } = parse(setAssetsInput, input);
  if (!isUuid(lineageId)) return null;
  const ids = [...new Set(assetIds)];
  if (!ids.every(isUuid)) throw new ProductionInputError("One of those assets was not found.");
  const created = await getDb().transaction(async (tx) => {
    const locked = await lockLineage(tx, lineageId, userId);
    if (!locked) return null;
    const { block, project } = locked;
    assertWritable(project);
    if (block.stale) throw new ProductionInputError(STALE_MESSAGE);
    const { stage } = await lineageStage(tx, block);
    if (stage === "preparing") throw new ProductionInputError(BUSY_MESSAGE);
    if (!BEFORE_GENERATION.includes(stage)) {
      throw new ProductionInputError(
        "The assets of a shot can only change before its clip is made.",
      );
    }
    const found = await describeAssetsById(project.id, ids, tx);
    const refs: string[] = [];
    for (const id of ids) {
      const asset = found.get(id);
      if (!asset) throw new ProductionInputError("One of those assets was not found.");
      if (asset.kind === "voice") {
        throw new ProductionInputError(
          `“${asset.name}” is a voice; voices are not attached as images.`,
        );
      }
      if (!asset.ready || !asset.referenceFileId) {
        throw new ProductionInputError(
          `“${asset.name}” is not ready yet. Finish it in Pre-production first.`,
        );
      }
      refs.push(asset.ref);
    }
    const voices = block.assetRefs.filter((r) => isVoiceRef(r));
    const changes = { assetRefs: [...refs, ...voices], productionAssetRefs: refs };
    // A directed block whose cast changed is revised (Block Revision adds, removes or swaps the
    // asset in its text); any other change is only a new binding of references (code, free).
    const correction = await assetCorrectionForChange(block, refs);
    let next;
    if (correction && !isEmptyCorrection(correction)) {
      const [row] = await tx
        .insert(review)
        .values({
          projectId: project.id,
          userId,
          subjectType: "prompt_block",
          subjectId: block.id,
          decision: "rejected",
          revisionRequest: ASSETS_ONLY_REQUEST,
          damiRunId: block.productionDamiRunId,
        })
        .returning({ id: review.id });
      if (!row) throw new Error("review insert returned no row");
      next = await requestBlockRevision({
        tx,
        blockId: block.id,
        userId,
        reviewId: row.id,
        changes,
      });
    } else {
      next = await createNextBlockVersion(block, { ...changes, productionState: "pending" }, tx);
      await enqueuePreparation(tx, next, false);
    }
    await supersedeLineageTakes(tx, project.id, [lineageId]);
    await logProjectEvent(tx, {
      projectId: project.id,
      userId,
      type: "production.block_assets_set",
      payload: {
        lineageId,
        blockId: next.id,
        previousBlockId: block.id,
        assetRefs: refs,
      },
    });
    return next;
  });
  if (!created) return null;
  return blockView(getDb(), created);
}

/**
 * Approves a prepared block, or asks for changes (a note is needed): the block's next
 * version is revised from the review (`block.revise`). An approved block can still be sent back
 * before its draft is made. Reviews go to `review` with the dami run that prepared the prompt.
 */
export async function submitBlockReview(input: {
  lineageId: string;
  userId: string;
  decision: "accepted" | "rejected";
  note?: string;
  /** Ask for a new shot plan instead of a small change (the note is then optional). */
  regenerate?: boolean;
}): Promise<BlockProductionStage | null> {
  const parsed = parse(blockReviewInput, input);
  const { lineageId, userId, decision } = parsed;
  if (!isUuid(lineageId)) return null;
  const regenerate = decision === "rejected" && parsed.regenerate === true;
  const reason =
    regenerate && !parsed.note
      ? { issueCodes: [], note: null }
      : reviewReason(decision, parsed.note);
  const outcome = await getDb().transaction(async (tx) => {
    const locked = await lockLineage(tx, lineageId, userId);
    if (!locked) return null;
    const { block, project } = locked;
    assertWritable(project);
    if (block.stale) throw new ProductionInputError(STALE_MESSAGE);
    const { stage } = await lineageStage(tx, block);
    const allowed = stage === "block_review" || (decision === "rejected" && stage === "approved");
    if (!allowed) throw new ProductionInputError(NOT_IN_REVIEW);
    if (decision === "rejected" && !directedBlockOf(block)) {
      throw new ProductionInputError(NOT_DIRECTED_MESSAGE);
    }
    const request: RevisionRequest | undefined =
      decision === "rejected"
        ? {
            source: "block_review",
            ...(reason.note ? { note: reason.note } : {}),
            timedNotes: [],
            observedIssues: [],
            keep: [],
            regenerate,
          }
        : undefined;
    const [row] = await tx
      .insert(review)
      .values({
        projectId: project.id,
        userId,
        subjectType: "prompt_block",
        subjectId: block.id,
        decision,
        issueCodes: reason.issueCodes,
        note: reason.note,
        revisionRequest: request,
        damiRunId: block.productionDamiRunId,
      })
      .returning({ id: review.id });
    if (!row) throw new Error("review insert returned no row");
    if (decision === "accepted") {
      await approveBlocks([block.id], tx);
      await logProjectEvent(tx, {
        projectId: project.id,
        userId,
        type: "production.block_approved",
        payload: {
          lineageId,
          blockId: block.id,
        },
      });
      return { stage: "approved" as const, next: null };
    }
    const next = await requestBlockRevision({ tx, blockId: block.id, userId, reviewId: row.id });
    await logProjectEvent(tx, {
      projectId: project.id,
      userId,
      type: "production.block_rejected",
      payload: {
        lineageId,
        blockId: block.id,
        nextBlockId: next.id,
        issueCodes: reason.issueCodes,
      },
    });
    return { stage: "preparing" as const, next };
  });
  if (!outcome) return null;
  return outcome.stage;
}

/** Approves every block waiting in block review (one accepted review each). Returns how many. */
export async function approveAllBlocks(input: {
  projectId: string;
  userId: string;
}): Promise<number> {
  const { projectId, userId } = parse(projectInput, input);
  return getDb().transaction(async (tx) => {
    const owned = await openProject(tx, projectId, userId, true);
    if (!owned) return 0;
    assertWritable(owned);
    const { blocks } = await projectStages(tx, projectId);
    const waiting = blocks.filter((b) => b.stage === "block_review").map((b) => b.id);
    const approved = await approveBlocks(waiting, tx);
    if (approved.length === 0) return 0;
    await tx.insert(review).values(
      approved.map((b) => ({
        projectId,
        userId,
        subjectType: "prompt_block" as const,
        subjectId: b.id,
        decision: "accepted" as const,
        damiRunId: b.productionDamiRunId,
      })),
    );
    await logProjectEvent(tx, {
      projectId,
      userId,
      type: "production.blocks_approved",
      payload: {
        count: approved.length,
        lineageIds: approved.map((b) => b.lineageId),
      },
    });
    return approved.length;
  });
}
