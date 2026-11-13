/** Applying one Asset Detector answer to the project's assets, in one transaction. */
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { rewriteAssetRefs } from "@/server/blocks";
import { type AssetDetectorOutput, formatAssetRef, nameKey } from "@/server/damis";
import { type DbExecutor, type DbTx, getDb } from "@/server/db/client";
import {
  asset,
  assetDetection,
  type AssetDetectionMode,
  assetLook,
  project,
} from "@/server/db/schema";
import { logProjectEvent } from "@/server/projects";
import { wakeWaitingLooks } from "../designs";
import {
  type DetectionPlan,
  isDetectedKind,
  type KnownRow,
  type KnownStatus,
  planDetection,
} from "../detection";
import { isUuid } from "../preproduction/access";
import { type Asset, AssetInputError } from "../service";

const MAX_ROWS = 2000;

export type DetectionRow = typeof assetDetection.$inferSelect;

/** Stored rows of the project with their design status (approved: a look was accepted). */
export async function knownRows(tx: DbTx, projectId: string): Promise<KnownRow[]> {
  const rows = await tx
    .select()
    .from(asset)
    .where(eq(asset.projectId, projectId))
    .orderBy(asc(asset.displayOrder), asc(asset.id))
    .limit(MAX_ROWS);
  if (rows.length === 0) return [];
  const looks = await tx
    .select({
      assetId: assetLook.assetId,
      accepted: sql<boolean>`bool_or(${assetLook.status} = 'accepted')`,
    })
    .from(assetLook)
    .where(
      inArray(
        assetLook.assetId,
        rows.map((r) => r.id),
      ),
    )
    .groupBy(assetLook.assetId);
  const byAsset = new Map(looks.map((l) => [l.assetId, l.accepted]));
  return rows.map((r) => {
    const look = byAsset.get(r.id);
    const status: KnownStatus = look === undefined ? "detected" : look ? "approved" : "in_progress";
    return { asset: r, status };
  });
}

export async function latestDetection(
  db: DbExecutor,
  projectId: string,
): Promise<DetectionRow | null> {
  const [row] = await db
    .select()
    .from(assetDetection)
    .where(eq(assetDetection.projectId, projectId))
    .orderBy(desc(assetDetection.createdAt))
    .limit(1);
  return row ?? null;
}

export type ApplyDetectionResult = {
  detectionId: string;
  added: number;
  kept: number;
  removed: number;
  diff: DetectionPlan["diff"];
};

/** What every step of one application shares (all on the same transaction). */
type DetectionRun = {
  tx: DbTx;
  projectId: string;
  scriptVersionId: string;
  damiRunId: string | null;
  mode: AssetDetectionMode;
  /** The project's owner: the detector's events are logged in their name. */
  ownerId: string;
};

/**
 * Locks the project row (the lock order of every asset writer: the project row first, then asset
 * rows) and returns its owner, or throws when the project is gone.
 */
async function lockProject(tx: DbTx, projectId: string): Promise<{ ownerId: string }> {
  const [owner] = await tx
    .select({ ownerId: project.ownerId })
    .from(project)
    .where(eq(project.id, projectId))
    .for("no key update");
  if (!owner) throw new AssetInputError("That project does not exist.");
  return owner;
}

/**
 * Writes the plan's assets, required ones first (the category screens list them first; skipping is
 * for the rest), numbering their display order: a matched row is updated (a manual one only gets
 * the new details), a new entry inserted. Returns the counts and the ids of the matched rows.
 */
