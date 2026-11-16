/**
 * What accepting a clip sets in motion beyond the decision itself (inside the decision's
 * transaction, the project and the block locked):
 *
 * - the clip's last frame (PREV_END, the next shot's review compares its opening with it) is made
 *   by the clip's review job; accepting only makes sure that job runs when it has not;
 * - the owner's rule 6, as a notice: when the accepted shot ends differently from the plan the next
 *   shot was written from, and that next shot already has a clip, the next shot gets a hand-off
 *   notice (`prompt_block.handoff_notice`) and the project logs it. It is not "stale" (that means the
 *   script changed and blocks every action): the shot stays usable and the user can update it.
 *
 * "What the next shot was written from" is the Director's original plan for this shot (its first
 * version): the next shot was directed from it. A shot that was revised afterwards and now ends
 * otherwise (staging, or an action still going on at the last frame) breaks that link.
 */
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { getNextCurrentBlock, type PromptBlock } from "@/server/blocks";
import type { DbTx } from "@/server/db/client";
import { blockTake, promptBlock } from "@/server/db/schema";
import { enqueue, takeReview } from "@/server/jobs";
import { logProjectEvent } from "@/server/projects";
import { shouldMarkNextStale, type BlockBoundary } from "./router";
import { usableDirection } from "./take-check";
import type { TakeRow } from "./takes";

const boundarySchema = z.object({
  end_staging: z.unknown(),
  in_progress_at_end: z.unknown().optional(),
});

function boundaryOf(direction: unknown): BlockBoundary | null {
  const parsed = boundarySchema.safeParse(direction);
  return parsed.success && usableDirection(direction) ? parsed.data : null;
}

/** Whether the shot has a clip at all (any take that was not superseded). */
async function hasClip(tx: DbTx, lineageId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: blockTake.id })
    .from(blockTake)
    .where(and(eq(blockTake.lineageId, lineageId), ne(blockTake.status, "superseded")))
    .limit(1);
  return row !== undefined;
}

/** The Director's first version of the lineage's block (what its neighbour was written from). */
async function firstVersionDirection(tx: DbTx, block: PromptBlock): Promise<unknown> {
  if (block.versionNumber === 1) return block.direction;
  const [row] = await tx
    .select({ direction: promptBlock.direction })
    .from(promptBlock)
    .where(and(eq(promptBlock.lineageId, block.lineageId), eq(promptBlock.versionNumber, 1)))
    .limit(1);
  return row?.direction ?? null;
}

/** Runs after `take` of `block` was accepted. Returns the next shot id when it got the notice. */
export async function afterTakeAccepted(
  tx: DbTx,
  input: { block: PromptBlock; take: TakeRow; userId: string },
): Promise<{ noticeBlockId: string | null }> {
  const { block, take, userId } = input;
  if (!take.lastFrameFileId && usableDirection(block.direction)) {
    await enqueue(takeReview, { takeId: take.id }, { tx });
  }
  const accepted = boundaryOf(block.direction);
  const writtenFrom = boundaryOf(await firstVersionDirection(tx, block));
  if (!accepted || !writtenFrom) return { noticeBlockId: null };
  const next = await getNextCurrentBlock(block, tx);
  if (!next || next.stale) return { noticeBlockId: null };
  const stale = shouldMarkNextStale({
    accepted,
    nextBlockWrittenFrom: writtenFrom,
    nextBlockGenerated: await hasClip(tx, next.lineageId),
  });
  if (!stale) return { noticeBlockId: null };
  await tx
    .update(promptBlock)
    .set({ handoffNotice: { takeId: take.id, blockId: block.id, at: new Date().toISOString() } })
    .where(eq(promptBlock.id, next.id));
  await logProjectEvent(tx, {
    projectId: block.projectId,
    userId,
    type: "production.handoff_changed",
    payload: { lineageId: block.lineageId, blockId: block.id, nextBlockId: next.id },
  });
  return { noticeBlockId: next.id };
}
