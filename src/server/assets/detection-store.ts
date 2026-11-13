/**
 * Asset Detector results in the database: applying one (`applyDetection`), what the worker needs
 * to run the detector (`loadDetectorState`), and the review loop of the category screens
 * ("Something wrong with this list?": `submitDetectionReview`, `getDetectionPanel`).
 */
import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { rewriteAssetRefs } from "@/server/blocks";
import {
  buildFixRequests,
  fixRequestCodes,
  formatAssetRef,
  nameKey,
  getReviewCatalog,
  parseAssetRef,
  ReviewCatalogError,
  visibleOptions,
  type AssetDetectorOutput,
  type FixSelection,
  type ReviewOption,
} from "@/server/damis";
import { getDb, type DbTx } from "@/server/db/client";
import {
  asset,
  assetDetection,
  assetLook,
  project,
  projectEvent,
  review,
  scriptVersion,
  type AssetDetectionMode,
  type DetectionSceneIndexEntry,
  type ReviewFixRequest,
} from "@/server/db/schema";
import { assetDetectFix, enqueue } from "@/server/jobs";
import { wakeWaitingLooks } from "./designs";
import {
  isDetectedKind,
  planDetection,
  visibleWarnings,
  type DetectionPlan,
  type KnownRow,
  type KnownStatus,
} from "./detection";
import { assertPreProductionOpen, ENQUEUE_FAILURE, wakeOnTx } from "./preproduction";
import { AssetInputError, parse, type Asset } from "./service";

const uuid = z.uuid();
const MAX_ROWS = 2000;

export type DetectionRow = typeof assetDetection.$inferSelect;

/** Stored rows of the project with their design status (approved: a look was accepted). */
async function knownRows(tx: DbTx, projectId: string): Promise<KnownRow[]> {
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

async function latestDetection(tx: DbTx, projectId: string): Promise<DetectionRow | null> {
  const [row] = await tx
    .select()
    .from(assetDetection)
    .where(eq(assetDetection.projectId, projectId))
    .orderBy(desc(assetDetection.createdAt))
    .limit(1);
  return row ?? null;
}

/** Worker: the stored assets (with status) and the latest detection of a project. */
export async function loadDetectorState(projectId: string): Promise<{
  rows: KnownRow[];
  latest: DetectionRow | null;
}> {
  return getDb().transaction(async (tx) => ({
    rows: await knownRows(tx, projectId),
    latest: await latestDetection(tx, projectId),
  }));
}

/** True when a full or incremental detection of this script version has been applied. */
export async function hasDetectionFor(
  projectId: string,
  scriptVersionId: string,
): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: assetDetection.id })
    .from(assetDetection)
    .where(
      and(
        eq(assetDetection.projectId, projectId),
        eq(assetDetection.scriptVersionId, scriptVersionId),
        inArray(assetDetection.mode, ["full", "incremental"]),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export type ApplyDetectionResult = {
  detectionId: string;
  added: number;
  kept: number;
  removed: number;
  diff: DetectionPlan["diff"];
};

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
  if (!uuid.safeParse(projectId).success || !uuid.safeParse(scriptVersionId).success) {
    throw new AssetInputError("That project does not exist.");
  }
  return getDb().transaction(async (tx) => {
    // Lock order of every asset writer: the project row first, then asset rows. Every user
    // action on an asset takes this lock too, so it runs wholly before or after this one, and the
    // rows read below are current (a user's removal or inclusion is never overwritten).
    const [owner] = await tx
      .select({ ownerId: project.ownerId })
      .from(project)
      .where(eq(project.id, projectId))
      .for("no key update");
    if (!owner) throw new AssetInputError("That project does not exist.");
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

    let added = 0;
    let kept = 0;
    let order = 0;
    const seen = new Set<string>();
    // Required assets first (the category screens list them first; skipping is for the rest).
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
    if (remove.length > 0) {
      await tx.update(asset).set({ status: "removed" }).where(inArray(asset.id, remove));
      // Props waiting for a location the detector removed go ahead without it.
      if (existing.some((a) => a.kind === "location" && remove.includes(a.id))) {
        await wakeWaitingLooks(projectId, tx);
      }
    }
    // A merge by the detector (ADT02) removes one side and keeps its name as an alias of the
    // other: the current blocks' refs and tags move to the surviving name, as a manual merge does.
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
      await tx.insert(projectEvent).values({
        projectId,
        userId: owner.ownerId,
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
    const result = { detectionId: row.id, added, kept, removed: remove.length, diff: plan.diff };
    await tx.insert(projectEvent).values({
      projectId,
      userId: owner.ownerId,
      type: "assets.detected",
      payload: { scriptVersionId, damiRunId, mode, added, kept, removed: remove.length },
    });
    return result;
  });
}

/* ------------------------------------------------------------------------------------------ */
/* The review loop (category screens)                                                          */
/* ------------------------------------------------------------------------------------------ */

const CATALOG_KEY = "asset-detector" as const;

/** Codes that need no dami: skip (ADP01). Rename, delete, add and merge use their own actions. */
const SKIP_CODE = "ADP01";
const RESCAN_CODE = "ADR01";

export type DetectionWarning = {
  /** MERGE_CHECK, NO_LOCATION, AMBIGUOUS, REAL_PERSON, APPROVED_CONFLICT, NOT_IN_SCRIPT ... */
  tag: string;
  text: string;
};

export type DetectionPanel = {
  /** The options the Wizard shows, from the owner's catalog. */
  options: ReviewOption[];
  warnings: DetectionWarning[];
  /** Correction rounds asked for so far (for the "edit by hand" suggestion). */
  rounds: number;
  maxRounds: number;
  suggestion: string | null;
  /** A correction or re-scan is running. */
  busy: boolean;
  /** The last correction round failed (user-readable). */
  failure: string | null;
};

function splitWarning(w: string): DetectionWarning {
  const match = /^([A-Z_]+):\s*(.*)$/s.exec(w);
  return match ? { tag: match[1] ?? "", text: match[2] ?? w } : { tag: "NOTE", text: w };
}

async function ownedProject(projectId: string, userId: string) {
  if (!uuid.safeParse(projectId).success) return null;
  const [row] = await getDb()
    .select({ id: project.id, mode: project.mode, stage: project.stage })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.ownerId, userId), isNull(project.archivedAt)))
    .limit(1);
  return row ?? null;
}