async function upsertPlannedAssets(
  run: DetectionRun,
  plan: DetectionPlan,
): Promise<{ added: number; kept: number; seen: Set<string> }> {
  const { tx, projectId, scriptVersionId, damiRunId } = run;
  let added = 0;
  let kept = 0;
  let order = 0;
  const seen = new Set<string>();
  const rank = (p: (typeof plan.assets)[number]) =>
    (p.existing?.priority ?? p.priority) === "required" ? 0 : 1;
  const ordered = [...plan.assets].sort((a, b) => rank(a) - rank(b));
  for (const p of ordered) {
    const displayOrder = order++;
    if (p.existing) {
      kept++;
      seen.add(p.existing.id);
      if (p.existing.origin === "manual") {
        await tx
          .update(asset)
          .set({
            details: { ...p.existing.details, ...p.details },
            lastScriptVersionId: scriptVersionId,
          })
          .where(eq(asset.id, p.existing.id));
        continue;
      }
      await tx
        .update(asset)
        .set({
          description: p.description,
          details: p.details,
          priority: p.existing.priority === "skipped" ? "skipped" : p.priority,
          status: "active",
          displayOrder,
          lastScriptVersionId: scriptVersionId,
          damiRunId,
        })
        .where(eq(asset.id, p.existing.id));
      continue;
    }
    added++;
    await tx.insert(asset).values({
      projectId,
      kind: p.kind,
      name: p.name,
      description: p.description,
      details: p.details,
      priority: p.priority,
      status: "active",
      origin: "detected",
      displayOrder,
      firstScriptVersionId: scriptVersionId,
      lastScriptVersionId: scriptVersionId,
      damiRunId,
    });
  }
  return { added, kept, seen };
}

/**
 * The detected rows to remove: in full mode every active detected row the answer no longer
 * contains, else the detector's removals. Approved rows (a look was accepted) are kept and
 * reported as an `APPROVED_CONFLICT` warning. Pure.
 */
function planRemovals(
  mode: AssetDetectionMode,
  plan: DetectionPlan,
  existing: readonly Asset[],
  seen: ReadonlySet<string>,
  approved: ReadonlySet<string>,
): { remove: string[]; warnings: string[] } {
  const candidates =
    mode === "full"
      ? existing.filter(
          (a) =>
            isDetectedKind(a.kind) &&
            a.origin === "detected" &&
            a.status === "active" &&
            !seen.has(a.id),
        )
      : plan.removed.filter((a) => a.status === "active" && a.origin === "detected");
  const warnings = [...plan.warnings];
  const remove: string[] = [];
  for (const a of candidates) {
    if (seen.has(a.id)) continue;
    if (approved.has(a.id)) {
      warnings.push(
        `APPROVED_CONFLICT: ${a.name} is no longer found in the script. It is kept because its design was approved; remove it yourself if it should go.`,
      );
      continue;
    }
    remove.push(a.id);
  }
  return { remove, warnings };
}

/** Marks the rows removed; props waiting for a location the detector removed go ahead without it. */
async function removeMissing(
  run: DetectionRun,
  existing: readonly Asset[],
  remove: readonly string[],
): Promise<void> {
  if (remove.length === 0) return;
  await run.tx
    .update(asset)
    .set({ status: "removed" })
    .where(inArray(asset.id, [...remove]));
  if (existing.some((a) => a.kind === "location" && remove.includes(a.id))) {
    await wakeWaitingLooks(run.projectId, run.tx);
  }
}

/**
 * A merge by the detector (ADT02) removes one side and keeps its name as an alias of the other:
 * the current blocks' refs and tags move to the surviving name, as a manual merge does, and the
 * merge is logged (`asset.merged`, by the detector).
 */
async function rewriteMergedRefs(
  run: DetectionRun,
  plan: DetectionPlan,
  existing: readonly Asset[],
  remove: readonly string[],
): Promise<void> {
  const { tx, projectId } = run;
  for (const id of remove) {
    const gone = existing.find((a) => a.id === id);
    if (!gone) continue;
    const survivor = plan.assets.find(
      (p) =>
        p.kind === gone.kind &&
        p.existing?.id !== gone.id &&
        (p.details.aliases ?? []).some((alias) => nameKey(alias) === nameKey(gone.name)),
    );
    if (!survivor) continue;
    const blocksRewritten = await rewriteAssetRefs(
      {
        projectId,
        from: formatAssetRef(gone.kind, gone.name),
        to: formatAssetRef(survivor.kind, survivor.name),
      },
      tx,
    );
    await logProjectEvent(tx, {
      projectId,
      userId: run.ownerId,
      type: "asset.merged",
      payload: {
        by: "detector",
        keepName: survivor.name,
        mergeId: gone.id,
        mergeName: gone.name,
        kind: gone.kind,
        blocksRewritten,
      },
    });
  }
}

