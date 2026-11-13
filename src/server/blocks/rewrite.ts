/** Rewriting an asset ref (a rename or a merge) in the current blocks, append-only. */
import { and, eq, gt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { assetTag, replaceAssetTag } from "@/server/damis";
import { type DbTx, getDb } from "@/server/db/client";
import { promptBlock } from "@/server/db/schema";
import { logProjectEvent } from "@/server/projects";
import { current, parse, uuid } from "./common";

/** The event `rewriteAssetRefs` logs: a ref renamed or merged into another, from then on. */
export const REF_REWRITTEN_EVENT = "asset.ref_rewritten";

/**
 * Replaces the asset reference `from` with `to` (both `kind:Name`) in the project's current
 * blocks, append-only: each affected block gets a new version (same lineage, next version number)
 * and the old row is superseded. The rewrite covers `assetRefs`, the `[kind:Name]` tags in the
 * prompt, and the production preparation (`productionAssetRefs`, tags in `productionPrompt`), which
 * is carried with its approval: a rename or merge changes no content. A block that already lists
 * `to` keeps it once; when its prepared refs held both, the token numbering no longer fits and the
 * block is prepared again (as it is when its preparation was still running). Logs
 * `asset.ref_rewritten` so later script edits compare against the new refs. Pass `executor` to run
 * inside the caller's transaction (renames, merges). Returns the number of blocks rewritten.
 */
export async function rewriteAssetRefs(
  input: { projectId: string; from: string; to: string },
  executor?: DbTx,
): Promise<number> {
  const { projectId, from, to } = parse(
    z.object({
      projectId: uuid,
      from: z.string().min(3).max(300),
      to: z.string().min(3).max(300),
    }),
    input,
  );
  if (from === to) return 0;
  const run = async (tx: DbTx): Promise<number> => {
    const fromJson = JSON.stringify([from]);
    const affected = await tx
      .select()
      .from(promptBlock)
      .where(
        and(
          eq(promptBlock.projectId, projectId),
          current,
          or(
            sql`${promptBlock.assetRefs} @> ${fromJson}::jsonb`,
            sql`${promptBlock.productionAssetRefs} @> ${fromJson}::jsonb`,
            gt(sql`strpos(${promptBlock.prompt}, ${assetTag(from)})`, 0),
          ),
        ),
      )
      .for("update");
    const now = new Date();
    for (const block of affected) {
      await tx.update(promptBlock).set({ supersededAt: now }).where(eq(promptBlock.id, block.id));
      const swap = (refs: readonly string[]) => [
        ...new Set(refs.map((ref) => (ref === from ? to : ref))),
      ];
      const prepared = block.productionAssetRefs;
      const clash = prepared !== null && prepared.includes(from) && prepared.includes(to);
      const keepProduction = block.productionState !== "pending" && !clash;
      await tx.insert(promptBlock).values({
        lineageId: block.lineageId,
        versionNumber: block.versionNumber + 1,
        projectId: block.projectId,
        episodeId: block.episodeId,
        scriptVersionId: block.scriptVersionId,
        orderIndex: block.orderIndex,
        title: block.title,
        scriptExcerpt: block.scriptExcerpt,
        prompt: replaceAssetTag(block.prompt, from, to),
        durationSeconds: block.durationSeconds,
        assetRefs: swap(block.assetRefs),
        stale: block.stale,
        staleReason: block.staleReason,
        damiRunId: block.damiRunId,
        ...(keepProduction
          ? {
              productionState: block.productionState,
              productionPrompt:
                block.productionPrompt === null
                  ? null
                  : replaceAssetTag(block.productionPrompt, from, to),
              productionAssetRefs: prepared === null ? null : swap(prepared),
              productionNotes: block.productionNotes,
              productionDamiRunId: block.productionDamiRunId,
              productionFailure: block.productionFailure,
              approvedAt: block.approvedAt,
            }
          : {}),
      });
    }
    await logProjectEvent(tx, {
      projectId,
      userId: null,
      type: REF_REWRITTEN_EVENT,
      payload: { from, to, blocks: affected.length },
    });
    return affected.length;
  };
  return executor ? run(executor) : getDb().transaction(run);
}