/** What the category screens show about the detected list. */
export async function getDetectionPanel(
  projectId: string,
  userId: string,
): Promise<DetectionPanel | null> {
  const owned = await ownedProject(projectId, userId);
  if (!owned) return null;
  const catalog = getReviewCatalog(CATALOG_KEY);
  const db = getDb();
  const latest = await db.transaction((tx) => latestDetection(tx, projectId));
  const [rounds] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(review)
    .where(and(eq(review.projectId, projectId), eq(review.subjectType, "asset_detection")));
  const [lastReview] = await db
    .select({ id: review.id, createdAt: review.createdAt })
    .from(review)
    .where(and(eq(review.projectId, projectId), eq(review.subjectType, "asset_detection")))
    .orderBy(desc(review.createdAt))
    .limit(1);
  let busy = false;
  let failure: string | null = null;
  if (lastReview && (!latest || latest.createdAt < lastReview.createdAt)) {
    const [failed] = await db
      .select({ payload: projectEvent.payload })
      .from(projectEvent)
      .where(
        and(
          eq(projectEvent.projectId, projectId),
          eq(projectEvent.type, "assets.fix-failed"),
          gt(projectEvent.createdAt, lastReview.createdAt),
        ),
      )
      .limit(1);
    if (failed) {
      const payload = failed.payload as { failure?: unknown } | null;
      failure = typeof payload?.failure === "string" ? payload.failure : "The correction failed.";
    } else busy = true;
  }
  const maxRounds = catalog.maxAttemptsBeforeSuggestion ?? 4;
  const n = rounds?.n ?? 0;
  return {
    options: visibleOptions(catalog, { sector: owned.mode === "pro" ? "pro" : "wizard" }),
    warnings: visibleWarnings(latest?.warnings ?? []).map(splitWarning),
    rounds: n,
    maxRounds,
    suggestion:
      n >= maxRounds
        ? "This list has been corrected several times. Rename, remove or add assets yourself; it is quicker."
        : null,
    busy,
    failure,
  };
}