/** Records the result in `asset_detection` and logs `assets.detected`. */
async function recordDetection(
  run: DetectionRun,
  plan: DetectionPlan,
  warnings: string[],
  counts: { added: number; kept: number; removed: number },
): Promise<ApplyDetectionResult> {
  const { tx, projectId, scriptVersionId, damiRunId, mode } = run;
  const { added, kept, removed } = counts;
  const [row] = await tx
    .insert(assetDetection)
    .values({
      projectId,
      scriptVersionId,
      damiRunId,
      mode,
      sceneIndex: plan.sceneIndex,
      diff: plan.diff,
      assumptions: plan.assumptions,
      warnings,
    })
    .returning({ id: assetDetection.id });
  if (!row) throw new Error("asset_detection insert returned no row");
  const result = { detectionId: row.id, added, kept, removed, diff: plan.diff };
  await logProjectEvent(tx, {
    projectId,
    userId: run.ownerId,
    type: "assets.detected",
    payload: { scriptVersionId, damiRunId, mode, added, kept, removed },
  });
  return result;
}

/**
 * Applies one detector answer, in one transaction: matched rows are updated (their names never
 * change, so refs stay valid; a skipped asset stays skipped; manual assets are left as the user
 * made them), new entries are inserted with unique names (a removed detected row with the same
 * name is revived), and the detector's removals become `removed`, except approved assets (a look
 * was accepted), which are kept and reported as a warning. Legacy creature, costume and other
 * rows are never touched. Full mode also removes detected rows the answer no longer contains.
 * Records the result in `asset_detection` and logs `assets.detected`.
 */
export async function applyDetection(input: {
  projectId: string;
  scriptVersionId: string;
  damiRunId: string | null;
  mode: AssetDetectionMode;
  output: AssetDetectorOutput;
  /** The run's temporary ids → stored assets (from `detectorView`). */
  byTemp: ReadonlyMap<string, Asset>;
}): Promise<ApplyDetectionResult> {
  const { projectId, scriptVersionId, damiRunId, mode } = input;
  if (!isUuid(projectId) || !isUuid(scriptVersionId)) {
    throw new AssetInputError("That project does not exist.");
  }
  return getDb().transaction(async (tx) => {
    // Every user action on an asset takes the project lock too, so it runs wholly before or after
    // this one, and the rows read below are current (a user's removal or inclusion is never
    // overwritten).
    const { ownerId } = await lockProject(tx, projectId);
    const run: DetectionRun = { tx, projectId, scriptVersionId, damiRunId, mode, ownerId };
    const rows = await knownRows(tx, projectId);
    const existing = rows.map((r) => r.asset);
    const approved = new Set(rows.filter((r) => r.status === "approved").map((r) => r.asset.id));
    // Temporary ids may point at rows that changed meanwhile: re-read them.
    const fresh = new Map(existing.map((a) => [a.id, a]));
    const byTemp = new Map<string, Asset>();
    for (const [temp, a] of input.byTemp) {
      const row = fresh.get(a.id);
      if (row) byTemp.set(temp, row);
    }
    const plan = planDetection({ output: input.output, byTemp, existing });

    const { added, kept, seen } = await upsertPlannedAssets(run, plan);
    const { remove, warnings } = planRemovals(mode, plan, existing, seen, approved);
    await removeMissing(run, existing, remove);
    await rewriteMergedRefs(run, plan, existing, remove);
    return recordDetection(run, plan, warnings, { added, kept, removed: remove.length });
  });
}
