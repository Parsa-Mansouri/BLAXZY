/**
 * A shot revised from a clip review (the router chose "revise") has no draft until its new block
 * version is prepared. This is the link: when a version becomes ready and the version before it
 * was rejected by a take review that asked for a revision, the new version is approved (the user
 * already approved the shot and asked for changes to its clip) and its draft take is created,
 * charged with the price the user confirmed when they asked for the changes. One draft per
 * rejected take: a take that already has a child is never answered twice.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { approveBlocks, getPreviousVersion, type PromptBlock } from "@/server/blocks";
import type { DbTx } from "@/server/db/client";
import { blockTake, project, review } from "@/server/db/schema";
import { enqueue, takeGenerate } from "@/server/jobs";
import { logProjectEvent } from "@/server/projects";
import { insertTake, type TakeRow } from "./takes";

/** The draft a freshly prepared block version starts, or null when it answers no clip review. */
export async function startDraftAfterRevision(
  tx: DbTx,
  block: PromptBlock,
): Promise<TakeRow | null> {
  if (
    block.productionState !== "ready" ||
    block.supersededAt ||
    block.stale ||
    block.versionNumber <= 1 ||
    !block.productionPrompt
  ) {
    return null;
  }
  const previous = await getPreviousVersion(block, tx);
  if (!previous) return null;
  // The newest clip review of the previous version that asked for a revision.
  const [asked] = await tx
    .select({ take: blockTake, confirmedCredits: review.confirmedCredits })
    .from(review)
    .innerJoin(blockTake, eq(blockTake.id, review.subjectId))
    .where(
      and(
        eq(review.subjectType, "generation"),
        eq(review.decision, "rejected"),
        eq(blockTake.blockId, previous.id),
        sql`${review.revisionRequest}->>'source' = 'take_review'`,
      ),
    )
    .orderBy(desc(review.createdAt))
    .limit(1);
  if (!asked) return null;
  // Taking the project's lock first serialises take numbering (and a duplicate run).
  await tx
    .select({ id: project.id })
    .from(project)
    .where(eq(project.id, block.projectId))
    .for("update");
  const [answered] = await tx
    .select({ id: blockTake.id })
    .from(blockTake)
    .where(and(eq(blockTake.parentId, asked.take.id), eq(blockTake.stage, "draft")))
    .limit(1);
  if (answered) return null;
  await approveBlocks([block.id], tx);
  const draft = await insertTake(tx, {
    projectId: block.projectId,
    blockId: block.id,
    lineageId: block.lineageId,
    stage: "draft",
    status: "pending",
    parentId: asked.take.id,
    prompt: block.productionPrompt,
    damiRunId: block.productionDamiRunId,
    route: "revise",
    confirmedCredits: asked.confirmedCredits,
  });
  await logProjectEvent(tx, {
    projectId: block.projectId,
    userId: null,
    type: "production.take_requested",
    payload: {
      lineageId: block.lineageId,
      blockId: block.id,
      takeId: draft.id,
      parentTakeId: asked.take.id,
      route: "revise",
    },
  });
  await enqueue(takeGenerate, { takeId: draft.id }, { tx });
  return draft;
}