const selectionSchema = z.object({
  code: z.string().trim().min(1).max(20),
  value: z.string().trim().max(200).optional(),
  customText: z.string().trim().max(4000).optional(),
  targetNames: z.array(z.string().min(1).max(300)).max(50).optional(),
});

const NOT_AN_ASSET = "One of the chosen assets is not on the list. Reload the page.";

const submitSchema = z.object({
  projectId: z.string().max(100),
  userId: z.string().min(1).max(128),
  selections: z.array(selectionSchema).min(1, "Pick what is wrong first.").max(20),
  note: z.string().trim().max(8000).optional(),
});

/**
 * One "Something wrong with this list?" round. Skip (ADP01) sets the targets' priority to
 * skipped (no dami). Re-scan (ADR01) and the dami fixes (ADT…, ADP02…) are recorded as a review
 * of the latest detection, with the fix requests built from the owner's catalog (targets as
 * `kind:Name` refs), and run by `asset.detect.fix`. Returns what was started.
 */
export async function submitDetectionReview(input: {
  projectId: string;
  userId: string;
  selections: FixSelection[];
  note?: string;
}): Promise<{ skipped: number; started: boolean } | null> {
  const parsed = parse(submitSchema, input);
  const owned = await ownedProject(parsed.projectId, parsed.userId);
  if (!owned) return null;
  assertPreProductionOpen(owned);
  const catalog = getReviewCatalog(CATALOG_KEY);
  const allowed = new Set(
    visibleOptions(catalog, { sector: owned.mode === "pro" ? "pro" : "wizard" }).map((o) => o.code),
  );
  for (const s of parsed.selections) {
    if (!allowed.has(s.code))
      throw new AssetInputError("One of the chosen fixes is not available.");
  }
  const skip = parsed.selections.filter((s) => s.code === SKIP_CODE);
  // Each target is a `kind:Name` ref; anything else is refused before it reaches the database.
  const skipRefs = skip.flatMap((s) =>
    (s.targetNames ?? []).map((ref) => {
      const target = parseAssetRef(ref);
      if (!target) throw new AssetInputError(NOT_AN_ASSET);
      return target;
    }),
  );
  const rescan = parsed.selections.some((s) => s.code === RESCAN_CODE);
  let requests: ReviewFixRequest[];
  try {
    requests = buildFixRequests(
      catalog,
      parsed.selections.filter((s) => s.code !== SKIP_CODE && s.code !== RESCAN_CODE),
    );
  } catch (error) {
    if (error instanceof ReviewCatalogError) {
      throw new AssetInputError("Say a little more about what is wrong, then try again.");
    }
    throw error;
  }
  for (const r of requests) {
    const option = catalog.options.find((o) => o.code === r.code);
    if ((option?.targetCount ?? 0) >= 1 && !(r.targetNames?.length ?? 0)) {
      throw new AssetInputError("Pick the assets this is about.");
    }
  }

  const outcome = await getDb().transaction(async (tx) => {
    // The project row first (the lock order of every asset writer), with ownership and stage.
    const [locked] = await tx
      .select({ id: project.id, stage: project.stage })
      .from(project)
      .where(
        and(
          eq(project.id, parsed.projectId),
          eq(project.ownerId, parsed.userId),
          isNull(project.archivedAt),
        ),
      )
      .for("no key update");
    if (!locked) return null;
    assertPreProductionOpen(locked);
    let skipped = 0;
    let skippedLocation = false;
    for (const target of skipRefs) {
      const updated = await tx
        .update(asset)
        .set({ priority: "skipped" })
        .where(
          and(
            eq(asset.projectId, parsed.projectId),
            eq(asset.kind, target.kind),
            sql`lower(${asset.name}) = lower(${target.name})`,
          ),
        )
        .returning({ id: asset.id });
      skipped += updated.length;
      if (updated.length > 0 && target.kind === "location") skippedLocation = true;
    }
    if (skipped > 0) {
      await tx.insert(projectEvent).values({
        projectId: parsed.projectId,
        userId: parsed.userId,
        type: "assets.skipped",
        payload: { refs: skip.flatMap((s) => s.targetNames ?? []) },
      });
    }
    // A skipped location is not designed: props waiting for it go ahead without it.
    if (skippedLocation) await wakeOnTx(tx, parsed.projectId);
    if (requests.length === 0 && !rescan) return { skipped, reviewId: null };
    const latest = await latestDetection(tx, parsed.projectId);
    if (!latest) {
      throw new AssetInputError("The assets have not been detected yet. Wait for the list first.");
    }
    const [row] = await tx
      .insert(review)
      .values({
        projectId: parsed.projectId,
        userId: parsed.userId,
        subjectType: "asset_detection",
        subjectId: latest.id,
        decision: "rejected",
        issueCodes: rescan
          ? [RESCAN_CODE, ...fixRequestCodes(requests)]
          : fixRequestCodes(requests),
        fixRequests: requests,
        note: parsed.note || null,
        damiRunId: latest.damiRunId,
      })
      .returning({ id: review.id });
    if (!row) throw new Error("review insert returned no row");
    // The fix job is sent with the review: the panel never shows a round as running without it.
    try {
      await enqueue(assetDetectFix, { reviewId: row.id }, { tx });
    } catch (error) {
      console.error("[assets] could not enqueue asset.detect.fix:", error);
      throw new AssetInputError(ENQUEUE_FAILURE);
    }
    return { skipped, reviewId: row.id };
  });
  if (!outcome) return null;
  return { skipped: outcome.skipped, started: outcome.reviewId !== null };
}

