/**
 * What the Production screens get: a block with its derived stage, prepared prompt, references and
 * thumbnail, and the per-stage counts of a project. Not exported from the module index.
 */
import { describeAssetRefs } from "@/server/assets";
import { listCurrentBlockStates, listScriptResetBlocks, type PromptBlock } from "@/server/blocks";
import { isVoiceRef } from "@/server/damis";
import type { DbExecutor } from "@/server/db/client";
import type { AssetKind } from "@/server/db/schema";
import { deriveBlockStage, emptyCounts, type BlockProductionStage } from "./stage";
import { latestLiveTakes, newestPosters, type TakeRow } from "./takes";

export type ProductionBlockAsset = {
  ref: string;
  assetId: string;
  name: string;
  kind: AssetKind;
  thumbnailFileId: string | null;
};

export type ProductionBlock = {
  /** The current version's id (reviews of the prepared block are about this version). */
  id: string;
  lineageId: string;
  orderIndex: number;
  title: string | null;
  durationSeconds: number | null;
  scriptExcerpt: string;
  stage: BlockProductionStage;
  /** The prepared prompt (with `<<<image_N>>>` tokens), once prepared. */
  prompt: string | null;
  /** Prepared: the references in token order. Before that: the assets the block names. */
  assets: ProductionBlockAsset[];
  /** Notes of the dami that prepared or revised the block. */
  notes: string[];
  /** Of the newest take with a file. */
  posterFileId: string | null;
  /** Why preparation failed (stage `prepare_failed`), or why the block waits (`preparing` after a script edit). */
  failure: string | null;
  /**
   * A script edit changed this shot and sent it back through preparation; true until the new
   * version is approved (stages `preparing`, `prepare_failed` and `block_review` only).
   */
  scriptChanged: boolean;
  /** The shot before it was accepted ending differently: it can be updated (see `updateShotForHandoff`). */
  handoffChanged: boolean;
};

const SCRIPT_CHANGE_STAGES: readonly BlockProductionStage[] = [
  "preparing",
  "prepare_failed",
  "block_review",
];

/** The refs a block shows: prepared references, else the image assets it names. */
function refsOf(block: PromptBlock): string[] {
  if (block.productionState === "ready" && block.productionAssetRefs) {
    return block.productionAssetRefs;
  }
  return (block.productionAssetRefs ?? block.assetRefs).filter((r) => !isVoiceRef(r));
}

/** Views of blocks of one project (any number; one query per kind of data). */
export async function toProductionBlocks(
  db: DbExecutor,
  projectId: string,
  blocks: PromptBlock[],
  takes?: Map<string, TakeRow>,
): Promise<ProductionBlock[]> {
  if (blocks.length === 0) return [];
  const lineageIds = blocks.map((b) => b.lineageId);
  const latest = takes ?? (await latestLiveTakes(db, projectId, lineageIds));
  const posters = await newestPosters(db, projectId, lineageIds);
  const refs = await describeAssetRefs(projectId, blocks.flatMap(refsOf), db);
  const reset = await listScriptResetBlocks(
    blocks.map((b) => b.id),
    db,
  );
  return blocks.map((block) => {
    const stage = deriveBlockStage(block, latest.get(block.lineageId) ?? null);
    const assets: ProductionBlockAsset[] = [];
    for (const ref of refsOf(block)) {
      const found = refs.get(ref);
      if (!found || found.kind === "voice") continue;
      assets.push({
        ref,
        assetId: found.assetId,
        name: found.name,
        kind: found.kind,
        thumbnailFileId: found.thumbnailFileId,
      });
    }
    return {
      id: block.id,
      lineageId: block.lineageId,
      orderIndex: block.orderIndex,
      title: block.title,
      durationSeconds: block.durationSeconds,
      scriptExcerpt: block.scriptExcerpt,
      stage,
      prompt: block.productionState === "ready" ? block.productionPrompt : null,
      assets,
      notes: block.productionNotes ?? [],
      posterFileId: posters.get(block.lineageId) ?? null,
      failure: block.stale
        ? block.staleReason
        : block.productionState === "failed"
          ? block.productionFailure
          : null,
      handoffChanged: !block.stale && block.handoffNotice !== null,
      scriptChanged: !block.stale && reset.has(block.id) && SCRIPT_CHANGE_STAGES.includes(stage),
    };
  });
}

/** Every current block's stage (bounded by the project's block count), in story order. */
export async function projectStages(
  db: DbExecutor,
  projectId: string,
): Promise<{
  blocks: { lineageId: string; id: string; stage: BlockProductionStage }[];
  counts: Record<BlockProductionStage, number>;
}> {
  const rows = await listCurrentBlockStates(projectId, db);
  const takes = await latestLiveTakes(db, projectId);
  const counts = emptyCounts();
  const blocks = rows.map((row) => {
    const stage = deriveBlockStage(row, takes.get(row.lineageId) ?? null);
    counts[stage]++;
    return { lineageId: row.lineageId, id: row.id, stage };
  });
  return { blocks, counts };
}