export type DetectionFixJob = {
  review: typeof review.$inferSelect;
  projectId: string;
  ownerId: string;
  /** The detection the review answers, and whether it is still the latest. */
  detection: DetectionRow;
  isLatest: boolean;
  /** The accepted script version, or null. */
  scriptVersionId: string | null;
  rescan: boolean;
};

/** Worker: what `asset.detect.fix` needs, or null when the review or project is gone. */
export async function loadDetectionFix(reviewId: string): Promise<DetectionFixJob | null> {
  if (!uuid.safeParse(reviewId).success) return null;
  const db = getDb();
  const [row] = await db
    .select({ review, ownerId: project.ownerId })
    .from(review)
    .innerJoin(project, eq(project.id, review.projectId))
    .where(
      and(
        eq(review.id, reviewId),
        eq(review.subjectType, "asset_detection"),
        isNull(project.archivedAt),
      ),
    )
    .limit(1);
  if (!row) return null;
  const [detection] = await db
    .select()
    .from(assetDetection)
    .where(eq(assetDetection.id, row.review.subjectId))
    .limit(1);
  if (!detection) return null;
  const latest = await db.transaction((tx) => latestDetection(tx, row.review.projectId));
  const [accepted] = await db
    .select({ id: scriptVersion.id })
    .from(scriptVersion)
    .where(
      and(
        eq(scriptVersion.projectId, row.review.projectId),
        isNull(scriptVersion.episodeId),
        eq(scriptVersion.status, "accepted"),
      ),
    )
    .orderBy(desc(scriptVersion.versionNumber))
    .limit(1);
  return {
    review: row.review,
    projectId: row.review.projectId,
    ownerId: row.ownerId,
    detection,
    isLatest: latest?.id === detection.id,
    scriptVersionId: accepted?.id ?? null,
    rescan: row.review.issueCodes.includes(RESCAN_CODE),
  };
}

/** True when a detection newer than the review exists (the fix already ran). */
export async function detectionAnswered(reviewId: string, projectId: string): Promise<boolean> {
  const db = getDb();
  const [r] = await db.select().from(review).where(eq(review.id, reviewId)).limit(1);
  if (!r) return true;
  const [newer] = await db
    .select({ id: assetDetection.id })
    .from(assetDetection)
    .where(and(eq(assetDetection.projectId, projectId), gt(assetDetection.createdAt, r.createdAt)))
    .limit(1);
  return newer !== undefined;
}

/** Records that a correction round failed (shown on the category screens). */
export async function recordFixFailure(
  projectId: string,
  reviewId: string,
  failure: string,
): Promise<void> {
  await getDb().insert(projectEvent).values({
    projectId,
    userId: null,
    type: "assets.fix-failed",
    payload: { reviewId, failure },
  });
}

export type { DetectionSceneIndexEntry };
